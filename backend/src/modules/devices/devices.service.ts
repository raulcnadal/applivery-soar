import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { appliveryClient } from "../../services/appliveryClient";
import { fetchAllPages } from "../../services/appliveryPaginate";
import { recordAuditEvent } from "../../services/auditLog";
import { DEVICES_CACHE_TTL_SECONDS, liveCacheGet, liveCacheInvalidateSource, liveCacheSet } from "../../services/liveCache";
import { prisma } from "../../services/prisma";
import { extractItems } from "../../utils/extractItems";
import { HttpError } from "../../utils/httpError";
import { resolveOrgBase } from "../auth/rbac.service";
import {
  computeDeviceRisk,
  normalizeDeviceFull,
  platformPathSegment,
  type DeviceAudienceRef,
  type NormalizedDevice,
} from "./deviceNormalize";
import type { BulkReattestPayload, PoliciesUpdatePayload, SegmentUpdatePayload, TagsUpdatePayload } from "./devices.schemas";
import { loadOsUpdateCatalog, computeWindowsPendingUpdates } from "../catalogs/osUpdateCatalog";
import { loadVulnCatalog, computeApplePendingVulns, computeAndroidPendingVulns } from "../catalogs/vulnCatalog";
import { loadOsLifecycleCatalog, computeOsLifecycleStatus } from "../catalogs/osLifecycleCatalog";
import { loadGdmfCatalog } from "../catalogs/gdmfCatalog";
import { loadInstalledAppsStore, type InstalledAppsEntry } from "../appLists/installedApps.service";
import { getVulnServiceConfig, computeVulnServiceStatus } from "../catalogs/vulnService";
import { loadDevicePushDataCache } from "./deviceData.service";
import { LOCATION_CACHE_KEY } from "../analytics/locationsSync.service";
import { executeMdmAction } from "../workflows/mdmActionExecutor";
import { createScriptAsset } from "../workflows/scriptAssetUpload";

// Port of `SECURITY_REPORT_SCRIPT_FILES`/`REATTEST_LIBRARY_ENTRY_NAME`
// (main.py:7883-7899) — same script templates deviceReportScripts.controller.ts
// already serves for the one-time scheduled-task setup; bulk-reattest reuses
// them as the payload for an on-demand Action Library "script" entry.
const SCRIPTS_DIR = path.resolve(__dirname, "../../../scripts");
const SECURITY_REPORT_SCRIPT_FILES: Record<string, string> = {
  windows: "report-security-attributes.ps1",
  macos: "report-security-attributes.sh",
};
const REATTEST_LIBRARY_ENTRY_NAME: Record<string, string> = {
  windows: "Security Attestation Reporter (Windows)",
  macos: "Security Attestation Reporter (macOS)",
};

/**
 * Port of `_ensure_reattest_library_entry` (main.py:7900-7931). The
 * attestation reporter scripts are normally installed once as a scheduled
 * task (Task Scheduler/launchd own the recurring run, not Applivery) — this
 * finds, or the first time it's needed silently creates, an Action Library
 * "script" entry pointing at that same script uploaded as an Applivery
 * Asset, so a bulk "re-attest now" has something it can push via the same
 * runScript primitive every other MDM action dispatch uses
 * (mdmActionExecutor.ts). Idempotent — matched by (workspaceSlug, type,
 * platform, name), same lookup the original does by name within the
 * workspace's Action Library list.
 */
async function ensureReattestLibraryEntry(authorization: string, orgBase: string, workspaceSlug: string, platform: string): Promise<{ id: string } | null> {
  const name = REATTEST_LIBRARY_ENTRY_NAME[platform];
  if (!name) return null;
  const existing = await prisma.actionLibraryEntry.findFirst({ where: { workspaceSlug, type: "script", platform, name } });
  if (existing) return existing;

  const scriptFilename = SECURITY_REPORT_SCRIPT_FILES[platform];
  const scriptPath = scriptFilename ? path.join(SCRIPTS_DIR, scriptFilename) : null;
  if (!scriptPath || !existsSync(scriptPath)) return null;
  const content = await readFile(scriptPath, "utf-8");

  const uploadBase = orgBase.replace("https://api.applivery.io", "https://upload.applivery.io");
  const { asset, error } = await createScriptAsset(
    authorization,
    uploadBase,
    name,
    "Auto-registered so 'Re-attest now' can push this on demand.",
    content,
    platform,
    null,
    true,
  );
  if (error || !asset) return null;

  return prisma.actionLibraryEntry.create({
    data: {
      workspaceSlug,
      type: "script",
      name,
      description: "Auto-registered so 'Re-attest now' can push this on demand.",
      platform,
      assetId: asset.id,
      assetName: asset.name,
      arguments: "",
      scope: "machine",
    },
  });
}

