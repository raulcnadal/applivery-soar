import { appliveryClient } from "../../services/appliveryClient";
import { prisma } from "../../services/prisma";
import { resolveOrgBase } from "../auth/rbac.service";
import { extractItems } from "../../utils/extractItems";
import { platformPathSegment, type NormalizedDevice } from "../devices/deviceNormalize";
import { fetchWindowsDeviceMsiApps } from "./windowsDeviceApps.service";

type Headers = Record<string, string>;

export interface InstalledAppsEntry {
  identifiers: string[];
  // updateAvailable is only ever populated for platform "apple" — Applivery's
  // Applications API returns a HasUpdateAvailable boolean for iOS/iPadOS/
  // macOS apps but no target/new-version number, and no equivalent flag at
  // all for Android or Windows (self-reported Windows apps have no update
  // signal today; Android's MDM fetch doesn't surface one either).
  // productCode/enforcedByPolicy are Windows-only (from windowsDeviceApps.service.ts's
  // MSI CSP parse) — productCode is the MSI product GUID, enforcedByPolicy is
  // true when Applivery's own Windows App Distribution has this app assigned
  // to the device via its policy (deviceWinPolicy.applicationsInfo), false
  // when it's just present on the device for some other reason (manually
  // installed, or installed by the enrollment process like the Applivery
  // Agent MSI itself).
  apps: Array<{ identifier: string; name?: string | null; version: string; updateAvailable?: boolean; productCode?: string; enforcedByPolicy?: boolean }>;
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
 *
 * Windows is a special case: it does NOT call the generic
 * `/mdm/{platform}/enterprise/devices/{id}/applications` endpoint below —
 * that endpoint errors persistently for every Windows device in this org
 * (undocumented/empty response schema). Instead it calls the Windows
 * device-detail endpoint and parses the MSI CSP sub-tree out of its `config`
 * blob — see windowsDeviceApps.service.ts's doc comment for the full
 * rationale, including why the also-available Appx/UWP inventory blob is
 * deliberately NOT parsed (zero third-party-app signal on real data).
 */
export async function fetchAndStoreInstalledApps(headers: Headers, orgBase: string, device: NormalizedDevice, workspaceSlug: string): Promise<Set<string>> {
  const deviceId = device.id;
  const platformPath = platformPathSegment(device.platform);
  if (!deviceId || !platformPath || !["apple", "android", "aosp", "windows"].includes(platformPath)) return new Set();

  const identifiers = new Set<string>();
  let error: string | null = null;
  const applePendingApps: Array<Record<string, any>> = [];
  let appleTotalApps = 0;
  const versionedApps: Array<{ identifier: string; name?: string | null; version: string; updateAvailable?: boolean; productCode?: string; enforcedByPolicy?: boolean }> = [];

  if (platformPath === "windows") {
    const { apps, error: msiError } = await fetchWindowsDeviceMsiApps(headers, orgBase, deviceId);
    error = msiError;
    for (const app of apps) {
      // Lowercased Name is the identifier convention — it's what the Windows
      // agent's self-report registry fallback also uses (apps_windows.go's
      // getAppsViaRegistry), so an app tracked here and self-reported on the
      // same device resolve to the same identifier rather than silently
      // creating two separate entries for one app.
      const identifier = app.name.toLowerCase();
      versionedApps.push({ identifier, name: app.name, version: app.version, productCode: app.productCode, enforcedByPolicy: app.enforcedByPolicy });
      identifiers.add(identifier);
    }
  } else {
    const url = `${orgBase}/mdm/${platformPath}/enterprise/devices/${deviceId}/applications`;
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
            if (ident && version) versionedApps.push({ identifier: String(ident).toLowerCase(), name: item.Name, version: String(version), updateAvailable: Boolean(item.HasUpdateAvailable) });
          } else {
            // android / aosp
            ident = item.packageName;
            if (item.state !== "REMOVED") {
              const version = item.versionName;
              if (ident && version) versionedApps.push({ identifier: String(ident).toLowerCase(), name: item.displayName, version: String(version) });
            }
          }
          if (ident) identifiers.add(String(ident).toLowerCase());
        }
      } else {
        error = `Applivery returned ${res.status}`;
      }
    } catch (e) {
      error = String(e);
    }
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

