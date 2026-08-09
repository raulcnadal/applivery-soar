/**
 * Static registries for the Compliance Policy Builder — ported verbatim
 * from main.py: COMPLIANCE_FIELDS (main.py:9815), COMPLIANCE_FIELD_MITRE_HINTS
 * (main.py:9896), MITRE_TACTICS/MITRE_TECHNIQUES (main.py:11612-11672),
 * COMPLIANCE_FRAMEWORKS (main.py:9999-10150).
 *
 * COMPLIANCE_POLICY_TEMPLATES below is NOT a port — main.py's
 * CompliancePolicyPayload has no platform concept at all, so its templates
 * (when this app still had them 1:1) were OS-blended (one template mixing a
 * Windows/macOS self-reported-attribute check with an Android customField
 * check via "any" logic). Now that CompliancePolicy carries targetPlatform
 * (see schema.prisma, mirroring Workflow's own field), this registry was
 * rewritten so each template targets exactly one platform (or explicitly
 * "Common" via targetPlatform: null) and uses the condition that's actually
 * realistic for that OS's telemetry -- e.g. Windows/macOS get
 * selfReportedAttribute checks (the agent-reported vocabulary in
 * WINDOWS_ATTR_ALIASES/MACOS_ATTR_ALIASES), Android gets customField checks
 * against its live Android Management API nativeSecurity block
 * (deviceNormalize.ts), and iOS -- which has neither a self-report agent nor
 * a nativeSecurity block anywhere in this app -- only gets templates built
 * from what's actually observable for it (OS/vulnerability currency, App
 * Store app currency, check-in recency), never a fabricated encryption or
 * screen-lock signal.
 */

export interface ComplianceFieldDef {
  key: string;
  label: string;
  type: string;
  operators: string[];
  options?: string[];
  // Which policy targetPlatform(s) this field is meaningful for -- omitted
  // (undefined) means universal/every platform. Purely a UI filter (Policy
  // Builder hides fields that don't apply to the policy's locked-in target
  // platform, mirroring how Workflow's builder hides incompatible MDM
  // actions) -- the evaluator itself (complianceEvaluate.ts) doesn't
  // enforce this, so a raw API payload with a mismatched field/platform
  // combination still evaluates literally rather than erroring, same as
  // every other condition field always has. Not present in the original
  // main.py's COMPLIANCE_FIELDS at all -- a disclosed addition to support
  // per-OS Policy Builder gating.
  platforms?: string[];
}

export const COMPLIANCE_FIELDS: ComplianceFieldDef[] = [
  { key: "isCompliant", label: "Applivery compliance flag", type: "boolean", operators: ["equals"] },
  // Redundant once a policy has a locked-in targetPlatform (the whole
  // policy is already scoped) -- the Policy Builder hides this field
  // specifically when targetPlatform is set, but it stays in the catalog
  // unconditionally since "Common (all platforms)" policies still need it.
  { key: "platform", label: "Platform", type: "select", operators: ["equals", "notEquals"], options: ["apple", "macos", "android", "windows"] },
  { key: "osVersion", label: "OS version", type: "string", operators: ["lessThan", "greaterThan", "equals"] },
  { key: "lastSeenDaysAgo", label: "Days since last check-in", type: "number", operators: ["greaterThan", "lessThan"] },
  { key: "daysSinceEnrollment", label: "Time since enrollment", type: "duration", operators: ["greaterThan", "lessThan"] },
  { key: "battery", label: "Battery %", type: "number", operators: ["lessThan", "greaterThan"] },
  { key: "availableStorageGb", label: "Available storage (GB)", type: "number", operators: ["lessThan", "greaterThan"] },
  { key: "totalStorageGb", label: "Total storage (GB)", type: "number", operators: ["lessThan", "greaterThan"] },
  { key: "ramGb", label: "RAM (GB)", type: "number", operators: ["lessThan", "greaterThan"] },
  { key: "manufacturer", label: "Manufacturer", type: "string", operators: ["equals", "notEquals", "contains"] },
  { key: "model", label: "Model", type: "string", operators: ["equals", "notEquals", "contains"] },
  { key: "serialNumber", label: "Serial number", type: "string", operators: ["equals", "contains"] },
  { key: "imei", label: "IMEI", type: "string", operators: ["equals", "contains"], platforms: ["apple", "android"] },
  { key: "mdmUserEmail", label: "MDM user email", type: "string", operators: ["equals", "contains"] },
  { key: "segmentId", label: "Segment ID", type: "string", operators: ["equals", "notEquals"] },
  { key: "tags", label: "Tag", type: "string", operators: ["includes", "excludes"] },
  { key: "state", label: "Device state", type: "string", operators: ["equals", "notEquals"] },
  { key: "missingPolicyId", label: "Missing a required MDM policy", type: "policy", operators: ["missing"] },
  { key: "deviceAudienceId", label: "Device Audience membership", type: "device_audience", operators: ["includes", "excludes"] },
  { key: "smartAttribute", label: "Smart Attribute", type: "smart_attribute", operators: ["equals", "notEquals", "contains", "greaterThan", "lessThan", "exists", "missing"] },
  { key: "customField", label: "Custom device field (advanced)", type: "custom_field", operators: ["equals", "notEquals", "contains", "greaterThan", "lessThan", "exists", "missing"] },
  { key: "selfReportedAttribute", label: "Self-Reported Attribute (agent)", type: "self_reported_attribute", operators: ["equals", "notEquals", "contains", "greaterThan", "lessThan", "exists", "missing"] },
  // Disclosed new feature (customChecks.service.ts) — an admin-defined check
  // (process running, service status, registry/plist/file value, app
  // installed, or a raw command) the matching agent runs locally and
  // reports back. `platforms` is intentionally omitted here (the field
  // itself is universal in the catalog) — the Policy Builder narrows which
  // individual CHECK KEYS are offered to the policy's own targetPlatform
  // via GET /api/compliance/custom-check-names?platform=, same reasoning as
  // selfReportedAttribute's `name` being free-text rather than an enum.
  { key: "customCheckResult", label: "Custom Check Result (agent)", type: "custom_check_result", operators: ["equals", "notEquals", "contains", "greaterThan", "lessThan", "exists", "missing"] },
  { key: "selfReportDaysAgo", label: "Days since last self-report", type: "number", operators: ["greaterThan", "lessThan"] },
  { key: "hasSelfReported", label: "Has ever self-reported (agent installed)", type: "boolean", operators: ["equals"] },
  { key: "requiredAppList", label: "Missing a required app (from an App List)", type: "app_list", operators: ["equals"] },
  { key: "disallowedAppList", label: "Has a disallowed app (from an App List)", type: "app_list", operators: ["equals"] },
  { key: "riskScore", label: "Device Risk Score (0-100)", type: "number", operators: ["greaterThan", "lessThan"] },
  { key: "riskTier", label: "Device Risk Tier", type: "select", operators: ["equals", "notEquals"], options: ["low", "medium", "high", "critical"] },
  { key: "osUpdatePendingCount", label: "Pending Windows security updates", type: "number", operators: ["greaterThan", "lessThan"], platforms: ["windows"] },
  { key: "osUpdateExploitedPending", label: "Pending Windows update fixes an exploited CVE", type: "boolean", operators: ["equals"], platforms: ["windows"] },
  { key: "vulnPendingCveCount", label: "Pending known CVEs (Apple/Android)", type: "number", operators: ["greaterThan", "lessThan"], platforms: ["apple", "macos", "android"] },
  { key: "vulnExploitedPending", label: "Pending CVE is exploited in the wild (Apple/Android)", type: "boolean", operators: ["equals"], platforms: ["apple", "macos", "android"] },
  { key: "osEol", label: "OS version is end of life", type: "boolean", operators: ["equals"] },
  { key: "appleAppUpdatesPending", label: "Pending Apple app updates", type: "number", operators: ["greaterThan", "lessThan"], platforms: ["apple", "macos"] },
  { key: "vulnServiceCriticalHighCount", label: "Critical/high CVEs (Vulnerability Service)", type: "number", operators: ["greaterThan", "lessThan"] },
  { key: "vulnServiceHasKev", label: "Known-exploited CVE present — CISA KEV (Vulnerability Service)", type: "boolean", operators: ["equals"] },
  { key: "vulnServiceChecked", label: "Checked against Vulnerability Service", type: "boolean", operators: ["equals"] },
  // Geofencing — disclosed new feature (geofencing module), not a main.py
  // port. `inside`/`outside` treat a device with no stored location the
  // same way every other condition here treats missing data: it simply
  // doesn't match (see complianceEvaluate.ts's geofenceZoneId branch) —
  // it's neither "inside" nor "outside" from this condition's own point of
  // view. hasLocationData/locationAgeMinutes exist as separate, composable
  // fields specifically so an admin who wants fail-closed behavior (treat
  // "we don't know where this device is" as itself a violation) can build
  // that explicitly -- e.g. "outside Zone X" OR "no location data" -- rather
  // than this app silently picking a security posture on their behalf.
  { key: "geofenceZoneId", label: "Geofence zone", type: "geofence_zone", operators: ["inside", "outside"] },
  { key: "hasLocationData", label: "Has a known location on record", type: "boolean", operators: ["equals"] },
  { key: "locationAgeMinutes", label: "Minutes since location last confirmed", type: "number", operators: ["greaterThan", "lessThan"] },
];

