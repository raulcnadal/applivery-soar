import { prisma } from "../../services/prisma";
import { clampLocationBudget, loadLocationStore, refreshLocationsForDevices } from "./locationsRefresh.service";
import { geofenceScopedDeviceIds } from "./geofence.service";

/**
 * The geofencing location refresher — same tick/budget/oldest-first
 * rotation shape as the Installed Apps refresher (installedAppsJobs.ts),
 * see locationsRefresh.service.ts's file-header comment for the full
 * rationale. 30s tick (matching the Installed Apps refresher's own cadence)
 * so the per-tick budget slice stays small and smooth rather than bursty.
 */
export const LOCATION_REFRESH_TICK_MS = 30_000;
const TICKS_PER_HOUR = 3_600_000 / LOCATION_REFRESH_TICK_MS; // 120

async function workspacesWithEnabledPolicies(): Promise<string[]> {
  const rows = await prisma.compliancePolicy.findMany({
    where: { enabled: true },
    distinct: ["workspaceSlug"],
    select: { workspaceSlug: true },
  });
  return rows.map((r) => r.workspaceSlug);
}

export async function runLocationRefresherTick(): Promise<void> {
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

      const targetIds = geofenceScopedDeviceIds(devices, policies as any);
      if (!targetIds.size) continue;

      const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
      const budgetPerHour = clampLocationBudget(state?.locationRefreshBudgetPerHour);
      const perTickBudget = Math.max(1, Math.round(budgetPerHour / TICKS_PER_HOUR));

      const store = await loadLocationStore(workspaceSlug);
      const ranked = Array.from(targetIds).sort((a, b) => {
        const aAt = store[a]?.fetchedAt ? store[a].fetchedAt.getTime() : 0;
        const bAt = store[b]?.fetchedAt ? store[b].fetchedAt.getTime() : 0;
        return aAt - bAt; // never-synced (epoch 0) sorts first, then oldest-fetched-first
      });
      const batch = ranked.slice(0, perTickBudget);
      if (!batch.length) continue;

      await refreshLocationsForDevices(batch, devices, bearer, workspaceSlug);
    } catch (e) {
      console.warn(`[Location Refresher] ${workspaceSlug} failed: ${e}`);
    }
  }
}
