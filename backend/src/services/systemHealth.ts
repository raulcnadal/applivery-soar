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
    const now = new Date();
    // consecutiveErrors is what checkSystemHealthAndAlert (systemHealth.service.ts)
    // actually alerts on (3+ in a row fires a real email/chat/paging alert) --
    // this Node port had dropped the field entirely (only ever writing
    // status/detail), so it silently stayed 0 forever regardless of how many
    // times a job failed in a row. That left "the process died/stopped
    // ticking entirely" (the separate `overdue` check) as the only condition
    // that could ever fire a proactive alert -- a job that kept ticking on
    // schedule but failed every single time (e.g. an expired Automation
    // Credential blocking every workspace's policy evaluation) would report
    // "error" in the Settings > System Health table forever with nobody ever
    // notified. Restored to match the original's _record_job_heartbeat
    // (main.py:17682): "ok" resets the streak and stamps lastSuccessAt;
    // "error" increments it and stamps lastErrorAt.
    if (status === "ok") {
      await prisma.systemHealthJob.upsert({
        where: { jobKey },
        create: { jobKey, status, detail: detail ?? null, lastSuccessAt: now, consecutiveErrors: 0 },
        update: { status, detail: detail ?? null, lastHeartbeatAt: now, lastSuccessAt: now, consecutiveErrors: 0 },
      });
    } else {
      await prisma.systemHealthJob.upsert({
        where: { jobKey },
        create: { jobKey, status, detail: detail ?? null, lastErrorAt: now, consecutiveErrors: 1 },
        update: { status, detail: detail ?? null, lastHeartbeatAt: now, lastErrorAt: now, consecutiveErrors: { increment: 1 } },
      });
    }
  } catch (e) {
    console.warn(`[SystemHealth] Failed to record heartbeat for ${jobKey}: ${e}`);
  }
}
