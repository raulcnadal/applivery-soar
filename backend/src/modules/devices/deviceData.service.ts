import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import type { Request } from "express";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { decryptSecret } from "../../utils/secretCipher";
import { liveCacheGet } from "../../services/liveCache";
import { DEVICE_SERIAL_INDEX_SOURCE } from "./devices.service";
import { assertMtlsIdentity } from "../../middleware/mtlsIdentity.middleware";
import { getMtlsEnforcementEnabled } from "../mtls/mtlsEnforcement.service";

// invalidateDevicesCache is loaded dynamically (not a static top-level
// import) below, same as compliance.service.ts/workflows.service.ts's own
// calls to it — devices.service.ts already statically imports
// loadDevicePushDataCache from this file, so a static import back here
// would be a circular top-level dependency between the two modules.
async function invalidateDevicesCacheFor(workspaceSlug: string): Promise<void> {
  const { invalidateDevicesCache } = await import("./devices.service");
  invalidateDevicesCache(workspaceSlug);
}
import { platformPathSegment } from "./deviceNormalize";
import type { NormalizedDevice } from "./deviceNormalize";
import type { InstalledAppsEntry } from "../appLists/installedApps.service";
import { normalizePushedAttributes, type DeviceAppReportPayload, type DeviceReportPayload, type EventNotifyPayload } from "./deviceData.schemas";

/**
 * The two device self-report webhooks a device's scheduled script POSTs to
 * — port of `report_device_data`/`report_device_apps` (main.py:7758-7804,
 * 9714-9804). Neither is dashboard-token protected: the caller is an
 * unattended script on an end-user device, not a logged-in admin. Auth was
 * originally entirely the X-Device-Report-Secret + X-Workspace-Slug header
 * pair (verifyDeviceReportSecret below), same trust model as Triggers'
 * /api/triggers/fire/{id}/{secret} — as of mTLS Phase C, every device-caller
 * route in this file (and the other 5 in deviceData.controller.ts) instead
 * calls verifyDeviceIdentity, which branches on this workspace's
 * mtlsEnforcementEnabled flag to require either a valid client certificate
 * or this legacy secret, never both on the same request. See
 * backend/docs/mtls-agent-auth-roadmap.md §7.
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

/**
 * mTLS Phase C — the enforcement-aware combinator every one of the 6
 * device-caller routes in deviceData.controller.ts now goes through instead
 * of calling verifyDeviceReportSecret directly. See
 * backend/docs/mtls-agent-auth-roadmap.md §7's rollout runbook: this
 * workspace's mtlsEnforcementEnabled flag (mtlsEnforcement.service.ts)
 * decides which auth this request must satisfy — the two modes are never
 * both accepted on the same request, matching the "hard cutover" rollout
 * mode confirmed for this feature. Devices themselves don't know or care
 * which mode is active; a Windows Agent switches to presenting its client
 * certificate the moment it holds one (mtls_windows.go's
 * applyLegacyAuthIfNeeded), independent of whether the backend has flipped
 * this flag yet — that's what makes the staged rollout (Phase B ships,
 * fleet migrates, THEN this flag flips) safe: both auth paths coexist at
 * the code level throughout, only the flag decides which one this specific
 * workspace's backend will currently accept.
 */
export async function verifyDeviceIdentity(req: Request, workspaceSlug: string): Promise<void> {
  const enforced = await getMtlsEnforcementEnabled(workspaceSlug);
  if (enforced) {
    await assertMtlsIdentity(req);
    return;
  }
  await verifyDeviceReportSecret(workspaceSlug, req.header("X-Device-Report-Secret"));
}

/**
 * Best-effort serial -> {id, displayName} lookup for the self-report
 * webhooks below — never a live Applivery call from a webhook handler (no
 * bearer token available in this request context, only the device-report
 * secret). Reads DEVICE_SERIAL_INDEX_SOURCE specifically, NOT the volatile
 * DEVICES_CACHE_SOURCE devices.service.ts's admin-facing reads use: that
 * cache gets invalidated at the end of every successful reportDeviceData
 * call (below), and since the Windows/macOS agent always sends its
 * app-inventory report immediately afterward in the same cycle, reading the
 * same cache key here would mean reportDeviceApps's lookup finds the entry
 * just-emptied and fails to match the very serial number that matched
 * moments earlier — a real bug this split was added to close (see
 * DEVICE_SERIAL_INDEX_SOURCE's doc comment in devices.service.ts).
 */
