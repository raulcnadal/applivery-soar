import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for the Redis/BullMQ-backed job path (queue/backgroundQueue.ts)
 * — the fix for "N replicas = N copies of every job firing." BullMQ/ioredis
 * aren't exercised against a real Redis here (none available in this
 * sandbox); instead Queue/Worker are replaced with lightweight fakes that
 * record what they were called with, and the real processor logic
 * (job lookup by name, run(), heartbeat recording, error rethrow) is
 * exercised directly against those fakes.
 */

interface FakeQueueCall {
  name: string;
  data: unknown;
  opts: Record<string, any>;
}

let queueAddCalls: FakeQueueCall[] = [];
let lastWorkerProcessor: ((job: { name: string }) => Promise<unknown>) | null = null;
let lastWorkerOpts: Record<string, any> | null = null;

vi.mock("bullmq", () => {
  class FakeQueue {
    constructor(public name: string, public opts: Record<string, any>) {}
    async add(name: string, data: unknown, opts: Record<string, any>) {
      queueAddCalls.push({ name, data, opts });
      return { id: name };
    }
    async close() {}
  }
  class FakeWorker {
    constructor(public name: string, processor: (job: { name: string }) => Promise<unknown>, opts: Record<string, any>) {
      lastWorkerProcessor = processor;
      lastWorkerOpts = opts;
    }
    on() {}
    async close() {}
  }
  return { Queue: FakeQueue, Worker: FakeWorker };
});

vi.mock("../queue/connection", () => ({
  getRedisConnection: () => ({}),
  closeRedisConnection: async () => {},
}));

const heartbeatCalls: Array<[string, "ok" | "error", string | null | undefined]> = [];
vi.mock("../services/systemHealth", () => ({
  recordJobHeartbeat: async (jobKey: string, status: "ok" | "error", detail?: string | null) => {
    heartbeatCalls.push([jobKey, status, detail]);
  },
}));

describe("backgroundQueue", () => {
  beforeEach(() => {
    queueAddCalls = [];
    lastWorkerProcessor = null;
    lastWorkerOpts = null;
    heartbeatCalls.length = 0;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("isQueueBackedJobsEnabled() reflects REDIS_URL", async () => {
    process.env.REDIS_URL = "";
    vi.resetModules();
    const mod1 = await import("../queue/backgroundQueue");
    expect(mod1.isQueueBackedJobsEnabled()).toBe(false);

    process.env.REDIS_URL = "redis://localhost:6379";
    vi.resetModules();
    const mod2 = await import("../queue/backgroundQueue");
    expect(mod2.isQueueBackedJobsEnabled()).toBe(true);
  });

  it("registerRepeatableJobs() adds one repeatable job per entry, with the staggered startup delay and a stable jobId", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    vi.resetModules();
    const { registerRepeatableJobs } = await import("../queue/backgroundQueue");

    const jobs = [
      { jobKey: "job-a", tickMs: 1000, run: async () => {} },
      { jobKey: "job-b", tickMs: 2000, run: async () => {} },
    ];
    await registerRepeatableJobs(jobs);

    expect(queueAddCalls).toHaveLength(2);
    expect(queueAddCalls[0].name).toBe("job-a");
    expect(queueAddCalls[0].opts.jobId).toBe("job-a");
    expect(queueAddCalls[0].opts.repeat).toEqual({ every: 1000 });
    expect(queueAddCalls[0].opts.delay).toBe(15_000 * 1); // first job, stagger index 0 -> *1
    expect(queueAddCalls[1].opts.delay).toBe(15_000 * 2);
  });

  it("the Worker processor runs the matching job by name and records an 'ok' heartbeat on success", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    vi.resetModules();
    const { startBackgroundJobWorker } = await import("../queue/backgroundQueue");

    let ran = false;
    const jobs = [{ jobKey: "job-a", tickMs: 1000, run: async () => { ran = true; } }];
    startBackgroundJobWorker(jobs);

    expect(lastWorkerProcessor).not.toBeNull();
    await lastWorkerProcessor!({ name: "job-a" });

    expect(ran).toBe(true);
    expect(heartbeatCalls).toEqual([["job-a", "ok", undefined]]);
  });

  it("the Worker processor records an 'error' heartbeat and rethrows if run() fails", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    vi.resetModules();
    const { startBackgroundJobWorker } = await import("../queue/backgroundQueue");

    const jobs = [{ jobKey: "job-a", tickMs: 1000, run: async () => { throw new Error("boom"); } }];
    startBackgroundJobWorker(jobs);

    await expect(lastWorkerProcessor!({ name: "job-a" })).rejects.toThrow("boom");
    expect(heartbeatCalls).toHaveLength(1);
    expect(heartbeatCalls[0][0]).toBe("job-a");
    expect(heartbeatCalls[0][1]).toBe("error");
    expect(heartbeatCalls[0][2]).toMatch(/boom/);
  });

  it("the Worker processor is a no-op (no heartbeat, no throw) for a job name with no matching entry", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    vi.resetModules();
    const { startBackgroundJobWorker } = await import("../queue/backgroundQueue");

    startBackgroundJobWorker([{ jobKey: "job-a", tickMs: 1000, run: async () => {} }]);
    await lastWorkerProcessor!({ name: "unknown-job" });

    expect(heartbeatCalls).toHaveLength(0);
  });

  it("startBackgroundJobWorker() sets concurrency equal to the number of distinct jobs", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    vi.resetModules();
    const { startBackgroundJobWorker } = await import("../queue/backgroundQueue");

    startBackgroundJobWorker([
      { jobKey: "job-a", tickMs: 1000, run: async () => {} },
      { jobKey: "job-b", tickMs: 1000, run: async () => {} },
      { jobKey: "job-c", tickMs: 1000, run: async () => {} },
    ]);

    expect(lastWorkerOpts?.concurrency).toBe(3);
  });
});
