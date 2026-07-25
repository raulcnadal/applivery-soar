import type { NextFunction, Request, Response } from "express";

/**
 * RBAC layer — ported from ARCHITECTURE.md §2.4. Scaffolded in Phase 0,
 * populated in Phase 1 alongside /api/auth/resolve-access.
 *
 * Precedence (unchanged from the original app):
 *   1. Applivery role === "owner" for the current org → Super Admin, bypasses everything.
 *   2. Otherwise, the collaborator's Applivery `tags` are matched against a Role's
 *      configured tag values.
 *   3. No match → denied outright. There is no default-read fallback.
 *
 * The cache below is deliberately in-process/in-memory only (never persisted
 * to Postgres) with a 12-hour TTL, fail-closed if absent — same trade-off the
 * original app makes: a caller who hasn't triggered resolve-access for this
 * workspace this session is denied, rather than the server re-resolving live
 * inline on every request.
 */

export type FeatureLevel = "none" | "read" | "manage";
export type FeatureArea =
  | "devices"
  | "compliance"
  | "workflows"
  | "cases"
  | "integrations"
  | "settings"
  | "reporting" // declared, not currently gated by any endpoint — matches original
  | "auditLog"; // declared, not currently gated by any endpoint — matches original

export type RiskyAction =
  | "canDeletePolicyOrWorkflow"
  | "canRunDestructiveWorkflow"
  | "canEditIntegrationSecrets"
  | "canExportOrImportConfig"
  | "canBulkTriage";

export interface ResolvedAccess {
  isSuperAdmin: boolean;
  featureAccess: Record<FeatureArea, FeatureLevel>;
  riskyActions: Record<RiskyAction, boolean>;
  cachedAt: number;
}

const ACCESS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const accessCache = new Map<string, ResolvedAccess>(); // key: `${workspaceSlug}:${lowercasedEmail}`

export function cacheKey(workspaceSlug: string, email: string): string {
  return `${workspaceSlug}:${email.toLowerCase()}`;
}

export function getCachedAccess(workspaceSlug: string, email: string): ResolvedAccess | null {
  const key = cacheKey(workspaceSlug, email);
  const entry = accessCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > ACCESS_CACHE_TTL_MS) {
    accessCache.delete(key);
    return null;
  }
  return entry;
}

export function setCachedAccess(workspaceSlug: string, email: string, access: Omit<ResolvedAccess, "cachedAt">) {
  accessCache.set(cacheKey(workspaceSlug, email), { ...access, cachedAt: Date.now() });
}

export interface RequirePermissionOptions {
  area?: FeatureArea;
  level?: FeatureLevel;
  action?: RiskyAction;
  superAdminOnly?: boolean;
}

/**
 * FastAPI's `Depends(require_permission(...))` equivalent as an Express
 * middleware factory. Reads dashboard-token claims (set by
 * verifyDashboardToken) plus the X-Workspace-Slug header to look up the
 * cached resolved access — never re-resolves live inline.
 *
 * Phase 1 TODO: wire /api/auth/resolve-access to actually populate the cache
 * via a live Applivery collaborator lookup + Role matching. Until then this
 * fails closed (403) for every request, which is the correct default.
 */
export function requirePermission(options: RequirePermissionOptions = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const workspaceSlug = req.header("X-Workspace-Slug");
    const email = req.dashboardUser?.sub;

    if (!workspaceSlug || !email) {
      return res.status(400).json({ detail: "Missing workspace context" });
    }

    const access = getCachedAccess(workspaceSlug, email);
    if (!access) {
      return res.status(403).json({ detail: "No resolved access for this workspace — call resolve-access first" });
    }

    if (access.isSuperAdmin) return next();

    if (options.superAdminOnly) {
      return res.status(403).json({ detail: "Super admin required" });
    }

    if (options.area) {
      const level = access.featureAccess[options.area] ?? "none";
      const required = options.level ?? "read";
      const rank: Record<FeatureLevel, number> = { none: 0, read: 1, manage: 2 };
      if (rank[level] < rank[required]) {
        return res.status(403).json({ detail: `Missing ${required} access to ${options.area}` });
      }
    }

    if (options.action && !access.riskyActions[options.action]) {
      return res.status(403).json({ detail: `Missing risky-action permission: ${options.action}` });
    }

    return next();
  };
}
