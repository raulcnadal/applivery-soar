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
import { loadOsUpdateCatalog, computeWindowsPendingUpdates, windowsDeviceBuild } from "../catalogs/osUpdateCatalog";
import { loadVulnCatalog, computeApplePendingVulns, computeAndroidPendingVulns } from "../catalogs/vulnCatalog";
import { loadOsLifecycleCatalog, computeOsLifecycleStatus } from "../catalogs/osLifecycleCatalog";
import { loadGdmfCatalog } from "../catalogs/gdmfCatalog";
import { loadAppleDeviceIdentifiers } from "../catalogs/appleDeviceIdentifiers";
import { loadInstalledAppsStore, installedAppsRecordEntries } from "../appLists/installedApps.service";
import { getVulnServiceConfig, computeVulnServiceStatus, computeDeviceAppsDetail } from "../catalogs/vulnService";
import { anyVulnSourceEnabled } from "../catalogs/vulnSources";
import { loadDevicePushDataCache } from "./deviceData.service";
import { LOCATION_CACHE_KEY } from "../analytics/locationsSync.service";
import { executeMdmAction } from "../workflows/mdmActionExecutor";
import { createScriptAsset } from "../workflows/scriptAssetUpload";

// Port of `SECURITY_REPORT_SCRIPT_FILES`/`REATTEST_LIBRARY_ENTRY_NAME`
// (main.py:7883-7899) — same script templates deviceReportScripts.controller.ts
// already serves for the one-time scheduled-task setup; bulk-reattest reuses
// them as the payload for an on-demand Action Library "script" entry.
const SCRIPTS_DIR = path.resolve(__dirname, "../../../scripts");

// How long a SOAR Agent self-report stays "reporting" (green) before
// devices.service.ts/deviceNormalize.ts's soarAgentReporting flips to false
// ("stale", not "not installed" — see the field's own doc comment). 24h is
// generous against the agent's own default 1h poll interval
// (config.IntervalSec in the Windows/macOS agent repos), giving slack for a
// laptop that's been asleep/offline overnight without flagging it stale.
const SOAR_AGENT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
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

// Separate, longer-lived cache entry — see the doc comment at its liveCacheSet
// call site (inside getDevicesFull) for why this must NOT share a cache key
// with DEVICES_CACHE_SOURCE.
export const DEVICE_SERIAL_INDEX_SOURCE = "devices_serial_index";
export const DEVICE_SERIAL_INDEX_TTL_SECONDS = 86_400; // 24h

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
    // CORRECTION: an earlier version of this function assumed (from reading
    // Applivery's API reference in isolation) that this endpoint's 200 body
    // was `{status, data: {emmDevices, admDevices, winDevices, aosDevices}}`
    // and hand-flattened those four arrays instead of using
    // fetchAllPages/extractItems. Verified against the LIVE endpoint (via
    // this same file's diagnoseDeviceAudiencePreview, deviceAudiences.
    // service.ts — which has always used plain extractItems(res.data) here
    // and correctly returns real members, confirmed against soar.mi-labs.es
    // with rawMemberCount:1 for an audience Applivery's own preview UI also
    // shows 1 member for) that assumption was wrong: the real response
    // extractItems() already handles it (a flat/paginated item list), so
    // the hand-flattening version always saw 0 items and made every
    // Device-Audience-scoped Compliance Policy match zero devices — the
    // exact bug it was meant to fix, just via a different code path.
    // Reverted to fetchAllPages, matching the proven-working diagnostic
    // code below.
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
// Request coalescing for the expensive path below (fetchAllPages against
// Applivery's fleet API + a per-device sequential pass computing vuln/apps
// detail) — keyed by workspace only, deliberately ignoring `authorization`,
// since every caller within a workspace resolves the same Automation
// Credential (getAutomationBearer) or the same admin session either way.
// Added after a real-device regression: a device's POST /api/device-data/
// report invalidates this workspace's cache and (as of the event-driven
// re-evaluation feature) fires a fire-and-forget forceEvaluateNow, which
// itself calls getDevicesFull(refresh=true) — and the same device's very
// next call, GET /api/device-data/agent-status moments later, used to see
// the just-invalidated cache and kick off its OWN full independent refetch
// concurrently with the first, roughly doubling an already-slow fleet pull
// and pushing it past the agent's own HTTP client timeout (the "Unavailable
// / stuck on reboot" bug). Now a second caller while a refresh is already
// in flight just awaits that same promise instead of starting a redundant
// one.
const devicesFullInFlight = new Map<string, Promise<{ items: NormalizedDevice[]; total: number; fetchedAt: string }>>();

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

  const inFlight = devicesFullInFlight.get(slugKey);
  if (inFlight) return inFlight;

  const fetchPromise = fetchDevicesFullUncached(authorization, workspaceSlug).finally(() => {
    devicesFullInFlight.delete(slugKey);
  });
  devicesFullInFlight.set(slugKey, fetchPromise);
  return fetchPromise;
}

