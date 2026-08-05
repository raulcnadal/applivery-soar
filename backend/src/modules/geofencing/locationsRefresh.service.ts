import { appliveryClient } from "../../services/appliveryClient";
import { prisma } from "../../services/prisma";
import { resolveOrgBase } from "../auth/rbac.service";
import { extractItems } from "../../utils/extractItems";
import type { NormalizedDevice } from "../devices/deviceNormalize";
import { geofenceScopedDeviceIds } from "./geofence.service";

type Headers = Record<string, string>;

/**
 * The budgeted, geofence-scoped location refresher — the answer to "how do
 * we keep device location fresh enough for automated Compliance Policy
 * evaluation without blowing Applivery's API budget at a six-figure fleet
 * size". Modeled directly on installedApps.service.ts's own
 * budget/rotation/status machinery (same shape of problem: a per-device
 * Applivery call that can't be bulk-fetched for the whole fleet in one
 * request), with two changes specific to locations:
 *
 * 1. `geofenceScopedDeviceIds` instead of `appListScopedDeviceIds` — only
 *    devices actually covered by an enabled policy with a geofenceZoneId
 *    condition ever get budget spent on them. No policy uses geofencing?
 *    Zero extra Applivery calls, full stop.
 * 2. Delta-aware fetch: `dateIni` is set to the device's own last-known
 *    `recordedAt` when we have one, so a device that hasn't moved (the
 *    overwhelmingly common case for anything that isn't actively roaming)
 *    comes back as an empty page — cheap to parse, and we simply bump
 *    `fetchedAt` without touching the stored position. This is the
 *    concrete implementation of "fetching changes only when possible":
 *    Applivery's rate limit is per-REQUEST, not per-byte, so this doesn't
 *    reduce call *count* (the budgeted rotation below is what bounds that)
 *    — it reduces payload size and, more importantly, means a location
 *    that hasn't changed doesn't get a spurious new `recordedAt`/history
 *    entry on Applivery's own side misread as "moved".
 *
 * Deliberately separate from LocationCache/syncDeviceLocations.ts (the
 * pre-existing Playground globe's data source): that path is a manual,
 * admin-triggered, whole-fleet sync with its own 5-minute cooldown, tuned
 * for "I clicked a button, give me the freshest picture right now" on
 * whatever fleet size fits in one throttled pass. This path is the
 * opposite shape of problem — continuous, unattended, budget-bounded,
 * intentionally-partial-per-tick — same distinction ARCHITECTURE.md draws
 * between "manual/on-demand" and "background scheduler" throughout this
 * app. Unifying them would mean either the globe's manual sync inherits a
 * budget cap it was never designed to respect, or this refresher inherits
 * the globe's unthrottled per-click fleet-wide blast — both wrong. A
 * device covered by a geofence policy ends up in both caches; that's a
 * small amount of duplicated storage, not duplicated risk.
 */

const REFRESH_CONCURRENCY = 8;
const DEFAULT_BUDGET = 2000;
const MIN_BUDGET = 200;
const MAX_BUDGET = 4000;

export function clampLocationBudget(value: number | null | undefined): number {
  if (!value) return DEFAULT_BUDGET;
  return Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, Math.trunc(value)));
}

/** Maps a normalized platform to the Applivery Locations API's own `type` path segment (locationsSync.service.ts uses the same mapping off the raw device list; this is the NormalizedDevice equivalent). */
function locationsMdmType(platform: string): string | null {
  if (platform === "apple" || platform === "macos") return "admDevice";
  if (platform === "android") return "emmDevice";
  if (platform === "windows") return "winDevice";
  return null;
}

