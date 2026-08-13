import request from "supertest";
import { describe, expect, it } from "vitest";
import { listRoutes, testApp } from "./harness";

/**
 * Blanket sweep across every mounted route (introspected live off the
 * Express router stack, not regex-parsed from source — see harness.ts) —
 * every route must require X-Dashboard-Token EXCEPT the small, deliberate
 * allowlist below (login/refresh, the secret-in-path receivers, and the
 * Phase 0 health check). This is the cheap, systematic half of the Phase 9
 * RBAC-boundary checklist item ("every gated route has coverage"): it can't
 * catch a wrong area/level, but it WILL catch a route that's missing
 * verifyDashboardToken entirely — the wiring mistake that matters most.
 *
 * Deep area/level boundary behavior (403 at insufficient level, pass-through
 * at sufficient level) is covered per-module in rbacBoundary.test.ts.
 */

const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/auth/login",
  "POST /api/auth/refresh",
  "POST /api/device-data/report",
  "POST /api/device-data/report-apps",
  "GET /api/device-data/custom-checks",
  "GET /api/device-data/agent-status",
  "POST /api/device-data/evaluate-now",
  "POST /api/internal/agent-builds/:platform",
  "GET /api/agent-downloads",
  "GET /api/agent-downloads/:platform",
  "GET /api/agent-downloads/:platform/meta",
  "POST /api/applivery-webhook/receive/:secret",
  "POST /api/triggers/fire/:triggerId/:secret",
  "POST /api/compliance/evaluate-due",
  "POST /api/workflows/resume-due",
]);

function isApiRoute(path: string): boolean {
  return typeof path === "string" && path.startsWith("/api/");
}

describe("every /api/* route requires a dashboard token unless explicitly public", () => {
  const app = testApp();
  const routes = listRoutes(app).filter((r) => isApiRoute(r.path));

  it("discovered a non-trivial number of routes (sanity check the introspection itself works)", () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it.each(routes)("$method $path", async ({ method, path }) => {
    const key = `${method} ${path}`;
    const testPath = path.replace(/:([A-Za-z0-9_]+)/g, "test-$1");
    const req = (request(app) as any)[method.toLowerCase()](testPath);

    const res = await req.set("X-Workspace-Slug", "test-workspace").send({});

    if (PUBLIC_ROUTES.has(key)) {
      expect(res.status).not.toBe(401);
    } else {
      expect(res.status).toBe(401);
    }
  });
});
