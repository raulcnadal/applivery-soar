import request from "supertest";
import { describe, expect, it } from "vitest";
import type { FeatureArea, FeatureLevel, RiskyAction } from "../middleware/rbac.middleware";
import { authHeaders, deniedAccess, primeAccess, roleWithAccess, superAdminAccess, testApp } from "./harness";

/**
 * Deep RBAC-boundary coverage: for every distinct requirePermission(...)
 * configuration used anywhere in the app (16 distinct area/level/action/
 * superAdminOnly combinations across 13 gated controllers — enumerated by
 * grepping every requirePermission({...}) call site), pick at least one
 * representative route per controller that uses it and verify:
 *   - a role with insufficient access is denied (403)
 *   - a role with sufficient access clears the RBAC gate (not 401/403)
 * This is deliberately about the authorization boundary, not full business
 * correctness — services underneath are backed by the generic permissive
 * Prisma/Applivery mocks from setup.ts, so "cleared the gate" is asserted
 * as "didn't get blocked at 401/403", not "returned a specific 200 body".
 */

interface Case {
  label: string;
  method: "get" | "post" | "put" | "delete";
  path: string;
  area?: FeatureArea;
  level?: FeatureLevel;
  action?: RiskyAction;
  superAdminOnly?: boolean;
  insufficientAccess: ReturnType<typeof roleWithAccess>;
}

let counter = 0;
function nextEmail(): string {
  counter += 1;
  return `rbac-test-${counter}@example.com`;
}

const CASES: Case[] = [
  // ── appLists.controller.ts (reuses compliance:read/manage) ──
  { label: "appLists: GET /api/app-catalog", method: "get", path: "/api/app-catalog", area: "compliance", level: "read", insufficientAccess: roleWithAccess({ compliance: "none" }) },
  { label: "appLists: POST /api/app-catalog", method: "post", path: "/api/app-catalog", area: "compliance", level: "manage", insufficientAccess: roleWithAccess({ compliance: "read" }) },

  // ── devices.controller.ts ──
  { label: "devices: GET /api/devices", method: "get", path: "/api/devices", area: "devices", level: "read", insufficientAccess: roleWithAccess({ devices: "none" }) },
  { label: "devices: PUT /api/devices/:deviceId/segment", method: "put", path: "/api/devices/dev-1/segment", area: "devices", level: "manage", insufficientAccess: roleWithAccess({ devices: "read" }) },

  // ── deviceCatalog.controller.ts (devices:read) ──
  { label: "deviceCatalog: GET /api/policies", method: "get", path: "/api/policies", area: "devices", level: "read", insufficientAccess: roleWithAccess({ devices: "none" }) },

  // ── deviceAudiences.controller.ts ──
  { label: "deviceAudiences: GET /api/device-audiences", method: "get", path: "/api/device-audiences", area: "devices", level: "read", insufficientAccess: roleWithAccess({ devices: "none" }) },
  { label: "deviceAudiences: POST /api/device-audiences", method: "post", path: "/api/device-audiences", area: "devices", level: "manage", insufficientAccess: roleWithAccess({ devices: "read" }) },

  // ── catalogs.controller.ts (reuses compliance:read/manage) ──
  { label: "catalogs: GET /api/os-updates/catalog", method: "get", path: "/api/os-updates/catalog", area: "compliance", level: "read", insufficientAccess: roleWithAccess({ compliance: "none" }) },
  { label: "catalogs: POST /api/os-updates/refresh", method: "post", path: "/api/os-updates/refresh", area: "compliance", level: "manage", insufficientAccess: roleWithAccess({ compliance: "read" }) },

  // ── compliance.controller.ts ──
  { label: "compliance: GET /api/compliance/fields", method: "get", path: "/api/compliance/fields", area: "compliance", level: "read", insufficientAccess: roleWithAccess({ compliance: "none" }) },
  { label: "compliance: POST /api/compliance/policies", method: "post", path: "/api/compliance/policies", area: "compliance", level: "manage", insufficientAccess: roleWithAccess({ compliance: "read" }) },
  { label: "compliance: DELETE /api/compliance/policies/:policyId", method: "delete", path: "/api/compliance/policies/pol-1", area: "compliance", level: "manage", action: "canDeletePolicyOrWorkflow", insufficientAccess: roleWithAccess({ compliance: "manage" }, { canDeletePolicyOrWorkflow: false }) },
  { label: "compliance: POST /api/compliance/violations/bulk-approve", method: "post", path: "/api/compliance/violations/bulk-approve", area: "compliance", level: "manage", action: "canBulkTriage", insufficientAccess: roleWithAccess({ compliance: "manage" }, { canBulkTriage: false }) },

  // ── integrations.controller.ts ──
  { label: "integrations: GET /api/integrations", method: "get", path: "/api/integrations", area: "integrations", level: "read", insufficientAccess: roleWithAccess({ integrations: "none" }) },
  { label: "integrations: POST /api/integrations", method: "post", path: "/api/integrations", area: "integrations", level: "manage", action: "canEditIntegrationSecrets", insufficientAccess: roleWithAccess({ integrations: "manage" }, { canEditIntegrationSecrets: false }) },

  // ── threatIntel.controller.ts (reuses integrations:read/manage) ──
  { label: "threatIntel: GET /api/threat-intel/providers", method: "get", path: "/api/threat-intel/providers", area: "integrations", level: "read", insufficientAccess: roleWithAccess({ integrations: "none" }) },
  { label: "threatIntel: POST /api/threat-intel/providers", method: "post", path: "/api/threat-intel/providers", area: "integrations", level: "manage", action: "canEditIntegrationSecrets", insufficientAccess: roleWithAccess({ integrations: "manage" }, { canEditIntegrationSecrets: false }) },

  // ── workflows.controller.ts ──
  { label: "workflows: GET /api/workflows", method: "get", path: "/api/workflows", area: "workflows", level: "read", insufficientAccess: roleWithAccess({ workflows: "none" }) },
  { label: "workflows: POST /api/workflows", method: "post", path: "/api/workflows", area: "workflows", level: "manage", insufficientAccess: roleWithAccess({ workflows: "read" }) },
  { label: "workflows: DELETE /api/workflows/:workflowId", method: "delete", path: "/api/workflows/wf-1", area: "workflows", level: "manage", action: "canDeletePolicyOrWorkflow", insufficientAccess: roleWithAccess({ workflows: "manage" }, { canDeletePolicyOrWorkflow: false }) },

  // ── firewallRuleSets.controller.ts (reuses workflows:read/manage) ──
  { label: "firewallRuleSets: GET /api/firewall-rulesets", method: "get", path: "/api/firewall-rulesets", area: "workflows", level: "read", insufficientAccess: roleWithAccess({ workflows: "none" }) },
  { label: "firewallRuleSets: POST /api/firewall-rulesets", method: "post", path: "/api/firewall-rulesets", area: "workflows", level: "manage", insufficientAccess: roleWithAccess({ workflows: "read" }) },
  { label: "firewallRuleSets: DELETE /api/firewall-rulesets/:ruleSetId", method: "delete", path: "/api/firewall-rulesets/fw-1", area: "workflows", level: "manage", action: "canDeletePolicyOrWorkflow", insufficientAccess: roleWithAccess({ workflows: "manage" }, { canDeletePolicyOrWorkflow: false }) },

  // ── cases.controller.ts ──
  { label: "cases: GET /api/cases", method: "get", path: "/api/cases", area: "cases", level: "read", insufficientAccess: roleWithAccess({ cases: "none" }) },
  { label: "cases: POST /api/cases", method: "post", path: "/api/cases", area: "cases", level: "manage", insufficientAccess: roleWithAccess({ cases: "read" }) },
  { label: "cases: POST /api/cases/bulk-update", method: "post", path: "/api/cases/bulk-update", area: "cases", level: "manage", action: "canBulkTriage", insufficientAccess: roleWithAccess({ cases: "manage" }, { canBulkTriage: false }) },

  // ── config.controller.ts ──
  { label: "config: POST /api/config/clone-from", method: "post", path: "/api/config/clone-from", area: "settings", level: "manage", action: "canExportOrImportConfig", insufficientAccess: roleWithAccess({ settings: "manage" }, { canExportOrImportConfig: false }) },

  // ── roles.controller.ts (superAdminOnly) ──
  { label: "roles: GET /api/roles (non-super-admin, even with full role)", method: "get", path: "/api/roles", superAdminOnly: true, insufficientAccess: roleWithAccess({ devices: "manage", compliance: "manage", workflows: "manage", cases: "manage", integrations: "manage", settings: "manage" }) },
];

