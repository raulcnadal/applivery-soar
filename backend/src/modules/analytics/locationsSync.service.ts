import { appliveryClient } from "../../services/appliveryClient";
import { fetchAllPages } from "../../services/appliveryPaginate";
import { prisma } from "../../services/prisma";
import { extractItems } from "../../utils/extractItems";
import { HttpError } from "../../utils/httpError";
import { resolveOrgBase } from "../auth/rbac.service";

/**
 * GPS location sync — port of `sync_device_locations` (main.py:2601-2689),
 * the "Playground" globe's data source. Fires one Applivery request PER
 * DEVICE (bounded to 10 concurrent) — by far the single biggest per-click
 * API cost in the app, hence the per-workspace cooldown in front of it.
 *
 * Cache storage: the original kept one global (not per-workspace) JSON
 * blob keyed by device id — `LocationCache` mirrors that with a single
 * sentinel row (key='locations_cache') whose `payload` is the whole
 * `{deviceId: {lat,lng}}` map, read by the widget engine's `mdm_devices` /
 * `stats_devices_*` branch (see widgets.service.ts).
 */

const LOCATION_SYNC_MIN_INTERVAL_MS = 5 * 60_000; // 5 minutes
export const LOCATION_CACHE_KEY = "locations_cache";
const lastLocationSync = new Map<string, number>();

export async function syncDeviceLocations(authorization: string, workspaceSlug: string): Promise<{ status: string; synced_devices: number }> {
  const last = lastLocationSync.get(workspaceSlug);
  if (last !== undefined) {
    const elapsedMs = Date.now() - last;
    if (elapsedMs < LOCATION_SYNC_MIN_INTERVAL_MS) {
      const waitMinutes = Math.floor((LOCATION_SYNC_MIN_INTERVAL_MS - elapsedMs) / 60_000) + 1;
      throw new HttpError(429, `Location sync ran recently — it fires one request per device, so it's capped to once every ${LOCATION_SYNC_MIN_INTERVAL_MS / 60_000} minutes. Try again in about ${waitMinutes} minute(s).`);
    }
  }
  lastLocationSync.set(workspaceSlug, Date.now());

  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);

  let devices: any[];
  try {
    devices = await fetchAllPages(headers, `${orgBase}/mdm/devices/`);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(500, `Connection error to Applivery: ${e}`);
  }

  let cache: Record<string, { lat: number; lng: number }> = {};
  try {
    const row = await prisma.locationCache.findUnique({ where: { key: LOCATION_CACHE_KEY } });
    cache = (row?.payload as any) ?? {};
  } catch {
    cache = {};
  }

  const CONCURRENCY = 10;
  for (let i = 0; i < devices.length; i += CONCURRENCY) {
    const batch = devices.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (dev) => {
        const devId = String(dev.id ?? dev._id ?? "");
        if (!devId) return;
        const plat = String(dev.type ?? dev.platform ?? "").toLowerCase();
        let mdmType = "emmDevice";
        if (plat.includes("apple") || plat.includes("ios") || plat.includes("mac") || plat.includes("ipad")) mdmType = "admDevice";
        else if (plat.includes("win")) mdmType = "winDevice";
        try {
          const locRes = await appliveryClient.get<any>(`${orgBase}/mdm/locations/${mdmType}/${devId}?limit=1&sort=createdAt:desc`, { headers });
          if (locRes.status === 200) {
            const locItems = extractItems(locRes.data);
            if (locItems.length) {
              const latest = locItems[0];
              const lat = latest.latitude;
              const lng = latest.longitude;
              if (lat !== undefined && lat !== null && lng !== undefined && lng !== null) {
                cache[devId] = { lat: Number(lat), lng: Number(lng) };
              }
            }
          }
        } catch (e) {
          console.warn(`[Locations Sync] Failed location fetch for ${devId}: ${e}`);
        }
      }),
    );
  }

  try {
    await prisma.locationCache.upsert({
      where: { key: LOCATION_CACHE_KEY },
      create: { key: LOCATION_CACHE_KEY, payload: cache as any },
      update: { payload: cache as any, cachedAt: new Date() },
    });
  } catch (e) {
    console.warn(`[Locations Sync] Failed to write cache: ${e}`);
  }

  return { status: "success", synced_devices: Object.keys(cache).length };
}
