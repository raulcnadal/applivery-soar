import { recordJobHeartbeat } from "../services/systemHealth";
import { refreshOsUpdateCatalog, OS_UPDATE_TICK_MS } from "../modules/catalogs/osUpdateCatalog";
import { refreshVulnCatalog, VULN_CATALOG_TICK_MS } from "../modules/catalogs/vulnCatalog";
import { refreshOsLifecycleCatalog, OS_LIFECYCLE_TICK_MS } from "../modules/catalogs/osLifecycleCatalog";
import { refreshGdmfCatalog, GDMF_TICK_MS } from "../modules/catalogs/gdmfCatalog";
import { refreshAppleDeviceIdentifiers, APPLE_DEVICE_IDENTIFIERS_TICK_MS } from "../modules/catalogs/appleDeviceIdentifiers";
import { refreshMitreCatalog, MITRE_CATALOG_TICK_MS } from "../modules/catalogs/mitreCatalog";
import { runVulnServiceRefresherTick, VULN_SERVICE_TICK_MS } from "../modules/catalogs/vulnService";
import { runMispRefresherTick, MISP_TICK_MS } from "../modules/catalogs/mispService";
import { runVulncheckRefresherTick, VULNCHECK_TICK_MS } from "../modules/catalogs/vulncheckService";
import { runBinaryIntegrityRefresherTick, BINARY_INTEGRITY_TICK_MS } from "../modules/catalogs/binaryIntegrityService";
import { resumeDueWorkflowSteps } from "../modules/workflows/durableEngine";
import { runScriptLogReconcilerTick, SCRIPT_RUN_RECONCILE_TICK_MS } from "../modules/workflows/scriptLogReconciler";
import { CASE_SLA_MONITOR_TICK_MS, runCaseSlaMonitorTick, runTicketStatusSyncTick, TICKET_SYNC_TICK_MS } from "../modules/cases/caseJobs";
import { rotateAuditLogsForAllWorkspaces } from "../modules/auditLogs/auditLogs.service";
import { runLogExportSchedulerTick } from "../modules/settings/logExportDestinations.service";
import { checkSystemHealthAndAlert } from "../modules/systemHealth/systemHealth.service";
import { runReportSchedulerTick, runSnapshotSchedulerTick, REPORT_SCHEDULER_TICK_MS, SNAPSHOT_SCHEDULER_TICK_MS } from "../modules/analytics/analyticsJobs";
import { runComplianceSchedulerTick, COMPLIANCE_SCHEDULER_TICK_MS } from "../modules/compliance/complianceJobs";
import { runInstalledAppsRefresherTick, INSTALLED_APPS_REFRESH_TICK_MS } from "../modules/appLists/installedAppsJobs";
import { runLocationRefresherTick, LOCATION_REFRESH_TICK_MS } from "../modules/geofencing/locationJobs";
import { rotateEventNotifyMetrics } from "../modules/compliance/eventWatches.service";
import { isQueueBackedJobsEnabled, registerRepeatableJobs, startBackgroundJobWorker, stopBackgroundJobQueue } from "../queue/backgroundQueue";
import { releaseJobSlot, tryAcquireJobSlot } from "./jobReentrancyGuard";