describe("RBAC boundary — insufficient access is denied, sufficient access clears the gate", () => {
  const app = testApp();

  it.each(CASES)("$label", async (c) => {
    // Insufficient access -> 403
    const insufficientEmail = nextEmail();
    primeAccess(c.insufficientAccess, { email: insufficientEmail });
    const deniedRes = await (request(app) as any)[c.method](c.path)
      .set(authHeaders({ email: insufficientEmail }))
      .send({});
    expect(deniedRes.status).toBe(403);

    // Sufficient access (super admin always clears every gate) -> not 401/403
    const sufficientEmail = nextEmail();
    primeAccess(superAdminAccess(), { email: sufficientEmail });
    const allowedRes = await (request(app) as any)[c.method](c.path)
      .set(authHeaders({ email: sufficientEmail }))
      .send({});
    expect(allowedRes.status).not.toBe(401);
    expect(allowedRes.status).not.toBe(403);
  });
});

describe("RBAC boundary — no resolved access at all is denied (fail-closed cache)", () => {
  const app = testApp();

  it("a dashboard token with no prior resolve-access call is denied on a gated route", async () => {
    const email = nextEmail();
    // Deliberately never call primeAccess for this email/workspace pair.
    const res = await request(app).get("/api/devices").set(authHeaders({ email })).send({});
    expect(res.status).toBe(403);
    expect(res.body.detail).toMatch(/not resolved/i);
  });

  it("explicitly denied access (no matching SOAR role tag) is rejected with its own reason", async () => {
    const email = nextEmail();
    primeAccess(deniedAccess(), { email });
    const res = await request(app).get("/api/devices").set(authHeaders({ email })).send({});
    expect(res.status).toBe(403);
  });
});