// workspaceSlug is passed through raw (not the `slugKey` fallback) so
// resolveOrgBase below sees exactly what getDevicesFull's caller passed in —
// same as this logic's behavior before it was split out of getDevicesFull.
async function fetchDevicesFullUncached(
  authorization: string,
  workspaceSlug: string,
): Promise<{ items: NormalizedDevice[]; total: number; fetchedAt: string }> {
  const slugKey = workspaceSlug || "global";
  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);

  // subType: "device" excludes enrollment records — Applivery's unified
  // devices endpoint mixes in pending/unclaimed enrollment tokens
  // (subType: "enrollment") alongside actually-registered endpoints
  // (subType: "device") unless filtered out explicitly. Without this, every
  // count/list/evaluation in the app would silently include admin-created
  // enrollment tokens nobody has redeemed yet as if they were real devices.
  const itemsAll = await fetchAllPages(headers, `${orgBase}/mdm/devices/`, { subType: "device" });
  const itemsComp = await fetchAllPages(headers, `${orgBase}/mdm/devices/`, { subType: "device", isCompliance: "true" });
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
        const policy = policiesById.get(policyId);
        // Defense in depth: deleteCompliancePolicy (compliance.service.ts)
        // now purges this policy's keys from complianceEvaluationState when
        // it's deleted, but this table is a bare Json blob with no FK back
        // to CompliancePolicy, so any key that predates that fix — or any
        // future write path that misses it — would otherwise resolve to
        // policyName: null and render as a permanent "Unknown policy"
        // phantom violation on an otherwise fully-compliant device. Skipping
        // unresolvable entries here means a stray key is just inert dead
        // weight in the state blob instead of a visible bug.
        if (!policy) continue;
        (policyViolationsByDevice[deviceId] ??= []).push({
          policyId, policyName: policy.name,
          status: entry.status, lastDetectedAt: entry.lastDetectedAt,
        });
      }
    }
  } catch (e) {
    console.warn(`[Devices] policyViolationsByDevice lookup failed: ${e}`);
  }

  // Intelligence catalogs — loaded once per fleet-wide call, same batching
  // philosophy. Port of main.py:3521-3550.
  const [osUpdateCatalog, vulnCatalog, osLifecycleCatalog, gdmfCatalog, appleIdCatalog, installedAppsStore, vulnServiceCfg, anyOtherVulnSourceOn] = await Promise.all([
    loadOsUpdateCatalog(),
    loadVulnCatalog(),
    loadOsLifecycleCatalog(),
    loadGdmfCatalog(),
    loadAppleDeviceIdentifiers(),
    loadInstalledAppsStore(slugKey),
    getVulnServiceConfig(slugKey),
    anyVulnSourceEnabled(slugKey),
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
    d.windowsVersionLabel = d.platform === "windows" ? windowsDeviceBuild(d.osVersion)?.featureLabel ?? null : null;

    // "SOAR Agent reporting" — see the NormalizedDevice field's own doc
    // comment (deviceNormalize.ts) for why this is kept explicitly distinct
    // from Applivery's own agent/enrollment concepts. selfReported comes
    // from pushdataCache (loadDevicePushDataCache), which stamps
    // lastReportedAt from DevicePushData.reportedAt on every row.
    {
      const selfReportedRecord = d.selfReported as { lastReportedAt?: string } | null;
      const lastReportedAt = selfReportedRecord?.lastReportedAt ?? null;
      d.soarAgentLastReportedAt = lastReportedAt;
      d.soarAgentReporting = lastReportedAt !== null && Date.now() - new Date(lastReportedAt).getTime() < SOAR_AGENT_STALE_THRESHOLD_MS;
    }
    if (d.platform === "apple" || d.platform === "macos") {
      d.vulnStatus = computeApplePendingVulns(d.platform, d.osVersion, vulnCatalog);
    } else if (d.platform === "android") {
      d.vulnStatus = computeAndroidPendingVulns(d.osVersion, vulnCatalog);
    } else {
      d.vulnStatus = null;
    }
    d.osLifecycleStatus = computeOsLifecycleStatus(d.platform, d.osVersion, osLifecycleCatalog, d.model, gdmfCatalog, appleIdCatalog);

    // installedAppsStore carries a versioned "apps" list for every platform,
    // not just Apple — appleAppUpdateStatus stays Apple-only (sourced from
    // Applivery's own HasUpdateAvailable flag, which only Apple exposes),
    // but the raw entries feed the Vulnerability Service lookup for all
    // platforms below. Each device now stores an InstalledAppsRecord with
    // independent selfReported/serverFetch slots (see installedApps.service.ts) —
    // appleAppUpdates is always server_fetch-only (self-reporting agents don't
    // know about pending Apple App Store updates), but both slots feed the
    // Vulnerability Service and the Apps tab so admins see everything a
    // device reports, from whichever source reported it.
    const appsRecord = installedAppsStore[String(deviceId)];
    const serverFetchEntry = appsRecord?.serverFetch ?? null;
    const appsEntries = installedAppsRecordEntries(appsRecord);
    d.appleAppUpdateStatus = d.platform === "apple" || d.platform === "macos" ? serverFetchEntry?.appleAppUpdates ?? null : null;
    // computeVulnServiceStatus merges in every OTHER registered vuln source
    // itself (MISP, VulnCheck, ... — checks each one's own enabled flag
    // internally via vulnSources.ts), so the gate here only needs to skip
    // the call entirely when NEITHER the Worker nor any of them is on.
    d.vulnServiceStatus = vulnServiceCfg.enabled || anyOtherVulnSourceOn ? await computeVulnServiceStatus(slugKey, d, appsEntries) : null;
    // Backs the Device modal's Apps tab — every app this device reports,
    // each paired with its own cached CVE result when one exists. The app
    // list itself is always populated (plain installed-apps inventory);
    // vulnServiceEnabled only gates the Worker's own cache lookups here —
    // computeDeviceAppsDetail resolves every other source's enabled flag
    // internally, same as the two functions above.
    d.installedAppsDetail = await computeDeviceAppsDetail(slugKey, d, appsEntries, vulnServiceCfg.enabled);

    Object.assign(d, computeDeviceRisk(d, openCases, activeViolations));
  }

  const responseData = {
    items: normalized,
    total: normalized.length,
    fetchedAt: new Date().toISOString(),
  };

  liveCacheSet(slugKey, DEVICES_CACHE_SOURCE, responseData, DEVICES_CACHE_TTL_SECONDS);

  // Serial → {id, displayName} index for the device self-report webhooks
  // (deviceData.service.ts's cachedDeviceBySerial) — deliberately a SEPARATE
  // cache entry from DEVICES_CACHE_SOURCE above, with its own much longer
  // TTL, so it survives invalidateDevicesCache(). Without this separation,
  // every successful attributes report (POST /api/device-data/report)
  // invalidates DEVICES_CACHE_SOURCE at the end of reportDeviceData — and
  // since the Windows/macOS agent always sends its app-inventory report
  // (POST /api/device-data/report-apps) immediately afterward in the same
  // cycle, that second call's cachedDeviceBySerial lookup would find the
  // cache just-emptied and fail to match the very same serial number that
  // matched moments earlier, permanently buffering the report into
  // PendingAppReport (see reportDeviceApps's doc comment) — a real,
  // deterministic bug this index exists to close off. 24h TTL is safe here:
  // this is a pure identity lookup (serial->id/displayName), not device
  // state, so staleness only means a very recently renamed device shows its
  // old name in an audit log line for a while, never a matching failure.
  const serialIndex: Record<string, { id: string; displayName: string | null }> = {};
  for (const d of normalized) {
    if (d.serialNumber) serialIndex[d.serialNumber] = { id: d.id, displayName: d.displayName ?? null };
  }
  liveCacheSet(slugKey, DEVICE_SERIAL_INDEX_SOURCE, serialIndex, DEVICE_SERIAL_INDEX_TTL_SECONDS);

  return responseData;
}

