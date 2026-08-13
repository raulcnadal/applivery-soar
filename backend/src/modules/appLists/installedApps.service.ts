import { appliveryClient } from "../../services/appliveryClient";
import { prisma } from "../../services/prisma";
import { resolveOrgBase } from "../auth/rbac.service";
import { extractItems } from "../../utils/extractItems";
import { platformPathSegment, type NormalizedDevice } from "../devices/deviceNormalize";

type Headers = Record<string, string>;

export interface InstalledAppsEntry {
  identifiers: string[];
  apps: Array<{ identifier: string; name?: string | null; version: string }>;
  platform: string;
  fetchedAt: string;
  error: string | null;
  source: string;
  appleAppUpdates: { pendingCount: number; totalApps: number; pendingApps: Array<Record<string, any>> } | null;
}

/**
 * Pure, no-network read — the ONLY thing compliance evaluation ever
 * touches for app-list conditions. Returns null if this device has never
 * been synced yet (distinct from an empty set) — port of
 * `_read_installed_apps_from_store` (main.py:9151).
 */
export async function readInstalledAppsFromStore(workspaceSlug: string, deviceId: string): Promise<Set<string> | null> {
  const row = await prisma.installedAppInventory.findUnique({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId } } });
  if (!row) return null;
  const entry = row.apps as unknown as InstalledAppsEntry;
  return new Set(entry.identifiers ?? []);
}

/** Loads the whole per-device store for a workspace — main.py's `_load_installed_apps_store`. */
export async function loadInstalledAppsStore(workspaceSlug: string): Promise<Record<string, InstalledAppsEntry>> {
  const rows = await prisma.installedAppInventory.findMany({ where: { workspaceSlug } });
  const store: Record<string, InstalledAppsEntry> = {};
  for (const row of rows) store[row.deviceId] = row.apps as unknown as InstalledAppsEntry;
  return store;
}

/**
 * Every device covered by at least one enabled policy with a
 * requiredAppList/disallowedAppList condition — port of
 * `_app_list_scoped_device_ids` (main.py:9163). `policies` is passed in
 * (already loaded by the caller) rather than fetched here, to avoid a
 * module cycle with compliance.service.
 */
export function appListScopedDeviceIds(devices: NormalizedDevice[], policies: Array<{ enabled: boolean; conditions: any[]; targetDeviceAudienceId?: string | null }>): Set<string> {
  const ids = new Set<string>();
  for (const policy of policies) {
    if (!policy.enabled) continue;
    if (!(policy.conditions ?? []).some((c) => ["requiredAppList", "disallowedAppList"].includes(c?.field))) continue;
    if (policy.targetDeviceAudienceId) {
      for (const d of devices) {
        if ((d.deviceAudiences ?? []).some((a) => String(a.id) === String(policy.targetDeviceAudienceId))) ids.add(d.id);
      }
    } else {
      for (const d of devices) ids.add(d.id);
    }
  }
  return ids;
}

/** Every Apple/macOS device — port of `_apple_app_update_device_ids` (main.py:9387). */
export function appleAppUpdateDeviceIds(devices: NormalizedDevice[]): Set<string> {
  return new Set(devices.filter((d) => platformPathSegment(d.platform) === "apple").map((d) => d.id));
}

/**
 * The only place that actually calls Applivery's per-device applications
 * endpoint — port of `_fetch_and_store_installed_apps` (main.py:9183).
 * Writes straight to Prisma (an upsert) since this app has no in-memory
 * per-batch store object to hand back and forth the way Python's dict does.
 */
