import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { decryptSecret } from "../../utils/secretCipher";
import { liveCacheGet } from "../../services/liveCache";
import { DEVICES_CACHE_SOURCE } from "./devices.service";
import { platformPathSegment } from "./deviceNormalize";
import type { NormalizedDevice } from "./deviceNormalize";
import type { InstalledAppsEntry } from "../appLists/installedApps.service";
import { normalizePushedAttributes, type DeviceAppReportPayload, type DeviceReportPayload } from "./deviceData.schemas";

/**
 * The two device self-report webhooks a device's scheduled script POSTs to
 * — port of `report_device_data`/`report_device_apps` (main.py:7758-7804,
 * 9714-9804). Neither is dashboard-token protected: the caller is an
 * unattended script on an end-user device, not a logged-in admin. Auth is
 * entirely the X-Device-Report-Secret + X-Workspace-Slug header pair
 * (verifyDeviceReportSecret below), same trust model as Triggers'
 * /api/triggers/fire/{id}/{secret}.
 */

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return cryptoTimingSafeEqual(bufA, bufB);
}

/** Port of `verify_device_report_secret` (main.py:7742) — fails closed: 503 if this workspace never generated a secret, 401 on mismatch. */
export async function verifyDeviceReportSecret(workspaceSlug: string, providedSecret: string | undefined): Promise<void> {
  const stored = await prisma.deviceReportSecret.findUnique({ where: { workspaceSlug } });
  if (!stored) {
    throw new HttpError(503, `No device-report webhook secret is configured for workspace '${workspaceSlug}'. Generate one from Settings.`);
  }
  const secret = decryptSecret(stored.secret);
  if (!providedSecret || !timingSafeEqual(providedSecret, secret)) {
    throw new HttpError(401, "Invalid device-report secret");
  }
}

/** Best-effort device name lookup from whatever's already in the (possibly stale) in-memory devices cache — never a live Applivery call from a webhook handler. */
function cachedDeviceBySerial(workspaceSlug: string, serialNumber: string): NormalizedDevice | null {
  const cached = liveCacheGet<{ items: NormalizedDevice[] }>(workspaceSlug, DEVICES_CACHE_SOURCE);
  if (!cached) return null;
  return cached.items.find((d) => d.serialNumber === serialNumber) ?? null;
}

/**
 * Port of `report_device_data` (main.py:7758). Upserts a DevicePushData row
 * keyed by (workspaceSlug, serialNumber, kind='attributes') — `payload`
 * always holds the LATEST normalized attributes (mirrors the original's
 * dict-keyed-by-serial replace-in-place semantics) while `reportCount`
 * (carried inside payload) increments each call.
 */
export async function reportDeviceData(workspaceSlug: string, payload: DeviceReportPayload): Promise<{ status: string; serialNumber: string; attributesStored: number }> {
  if (!payload.serialNumber || !payload.serialNumber.trim()) {
    throw new HttpError(400, "serialNumber is required");
  }
  const normalized = normalizePushedAttributes(payload.platform, payload.attributes ?? {});
  const nowIso = new Date().toISOString();

  const existing = await prisma.devicePushData.findUnique({
    where: { workspaceSlug_deviceId_kind: { workspaceSlug, deviceId: payload.serialNumber, kind: "attributes" } },
  });
  const existingPayload = (existing?.payload as Record<string, any>) ?? {};
  const record = {
    platform: payload.platform,
    attributes: normalized,
    // Custom check results (customChecks.service.ts) ride along on this same
    // row/call rather than a separate table — a device's "latest known
    // state from its agent" is one concept. Only overwritten when the agent
    // actually sends a customCheckResults block this cycle; an older agent
    // build that predates this feature (or a cycle where the agent's poll
    // for check definitions failed) leaves the previous results in place
    // instead of silently wiping them.
    customCheckResults: payload.customCheckResults ?? existingPayload.customCheckResults ?? null,
    agentVersion: payload.agentVersion ?? null,
    clientReportedAt: payload.reportedAt ?? null,
    reportCount: (existingPayload.reportCount ?? 0) + 1,
  };
  await prisma.devicePushData.upsert({
    where: { workspaceSlug_deviceId_kind: { workspaceSlug, deviceId: payload.serialNumber, kind: "attributes" } },
    create: { workspaceSlug, deviceId: payload.serialNumber, kind: "attributes", payload: record as any, reportedAt: new Date(nowIso) },
    update: { payload: record as any, reportedAt: new Date(nowIso) },
  });

  const matched = cachedDeviceBySerial(workspaceSlug, payload.serialNumber);
  const deviceName = matched?.displayName || payload.serialNumber;

  await recordAuditEvent(workspaceSlug, {
    category: "system", action: "device_data_received", actor: "device",
    targetType: "device", targetId: payload.serialNumber, targetName: deviceName,
    message: `Received self-reported data from "${deviceName}" (${payload.platform}) — ${Object.keys(normalized).length} attribute(s)`,
  });

  return { status: "ok", serialNumber: payload.serialNumber, attributesStored: Object.keys(normalized).length };
}