/**
 * Single-device detail — port of `get_device_compliance` (main.py:3589),
 * widened beyond the original's own deliberately-curated subset (id/
 * isCompliant/policyCompliant/riskScore/riskTier/riskFactors/
 * policyViolations/activeViolations/openCases). That subset existed because
 * the original app's Playground device modal (DeviceInsightCard) only ever
 * needed the compliance/risk fields it didn't already carry — it had its
 * own separate Overview tab fed straight from the lighter mdm_devices
 * widget item, and never showed the Devices view's own vulnStatus/
 * osUpdateStatus/tags/segmentId/activePolicies/etc.
 *
 * Since the merged device modal (Devices view + Playground/Dashboard-widget
 * entry points, one component) now needs the ENTIRE NormalizedDevice
 * whenever it's opened from a "lighter" caller that doesn't already have
 * one, this returns the full matched record instead. Still reuses
 * getDevicesFull's own cached-or-live fleet computation rather than
 * duplicating any lookup logic — the existing 5-minute live cache
 * (DEVICES_CACHE_TTL_SECONDS) keeps repeat calls cheap, and guarantees this
 * can never drift out of sync with the Devices view/detail drawer's own
 * numbers, which read from the exact same computation. Backward compatible
 * with any caller written against the old narrower shape: every field that
 * shape returned is still present, just alongside everything else now too.
 */
