/**
 * In-process reentrancy guard, shared by both background-job runners
 * (backgroundJobs.ts's plain setInterval fallback and backgroundQueue.ts's
 * BullMQ worker).
 *
 * Neither runner previously waited for a job's PREVIOUS tick to finish
 * before starting its next one: `setInterval(() => void runJobOnce(job),
 * job.tickMs)` fires unconditionally on schedule, and the BullMQ worker is
 * started with `concurrency: jobs.length` specifically so all ~18 distinct
 * job types can run side-by-side — which also means two instances of the
 * SAME job name can be picked up and processed at once if the first is
 * still in flight when the next repeatable instance is enqueued/claimed.
 *
 * For most of the 18 jobs this is harmless (each tick is idempotent or
 * cheap). For a few it is not: `compliance_scheduler`
 * (complianceJobs.ts) stamps every evaluated policy's `lastEvaluatedAt`
 * only once the ENTIRE pass finishes (compliance.service.ts's
 * runComplianceEvaluation, last line) — so if one pass runs long enough
 * (a large fleet, a slow Applivery response) to still be in flight when the
 * next 60s tick fires, the next tick sees the same policies as still "due"
 * and evaluates them again concurrently, which can double-fire an autoRun
 * workflow (including a destructive one) against the same violation before
 * the first pass's autoRunBatchCap has even been persisted. This directly
 * undermines the same "policy evaluation and workflow triggering happens
 * properly in the background" guarantee already hardened once this
 * migration (see complianceJobs.ts / durableEngine.ts's blocked-workspace
 * reporting) — a duplicate run isn't a *missed* run, so it wouldn't have
 * shown up in that pass's alerting at all.
 *
 * `workflow_wait_resumer` (durableEngine.ts's resumeDueWorkflowSteps) is
 * separately protected at the SQL level (`FOR UPDATE SKIP LOCKED`), so this
 * guard is redundant-but-harmless for it. It's applied to every job
 * uniformly rather than special-cased to just `compliance_scheduler`,
 * since "a job's own tick overlapping itself" is never a desirable
 * outcome for any of the 18, and a future job author shouldn't have to
 * remember to add this individually.
 */
const runningJobKeys = new Set<string>();

/** Returns true and marks the job as running if it wasn't already; false (does nothing) if a previous tick is still in flight. */
export function tryAcquireJobSlot(jobKey: string): boolean {
  if (runningJobKeys.has(jobKey)) return false;
  runningJobKeys.add(jobKey);
  return true;
}

export function releaseJobSlot(jobKey: string): void {
  runningJobKeys.delete(jobKey);
}
