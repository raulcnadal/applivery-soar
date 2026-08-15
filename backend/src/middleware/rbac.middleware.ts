import type { NextFunction, Request, Response } from "express";

/**
 * RBAC layer — ported verbatim from main.py lines 1033-1291 (module comment
 * reproduced below since it's the actual design spec, not just a summary).
 *
 * This app has no local user database — every "user" is an Applivery
 * Collaborator, and Applivery's own Collaborator role is a fixed 5-value
 * enum (Owner/Admin/Editor/Viewer/Unassigned) with no per-org fine-grained
 * permission model of its own. So RBAC here is entirely this app's own
 * layer, resolved fresh at login/workspace-switch and cached briefly
 * server-side (not just trusted from the client) for the endpoints that
 * actually need real enforcement.
 *
 * Precedence, in order:
 *   1. Applivery Collaborator role === "owner" -> Super Admin. Unconditional
 *      full access, bypasses every check below.
 *   2. Anyone else: resolved by a "role tag" read off the raw Collaborator
 *      record, matched against the tag values a SOAR Role has been
 *      configured to accept (see modules/roles).
 *   3. No confirmed tag match -> DENIED. Not a default-read-only fallback.
 *
 * The cache below is in-process/in-memory only (never persisted to
 * Postgres), 12h TTL, fail-closed if absent: a caller who hasn't triggered
 * POST /api/auth/resolve-access for this workspace this session is denied,
 * rather than the server re-resolving live inline on every request. A
 * restart or evicted entry can only ever be MORE restrictive, never less.
 */

export const SOAR_FEATURE_AREAS = [
  "devices",
  "compliance",
  "workflows",
  "cases",
  "integrations",
  "reporting",
  "settings",
  "auditLog",
] as const;
export type FeatureArea = (typeof SOAR_FEATURE_AREAS)[number];

export type FeatureLevel = "none" | "read" | "manage";
const FEATURE_ACCESS_LEVELS: Record<FeatureLevel, number> = { none: 0, read: 1, manage: 2 };

// Curated list (5, not 50) of endpoints that are destructive, leak/move
// plaintext secrets, or fire a real-world side effect — everything else
// (viewing, routine CRUD) is covered by the feature-area level alone.
export const SOAR_RISKY_ACTIONS = [
  "canDeletePolicyOrWorkflow",
  "canRunDestructiveWorkflow",
  "canEditIntegrationSecrets",
  "canExportOrImportConfig",
  "canBulkTriage",
  "canManageMtlsCA",
] as const;
export type RiskyAction = (typeof SOAR_RISKY_ACTIONS)[number];

export interface SoarRoleRecord {
  id: string;
  name: string;
  description?: string | null;
  featureAccess: Partial<Record<FeatureArea, FeatureLevel>>;
  riskyActions: Partial<Record<RiskyAction, boolean>>;
  appliveryTagValues: string[];
  segmentIds: string[];
}

export interface ResolvedAccess {
  allowed: boolean;
  isSuperAdmin: boolean;
  role: SoarRoleRecord | null;
  collaboratorRole: string | null;
  matchedTagValue: string | null;
  deniedReason: string | null;
}

const ACCESS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const accessCache = new Map<string, { resolvedAtMs: number; access: ResolvedAccess }>();

function cacheKey(workspaceSlug: string, email: string): string {
  return `${workspaceSlug}:${(email || "").toLowerCase()}`;
}

export function getCachedAccess(workspaceSlug: string, email: string): ResolvedAccess | null {
  const entry = accessCache.get(cacheKey(workspaceSlug, email));
  if (!entry) return null;
  if (Date.now() - entry.resolvedAtMs > ACCESS_CACHE_TTL_MS) {
    return null;
  }
  return entry.access;
}

export function setCachedAccess(workspaceSlug: string, email: string, access: ResolvedAccess): void {
  accessCache.set(cacheKey(workspaceSlug, email), { resolvedAtMs: Date.now(), access });
}

function roleFeatureLevel(role: SoarRoleRecord | null, area: FeatureArea): FeatureLevel {
  return role?.featureAccess?.[area] ?? "none";
}

export interface RequirePermissionOptions {
  area?: FeatureArea;
  level?: FeatureLevel;
  action?: RiskyAction;
  superAdminOnly?: boolean;
}

/**
 * Express equivalent of `require_permission(area=None, level="read",
 * action=None, super_admin_only=False)` — a dependency FACTORY, so call it
 * with options to get the actual middleware: `requirePermission({ area:
 * "workflows", level: "manage", action: "canRunDestructiveWorkflow" })`.
 * Consults the cache populated by POST /api/auth/resolve-access ONLY —
 * never re-resolves live inline.
 */
export function requirePermission(options: RequirePermissionOptions = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    const email = req.dashboardUser?.sub ?? "";

    const cached = getCachedAccess(workspaceSlug, email);
    if (cached === null) {
      return res.status(403).json({
        detail: "Access not resolved for this workspace yet — switch workspace or sign in again to refresh permissions.",
      });
    }
    if (!cached.allowed) {
      return res.status(403).json({ detail: cached.deniedReason ?? "No SOAR role assigned for this workspace." });
    }
    if (cached.isSuperAdmin) {
      return next();
    }
    if (options.superAdminOnly) {
      return res
        .status(403)
        .json({ detail: "This action is restricted to the workspace Super Admin (the Applivery workspace Owner)." });
    }

    const role = cached.role;
    if (options.area) {
      const have = FEATURE_ACCESS_LEVELS[roleFeatureLevel(role, options.area)];
      const need = FEATURE_ACCESS_LEVELS[options.level ?? "read"];
      if (have < need) {
        return res.status(403).json({ detail: `Your role doesn't have ${options.level ?? "read"} access to ${options.area}.` });
      }
    }
    if (options.action) {
      if (!role?.riskyActions?.[options.action]) {
        return res.status(403).json({ detail: `Your role isn't permitted to perform this action (${options.action}).` });
      }
    }
    return next();
  };
}