const COMPLIANCE_FIELD_MITRE_HINTS: Record<string, string[]> = {
  osVersion: ["T1203"],
  osEol: ["T1203"],
  osUpdatePendingCount: ["T1203"],
  osUpdateExploitedPending: ["T1203"],
  vulnPendingCveCount: ["T1203"],
  vulnExploitedPending: ["T1203"],
  vulnServiceCriticalHighCount: ["T1203"],
  vulnServiceHasKev: ["T1203"],
  appleAppUpdatesPending: ["T1203"],
  lastSeenDaysAgo: ["T1562", "T1070"],
  selfReportDaysAgo: ["T1562", "T1070"],
  hasSelfReported: ["T1562"],
  missingPolicyId: ["T1562"],
  requiredAppList: ["T1562"],
  disallowedAppList: ["T1204", "T1105"],
};

export const MITRE_TACTICS = [
  { key: "initial-access", name: "Initial Access", order: 1 },
  { key: "execution", name: "Execution", order: 2 },
  { key: "persistence", name: "Persistence", order: 3 },
  { key: "privilege-escalation", name: "Privilege Escalation", order: 4 },
  { key: "defense-evasion", name: "Defense Evasion", order: 5 },
  { key: "credential-access", name: "Credential Access", order: 6 },
  { key: "discovery", name: "Discovery", order: 7 },
  { key: "lateral-movement", name: "Lateral Movement", order: 8 },
  { key: "collection", name: "Collection", order: 9 },
  { key: "command-and-control", name: "Command and Control", order: 10 },
  { key: "exfiltration", name: "Exfiltration", order: 11 },
  { key: "impact", name: "Impact", order: 12 },
];

export interface MitreTechnique {
  id: string;
  name: string;
  tactic: string;
}

