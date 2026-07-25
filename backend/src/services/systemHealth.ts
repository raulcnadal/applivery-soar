import { prisma } from "./prisma";

/**
 * Job heartbeat registry — port of `_record_job_heartbeat` (main.py:17682).
 * Every background refresher records success/failure here at the end of
 * each tick, so a silent process-wide death is visible (Settings > System
 * Health, full view built in Phase 6) instead of just stale data nobody
 * notices. Failure to write is swallowed — health tracking must never be
 * the thing that takes down a request.
 */
export async function recordJobHeartbeat(jobKey: string, status: "ok" | "error", detail?: string | null): Promise<void> {
  try {
    await prisma.systemHealthJob.upsert({
      where: { jobKey },
      create: { jobKey, status, detail: detail ?? null },
      update: { status, detail: detail ?? null, lastHeartbeatAt: new Date() },
    });
  } catch (e) {
    console.warn(`[SystemHealth] Failed to record heartbeat for ${jobKey}: ${e}`);
  }
}
