import IORedis from "ioredis";
import { env } from "../config/env";

/**
 * Shared Redis connection for BullMQ (queue/backgroundQueue.ts). Only ever
 * constructed if REDIS_URL is actually configured — importing this module
 * does not itself open a connection, since plenty of deployments (a single
 * backend replica, local dev) run background jobs in-process instead (see
 * jobs/backgroundJobs.ts's fallback path) and shouldn't need Redis at all.
 *
 * `maxRetriesPerRequest: null` is BullMQ's own documented requirement for
 * any connection passed to a Queue/Worker — without it, ioredis gives up on
 * blocking commands (which BullMQ relies on) after its default retry count.
 */
let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!env.redisUrl) {
    throw new Error("getRedisConnection() called but REDIS_URL is not configured.");
  }
  if (!connection) {
    connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
