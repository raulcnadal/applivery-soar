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

export const deviceReportPayloadSchema = z.object({
  platform: z.string(), // "windows" | "macos"
  serialNumber: z.string(),
  attributes: z.record(z.any()).default({}),
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
      }),
    )
    .default([]),
  agentVersion: z.string().nullish(),
  reportedAt: z.string().nullish(),
});
export type DeviceAppReportPayload = z.infer<typeof deviceAppReportPayloadSchema>;
