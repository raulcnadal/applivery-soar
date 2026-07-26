import { Queue, Worker, type Job } from "bullmq";
import { env } from "../config/env";
import { recordJobHeartbeat } from "../services/systemHealth";
import { getRedisConnection } from "./connection";

/**
 * Redis/BullMQ-backed replacement for backgroundJobs.ts's plain
 * `setInterval` loops — only active when REDIS_URL is configured (see
 * env.ts's doc comment). The point: with more than one backend replica
 * (needed once this app is scaled out for a large device fleet), N
 * in-process `setInterval` loops means N copies of every job firing on
 * every tick — the compliance evaluator, workflow resumer, ticket sync,
 * etc. would all double/triple/N-tuple-fire. A shared Redis-backed queue
 * with one Worker per replica gives BullMQ's own Redis-lock-based job
 * distribution instead: every replica's Worker listens on the same queue,
 * but each job instance is claimed and processed by exactly one of them.
 *
 * Design, deliberately minimal:
 *   - ONE queue ("soar-background-jobs"), not one queue per job — 17 small
 *     recurring jobs don't need 17 separate Redis-backed queues.
 *   - Each job in jobs/backgroundJobs.ts's JOBS array becomes one BullMQ
 *     *repeatable* job, named by its own jobKey, with a fixed jobId equal to
 *     that jobKey — so calling registerRepeatableJobs() again (e.g. every
 *     replica doing it at its own boot) is idempotent: BullMQ dedupes
 *     repeatable-job registration by jobId, it does not create duplicates.
 *   - ONE Worker per replica, processing whichever job instance Redis hands
 *     it next; the processor looks the job up by name in a Map and calls
 *     its own `run()`, then records the exact same heartbeat
 *     (recordJobHeartbeat) the in-process fallback path already used, so
 *     Settings > System Health looks identical either way.
 */

export const QUEUE_NAME = "soar-background-jobs";

export interface QueueableJob {
  jobKey: string;
  tickMs: number;
  run: () => Promise<unknown>;
}

export function isQueueBackedJobsEnabled(): boolean {
  return Boolean(env.redisUrl);
}

let queue: Queue | null = null;
let worker: Worker | null = null;

function getQueue(): Queue {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: getRedisConnection() });
  return queue;
}

// Same stagger reasoning as the in-process fallback: don't fire every job's
// first execution in the same instant on a cold boot/deploy.
const STARTUP_STAGGER_MS = 15_000;

/** Registers (or re-registers, idempotently) every job as a BullMQ repeatable job. Safe to call from every replica at its own boot. */
export async function registerRepeatableJobs(jobs: readonly QueueableJob[]): Promise<void> {
  const q = getQueue();
  await Promise.all(
    jobs.map((job, index) =>
      q.add(
        job.jobKey,
        {},
        {
          jobId: job.jobKey,
          repeat: { every: job.tickMs },
          delay: STARTUP_STAGGER_MS * (index + 1),
          removeOnComplete: { count: 20 },
          removeOnFail: { count: 50 },
        },
      ),
    ),
  );
}

/** Starts this replica's Worker. Every replica calling this is exactly the point — BullMQ's Redis locking ensures only one of them processes any given job instance. */
export function startBackgroundJobWorker(jobs: readonly QueueableJob[]): Worker {
  const byKey = new Map(jobs.map((j) => [j.jobKey, j]));
  worker = new Worker(
    QUEUE_NAME,
    async (bullJob: Job) => {
      const job = byKey.get(bullJob.name);
      if (!job) {
        console.warn(`[BackgroundQueue] Received a job named "${bullJob.name}" with no matching entry in JOBS — skipping.`);
        return;
      }
      try {
        await job.run();
        await recordJobHeartbeat(job.jobKey, "ok");
      } catch (e) {
        console.warn(`[BackgroundQueue] ${job.jobKey} failed: ${e}`);
        await recordJobHeartbeat(job.jobKey, "error", String(e).slice(0, 300));
        // Re-throw so BullMQ's own retry/failure bookkeeping (Job#attemptsMade,
        // the failed set) reflects it too — heartbeat above is what Settings >
        // System Health actually reads, this is just for BullMQ's own state.
        throw e;
      }
    },
    { connection: getRedisConnection(), concurrency: jobs.length },
  );
  worker.on("error", (e) => console.warn(`[BackgroundQueue] Worker error: ${e}`));
  return worker;
}

/** For graceful shutdown / tests. */
export async function stopBackgroundJobQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
