import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";

/**
 * Which Applivery Smart Attribute (matched by NAME) holds an OS patch-level
 * value the customer has already populated on the Applivery side for every
 * platform this app tracks: Android Security Patch Level date
 * ("2026-05-05"), Apple dotted version + build ("26.6.2 (25G82)"), Windows
 * full build ("10.0.28000.2704"). Settings > Workspace Automation is the
 * only place this is configured (one dropdown, populated from GET
 * /api/smart-attributes — see deviceCatalog.service.ts's getSmartAttributes,
 * which already exists for the Compliance Policy Builder's own Smart
 * Attribute picker).
 *
 * Stored on WorkspaceState (schema.prisma) with the REAL per-org
 * workspaceSlug — unlike dashboard/theme/webhook/SMTP config, which
 * dashboardState.controller.ts deliberately pins to the literal "global"
 * slug (see that file's doc comment), this is genuinely per-workspace, same
 * pattern as agentSubdomain.service.ts/mtlsEnforcement.service.ts.
 *
 * Once set, normalizeDeviceFull() (deviceNormalize.ts) reads this attribute
 * name off every device's own already-parsed smartAttributes[] and surfaces
 * the matching value as NormalizedDevice.osPatchLevel — so CVE-matching
 * connectors (osvAndroidService.ts, sofaService.ts) and Compliance Policy's
 * "OS Patch Level" condition (complianceFields.ts/complianceEvaluate.ts)
 * never need to know the attribute's name themselves, only that
 * device.osPatchLevel may be populated. Unset means no mapping configured —
 * every consumer falls back to its previous, coarser device.osVersion-based
 * behavior.
 */

export async function getOsPatchLevelMapping(workspaceSlug: string): Promise<{ smartAttributeName: string | null }> {
  const row = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  return { smartAttributeName: row?.osPatchLevelSmartAttributeName ?? null };
}

export async function setOsPatchLevelMapping(workspaceSlug: string, actor: string, smartAttributeName: string | null): Promise<{ smartAttributeName: string | null }> {
  const value = smartAttributeName?.trim() || null;

  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, osPatchLevelSmartAttributeName: value },
    update: { osPatchLevelSmartAttributeName: value },
  });

  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "os_patch_level_mapping_updated",
    actor,
    severity: "info",
    message: value
      ? `OS Patch Level Smart Attribute mapping set to "${value}" by ${actor} — device.osPatchLevel now reflects this attribute's value on every fetch.`
      : `OS Patch Level Smart Attribute mapping cleared by ${actor} — CVE-matching connectors and Compliance fall back to OS-version-only matching.`,
  });

  return { smartAttributeName: value };
}