function cachedDeviceBySerial(workspaceSlug: string, serialNumber: string): { id: string; displayName: string | null } | null {
  const index = liveCacheGet<Record<string, { id: string; displayName: string | null }>>(workspaceSlug, DEVICE_SERIAL_INDEX_SOURCE);
  return index?.[serialNumber] ?? null;
}

/**
 * Port of `report_device_data` (main.py:7758). Upserts a DevicePushData row
 * keyed by (workspaceSlug, serialNumber, kind='attributes') — `payload`
 * always holds the LATEST normalized attributes (mirrors the original's
 * dict-keyed-by-serial replace-in-place semantics) while `reportCount`
 * (carried inside payload) increments each call.
 *
 * Also invalidates the devices cache (see bottom) — getDevicesFull bakes
 * this same push data into its cached blob (DEVICES_CACHE_TTL_SECONDS, 15
 * min), so without this a device could self-report a real change (e.g.
 * encryption flipping on) and the Devices/Compliance view would keep
 * showing the old state for up to 15 more minutes even on a plain,
 * cache-tolerant fetch. This does NOT force a live Applivery API pull —
 * it only clears the cache entry, so the *next* request (whenever the
 * frontend happens to make one) recomputes fresh instead of serving a
 * stale blob; background polling that hasn't changed still lands on a warm
 * cache exactly as before. Applivery's own rate limits are unaffected
 * since this is data the device pushed to us directly, not something we
 * had to go re-fetch from Applivery's API to learn.
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

  await invalidateDevicesCacheFor(workspaceSlug);

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
    .map((a) => ({
      identifier: String(a.identifier).toLowerCase(),
      name: a.name ?? null,
      version: String(a.version),
      // Passed through as-is (already validated to "msi" | "store" | undefined
      // by deviceAppReportPayloadSchema) — see installedApps.service.ts's
      // InstalledAppsEntry.apps[].origin doc comment.
      ...(a.origin ? { origin: a.origin } : {}),
    }))
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
    const { upsertInstalledAppsSlot } = await import("../appLists/installedApps.service");
    await upsertInstalledAppsSlot(workspaceSlug, deviceId, "selfReported", entry, new Date(nowIso));
    // Clear any earlier pending report for this same serial, now that it's matched.
    await prisma.pendingAppReport.deleteMany({ where: { workspaceSlug, deviceId: payload.serialNumber } });
    matchedFlag = true;
    // Same rationale as reportDeviceData above — installedAppsStore feeds
    // vulnServiceStatus/appleAppUpdateStatus, both baked into the cached
    // devices blob. Only worth doing on the matched branch: an unmatched
    // report only touches PendingAppReport, which no currently-normalized
    // device reads from yet.
    await invalidateDevicesCacheFor(workspaceSlug);
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

// Per-device cooldown for handleEventNotify below — deliberately separate
// from, and tighter than, forceEvaluateNow's own per-workspace cooldown
// (compliance.service.ts). The agent's own local debounce (§1.3 of the
// roadmap doc) is the primary defense against a burst of raw OS events
// turning into a burst of webhook calls, but this backend-side floor covers
// the case that debounce can't: an agent process restart resets its
// in-memory watcher/timer state, so a device that was mid-debounce at
// restart could otherwise fire again immediately. In-memory only, resets on
// a backend restart — same tradeoff as every other in-process cooldown map
// in this codebase (liveCache.ts, forceEvaluateNow's own map).
const lastEventNotifyAt = new Map<string, number>(); // key: `${workspaceSlug}:${serialNumber}`
const EVENT_NOTIFY_DEVICE_COOLDOWN_MS = 5_000;

/**
 * POST /api/device-data/event-notify — see eventWatches.service.ts's module
 * doc for the full design this is the reacting half of. The agent tells us
 * only WHICH watch fired (`watchKey`) and for which device (`serialNumber`)
 * — never what to do about it; `action` is resolved here, server-side,
 * against the matching EventWatchDefinition, so a Settings-only change
 * (retargeting a watch from one action to another, or disabling it) takes
 * effect on the very next fire with no agent-side awareness needed.
 *
 * Always returns 200 with a `status` field rather than erroring for the
 * "nothing to do" outcomes (cooldown, unknown/disabled watch, device not yet
 * matched) — none of these are the agent's fault or something it can act on,
 * so there's nothing worth it retrying or logging loudly for. Genuine
 * failures (e.g. the automation credential is missing) are also reported
 * back as a `status` rather than an HTTP error, for the same reason.
 *
 * Phase 4 metrics: this thin wrapper records one EventNotifyMetric row per
 * call (webhook volume) — regardless of what handleEventNotifyInner decided
 * — with the event-to-reaction latency computed from clientTimestamp vs.
 * "now" here at the outermost point, and rawEventCount passed straight
 * through from the agent. Deliberately NOT inside handleEventNotifyInner,
 * so every early-return status (cooldown, unknown watch, etc.) still gets
 * counted — a malformed payload that throws before reaching this point is
 * the one exception, treated as a client bug rather than real traffic.
 */
