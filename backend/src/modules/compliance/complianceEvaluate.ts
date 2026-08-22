/**
 * Compliance condition-evaluation engine — faithful port of main.py's
 * _version_tuple (2743), _get_by_path/_compare_scalar (10206-10245),
 * _evaluate_condition (10247), and _policy_violated (10533).
 */
import type { NormalizedDevice } from "../devices/deviceNormalize";
import { isPointInZone } from "../geofencing/geofence.service";

/**
 * App Lists context for requiredAppList/disallowedAppList conditions —
 * pre-loaded ONCE by the caller (compliance.service.ts's evaluation pass,
 * mirroring _run_compliance_evaluation's own one-time
 * _load_app_catalog(slug)/_load_app_lists(slug) calls) rather than looked
 * up per-condition here, since Prisma reads are async and this function
 * must stay synchronous to match the tight per-device evaluation loop.
 */
export interface AppListsContext {
  catalogById: Map<string, { id: string; identifier: string; name?: string | null }>;
  listById: Map<string, { id: string; appIds: string[] }>;
}

/**
 * Geofencing context for geofenceZoneId/hasLocationData/locationAgeMinutes
 * conditions -- pre-loaded ONCE by the caller (compliance.service.ts's
 * evaluation pass), same reasoning as AppListsContext above: this function
 * must stay synchronous, so the async Prisma reads happen before the loop,
 * not per-condition inside it. `locationsByDeviceId` only contains entries
 * for devices actually scoped by a geofence-using policy (see
 * geofenceScopedDeviceIds) -- not the whole fleet.
 */
export interface GeoContext {
  zonesById: Map<string, { shape: string; geometry: { center?: { lat: number; lng: number }; radiusMeters?: number; points?: Array<{ lat: number; lng: number }> } }>;
  locationsByDeviceId: Map<string, { lat: number; lng: number; recordedAt: Date | null; fetchedAt: Date }>;
}

export function versionTuple(v: unknown): number[] {
  const parts = String(v ?? "0").split(/[.\-_]/);
  return parts.map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

function compareVersionTuples(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

/**
 * Tuple-ify an OS Patch Level value (osPatchLevelMapping.service.ts) for
 * comparison, platform-aware since the format differs per OS: Android SPL
 * dates ("2026-05-05") and Windows builds ("10.0.28000.2704") already split
 * cleanly on `-`/`.` via versionTuple, but Apple's "26.6.2 (25G82)" needs
 * its trailing build parenthetical stripped first — otherwise "(25g82)"
 * parses as a non-numeric (zero) tuple segment and misaligns comparison
 * against a target value that doesn't include one. A device with no
 * osPatchLevel value at all (no mapping configured, or this device just
 * doesn't carry the attribute) tuples to [0], which fails closed against
 * any real target — same "missing data doesn't pass a minimum-level check"
 * behavior as every other condition here.
 */
function patchLevelTuple(platform: string, raw: unknown): number[] {
  const s = String(raw ?? "").trim();
  if (platform === "apple" || platform === "macos") {
    const m = s.match(/^([\d]+(?:\.[\d]+)*)/);
    return versionTuple(m ? m[1] : s);
  }
  return versionTuple(s);
}

export function getByPath(obj: any, path: string): any {
  let cur = obj;
  for (const part of (path ?? "").split(".")) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur = cur[part];
    } else {
      return null;
    }
  }
  return cur ?? null;
}

/** Port of `_compare_scalar` (main.py:10226). */
export function compareScalar(actual: any, operator: string, target: any): boolean {
  if (operator === "exists") return actual !== null && actual !== undefined && actual !== "";
  if (operator === "missing") return actual === null || actual === undefined || actual === "";
  if (operator === "contains") return String(target ?? "").toLowerCase().includes(String(actual ?? "").toLowerCase());
  if (operator === "greaterThan" || operator === "lessThan") {
    const actualNum = Number(actual);
    const targetNum = Number(target);
    if (Number.isNaN(actualNum) || Number.isNaN(targetNum)) return false;
    return operator === "greaterThan" ? actualNum > targetNum : actualNum < targetNum;
  }
  if (operator === "notEquals") return String(actual ?? "") !== String(target ?? "");
  return String(actual ?? "") === String(target ?? "");
}

