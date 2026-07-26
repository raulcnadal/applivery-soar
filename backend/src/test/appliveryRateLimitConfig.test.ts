import { describe, expect, it } from "vitest";
import { env } from "../config/env";

/**
 * Regression test for the scale/rate-limit fix: services/appliveryClient.ts
 * derives its outbound TokenBucket's sustained refill rate from
 * env.appliveryRateLimitPerHour / 3600 — this pins the *default* value to
 * Applivery's own documented ceiling (docs.applivery.com's platform
 * overview: "10,000 requests per hour with burst capability"), so a future
 * edit can't silently drift back to the old hardcoded (50, 10) — which
 * refilled at 10/sec = 36,000/hour, ~3.6x over the real published limit.
 *
 * See tokenBucket.test.ts for the TokenBucket class's own math (capacity
 * cap, sustained-rate ceiling over a full simulated hour) — this file only
 * pins the *configuration* that feeds it.
 */
describe("Applivery outbound rate-limit configuration", () => {
  it("defaults to Applivery's documented 10,000 requests/hour ceiling", () => {
    expect(env.appliveryRateLimitPerHour).toBe(10_000);
  });

  it("derives a sustained per-second rate that matches the documented ceiling exactly", () => {
    const sustainedPerSec = env.appliveryRateLimitPerHour / 3600;
    expect(sustainedPerSec).toBeCloseTo(2.7778, 3);
    // The bug this fixes: the old hardcoded refill was 10/sec (36,000/hour).
    expect(sustainedPerSec).toBeLessThan(10);
  });

  it("has a sane, non-zero burst allowance distinct from the sustained rate", () => {
    expect(env.appliveryRateLimitBurst).toBeGreaterThan(0);
    expect(env.appliveryRateLimitBurst).toBeLessThan(env.appliveryRateLimitPerHour);
  });
});
