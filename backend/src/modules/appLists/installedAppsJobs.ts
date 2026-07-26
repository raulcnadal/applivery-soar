import { prisma } from "../../services/prisma";
import { appListScopedDeviceIds, clampInstalledAppsBudget, loadInstalledAppsStore, manualRefreshInstalledApps } from "./installedApps.service";

/**
 * The Installed apps refresher — port of `installed_apps_refresher_loop`
 * (ARCHITECTURE.md §2.5: "30s | Refreshes the installed-app inventory").
 * Like the Compliance scheduler (complianceJobs.ts), this was flagged as
 * "explicitly still NOT started" in jobs/backgroundJobs.ts's original
 * module doc comment pending Automation Credentials — now wired for real.
 *
 * Spends at most `installedAppsRefreshBudgetPerHour` (WorkspaceState,
 * Settings > App Lists) device fetches per hour, split evenly across this
 * job's own 30s tick, oldest-synced-first (never-synced counts as oldest)
 * so a fleet's inventory turns over roughly once per budget cycle without
 * ever bursting past the configured live-Applivery-call budget. Manual/
 * on-demand equivalent: POST /api/app-lists/refresh-installed-apps (uses
 * the calling admin's own live session for an explicit, unthrottled pass).
 */
export const INSTALLED_APPS_REFRESH_TICK_MS = 30_000;
const TICKS_PER_HOUR = 3_600_000 / INSTALLED_APPS_REFRESH_TICK_MS; // 120

async function workspacesWithEnabledPolicies(): Promise<string[]> {
  const rows = await prisma.compliancePolicy.findMany({
    where: { enabled: true },
    distinct: ["workspaceSlug"],
    select: { workspaceSlug: true },
  });
  return rows.map((r) => r.workspaceSlug);
}

export async function runInstalledAppsRefresherTick(): Promise<void> {
  const { listAutomationWorkspaces, getAutomationBearer } = await import("../settings/automationCredential.service");
  const automationWorkspaces = new Set(await listAutomationWorkspaces());

  for (const workspaceSlug of await workspacesWithEnabledPolicies()) {
    if (!automationWorkspaces.has(workspaceSlug)) continue;

    const bearer = await getAutomationBearer(workspaceSlug);
    if (!bearer) continue;

    try {
      const policies = await prisma.compliancePolicy.findMany({ where: { workspaceSlug, enabled: true } });
      const { getDevicesFull } = await import("../devices/devices.service");
      const devicesResp = await getDevicesFull(bearer, workspaceSlug, false);
      const devices = devicesResp.items;

      const targetIds = appListScopedDeviceIds(devices, policies as any);
      if (!targetIds.size) continue;

      const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
      const budgetPerHour = clampInstalledAppsBudget(state?.installedAppsRefreshBudgetPerHour);
      const perTickBudget = Math.max(1, Math.round(budgetPerHour / TICKS_PER_HOUR));

      const store = await loadInstalledAppsStore(workspaceSlug);
      const ranked = Array.from(targetIds).sort((a, b) => {
        const aAt = store[a]?.fetchedAt ? new Date(store[a].fetchedAt).getTime() : 0;
        const bAt = store[b]?.fetchedAt ? new Date(store[b].fetchedAt).getTime() : 0;
        return aAt - bAt; // never-synced (epoch 0) sorts first, then oldest-fetched-first
      });
      const batch = ranked.slice(0, perTickBudget);
      if (!batch.length) continue;

      await manualRefreshInstalledApps(batch, devices, bearer, workspaceSlug);
    } catch (e) {
      console.warn(`[Installed Apps Refresher] ${workspaceSlug} failed: ${e}`);
    }
  }
}