/** Pure, no-network read of every stored position for `deviceIds` — the ONLY thing compliance evaluation touches for geofence conditions. */
export async function loadDeviceLocations(workspaceSlug: string, deviceIds: string[]): Promise<Map<string, { lat: number; lng: number; recordedAt: Date | null; fetchedAt: Date }>> {
  if (!deviceIds.length) return new Map();
  const rows = await prisma.deviceLocation.findMany({ where: { workspaceSlug, deviceId: { in: deviceIds } } });
  // Exclude the "no real GPS fix yet" placeholder row (lat:0,lng:0, written
  // by fetchAndStoreDeviceLocation the first time a newly-scoped device is
  // checked and nothing has come back — see the "no_location_reported"
  // branch there). Letting it through here would make hasLocationData
  // wrongly report true and would test geofenceZoneId conditions against a
  // bogus (0,0) position instead of correctly matching neither inside nor
  // outside (see complianceFields.ts's geofenceZoneId doc comment).
  return new Map(
    rows.filter((r) => r.error !== "no_location_reported").map((r) => [r.deviceId, { lat: r.lat, lng: r.lng, recordedAt: r.recordedAt, fetchedAt: r.fetchedAt }]),
  );
}

/** Loads the whole per-device location store for a workspace — used by the refresher's oldest-first ranking. */
export async function loadLocationStore(workspaceSlug: string): Promise<Record<string, { fetchedAt: Date }>> {
  const rows = await prisma.deviceLocation.findMany({ where: { workspaceSlug }, select: { deviceId: true, fetchedAt: true } });
  const store: Record<string, { fetchedAt: Date }> = {};
  for (const row of rows) store[row.deviceId] = { fetchedAt: row.fetchedAt };
  return store;
}