export const MITRE_TECHNIQUES: MitreTechnique[] = [
  { id: "T1078", name: "Valid Accounts", tactic: "initial-access" },
  { id: "T1566", name: "Phishing", tactic: "initial-access" },
  { id: "T1195", name: "Supply Chain Compromise", tactic: "initial-access" },
  { id: "T1204", name: "User Execution", tactic: "execution" },
  { id: "T1059", name: "Command and Scripting Interpreter", tactic: "execution" },
  { id: "T1203", name: "Exploitation for Client Execution", tactic: "execution" },
  { id: "T1053", name: "Scheduled Task/Job", tactic: "persistence" },
  { id: "T1547", name: "Boot or Logon Autostart Execution", tactic: "persistence" },
  { id: "T1136", name: "Create Account", tactic: "persistence" },
  { id: "T1098", name: "Account Manipulation", tactic: "persistence" },
  { id: "T1556", name: "Modify Authentication Process", tactic: "credential-access" },
  { id: "T1548", name: "Abuse Elevation Control Mechanism", tactic: "privilege-escalation" },
  { id: "T1055", name: "Process Injection", tactic: "privilege-escalation" },
  { id: "T1562", name: "Impair Defenses", tactic: "defense-evasion" },
  { id: "T1070", name: "Indicator Removal", tactic: "defense-evasion" },
  { id: "T1112", name: "Modify Registry", tactic: "defense-evasion" },
  { id: "T1027", name: "Obfuscated Files or Information", tactic: "defense-evasion" },
  { id: "T1553", name: "Subvert Trust Controls", tactic: "defense-evasion" },
  { id: "T1497", name: "Virtualization/Sandbox Evasion", tactic: "defense-evasion" },
  { id: "T1110", name: "Brute Force", tactic: "credential-access" },
  { id: "T1003", name: "OS Credential Dumping", tactic: "credential-access" },
  { id: "T1621", name: "Multi-Factor Authentication Request Generation", tactic: "credential-access" },
  { id: "T1111", name: "Multi-Factor Authentication Interception", tactic: "credential-access" },
  { id: "T1552", name: "Unsecured Credentials", tactic: "credential-access" },
  { id: "T1082", name: "System Information Discovery", tactic: "discovery" },
  { id: "T1518", name: "Software Discovery", tactic: "discovery" },
  { id: "T1087", name: "Account Discovery", tactic: "discovery" },
  { id: "T1069", name: "Permission Groups Discovery", tactic: "discovery" },
  { id: "T1021", name: "Remote Services", tactic: "lateral-movement" },
  { id: "T1560", name: "Archive Collected Data", tactic: "collection" },
  { id: "T1119", name: "Automated Collection", tactic: "collection" },
  { id: "T1005", name: "Data from Local System", tactic: "collection" },
  { id: "T1071", name: "Application Layer Protocol", tactic: "command-and-control" },
  { id: "T1105", name: "Ingress Tool Transfer", tactic: "command-and-control" },
  { id: "T1219", name: "Remote Access Software", tactic: "command-and-control" },
  { id: "T1090", name: "Proxy", tactic: "command-and-control" },
  { id: "T1041", name: "Exfiltration Over C2 Channel", tactic: "exfiltration" },
  { id: "T1567", name: "Exfiltration Over Web Service", tactic: "exfiltration" },
  { id: "T1486", name: "Data Encrypted for Impact", tactic: "impact" },
  { id: "T1490", name: "Inhibit System Recovery", tactic: "impact" },
  { id: "T1531", name: "Account Access Removal", tactic: "impact" },
  { id: "T1561", name: "Disk Wipe", tactic: "impact" },
  { id: "T1496", name: "Resource Hijacking", tactic: "impact" },
];
const MITRE_TECHNIQUES_BY_ID = new Map(MITRE_TECHNIQUES.map((t) => [t.id, t]));

/** Whether `id` is a known MITRE ATT&CK technique in this catalog — used to filter Case.mitreTechniques on save (main.py's `_MITRE_TECHNIQUES_BY_ID` membership check). */
export function isKnownMitreTechnique(id: string): boolean {
  return MITRE_TECHNIQUES_BY_ID.has(id);
}

/** Port of `_suggest_mitre_techniques_for_conditions` (main.py:9925). */
export function suggestMitreTechniquesForConditions(conditions: Array<Record<string, any>>): Array<Record<string, any>> {
  const suggestions = new Map<string, Record<string, any>>();
  for (const cond of conditions ?? []) {
    const fieldKey = cond?.field;
    if (!fieldKey) continue;
    for (const techniqueId of COMPLIANCE_FIELD_MITRE_HINTS[fieldKey] ?? []) {
      const technique = MITRE_TECHNIQUES_BY_ID.get(techniqueId);
      if (!technique) continue;
      if (!suggestions.has(techniqueId)) {
        suggestions.set(techniqueId, { ...technique, triggeredByFields: [] });
      }
      const entry = suggestions.get(techniqueId)!;
      if (!entry.triggeredByFields.includes(fieldKey)) entry.triggeredByFields.push(fieldKey);
    }
  }
  return Array.from(suggestions.values());
}

// ── Compliance Policy Templates (main.py:9999-10150) ──

export const COMPLIANCE_FRAMEWORKS = [
  {
    key: "iso27001", label: "ISO/IEC 27001:2022", shortLabel: "ISO 27001",
    description: "Annex A.8.1 (User Endpoint Devices) and related technical controls (A.8.7 malware protection, A.8.24 cryptography).",
    caveats: "Covers the device-configuration controls only. ISO 27001 certification also requires an ISMS (risk assessment, statement of applicability, management review, internal audit) that has no device-policy equivalent.",
  },
  {
    key: "ens", label: "Esquema Nacional de Seguridad (ENS, RD 311/2022)", shortLabel: "ENS",
    description: "mp.eq (protección de equipos) — measures for portable/mobile equipment: encryption, screen lock, inventory, incident-reporting timeliness.",
    caveats: "ENS conformity assessment covers all 8 measure families across the org's declared security category (básica/media/alta); mp.eq is only one family. Category-dependent mandatory controls (e.g. encryption is only mandatory at categoría alta) should be confirmed against your declared category before enabling autoRun.",
  },
  {
    key: "nis2", label: "NIS2 Directive (EU 2022/2555)", shortLabel: "NIS2",
    description: "Article 21(2) cybersecurity risk-management measures — cyber hygiene subset: device configuration, vulnerability handling, cryptography/encryption, asset visibility.",
    caveats: "Article 21 covers ten measure areas; several (supply-chain security, incident-handling procedures, business continuity, governance/training) are organizational, not device-level. Applies to entities in scope as 'essential' or 'important' under NIS2's sector annexes.",
  },
];
const COMPLIANCE_FRAMEWORKS_BY_KEY = new Map(COMPLIANCE_FRAMEWORKS.map((f) => [f.key, f]));

type TemplateCondition = { field: string; operator: string; value: unknown };

// ── Per-platform condition builders ──
// Each one encodes the ONE signal that's actually realistic for that OS in
// this app -- not a lowest-common-denominator blend. See the file-header
// comment above for why iOS is structurally excluded from encryption/
// screen-lock/malware (no agent, no nativeSecurity block ever populated for
// platform "apple").