export async function getDeviceCompliance(authorization: string, workspaceSlug: string, deviceId: string) {
  const full = await getDevicesFull(authorization, workspaceSlug, false);
  const match = full.items.find((d) => String(d.id) === String(deviceId));
  if (!match) {
    throw new HttpError(404, "Device not found in the current fleet snapshot");
  }
  return match;
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
    // The double slash before `${mdmType}` is not a typo — Applivery's own
    // OpenAPI schema documents this endpoint's path as literally
    // `/mdm/locations//:type/:identifier` (confirmed against
    // docs.applivery.com directly), and independent third-party client code
    // hitting this same endpoint confirms a single slash here 401s. Found
    // while cross-checking a reference Flutter app's own Applivery
    // integration against this one.
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/locations//${mdmType}/${deviceId}`, { headers, params: { limit: 50, sort: "createdAt:desc" } });
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
    // Same double-slash requirement as getDeviceLocations above — also
    // documented that way in Applivery's own OpenAPI schema for this
    // endpoint (`/mdm/network-status//:type/:identifier`).
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/network-status//${mdmType}/${deviceId}`, { headers, params: { limit: 1, sort: "createdAt:desc" } });
    return { items: extractItems(res.data) };
  } catch (e) {
    console.warn(`[Devices] getDeviceNetworkStatus(${deviceId}) failed: ${e}`);
    return { items: [] };
  }
}

/**
 * Agent Logs / Agent Trace — Applivery's per-device diagnostic feed
 * (docs.applivery.com/en/api/uem/agent-logs, .../uem/agent-trace),
 * deliberately kept OUT of the regular device-fetch/cache cycle
 * (getDevicesFull, DEVICES_CACHE_TTL_SECONDS) unlike locations/network-status
 * above. This is troubleshooting data, not fleet/compliance state — pulling
 * it on every device on every refresh would mean two extra Applivery API
 * calls per device per cycle for data almost nobody looks at except while
 * actively debugging one specific device (per user request: "fetching this
 * in a recurrent manner would be an intensive task if we target all devices
 * and is not really related to Compliance, but to Troubleshooting").
 *
 * Instead: fetchDeviceAgentDiagnostics is only ever called from the Device
 * modal's Agent tab "Fetch Agent Logs & Traces" button (an explicit admin
 * action, manageDevices-gated same as bulk-reattest) and persists whatever
 * it gets back; getStoredAgentDiagnostics is a plain DB read with no
 * Applivery call at all, used both on Device modal open (so the last fetch
 * stays visible between troubleshooting sessions, per user request: "keeping
 * logs already fetched for reference") and as fetchDeviceAgentDiagnostics's
 * own fallback for a side that fails.
 *
 * No new Prisma model/migration: reuses the existing DevicePushData table
 * (same one reportDeviceData's "attributes" kind already writes to) under
 * two new `kind`s scoped to this deviceId (Applivery's own device _id, same
 * id every other proxy call in this file takes — not a report-secret
 * serial). Each stored payload is `{ items, fetchedAt }`.
 */