export const DEVICES_CACHE_SOURCE = "devices_full";

// Port of `CASE_OPEN_STATUSES` (main.py:11801) — Cases don't exist yet
// (Phase 5), so this always yields zero rows for now; kept as the real
// query shape so wiring in Phase 5 is additive, not a rewrite.
const CASE_OPEN_STATUSES = ["open", "investigating"];

type Headers = Record<string, string>;

/**
 * Device Audiences are a dynamic, cross-platform grouping feature distinct
 * from MDM Policies/Segments; membership isn't carried on the device record
 * itself. Port of `_fetch_device_audience_membership_map` (main.py:2952) —
 * see that function's extensive docstring for the id-space history this
 * mirrors verbatim. Every failure branch is logged (not silently swallowed)
 * for the same reason: an empty map must stay distinguishable from "this
 * audience genuinely has no members."
 */
async function fetchDeviceAudienceMembershipMap(
  headers: Headers,
  orgBase: string,
  rawDevices: Array<Record<string, any>>,
): Promise<Record<string, DeviceAudienceRef[]>> {
  const platformIdToUnifiedId = new Map<string, string>();
  for (const raw of rawDevices) {
    const unifiedId = String(raw.id ?? raw._id ?? "");
    if (!unifiedId) continue;
    platformIdToUnifiedId.set(unifiedId, unifiedId);
    for (const platformField of ["admDevice", "emmDevice", "winDevice"]) {
      const pid = raw[platformField];
      if (pid) platformIdToUnifiedId.set(String(pid), unifiedId);
    }
  }

  const audienceMap: Record<string, DeviceAudienceRef[]> = {};
  let audiences: Array<Record<string, any>>;
  try {
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/device-audiences`, { headers, params: { limit: 500 } });
    if (res.status !== 200) {
      console.warn(`[Device Audiences] Failed to list audiences: HTTP ${res.status} — ${String(JSON.stringify(res.data)).slice(0, 300)}`);
      return audienceMap;
    }
    audiences = extractItems(res.data);
  } catch (e) {
    console.warn(`[Device Audiences] Failed to list audiences: ${e}`);
    return audienceMap;
  }

  for (const aud of audiences) {
    const audId = String(aud.id ?? aud._id ?? "");
    const audName = aud.name ?? "Unnamed audience";
    if (!audId) continue;
    let previewItems: Array<Record<string, any>>;
    try {
      previewItems = await fetchAllPages(headers, `${orgBase}/mdm/device-audiences/${audId}/preview`);
    } catch (e) {
      console.warn(`[Device Audiences] Failed to preview membership for "${audName}" (${audId}): ${e}`);
      continue;
    }
    const memberIds = new Set<string>();
    let unresolvedCount = 0;
    let rawMemberCount = 0;
    for (const dev of previewItems) {
      const rawMemberId = dev.id ?? dev._id;
      if (!rawMemberId) continue;
      rawMemberCount += 1;
      const rawMemberIdStr = String(rawMemberId);
      const unifiedId = platformIdToUnifiedId.get(rawMemberIdStr);
      if (unifiedId) {
        memberIds.add(unifiedId);
      } else {
        memberIds.add(rawMemberIdStr);
        unresolvedCount += 1;
      }
    }
    if (rawMemberCount && unresolvedCount) {
      console.warn(
        `[Device Audiences] "${audName}" (${audId}): ${unresolvedCount}/${rawMemberCount} member id(s) didn't match any known device id (unified or platform-native) — membership for those may be wrong.`,
      );
    }
    for (const devId of memberIds) {
      if (!audienceMap[devId]) audienceMap[devId] = [];
      audienceMap[devId].push({ id: audId, name: audName });
    }
  }

  return audienceMap;
}