function encryptionCondition(platform: "windows" | "macos" | "android"): TemplateCondition[] {
  if (platform === "android") {
    // Android Management API's own encryption signal, live on the device
    // record (deviceNormalize.ts) -- not self-reported by an agent.
    return [{ field: "customField", operator: "equals", value: { path: "nativeSecurity.isEncrypted", compareValue: "false" } }];
  }
  // Windows (BitLocker) and macOS (FileVault) are both normalized to the
  // same "diskEncryptionEnabled" self-reported attribute name by
  // WINDOWS_ATTR_ALIASES/MACOS_ATTR_ALIASES (deviceData.schemas.ts) -- the
  // condition is identical; only the policy's targetPlatform (and so which
  // fleet it's evaluated against) differs.
  return [{ field: "selfReportedAttribute", operator: "equals", value: { name: "diskEncryptionEnabled", compareValue: "false" } }];
}

function screenLockCondition(platform: "windows" | "macos" | "android"): TemplateCondition[] {
  if (platform === "android") {
    // isDeviceSecure is Android Management API's own "is a lock screen
    // configured" flag -- a more direct signal than any alias could give.
    return [{ field: "customField", operator: "equals", value: { path: "nativeSecurity.isDeviceSecure", compareValue: "false" } }];
  }
  return [{ field: "selfReportedAttribute", operator: "equals", value: { name: "screenLockEnabled", compareValue: "false" } }];
}

function malwareProtectionCondition(platform: "windows" | "macos" | "android"): TemplateCondition[] {
  if (platform === "android") {
    // Android has no 3rd-party AV agent path in this app -- Play Protect's
    // app-verification toggle (verifyAppsEnabled) is the real mobile
    // equivalent of "is malware scanning active".
    return [{ field: "customField", operator: "equals", value: { path: "nativeSecurity.verifyAppsEnabled", compareValue: "false" } }];
  }
  if (platform === "windows") {
    // Defender disabled OR its signature definitions have gone stale --
    // either one leaves the endpoint effectively unprotected.
    return [
      { field: "selfReportedAttribute", operator: "equals", value: { name: "antivirusEnabled", compareValue: "false" } },
      { field: "selfReportedAttribute", operator: "equals", value: { name: "antivirusUpToDate", compareValue: "false" } },
    ];
  }
  return [{ field: "selfReportedAttribute", operator: "equals", value: { name: "antivirusEnabled", compareValue: "false" } }];
}

function firewallCondition(): TemplateCondition[] {
  // firewallEnabled is only ever populated by the self-report agent
  // (WINDOWS_ATTR_ALIASES/MACOS_ATTR_ALIASES) -- Windows/macOS only. iOS
  // and Android don't expose a comparable local toggle to MDM in this app.
  return [{ field: "selfReportedAttribute", operator: "equals", value: { name: "firewallEnabled", compareValue: "false" } }];
}

function windowsHardwareRootOfTrustCondition(): TemplateCondition[] {
  // TPM anchors BitLocker's strongest key-protector mode in hardware, and
  // Secure Boot blocks an unsigned/tampered boot chain -- both Windows-only
  // concepts (report-security-attributes.ps1 reporter) with no macOS/
  // Android/iOS equivalent surfaced anywhere in this app.
  return [
    { field: "selfReportedAttribute", operator: "equals", value: { name: "tpmEnabled", compareValue: "false" } },
    { field: "selfReportedAttribute", operator: "equals", value: { name: "secureBootEnabled", compareValue: "false" } },
  ];
}

function patchVulnCondition(platform: "windows" | "macos" | "android" | "apple"): TemplateCondition[] {
  if (platform === "windows") {
    // MSRC-backed OS Updates catalog fields -- Windows-only.
    return [
      { field: "osUpdateExploitedPending", operator: "equals", value: true },
      { field: "osUpdatePendingCount", operator: "greaterThan", value: 0 },
      { field: "osEol", operator: "equals", value: true },
    ];
  }
  // Apple (iOS/iPadOS), macOS, and Android all share the EUVD-backed
  // vulnPendingCveCount/vulnExploitedPending fields (vulnCatalog.ts) -- same
  // underlying fields, but each still gets its own template entry because a
  // policy's targetPlatform can only lock in one platform at a time.
  return [
    { field: "vulnExploitedPending", operator: "equals", value: true },
    { field: "vulnPendingCveCount", operator: "greaterThan", value: 0 },
    { field: "osEol", operator: "equals", value: true },
  ];
}

function appleAppUpdatesCondition(): TemplateCondition[] {
  return [{ field: "appleAppUpdatesPending", operator: "greaterThan", value: 0 }];
}

function androidConfigPostureCondition(): TemplateCondition[] {
  // Android Management API's own device-posture + policy-compliance signal
  // plus the two classic mobile attack-surface toggles (USB debugging,
  // sideloading from unknown sources) -- all live in the same
  // nativeSecurity block (deviceNormalize.ts), so one combined "any"
  // condition covers Android's secure-configuration story end to end.
  return [
    { field: "customField", operator: "equals", value: { path: "nativeSecurity.devicePosture", compareValue: "AT_RISK" } },
    { field: "customField", operator: "equals", value: { path: "nativeSecurity.devicePosture", compareValue: "POTENTIALLY_COMPROMISED" } },
    { field: "customField", operator: "equals", value: { path: "nativeSecurity.policyCompliant", compareValue: "false" } },
    { field: "customField", operator: "equals", value: { path: "nativeSecurity.adbEnabled", compareValue: "true" } },
    { field: "customField", operator: "equals", value: { path: "nativeSecurity.unknownSourcesEnabled", compareValue: "true" } },
  ];
}

function staleCheckinCondition(days: number): TemplateCondition[] {
  return [{ field: "lastSeenDaysAgo", operator: "greaterThan", value: days }];
}

function highRiskTierCondition(): TemplateCondition[] {
  return [
    { field: "riskTier", operator: "equals", value: "high" },
    { field: "riskTier", operator: "equals", value: "critical" },
  ];
}