const AGENT_LOGS_KIND = "agentLogsFetch";
const AGENT_TRACE_KIND = "agentTraceFetch";

async function storeDevicePushDataKind(workspaceSlug: string, deviceId: string, kind: string, payload: unknown): Promise<void> {
  const now = new Date();
  await prisma.devicePushData.upsert({
    where: { workspaceSlug_deviceId_kind: { workspaceSlug, deviceId, kind } },
    create: { workspaceSlug, deviceId, kind, payload: payload as any, reportedAt: now },
    update: { payload: payload as any, reportedAt: now },
  });
}

async function readDevicePushDataKind(workspaceSlug: string, deviceId: string, kind: string): Promise<any | null> {
  const row = await prisma.devicePushData.findUnique({ where: { workspaceSlug_deviceId_kind: { workspaceSlug, deviceId, kind } } });
  return row?.payload ?? null;
}

/** GET /api/devices/{id}/agent-diagnostics — read-only, no Applivery call. */
export async function getStoredAgentDiagnostics(workspaceSlug: string, deviceId: string) {
  const [agentLogs, agentTrace] = await Promise.all([
    readDevicePushDataKind(workspaceSlug, deviceId, AGENT_LOGS_KIND),
    readDevicePushDataKind(workspaceSlug, deviceId, AGENT_TRACE_KIND),
  ]);
  return { agentLogs, agentTrace };
}

/**
 * POST /api/devices/{id}/agent-diagnostics/fetch — the on-demand action.
 * Calls Applivery's GET /mdm/agent-logs and GET /mdm/agent-trace in
 * parallel, each filtered to this one device via deviceId+deviceType, and
 * persists whichever side succeeds. Deliberately does NOT also call the two
 * by-id endpoints (GET /mdm/agent-logs/{id}, GET /mdm/agent-trace/{id}) per
 * item returned — cross-checked against Applivery's own OpenAPI schema for
 * both, the by-id response is an identical shape to a single list item
 * (content/contentError/file for logs; the full event object for traces),
 * so an extra N+1 call per item would only fetch data the list call already
 * returned.
 *
 * A side that errors doesn't overwrite its own previously-stored data —
 * `appliveryClient` never throws on a non-2xx (see its own doc comment), so
 * a 4xx/5xx here is a normal, expected outcome this checks for explicitly
 * rather than a caught exception. The response always carries the
 * best-available payload for both sides (freshly fetched, or the last
 * successful fetch on record) plus an `errors` array the frontend can show
 * as a non-blocking warning, since losing an admin's existing reference data
 * to a transient Applivery hiccup would undercut the entire "keep logs
 * already fetched for reference" point of this feature.
 */
