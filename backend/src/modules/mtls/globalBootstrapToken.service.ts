import { randomBytes } from "crypto";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";

/**
 * The single, workspace-wide mTLS enrollment credential — see
 * GlobalBootstrapToken's own doc comment in schema.prisma for the full
 * design. Rotate/status/clear mirror settings/deviceReportSecret.service.ts's
 * pattern exactly (same as this module's predecessor, enrollmentSecret.service.ts,
 * before the Phase E "self-service mode" concept was retired in favor of one
 * always-on mechanism — see mtls-agent-auth-roadmap.md's Global Bootstrap
 * Token addendum for why: a bootstrap token is unattended by nature, so
 * there's no separate "silent vs approval" toggle to carry anymore. The
 * actual enrollment validation (token compare + live Applivery SN check +
 * anti-hijack guard) lives in deviceMtls.service.ts's registerDevice, right
 * next to the CSR-signing logic it feeds.
 */

export interface GlobalBootstrapTokenStatus {
  configured: boolean;
  secret: string | null;
  rotatedBy?: string | null;
  rotatedAt?: string | null;
}

export async function getGlobalBootstrapTokenStatus(workspaceSlug: string): Promise<GlobalBootstrapTokenStatus> {
  const row = await prisma.globalBootstrapToken.findUnique({ where: { workspaceSlug } });
  if (!row) return { configured: false, secret: null };
  return { configured: true, secret: decryptSecret(row.secret), rotatedBy: row.rotatedBy, rotatedAt: row.updatedAt.toISOString() };
}

export async function rotateGlobalBootstrapToken(workspaceSlug: string, actor: string): Promise<GlobalBootstrapTokenStatus> {
  const newSecret = randomBytes(18).toString("base64url");
  await prisma.globalBootstrapToken.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, secret: encryptSecret(newSecret), rotatedBy: actor },
    update: { secret: encryptSecret(newSecret), rotatedBy: actor },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_global_bootstrap_token_rotated",
    actor,
    severity: "warning",
    message: `mTLS global bootstrap token generated/rotated for this workspace by ${actor} — any Managed Configuration deployment carrying the old value must be updated, and any device that hasn't registered yet will need it.`,
  });
  return { configured: true, secret: newSecret };
}

export async function clearGlobalBootstrapToken(workspaceSlug: string, actor: string): Promise<void> {
  const existing = await prisma.globalBootstrapToken.findUnique({ where: { workspaceSlug } });
  if (existing) {
    await prisma.globalBootstrapToken.delete({ where: { workspaceSlug } });
    await recordAuditEvent(workspaceSlug, {
      category: "settings",
      action: "mtls_global_bootstrap_token_cleared",
      actor,
      severity: "warning",
      message: `mTLS global bootstrap token removed for this workspace by ${actor} — no device can register for a new certificate until a new token is generated. Devices with an already-issued certificate are unaffected (they authenticate via their cert, never this token, once registered).`,
    });
  }
}