export const COMPLIANCE_POLICY_TEMPLATES: Array<{
  id: string;
  framework: string;
  controlRef: string;
  title: string;
  severity: string;
  conditionLogic: "any" | "all";
  description: string;
  targetPlatform: string | null;
  conditions: TemplateCondition[];
}> = [
  // ── ISO/IEC 27001:2022 ──
  {
    id: "iso27001-encryption-windows", framework: "iso27001", controlRef: "Annex A.8.24", targetPlatform: "windows",
    title: "Disk encryption (BitLocker) not enabled", severity: "high", conditionLogic: "any",
    description: "Flags Windows devices self-reporting BitLocker disk encryption as disabled.",
    conditions: encryptionCondition("windows"),
  },
  {
    id: "iso27001-encryption-macos", framework: "iso27001", controlRef: "Annex A.8.24", targetPlatform: "macos",
    title: "Disk encryption (FileVault) not enabled", severity: "high", conditionLogic: "any",
    description: "Flags macOS devices self-reporting FileVault disk encryption as disabled.",
    conditions: encryptionCondition("macos"),
  },
  {
    id: "iso27001-encryption-android", framework: "iso27001", controlRef: "Annex A.8.24", targetPlatform: "android",
    title: "Device encryption not confirmed", severity: "high", conditionLogic: "any",
    description: "Flags Android devices whose Android Management API security state confirms they're unencrypted.",
    conditions: encryptionCondition("android"),
  },
  {
    id: "iso27001-crypto-hardware-windows", framework: "iso27001", controlRef: "Annex A.8.24", targetPlatform: "windows",
    title: "TPM / Secure Boot not enabled", severity: "high", conditionLogic: "any",
    description: "Supplements BitLocker: TPM anchors the encryption key in hardware and Secure Boot blocks unsigned boot-chain tampering. Either disabled weakens the cryptographic root of trust — a Windows-specific control with no macOS/Android/iOS equivalent.",
    conditions: windowsHardwareRootOfTrustCondition(),
  },
  {
    id: "iso27001-screen-lock-windows", framework: "iso27001", controlRef: "Annex A.8.5", targetPlatform: "windows",
    title: "Screen lock not enforced", severity: "medium", conditionLogic: "any",
    description: "Flags Windows devices self-reporting screen lock disabled.",
    conditions: screenLockCondition("windows"),
  },
  {
    id: "iso27001-screen-lock-macos", framework: "iso27001", controlRef: "Annex A.8.5", targetPlatform: "macos",
    title: "Screen lock not enforced", severity: "medium", conditionLogic: "any",
    description: "Flags macOS devices self-reporting screen lock disabled.",
    conditions: screenLockCondition("macos"),
  },
  {
    id: "iso27001-screen-lock-android", framework: "iso27001", controlRef: "Annex A.8.5", targetPlatform: "android",
    title: "Screen lock not enforced", severity: "medium", conditionLogic: "any",
    description: "Flags Android devices the Android Management API reports as not secured with a lock screen.",
    conditions: screenLockCondition("android"),
  },
  {
    id: "iso27001-malware-windows", framework: "iso27001", controlRef: "Annex A.8.7", targetPlatform: "windows",
    title: "Anti-malware protection inactive", severity: "high", conditionLogic: "any",
    description: "Flags Windows devices self-reporting Defender disabled or its definitions out of date.",
    conditions: malwareProtectionCondition("windows"),
  },
  {
    id: "iso27001-malware-macos", framework: "iso27001", controlRef: "Annex A.8.7", targetPlatform: "macos",
    title: "Anti-malware protection inactive", severity: "high", conditionLogic: "any",
    description: "Flags macOS devices self-reporting XProtect (or an equivalent deployed agent) disabled.",
    conditions: malwareProtectionCondition("macos"),
  },
  {
    id: "iso27001-malware-android", framework: "iso27001", controlRef: "Annex A.8.7", targetPlatform: "android",
    title: "Play Protect app verification disabled", severity: "high", conditionLogic: "any",
    description: "Android has no 3rd-party AV agent path here — Play Protect's app-verification toggle is the realistic mobile equivalent of anti-malware scanning.",
    conditions: malwareProtectionCondition("android"),
  },
  {
    id: "iso27001-firewall-windows", framework: "iso27001", controlRef: "Annex A.8.20", targetPlatform: "windows",
    title: "Host firewall disabled", severity: "medium", conditionLogic: "any",
    description: "Flags Windows devices self-reporting their local firewall disabled.",
    conditions: firewallCondition(),
  },
  {
    id: "iso27001-firewall-macos", framework: "iso27001", controlRef: "Annex A.8.20", targetPlatform: "macos",
    title: "Host firewall disabled", severity: "medium", conditionLogic: "any",
    description: "Flags macOS devices self-reporting their local firewall disabled.",
    conditions: firewallCondition(),
  },
  {
    id: "iso27001-vuln-windows", framework: "iso27001", controlRef: "Annex A.8.8", targetPlatform: "windows",
    title: "Unpatched or end-of-life Windows", severity: "high", conditionLogic: "any",
    description: "Flags Windows devices with a pending fix for an exploited CVE, any pending security update, or an end-of-life OS build (MSRC-backed).",
    conditions: patchVulnCondition("windows"),
  },
  {
    id: "iso27001-vuln-macos", framework: "iso27001", controlRef: "Annex A.8.8", targetPlatform: "macos",
    title: "Unpatched or end-of-life macOS", severity: "high", conditionLogic: "any",
    description: "Flags macOS devices with a pending exploited CVE, any pending known CVE, or an end-of-life OS build.",
    conditions: patchVulnCondition("macos"),
  },
  {
    id: "iso27001-vuln-android", framework: "iso27001", controlRef: "Annex A.8.8", targetPlatform: "android",
    title: "Unpatched or end-of-life Android", severity: "high", conditionLogic: "any",
    description: "Flags Android devices with a pending exploited CVE, any pending known CVE, or an end-of-life OS build.",
    conditions: patchVulnCondition("android"),
  },
  {
    id: "iso27001-vuln-apple", framework: "iso27001", controlRef: "Annex A.8.8", targetPlatform: "apple",
    title: "Unpatched or end-of-life iOS/iPadOS", severity: "high", conditionLogic: "any",
    description: "Flags iOS/iPadOS devices with a pending exploited CVE, any pending known CVE, or an end-of-life OS build — the only patch-currency signal this app has for iOS, which exposes no local security-posture telemetry at all.",
    conditions: patchVulnCondition("apple"),
  },
  {
    id: "iso27001-android-config-posture", framework: "iso27001", controlRef: "Annex A.8.9", targetPlatform: "android",
    title: "Insecure Android configuration or device posture", severity: "high", conditionLogic: "any",
    description: "Flags Android devices flagged AT_RISK/POTENTIALLY_COMPROMISED by Android Enterprise's own device-posture signal, not policy-compliant, with USB debugging on, or with sideloading from unknown sources allowed.",
    conditions: androidConfigPostureCondition(),
  },
  {
    id: "iso27001-stale-inventory", framework: "iso27001", controlRef: "Annex A.5.9", targetPlatform: null,
    title: "Device hasn't checked in recently", severity: "low", conditionLogic: "any",
    description: "Flags devices that haven't checked in for over 30 days — a stale inventory undermines every other endpoint control, regardless of platform.",
    conditions: staleCheckinCondition(30),
  },
  {
    id: "iso27001-app-updates-apple", framework: "iso27001", controlRef: "Annex A.8.1", targetPlatform: "apple",
    title: "Pending App Store app updates", severity: "medium", conditionLogic: "any",
    description: "Flags iOS/iPadOS devices with pending App Store app updates — outdated apps are a common vector once the OS itself is current.",
    conditions: appleAppUpdatesCondition(),
  },
  {
    id: "iso27001-app-updates-macos", framework: "iso27001", controlRef: "Annex A.8.1", targetPlatform: "macos",
    title: "Pending App Store app updates", severity: "medium", conditionLogic: "any",
    description: "Flags macOS devices with pending App Store app updates.",
    conditions: appleAppUpdatesCondition(),
  },

  // ── ENS (Esquema Nacional de Seguridad, RD 311/2022) ──
  {
    id: "ens-encryption-windows", framework: "ens", controlRef: "mp.eq.3", targetPlatform: "windows",
    title: "Cifrado no aplicado en equipo Windows / Windows device encryption not enforced", severity: "high", conditionLogic: "any",
    description: "mp.eq.3 (protección de dispositivos portátiles): flags Windows devices self-reporting BitLocker disabled. Mandatory at categoría alta for equipment that leaves controlled premises.",
    conditions: encryptionCondition("windows"),
  },
  {
    id: "ens-encryption-macos", framework: "ens", controlRef: "mp.eq.3", targetPlatform: "macos",
    title: "Cifrado no aplicado en equipo macOS / macOS device encryption not enforced", severity: "high", conditionLogic: "any",
    description: "mp.eq.3: flags macOS devices self-reporting FileVault disabled.",
    conditions: encryptionCondition("macos"),
  },
  {
    id: "ens-encryption-android", framework: "ens", controlRef: "mp.eq.3", targetPlatform: "android",
    title: "Cifrado no confirmado en dispositivo Android / Android device encryption not confirmed", severity: "high", conditionLogic: "any",
    description: "mp.eq.3: flags Android devices the Android Management API confirms are unencrypted.",
    conditions: encryptionCondition("android"),
  },
  {
    id: "ens-checkin-windows", framework: "ens", controlRef: "mp.eq.3", targetPlatform: "windows",
    title: "Equipo sin contacto reciente / Device unreachable beyond reporting window", severity: "medium", conditionLogic: "any",
    description: "mp.eq.3 (riesgo de pérdida/robo): flags Windows laptops offline for over 14 days.",
    conditions: staleCheckinCondition(14),
  },
  {
    id: "ens-checkin-macos", framework: "ens", controlRef: "mp.eq.3", targetPlatform: "macos",
    title: "Equipo sin contacto reciente / Device unreachable beyond reporting window", severity: "medium", conditionLogic: "any",
    description: "mp.eq.3: flags macOS laptops offline for over 14 days.",
    conditions: staleCheckinCondition(14),
  },
  {
    id: "ens-checkin-android", framework: "ens", controlRef: "mp.eq.3", targetPlatform: "android",
    title: "Dispositivo móvil sin contacto reciente / Mobile device unreachable beyond reporting window", severity: "high", conditionLogic: "any",
    description: "mp.eq.3: a tighter 3-day window for Android — phones/tablets carry a materially higher loss/theft exposure than desks-bound laptops, so ENS expects faster identification.",
    conditions: staleCheckinCondition(3),
  },
  {
    id: "ens-checkin-apple", framework: "ens", controlRef: "mp.eq.3", targetPlatform: "apple",
    title: "Dispositivo móvil sin contacto reciente / Mobile device unreachable beyond reporting window", severity: "high", conditionLogic: "any",
    description: "mp.eq.3: same tightened 3-day window for iOS/iPadOS as Android — this is also the only loss/theft-relevant signal this app has for iOS, since it has no local security telemetry.",
    conditions: staleCheckinCondition(3),
  },
  {
    id: "ens-screen-lock-windows", framework: "ens", controlRef: "mp.eq.2", targetPlatform: "windows",
    title: "Bloqueo de puesto de trabajo no activo / Workstation lock not active", severity: "medium", conditionLogic: "any",
    description: "mp.eq.2 (bloqueo de puesto de trabajo): flags Windows devices self-reporting screen lock disabled.",
    conditions: screenLockCondition("windows"),
  },
  {
    id: "ens-screen-lock-macos", framework: "ens", controlRef: "mp.eq.2", targetPlatform: "macos",
    title: "Bloqueo de puesto de trabajo no activo / Workstation lock not active", severity: "medium", conditionLogic: "any",
    description: "mp.eq.2: flags macOS devices self-reporting screen lock disabled.",
    conditions: screenLockCondition("macos"),
  },
  {
    id: "ens-screen-lock-android", framework: "ens", controlRef: "mp.eq.2", targetPlatform: "android",
    title: "Bloqueo de pantalla no activo / Screen lock not active", severity: "medium", conditionLogic: "any",
    description: "mp.eq.2: flags Android devices without a configured lock screen.",
    conditions: screenLockCondition("android"),
  },
  {
    id: "ens-malware-windows", framework: "ens", controlRef: "op.exp.6", targetPlatform: "windows",
    title: "Protección frente a código dañino inactiva / Malware protection inactive", severity: "high", conditionLogic: "any",
    description: "op.exp.6 (protección frente a código dañino): flags Windows devices with Defender disabled or its definitions stale.",
    conditions: malwareProtectionCondition("windows"),
  },
  {
    id: "ens-malware-macos", framework: "ens", controlRef: "op.exp.6", targetPlatform: "macos",
    title: "Protección frente a código dañino inactiva / Malware protection inactive", severity: "high", conditionLogic: "any",
    description: "op.exp.6: flags macOS devices with anti-malware protection disabled.",
    conditions: malwareProtectionCondition("macos"),
  },
  {
    id: "ens-malware-android", framework: "ens", controlRef: "op.exp.6", targetPlatform: "android",
    title: "Play Protect desactivado / Play Protect disabled", severity: "high", conditionLogic: "any",
    description: "op.exp.6: Android's realistic equivalent is Play Protect's app-verification toggle, not a 3rd-party agent.",
    conditions: malwareProtectionCondition("android"),
  },
  {
    id: "ens-maintenance-vuln-windows", framework: "ens", controlRef: "op.exp.4", targetPlatform: "windows",
    title: "Mantenimiento pendiente / Pending maintenance (unpatched or EOL)", severity: "high", conditionLogic: "any",
    description: "op.exp.4 (mantenimiento): flags Windows devices with an exploited-CVE fix pending, any pending security update, or an end-of-life OS build.",
    conditions: patchVulnCondition("windows"),
  },
  {
    id: "ens-maintenance-vuln-macos", framework: "ens", controlRef: "op.exp.4", targetPlatform: "macos",
    title: "Mantenimiento pendiente / Pending maintenance (unpatched or EOL)", severity: "high", conditionLogic: "any",
    description: "op.exp.4: flags macOS devices with a pending exploited CVE, any pending known CVE, or an end-of-life OS build.",
    conditions: patchVulnCondition("macos"),
  },
  {
    id: "ens-maintenance-vuln-android", framework: "ens", controlRef: "op.exp.4", targetPlatform: "android",
    title: "Mantenimiento pendiente / Pending maintenance (unpatched or EOL)", severity: "high", conditionLogic: "any",
    description: "op.exp.4: flags Android devices with a pending exploited CVE, any pending known CVE, or an end-of-life OS build.",
    conditions: patchVulnCondition("android"),
  },
  {
    id: "ens-maintenance-vuln-apple", framework: "ens", controlRef: "op.exp.4", targetPlatform: "apple",
    title: "Mantenimiento pendiente / Pending maintenance (unpatched or EOL)", severity: "high", conditionLogic: "any",
    description: "op.exp.4: flags iOS/iPadOS devices with a pending exploited CVE, any pending known CVE, or an end-of-life OS build.",
    conditions: patchVulnCondition("apple"),
  },
  {
    id: "ens-firewall-windows", framework: "ens", controlRef: "mp.com.1", targetPlatform: "windows",
    title: "Perímetro no protegido / Host firewall disabled", severity: "medium", conditionLogic: "any",
    description: "mp.com.1 (perímetro seguro): flags Windows devices self-reporting their local firewall disabled.",
    conditions: firewallCondition(),
  },
  {
    id: "ens-firewall-macos", framework: "ens", controlRef: "mp.com.1", targetPlatform: "macos",
    title: "Perímetro no protegido / Host firewall disabled", severity: "medium", conditionLogic: "any",
    description: "mp.com.1: flags macOS devices self-reporting their local firewall disabled.",
    conditions: firewallCondition(),
  },
  {
    id: "ens-android-config", framework: "ens", controlRef: "mp.eq", targetPlatform: "android",
    title: "Configuración de equipo insegura / Insecure device configuration", severity: "high", conditionLogic: "any",
    description: "mp.eq (protección de equipos, aplicada de forma genérica — no hay un sub-código ENS dedicado a la postura de dispositivos Android): flags devices AT_RISK/POTENTIALLY_COMPROMISED, not policy-compliant, with USB debugging on, or sideloading allowed.",
    conditions: androidConfigPostureCondition(),
  },

  // ── NIS2 Directive (EU 2022/2555), Article 21(2) ──
  {
    id: "nis2-crypto-windows", framework: "nis2", controlRef: "Article 21(2)(h)", targetPlatform: "windows",
    title: "Cryptography: disk encryption not confirmed", severity: "high", conditionLogic: "any",
    description: "Flags Windows devices self-reporting BitLocker disabled — NIS2's cryptography/encryption measure.",
    conditions: encryptionCondition("windows"),
  },
  {
    id: "nis2-crypto-macos", framework: "nis2", controlRef: "Article 21(2)(h)", targetPlatform: "macos",
    title: "Cryptography: disk encryption not confirmed", severity: "high", conditionLogic: "any",
    description: "Flags macOS devices self-reporting FileVault disabled.",
    conditions: encryptionCondition("macos"),
  },
  {
    id: "nis2-crypto-android", framework: "nis2", controlRef: "Article 21(2)(h)", targetPlatform: "android",
    title: "Cryptography: disk encryption not confirmed", severity: "high", conditionLogic: "any",
    description: "Flags Android devices the Android Management API confirms are unencrypted.",
    conditions: encryptionCondition("android"),
  },
  {
    id: "nis2-crypto-hardware-windows", framework: "nis2", controlRef: "Article 21(2)(h)", targetPlatform: "windows",
    title: "Cryptography: TPM / Secure Boot not enabled", severity: "high", conditionLogic: "any",
    description: "Windows-specific hardware root of trust backing full-disk encryption — no macOS/Android/iOS equivalent exists in this app.",
    conditions: windowsHardwareRootOfTrustCondition(),
  },
  {
    id: "nis2-hygiene-screenlock-windows", framework: "nis2", controlRef: "Article 21(2)(g)", targetPlatform: "windows",
    title: "Basic cyber hygiene: screen lock not enforced", severity: "medium", conditionLogic: "any",
    description: "Flags Windows devices without an active screen lock.",
    conditions: screenLockCondition("windows"),
  },
  {
    id: "nis2-hygiene-screenlock-macos", framework: "nis2", controlRef: "Article 21(2)(g)", targetPlatform: "macos",
    title: "Basic cyber hygiene: screen lock not enforced", severity: "medium", conditionLogic: "any",
    description: "Flags macOS devices without an active screen lock.",
    conditions: screenLockCondition("macos"),
  },
  {
    id: "nis2-hygiene-screenlock-android", framework: "nis2", controlRef: "Article 21(2)(g)", targetPlatform: "android",
    title: "Basic cyber hygiene: screen lock not enforced", severity: "medium", conditionLogic: "any",
    description: "Flags Android devices without a configured lock screen.",
    conditions: screenLockCondition("android"),
  },
  {
    id: "nis2-hygiene-malware-windows", framework: "nis2", controlRef: "Article 21(2)(g)", targetPlatform: "windows",
    title: "Basic cyber hygiene: malware protection inactive", severity: "high", conditionLogic: "any",
    description: "Flags Windows devices with Defender disabled or its definitions stale.",
    conditions: malwareProtectionCondition("windows"),
  },
  {
    id: "nis2-hygiene-malware-macos", framework: "nis2", controlRef: "Article 21(2)(g)", targetPlatform: "macos",
    title: "Basic cyber hygiene: malware protection inactive", severity: "high", conditionLogic: "any",
    description: "Flags macOS devices with anti-malware protection disabled.",
    conditions: malwareProtectionCondition("macos"),
  },
  {
    id: "nis2-hygiene-malware-android", framework: "nis2", controlRef: "Article 21(2)(g)", targetPlatform: "android",
    title: "Basic cyber hygiene: Play Protect disabled", severity: "high", conditionLogic: "any",
    description: "Android's realistic malware-hygiene equivalent is Play Protect's app-verification toggle.",
    conditions: malwareProtectionCondition("android"),
  },
  {
    id: "nis2-hygiene-firewall-windows", framework: "nis2", controlRef: "Article 21(2)(g)", targetPlatform: "windows",
    title: "Basic cyber hygiene: host firewall disabled", severity: "medium", conditionLogic: "any",
    description: "Flags Windows devices self-reporting their local firewall disabled.",
    conditions: firewallCondition(),
  },
  {
    id: "nis2-hygiene-firewall-macos", framework: "nis2", controlRef: "Article 21(2)(g)", targetPlatform: "macos",
    title: "Basic cyber hygiene: host firewall disabled", severity: "medium", conditionLogic: "any",
    description: "Flags macOS devices self-reporting their local firewall disabled.",
    conditions: firewallCondition(),
  },
  {
    id: "nis2-vuln-windows", framework: "nis2", controlRef: "Article 21(2)(e)", targetPlatform: "windows",
    title: "Vulnerability handling: unpatched or EOL Windows", severity: "high", conditionLogic: "any",
    description: "Flags Windows devices with an exploited-CVE fix pending, any pending security update, or an end-of-life OS build.",
    conditions: patchVulnCondition("windows"),
  },
  {
    id: "nis2-vuln-macos", framework: "nis2", controlRef: "Article 21(2)(e)", targetPlatform: "macos",
    title: "Vulnerability handling: unpatched or EOL macOS", severity: "high", conditionLogic: "any",
    description: "Flags macOS devices with a pending exploited CVE, any pending known CVE, or an end-of-life OS build.",
    conditions: patchVulnCondition("macos"),
  },
  {
    id: "nis2-vuln-android", framework: "nis2", controlRef: "Article 21(2)(e)", targetPlatform: "android",
    title: "Vulnerability handling: unpatched or EOL Android", severity: "high", conditionLogic: "any",
    description: "Flags Android devices with a pending exploited CVE, any pending known CVE, or an end-of-life OS build.",
    conditions: patchVulnCondition("android"),
  },
  {
    id: "nis2-vuln-apple", framework: "nis2", controlRef: "Article 21(2)(e)", targetPlatform: "apple",
    title: "Vulnerability handling: unpatched or EOL iOS/iPadOS", severity: "high", conditionLogic: "any",
    description: "Flags iOS/iPadOS devices with a pending exploited CVE, any pending known CVE, or an end-of-life OS build.",
    conditions: patchVulnCondition("apple"),
  },
  {
    id: "nis2-app-updates-apple", framework: "nis2", controlRef: "Article 21(2)(e)", targetPlatform: "apple",
    title: "Vulnerability handling: pending App Store app updates", severity: "medium", conditionLogic: "any",
    description: "Flags iOS/iPadOS devices with pending App Store app updates — application-layer vulnerability handling, distinct from OS patching.",
    conditions: appleAppUpdatesCondition(),
  },
  {
    id: "nis2-app-updates-macos", framework: "nis2", controlRef: "Article 21(2)(e)", targetPlatform: "macos",
    title: "Vulnerability handling: pending App Store app updates", severity: "medium", conditionLogic: "any",
    description: "Flags macOS devices with pending App Store app updates.",
    conditions: appleAppUpdatesCondition(),
  },
  {
    id: "nis2-asset-android-posture", framework: "nis2", controlRef: "Article 21(2)(i)", targetPlatform: "android",
    title: "Asset management: insecure Android configuration", severity: "high", conditionLogic: "any",
    description: "Flags Android devices AT_RISK/POTENTIALLY_COMPROMISED, not policy-compliant, with USB debugging on, or sideloading allowed — asset-management visibility into managed-device configuration drift.",
    conditions: androidConfigPostureCondition(),
  },
  {
    id: "nis2-asset-visibility", framework: "nis2", controlRef: "Article 21(2)(i)", targetPlatform: null,
    title: "Asset management: device hasn't checked in", severity: "low", conditionLogic: "any",
    description: "Flags devices unseen for over 30 days, any platform — asset visibility is the foundation every other NIS2 measure depends on.",
    conditions: staleCheckinCondition(30),
  },
  {
    id: "nis2-risk-tier", framework: "nis2", controlRef: "Article 21(2)(a)", targetPlatform: null,
    title: "Risk analysis: device Risk Tier elevated", severity: "medium", conditionLogic: "any",
    description: "Flags any device (regardless of platform) whose composite Device Risk Score has reached High or Critical — a holistic, risk-based check that complements the single-signal templates above, matching NIS2's own risk-based-governance framing.",
    conditions: highRiskTierCondition(),
  },
];

export function getComplianceTemplates(framework?: string) {
  let templates = COMPLIANCE_POLICY_TEMPLATES;
  if (framework) {
    if (!COMPLIANCE_FRAMEWORKS_BY_KEY.has(framework)) return null;
    templates = templates.filter((t) => t.framework === framework);
  }
  return { frameworks: COMPLIANCE_FRAMEWORKS, items: templates };
}
