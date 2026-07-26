import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * verifyTriggerSecret gates the two new external-cron-triggerable endpoints
 * (POST /api/compliance/evaluate-due, POST /api/workflows/resume-due —
 * Phase 9). Tested at the middleware-function level with a controlled
 * TRIGGER_SECRET rather than through the shared app/supertest harness,
 * because env.ts reads process.env once at import time into a plain
 * object — by the time any other test file's shared `testApp()` is built,
 * config/env has already been evaluated with TRIGGER_SECRET unset. This
 * file never statically imports harness.ts/app.ts, so its own fresh
 * per-file module registry (vitest's default `isolate: true`) lets it set
 * TRIGGER_SECRET *before* config/env is evaluated for the first time here.
 */

function fakeReqRes(headerValue: string | undefined) {
  const req: any = { header: (name: string) => (name === "X-Trigger-Secret" ? headerValue : undefined) };
  let statusCode = 200;
  let jsonBody: unknown;
  const res: any = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (body: unknown) => {
      jsonBody = body;
      return res;
    },
  };
  return { req, res, getStatus: () => statusCode, getBody: () => jsonBody };
}

describe("verifyTriggerSecret — TRIGGER_SECRET not configured", () => {
  it("fails closed with 503 regardless of what's provided", async () => {
    vi.resetModules();
    process.env.TRIGGER_SECRET = "";
    const { verifyTriggerSecret } = await import("../middleware/triggerSecret.middleware");

    const ctx = fakeReqRes("anything");
    let calledNext = false;
    verifyTriggerSecret(ctx.req, ctx.res, () => {
      calledNext = true;
    });
    expect(calledNext).toBe(false);
    expect(ctx.getStatus()).toBe(503);
  });
});

describe("verifyTriggerSecret — TRIGGER_SECRET configured", () => {
  const SECRET = "test-trigger-secret-value";
  let verifyTriggerSecret: (req: any, res: any, next: () => void) => void;

  beforeAll(async () => {
    vi.resetModules();
    process.env.TRIGGER_SECRET = SECRET;
    ({ verifyTriggerSecret } = await import("../middleware/triggerSecret.middleware"));
  });

  it("rejects a missing header with 401", () => {
    const ctx = fakeReqRes(undefined);
    let calledNext = false;
    verifyTriggerSecret(ctx.req, ctx.res, () => {
      calledNext = true;
    });
    expect(calledNext).toBe(false);
    expect(ctx.getStatus()).toBe(401);
  });

  it("rejects a wrong secret with 401", () => {
    const ctx = fakeReqRes("wrong-secret");
    let calledNext = false;
    verifyTriggerSecret(ctx.req, ctx.res, () => {
      calledNext = true;
    });
    expect(calledNext).toBe(false);
    expect(ctx.getStatus()).toBe(401);
  });

  it("clears the gate with the correct secret", () => {
    const ctx = fakeReqRes(SECRET);
    let calledNext = false;
    verifyTriggerSecret(ctx.req, ctx.res, () => {
      calledNext = true;
    });
    expect(calledNext).toBe(true);
  });
});