function daysSince(iso: unknown): number | null {
  if (!iso) return null;
  const dt = new Date(String(iso).replace("Z", "+00:00"));
  if (Number.isNaN(dt.getTime())) return null;
  return (Date.now() - dt.getTime()) / 86_400_000;
}

export interface EvalCondition {
  field: string;
  operator: string;
  value?: any;
}

/**
 * Returns true if `device` matches this single condition. `appLists` is
 * only needed by requiredAppList/disallowedAppList — every other branch
 * ignores it. Faithful port of `_evaluate_condition` (main.py:10247),
 * including its bare try/except-turned-catch-all-false.
 */
export function evaluateCondition(
  device: NormalizedDevice & Record<string, any>,
  condition: EvalCondition,
  appLists?: AppListsContext,
  geo?: GeoContext,
): boolean {
  const { field, operator, value } = condition;
  try {
    if (field === "geofenceZoneId") {
      const zone = geo?.zonesById.get(String(value ?? ""));
      const loc = geo?.locationsByDeviceId.get(device.id);
      if (!zone || !loc) return false; // no zone selected, or device has no known location -- doesn't match either way (see COMPLIANCE_FIELDS's doc comment on this field for why, and hasLocationData for composing fail-closed policies)
      const inside = isPointInZone({ lat: loc.lat, lng: loc.lng }, zone);
      return operator === "inside" ? inside : !inside;
    }
    if (field === "hasLocationData") {
      return Boolean(geo?.locationsByDeviceId.has(device.id)) === Boolean(value);
    }
    if (field === "locationAgeMinutes") {
      const loc = geo?.locationsByDeviceId.get(device.id);
      if (!loc) return false;
      const ageMinutes = (Date.now() - loc.fetchedAt.getTime()) / 60_000;
      const target = Number(value ?? 0);
      return operator === "greaterThan" ? ageMinutes > target : ageMinutes < target;
    }
    if (["manufacturer", "model", "serialNumber", "imei"].includes(field)) {
      return compareScalar(device[field], operator, value);
    }
    if (field === "mdmUserEmail") {
      return compareScalar((device.mdmUser as any)?.email, operator, value);
    }
    if (field === "totalStorageGb" || field === "ramGb") {
      return compareScalar((device as any)[field], operator, value);
    }
    if (field === "riskScore" || field === "riskTier") {
      return compareScalar((device as any)[field], operator, value);
    }
    if (field === "osUpdatePendingCount") {
      const status = device.osUpdateStatus;
      const actual = status ? status.pendingCount : null;
      if (actual === null || actual === undefined) return false;
      const target = Number(value ?? 0);
      return operator === "lessThan" ? actual < target : actual > target;
    }
    if (field === "osUpdateExploitedPending") {
      const status = device.osUpdateStatus;
      const actual = (status?.pendingKbs ?? []).some((kb: any) => kb.exploited);
      return actual === Boolean(value);
    }
    if (field === "vulnPendingCveCount") {
      const status = device.vulnStatus;
      const actual = status && status.confidence !== "unknown" ? status.pendingCount : null;
      if (actual === null || actual === undefined) return false;
      const target = Number(value ?? 0);
      return operator === "lessThan" ? actual < target : actual > target;
    }
    if (field === "vulnExploitedPending") {
      const status = device.vulnStatus;
      const actual = (status?.pendingCves ?? []).some((c: any) => c.exploited);
      return actual === Boolean(value);
    }
    if (field === "vulnServiceCriticalHighCount") {
      const status = device.vulnServiceStatus;
      if (!status || !status.checked) return false;
      const counts = status.counts ?? {};
      const actual = (counts.CRITICAL ?? 0) + (counts.HIGH ?? 0);
      const target = Number(value ?? 0);
      return operator === "lessThan" ? actual < target : actual > target;
    }
    if (field === "vulnServiceHasKev") {
      const status = device.vulnServiceStatus;
      const actual = status && status.checked ? Boolean(status.hasKev) : false;
      return actual === Boolean(value);
    }
    if (field === "vulnServiceChecked") {
      const status = device.vulnServiceStatus;
      const actual = Boolean(status && status.checked);
      return actual === Boolean(value);
    }
    if (field === "osEol") {
      const status = device.osLifecycleStatus;
      const actual = status ? Boolean(status.isEol) : false;
      return actual === Boolean(value);
    }
    if (field === "appleAppUpdatesPending") {
      const status = device.appleAppUpdateStatus;
      const actual = status ? status.pendingCount : null;
      if (actual === null || actual === undefined) return false;
      const target = Number(value ?? 0);
      return operator === "lessThan" ? actual < target : actual > target;
    }
    if (field === "smartAttribute") {
      const target = value ?? {};
      const attrs: Record<string, string> = {};
      for (const a of device.smartAttributes ?? []) attrs[a.name] = a.value;
      const attrName = target.name;
      if (operator === "exists") return attrName in attrs;
      if (operator === "missing") return !(attrName in attrs);
      if (!(attrName in attrs)) return false;
      return compareScalar(attrs[attrName], operator, target.compareValue);
    }
    if (field === "customField") {
      const target = value ?? {};
      const actual = getByPath(device, target.path ?? "");
      return compareScalar(actual, operator, target.compareValue);
    }
    if (field === "selfReportedAttribute") {
      const target = value ?? {};
      const attrs = ((device.selfReported as any)?.attributes as Record<string, string>) ?? {};
      const attrName = target.name;
      if (operator === "exists") return attrName in attrs;
      if (operator === "missing") return !(attrName in attrs);
      if (!(attrName in attrs)) return false;
      return compareScalar(attrs[attrName], operator, target.compareValue);
    }
    if (field === "customCheckResult") {
      // customChecks.service.ts's module doc has the full design. Results
      // ride on the same DevicePushData row/kind as attributes (see
      // deviceData.service.ts's reportDeviceData), keyed by
      // CustomCheckDefinition.key. A result with `error` set (the check
      // itself failed to run on the device — e.g. registry path not found)
      // is treated exactly like "missing", not like a false/empty value —
      // an admin comparing against "false" shouldn't get a false-positive
      // compliance pass just because the agent couldn't run the check.
      const target = value ?? {};
      const results = ((device.selfReported as any)?.customCheckResults as Record<string, { value?: unknown; error?: string | null }>) ?? {};
      const key = target.key;
      const entry = results[key];
      const present = Boolean(entry) && !entry!.error;
      if (operator === "exists") return present;
      if (operator === "missing") return !present;
      if (!present) return false;
      return compareScalar(entry!.value, operator, target.compareValue);
    }
    if (field === "triggerFired") {
      // TriggerFireState (schema.prisma), attached onto NormalizedDevice as
      // triggerFires by deviceNormalize.ts, populated inside
      // triggers.service.ts's fireTrigger. Closes the visibility gap where
      // an Inbound Webhook firing (external EDR/MTD/DEX tool) had no way to
      // drive a compliance condition. `exists` optionally qualified by
      // withinMinutes means "fired at least once in the last N minutes";
      // `missing` is its exact inverse ("hasn't fired in the last N minutes,
      // or never has") — same present/absent handling shape as
      // customCheckResult above, just keyed by triggerId instead of a check
      // key, and with a recency window instead of a value comparison.
      const target = value ?? {};
      const fires = (device.triggerFires as Record<string, { lastFiredAt: string; fireCount: number }> | null) ?? {};
      const entry = fires[target.triggerId];
      let present = Boolean(entry);
      if (present && target.withinMinutes) {
        const ageMinutes = (Date.now() - new Date(entry!.lastFiredAt).getTime()) / 60000;
        present = ageMinutes >= 0 && ageMinutes <= Number(target.withinMinutes);
      }
      if (operator === "exists") return present;
      if (operator === "missing") return !present;
      return false;
    }
    if (field === "hasSelfReported") {
      return Boolean(device.selfReported) === Boolean(value);
    }
    if (field === "selfReportDaysAgo") {
      const selfReported = device.selfReported as any;
      const lastReported = selfReported?.lastReportedAt;
      if (!lastReported) return operator === "greaterThan";
      const days = daysSince(lastReported);
      if (days === null) return operator === "greaterThan";
      const target = Number(value ?? 0);
      return operator === "greaterThan" ? days > target : days < target;
    }
    if (field === "requiredAppList" || field === "disallowedAppList") {
      if (!appLists || !value) return false;
      const appList = appLists.listById.get(String(value));
      if (!appList) return false;
      const entries = (appList.appIds ?? [])
        .map((aid: string) => appLists.catalogById.get(aid))
        .filter((e): e is NonNullable<typeof e> => Boolean(e?.identifier));
      if (entries.length === 0) return false;
      const installed: Set<string> | null = (device as any).installedApps ?? null;
      if (installed === null) return false;
      // Match on the catalog entry's identifier OR its display name
      // (case-insensitive) — necessary because a device's self-reported
      // identifier convention doesn't always line up with whatever an App
      // Catalog entry was added under. An entry added via the Winget search
      // (App Catalog / Apps view) stores winget's PackageIdentifier (e.g.
      // "Google.Chrome"), but the Windows agent's self-report falls back to
      // the lowercased DisplayName instead (e.g. "google chrome") whenever
      // winget.exe isn't invokable from the service's LocalSystem context
      // (apps_windows.go's getAppsViaRegistry doc comment — a routine
      // situation for a Windows service, not a rare edge case). Matching on
      // identifier alone silently orphaned every such app from every App
      // List condition referencing it: the app would show as genuinely
      // installed everywhere in SOAR (Apps view, self-report), yet
      // requiredAppList/disallowedAppList would never recognize it, leaving
      // a policy permanently "violated" with no way to self-recover even
      // after the underlying data was correct.
      //
      // A second, separate mismatch affects Windows Store (AppX/MSIX) apps
      // specifically: a catalog entry added via the MS Store search (App
      // Catalog / Apps view) stores whatever Applivery's own search API
      // returns as the identifier — `productId`/`packageFamilyName`/`storeId`
      // (appSearch.service.ts's searchMsStore), which is PackageFamilyName-
      // shaped: "<PackageName>_<PublisherId>" (e.g.
      // "1ED5AEA5.4160926B82DB_p2gbknwb5d8r2"). But both the Windows agent's
      // self-report (apps_windows.go's getAppsViaAppx) and Applivery UEM's
      // own AppInventoryResults XML (windowsDeviceApps.service.ts) report the
      // bare package identity Name only — the PackageFamilyName's
      // PublisherId segment (always a 13-character lowercase base32 string)
      // is never knowable ahead of install, so it can't be included there.
      // Stripping that trailing "_<13 chars>" segment recovers the identity
      // Name for comparison, without risking false strips of legitimate
      // identifiers (winget's dotted PackageIdentifiers never end in an
      // underscore + exactly 13 alphanumeric characters).
      const stripPackageFamilySuffix = (id: string) => id.replace(/_[a-z0-9]{13}$/i, "");
      const isPresent = (e: { identifier: string; name?: string | null }) => {
        const idLower = e.identifier.toLowerCase();
        return (
          installed.has(idLower) ||
          installed.has(stripPackageFamilySuffix(idLower)) ||
          Boolean(e.name && installed.has(e.name.toLowerCase()))
        );
      };
      if (field === "requiredAppList") {
        return !entries.every(isPresent);
      }
      return entries.some(isPresent);
    }
    if (field === "isCompliant") {
      return Boolean(device.isCompliant) === Boolean(value);
    }
    if (field === "platform") {
      return operator === "equals" ? device.platform === value : device.platform !== value;
    }
    if (field === "osVersion") {
      const actual = versionTuple(device.osVersion);
      const target = versionTuple(value);
      const cmp = compareVersionTuples(actual, target);
      if (operator === "lessThan") return cmp < 0;
      if (operator === "greaterThan") return cmp > 0;
      return cmp === 0;
    }
    if (field === "osPatchLevel") {
      const actual = patchLevelTuple(device.platform, device.osPatchLevel);
      const target = patchLevelTuple(device.platform, value);
      const cmp = compareVersionTuples(actual, target);
      if (operator === "lessThan") return cmp < 0;
      if (operator === "greaterThan") return cmp > 0;
      return cmp === 0;
    }
    if (field === "lastSeenDaysAgo") {
      const days = daysSince(device.lastSeen);
      if (days === null) return false;
      const target = Number(value ?? 0);
      return operator === "greaterThan" ? days > target : days < target;
    }
    if (field === "daysSinceEnrollment") {
      const enrolledAt = device.enrolledAt;
      if (!enrolledAt) return false;
      const dt = new Date(String(enrolledAt).replace("Z", "+00:00"));
      if (Number.isNaN(dt.getTime())) return false;
      const elapsedSeconds = (Date.now() - dt.getTime()) / 1000;
      const target = value ?? {};
      const secondsPerUnit: Record<string, number> = { minutes: 60, hours: 3600, days: 86400 };
      const targetSeconds = Number(target.amount ?? 0) * (secondsPerUnit[target.unit ?? "days"] ?? 86400);
      if (Number.isNaN(targetSeconds)) return false;
      return operator === "greaterThan" ? elapsedSeconds > targetSeconds : elapsedSeconds < targetSeconds;
    }
    if (field === "battery") {
      const actual = device.battery;
      if (actual === null || actual === undefined) return false;
      const target = Number(value ?? 0);
      return operator === "lessThan" ? actual < target : actual > target;
    }
    if (field === "availableStorageGb") {
      const actual = device.availableStorageGb;
      if (actual === null || actual === undefined) return false;
      const target = Number(value ?? 0);
      return operator === "lessThan" ? actual < target : actual > target;
    }
    if (field === "segmentId") {
      const actual = String(device.segmentId ?? "");
      const target = String(value ?? "");
      return operator === "equals" ? actual === target : actual !== target;
    }
    if (field === "tags") {
      const tags = device.tags ?? [];
      const present = tags.includes(value);
      return operator === "includes" ? present : !present;
    }
    if (field === "state") {
      return operator === "equals" ? device.state === value : device.state !== value;
    }
    if (field === "deviceAudienceId") {
      const audienceIds = new Set((device.deviceAudiences ?? []).map((a) => String(a.id)));
      const isMember = audienceIds.has(String(value ?? ""));
      return operator === "includes" ? isMember : !isMember;
    }
    if (field === "missingPolicyId") {
      const target = value ?? {};
      if (target.platform && device.platform !== target.platform) return false;
      const activeIds = new Set((device.activePolicies ?? []).map((p) => p.id));
      return !activeIds.has(target.policyId);
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Returns the matched (triggered) conditions if the policy is violated for
 * this device, per its conditionLogic ('any'/'all'); empty array means not
 * violated. Port of `_policy_violated` (main.py:10533).
 */
export function policyViolated(
  device: NormalizedDevice & Record<string, any>,
  policy: { conditions: EvalCondition[]; conditionLogic?: string },
  appLists?: AppListsContext,
  geo?: GeoContext,
): EvalCondition[] {
  const conditions = policy.conditions ?? [];
  if (conditions.length === 0) return [];
  const matched = conditions.filter((c) => evaluateCondition(device, c, appLists, geo));
  const logic = policy.conditionLogic ?? "any";
  if (logic === "all") {
    return matched.length === conditions.length ? matched : [];
  }
  return matched;
}