export async function fetchAndStoreInstalledApps(headers: Headers, orgBase: string, device: NormalizedDevice, workspaceSlug: string): Promise<Set<string>> {
  const deviceId = device.id;
  const platformPath = platformPathSegment(device.platform);
  if (!deviceId || !platformPath || !["apple", "android", "aosp", "windows"].includes(platformPath)) return new Set();

  const url = `${orgBase}/mdm/${platformPath}/enterprise/devices/${deviceId}/applications`;
  const identifiers = new Set<string>();
  let error: string | null = null;
  const applePendingApps: Array<Record<string, any>> = [];
  let appleTotalApps = 0;
  const versionedApps: Array<{ identifier: string; name?: string | null; version: string }> = [];

  try {
    const res = await appliveryClient.get<any>(url, { headers });
    if (res.status < 300) {
      for (const item of extractItems(res.data)) {
        if (!item || typeof item !== "object") continue;
        let ident: string | undefined;
        if (platformPath === "apple") {
          ident = item.Identifier ?? item.identifier;
          appleTotalApps += 1;
          const version = item.ShortVersion ?? item.Version;
          if (item.HasUpdateAvailable) {
            applePendingApps.push({ identifier: ident, name: item.Name, installedVersion: version, build: item.Version, isBetaApp: Boolean(item.BetaApp) });
          }
          if (ident && version) versionedApps.push({ identifier: String(ident).toLowerCase(), name: item.Name, version: String(version) });
        } else if (platformPath === "android" || platformPath === "aosp") {
          ident = item.packageName;
          if (item.state !== "REMOVED") {
            const version = item.versionName;
            if (ident && version) versionedApps.push({ identifier: String(ident).toLowerCase(), name: item.displayName, version: String(version) });
          }
        } else {
          ident = item.packageName ?? item.Identifier ?? item.id ?? item.productId ?? item.name;
          const version = item.Version ?? item.version ?? item.DisplayVersion ?? item.AppVersion ?? item.versionName;
          if (ident && version) versionedApps.push({ identifier: String(ident).toLowerCase(), name: item.DisplayName ?? item.displayName ?? item.Name, version: String(version) });
        }
        if (ident) identifiers.add(String(ident).toLowerCase());
      }
    } else {
      error = `Applivery returned ${res.status}`;
    }
  } catch (e) {
    error = String(e);
  }

  const existing = await prisma.installedAppInventory.findUnique({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId } } });
  const existingEntry = existing?.apps as unknown as InstalledAppsEntry | undefined;

  // On error, this must NOT clobber a previously-good entry — in
  // particular a self-reported one (source: "self_reported") written by
  // reportDeviceApps (deviceData.service.ts). Before this fix, an errored
  // MDM live-fetch (e.g. a device not enrolled for the paid app-inventory
  // endpoint) unconditionally reset identifiers to an empty set and source
  // to "server_fetch" regardless of error, permanently wiping out good
  // self-reported data on every refresher tick (installedAppsJobs.ts runs
  // every 30s) and making requiredAppList/disallowedAppList compliance
  // conditions (which read identifiers straight off this entry via
  // readInstalledAppsFromStore) never see the device's real installed apps.
  const entry: InstalledAppsEntry = {
    identifiers: error === null ? Array.from(identifiers).sort() : existingEntry?.identifiers ?? [],
    apps: error === null ? versionedApps.sort((a, b) => a.identifier.localeCompare(b.identifier)) : existingEntry?.apps ?? [],
    platform: platformPath,
    fetchedAt: new Date().toISOString(),
    error,
    source: error === null ? "server_fetch" : existingEntry?.source ?? "server_fetch",
    appleAppUpdates:
      platformPath === "apple"
        ? error === null
          ? { pendingCount: applePendingApps.length, totalApps: appleTotalApps, pendingApps: applePendingApps.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")) }
          : existingEntry?.appleAppUpdates ?? null
        : null,
  };

  await prisma.installedAppInventory.upsert({
    where: { workspaceSlug_deviceId: { workspaceSlug, deviceId } },
    create: { workspaceSlug, deviceId, apps: entry as any, reportedAt: new Date() },
    update: { apps: entry as any, reportedAt: new Date() },
  });
  return identifiers;
}

const REFRESH_CONCURRENCY = 8;

/** Bounded-concurrency fetch of exactly `targetIds` — port of `_refresh_installed_apps_batch` (main.py:9362). */
async function refreshInstalledAppsBatch(targetIds: string[], devicesById: Map<string, NormalizedDevice>, authorization: string, workspaceSlug: string) {
  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  let cursor = 0;
  async function worker() {
    while (cursor < targetIds.length) {
      const idx = cursor++;
      const deviceId = targetIds[idx];
      const device = devicesById.get(deviceId);
      if (!device) continue;
      await fetchAndStoreInstalledApps(headers, orgBase, device, workspaceSlug);
    }
  }
  await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, targetIds.length) }, worker));
}

/** Port of `_manual_refresh_installed_apps` (main.py:9380) — fire-and-forget from the controller. */
export async function manualRefreshInstalledApps(targetIds: string[], devices: NormalizedDevice[], authorization: string, workspaceSlug: string) {
  const devicesById = new Map(devices.map((d) => [d.id, d]));
  await refreshInstalledAppsBatch(targetIds, devicesById, authorization, workspaceSlug);
}

const DEFAULT_BUDGET = 2000;
const MIN_BUDGET = 200;
const MAX_BUDGET = 4000;

export function clampInstalledAppsBudget(value: number | null | undefined): number {
  if (!value) return DEFAULT_BUDGET;
  return Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, Math.trunc(value)));
}