/**
 * Full normalized device fleet for the Devices view — port of
 * `get_devices_full` (main.py:3420). One org-level call for all devices,
 * one for the compliant subset, no per-device requests. Cached for
 * DEVICES_CACHE_TTL_SECONDS (15 min); pass refresh=true to force a live pull.
 *
 * Every dependency below is live: Compliance Policy violations/state (from
 * `complianceEvaluationState`), the OS-update/vuln/lifecycle/GDMF catalogs
 * and their background-refresher jobs, the installed-apps store, the
 * Vulnerability Service integration, and Cases (open-case lookup against
 * the `Case` table) — see the per-field loads below.
 */
export async function getDevicesFull(
  authorization: string,
  workspaceSlug: string,
  refresh = false,
): Promise<{ items: NormalizedDevice[]; total: number; fetchedAt: string }> {
  const slugKey = workspaceSlug || "global";

  if (!refresh) {
    const cached = liveCacheGet<{ items: NormalizedDevice[]; total: number; fetchedAt: string }>(slugKey, DEVICES_CACHE_SOURCE);
    if (cached !== null) return cached;
  }

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);

  const itemsAll = await fetchAllPages(headers, `${orgBase}/mdm/devices/`);
  const itemsComp = await fetchAllPages(headers, `${orgBase}/mdm/devices/`, { isCompliance: "true" });
  const compIds = new Set(itemsComp.map((i) => String(i.id ?? i._id ?? "")));
  const audienceMap = await fetchDeviceAudienceMembershipMap(headers, orgBase, itemsAll);

  // Location cache (Playground globe GPS pings, synced by locationsSync.service.ts)
  // and device push-data (Windows/macOS self-report agent, populated by
  // deviceData.service.ts's /api/device-data/report) — both real as of Phase 8.
  let locCache: Record<string, unknown> = {};
  try {
    const row = await prisma.locationCache.findUnique({ where: { key: LOCATION_CACHE_KEY } });
    locCache = (row?.payload as Record<string, unknown>) ?? {};
  } catch (e) {
    console.warn(`[Devices] locationCache lookup failed: ${e}`);
  }
  const pushdataCache = await loadDevicePushDataCache(slugKey);

  const normalized = itemsAll.map((d) => normalizeDeviceFull(d, compIds, locCache, audienceMap, pushdataCache));

  // Cases/Compliance-violations/Compliance-state lookups, loaded once per
  // fleet-wide call — same batching philosophy as everything else here,
  // avoiding N queries for a device list that can run into the thousands.
  // Port of main.py:3465-3519.
  const openCasesByDevice: Record<string, Array<Record<string, any>>> = {};
  try {
    const openCases = await prisma.case.findMany({ where: { workspaceSlug: slugKey, status: { in: CASE_OPEN_STATUSES }, deviceId: { not: null } } });
    for (const c of openCases) {
      if (!c.deviceId) continue;
      (openCasesByDevice[c.deviceId] ??= []).push({ id: c.id, title: c.title, severity: c.severity, status: c.status });
    }
  } catch (e) {
    console.warn(`[Devices] openCasesByDevice lookup failed: ${e}`);
  }

  const activeViolationsByDevice: Record<string, Array<Record<string, any>>> = {};
  try {
    // "pending" = still awaiting review (the Compliance view's own "Awaiting
    // review" queue) — approved/dismissed violations already had an analyst
    // decide what to do about them.
    const pendingViolations = await prisma.complianceViolation.findMany({ where: { workspaceSlug: slugKey, status: "pending" } });
    for (const v of pendingViolations) {
      (activeViolationsByDevice[v.deviceId] ??= []).push({ id: v.id, policyId: v.policyId, policyName: v.policyName, detectedAt: v.detectedAt.toISOString() });
    }
  } catch (e) {
    console.warn(`[Devices] activeViolationsByDevice lookup failed: ${e}`);
  }

  // Policy-based compliance: _load_compliance_state is the live source of
  // truth for "still currently violating" — one entry per policy+device
  // pair, added the moment an evaluation pass detects a violation and
  // deleted the moment the device recovers, regardless of the violation
  // record's own review status. Unlike activeViolationsByDevice above
  // (deliberately narrowed to 'pending'), this is every still-open
  // violation — what "is this device compliant with our policies right
  // now" actually needs.
  const policyViolationsByDevice: Record<string, Array<Record<string, any>>> = {};
  try {
    const stateRow = await prisma.complianceEvaluationState.findUnique({ where: { workspaceSlug: slugKey } });
    const state = (stateRow?.state as unknown as Record<string, { status: string; lastDetectedAt: string }>) ?? {};
    if (Object.keys(state).length) {
      const policies = await prisma.compliancePolicy.findMany({ where: { workspaceSlug: slugKey } });
      const policiesById = new Map(policies.map((p) => [p.id, p]));
      for (const [key, entry] of Object.entries(state)) {
        const sepIdx = key.indexOf(":");
        if (sepIdx < 0) continue;
        const policyId = key.slice(0, sepIdx);
        const deviceId = key.slice(sepIdx + 1);
        if (!deviceId) continue;
        (policyViolationsByDevice[deviceId] ??= []).push({
          policyId, policyName: policiesById.get(policyId)?.name ?? null,
          status: entry.status, lastDetectedAt: entry.lastDetectedAt,
        });
      }
    }
  } catch (e) {
    console.warn(`[Devices] policyViolationsByDevice lookup failed: ${e}`);
  }

  // Intelligence catalogs — loaded once per fleet-wide call, same batching
  // philosophy. Port of main.py:3521-3550.
  const [osUpdateCatalog, vulnCatalog, osLifecycleCatalog, gdmfCatalog, installedAppsStore, vulnServiceCfg] = await Promise.all([
    loadOsUpdateCatalog(),
    loadVulnCatalog(),
    loadOsLifecycleCatalog(),
    loadGdmfCatalog(),
    loadInstalledAppsStore(slugKey),
    getVulnServiceConfig(slugKey),
  ]);

  for (const d of normalized) {
    const deviceId = d.id;
    const openCases = openCasesByDevice[deviceId] ?? [];
    const activeViolations = activeViolationsByDevice[deviceId] ?? [];
    d.openCases = openCases;
    d.activeViolations = activeViolations;
    const policyViolations = policyViolationsByDevice[deviceId] ?? [];
    d.policyViolations = policyViolations;
    d.policyCompliant = policyViolations.length === 0;

    d.osUpdateStatus = d.platform === "windows" ? computeWindowsPendingUpdates(d.osVersion, osUpdateCatalog) : null;
    if (d.platform === "apple" || d.platform === "macos") {
      d.vulnStatus = computeApplePendingVulns(d.platform, d.osVersion, vulnCatalog);
    } else if (d.platform === "android") {
      d.vulnStatus = computeAndroidPendingVulns(d.osVersion, vulnCatalog);
    } else {
      d.vulnStatus = null;
    }
    d.osLifecycleStatus = computeOsLifecycleStatus(d.platform, d.osVersion, osLifecycleCatalog, d.model, gdmfCatalog);

    // installedAppsStore carries a versioned "apps" list for every platform,
    // not just Apple — appleAppUpdateStatus stays Apple-only (sourced from
    // Applivery's own HasUpdateAvailable flag, which only Apple exposes),
    // but the raw entry feeds the Vulnerability Service lookup for all
    // platforms below.
    const appsEntry: InstalledAppsEntry | null = installedAppsStore[String(deviceId)] ?? null;
    d.appleAppUpdateStatus = d.platform === "apple" || d.platform === "macos" ? appsEntry?.appleAppUpdates ?? null : null;
    d.vulnServiceStatus = vulnServiceCfg.enabled ? await computeVulnServiceStatus(slugKey, d, appsEntry) : null;

    Object.assign(d, computeDeviceRisk(d, openCases, activeViolations));
  }

  const responseData = {
    items: normalized,
    total: normalized.length,
    fetchedAt: new Date().toISOString(),
  };

  liveCacheSet(slugKey, DEVICES_CACHE_SOURCE, responseData, DEVICES_CACHE_TTL_SECONDS);
  return responseData;
}