export async function handleEventNotify(workspaceSlug: string, payload: EventNotifyPayload): Promise<{ status: string; action: string | null }> {
  const result = await handleEventNotifyInner(workspaceSlug, payload);
  const { recordEventNotifyMetric } = await import("../compliance/eventWatches.service");
  await recordEventNotifyMetric(workspaceSlug, payload.watchKey, result.action, result.status, payload.rawEventCount ?? null, latencyMsSince(payload.clientTimestamp));
  return result;
}

/** Guards against clock skew (agent clock ahead of server) producing a nonsensical negative latency. */
function latencyMsSince(clientTimestamp: string | null | undefined): number | null {
  if (!clientTimestamp) return null;
  const t = Date.parse(clientTimestamp);
  if (Number.isNaN(t)) return null;
  const latency = Date.now() - t;
  return latency >= 0 ? latency : null;
}

async function handleEventNotifyInner(workspaceSlug: string, payload: EventNotifyPayload): Promise<{ status: string; action: string | null }> {
  if (!payload.serialNumber?.trim()) throw new HttpError(400, "serialNumber is required");
  if (!payload.watchKey?.trim()) throw new HttpError(400, "watchKey is required");

  const cooldownKey = `${workspaceSlug}:${payload.serialNumber}`;
  const now = Date.now();
  const last = lastEventNotifyAt.get(cooldownKey) ?? 0;
  if (now - last < EVENT_NOTIFY_DEVICE_COOLDOWN_MS) {
    return { status: "cooldown", action: null };
  }
  lastEventNotifyAt.set(cooldownKey, now);

  const { getEnabledWatchByKey } = await import("../compliance/eventWatches.service");
  const watch = await getEnabledWatchByKey(workspaceSlug, payload.platform, payload.watchKey);
  if (!watch) {
    // Deleted/disabled since the agent's last config poll, or a stale key
    // from an agent that hasn't re-synced its watcher set yet — neither is
    // an error, just nothing to do this time.
    return { status: "unknown_or_disabled_watch", action: null };
  }

  const matched = cachedDeviceBySerial(workspaceSlug, payload.serialNumber);
  if (!matched) {
    // Not in our cached device index yet — nothing targeted to refresh or
    // evaluate for a device SOAR doesn't know about. Its normal report cycle
    // (reportDeviceData above) will populate this the same way it always
    // has; this event-notify call simply has nothing to act on yet.
    return { status: "device_not_matched", action: watch.action };
  }

  if (watch.action === "refreshInstalledApps") {
    try {
      const { getAutomationBearer } = await import("../settings/automationCredential.service");
      const bearer = await getAutomationBearer(workspaceSlug);
      if (!bearer) return { status: "no_automation_credential", action: watch.action };
      // getDevicesFull is cached (DEVICES_CACHE_TTL_SECONDS) — this is a
      // cheap in-memory read on the common case, not a fresh live Applivery
      // fetch every time a watch fires. Dynamic import: same circular-
      // dependency avoidance as invalidateDevicesCacheFor above.
      const { getDevicesFull } = await import("./devices.service");
      const devicesResp = await getDevicesFull(bearer, workspaceSlug, false);
      const { manualRefreshInstalledApps } = await import("../appLists/installedApps.service");
      await manualRefreshInstalledApps([matched.id], devicesResp.items, bearer, workspaceSlug);
      return { status: "ok", action: watch.action };
    } catch (e) {
      console.warn(`[EventWatch] refreshInstalledApps for device ${matched.id} (workspace ${workspaceSlug}) failed: ${e}`);
      return { status: "error", action: watch.action };
    }
  }

  if (watch.action === "evaluateComplianceNow") {
    try {
      const { forceEvaluateNow } = await import("../compliance/compliance.service");
      await forceEvaluateNow(workspaceSlug);
      return { status: "ok", action: watch.action };
    } catch (e: any) {
      // forceEvaluateNow's own per-workspace cooldown throws HttpError(429)
      // — an expected, benign outcome here (something else already
      // triggered an evaluation for this workspace recently), not a real
      // failure worth surfacing as an error.
      if (e instanceof HttpError && e.statusCode === 429) return { status: "workspace_cooldown", action: watch.action };
      console.warn(`[EventWatch] evaluateComplianceNow for workspace ${workspaceSlug} failed: ${e}`);
      return { status: "error", action: watch.action };
    }
  }

  return { status: "unknown_action", action: watch.action };
}

