import { appliveryClient } from "../../services/appliveryClient";
import { prisma } from "../../services/prisma";
import { resolveOrgBase } from "../auth/rbac.service";
import { extractItems } from "../../utils/extractItems";
import { platformPathSegment, type NormalizedDevice } from "../devices/deviceNormalize";
import { fetchWindowsDeviceApps } from "./windowsDeviceApps.service";
import type { AppVulnSummary } from "../catalogs/vulnService";

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
  // Agent MSI itself). origin is Windows-only too — "msi" for classic
  // installer apps, "store" for AppX/UWP packages parsed out of
  // AppInventoryResults (windowsDeviceApps.service.ts) — absent for every
  // other platform and for self-reported Windows apps (the agent doesn't yet
  // distinguish the two either, see apps_windows.go).
  apps: Array<{
    identifier: string;
    name?: string | null;
    version: string;
    updateAvailable?: boolean;
    productCode?: string;
    enforcedByPolicy?: boolean;
    origin?: "msi" | "store";
  }>;
  platform: string;
  fetchedAt: string;
  error: string | null;
  source: "self_reported" | "server_fetch";
  appleAppUpdates: { pendingCount: number; totalApps: number; pendingApps: Array<Record<string, any>> } | null;
}

/**
 * A device's installed-app data now lives in TWO independent slots per the
 * `InstalledAppInventory` row instead of one flat entry — the original
 * single-entry shape meant a self-reported write (deviceData.service.ts's
 * reportDeviceApps) and a live-MDM-fetch write (fetchAndStoreInstalledApps
 * below) unconditionally overwrote each other's data on the SAME row, so
 * only whichever ran most recently was ever visible; a user-reported gap
 * ("SOAR should show both, the apps reported by SOAR agent... and those
 * that Applivery UEM knows") made this the wrong model outright, not just an
 * edge case. Each slot keeps its own independent InstalledAppsEntry now, so
 * both sources are always simultaneously available — to every consumer:
 * compliance app-list matching (union of both), the Apps view (both shown,
 * tagged by source), the Vulnerability Service (apps from both checked),
 * and the Device modal's Apps tab (both shown).
 */
export interface InstalledAppsRecord {
  selfReported: InstalledAppsEntry | null;
  serverFetch: InstalledAppsEntry | null;
}

/**
 * Normalizes whatever's in the `apps` JSON column into the two-slot shape —
 * tolerant of rows written before this dual-slot model existed (a flat
 * InstalledAppsEntry with its own `source` field, no `selfReported`/
 * `serverFetch` wrapper), so a workspace's existing data doesn't silently
 * disappear until its next natural refresh/report re-writes the row in the
 * new shape. Every write path in this file goes through `upsertInstalledAppsSlot`
 * from here on, which always reads-modifies-writes through this same
 * normalizer, so the flat legacy shape self-heals into the new one on first
 * touch per device.
 */
function toRecord(raw: unknown): InstalledAppsRecord {
  const r = raw as any;
  if (r && typeof r === "object" && ("selfReported" in r || "serverFetch" in r)) {
    return { selfReported: r.selfReported ?? null, serverFetch: r.serverFetch ?? null };
  }
  if (r && typeof r === "object" && typeof r.source === "string") {
    return r.source === "self_reported" ? { selfReported: r as InstalledAppsEntry, serverFetch: null } : { selfReported: null, serverFetch: r as InstalledAppsEntry };
  }
  return { selfReported: null, serverFetch: null };
}

/** Both non-null entries in a record, as a flat list — the common shape most read-side consumers actually want. */
export function installedAppsRecordEntries(record: InstalledAppsRecord | undefined | null): InstalledAppsEntry[] {
  if (!record) return [];
  return [record.selfReported, record.serverFetch].filter((e): e is InstalledAppsEntry => Boolean(e));
}

/**
 * Read-modify-write into exactly one slot of a device's InstalledAppInventory
 * row, leaving the other slot untouched — the single write primitive both
 * `fetchAndStoreInstalledApps` below and deviceData.service.ts's
 * reportDeviceApps/reconcilePendingAppReports go through, so there's one
 * place that understands the two-slot JSON shape rather than three separate
 * upserts each hand-rolling it.
 */
