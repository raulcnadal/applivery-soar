import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenBucket } from "../utils/tokenBucket";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows a burst up to capacity, then denies until refilled", async () => {
    const bucket = new TokenBucket(100, 2); // 100 burst, 2 tokens/sec sustained

    for (let i = 0; i < 100; i++) {
      expect(await bucket.consume()).toBe(true);
    }
    expect(await bucket.consume()).toBe(false); // drained

    vi.setSystemTime(10_000); // +10s -> +20 tokens
    for (let i = 0; i < 20; i++) {
      expect(await bucket.consume()).toBe(true);
    }
    expect(await bucket.consume()).toBe(false);
  });

  it("never refills past capacity even after a long idle period", async () => {
    const bucket = new TokenBucket(50, 10);
    vi.setSystemTime(3_600_000); // +1h idle, would be 36,000 tokens uncapped
    let allowed = 0;
    for (let i = 0; i < 200; i++) {
      if (await bucket.consume()) allowed++;
    }
    expect(allowed).toBe(50); // capped at capacity, not unbounded
  });

  it("sustained throughput over a full simulated hour never exceeds capacity + refillRate*3600", async () => {
    const capacity = 100;
    const refillPerSec = 2.7778; // ~10,000/hour, matching env.appliveryRateLimitPerHour default
    const bucket = new TokenBucket(capacity, refillPerSec);

    let consumed = 0;
    let elapsedMs = 0;
    // Hammer it once per simulated second for a full hour — far more
    // attempts than the budget allows, to prove the bucket itself (not
    // caller discipline) is what enforces the ceiling.
    for (let second = 0; second < 3600; second++) {
      elapsedMs = second * 1000;
      vi.setSystemTime(elapsedMs);
      // Try to consume several tokens per second (bursty caller behavior).
      for (let attempt = 0; attempt < 5; attempt++) {
        if (await bucket.consume()) consumed++;
      }
    }

    const theoreticalMax = capacity + refillPerSec * 3600;
    expect(consumed).toBeLessThanOrEqual(Math.ceil(theoreticalMax));
    // And it should be close to (not far under) that ceiling — proving the
    // bucket actually delivers the documented sustained rate, not an overly
    // conservative one.
    expect(consumed).toBeGreaterThan(theoreticalMax * 0.9);
  });
});
