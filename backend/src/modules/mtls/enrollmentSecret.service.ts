import { randomBytes } from "crypto";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";

/**
 * Self-service enrollment (Phase E addendum to
 * backend/docs/mtls-agent-auth-roadmap.md) — the shared, workspace-wide
 * alternative to per-device DeviceBootstrapTokens, added because there was
 * no way to actually deliver a unique per-device token to each device:
 * Applivery's own Managed Configuration interpolation only exposes
 * Applivery's built-in device/user fields, not a secret we mint (confirmed
 * against docs.applivery.com's Dynamic Variables page). This secret is
 * instead deployed ONCE, identically, to the whole fleet via a single
 * Managed Configuration push — same delivery mechanism as the legacy
 * X-Device-Report-Secret.
 *
 * Rotate/status/clear mirror settings/deviceReportSecret.service.ts's
 * pattern exactly. The *mode* controls what happens when a device shows up
 * with this secret (mtlsEnrollment.service.ts owns the actual enroll logic):
 *   - "disabled" (default): the enroll endpoint rejects everything outright,
 *     regardless of whether a secret is configured — this alone changes no
 *     behavior for a workspace that hasn't opted in.
 *   - "approval": the request queues in DeviceEnrollmentRequest until an
 *     admin approves or rejects it.
 *   - "silent": issued immediately once the secret and a currently-enrolled
 *     Applivery serial number both check out — true zero-touch, at the cost
 *     of the weaker guarantee described in mtlsEnrollment.service.ts's doc.
 */

export interface EnrollmentSecretStatus {
  configured: boolean;
  secret: string | null;
  rotatedBy?: string | null;
  rotatedAt?: string | null;
}

export async function getEnrollmentSecretStatus(workspaceSlug: string): Promise<EnrollmentSecretStatus> {
  const row = await prisma.enrollmentSecret.findUnique({ where: { workspaceSlug } });
  if (!row) return { configured: false, secret: null };
  return { configured: true, secret: decryptSecret(row.secret), rotatedBy: row.rotatedBy, rotatedAt: row.updatedAt.toISOString() };
}

export async function rotateEnrollmentSecret(workspaceSlug: string, actor: string): Promise<EnrollmentSecretStatus> {
  const newSecret = randomBytes(18).toString("base64url");
  await prisma.enrollmentSecret.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, secret: encryptSecret(newSecret), rotatedBy: actor },
    update: { secret: encryptSecret(newSecret), rotatedBy: actor },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_enrollment_secret_rotated",
    actor,
    severity: "warning",
    message: `mTLS self-service enrollment secret generated/rotated for this workspace by ${actor} — any Managed Configuration deployment carrying the old value must be updated.`,
  });
  return { configured: true, secret: newSecret };
}

export async function clearEnrollmentSecret(workspaceSlug: string, actor: string): Promise<void> {
  const existing = await prisma.enrollmentSecret.findUnique({ where: { workspaceSlug } });
  if (existing) {
    await prisma.enrollmentSecret.delete({ where: { workspaceSlug } });
    // Disabling the secret without also disabling the mode would leave a
    // workspace that thinks self-service is still on but can never actually
    // succeed (every enroll call fails the secret check) — flip it back to
    // "disabled" too so the admin UI doesn't show a misleadingly "active"
    // mode with no way to satisfy it.
    await prisma.workspaceState.updateMany({ where: { workspaceSlug }, data: { mtlsSelfServiceMode: "disabled" } });
    await recordAuditEvent(workspaceSlug, {
      category: "settings",
      action: "mtls_enrollment_secret_cleared",
      actor,
      severity: "warning",
      message: `mTLS self-service enrollment secret removed for this workspace by ${actor} — self-service enrollment is now disabled.`,
    });
  }
}

const VALID_MODES = new Set(["disabled", "silent", "approval"]);

export async function getSelfServiceMode(workspaceSlug: string): Promise<string> {
  const row = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  return row?.mtlsSelfServiceMode ?? "disabled";
}

export async function setSelfServiceMode(workspaceSlug: string, actor: string, mode: string): Promise<{ mode: string }> {
  if (!VALID_MODES.has(mode)) {
    throw new HttpError(400, `mode must be one of: ${Array.from(VALID_MODES).join(", ")}`);
  }
  if (mode !== "disabled") {
    const [ca, secret] = await Promise.all([
      prisma.certificateAuthority.findUnique({ where: { workspaceSlug } }),
      prisma.enrollmentSecret.findUnique({ where: { workspaceSlug } }),
    ]);
    if (!ca) {
      throw new HttpError(400, "Cannot enable self-service enrollment: no Certificate Authority is configured for this workspace yet. Generate or upload one first.");
    }
    if (!secret) {
      throw new HttpError(400, "Cannot enable self-service enrollment: generate an enrollment secret first — devices need it to prove they're allowed to enroll.");
    }
  }

  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, mtlsSelfServiceMode: mode },
    update: { mtlsSelfServiceMode: mode },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_self_service_mode_changed",
    actor,
    severity: mode === "silent" ? "warning" : "info",
    message: `mTLS self-service enrollment mode set to "${mode}" for this workspace by ${actor}.`,
  });
  return { mode };
}