/**
 * Flushes any app-inventory reports buffered in PendingAppReport (see
 * reportDeviceApps above) that can now be matched against `devices` — the
 * reconciler promised-but-never-implemented in this file's earlier history
 * ("the (not yet ported) installed-apps rolling refresher to reconcile").
 * Callers pass in a `devices` list they already fetched live (real Applivery
 * credentials, not the ephemeral cache reportDeviceApps itself is limited
 * to) — installedAppsJobs.ts's 30s refresher tick is the natural home for
 * this, since it already loads a fresh device list every tick for its own
 * budgeted-refresh work. A device usually only stays "pending" for one
 * report cycle now that DEVICE_SERIAL_INDEX_SOURCE (devices.service.ts) is
 * decoupled from the volatile devices-blob cache, but this closes the loop
 * for the genuinely first-ever report from a brand-new device, or any
 * workspace without an installed-apps refresher pass running yet.
 */
export async function reconcilePendingAppReports(workspaceSlug: string, devices: NormalizedDevice[]): Promise<number> {
  const pending = await prisma.pendingAppReport.findMany({ where: { workspaceSlug } });
  if (!pending.length) return 0;

  const bySerial = new Map(devices.filter((d) => d.serialNumber).map((d) => [d.serialNumber, d]));
  const nowIso = new Date().toISOString();
  let reconciled = 0;
  // PendingAppReport only ever buffers a self-reported entry (the only
  // caller that writes to it is reportDeviceApps above, when a device
  // hasn't matched Applivery's fleet yet) — always slots into "selfReported".
  const { upsertInstalledAppsSlot } = await import("../appLists/installedApps.service");

  for (const row of pending) {
    const device = bySerial.get(row.deviceId);
    if (!device) continue;
    await upsertInstalledAppsSlot(workspaceSlug, device.id, "selfReported", row.payload as any, new Date(nowIso));
    await prisma.pendingAppReport.delete({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId: row.deviceId } } });
    reconciled++;
  }

  if (reconciled > 0) {
    await invalidateDevicesCacheFor(workspaceSlug);
    await recordAuditEvent(workspaceSlug, {
      category: "system", action: "device_apps_reconciled", actor: "system",
      targetType: "device", targetId: "bulk", targetName: `${reconciled} device(s)`,
      message: `Reconciled ${reconciled} previously-buffered self-reported app inventory report(s) now that the device(s) matched Applivery's fleet.`,
    });
  }
  return reconciled;
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

export interface AgentStatusResponse {
  device: { matched: boolean; id: string | null; displayName: string | null };
  compliance: {
    available: boolean;
    reason?: string;
    compliant?: boolean;
    riskScore?: number | null;
    riskTier?: string | null;
    policies: Array<{ id: string; name: string; severity: string }>;
    violations?: Array<{ policyId: string; policyName: string | null; severity: string | null; lastDetectedAt: string | null }>;
  };
}

