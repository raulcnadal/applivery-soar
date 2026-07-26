/**
 * Static registries for the Compliance Policy Builder — ported verbatim
 * from main.py: COMPLIANCE_FIELDS (main.py:9815), COMPLIANCE_FIELD_MITRE_HINTS
 * (main.py:9896), MITRE_TACTICS/MITRE_TECHNIQUES (main.py:11612-11672),
 * COMPLIANCE_FRAMEWORKS/COMPLIANCE_POLICY_TEMPLATES (main.py:9999-10150).
 */

export interface ComplianceFieldDef {
  key: string;
  label: string;
  type: string;
  operators: string[];
  options?: string[];
}

export const COMPLIANCE_FIELDS: ComplianceFieldDef[] = [
  { key: "isCompliant", label: "Applivery compliance flag", type: "boolean", operators: ["equals"] },
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
  { key: "imei", label: "IMEI", type: "string", operators: ["equals", "contains"] },
  { key: "mdmUserEmail", label: "MDM user email", type: "string", operators: ["equals", "contains"] },
  { key: "segmentId", label: "Segment ID", type: "string", operators: ["equals", "notEquals"] },
  { key: "tags", label: "Tag", type: "string", operators: ["includes", "excludes"] },
  { key: "state", label: "Device state", type: "string", operators: ["equals", "notEquals"] },
  { key: "missingPolicyId", label: "Missing a required MDM policy", type: "policy", operators: ["missing"] },
  { key: "deviceAudienceId", label: "Device Audience membership", type: "device_audience", operators: ["includes", "excludes"] },
  { key: "smartAttribute", label: "Smart Attribute", type: "smart_attribute", operators: ["equals", "notEquals", "contains", "greaterThan", "lessThan", "exists", "missing"] },
  { key: "customField", label: "Custom device field (advanced)", type: "custom_field", operators: ["equals", "notEquals", "contains", "greaterThan", "lessThan", "exists", "missing"] },
  { key: "selfReportedAttribute", label: "Self-Reported Attribute (agent)", type: "self_reported_attribute", operators: ["equals", "notEquals", "contains", "greaterThan", "lessThan", "exists", "missing"] },
  { key: "selfReportDaysAgo", label: "Days since last self-report", type: "number", operators: ["greaterThan", "lessThan"] },
  { key: "hasSelfReported", label: "Has ever self-reported (agent installed)", type: "boolean", operators: ["equals"] },
  { key: "requiredAppList", label: "Missing a required app (from an App List)", type: "app_list", operators: ["equals"] },
  { key: "disallowedAppList", label: "Has a disallowed app (from an App List)", type: "app_list", operators: ["equals"] },
  { key: "riskScore", label: "Device Risk Score (0-100)", type: "number", operators: ["greaterThan", "lessThan"] },
  { key: "riskTier", label: "Device Risk Tier", type: "select", operators: ["equals", "notEquals"], options: ["low", "medium", "high", "critical"] },
  { key: "osUpdatePendingCount", label: "Pending Windows security updates", type: "number", operators: ["greaterThan", "lessThan"] },
  { key: "osUpdateExploitedPending", label: "Pending Windows update fixes an exploited CVE", type: "boolean", operators: ["equals"] },
  { key: "vulnPendingCveCount", label: "Pending known CVEs (Apple/Android)", type: "number", operators: ["greaterThan", "lessThan"] },
  { key: "vulnExploitedPending", label: "Pending CVE is exploited in the wild (Apple/Android)", type: "boolean", operators: ["equals"] },
  { key: "osEol", label: "OS version is end of life", type: "boolean", operators: ["equals"] },
  { key: "appleAppUpdatesPending", label: "Pending Apple app updates", type: "number", operators: ["greaterThan", "lessThan"] },
  { key: "vulnServiceCriticalHighCount", label: "Critical/high CVEs (Vulnerability Service)", type: "number", operators: ["greaterThan", "lessThan"] },
  { key: "vulnServiceHasKev", label: "Known-exploited CVE present — CISA KEV (Vulnerability Service)", type: "boolean", operators: ["equals"] },
  { key: "vulnServiceChecked", label: "Checked against Vulnerability Service", type: "boolean", operators: ["equals"] },
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

function diskEncryptionConditions() {
  return [
    { field: "selfReportedAttribute", operator: "equals", value: { name: "diskEncryptionEnabled", compareValue: "false" } },
    { field: "customField", operator: "equals", value: { path: "nativeSecurity.isEncrypted", compareValue: "false" } },
  ];
}
function screenLockConditions() {
  return [
    { field: "selfReportedAttribute", operator: "equals", value: { name: "screenLockEnabled", compareValue: "false" } },
    { field: "customField", operator: "equals", value: { path: "nativeSecurity.isDeviceSecure", compareValue: "false" } },
  ];
}
function antivirusConditions() {
  return [{ field: "selfReportedAttribute", operator: "equals", value: { name: "antivirusEnabled", compareValue: "false" } }];
}
function exploitedVulnConditions() {
  return [
    { field: "osUpdateExploitedPending", operator: "equals", value: true },
    { field: "vulnExploitedPending", operator: "equals", value: true },
  ];
}
function osEolCondition() {
  return { field: "osEol", operator: "equals", value: true };
}
function staleCheckinCondition(days: number) {
  return { field: "lastSeenDaysAgo", operator: "greaterThan", value: days };
}

export const COMPLIANCE_POLICY_TEMPLATES = [
  {
    id: "iso27001-disk-encryption", framework: "iso27001", controlRef: "Annex A.8.1 / A.8.24",
    title: "Disk encryption not enforced", severity: "high", conditionLogic: "any",
    description: "Flags Windows/macOS devices self-reporting disk encryption off, and Android devices whose native security state confirms they're unencrypted.",
    conditions: diskEncryptionConditions(),
  },
  {
    id: "iso27001-screen-lock", framework: "iso27001", controlRef: "Annex A.8.1",
    title: "Screen lock / passcode not enforced", severity: "high", conditionLogic: "any",
    description: "Flags Windows/macOS devices self-reporting screen lock off, and Android devices reporting themselves as not secure.",
    conditions: screenLockConditions(),
  },
  {
    id: "iso27001-malware-protection", framework: "iso27001", controlRef: "Annex A.8.7",
    title: "Anti-malware protection inactive", severity: "high", conditionLogic: "any",
    description: "Flags Windows/macOS devices self-reporting their anti-malware/Defender/XProtect protection as disabled.",
    conditions: antivirusConditions(),
  },
  {
    id: "iso27001-os-eol", framework: "iso27001", controlRef: "Annex A.8.1 (secure configuration)",
    title: "OS version past end-of-life", severity: "medium", conditionLogic: "any",
    description: "Flags devices running an OS version confirmed end-of-life by the OS Lifecycle catalog — no further security patches are coming.",
    conditions: [osEolCondition()],
  },
  {
    id: "iso27001-stale-inventory", framework: "iso27001", controlRef: "Annex A.8.1 (asset inventory currency)",
    title: "Device hasn't checked in recently", severity: "low", conditionLogic: "any",
    description: "Flags devices that haven't checked in for over 30 days — a stale inventory undermines every other endpoint control.",
    conditions: [staleCheckinCondition(30)],
  },
  {
    id: "ens-mp-eq-encryption", framework: "ens", controlRef: "mp.eq.2",
    title: "Cifrado no aplicado en equipo portátil / Portable device encryption not enforced", severity: "high", conditionLogic: "any",
    description: "Mandatory at categoría alta: flags Windows/macOS devices self-reporting encryption off and Android devices confirmed unencrypted.",
    conditions: diskEncryptionConditions(),
  },
  {
    id: "ens-mp-eq-screen-lock", framework: "ens", controlRef: "mp.eq",
    title: "Bloqueo de pantalla no activo / Screen lock not active", severity: "medium", conditionLogic: "any",
    description: "Flags devices without an active screen lock — baseline access protection for equipment that leaves controlled premises.",
    conditions: screenLockConditions(),
  },
  {
    id: "ens-mp-eq-checkin-window", framework: "ens", controlRef: "mp.eq (incident-reporting timeliness)",
    title: "Dispositivo sin contacto reciente / Device unreachable beyond reporting window", severity: "high", conditionLogic: "any",
    description: "Flags devices offline for over 7 days — tighter than the general inventory-currency window, since ENS expects lost/stolen equipment to be identified and reported quickly.",
    conditions: [staleCheckinCondition(7)],
  },
  {
    id: "nis2-art21-hygiene-screen-lock", framework: "nis2", controlRef: "Article 21(2)(g)",
    title: "Basic cyber hygiene: screen lock not enforced", severity: "medium", conditionLogic: "any",
    description: "Flags devices without an active screen lock, part of NIS2's baseline cyber-hygiene practices.",
    conditions: screenLockConditions(),
  },
  {
    id: "nis2-art21-vuln-handling", framework: "nis2", controlRef: "Article 21(2)(e)",
    title: "Vulnerability handling: EOL or exploited-CVE exposure", severity: "high", conditionLogic: "any",
    description: "Flags devices on an end-of-life OS or with a pending patch for a known-exploited CVE — NIS2's vulnerability-handling and disclosure measure.",
    conditions: [osEolCondition(), ...exploitedVulnConditions()],
  },
  {
    id: "nis2-art21-cryptography", framework: "nis2", controlRef: "Article 21(2)(h)",
    title: "Cryptography: disk encryption not confirmed", severity: "high", conditionLogic: "any",
    description: "Flags devices without confirmed disk encryption — NIS2's cryptography and encryption measure.",
    conditions: diskEncryptionConditions(),
  },
  {
    id: "nis2-art21-asset-visibility", framework: "nis2", controlRef: "Article 21(2)(a)",
    title: "Asset visibility gap: device hasn't checked in", severity: "low", conditionLogic: "any",
    description: "Flags devices unseen for over 30 days — asset/risk visibility is the foundation NIS2's other measures depend on.",
    conditions: [staleCheckinCondition(30)],
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