/**
 * Single-device compliance/risk detail — port of `get_device_compliance`
 * (main.py:3589). Deliberately reuses getDevicesFull's own cached-or-live
 * fleet computation rather than duplicating risk-scoring/violation-lookup
 * logic in a second place.
 */
export async function getDeviceCompliance(authorization: string, workspaceSlug: string, deviceId: string) {
  const full = await getDevicesFull(authorization, workspaceSlug, false);
  const match = full.items.find((d) => String(d.id) === String(deviceId));
  if (!match) {
    throw new HttpError(404, "Device not found in the current fleet snapshot");
  }
  return {
    id: match.id,
    isCompliant: match.isCompliant,
    policyCompliant: match.policyCompliant,
    riskScore: match.riskScore,
    riskTier: match.riskTier,
    riskFactors: match.riskFactors,
    policyViolations: match.policyViolations,
    activeViolations: match.activeViolations,
    openCases: match.openCases,
  };
}

/**
 * Port of `get_device_firewall_state` (main.py:5488). Reads
 * FirewallRemediationState rows for this device (one row per ruleset
 * applied) into the original's `{active: [...]}` shape. Populated once the
 * Workflows engine's firewall actions (applyFirewallRuleSet/
 * restoreFirewallRuleSet, firewallRuleSets.service.ts) have dispatched at
 * least once for this device.
 */