/**
 * Device-facing "what applies to me and how am I doing" read-back — the data
 * source for the Windows agent's tray icon context menu (and, eventually,
 * the same on other platforms). Same auth model as reportDeviceData/
 * reportDeviceApps above (X-Workspace-Slug + X-Device-Report-Secret, no
 * admin session), but this is the first device-facing endpoint that reads
 * compliance state back OUT rather than only ingesting reports.
 *
 * Compliance status/score is never persisted per-device (see
 * devices.service.ts's getDevicesFull doc comment) — it's computed live off
 * a cached-or-fresh Applivery fleet snapshot, same as the admin Devices view
 * uses, via getDevicesFull. That call needs a bearer token; unlike an admin
 * request there's no live session here, so this uses the workspace's stored
 * Automation Credential (automationCredential.service.ts) the same way the
 * background compliance/installed-apps jobs do. A workspace that hasn't
 * configured one yet still gets a valid response — `compliance.available:
 * false` with a human-readable reason — rather than an error, so an agent
 * whose admin hasn't set that up yet just shows "unavailable" in its tray
 * menu instead of failing its whole status poll.
 *
 * `policies` (the "applicable to this platform" list) is always populated
 * from Prisma directly, independent of whether compliance could be computed
 * — an agent should be able to show "which policies apply to me" even before
 * an Automation Credential exists or before this device has been seen by
 * Applivery yet.
 */
export async function getAgentStatus(workspaceSlug: string, serialNumber: string, platform: string): Promise<AgentStatusResponse> {
  const enabledPolicies = await prisma.compliancePolicy.findMany({ where: { workspaceSlug, enabled: true } });
  const scopedPolicies = enabledPolicies.filter((p: any) => !p.targetPlatform || p.targetPlatform === platform);
  const policiesSummary = scopedPolicies.map((p: any) => ({ id: p.id as string, name: p.name as string, severity: p.severity as string }));

  const { getAutomationBearer } = await import("../settings/automationCredential.service");
  const bearer = await getAutomationBearer(workspaceSlug);
  if (!bearer) {
    return {
      device: { matched: false, id: null, displayName: null },
      compliance: { available: false, reason: "No Automation Credential configured for this workspace yet — ask an admin to set one up under Settings.", policies: policiesSummary },
    };
  }

  try {
    const { getDevicesFull } = await import("../devices/devices.service");
    const devicesResp = await getDevicesFull(bearer, workspaceSlug, false);
    const match = devicesResp.items.find((d: any) => d.serialNumber === serialNumber) ?? null;
    if (!match) {
      return {
        device: { matched: false, id: null, displayName: null },
        compliance: { available: false, reason: "This device hasn't been matched in the Applivery fleet yet.", policies: policiesSummary },
      };
    }

    const policiesById: Map<string, any> = new Map(scopedPolicies.map((p: any) => [p.id as string, p]));
    const violations = ((match as any).policyViolations ?? []) as Array<{ policyId: string; policyName?: string | null; lastDetectedAt?: string | null }>;

    return {
      device: { matched: true, id: String((match as any).id), displayName: (match as any).displayName || serialNumber },
      compliance: {
        available: true,
        compliant: Boolean((match as any).policyCompliant),
        riskScore: (match as any).riskScore ?? null,
        riskTier: (match as any).riskTier ?? null,
        policies: policiesSummary,
        violations: violations.map((v) => ({
          policyId: v.policyId,
          policyName: v.policyName ?? policiesById.get(v.policyId)?.name ?? null,
          severity: policiesById.get(v.policyId)?.severity ?? null,
          lastDetectedAt: v.lastDetectedAt ?? null,
        })),
      },
    };
  } catch (e) {
    console.warn(`[DeviceData] getAgentStatus failed for workspace '${workspaceSlug}': ${e}`);
    return {
      device: { matched: false, id: null, displayName: null },
      compliance: { available: false, reason: "Could not compute compliance status right now — try again later.", policies: policiesSummary },
    };
  }
}
