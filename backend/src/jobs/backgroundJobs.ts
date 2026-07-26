import { recordJobHeartbeat } from "../services/systemHealth";
import { refreshOsUpdateCatalog, OS_UPDATE_TICK_MS } from "../modules/catalogs/osUpdateCatalog";
import { refreshVulnCatalog, VULN_CATALOG_TICK_MS } from "../modules/catalogs/vulnCatalog";
import { refreshOsLifecycleCatalog, OS_LIFECYCLE_TICK_MS } from "../modules/catalogs/osLifecycleCatalog";
import { refreshGdmfCatalog, GDMF_TICK_MS } from "../modules/catalogs/gdmfCatalog";
import { refreshMitreCatalog, MITRE_CATALOG_TICK_MS } from "../modules/catalogs/mitreCatalog";
import { resumeDueWorkflowSteps } from "../modules/workflows/durableEngine";
import { runScriptLogReconcilerTick, SCRIPT_RUN_RECONCILE_TICK_MS } from "../modules/workflows/scriptLogReconciler";
import { CASE_SLA_MONITOR_TICK_MS, runCaseSlaMonitorTick, runTicketStatusSyncTick, TICKET_SYNC_TICK_MS } from "../modules/cases/caseJobs";

/**
 * Background scheduler for the five GLOBAL intelligence catalogs (no
 * per-workspace credentials needed — all public reference data), plus the
 * two Phase 4b durable-workflow-engine loops (per-workspace, now that
 * Automation Credentials exist — settings/automationCredential.service.ts).
 * Each is a plain `setInterval` loop that runs once shortly after boot, then
 * on its own cadence, recording an OK/error heartbeat every tick so a silent
 * failure surfaces later in Settings > System Health (Phase 6).
 *
 * Explicitly NOT started here (both are per-workspace and still need
 * subsystems this migration hasn't reached yet):
 *   - Compliance policy evaluation loop
 *   - Installed-apps rolling refresher
 *   - Vulnerability Service per-workspace refresh
 * Their manual/on-demand equivalents (using the calling admin's live
 * session) are fully wired through their respective controllers already.
 */

interface CatalogJob {
  jobKey: string;
  tickMs: number;
  run: () => Promise<unknown>;
}

const WORKFLOW_RESUMER_TICK_MS = 30_000;

const JOBS: CatalogJob[] = [
  { jobKey: "catalog:os-update", tickMs: OS_UPDATE_TICK_MS, run: refreshOsUpdateCatalog },
  { jobKey: "catalog:vuln", tickMs: VULN_CATALOG_TICK_MS, run: refreshVulnCatalog },
  { jobKey: "catalog:os-lifecycle", tickMs: OS_LIFECYCLE_TICK_MS, run: refreshOsLifecycleCatalog },
  { jobKey: "catalog:gdmf", tickMs: GDMF_TICK_MS, run: refreshGdmfCatalog },
  { jobKey: "catalog:mitre", tickMs: MITRE_CATALOG_TICK_MS, run: refreshMitreCatalog },
  { jobKey: "workflow_wait_resumer", tickMs: WORKFLOW_RESUMER_TICK_MS, run: () => resumeDueWorkflowSteps() },
  { jobKey: "script_log_reconciler", tickMs: SCRIPT_RUN_RECONCILE_TICK_MS, run: runScriptLogReconcilerTick },
  { jobKey: "ticket_status_sync", tickMs: TICKET_SYNC_TICK_MS, run: runTicketStatusSyncTick },
  { jobKey: "case_sla_monitor", tickMs: CASE_SLA_MONITOR_TICK_MS, run: runCaseSlaMonitorTick },
];

// Stagger initial runs so five outbound HTTP calls don't fire in the same
// instant on every cold boot.
const STARTUP_STAGGER_MS = 15_000;

const timers: NodeJS.Timeout[] = [];

async function runJobOnce(job: CatalogJob): Promise<void> {
  try {
    await job.run();
    await recordJobHeartbeat(job.jobKey, "ok");
  } catch (e) {
    console.warn(`[BackgroundJobs] ${job.jobKey} failed: ${e}`);
    await recordJobHeartbeat(job.jobKey, "error", String(e).slice(0, 300));
  }
}

/** Call once at process startup (server.ts). Idempotent-ish: calling twice just double-schedules, so guard at the call site if that ever matters. */
export function startBackgroundJobs(): void {
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
  for (const t of timers) clearTimeout(t as unknown as NodeJS.Timeout);
  timers.length = 0;
}