export async function getDeviceFirewallState(workspaceSlug: string, deviceId: string) {
  const slugKey = workspaceSlug || "global";
  const rows: Array<{ appliedState: unknown }> = await prisma.firewallRemediationState.findMany({ where: { workspaceSlug: slugKey, deviceId } });
  if (rows.length === 0) return { active: [] };
  return { active: rows.map((r) => r.appliedState) };
}

export function invalidateDevicesCache(workspaceSlug: string) {
  liveCacheInvalidateSource(workspaceSlug || "global", DEVICES_CACHE_SOURCE);
}

/**
 * Maps a normalized platform to the URL segment Applivery's `mdm/locations`,
 * `mdm/network-status`, and `mdm/agent-logs` endpoints expect (distinct from
 * `platformPathSegment`'s apple/android/windows segment, used for a
 * different set of `mdm/{platform}/enterprise/...` device-management URLs).
 * Mirrors the original frontend's own local mapping (App.jsx's
 * DeviceInsightCard extras effect: apple/ios/mac/ipad -> admDevice,
 * win -> winDevice, else -> emmDevice) — now server-side, see below.
 */
function mdmTypeSegment(platform: string): string {
  if (platform === "apple" || platform === "macos") return "admDevice";
  if (platform === "windows") return "winDevice";
  return "emmDevice";
}

/**
 * The Playground device-insight card's 4 "extras" fetches — location
 * history, network status, agent logs, and segment assets. The original
 * frontend (App.jsx:2262-2300) called these directly from the browser
 * against `https://api.applivery.io/...` using the user's own Applivery API
 * token, bypassing its Python backend entirely. This migration originally
 * ported that same direct-from-browser pattern 1:1 for Phase 8, but on
 * review that's worse practice for this stack (it means shipping the raw
 * Applivery bearer token to client JS beyond what's already unavoidable,
 * and bypasses this backend's own request logging/error handling) — so
 * these were moved server-side as proper proxy endpoints, following the
 * same resolveOrgBase + appliveryClient pattern as every other device
 * proxy call in this file. Each fails soft (empty `items`, logged) rather
 * than throwing, since this is supplementary detail-card content, not
 * critical path — matches the original's own `.catch(() => null)` per-call
 * failure handling.
 */