/**
 * Background scheduler for the five GLOBAL intelligence catalogs (no
 * per-workspace credentials needed — all public reference data), plus the
 * two Phase 4b durable-workflow-engine loops (per-workspace, now that
 * Automation Credentials exist — settings/automationCredential.service.ts).
 * Each is a plain `setInterval` loop that runs once shortly after boot, then
 * on its own cadence, recording an OK/error heartbeat every tick so a silent
 * failure surfaces later in Settings > System Health (Phase 6).
 *
 * Phase 6 adds: audit log rotation, log export scheduler (batch s3/nfs/sftp
 * shipment — real-time syslog/webhook fires inline from services/auditLog.ts
 * instead), system health alert monitor, and the Vulnerability Service
 * per-workspace refresher (now that Automation Credentials exist to drive
 * it unattended).
 *
 * Phase 7 adds: the daily analytics snapshot capture (every automation
 * workspace, port of snapshot_scheduler_loop) and the scheduled-report
 * delivery tick (port of report_scheduler_loop) — both now that the widget
 * engine and Puppeteer PDF pipeline exist to drive them unattended.
 *
 * Phase 9 adds the last two of the full 17 (migration-plan.md §5): the
 * Compliance scheduler and the Installed-apps rolling refresher — both were
 * previously deferred pending Automation Credentials (Phase 4b), which now
 * exist, so both are wired in for real below (complianceJobs.ts,
 * installedAppsJobs.ts). Their manual/on-demand equivalents (using the
 * calling admin's live session) were already wired through their respective
 * controllers since Phase 3.
 *
 * Post-migration addition (18th job, not in the original §5 list): the
 * geofencing location refresher (locationJobs.ts) — same budgeted,
 * oldest-synced-first rotation shape as the Installed-apps refresher, added
 * alongside the Geofencing feature (geofencing module) to keep device
 * location fresh enough for geofenceZoneId Compliance conditions without
 * exceeding Applivery's API budget at large fleet sizes. See
 * locationsRefresh.service.ts's doc comment for the full design rationale.
 *
 * Post-migration addition (19th job): the Apple hardware-identifier
 * resolver (appleDeviceIdentifiers.ts) — a weekly fetch of api.ipsw.me's
 * free marketing-name → hardware-identifier feed, so GDMF's SupportedDevices
 * matching (osLifecycleCatalog.ts's "Hardware match" field) can resolve real
 * iPhone/iPad identifiers instead of always falling back to a fleet-wide
 * comparison.
 *
 * Post-migration addition (20th job): event-driven detection's notify
 * metrics rotation (eventWatches.service.ts's rotateEventNotifyMetrics) —
 * daily cleanup of EventNotifyMetric rows past their fixed 30-day retention,
 * same cadence as audit_log_rotation but its own job since this table has
 * no per-workspace configurable retention the way AuditLog does.
 *
 * Post-migration scale review: with REDIS_URL configured, every job below
 * instead runs as a BullMQ repeatable job (queue/backgroundQueue.ts) so
 * exactly one instance of each job runs cluster-wide even with multiple
 * backend replicas — N plain setInterval loops across N replicas would each
 * fire independently, double/triple/N-tuple-firing the compliance
 * evaluator, workflow resumer, ticket sync, etc. Without REDIS_URL (the
 * default — a single-replica deployment needs no extra infrastructure),
 * this falls back to the original in-process setInterval behavior
 * unchanged.
 */

interface CatalogJob {
  jobKey: string;
  tickMs: number;
  run: () => Promise<unknown>;
}

const WORKFLOW_RESUMER_TICK_MS = 30_000;
const AUDIT_LOG_ROTATION_TICK_MS = 86_400_000; // once a day
const LOG_EXPORT_SCHEDULER_TICK_MS = 86_400_000; // once a day
const SYSTEM_HEALTH_MONITOR_TICK_MS = 300_000; // 5 minutes

