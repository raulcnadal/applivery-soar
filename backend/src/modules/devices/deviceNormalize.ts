/**
 * Faithful port of main.py's device normalization + risk-scoring helpers
 * (normalize_platform, human_platform, _parse_capacity_gb,
 * _SINGLE_POLICY_KEYS/_ARRAY_POLICY_KEYS, _extract_active_policies,
 * _normalize_device_full, _compute_device_risk — main.py:2743-3417).
 *
 * Phase 3 (Compliance + catalogs) / Phase 5 (Cases) inputs are wired in by
 * devices.service.ts's getDevicesFull, which calls normalizeDeviceFull.
 * Phase 8 wires in real device push-data (see `pushdataCache` below,
 * populated from deviceData.service.ts's loadDevicePushDataCache) — a
 * cold-start device with no self-reports yet still gets exactly the same
 * empty shape the original produces before /api/device-data/report has ever
 * been called for it, so this was never an approximation, only a staged
 * wiring order.
 */

export type NormalizedPlatform = "android" | "apple" | "macos" | "windows" | "other";

export function normalizePlatform(rawType: string, model?: string): NormalizedPlatform {
  const t = String(rawType ?? "").toLowerCase();
  if (t.includes("android")) return "android";
  if (t.includes("apple") || t.includes("ios") || t.includes("ipad")) {
    // Applivery's own `/mdm/devices` API only has ONE bucket for the whole
    // Apple ecosystem -- its `type` field enum is literally
    // ["android","apple","windows","aosp"], described as "Apple ecosystem"
    // (confirmed against the live API schema). iPhone, iPad AND Mac all
    // report type:"apple" -- there is no "macos" value coming from
    // Applivery at all, so the `t.includes("mac")` branch below was
    // unreachable dead code for every real device from this source, and
    // EVERY Mac in the fleet normalized to platform:"apple", never
    // "macos". That silently broke every macOS-scoped Compliance Policy
    // (both the Device modal's "assigned policies" list and the real
    // evaluation pass filter on `d.platform === "macos"`) and the Devices
    // view's own "macOS" filter tab (same comparison) -- confirmed live:
    // filtering by "macOS" showed 0 of 7 devices despite a real Mac being
    // enrolled. The model string is the one field that actually survives
    // normalization and reliably says Mac: real Apple hardware identifiers
    // for Macs are always prefixed Mac/MacBook/iMac (or "VirtualMac" for a
    // virtualized Mac), while iPhone/iPad models are "iPhone14,2"/
    // "iPad13,4" etc -- so refine the umbrella "apple" bucket using it.
    if (model && /mac/i.test(model)) return "macos";
    return "apple";
  }
  if (t.includes("mac")) return "macos";
  if (t.includes("win")) return "windows";
  return "other";
}

export function humanPlatform(normalized: string): string {
  const mapping: Record<string, string> = { android: "Android", apple: "Apple", macos: "macOS", windows: "Windows" };
  return mapping[normalized] ?? "Other";
}

/** Maps our normalized platform to the Applivery URL segment for platform-specific device endpoints (main.py:3629). */
export function platformPathSegment(platform: string): string | null {
  if (platform === "apple" || platform === "macos") return "apple";
  if (platform === "android") return "android";
  if (platform === "windows") return "windows";
  if (platform === "aosp") return "aosp";
  return null;
}

/** Best-effort parse of a storage/RAM value into GB (main.py:2882). Values look like raw bytes when > ~1e6. */
export function parseCapacityGb(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  let v: number;
  if (typeof val === "string") {
    const cleaned = val.replace(/[^0-9.]/g, "");
    v = cleaned ? Number.parseFloat(cleaned) : 0;
  } else {
    v = Number(val);
  }
  if (Number.isNaN(v) || v <= 0) return null;
  return v > 1_000_000 ? v / 1024 ** 3 : v;
}

