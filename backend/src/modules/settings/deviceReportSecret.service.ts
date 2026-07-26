import { randomBytes } from "crypto";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";

/**
 * Device-report webhook secret — port of main.py:7799-7843
 * (get/rotate/clear_device_report_secret). Encrypted at rest (see
 * secretCipher.ts's field list) but, unlike a password, this is one we
 * minted ourselves purely to authenticate a script the admin is about to
 * write — so it's fine, and necessary, to hand the real (decrypted) value
 * back to them to paste into that script.
 *
 * Consuming this secret (the actual `/api/device-data/report*` webhook
 * receivers a device's scheduled script POSTs to) is TODO(Phase8) — see
 * devices/deviceNormalize.ts's `pushdataCache` TODO — this module only
 * covers the Settings-side secret lifecycle so that tab is functional now.
 */

export interface DeviceReportSecretStatus {
  configured: boolean;
  secret: string | null;
  rotatedBy?: string | null;
  rotatedAt?: string | null;
}

export async function getDeviceReportSecretStatus(workspaceSlug: string): Promise<DeviceReportSecretStatus> {
  const row = await prisma.deviceReportSecret.findUnique({ where: { workspaceSlug } });
  if (!row) return { configured: false, secret: null };
  return {
    configured: true,
    secret: decryptSecret(row.secret),
    rotatedBy: row.rotatedBy,
    rotatedAt: row.updatedAt.toISOString(),
  };
}

export async function rotateDeviceReportSecret(workspaceSlug: string, actor: string): Promise<DeviceReportSecretStatus> {
  const newSecret = randomBytes(18).toString("base64url");
  await prisma.deviceReportSecret.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, secret: encryptSecret(newSecret), rotatedBy: actor },
    update: { secret: encryptSecret(newSecret), rotatedBy: actor },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "device_report_secret_rotated", actor,
    message: `Device-report webhook secret generated/rotated for this workspace by ${actor}`,
  });
  return { configured: true, secret: newSecret };
}

export async function clearDeviceReportSecret(workspaceSlug: string, actor: string): Promise<void> {
  const existing = await prisma.deviceReportSecret.findUnique({ where: { workspaceSlug } });
  if (existing) {
    await prisma.deviceReportSecret.delete({ where: { workspaceSlug } });
    await recordAuditEvent(workspaceSlug, {
      category: "settings", action: "device_report_secret_cleared", actor, severity: "warning",
      message: "Device-report webhook secret removed for this workspace — the webhook will reject all reports until a new one is generated",
    });
  }
}
