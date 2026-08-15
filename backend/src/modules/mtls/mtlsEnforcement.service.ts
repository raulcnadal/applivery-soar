import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";

/**
 * Phase C — the cutover switch. Stored on WorkspaceState (schema.prisma),
 * same shape as event-driven detection's Phase 4 rollout controls
 * (eventWatches.service.ts's own module doc), since this is genuinely a
 * per-workspace singleton too.
 *
 * This flag alone doesn't do anything destructive — it's read by
 * deviceData.service.ts's verifyDeviceIdentity (the enforcement-aware
 * combinator every one of the 6 device-caller routes now goes through) to
 * decide whether that request must present a valid mTLS client certificate
 * (true) or may still use the legacy X-Device-Report-Secret (false, the
 * default). POST /api/device-mtls/register always accepts a bootstrap
 * token regardless of this flag's value (a pre-registration device has no
 * cert to present, full stop) and POST /api/device-mtls/renew is always
 * mTLS-only regardless of this flag too — neither route reads it.
 */

export async function getMtlsEnforcementEnabled(workspaceSlug: string): Promise<boolean> {
  const row = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  return row?.mtlsEnforcementEnabled ?? false;
}

export async function setMtlsEnforcementEnabled(workspaceSlug: string, actor: string, enabled: boolean): Promise<{ enabled: boolean }> {
  if (enabled) {
    const ca = await prisma.certificateAuthority.findUnique({ where: { workspaceSlug } });
    if (!ca) {
      throw new HttpError(
        400,
        "Cannot enable mTLS enforcement: no Certificate Authority is configured for this workspace yet. Generate or upload one from Settings > mTLS first, and confirm your fleet has registered (GET /api/mtls/certificates) before cutting over.",
      );
    }
  }

  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, mtlsEnforcementEnabled: enabled },
    update: { mtlsEnforcementEnabled: enabled },
  });

  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: enabled ? "mtls_enforcement_enabled" : "mtls_enforcement_disabled",
    actor,
    severity: enabled ? "warning" : "info",
    message: enabled
      ? `mTLS enforcement ENABLED for this workspace by ${actor} — the 6 device-caller routes now require a valid client certificate instead of the legacy X-Device-Report-Secret. Any device without one goes dark until it registers.`
      : `mTLS enforcement disabled for this workspace by ${actor} — the legacy X-Device-Report-Secret is accepted again on the 6 device-caller routes.`,
  });

  return { enabled };
}
