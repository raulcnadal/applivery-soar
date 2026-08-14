import { describe, expect, it } from "vitest";
import { JOBS } from "../jobs/backgroundJobs";
import { runComplianceSchedulerTick } from "../modules/compliance/complianceJobs";
import { runInstalledAppsRefresherTick } from "../modules/appLists/installedAppsJobs";
import { runLocationRefresherTick } from "../modules/geofencing/locationJobs";

// The full 17 loops from migration-plan.md §5, plus three disclosed
// post-migration additions: the geofencing location refresher
// (locationJobs.ts), the Apple hardware-identifier resolver
// (appleDeviceIdentifiers.ts), and event-driven detection's notify metrics
// rotation (eventWatches.service.ts) — this list is the sign-off artifact
// itself, not just a test fixture: if a jobKey here doesn't appear in JOBS,
// that loop either was never wired in or got silently dropped.
const EXPECTED_JOB_KEYS = [
  "compliance_scheduler",
  "report_scheduler",
  "snapshot_scheduler",
  "installed_apps_refresher",
  "location_refresher",
  "workflow_wait_resumer",
  "audit_log_rotation",
  "log_export_scheduler",
  "script_log_reconciler",
  "ticket_status_sync",
  "case_sla_monitor",
  "catalog:os-update",
  "catalog:vuln",
  "vuln_service_refresh",
  "catalog:os-lifecycle",
  "catalog:gdmf",
  "catalog:apple-device-identifiers",
  "catalog:mitre",
  "system_health_monitor",
  "event_notify_metrics_rotation",
];

describe("all 17 background jobs from migration-plan.md §5 (+3 disclosed additions) are registered", () => {
  it("JOBS has exactly 20 entries", () => {
    expect(JOBS.length).toBe(20);
  });

  it("every expected jobKey is present exactly once", () => {
    const keys = JOBS.map((j) => j.jobKey);
    expect(new Set(keys).size).toBe(keys.length); // no duplicates
    for (const expected of EXPECTED_JOB_KEYS) {
      expect(keys).toContain(expected);
    }
  });
});

/**
 * Sanity-checks the two Phase 9 background jobs (Compliance scheduler,
 * Installed apps refresher — the last two of the full 17 in
 * migration-plan.md §5, previously deferred per jobs/backgroundJobs.ts's
 * own module doc comment) run cleanly end-to-end against the generic
 * permissive Prisma/Applivery mocks with an empty workspace set — i.e.
 * "zero workspaces configured" is a true no-op, not a thrown error, which
 * is what jobs/backgroundJobs.ts's runJobOnce() depends on to record an
 * "ok" heartbeat instead of "error" on a freshly-deployed instance with no
 * data yet.
 */
describe("Phase 9 background jobs — no-op cleanly with no data", () => {
  it("runComplianceSchedulerTick resolves without throwing", async () => {
    await expect(runComplianceSchedulerTick()).resolves.toBeUndefined();
  });

  it("runInstalledAppsRefresherTick resolves without throwing", async () => {
    await expect(runInstalledAppsRefresherTick()).resolves.toBeUndefined();
  });

  it("runLocationRefresherTick resolves without throwing", async () => {
    await expect(runLocationRefresherTick()).resolves.toBeUndefined();
  });
});