// Policy keys carrying a single applied-policy object, keyed by the platform they imply (main.py:2896).
const SINGLE_POLICY_KEYS: Array<[string, string]> = [
  ["appliedEmmPolicy", "android"], ["deviceEmmPolicy", "android"], ["emmPolicy", "android"],
  ["appliedAdmPolicy", "apple"], ["deviceAdmPolicy", "apple"], ["admPolicy", "apple"],
  ["appliedWinPolicy", "windows"], ["deviceWinPolicy", "windows"], ["winPolicy", "windows"],
];
// Policy keys carrying an array of assignment objects, keyed by the platform they imply (main.py:2902).
const ARRAY_POLICY_KEYS: Array<[string, string]> = [
  ["emmPolicyAssignments", "android"], ["emmPolicyAssignmentsEnforced", "android"],
  ["admPolicyAssignments", "apple"], ["admPolicyAssignmentsEnforced", "apple"],
  ["winPolicyAssignments", "windows"], ["winPolicyAssignmentsEnforced", "windows"],
];

export interface ActivePolicy {
  id: string | null;
  name: string;
  platform: string;
  // Real Applivery Policy Composition priority (lower number = higher
  // priority — see docs.applivery.com's Policy Composition guide; a
  // device's single-policy-model "primary" slot below has no priority of
  // its own, so this is only ever populated for entries that came off an
  // *PolicyAssignments array, where Applivery's PUT device payload requires
  // an explicit integer priority per assignment). null for a primary-slot
  // entry or anything we couldn't find a priority on.
  priority: number | null;
  // True if this entry came from the single "primary policy" key
  // (admPolicyId/emmPolicyId/winPolicyId) rather than the *PolicyAssignments
  // array — applyDevicePolicies (devices.service.ts) needs this to know
  // which entry (if any) to keep in that top-level slot when re-submitting,
  // instead of collapsing everything down to array position like before.
  isPrimary: boolean;
}