export async function getDeviceLocations(authorization: string, workspaceSlug: string, deviceId: string, platform: string) {
  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  try {
    const orgBase = await resolveOrgBase(headers, workspaceSlug);
    const mdmType = mdmTypeSegment(platform);
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/locations/${mdmType}/${deviceId}`, { headers, params: { limit: 50, sort: "createdAt:desc" } });
    return { items: extractItems(res.data) };
  } catch (e) {
    console.warn(`[Devices] getDeviceLocations(${deviceId}) failed: ${e}`);
    return { items: [] };
  }
}

export async function getDeviceNetworkStatus(authorization: string, workspaceSlug: string, deviceId: string, platform: string) {
  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  try {
    const orgBase = await resolveOrgBase(headers, workspaceSlug);
    const mdmType = mdmTypeSegment(platform);
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/network-status/${mdmType}/${deviceId}`, { headers, params: { limit: 1, sort: "createdAt:desc" } });
    return { items: extractItems(res.data) };
  } catch (e) {
    console.warn(`[Devices] getDeviceNetworkStatus(${deviceId}) failed: ${e}`);
    return { items: [] };
  }
}

export async function getDeviceAgentLogs(authorization: string, workspaceSlug: string, deviceId: string, platform: string) {
  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  try {
    const orgBase = await resolveOrgBase(headers, workspaceSlug);
    const mdmType = mdmTypeSegment(platform);
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/agent-logs/`, { headers, params: { deviceId, deviceType: mdmType, limit: 50, sort: "createdAt:desc" } });
    return { items: extractItems(res.data) };
  } catch (e) {
    console.warn(`[Devices] getDeviceAgentLogs(${deviceId}) failed: ${e}`);
    return { items: [] };
  }
}

export async function getDeviceAssets(authorization: string, workspaceSlug: string, segmentId: string | null) {
  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  try {
    const orgBase = await resolveOrgBase(headers, workspaceSlug);
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/assets/`, { headers, params: { limit: 100, segmentId: segmentId ?? "", expandTo: "ancestors" } });
    return { items: extractItems(res.data) };
  } catch (e) {
    console.warn(`[Devices] getDeviceAssets(${segmentId}) failed: ${e}`);
    return { items: [] };
  }
}

/** Move a device to a different segment — port of `update_device_segment` (main.py:4085). */
export async function updateDeviceSegment(authorization: string, workspaceSlug: string, deviceId: string, payload: SegmentUpdatePayload) {
  const platformPath = platformPathSegment(payload.platform);
  if (!platformPath) throw new HttpError(400, `Unsupported platform '${payload.platform}' for segment move`);

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const url = `${orgBase}/mdm/${platformPath}/enterprise/devices/${deviceId}/move`;
  const res = await appliveryClient.put(url, { segmentId: payload.segmentId }, { headers });
  if (res.status >= 300) {
    throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  }
  invalidateDevicesCache(workspaceSlug);
  return { status: "ok" };
}

/** Replace a device's tags — port of `update_device_tags` (main.py:4110). */
export async function updateDeviceTags(authorization: string, workspaceSlug: string, deviceId: string, payload: TagsUpdatePayload) {
  const platformPath = platformPathSegment(payload.platform);
  if (!platformPath) throw new HttpError(400, `Unsupported platform '${payload.platform}' for tag update`);

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const url = `${orgBase}/mdm/${platformPath}/enterprise/devices/${deviceId}`;
  const res = await appliveryClient.put(url, { tags: payload.tags }, { headers });
  if (res.status >= 300) {
    throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  }
  invalidateDevicesCache(workspaceSlug);
  return { status: "ok" };
}

/**
 * Push a device's policy stack — port of `_apply_device_policies`
 * (main.py:4196). Shared by the manual reassignment endpoint below and,
 * later, the Workflow engine's policy_replace/policy_add/policy_restore
 * steps (Phase 4) — this is the one place that knows the per-platform
 * payload shape.
 */