/** The only place that calls Applivery's per-device locations endpoint for the geofencing refresher. */
export async function fetchAndStoreDeviceLocation(headers: Headers, orgBase: string, device: NormalizedDevice, workspaceSlug: string): Promise<void> {
  const mdmType = locationsMdmType(device.platform);
  if (!mdmType || !device.id) return;

  const existing = await prisma.deviceLocation.findUnique({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId: device.id } } });

  const params: Record<string, string> = { limit: "1", sort: "createdAt:desc" };
  if (existing?.recordedAt) params.dateIni = existing.recordedAt.toISOString();

  let error: string | null = null;
  try {
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/locations/${mdmType}/${device.id}`, { headers, params });
    if (res.status < 300) {
      const items = extractItems(res.data);
      if (items.length) {
        const latest = items[0];
        const lat = latest.latitude;
        const lng = latest.longitude;
        if (lat !== undefined && lat !== null && lng !== undefined && lng !== null) {
          const recordedAtRaw = latest.date ?? latest.createdAt ?? null;
          const recordedAt = recordedAtRaw ? new Date(recordedAtRaw) : null;
          await prisma.deviceLocation.upsert({
            where: { workspaceSlug_deviceId: { workspaceSlug, deviceId: device.id } },
            create: {
              workspaceSlug, deviceId: device.id, lat: Number(lat), lng: Number(lng),
              source: latest.origin ?? null, recordedAt,
              fetchedAt: new Date(), error: null,
            },
            update: {
              lat: Number(lat), lng: Number(lng), source: latest.origin ?? null,
              recordedAt,
              fetchedAt: new Date(), error: null,
            },
          });
          return;
        }
      }
      // No new points since `dateIni` (or no location data at all yet) --
      // nothing to overwrite, just record that we checked, so this device
      // doesn't look artificially stale and get re-picked next tick ahead
      // of devices that genuinely haven't been checked in longer.
      if (existing) {
        await prisma.deviceLocation.update({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId: device.id } }, data: { fetchedAt: new Date(), error: null } });
      } else {
        await prisma.deviceLocation.create({ data: { workspaceSlug, deviceId: device.id, lat: 0, lng: 0, fetchedAt: new Date(), error: "no_location_reported", source: null, recordedAt: null } });
      }
      return;
    }
    error = `Applivery returned ${res.status}`;
  } catch (e) {
    error = String(e);
  }

  if (existing) {
    await prisma.deviceLocation.update({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId: device.id } }, data: { fetchedAt: new Date(), error } });
  }
}

async function refreshLocationsBatch(targetIds: string[], devicesById: Map<string, NormalizedDevice>, authorization: string, workspaceSlug: string) {
  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  let cursor = 0;
  async function worker() {
    while (cursor < targetIds.length) {
      const idx = cursor++;
      const device = devicesById.get(targetIds[idx]);
      if (!device) continue;
      await fetchAndStoreDeviceLocation(headers, orgBase, device, workspaceSlug);
    }
  }
  await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, targetIds.length) }, worker));
}

/** Fire-and-forget entry point for the manual "Refresh locations" action (POST /api/geofences/refresh-locations) — uses the calling admin's own live session, unthrottled by the background budget. */
export async function manualRefreshDeviceLocations(targetIds: string[], devices: NormalizedDevice[], authorization: string, workspaceSlug: string) {
  const devicesById = new Map(devices.map((d) => [d.id, d]));
  await refreshLocationsBatch(targetIds, devicesById, authorization, workspaceSlug);
}

/** Called by locationJobs.ts's ticker with a budget-derived batch of device ids, oldest-synced-first. */
export async function refreshLocationsForDevices(deviceIds: string[], devices: NormalizedDevice[], authorization: string, workspaceSlug: string) {
  const devicesById = new Map(devices.map((d) => [d.id, d]));
  await refreshLocationsBatch(deviceIds, devicesById, authorization, workspaceSlug);
}

/** GET /api/geofences/location-refresh-status. */
export async function getLocationRefreshStatus(
  workspaceSlug: string,
  devices: NormalizedDevice[],
  policies: Array<{ enabled: boolean; conditions: any[]; targetDeviceAudienceId?: string | null }>,
) {
  const targetIds = geofenceScopedDeviceIds(devices, policies);
  const store = await loadLocationStore(workspaceSlug);
  const now = Date.now();

  let neverSynced = 0;
  let errorCount = 0;
  const agesMinutes: number[] = [];
  const rows = await prisma.deviceLocation.findMany({ where: { workspaceSlug, deviceId: { in: Array.from(targetIds) } } });
  const rowsById = new Map(rows.map((r) => [r.deviceId, r]));
  for (const did of targetIds) {
    const entry = store[did];
    if (!entry) {
      neverSynced += 1;
      continue;
    }
    if (rowsById.get(did)?.error) errorCount += 1;
    agesMinutes.push((now - entry.fetchedAt.getTime()) / 60000);
  }

  const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  const budget = clampLocationBudget(state?.locationRefreshBudgetPerHour);
  const estimatedFullCycleHours = budget && targetIds.size ? Math.round((targetIds.size / budget) * 10) / 10 : 0;
  agesMinutes.sort((a, b) => a - b);

  return {
    targetDeviceCount: targetIds.size,
    syncedCount: agesMinutes.length,
    neverSyncedCount: neverSynced,
    errorCount,
    oldestSyncAgeMinutes: agesMinutes.length ? Math.round(agesMinutes[agesMinutes.length - 1] * 10) / 10 : null,
    medianSyncAgeMinutes: agesMinutes.length ? Math.round(agesMinutes[Math.floor(agesMinutes.length / 2)] * 10) / 10 : null,
    refreshBudgetPerHour: budget,
    refreshBudgetMin: MIN_BUDGET,
    refreshBudgetMax: MAX_BUDGET,
    estimatedFullCycleHours,
  };
}

/** PUT /api/geofences/location-refresh-budget. */
export async function setLocationRefreshBudget(workspaceSlug: string, budgetPerHour: number) {
  const clamped = clampLocationBudget(budgetPerHour);
  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, locationRefreshBudgetPerHour: clamped },
    update: { locationRefreshBudgetPerHour: clamped },
  });
  return { locationRefreshBudgetPerHour: clamped };
}