// Exported read-only for backgroundJobs.test.ts's structural sign-off check
// (all 17 loops from migration-plan.md §5 present, unique jobKeys) — not
// meant to be mutated by callers.
export const JOBS: readonly CatalogJob[] = [
  { jobKey: "catalog:os-update", tickMs: OS_UPDATE_TICK_MS, run: refreshOsUpdateCatalog },
  { jobKey: "catalog:vuln", tickMs: VULN_CATALOG_TICK_MS, run: refreshVulnCatalog },
  { jobKey: "catalog:os-lifecycle", tickMs: OS_LIFECYCLE_TICK_MS, run: refreshOsLifecycleCatalog },
  { jobKey: "catalog:gdmf", tickMs: GDMF_TICK_MS, run: refreshGdmfCatalog },
  { jobKey: "catalog:apple-device-identifiers", tickMs: APPLE_DEVICE_IDENTIFIERS_TICK_MS, run: refreshAppleDeviceIdentifiers },
  { jobKey: "catalog:mitre", tickMs: MITRE_CATALOG_TICK_MS, run: refreshMitreCatalog },
  { jobKey: "workflow_wait_resumer", tickMs: WORKFLOW_RESUMER_TICK_MS, run: () => resumeDueWorkflowSteps() },
  { jobKey: "script_log_reconciler", tickMs: SCRIPT_RUN_RECONCILE_TICK_MS, run: runScriptLogReconcilerTick },
  { jobKey: "ticket_status_sync", tickMs: TICKET_SYNC_TICK_MS, run: runTicketStatusSyncTick },
  { jobKey: "case_sla_monitor", tickMs: CASE_SLA_MONITOR_TICK_MS, run: runCaseSlaMonitorTick },
  { jobKey: "audit_log_rotation", tickMs: AUDIT_LOG_ROTATION_TICK_MS, run: rotateAuditLogsForAllWorkspaces },
  { jobKey: "log_export_scheduler", tickMs: LOG_EXPORT_SCHEDULER_TICK_MS, run: runLogExportSchedulerTick },
  { jobKey: "system_health_monitor", tickMs: SYSTEM_HEALTH_MONITOR_TICK_MS, run: checkSystemHealthAndAlert },
  { jobKey: "vuln_service_refresh", tickMs: VULN_SERVICE_TICK_MS, run: runVulnServiceRefresherTick },
  { jobKey: "misp_refresh", tickMs: MISP_TICK_MS, run: runMispRefresherTick },
  { jobKey: "vulncheck_refresh", tickMs: VULNCHECK_TICK_MS, run: runVulncheckRefresherTick },
  { jobKey: "binary_integrity_refresh", tickMs: BINARY_INTEGRITY_TICK_MS, run: runBinaryIntegrityRefresherTick },
  { jobKey: "snapshot_scheduler", tickMs: SNAPSHOT_SCHEDULER_TICK_MS, run: runSnapshotSchedulerTick },
  { jobKey: "report_scheduler", tickMs: REPORT_SCHEDULER_TICK_MS, run: runReportSchedulerTick },
  { jobKey: "compliance_scheduler", tickMs: COMPLIANCE_SCHEDULER_TICK_MS, run: runComplianceSchedulerTick },
  { jobKey: "installed_apps_refresher", tickMs: INSTALLED_APPS_REFRESH_TICK_MS, run: runInstalledAppsRefresherTick },
  { jobKey: "location_refresher", tickMs: LOCATION_REFRESH_TICK_MS, run: runLocationRefresherTick },
  { jobKey: "event_notify_metrics_rotation", tickMs: AUDIT_LOG_ROTATION_TICK_MS, run: rotateEventNotifyMetrics },
];

// Stagger initial runs so five outbound HTTP calls don't fire in the same
// instant on every cold boot.
const STARTUP_STAGGER_MS = 15_000;

const timers: NodeJS.Timeout[] = [];

async function runJobOnce(job: CatalogJob): Promise<void> {
  // See jobReentrancyGuard.ts: skip this tick entirely (no heartbeat write —
  // nothing ran) if the previous tick of this exact job is still in flight,
  // rather than letting setInterval start a second overlapping instance.
  if (!tryAcquireJobSlot(job.jobKey)) {
    console.warn(`[BackgroundJobs] ${job.jobKey} tick skipped — previous run still in progress.`);
    return;
  }
  try {
    await job.run();
    await recordJobHeartbeat(job.jobKey, "ok");
  } catch (e) {
    console.warn(`[BackgroundJobs] ${job.jobKey} failed: ${e}`);
    await recordJobHeartbeat(job.jobKey, "error", String(e).slice(0, 300));
  } finally {
    releaseJobSlot(job.jobKey);
  }
}

/**
 * Call once at process startup (server.ts). Idempotent-ish: calling twice
 * on the in-process fallback just double-schedules (guard at the call site
 * if that ever matters); calling twice on the queue-backed path is safe —
 * registerRepeatableJobs() dedupes by jobId and starting a second Worker on
 * the same queue is exactly the multi-replica case this exists for.
 */
export function startBackgroundJobs(): void {
  if (isQueueBackedJobsEnabled()) {
    void registerRepeatableJobs(JOBS).then(() => startBackgroundJobWorker(JOBS));
    return;
  }

  JOBS.forEach((job, index) => {
    const initialDelay = STARTUP_STAGGER_MS * (index + 1);
    const kickoff = setTimeout(() => {
      void runJobOnce(job);
      const interval = setInterval(() => void runJobOnce(job), job.tickMs);
      timers.push(interval);
    }, initialDelay);
    timers.push(kickoff);
  });
}

/** For graceful shutdown / tests. */
export function stopBackgroundJobs(): void {
  if (isQueueBackedJobsEnabled()) {
    void stopBackgroundJobQueue();
  }
  for (const t of timers) clearTimeout(t as unknown as NodeJS.Timeout);
  timers.length = 0;
}