/** GET /api/app-lists/installed-apps-status (main.py:9462). */
export async function getInstalledAppsStatus(
  workspaceSlug: string,
  devices: NormalizedDevice[],
  policies: Array<{ enabled: boolean; conditions: any[]; targetDeviceAudienceId?: string | null }>,
) {
  const targetIds = appListScopedDeviceIds(devices, policies);
  const store = await loadInstalledAppsStore(workspaceSlug);
  const now = Date.now();

  let neverSynced = 0;
  let errorCount = 0;
  let selfReportedCount = 0;
  const agesMinutes: number[] = [];
  for (const did of targetIds) {
    const entry = store[did];
    if (!entry || !entry.fetchedAt) {
      neverSynced += 1;
      continue;
    }
    if (entry.error) errorCount += 1;
    if (entry.source === "self_reported") selfReportedCount += 1;
    const fetchedAt = new Date(entry.fetchedAt).getTime();
    if (Number.isNaN(fetchedAt)) {
      neverSynced += 1;
    } else {
      agesMinutes.push((now - fetchedAt) / 60000);
    }
  }

  const devicesNeedingLiveFetch = Math.max(0, targetIds.size - selfReportedCount);
  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  const budget = clampInstalledAppsBudget(state?.installedAppsRefreshBudgetPerHour);
  const estimatedFullCycleHours = budget && devicesNeedingLiveFetch ? Math.round((devicesNeedingLiveFetch / budget) * 10) / 10 : 0;
  agesMinutes.sort((a, b) => a - b);

  return {
    targetDeviceCount: targetIds.size,
    syncedCount: agesMinutes.length,
    neverSyncedCount: neverSynced,
    errorCount,
    selfReportedCount,
    oldestSyncAgeMinutes: agesMinutes.length ? Math.round(agesMinutes[agesMinutes.length - 1] * 10) / 10 : null,
    medianSyncAgeMinutes: agesMinutes.length ? Math.round(agesMinutes[Math.floor(agesMinutes.length / 2)] * 10) / 10 : null,
    refreshBudgetPerHour: budget,
    refreshBudgetMin: MIN_BUDGET,
    refreshBudgetMax: MAX_BUDGET,
    estimatedFullCycleHours,
  };
}

/** PUT /api/app-lists/installed-apps-budget (main.py:9527). */
export async function setInstalledAppsBudget(workspaceSlug: string, budgetPerHour: number) {
  const clamped = clampInstalledAppsBudget(budgetPerHour);
  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, installedAppsRefreshBudgetPerHour: clamped },
    update: { installedAppsRefreshBudgetPerHour: clamped },
  });
  return { installedAppsRefreshBudgetPerHour: clamped };
}

/** GET /api/apple-app-updates/status (main.py:9569). */
export async function getAppleAppUpdatesStatus(workspaceSlug: string, devices: NormalizedDevice[]) {
  const targetIds = appleAppUpdateDeviceIds(devices);
  const store = await loadInstalledAppsStore(workspaceSlug);
  const now = Date.now();

  let neverSynced = 0;
  let errorCount = 0;
  let devicesWithPending = 0;
  let totalPendingAppInstances = 0;
  const appFrequency = new Map<string, number>();
  const agesMinutes: number[] = [];

  for (const did of targetIds) {
    const entry = store[did];
    if (!entry || !entry.fetchedAt) {
      neverSynced += 1;
      continue;
    }
    if (entry.error) errorCount += 1;
    const fetchedAt = new Date(entry.fetchedAt).getTime();
    if (!Number.isNaN(fetchedAt)) agesMinutes.push((now - fetchedAt) / 60000);
    const pendingApps = entry.appleAppUpdates?.pendingApps ?? [];
    if (pendingApps.length > 0) {
      devicesWithPending += 1;
      totalPendingAppInstances += pendingApps.length;
      for (const a of pendingApps) {
        const name = a.name ?? a.identifier ?? "Unknown app";
        appFrequency.set(name, (appFrequency.get(name) ?? 0) + 1);
      }
    }
  }

  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  const budget = clampInstalledAppsBudget(state?.installedAppsRefreshBudgetPerHour);
  const estimatedFullCycleHours = budget && targetIds.size ? Math.round((targetIds.size / budget) * 10) / 10 : 0;
  agesMinutes.sort((a, b) => a - b);
  const topApps = Array.from(appFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, deviceCount]) => ({ name, deviceCount }));

  return {
    targetDeviceCount: targetIds.size,
    syncedCount: agesMinutes.length,
    neverSyncedCount: neverSynced,
    errorCount,
    devicesWithPendingUpdates: devicesWithPending,
    totalPendingAppInstances,
    topPendingApps: topApps,
    oldestSyncAgeMinutes: agesMinutes.length ? Math.round(agesMinutes[agesMinutes.length - 1] * 10) / 10 : null,
    medianSyncAgeMinutes: agesMinutes.length ? Math.round(agesMinutes[Math.floor(agesMinutes.length / 2)] * 10) / 10 : null,
    refreshBudgetPerHour: budget,
    estimatedFullCycleHours,
  };
}