/**
 * Port of `report_device_apps` (main.py:9721). Same {identifier, name,
 * version} shape `fetchAndStoreInstalledApps` writes for the MDM-sourced
 * path (installedApps.service.ts), so downstream consumers (App List
 * compliance, Vulnerability Service app matching) read one uniform "apps"
 * list regardless of source. Resolves serial -> Applivery device id against
 * whatever's already cached; if unresolved, buffers into PendingAppReport
 * for the (not yet ported) installed-apps rolling refresher to reconcile.
 */
export async function reportDeviceApps(workspaceSlug: string, payload: DeviceAppReportPayload): Promise<{ status: string; serialNumber: string; appsReported: number; matched: boolean }> {
  if (!payload.serialNumber || !payload.serialNumber.trim()) {
    throw new HttpError(400, "serialNumber is required");
  }
  const rawApps = payload.apps ?? [];
  const identifiers = Array.from(new Set(rawApps.filter((a) => a?.identifier).map((a) => String(a.identifier).toLowerCase()))).sort();
  const versionedApps = rawApps
    .filter((a) => a?.identifier && a?.version)
    .map((a) => ({ identifier: String(a.identifier).toLowerCase(), name: a.name ?? null, version: String(a.version) }))
    .sort((a, b) => a.identifier.localeCompare(b.identifier));

  const nowIso = new Date().toISOString();
  const platformPath = platformPathSegment(payload.platform) ?? payload.platform;

  const matched = cachedDeviceBySerial(workspaceSlug, payload.serialNumber);
  const deviceId = matched?.id ?? null;
  const deviceName = matched?.displayName || payload.serialNumber;

  const entry: InstalledAppsEntry = {
    identifiers,
    apps: versionedApps,
    platform: platformPath,
    fetchedAt: nowIso,
    error: null,
    source: "self_reported",
    appleAppUpdates: null,
  };
  // agentVersion/clientReportedAt aren't part of InstalledAppsEntry's own
  // shape (that type mirrors the MDM-sourced fetch, which has no such
  // fields) — attached as extra keys the same way the original's dict
  // stores them alongside the standard entry fields.
  (entry as any).agentVersion = payload.agentVersion ?? null;
  (entry as any).clientReportedAt = payload.reportedAt ?? null;

  let matchedFlag: boolean;
  if (deviceId) {
    await prisma.installedAppInventory.upsert({
      where: { workspaceSlug_deviceId: { workspaceSlug, deviceId } },
      create: { workspaceSlug, deviceId, apps: entry as any, reportedAt: new Date(nowIso) },
      update: { apps: entry as any, reportedAt: new Date(nowIso) },
    });
    // Clear any earlier pending report for this same serial, now that it's matched.
    await prisma.pendingAppReport.deleteMany({ where: { workspaceSlug, deviceId: payload.serialNumber } });
    matchedFlag = true;
  } else {
    // Not in our cached device list yet — buffer by serial number, upserted
    // in place (mirrors the original's dict-keyed-by-serial overwrite).
    await prisma.pendingAppReport.upsert({
      where: { workspaceSlug_deviceId: { workspaceSlug, deviceId: payload.serialNumber } },
      create: { workspaceSlug, deviceId: payload.serialNumber, payload: entry as any },
      update: { payload: entry as any },
    });
    matchedFlag = false;
  }

  await recordAuditEvent(workspaceSlug, {
    category: "system", action: "device_apps_received", actor: "device",
    targetType: "device", targetId: payload.serialNumber, targetName: deviceName,
    message:
      `Received self-reported app inventory from "${deviceName}" (${payload.platform}) — ${identifiers.length} app(s)` +
      (matchedFlag ? "" : " (buffered — device not yet matched to Applivery)"),
  });

  return { status: "ok", serialNumber: payload.serialNumber, appsReported: identifiers.length, matched: matchedFlag };
}

/**
 * Loads every device's latest self-reported attribute record for this
 * workspace, keyed by serial number — port of `_load_device_pushdata`'s
 * return shape (main.py:7663), used by devices.service.ts's getDevicesFull
 * to populate NormalizedDevice.selfReported (compliance's
 * selfReportedAttribute/selfReportDaysAgo/hasSelfReported conditions read
 * straight off that field).
 */
export async function loadDevicePushDataCache(workspaceSlug: string): Promise<Record<string, unknown>> {
  const rows = await prisma.devicePushData.findMany({ where: { workspaceSlug, kind: "attributes" } });
  const cache: Record<string, unknown> = {};
  for (const row of rows) {
    const payload = (row.payload as Record<string, any>) ?? {};
    cache[row.deviceId] = { ...payload, lastReportedAt: row.reportedAt.toISOString() };
  }
  return cache;
}

/** Port of `get_self_reported_attribute_names` (main.py:10184) — distinct attribute names ever pushed, for the Policy Builder's autocomplete. */
export async function getSelfReportedAttributeNames(workspaceSlug: string, platform?: string): Promise<string[]> {
  const rows = await prisma.devicePushData.findMany({ where: { workspaceSlug, kind: "attributes" } });
  const names = new Set<string>();
  for (const row of rows) {
    const payload = (row.payload as Record<string, any>) ?? {};
    if (platform && payload.platform !== platform) continue;
    for (const key of Object.keys(payload.attributes ?? {})) names.add(key);
  }
  return Array.from(names).sort();
}