export async function upsertInstalledAppsSlot(
  workspaceSlug: string,
  deviceId: string,
  slot: "selfReported" | "serverFetch",
  entry: InstalledAppsEntry,
  reportedAt: Date,
): Promise<void> {
  const existing = await prisma.installedAppInventory.findUnique({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId } } });
  const record = toRecord(existing?.apps);
  record[slot] = entry;
  await prisma.installedAppInventory.upsert({
    where: { workspaceSlug_deviceId: { workspaceSlug, deviceId } },
    create: { workspaceSlug, deviceId, apps: record as any, reportedAt },
    update: { apps: record as any, reportedAt },
  });
}

/**
 * Pure, no-network read — the ONLY thing compliance evaluation ever
 * touches for app-list conditions. Returns null if this device has never
 * been synced by EITHER source yet (distinct from an empty set) — port of
 * `_read_installed_apps_from_store` (main.py:9151). Unions identifiers from
 * both slots: a required app installed and visible via either the SOAR
 * Agent's self-report or Applivery's own UEM fetch counts as "present" —
 * requiring both sources to agree would make a requiredAppList condition
 * fail for a device that self-reports but was never MDM-app-list-fetched
 * (or vice versa), which isn't what "is this app installed" should mean.
 */
export async function readInstalledAppsFromStore(workspaceSlug: string, deviceId: string): Promise<Set<string> | null> {
  const row = await prisma.installedAppInventory.findUnique({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId } } });
  if (!row) return null;
  const entries = installedAppsRecordEntries(toRecord(row.apps));
  if (entries.length === 0) return null;
  const ids = new Set<string>();
  for (const entry of entries) for (const id of entry.identifiers ?? []) ids.add(id);
  return ids;
}

