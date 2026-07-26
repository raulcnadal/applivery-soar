import request from "supertest";
import { describe, expect, it } from "vitest";
import { testApp } from "./harness";

/**
 * Confirms the three secret-in-path/secret-header external receivers work
 * with ZERO dashboard-token involvement — the Phase 9 sign-off checklist's
 * "the two secret-in-path receivers work with zero dashboard-token
 * involvement" item (extended here to all three: device-data report,
 * applivery-webhook receive, triggers fire — same trust model, see
 * middleware/triggerSecret.middleware.ts's doc comment and
 * ARCHITECTURE.md §2.6).
 *
 * None of these requests ever set X-Dashboard-Token. Each is asserted to
 * fail via that receiver's OWN secret-verification path (503 "not
 * configured" or 404 "unknown secret/trigger") — never via
 * verifyDashboardToken's 401 "Missing X-Dashboard-Token" — which is exactly
 * what proves the dashboard-auth layer isn't involved at all on these
 * routes. (authRequired.test.ts already sweeps every route including these
 * three for "not blocked by 401"; this file additionally pins down the
 * *specific* non-401 failure mode each one produces, so a future change
 * that accidentally routes these through verifyDashboardToken would show
 * up as a wrong status code here, not just a passing "not 401".)
 */
describe("secret-in-path/header receivers — no dashboard token involved", () => {
  const app = testApp();

  it("POST /api/device-data/report fails closed (503, no secret configured) without any dashboard token", async () => {
    const res = await request(app)
      .post("/api/device-data/report")
      .set("X-Workspace-Slug", "no-such-workspace")
      .set("X-Device-Report-Secret", "whatever")
      .send({ serialNumber: "ABC123" });
    expect(res.status).toBe(503);
  });

  it("POST /api/applivery-webhook/receive/:secret fails closed (404, unknown secret) without any dashboard token", async () => {
    const res = await request(app).post("/api/applivery-webhook/receive/not-a-real-secret").send({ action: "device_enrolled" });
    expect(res.status).toBe(404);
  });

  it("POST /api/triggers/fire/:triggerId/:secret fails closed (404, unknown trigger) without any dashboard token", async () => {
    const res = await request(app).post("/api/triggers/fire/not-a-real-trigger-id/not-a-real-secret").send({});
    expect(res.status).toBe(404);
  });
});
