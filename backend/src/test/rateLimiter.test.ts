import { describe, expect, it, vi } from "vitest";

/**
 * Tests the real fixed-window limiter logic directly against its exported
 * per-tier functions — not through the full app/supertest — for two
 * reasons: (1) setup.ts globally no-ops rateLimiterMiddleware for every
 * other test file, since its buckets are process-lifetime singletons keyed
 * by req.ip and supertest's ephemeral server makes every request look like
 * the same client, which would make unrelated RBAC tests flaky; (2)
 * hitting the real limit 300/120/10 times through full Express + Supertest
 * per test would be slow. `vi.importActual` bypasses setup.ts's mock for
 * just this file so the three tiers (main.py's documented thresholds,
 * mirrored in rateLimiter.middleware.ts's header comment: 10 req/60s login,
 * 120 req/60s secret-in-path receivers, 300 req/60s default) are verified
 * against the real counting/window/429/Retry-After logic.
 */
async function loadReal() {
  return vi.importActual<typeof import("../middleware/rateLimiter.middleware")>("../middleware/rateLimiter.middleware");
}

function fakeReqRes(ip: string, path: string) {
  const req: any = { ip, path };
  let statusCode = 200;
  let jsonBody: unknown;
  const headers: Record<string, string> = {};
  const res: any = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (body: unknown) => {
      jsonBody = body;
      return res;
    },
  };
  return { req, res, headers, getStatus: () => statusCode, getBody: () => jsonBody };
}

describe("rate limiter — real fixed-window tiers", () => {
  it("login tier allows 10 requests then 429s the 11th, with a Retry-After header", async () => {
    const { loginRateLimiter } = await loadReal();
    const ip = "1.1.1.1";
    let allowed = 0;
    let lastBlocked: ReturnType<typeof fakeReqRes> | null = null;

    for (let i = 0; i < 11; i++) {
      const ctx = fakeReqRes(ip, "/api/auth/login");
      let calledNext = false;
      loginRateLimiter(ctx.req, ctx.res, () => {
        calledNext = true;
      });
      if (calledNext) allowed++;
      else lastBlocked = ctx;
    }

    expect(allowed).toBe(10);
    expect(lastBlocked).not.toBeNull();
    expect(lastBlocked!.getStatus()).toBe(429);
    expect(lastBlocked!.headers["Retry-After"]).toBeDefined();
  });

  it("secret-path tier allows 120 requests then 429s the 121st", async () => {
    const { secretPathRateLimiter } = await loadReal();
    const ip = "2.2.2.2";
    let allowed = 0;
    let blocked = 0;

    for (let i = 0; i < 121; i++) {
      const ctx = fakeReqRes(ip, "/api/triggers/fire/t1/secret");
      let calledNext = false;
      secretPathRateLimiter(ctx.req, ctx.res, () => {
        calledNext = true;
      });
      if (calledNext) allowed++;
      else blocked++;
    }

    expect(allowed).toBe(120);
    expect(blocked).toBe(1);
  });

  it("default API tier allows 300 requests then 429s the 301st", async () => {
    const { defaultApiRateLimiter } = await loadReal();
    const ip = "3.3.3.3";
    let allowed = 0;
    let blocked = 0;

    for (let i = 0; i < 301; i++) {
      const ctx = fakeReqRes(ip, "/api/devices");
      let calledNext = false;
      defaultApiRateLimiter(ctx.req, ctx.res, () => {
        calledNext = true;
      });
      if (calledNext) allowed++;
      else blocked++;
    }

    expect(allowed).toBe(300);
    expect(blocked).toBe(1);
  });

  it("buckets are keyed per-IP — a different client on the same tier is unaffected", async () => {
    const { loginRateLimiter } = await loadReal();
    const exhausted = "4.4.4.4";
    for (let i = 0; i < 10; i++) {
      const ctx = fakeReqRes(exhausted, "/api/auth/login");
      loginRateLimiter(ctx.req, ctx.res, () => {});
    }
    const blockedCtx = fakeReqRes(exhausted, "/api/auth/login");
    let blockedNext = false;
    loginRateLimiter(blockedCtx.req, blockedCtx.res, () => {
      blockedNext = true;
    });
    expect(blockedNext).toBe(false);

    const otherCtx = fakeReqRes("5.5.5.5", "/api/auth/login");
    let otherNext = false;
    loginRateLimiter(otherCtx.req, otherCtx.res, () => {
      otherNext = true;
    });
    expect(otherNext).toBe(true);
  });

  it("dispatcher routes by path prefix to the correct tier", async () => {
    const real = await loadReal();
    const dispatcher = real.rateLimiterMiddleware;

    // Exhaust the login tier via the dispatcher itself, using its own path check.
    const ip = "6.6.6.6";
    for (let i = 0; i < 10; i++) {
      const ctx = fakeReqRes(ip, "/api/auth/login");
      dispatcher(ctx.req, ctx.res, () => {});
    }
    const loginBlocked = fakeReqRes(ip, "/api/auth/login");
    let loginNext = false;
    dispatcher(loginBlocked.req, loginBlocked.res, () => {
      loginNext = true;
    });
    expect(loginNext).toBe(false);
    expect(loginBlocked.getStatus()).toBe(429);

    // The same IP hitting a *different* tier (default) is completely unaffected
    // by the login tier being exhausted — tiers are independent buckets.
    const otherTier = fakeReqRes(ip, "/api/devices");
    let otherTierNext = false;
    dispatcher(otherTier.req, otherTier.res, () => {
      otherTierNext = true;
    });
    expect(otherTierNext).toBe(true);

    // Non-/api/ paths (frontend static/catch-all) bypass rate limiting entirely.
    const staticCtx = fakeReqRes(ip, "/index.html");
    let staticNext = false;
    dispatcher(staticCtx.req, staticCtx.res, () => {
      staticNext = true;
    });
    expect(staticNext).toBe(true);
  });
});