/** Loads the whole per-device store for a workspace — main.py's `_load_installed_apps_store`, now record-shaped (both slots). */
export async function loadInstalledAppsStore(workspaceSlug: string): Promise<Record<string, InstalledAppsRecord>> {
  const rows = await prisma.installedAppInventory.findMany({ where: { workspaceSlug } });
  const store: Record<string, InstalledAppsRecord> = {};
  for (const row of rows) store[row.deviceId] = toRecord(row.apps);
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
 * Always writes into the "serverFetch" slot only (via upsertInstalledAppsSlot)
 * — a self-reported entry on the same device, if any, lives in its own slot
 * and is never touched from here.
 *
 * Windows is a special case: it does NOT call the generic
 * `/mdm/{platform}/enterprise/devices/{id}/applications` endpoint below —
 * that endpoint errors persistently for every Windows device in this org
 * (undocumented/empty response schema). Instead it calls the Windows
 * device-detail endpoint and parses both the MSI CSP sub-tree AND the
 * AppInventoryResults Appx/UWP inventory out of its `config` blob — see
 * windowsDeviceApps.service.ts's doc comment for the full rationale.
 */
export async function fetchAndStoreInstalledApps(headers: Headers, orgBase: string, device: NormalizedDevice, workspaceSlug: string): Promise<Set<string>> {
  const deviceId = device.id;
  const platformPath = platformPathSegment(device.platform);
  if (!deviceId || !platformPath || !["apple", "android", "aosp", "windows"].includes(platformPath)) return new Set();

  const identifiers = new Set<string>();
  let error: string | null = null;
  const applePendingApps: Array<Record<string, any>> = [];
  let appleTotalApps = 0;
  const versionedApps: InstalledAppsEntry["apps"] = [];

  if (platformPath === "windows") {
    const { msiApps, storeApps, error: winError } = await fetchWindowsDeviceApps(headers, orgBase, deviceId);
    error = winError;
    for (const app of msiApps) {
      // Lowercased Name is the identifier convention — it's what the Windows
      // agent's self-report registry fallback also uses (apps_windows.go's
      // getAppsViaRegistry), so an app tracked here and self-reported on the
      // same device resolve to the same identifier rather than silently
      // creating two separate entries for one app.
      const identifier = app.name.toLowerCase();
      versionedApps.push({ identifier, name: app.name, version: app.version, productCode: app.productCode, enforcedByPolicy: app.enforcedByPolicy, origin: "msi" });
      identifiers.add(identifier);
    }
    for (const app of storeApps) {
      const identifier = app.name.toLowerCase();
      // A classic MSI app happening to share the same lowercased-name
      // identifier as a Store package (rare, but plausible for a vendor
      // shipping both a legacy installer and a Store version) keeps the MSI
      // entry, which carries richer data (productCode/enforcedByPolicy) —
      // rather than the store parse silently clobbering it.
      if (identifiers.has(identifier)) continue;
      versionedApps.push({ identifier, name: app.name, version: app.version, origin: "store" });
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
  const existingEntry = toRecord(existing?.apps).serverFetch;

  // On error, this must NOT clobber a previously-good serverFetch entry —
  // e.g. a device not enrolled for the paid app-inventory endpoint erroring
  // on every refresher tick (installedAppsJobs.ts runs every 30s) shouldn't
  // permanently reset this slot to empty. Note this is now a within-slot
  // concern only — the selfReported slot lives entirely independently and
  // was never at risk from this path even before the dual-slot model.
  //
  // fetchedAt must be preserved the same way on error — it's meant to answer
  // "how fresh is this data", not "when did we last try". Stamping it to now()
  // unconditionally (the bug this comment replaces) meant a device that's
  // been failing every fetch for months — offline, unenrolled, whatever —
  // still showed "X minutes ago" in the UI, because that's just how recently
  // the background job's most recent FAILED attempt ran, not how old the app
  // data actually is. Found via a real report: Applivery UEM showed a
  // device's last report as 3 months old while SOAR's Apps view showed the
  // same device's data as "19m ago" for exactly this reason. Only a
  // brand-new device with zero prior successful fetch has no better value to
  // fall back to, so that one case still uses now() — there's no
  // meaningfully "more honest" timestamp available for it.
  const entry: InstalledAppsEntry = {
    identifiers: error === null ? Array.from(identifiers).sort() : existingEntry?.identifiers ?? [],
    apps: error === null ? versionedApps.sort((a, b) => a.identifier.localeCompare(b.identifier)) : existingEntry?.apps ?? [],
    platform: platformPath,
    fetchedAt: error === null ? new Date().toISOString() : existingEntry?.fetchedAt ?? new Date().toISOString(),
    error,
    source: "server_fetch",
    appleAppUpdates:
      platformPath === "apple"
        ? error === null
          ? { pendingCount: applePendingApps.length, totalApps: appleTotalApps, pendingApps: applePendingApps.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")) }
          : existingEntry?.appleAppUpdates ?? null
        : null,
  };

  await upsertInstalledAppsSlot(workspaceSlug, deviceId, "serverFetch", entry, new Date());
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
    const record = store[did];
    const selfReported = record?.selfReported ?? null;
    const serverFetch = record?.serverFetch ?? null;
    if (selfReported) selfReportedCount += 1;
    // Represents this device's sync status with whichever entry is more
    // informative about a live-fetch attempt (serverFetch's own error/age),
    // falling back to the self-reported entry if that's genuinely all there
    // is — a device that only ever self-reports shouldn't read as
    // "never synced" just because it has no serverFetch slot.
    const representative = serverFetch ?? selfReported;
    if (!representative || !representative.fetchedAt) {
      neverSynced += 1;
      continue;
    }
    if (representative.error) errorCount += 1;
    const fetchedAt = new Date(representative.fetchedAt).getTime();
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
  // Only populated when the SOAR Agent's self-report and Applivery UEM's
  // live fetch genuinely disagree on which version is installed on this
  // device (rare drift moment, e.g. one side hasn't re-synced since an
  // update) — `version` above is whichever contribution is more recent, and
  // this records the divergence rather than silently hiding it.
  versionsBySource?: Record<string, string>;
  // Every source that reported this app on this device — one row per
  // physical device now (see getReportedAppsOverview's doc comment), so an
  // app seen by both the SOAR Agent and Applivery UEM has sources.length === 2
  // instead of producing two separate rows.
  sources: string[];
  // The most recent fetchedAt/reportedAt across all contributing sources —
  // named lastSyncAt (not fetchedAt) to be explicit this answers "how fresh
  // is this row's data", the same freshness question the AppDetailModal's
  // dedicated "Last Sync" column asks.
  lastSyncAt: string | null;
  updateAvailable: boolean;
  // Last live-MDM-fetch error for this device, if any — carried over even
  // when the apps shown for it came from self-report (installedApps.service.ts's
  // error-preservation fix keeps a self-reported entry's data intact through
  // a failing live fetch, but the `error` field itself is still recorded so
  // it's visible here rather than silently disappearing). Only ever comes
  // from a server_fetch contribution — self-reporting has no "fetch attempt"
  // concept to fail.
  lastFetchError: string | null;
  // Windows-only, from windowsDeviceApps.service.ts — see InstalledAppsEntry's
  // apps[] doc comment for what these mean.
  productCode: string | null;
  enforcedByPolicy: boolean;
  origin?: "msi" | "store";
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
  // Populated by appLists.controller.ts after this function returns, via
  // vulnService.ts's computeReportedAppsVulnSummaries — kept optional/absent
  // here (rather than always-present-but-null) so this function's own return
  // type doesn't imply it queries the Vulnerability Service itself, which it
  // deliberately doesn't (keeps this module free of vuln-service concerns;
  // see the controller route's own comment for why the merge happens there).
  vulnSummary?: AppVulnSummary | null;
}

type AppContribution = { entry: InstalledAppsEntry; app: InstalledAppsEntry["apps"][number] };

/**
 * GET /api/app-lists/reported-apps — the data source for the new "Apps"
 * main-nav view (troubleshooting aid: "which exact version of X is on
 * which device, and what does SOAR currently see fleet-wide"). Unlike
 * getInstalledAppsStatus above (which only ever looks at devices in scope
 * of an app-list compliance condition), this aggregates every device this
 * workspace has ANY installed-app data for — self-reported or MDM-fetched
 * — regardless of whether a policy references it, since the whole point is
 * visibility independent of compliance enforcement.
 *
 * Iterates BOTH slots of every device's record (not just whichever one
 * happened to be written last), but — unlike an earlier version of this
 * function — merges a device's contributions from both slots into exactly
 * ONE row per (device, app) in `devices`, tagged with every source that saw
 * it (`sources: string[]`). The earlier one-row-per-source design produced
 * two visually-identical device rows for any app both the SOAR Agent and
 * Applivery UEM see (the common case once both are active), which reads as
 * a data-integrity bug at any real fleet size ("why does this app show 2
 * devices when only 1 device has it" — a real user report). `deviceCount`/
 * `devicesWithPendingUpdate`/`devicesEnforcedByPolicy` are now simply
 * `devices.length`/filtered lengths — no separate de-dup pass needed, since
 * `devices` is already one row per physical device by construction.
 */
export async function getReportedAppsOverview(workspaceSlug: string, devices: NormalizedDevice[]): Promise<{ apps: ReportedAppSummary[]; devicesWithData: number; lastRefreshedAt: string | null }> {
  const store = await loadInstalledAppsStore(workspaceSlug);
  const devicesById = new Map(devices.map((d) => [d.id, d]));
  const byIdentifier = new Map<string, ReportedAppSummary>();
  let devicesWithData = 0;
  let lastRefreshedAt: string | null = null;

  for (const [deviceId, record] of Object.entries(store)) {
    const entries = installedAppsRecordEntries(record);
    if (entries.length === 0) continue;
    devicesWithData += 1;
    const device = devicesById.get(deviceId);
    const deviceName = device?.displayName || deviceId;

    // First pass: within THIS device, group every app contribution (from
    // either slot) by (platform, identifier) — before touching the
    // fleet-wide `byIdentifier` map at all, so an app this device reports
    // via both sources is already merged down to one bucket by the time it
    // becomes a `devices` row below.
    const perDeviceApps = new Map<string, { platform: string; contributions: AppContribution[] }>();
    for (const entry of entries) {
      if (!entry.fetchedAt) continue;
      if (!lastRefreshedAt || new Date(entry.fetchedAt) > new Date(lastRefreshedAt)) lastRefreshedAt = entry.fetchedAt;
      for (const app of entry.apps ?? []) {
        const key = `${entry.platform}:${app.identifier}`;
        let bucket = perDeviceApps.get(key);
        if (!bucket) {
          bucket = { platform: entry.platform, contributions: [] };
          perDeviceApps.set(key, bucket);
        }
        bucket.contributions.push({ entry, app });
      }
    }

    for (const [key, { platform, contributions }] of perDeviceApps) {
      let summary = byIdentifier.get(key);
      const identifier = contributions[0].app.identifier;
      if (!summary) {
        summary = { identifier, name: identifier, platform, deviceCount: 0, versions: [], sources: [], devicesWithPendingUpdate: 0, devicesEnforcedByPolicy: 0, devices: [] };
        byIdentifier.set(key, summary);
      }
      for (const { app } of contributions) {
        if (app.name && summary.name === summary.identifier) summary.name = app.name;
        if (app.version && !summary.versions.includes(app.version)) summary.versions.push(app.version);
      }
      const sources = Array.from(new Set(contributions.map((c) => c.entry.source)));
      for (const s of sources) if (!summary.sources.includes(s)) summary.sources.push(s);

      // The freshest contribution (by fetchedAt/reportedAt) supplies this
      // row's headline version/lastSyncAt — if the sources disagree on
      // version, versionsBySource records the divergence instead of hiding it.
      const ranked = [...contributions].sort((a, b) => new Date(b.entry.fetchedAt).getTime() - new Date(a.entry.fetchedAt).getTime());
      const primary = ranked[0];
      const serverFetchContribution = contributions.find((c) => c.entry.source === "server_fetch") ?? null;
      const distinctVersions = new Set(contributions.map((c) => c.app.version).filter(Boolean));
      let versionsBySource: Record<string, string> | undefined;
      if (distinctVersions.size > 1) {
        versionsBySource = {};
        for (const c of contributions) if (c.app.version) versionsBySource[c.entry.source] = c.app.version;
      }

      summary.devices.push({
        deviceId,
        deviceName,
        version: primary.app.version ?? null,
        versionsBySource,
        sources,
        lastSyncAt: primary.entry.fetchedAt,
        updateAvailable: contributions.some((c) => Boolean(c.app.updateAvailable)),
        lastFetchError: serverFetchContribution?.entry.error ?? null,
        productCode: contributions.map((c) => c.app.productCode).find(Boolean) ?? null,
        enforcedByPolicy: contributions.some((c) => Boolean(c.app.enforcedByPolicy)),
        origin: contributions.map((c) => c.app.origin).find(Boolean),
      });
    }
  }

  const apps = Array.from(byIdentifier.values());
  for (const app of apps) {
    app.versions.sort();
    app.sources.sort();
    app.devices.sort((a, b) => a.deviceName.localeCompare(b.deviceName));
    app.deviceCount = app.devices.length;
    app.devicesWithPendingUpdate = app.devices.filter((d) => d.updateAvailable).length;
    app.devicesEnforcedByPolicy = app.devices.filter((d) => d.enforcedByPolicy).length;
  }
  apps.sort((a, b) => b.deviceCount - a.deviceCount || a.name.localeCompare(b.name));

  return { apps, devicesWithData, lastRefreshedAt };
}

/** GET /api/apple-app-updates/status (main.py:9569). appleAppUpdates is only ever populated on the serverFetch slot (self-report never sets it) — reads that slot specifically rather than "whichever entry exists". */
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
    const entry = store[did]?.serverFetch ?? null;
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
