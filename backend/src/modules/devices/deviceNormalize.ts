/**
 * Faithful port of main.py's device normalization + risk-scoring helpers
 * (normalize_platform, human_platform, _parse_capacity_gb,
 * _SINGLE_POLICY_KEYS/_ARRAY_POLICY_KEYS, _extract_active_policies,
 * _normalize_device_full, _compute_device_risk — main.py:2743-3417).
 *
 * Phase 3 (Compliance + catalogs) / Phase 5 (Cases) / Phase 8 (device
 * push-data self-report ingestion) inputs don't exist yet in this
 * incremental migration. Every place the original reads one of those is
 * marked `// TODO(PhaseN):` below and passed as an explicit empty/null
 * value — EXACTLY the shape the original app itself produces before those
 * background jobs/endpoints have ever run for a workspace (a cold-start
 * device has no open cases, no violations, no self-reported attributes,
 * etc.), so this is not an approximation: it's the same code path the
 * original takes when that data simply doesn't exist yet.
 */

export type NormalizedPlatform = "android" | "apple" | "macos" | "windows" | "other";

export function normalizePlatform(rawType: string): NormalizedPlatform {
  const t = String(rawType ?? "").toLowerCase();
  if (t.includes("android")) return "android";
  if (t.includes("apple") || t.includes("ios") || t.includes("ipad")) return "apple";
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
}

/** Clean, de-duplicated [{id, name, platform}] list of currently-applied policies (main.py:2908 _extract_active_policies). */
export function extractActivePolicies(raw: Record<string, any>): ActivePolicy[] {
  const found: ActivePolicy[] = [];
  const seen = new Set<string>();

  const add = (p: any, platform: string) => {
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
    found.push({ id: pid, name: String(name).trim(), platform });
  };

  for (const [key, platform] of SINGLE_POLICY_KEYS) {
    add(raw[key], platform);
  }
  for (const [key, platform] of ARRAY_POLICY_KEYS) {
    const items = raw[key];
    if (Array.isArray(items)) {
      for (const entry of items) {
        if (entry && typeof entry === "object") {
          const nested = entry.admPolicy || entry.emmPolicy || entry.winPolicy;
          add(nested || entry, platform);
        } else {
          add(entry, platform);
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
  battery: number | null;
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
  vulnStatus?: Record<string, any> | null;
  osLifecycleStatus?: Record<string, any> | null;
  appleAppUpdateStatus?: Record<string, any> | null;
  vulnServiceStatus?: Record<string, any> | null;
  riskScore?: number;
  riskTier?: string;
  riskFactors?: Array<{ label: string; points: number }>;
}

/**
 * Normalize a raw Applivery device record into the shape the Devices view
 * consumes — port of `_normalize_device_full` (main.py:3091).
 *
 * @param pushdataCache TODO(Phase8): device self-report agent data
 *   (Windows/macOS attestation script, matched by serial number). Always
 *   empty in this phase — no device has ever self-reported yet, same as a
 *   brand-new original-app workspace before /api/device-data/report exists.
 */
export function normalizeDeviceFull(
  raw: Record<string, any>,
  compIds: Set<string>,
  locCache: Record<string, unknown>,
  audienceMap: Record<string, DeviceAudienceRef[]> = {},
  pushdataCache: Record<string, unknown> = {},
): NormalizedDevice {
  const devId = String(raw.id ?? raw._id ?? "");
  const rawPlatform = String(raw.type ?? raw.platform ?? "");
  const platform = normalizePlatform(rawPlatform);
  const summary = raw.summary ?? {};

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

  const serialNumber = summary.serialNumber ?? raw.serialNumber ?? "";
  // TODO(Phase8): populate from the real device-data pushdata store once
  // /api/device-data/report exists (main.py:3148). Always null for now.
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
    model: summary.model || raw.model || raw.deviceModel || "",
    manufacturer: summary.manufacturer || raw.manufacturer || raw.brand || "",
    osVersion: summary.osVersion || raw.osVersion || "",
    battery,
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
 * them once per fleet-wide call. In this phase both are ALWAYS empty
 * arrays — TODO(Phase5): Cases don't exist yet; TODO(Phase3): Compliance
 * Policy violations don't exist yet — this exactly matches how the
 * original scores a device before either subsystem has ever run.
 *
 * The OS-update/vuln/lifecycle/app-update/vuln-service fields read off
 * `device` (osUpdateStatus, vulnStatus, osLifecycleStatus,
 * appleAppUpdateStatus, vulnServiceStatus) are TODO(Phase3): always null
 * until the catalog-refresher background jobs exist, so those scoring
 * branches never fire yet — again matching cold-start original behavior.
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

  // TODO(Phase3): all five blocks below never fire yet — osUpdateStatus /
  // vulnStatus / vulnServiceStatus / osLifecycleStatus / appleAppUpdateStatus
  // are always null until the OS-update/vuln/lifecycle/GDMF/vuln-service
  // catalog-refresher jobs exist. Kept verbatim (not deleted) so wiring
  // Phase 3 in later just means populating these fields on `device`.
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

  const vulnStatus = device.vulnStatus;
  if (vulnStatus && vulnStatus.confidence !== "unknown" && (vulnStatus.pendingCount ?? 0) > 0) {
    const pending = vulnStatus.pendingCount;
    const points = Math.min(pending * 5, 20);
    score += points;
    factors.push({ label: `${pending} pending known CVE${pending !== 1 ? "s" : ""}`, points });
    if ((vulnStatus.pendingCves ?? []).some((c: any) => c.exploited)) {
      score += 25;
      factors.push({ label: "A pending CVE is exploited in the wild", points: 25 });
    }
  }

  const vulnServiceStatus = device.vulnServiceStatus;
  if (vulnServiceStatus && vulnServiceStatus.checked) {
    const counts = vulnServiceStatus.counts ?? {};
    const criticalHigh = (counts.CRITICAL ?? 0) + (counts.HIGH ?? 0);
    if (criticalHigh > 0) {
      const points = Math.min(criticalHigh * 5, 20);
      score += points;
      factors.push({ label: `${criticalHigh} critical/high CVE${criticalHigh !== 1 ? "s" : ""} (Vulnerability Service)`, points });
    }
    if (vulnServiceStatus.hasKev) {
      score += 25;
      factors.push({ label: "A known-exploited CVE (CISA KEV) is present (Vulnerability Service)", points: 25 });
    } else if ((vulnServiceStatus.maxEpss ?? 0) >= 0.5) {
      score += 15;
      factors.push({ label: "A CVE has a high exploitation-probability (EPSS) score (Vulnerability Service)", points: 15 });
    }
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
