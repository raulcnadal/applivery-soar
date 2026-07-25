import { recordJobHeartbeat } from "../services/systemHealth";
import { refreshOsUpdateCatalog, OS_UPDATE_TICK_MS } from "../modules/catalogs/osUpdateCatalog";
import { refreshVulnCatalog, VULN_CATALOG_TICK_MS } from "../modules/catalogs/vulnCatalog";
import { refreshOsLifecycleCatalog, OS_LIFECYCLE_TICK_MS } from "../modules/catalogs/osLifecycleCatalog";
import { refreshGdmfCatalog, GDMF_TICK_MS } from "../modules/catalogs/gdmfCatalog";
import { refreshMitreCatalog, MITRE_CATALOG_TICK_MS } from "../modules/catalogs/mitreCatalog";

/**
 * Background scheduler for the five GLOBAL intelligence catalogs (no
 * per-workspace credentials needed — all public reference data). Each is a
 * plain `setInterval` loop that runs once shortly after boot, then on its
 * own cadence, recording an OK/error heartbeat every tick so a silent
 * failure surfaces later in Settings > System Health (Phase 6).
 *
 * Explicitly NOT started here (both are per-workspace and unattended
 * scheduling needs live admin credentials that Automation Credentials
 * (Phase 6, TODO(Phase6)) hasn't been built yet to supply):
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

const JOBS: CatalogJob[] = [
  { jobKey: "catalog:os-update", tickMs: OS_UPDATE_TICK_MS, run: refreshOsUpdateCatalog },
  { jobKey: "catalog:vuln", tickMs: VULN_CATALOG_TICK_MS, run: refreshVulnCatalog },
  { jobKey: "catalog:os-lifecycle", tickMs: OS_LIFECYCLE_TICK_MS, run: refreshOsLifecycleCatalog },
  { jobKey: "catalog:gdmf", tickMs: GDMF_TICK_MS, run: refreshGdmfCatalog },
  { jobKey: "catalog:mitre", tickMs: MITRE_CATALOG_TICK_MS, run: refreshMitreCatalog },
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