export async function applyDevicePolicies(
  authorization: string,
  workspaceSlug: string,
  platform: string,
  deviceId: string,
  policies: Array<{ id?: string | null; name?: string | null }>,
): Promise<{ ok: boolean; detail: string }> {
  const platformPath = platformPathSegment(platform);
  if (!platformPath || !["apple", "android", "windows"].includes(platformPath)) {
    return { ok: false, detail: `Policy stack management isn't wired up for '${platform}' yet` };
  }

  const primaryKey = platformPath === "windows" ? "winPolicyId" : "policyId";
  const assignKey = { apple: "admPolicyAssignments", android: "emmPolicyAssignments", windows: "winPolicyAssignments" }[platformPath as "apple" | "android" | "windows"];
  const assignIdKey = { apple: "admPolicyId", android: "emmPolicyId", windows: "winPolicyId" }[platformPath as "apple" | "android" | "windows"];

  const primaryId = policies.length > 0 ? policies[0].id : null;
  const assignments = policies.slice(1).map((p, i) => ({ [assignIdKey]: p.id, priority: i + 1 }));
  const body: Record<string, unknown> = { [primaryKey]: primaryId, [assignKey]: assignments };

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const url = `${orgBase}/mdm/${platformPath}/enterprise/devices/${deviceId}`;
  const res = await appliveryClient.put(url, body, { headers });
  if (res.status >= 300) {
    return { ok: false, detail: `API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 200)}` };
  }
  return { ok: true, detail: "ok" };
}

/** Reassign a device's policy stack — port of `update_device_policies` (main.py:4223). */
export async function updateDevicePolicies(authorization: string, workspaceSlug: string, deviceId: string, payload: PoliciesUpdatePayload) {
  const { ok, detail } = await applyDevicePolicies(authorization, workspaceSlug, payload.platform, deviceId, payload.policies);
  if (!ok) throw new HttpError(502, `Applivery API error: ${detail}`);
  invalidateDevicesCache(workspaceSlug);
  return { status: "ok" };
}

/**
 * Port of `bulk_reattest_devices` (main.py:7942-7988). Pushes the
 * security-attestation reporter script to every selected Windows/macOS
 * device right now, instead of waiting for its next scheduled run —
 * `ensureReattestLibraryEntry` above handles the one-time Asset
 * registration, `executeMdmAction('runScript', ...)` (mdmActionExecutor.ts,
 * the same dispatch point every workflow 'mdm_action' step calls through)
 * does the actual push. Devices on a platform with no reporter script
 * (Android/iOS) are skipped with an explicit reason rather than silently
 * ignored, same as the original.
 */
export async function bulkReattestDevices(authorization: string, workspaceSlug: string, payload: BulkReattestPayload, actorEmail: string) {
  const devicesRes = await getDevicesFull(authorization, workspaceSlug, false);
  const byId = new Map(devicesRes.items.map((d) => [d.id, d]));
  const headers = { Authorization: authorization };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const libraryEntryCache = new Map<string, { id: string } | null>();

  const results: Array<{ deviceId: string; displayName?: string; ok: boolean; detail: string }> = [];
  for (const deviceId of payload.deviceIds) {
    const device = byId.get(deviceId);
    if (!device) {
      results.push({ deviceId, ok: false, detail: "Device not found in current fleet" });
      continue;
    }
    if (!["windows", "macos"].includes(device.platform)) {
      results.push({ deviceId, displayName: device.displayName, ok: false, detail: `No self-report script for platform '${device.platform}'` });
      continue;
    }
    if (!libraryEntryCache.has(device.platform)) {
      libraryEntryCache.set(device.platform, await ensureReattestLibraryEntry(authorization, orgBase, workspaceSlug, device.platform));
    }
    const entry = libraryEntryCache.get(device.platform);
    if (!entry) {
      results.push({ deviceId, displayName: device.displayName, ok: false, detail: "Could not register the attestation script as a runnable Asset" });
      continue;
    }
    const { ok, detail } = await executeMdmAction(
      headers,
      orgBase,
      workspaceSlug,
      device.platform,
      device.platformDeviceId,
      "runScript",
      null,
      { libraryId: entry.id },
      deviceId,
    );
    results.push({ deviceId, displayName: device.displayName, ok, detail });
  }

  const succeeded = results.filter((r) => r.ok).length;
  await recordAuditEvent(workspaceSlug || "global", {
    category: "device",
    action: "bulk_reattest",
    actor: actorEmail,
    message: `Re-attestation pushed to ${succeeded}/${results.length} selected device(s) by ${actorEmail}`,
  });
  return { results, succeeded, total: results.length };
}
