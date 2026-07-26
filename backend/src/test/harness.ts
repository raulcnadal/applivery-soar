import type { Express } from "express";
import { createApp } from "../app";
import { signDashboardToken } from "../middleware/auth.middleware";
import {
  setCachedAccess,
  type FeatureArea,
  type FeatureLevel,
  type ResolvedAccess,
  type RiskyAction,
  type SoarRoleRecord,
} from "../middleware/rbac.middleware";

export const TEST_WORKSPACE = "test-workspace";
export const TEST_EMAIL = "tester@example.com";

let cachedApp: Express | null = null;

/** One Express app instance per test file (not per test) — cheap to build, no listening socket needed for supertest. */
export function testApp(): Express {
  if (!cachedApp) cachedApp = createApp();
  return cachedApp;
}

/** A valid, unexpired dashboard JWT for the given (or default) test user. */
export function dashboardToken(email = TEST_EMAIL): string {
  return signDashboardToken(email);
}

/** Standard header set every gated route expects: dashboard session + tenant + the live Applivery bearer token (many handlers do their own `requireCreds`/`Authorization` check downstream of RBAC — a dummy value is fine since appliveryClient itself is mocked in setup.ts). */
export function authHeaders(opts: { email?: string; workspaceSlug?: string; noToken?: boolean } = {}) {
  const workspaceSlug = opts.workspaceSlug ?? TEST_WORKSPACE;
  if (opts.noToken) return { "X-Workspace-Slug": workspaceSlug };
  return {
    "X-Dashboard-Token": dashboardToken(opts.email),
    "X-Workspace-Slug": workspaceSlug,
    Authorization: "Bearer test-applivery-access-token",
  };
}

/** Primes the in-memory RBAC cache exactly like a real POST /api/auth/resolve-access would. */
export function primeAccess(access: ResolvedAccess, opts: { email?: string; workspaceSlug?: string } = {}) {
  setCachedAccess(opts.workspaceSlug ?? TEST_WORKSPACE, opts.email ?? TEST_EMAIL, access);
}

export function superAdminAccess(): ResolvedAccess {
  return {
    allowed: true,
    isSuperAdmin: true,
    role: null,
    collaboratorRole: "owner",
    matchedTagValue: null,
    deniedReason: null,
  };
}

/** A role granting exactly the given feature levels / risky actions — everything else defaults to "none"/false. */
export function roleWithAccess(
  featureAccess: Partial<Record<FeatureArea, FeatureLevel>>,
  riskyActions: Partial<Record<RiskyAction, boolean>> = {},
): ResolvedAccess {
  const role: SoarRoleRecord = {
    id: "test-role",
    name: "Test Role",
    featureAccess,
    riskyActions,
    appliveryTagValues: ["test-tag"],
    segmentIds: [],
  };
  return {
    allowed: true,
    isSuperAdmin: false,
    role,
    collaboratorRole: "editor",
    matchedTagValue: "test-tag",
    deniedReason: null,
  };
}

export function deniedAccess(reason = "No SOAR Role is mapped to this collaborator's tag yet."): ResolvedAccess {
  return {
    allowed: false,
    isSuperAdmin: false,
    role: null,
    collaboratorRole: "editor",
    matchedTagValue: null,
    deniedReason: reason,
  };
}

export interface RouteInfo {
  method: string;
  path: string;
}

/**
 * Walks the live Express router stack rather than regex-parsing controller
 * files — this way the route inventory used by authRequired.test.ts can
 * never drift out of sync with what's actually mounted.
 */
export function listRoutes(app: Express): RouteInfo[] {
  const routes: RouteInfo[] = [];

  function walk(stack: any[], prefix: string) {
    for (const layer of stack) {
      if (layer.route) {
        const path = prefix + layer.route.path;
        const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
        for (const method of methods) {
          routes.push({ method: method.toUpperCase(), path });
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        walk(layer.handle.stack, prefix);
      }
    }
  }

  walk((app as any)._router.stack, "");
  return routes;
}
