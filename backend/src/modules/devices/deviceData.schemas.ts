import { z } from "zod";

/**
 * Port of `DeviceReportPayload`/`DeviceAppReportPayload` and the
 * WINDOWS_ATTR_ALIASES/MACOS_ATTR_ALIASES translation tables (main.py:7671-7736).
 * The alias tables let a policy author write ONE condition
 * ("diskEncryptionEnabled") that works across a Windows fleet sending
 * "BitLockerStatus" and a macOS fleet sending "FileVaultEnabled" — purely a
 * translation convenience, not an allowlist; any key not listed here still
 * comes through unchanged under its original name.
 */

export const WINDOWS_ATTR_ALIASES: Record<string, string> = {
  BitLockerStatus: "diskEncryptionEnabled",
  BitLockerEnabled: "diskEncryptionEnabled",
  FirewallEnabled: "firewallEnabled",
  DefenderEnabled: "antivirusEnabled",
  AntivirusEnabled: "antivirusEnabled",
  AntivirusUpToDate: "antivirusUpToDate",
  OsBuild: "osBuildNumber",
  OsBuildNumber: "osBuildNumber",
  OsEdition: "osEdition",
  PendingUpdatesCount: "pendingOsUpdates",
  DomainJoined: "domainJoined",
  AzureAdJoined: "entraJoined",
  EntraJoined: "entraJoined",
  UptimeDays: "uptimeDays",
  DiskFreeGb: "diskFreeGb",
  DiskUsedPercent: "diskUsedPercent",
  ScreenLockEnabled: "screenLockEnabled",
  TpmEnabled: "tpmEnabled",
  TpmReady: "tpmEnabled",
  SecureBootEnabled: "secureBootEnabled",
  SecureBootAvailable: "secureBootAvailable",
  // Security-attestation reporter (report-security-attributes.ps1).
  VbsEnabled: "vbsEnabled",
  VbsRunning: "vbsRunning",
  CredentialGuardRunning: "credentialGuardEnabled",
  HvciRunning: "memoryIntegrityEnabled",
  ElamEnabled: "elamEnabled",
};

export const MACOS_ATTR_ALIASES: Record<string, string> = {
  FileVaultEnabled: "diskEncryptionEnabled",
  FileVaultStatus: "diskEncryptionEnabled",
  FirewallEnabled: "firewallEnabled",
  XProtectEnabled: "antivirusEnabled",
  AntivirusEnabled: "antivirusEnabled",
  OsBuild: "osBuildNumber",
  OsBuildNumber: "osBuildNumber",
  PendingUpdatesCount: "pendingOsUpdates",
  MdmEnrolled: "domainJoined",
  UptimeDays: "uptimeDays",
  DiskFreeGb: "diskFreeGb",
  DiskUsedPercent: "diskUsedPercent",
  ScreenLockEnabled: "screenLockEnabled",
  SecureTokenEnabled: "secureBootEnabled",
};

/** Port of `_normalize_pushed_attributes` (main.py:7729). */
export function normalizePushedAttributes(platform: string, attributes: Record<string, unknown>): Record<string, unknown> {
  const aliasMap = platform === "windows" ? WINDOWS_ATTR_ALIASES : platform === "macos" ? MACOS_ATTR_ALIASES : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attributes ?? {})) {
    out[aliasMap[k] ?? k] = v;
  }
  return out;
}

/**
 * One custom check's result — reported inline alongside the fixed
 * `attributes` set below, on the SAME /api/device-data/report call the
 * agent already makes every cycle (customChecks.service.ts's module doc has
 * the full design). `value` is whatever the checker produced (a boolean for
 * processRunning/serviceStatus, a string for registryOrFileValue/
 * appInstalled/command's stdout); `error` is set instead when the check
 * itself failed to run (e.g. registry path not found, command timed out) —
 * the compliance evaluator treats an errored result the same as "missing"
 * (complianceEvaluate.ts's customCheckResult branch).
 */
const customCheckResultSchema = z.object({
  value: z.any().nullish(),
  error: z.string().nullish(),
});

export const deviceReportPayloadSchema = z.object({
  platform: z.string(), // "windows" | "macos"
  serialNumber: z.string(),
  attributes: z.record(z.any()).default({}),
  // Keyed by CustomCheckDefinition.key. Optional — an older agent build that
  // predates this feature simply omits it, and reportDeviceData() carries
  // the previously-stored results forward rather than wiping them.
  customCheckResults: z.record(customCheckResultSchema).nullish(),
  agentVersion: z.string().nullish(),
  reportedAt: z.string().nullish(),
});
export type DeviceReportPayload = z.infer<typeof deviceReportPayloadSchema>;

export const deviceAppReportPayloadSchema = z.object({
  platform: z.string(),
  serialNumber: z.string(),
  apps: z
    .array(
      z.object({
        identifier: z.string().optional(),
        name: z.string().optional(),
        version: z.string().optional(),
        // Windows-only, optional — an agent build new enough to detect AppX/
        // Store packages (via PowerShell Get-AppxPackage) tags them here;
        // older agent builds simply omit it, same as every other field here.
        origin: z.enum(["msi", "store"]).optional(),
      }),
    )
    .default([]),
  agentVersion: z.string().nullish(),
  reportedAt: z.string().nullish(),
});
export type DeviceAppReportPayload = z.infer<typeof deviceAppReportPayloadSchema>;