export async function fetchDeviceAgentDiagnostics(
  authorization: string,
  workspaceSlug: string,
  deviceId: string,
  platform: string,
): Promise<{ agentLogs: any; agentTrace: any; errors: string[] }> {
  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const mdmType = mdmTypeSegment(platform);
  const fetchedAt = new Date().toISOString();
  const errors: string[] = [];

  function describeError(res: { status: number; data: any }): string {
    const msg = res.data?.error?.message;
    return msg ? `HTTP ${res.status} — ${msg}` : `HTTP ${res.status}`;
  }

  const [logsRes, traceRes] = await Promise.all([
    appliveryClient
      .get<any>(`${orgBase}/mdm/agent-logs`, { headers, params: { deviceId, deviceType: mdmType, limit: 50, sort: "createdAt:desc" } })
      .catch((e) => ({ status: 0, data: { error: { message: String(e) } } })),
    appliveryClient
      .get<any>(`${orgBase}/mdm/agent-trace`, { headers, params: { deviceId, deviceType: mdmType, limit: 50, sort: "createdAt:desc" } })
      .catch((e) => ({ status: 0, data: { error: { message: String(e) } } })),
  ]);

  let agentLogs: any = null;
  if (logsRes.status >= 200 && logsRes.status < 300) {
    agentLogs = { items: extractItems(logsRes.data), fetchedAt };
    await storeDevicePushDataKind(workspaceSlug, deviceId, AGENT_LOGS_KIND, agentLogs);
  } else {
    errors.push(`Agent logs: ${describeError(logsRes)}`);
  }

  let agentTrace: any = null;
  if (traceRes.status >= 200 && traceRes.status < 300) {
    agentTrace = { items: extractItems(traceRes.data), fetchedAt };
    await storeDevicePushDataKind(workspaceSlug, deviceId, AGENT_TRACE_KIND, agentTrace);
  } else {
    errors.push(`Agent trace: ${describeError(traceRes)}`);
  }

  if (!agentLogs) agentLogs = await readDevicePushDataKind(workspaceSlug, deviceId, AGENT_LOGS_KIND);
  if (!agentTrace) agentTrace = await readDevicePushDataKind(workspaceSlug, deviceId, AGENT_TRACE_KIND);

  return { agentLogs, agentTrace, errors };
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
 * (main.py:4196). Shared by the manual reassignment endpoint below and the
 * Workflow engine's policy_replace/policy_add/policy_restore steps.
 *
 * Applivery's Policy Composition (docs.applivery.com/en/device-management/
 * general-settings/policy-composition) gives every *PolicyAssignments entry
 * its own explicit integer `priority` (lower number = higher priority) —
 * it's a real per-assignment value, not a function of array position. The
 * previous version of this function ignored that and recomputed
 * `priority: i + 1` from scratch on every call, which silently renumbered
 * (and thus reordered the effective precedence of) every OTHER policy
 * already on the device any time one policy was added, removed, or
 * quarantine-swapped — including on policy_restore, where it meant "restore
 * the original stack" didn't actually restore the original priorities.
 * Callers now pass each policy's real `priority`/`isPrimary` (as read off
 * the device by extractActivePolicies) straight through here instead of
 * this function inventing new ones; `priority` is only defaulted by
 * position for the rare legacy/partial caller that omits it.
 */
export async function applyDevicePolicies(
  authorization: string,
  workspaceSlug: string,
  platform: string,
  deviceId: string,
  policies: Array<{ id?: string | null; name?: string | null; priority?: number | null; isPrimary?: boolean | null }>,
): Promise<{ ok: boolean; detail: string }> {
  const platformPath = platformPathSegment(platform);
  if (!platformPath || !["apple", "android", "windows"].includes(platformPath)) {
    return { ok: false, detail: `Policy stack management isn't wired up for '${platform}' yet` };
  }

  const primaryKey = platformPath === "windows" ? "winPolicyId" : "policyId";
  const assignKey = { apple: "admPolicyAssignments", android: "emmPolicyAssignments", windows: "winPolicyAssignments" }[platformPath as "apple" | "android" | "windows"];
  const assignIdKey = { apple: "admPolicyId", android: "emmPolicyId", windows: "winPolicyId" }[platformPath as "apple" | "android" | "windows"];

  // Whichever entry is flagged isPrimary keeps the single top-level
  // "primary policy" slot; if none is flagged (caller didn't have that
  // info), fall back to the previous behavior of treating the first entry
  // as primary so old/partial callers don't break.
  const primaryIdx = policies.findIndex((p) => p.isPrimary);
  const primaryId = primaryIdx >= 0 ? policies[primaryIdx].id : policies.length > 0 ? policies[0].id : null;
  const rest = primaryIdx >= 0 ? policies.filter((_, i) => i !== primaryIdx) : policies.slice(1);
  const assignments = rest.map((p, i) => ({ [assignIdKey]: p.id, priority: typeof p.priority === "number" ? p.priority : i + 1 }));
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