export interface ReportedAppDeviceRef {
  deviceId: string;
  deviceName: string;
  version: string | null;
  source: string;
  fetchedAt: string;
  updateAvailable: boolean;
  // Last live-MDM-fetch error for this device, if any — carried over even
  // when the apps shown for it came from self-report (installedApps.service.ts's
  // error-preservation fix keeps a self-reported entry's data intact through
  // a failing live fetch, but the `error` field itself is still recorded so
  // it's visible here rather than silently disappearing). Explains cases
  // like "why does this device only ever show self-reported data" — surfaces
  // the actual reason (e.g. Applivery's own API returning a non-2xx for this
  // device/platform) instead of leaving it a mystery.
  lastFetchError: string | null;
  // Windows-only, from windowsDeviceApps.service.ts — see InstalledAppsEntry's
  // apps[] doc comment for what these mean.
  productCode: string | null;
  enforcedByPolicy: boolean;
}
export interface ReportedAppSummary {
  identifier: string;
  name: string;
  platform: string;
  deviceCount: number;
  versions: string[];
  sources: string[];
  devicesWithPendingUpdate: number;
  // Windows-only — count of devices where this app is assigned/enforced via
  // Applivery's Windows App Distribution policy (as opposed to merely being
  // present on the device for some other reason).
  devicesEnforcedByPolicy: number;
  devices: ReportedAppDeviceRef[];
}

/**
 * GET /api/app-lists/reported-apps — the data source for the new "Apps"
 * main-nav view (troubleshooting aid: "which exact version of X is on
 * which device, and what does SOAR currently see fleet-wide"). Unlike
 * getInstalledAppsStatus above (which only ever looks at devices in scope
 * of an app-list compliance condition), this aggregates every device this
 * workspace has ANY installed-app data for — self-reported or MDM-fetched
 * — regardless of whether a policy references it, since the whole point is
 * visibility independent of compliance enforcement.
 */
export async function getReportedAppsOverview(workspaceSlug: string, devices: NormalizedDevice[]): Promise<{ apps: ReportedAppSummary[]; devicesWithData: number; lastRefreshedAt: string | null }> {
  const store = await loadInstalledAppsStore(workspaceSlug);
  const devicesById = new Map(devices.map((d) => [d.id, d]));
  const byIdentifier = new Map<string, ReportedAppSummary>();
  let devicesWithData = 0;
  let lastRefreshedAt: string | null = null;

  for (const [deviceId, entry] of Object.entries(store)) {
    if (!entry?.fetchedAt) continue;
    devicesWithData += 1;
    if (!lastRefreshedAt || new Date(entry.fetchedAt) > new Date(lastRefreshedAt)) lastRefreshedAt = entry.fetchedAt;
    const device = devicesById.get(deviceId);
    const deviceName = device?.displayName || deviceId;
    const platform = entry.platform;
    for (const app of entry.apps ?? []) {
      const key = `${platform}:${app.identifier}`;
      let summary = byIdentifier.get(key);
      if (!summary) {
        summary = { identifier: app.identifier, name: app.name || app.identifier, platform, deviceCount: 0, versions: [], sources: [], devicesWithPendingUpdate: 0, devicesEnforcedByPolicy: 0, devices: [] };
        byIdentifier.set(key, summary);
      }
      if (app.name && summary.name === summary.identifier) summary.name = app.name;
      summary.deviceCount += 1;
      if (app.version && !summary.versions.includes(app.version)) summary.versions.push(app.version);
      if (!summary.sources.includes(entry.source)) summary.sources.push(entry.source);
      if (app.updateAvailable) summary.devicesWithPendingUpdate += 1;
      if (app.enforcedByPolicy) summary.devicesEnforcedByPolicy += 1;
      summary.devices.push({
        deviceId,
        deviceName,
        version: app.version ?? null,
        source: entry.source,
        fetchedAt: entry.fetchedAt,
        updateAvailable: Boolean(app.updateAvailable),
        lastFetchError: entry.error,
        productCode: app.productCode ?? null,
        enforcedByPolicy: Boolean(app.enforcedByPolicy),
      });
    }
  }

  const apps = Array.from(byIdentifier.values());
  for (const app of apps) {
    app.versions.sort();
    app.sources.sort();
    app.devices.sort((a, b) => a.deviceName.localeCompare(b.deviceName));
  }
  apps.sort((a, b) => b.deviceCount - a.deviceCount || a.name.localeCompare(b.name));

  return { apps, devicesWithData, lastRefreshedAt };
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