/** Clean, de-duplicated [{id, name, platform, priority, isPrimary}] list of currently-applied policies (main.py:2908 _extract_active_policies, extended to carry each assignment's real priority so callers can compute a new policy's priority relative to what's actually on the device instead of guessing from array position). */
export function extractActivePolicies(raw: Record<string, any>): ActivePolicy[] {
  const found: ActivePolicy[] = [];
  const seen = new Set<string>();

  const add = (p: any, platform: string, priority: number | null, isPrimary: boolean) => {
    if (!p) return;
    let pid: string | null = null;
    let name: string | null = null;
    if (p && typeof p === "object" && !Array.isArray(p)) {
      pid = p.id ?? p._id ?? p.policyId ?? p.emmPolicyId ?? p.admPolicyId ?? p.winPolicyId ?? null;
      name = p.name ?? p.policyName ?? p.emmPolicyName ?? p.admPolicyName ?? p.winPolicyName ?? null;
    } else if (typeof p === "string" && p.trim()) {
      name = p.trim();
      pid = p.trim();
    }
    if (pid !== null) pid = String(pid);
    if (!name || !String(name).trim()) return;
    const key = `${platform}:${pid ?? name}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ id: pid, name: String(name).trim(), platform, priority, isPrimary });
  };

  for (const [key, platform] of SINGLE_POLICY_KEYS) {
    add(raw[key], platform, null, true);
  }
  for (const [key, platform] of ARRAY_POLICY_KEYS) {
    const items = raw[key];
    if (Array.isArray(items)) {
      for (const entry of items) {
        if (entry && typeof entry === "object") {
          const nested = entry.admPolicy || entry.emmPolicy || entry.winPolicy;
          const rawPriority = entry.priority;
          const priority = typeof rawPriority === "number" && Number.isFinite(rawPriority) ? rawPriority : null;
          add(nested || entry, platform, priority, false);
        } else {
          add(entry, platform, null, false);
        }
      }
    }
  }
  return found;
}

export interface DeviceAudienceRef {
  id: string;
  name: string;
}

export interface NormalizedDevice {
  id: string;
  displayName: string;
  platform: NormalizedPlatform;
  platformLabel: string;
  rawPlatform: string;
  platformDeviceId: string;
  serialNumber: string;
  imei: string;
  model: string;
  manufacturer: string;
  osVersion: string;
  // Value of whichever Applivery Smart Attribute Settings > Workspace
  // Automation has mapped as the OS Patch Level source (see
  // osPatchLevelMapping.service.ts) — read off this same device's own
  // smartAttributes[] below, not a separate API call. Null when no mapping
  // is configured, or when this device simply doesn't carry that attribute.
  // Format is platform-dependent (populated by the customer on Applivery's
  // side): Android SPL date ("2026-05-05"), Apple dotted version + build
  // ("26.6.2 (25G82)"), Windows full build ("10.0.28000.2704"). Feeds
  // osvAndroidService.ts/sofaService.ts for exact CVE-matching precision
  // and Compliance Policy's "OS Patch Level" condition
  // (complianceFields.ts/complianceEvaluate.ts) — both fall back to the
  // coarser osVersion-based behavior when this is null.
  osPatchLevel: string | null;
  battery: number | null;
  // Added for the merged device modal (Devices view + Playground/Dashboard
  // "insight" entry points) — previously only read off the raw Applivery
  // item by DeviceInsightModal.vue directly (summary.macAddress/ipAddress/
  // managementMode with a handful of top-level fallbacks); pulled into the
  // normalized shape here so both entry points show the same fields from
  // the same source once resolved to a full NormalizedDevice.
  macAddress: string;
  ipAddress: string;
  managementMode: string;
  state: string;
  lastSeen: unknown;
  enrolledAt: unknown;
  isCompliant: boolean;
  tags: string[];
  segmentId: unknown;
  deviceAudiences: DeviceAudienceRef[];
  mdmUser: unknown;
  location: unknown;
  selfReported: unknown;
  // Inbound Webhook (Trigger) firing state, keyed by triggerId — see
  // triggerFiresCache param on normalizeDeviceFull below. Read by
  // complianceEvaluate.ts's "Inbound Webhook Fired" condition. status
  // reflects whichever of the trigger's two URLs (Fire/Resolve) was called
  // most recently for this device — see TriggerFireState's schema.prisma
  // doc comment for the full Fired/Resolved lifecycle this exists for.
  triggerFires: Record<string, { status: "active" | "resolved"; lastFiredAt: string; resolvedAt: string | null; fireCount: number }> | null;
  nativeSecurity: Record<string, any> | null;
  identifiers: { udid: string; emmDeviceId: string; winId: string };
  smartAttributes: Array<{ name: string; value: string }>;
  smartAttributeAssignmentIds: string[];
  totalStorageGb: number | null;
  availableStorageGb: number | null;
  ramGb: number | null;
  activePolicies: ActivePolicy[];
  policies: {
    admPolicyAssignmentsEnforced: unknown;
    emmPolicyAssignmentsEnforced: unknown;
    winPolicyAssignmentsEnforced: unknown;
  };
  // Fields populated by devices.service.ts's getDevicesFull AFTER
  // normalization (mirrors main.py:3552-3578) — declared here so
  // computeDeviceRisk's input type is complete. All Phase 3/8 dependent
  // fields are stubbed to null/empty by this phase.
  openCases?: Array<Record<string, any>>;
  activeViolations?: Array<Record<string, any>>;
  policyViolations?: Array<Record<string, any>>;
  policyCompliant?: boolean;
  osUpdateStatus?: Record<string, any> | null;
  // Windows-only — the human-readable feature-update name (e.g. "Windows
  // 11, version 25H2") for this device's raw osVersion build number.
  // Applivery's own inventory only ever reports the bare build string (e.g.
  // "10.0.26200.5074"), never a marketing name — computed independently of
  // osUpdateStatus (a pure sync lookup, no MSRC catalog dependency) so it's
  // always available even when the update-intelligence catalog itself isn't.
  windowsVersionLabel?: string | null;
  // "SOAR Agent" (our own Windows/macOS agent, self-reported via
  // deviceData.service.ts's /api/device-data/report) is a distinct concept
  // from Applivery's own "Applivery Agent" (their MDM enrollment agent,
  // which is what powers isCompliant/activePolicies/etc. below) — this pair
  // exists so the UI can say specifically whether OUR agent is reporting,
  // without that reading as a claim about Applivery's own agent. `true` only
  // when the last self-report is within SOAR_AGENT_STALE_THRESHOLD_MS
  // (devices.service.ts) — a device that reported once months ago and has
  // gone quiet since is "stale", not "reporting".
  soarAgentReporting?: boolean;
  soarAgentLastReportedAt?: string | null;
  vulnStatus?: Record<string, any> | null;
  osLifecycleStatus?: Record<string, any> | null;
  appleAppUpdateStatus?: Record<string, any> | null;
  vulnServiceStatus?: Record<string, any> | null;
  // Single unified, OS-only "Vulnerabilities" section for the Device modal's
  // Compliance tab — see vulnService.ts's mergeOsVulnerabilities doc comment.
  // Merges vulnStatus (EUVD catalog) with vulnServiceStatus's OS-only slice;
  // never includes app-level CVEs (those live in installedAppsDetail below /
  // the fleet-wide Apps view instead). Purely additive for the UI — vulnStatus/
  // vulnServiceStatus are untouched and still back Compliance Policy conditions.
  osVulnerabilities?: Record<string, any> | null;
  // Backs the Device modal's Apps tab (devices.service.ts's getDevicesFull,
  // via vulnService.ts's computeDeviceAppsDetail) — every app this device
  // reports (self-reported or MDM-fetched), each with its own CVE result
  // when the Vulnerability Service is enabled and has a fresh cached match.
  installedAppsDetail?: Array<Record<string, any>> | null;
  riskScore?: number;
  riskTier?: string;
  riskFactors?: Array<{ label: string; points: number }>;
}

/**
 * Normalize a raw Applivery device record into the shape the Devices view
 * consumes — port of `_normalize_device_full` (main.py:3091).
 *
 * @param pushdataCache Device self-report agent data (Windows/macOS
 *   attestation script, matched by serial number) — see
 *   deviceData.service.ts's loadDevicePushDataCache (Phase 8). Empty for any
 *   device that has never self-reported.
 * @param osPatchLevelAttrName The Smart Attribute name Settings > Workspace
 *   Automation has mapped as the OS Patch Level source (see
 *   osPatchLevelMapping.service.ts) — looked up ONCE per fleet-wide call by
 *   the caller (devices.service.ts), not per device. Null/undefined means
 *   no mapping configured.
 * @param triggerFiresCache Per-device Inbound Webhook (Trigger) firing
 *   state, keyed by device id (not serial number, unlike pushdataCache —
 *   TriggerFireState.deviceId is the SOAR/Applivery device id
 *   `resolveTriggerDevice` matched against, set in triggers.service.ts's
 *   fireTrigger/resolveTrigger). Each entry is
 *   `{ [triggerId]: { status, lastFiredAt, resolvedAt, fireCount } }` — see
 *   devices.service.ts for how it's assembled. Empty for any device no
 *   inbound webhook has ever fired against.
 */
export function normalizeDeviceFull(
  raw: Record<string, any>,
  compIds: Set<string>,
  locCache: Record<string, unknown>,
  audienceMap: Record<string, DeviceAudienceRef[]> = {},
  pushdataCache: Record<string, unknown> = {},
  osPatchLevelAttrName: string | null = null,
  triggerFiresCache: Record<string, Record<string, { status: "active" | "resolved"; lastFiredAt: string; resolvedAt: string | null; fireCount: number }>> = {},
): NormalizedDevice {
  const devId = String(raw.id ?? raw._id ?? "");
  const rawPlatform = String(raw.type ?? raw.platform ?? "");
  const summary = raw.summary ?? {};
  // Computed here (ahead of the `model` field further down) purely so
  // normalizePlatform can use it to tell a Mac apart from an iPhone/iPad --
  // see that function's doc comment for why the raw `type`/`platform`
  // value alone can't do this.
  const rawModel = String(summary.model || raw.model || raw.deviceModel || "");
  const platform = normalizePlatform(rawPlatform, rawModel);

  let platformDeviceId: string;
  if (platform === "apple" || platform === "macos") {
    platformDeviceId = raw.admDevice ?? devId;
  } else if (platform === "android") {
    platformDeviceId = raw.emmDevice ?? devId;
  } else if (platform === "windows") {
    platformDeviceId = raw.winDevice ?? devId;
  } else {
    platformDeviceId = devId;
  }

  let battery: number | null = summary.battery ?? raw.battery ?? null;
  if (battery !== null) {
    const parsed = Number.parseInt(String(battery), 10);
    battery = Number.isNaN(parsed) ? null : parsed;
  }

  const totalGb = parseCapacityGb(summary.totalStorage ?? summary.totalCapacity ?? raw.totalCapacity);
  const availGb = parseCapacityGb(summary.availableStorage ?? summary.availableCapacity ?? raw.availableCapacity);
  const ramGb = parseCapacityGb(summary.totalMemory);

  const smartAttrsRaw = raw.smartAttributes ?? raw.customAttributes ?? summary.customAttributes;
  const smartAttributes: Array<{ name: string; value: string }> = [];
  if (Array.isArray(smartAttrsRaw)) {
    for (const attr of smartAttrsRaw) {
      if (attr && typeof attr === "object") {
        const name = attr.name ?? attr.key;
        const value = attr.value ?? attr.val;
        if (name) smartAttributes.push({ name: String(name), value: value === null || value === undefined || value === "" ? "—" : String(value) });
      }
    }
  } else if (smartAttrsRaw && typeof smartAttrsRaw === "object") {
    for (const [k, v] of Object.entries(smartAttrsRaw)) {
      smartAttributes.push({ name: k, value: v === null || v === undefined || v === "" ? "—" : String(v) });
    }
  }

  const smartAttributeAssignmentIds: string[] = [];
  for (const a of raw.smartAttributeAssignments ?? []) {
    if (a && typeof a === "object" && a.smartAttributeId) smartAttributeAssignmentIds.push(String(a.smartAttributeId));
  }

  const osPatchLevelRaw = osPatchLevelAttrName ? smartAttributes.find((a) => a.name === osPatchLevelAttrName)?.value ?? null : null;
  const osPatchLevel = osPatchLevelRaw && osPatchLevelRaw !== "—" ? osPatchLevelRaw : null;

  const serialNumber = summary.serialNumber ?? raw.serialNumber ?? "";
  // Populated from the real device-data pushdata store (main.py:3148) —
  // see deviceData.service.ts's loadDevicePushDataCache (Phase 8).
  const selfReported = serialNumber ? pushdataCache[serialNumber] ?? null : null;

  let nativeSecurity: Record<string, any> | null = null;
  if (platform === "android") {
    const deviceSettings = raw.deviceSettings ?? {};
    const securityPosture = raw.securityPosture ?? {};
    nativeSecurity = {
      isDeviceSecure: deviceSettings.isDeviceSecure ?? null,
      encryptionStatus: deviceSettings.encryptionStatus ?? null,
      isEncrypted: deviceSettings.isEncrypted ?? null,
      adbEnabled: deviceSettings.adbEnabled ?? null,
      unknownSourcesEnabled: deviceSettings.unknownSourcesEnabled ?? null,
      developmentSettingsEnabled: deviceSettings.developmentSettingsEnabled ?? null,
      verifyAppsEnabled: deviceSettings.verifyAppsEnabled ?? null,
      policyCompliant: raw.policyCompliant ?? null,
      devicePosture: securityPosture.devicePosture ?? null,
      postureDetails: securityPosture.postureDetails ?? [],
      nonComplianceDetails: raw.nonComplianceDetails ?? [],
    };
    const hasSignal = Object.values(nativeSecurity).some((v) => !(v === null || v === undefined || (Array.isArray(v) && v.length === 0)));
    if (!hasSignal) nativeSecurity = null;
  }

  return {
    id: devId,
    displayName: raw.displayName || raw.name || summary.name || "Unknown Device",
    platform,
    platformLabel: humanPlatform(platform),
    rawPlatform,
    platformDeviceId,
    serialNumber,
    imei: summary.imei || raw.imei || "",
    model: rawModel,
    manufacturer: summary.manufacturer || raw.manufacturer || raw.brand || "",
    osVersion: summary.osVersion || raw.osVersion || "",
    osPatchLevel,
    battery,
    macAddress: summary.macAddress || raw.macAddress || raw.networkInfo?.mac || "",
    ipAddress: summary.ipAddress || raw.ipAddress || "",
    managementMode: raw.managementMode || summary.managementMode || "",
    state: String(raw.state || raw.status || "unknown").toLowerCase(),
    lastSeen: raw.lastStatusReportTime ?? raw.lastSeen ?? raw.updatedAt ?? null,
    enrolledAt: raw.enrolledDate ?? raw.createdAt ?? null,
    isCompliant: compIds.has(devId),
    tags: raw.tags ?? [],
    segmentId: raw.segmentId ?? null,
    deviceAudiences: audienceMap[devId] ?? [],
    mdmUser: raw.mdmUser ?? null,
    location: locCache[devId] ?? null,
    selfReported,
    triggerFires: triggerFiresCache[devId] ?? null,
    nativeSecurity,
    identifiers: {
      udid: raw.udid || summary.udid || "",
      emmDeviceId: raw.emmDeviceId || "",
      winId: raw.winId || "",
    },
    smartAttributes,
    smartAttributeAssignmentIds,
    totalStorageGb: totalGb,
    availableStorageGb: availGb,
    ramGb,
    activePolicies: extractActivePolicies(raw),
    policies: {
      admPolicyAssignmentsEnforced: raw.admPolicyAssignmentsEnforced ?? null,
      emmPolicyAssignmentsEnforced: raw.emmPolicyAssignmentsEnforced ?? null,
      winPolicyAssignmentsEnforced: raw.winPolicyAssignmentsEnforced ?? null,
    },
  };
}

export interface RiskResult {
  riskScore: number;
  riskTier: "low" | "medium" | "high" | "critical";
  riskFactors: Array<{ label: string; points: number }>;
}

/**
 * Additive, fully-explainable device risk score (0-100) — port of
 * `_compute_device_risk` (main.py:3239). `openCases`/`activeViolations` are
 * passed by the caller (devices.service.ts's getDevicesFull), which loads
 * them once per fleet-wide call from the live Case/complianceEvaluationState
 * tables.
 *
 * The OS-update/vuln/lifecycle/app-update/vuln-service fields read off
 * `device` (osUpdateStatus, vulnStatus, osLifecycleStatus,
 * appleAppUpdateStatus, vulnServiceStatus) are populated by
 * getDevicesFull from the OS-update/vuln/lifecycle/GDMF catalog services
 * and their background-refresher jobs (backend/src/jobs/backgroundJobs.ts),
 * so every scoring branch below is live, not a stub.
 */
export function computeDeviceRisk(
  device: NormalizedDevice,
  openCases: Array<Record<string, any>> = [],
  activeViolations: Array<Record<string, any>> = [],
): RiskResult {
  let score = 0;
  const factors: Array<{ label: string; points: number }> = [];

  if (device.isCompliant === false) {
    score += 25;
    factors.push({ label: "Out of compliance with an assigned Applivery policy", points: 25 });
  }

  for (const v of activeViolations.slice(0, 3)) {
    const points = 15;
    score += points;
    factors.push({ label: `Violates policy: "${v.policyName ?? "Unknown policy"}"`, points });
  }

  const selfReported = (device.selfReported as Record<string, any>) ?? {};
  const attrs = selfReported.attributes ?? {};
  const nativeSecurity = device.nativeSecurity;

  if (device.selfReported && Object.keys(attrs).length > 0) {
    const attrPenalties: Array<[string, string, number]> = [
      ["diskEncryptionEnabled", "Disk encryption disabled", 15],
      ["firewallEnabled", "Firewall disabled", 10],
      ["antivirusEnabled", "Antivirus disabled", 15],
      ["secureBootEnabled", "Secure Boot disabled", 10],
      ["tpmEnabled", "TPM not enabled", 5],
      ["vbsEnabled", "Virtualization-based security disabled", 5],
      ["credentialGuardEnabled", "Credential Guard disabled", 5],
    ];
    for (const [attrKey, label, points] of attrPenalties) {
      if (attrs[attrKey] === false) {
        score += points;
        factors.push({ label, points });
      }
    }

    const lastReported = selfReported.lastReportedAt;
    if (lastReported) {
      try {
        const dt = new Date(String(lastReported).replace("Z", "+00:00"));
        const staleDays = (Date.now() - dt.getTime()) / 86_400_000;
        if (staleDays > 30) {
          score += 10;
          factors.push({ label: "Security attestation stale (30+ days)", points: 10 });
        }
      } catch {
        // ignore unparsable timestamps, same as the original's bare except
      }
    }
  } else if (nativeSecurity) {
    if (nativeSecurity.isDeviceSecure === false) {
      score += 15;
      factors.push({ label: "Android: device not secure (lock screen/encryption check failed)", points: 15 });
    }
    const encryptionStatus = String(nativeSecurity.encryptionStatus ?? "").toUpperCase();
    if (encryptionStatus && !["ENCRYPTED", "ENCRYPTED_PER_USER"].includes(encryptionStatus)) {
      score += 15;
      factors.push({ label: `Android: encryption status is ${titleCase(encryptionStatus.replace(/_/g, " "))}`, points: 15 });
    }
    if (nativeSecurity.adbEnabled === true) {
      score += 5;
      factors.push({ label: "Android: USB debugging (ADB) enabled", points: 5 });
    }
    if (nativeSecurity.unknownSourcesEnabled === true) {
      score += 10;
      factors.push({ label: "Android: install from unknown sources allowed", points: 10 });
    }
    if (nativeSecurity.policyCompliant === false) {
      score += 15;
      factors.push({ label: "Android: not compliant with its Android Management policy", points: 15 });
    }
    const posture = nativeSecurity.devicePosture;
    if (posture === "AT_RISK" || posture === "POTENTIALLY_COMPROMISED") {
      const points = posture === "POTENTIALLY_COMPROMISED" ? 25 : 15;
      score += points;
      factors.push({ label: `Android device posture: ${titleCase(String(posture).replace(/_/g, " "))}`, points });
    }
    for (const detail of (nativeSecurity.nonComplianceDetails ?? []).slice(0, 3)) {
      const points = 10;
      score += points;
      const setting = detail.settingName ?? detail.nonComplianceReason ?? "unknown setting";
      factors.push({ label: `Android policy non-compliance: ${setting}`, points });
    }
  } else {
    score += 10;
    factors.push({ label: "No security attestation reported", points: 10 });
  }

  const openCaseCount = openCases.length;
  if (openCaseCount > 0) {
    const points = Math.min(openCaseCount * 10, 20);
    score += points;
    factors.push({ label: `${openCaseCount} open case${openCaseCount !== 1 ? "s" : ""}`, points });
  }

  // osUpdateStatus / vulnStatus / vulnServiceStatus / osLifecycleStatus /
  // appleAppUpdateStatus are populated on `device` by getDevicesFull from
  // the live catalog services before this function runs, so all five
  // blocks below fire normally.
  const osUpdateStatus = device.osUpdateStatus;
  if (osUpdateStatus && (osUpdateStatus.pendingCount ?? 0) > 0) {
    const pending = osUpdateStatus.pendingCount;
    const points = Math.min(pending * 5, 20);
    score += points;
    factors.push({ label: `${pending} pending Windows security update${pending !== 1 ? "s" : ""}`, points });
    if ((osUpdateStatus.pendingKbs ?? []).some((kb: any) => kb.exploited)) {
      score += 20;
      factors.push({ label: "A pending Windows update fixes an exploited CVE", points: 20 });
    }
  }

  // OS-level CVEs — sourced from device.osVulnerabilities (vulnService.ts's
  // mergeOsVulnerabilities), the SAME unified, deduped, confirmed-only field
  // the Compliance tab's Vulnerabilities section renders, not the raw
  // vulnStatus/vulnServiceStatus inputs that feed it. Those two are left
  // completely untouched for complianceEvaluate.ts's Compliance Policy
  // conditions (vulnPendingCveCount, vulnServiceCriticalHighCount, etc.),
  // which must keep reading their own original, uncombined shapes — but
  // scoring risk off them directly was a real bug: vulnStatus.pendingCount
  // is the EUVD catalog's own uncapped, un-deduped count (potentially 100+,
  // spanning the OS product's entire history) and vulnServiceStatus.counts
  // mixes OS-level AND every installed app's CVEs together — neither number
  // has any relationship to what the Compliance tab actually displays right
  // below Risk Factors, which is exactly the inconsistency reported live
  // ("112 pending known CVEs" / "55 critical/high CVEs" in Risk Factors vs.
  // "15 known CVEs" in Vulnerabilities for the same device).
  const osVulns = device.osVulnerabilities;
  if (osVulns?.visible && osVulns.state === "cves") {
    const cves = (osVulns.cves ?? []) as Array<Record<string, any>>;
    const criticalHigh = cves.filter((c) => c.severity === "CRITICAL" || c.severity === "HIGH").length;
    if (criticalHigh > 0) {
      const points = Math.min(criticalHigh * 5, 20);
      score += points;
      factors.push({ label: `${criticalHigh} critical/high CVE${criticalHigh !== 1 ? "s" : ""} against this device's OS version`, points });
    }
    if (cves.some((c) => c.is_kev)) {
      score += 25;
      factors.push({ label: "A known-exploited CVE (CISA KEV) is present against this device's OS version", points: 25 });
    } else if (Math.max(0, ...cves.map((c) => c.epss_score ?? 0)) >= 0.5) {
      score += 15;
      factors.push({ label: "An OS CVE has a high exploitation-probability (EPSS) score", points: 15 });
    }
  }

  // App-level CVEs — sourced from device.installedAppsDetail (already
  // confirmed-only per app, see vulnService.ts's toVersionVulnInfo), summed
  // across every app on the device. This is a NEW, separate factor rather
  // than folded into the OS one above — an app's own CVEs are a real,
  // independent exposure, but conflating them with OS CVEs into one number
  // (the old vulnServiceStatus.counts-based factor) is exactly what made
  // "the reported CVEs and pending updates numbers must match" impossible:
  // there was no single displayed number this factor actually corresponded
  // to. This one has a direct counterpart: the sum of "Show N CVEs" across
  // the Apps tab / the Apps view's Risk column.
  const appsDetail = (device.installedAppsDetail ?? []) as Array<Record<string, any>>;
  let appsCriticalHigh = 0;
  let appsHasKev = false;
  for (const a of appsDetail) {
    const v = a.vuln as Record<string, any> | null | undefined;
    if (!v) continue;
    appsCriticalHigh += (v.counts?.CRITICAL ?? 0) + (v.counts?.HIGH ?? 0);
    if (v.hasKev) appsHasKev = true;
  }
  if (appsCriticalHigh > 0) {
    const points = Math.min(appsCriticalHigh * 5, 20);
    score += points;
    factors.push({ label: `${appsCriticalHigh} critical/high CVE${appsCriticalHigh !== 1 ? "s" : ""} across installed apps`, points });
  }
  if (appsHasKev) {
    score += 25;
    factors.push({ label: "A known-exploited CVE (CISA KEV) is present in an installed app", points: 25 });
  }

  const osLifecycleStatus = device.osLifecycleStatus;
  if (osLifecycleStatus && osLifecycleStatus.isEol) {
    score += 20;
    factors.push({ label: "OS version has reached end of life for security support", points: 20 });
  }

  const appleAppUpdateStatus = device.appleAppUpdateStatus;
  if (appleAppUpdateStatus && (appleAppUpdateStatus.pendingCount ?? 0) > 0) {
    const pending = appleAppUpdateStatus.pendingCount;
    const points = Math.min(pending * 2, 10);
    score += points;
    factors.push({ label: `${pending} app${pending !== 1 ? "s" : ""} with an update available`, points });
  }

  score = Math.min(score, 100);
  let tier: RiskResult["riskTier"];
  if (score >= 75) tier = "critical";
  else if (score >= 50) tier = "high";
  else if (score >= 25) tier = "medium";
  else tier = "low";

  return { riskScore: score, riskTier: tier, riskFactors: factors };
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
