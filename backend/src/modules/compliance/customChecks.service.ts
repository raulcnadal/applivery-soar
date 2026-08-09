import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { customCheckPayloadSchema, slugifyCheckKey, validateCheckParams, type CustomCheckPayload } from "./customChecks.schemas";

/**
 * Admin-defined custom device checks — Settings > Device Data Webhook's
 * "Custom Device Checks" panel, extending the self-report pipeline
 * (deviceData.service.ts) from a small fixed set of attributes into an
 * open-ended catalog: an admin defines WHAT to check (a checker type + a
 * platform-specific target — process name, service/launchd name, registry
 * value / plist key / file path, app identifier, or a raw command), the
 * matching native agent (Windows/macOS, separate repos) polls
 * GET /api/device-data/custom-checks on its normal report cycle, runs every
 * enabled check locally, and reports results back inside its existing
 * /api/device-data/report payload (deviceData.schemas.ts's
 * customCheckResults field). Results become a new "Custom Check Result"
 * condition type in the Compliance Policy Builder (complianceFields.ts /
 * complianceEvaluate.ts), scoped to the matching platform automatically —
 * a Windows check can never appear as an option inside a macOS-targeted
 * policy, because getCustomCheckNames below is filtered by platform.
 *
 * Unlike getSelfReportedAttributeNames (which only surfaces attribute names
 * that have ALREADY been reported at least once), a custom check's name
 * appears in the Policy Builder the instant it's created — the catalog IS
 * the source of truth, not observed report history. That's the point: an
 * admin should be able to define "flag me if CrowdStrike stops running"
 * and wire it into a policy before a single device has reported back yet.
 *
 * `command` checks (raw shell/PowerShell execution) are deliberately not
 * distinguished from the other, safer checker types here — RBAC (manage
 * Compliance) gates all of them equally. This is a disclosed trade-off: the
 * platform now supports giving the backend the ability to execute arbitrary
 * code on every managed endpoint via this checker type, chosen explicitly
 * over a structured-checkers-only design after review.
 */

export interface CustomCheckDefinitionDTO {
  id: string;
  workspaceSlug: string;
  platform: string;
  key: string;
  name: string;
  description: string | null;
  checkerType: string;
  params: Record<string, unknown>;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

function toDTO(row: any): CustomCheckDefinitionDTO {
  return {
    id: row.id,
    workspaceSlug: row.workspaceSlug,
    platform: row.platform,
    key: row.key,
    name: row.name,
    description: row.description ?? null,
    checkerType: row.checkerType,
    params: (row.params as Record<string, unknown>) ?? {},
    enabled: row.enabled,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCustomChecks(workspaceSlug: string, platform?: string): Promise<CustomCheckDefinitionDTO[]> {
  const rows = await prisma.customCheckDefinition.findMany({
    where: { workspaceSlug, ...(platform ? { platform } : {}) },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toDTO);
}

function parsePayload(body: unknown): CustomCheckPayload {
  const payload = customCheckPayloadSchema.parse(body);
  validateCheckParams(payload.platform, payload.checkerType, payload.params);
  return payload;
}

export async function createCustomCheck(workspaceSlug: string, body: unknown, actorEmail: string): Promise<CustomCheckDefinitionDTO> {
  const payload = parsePayload(body);
  const key = payload.key || slugifyCheckKey(payload.name);
  if (!key) throw new HttpError(400, "Couldn't derive a key from that name — set one explicitly.");
  try {
    const row = await prisma.customCheckDefinition.create({
      data: {
        workspaceSlug,
        platform: payload.platform,
        key,
        name: payload.name,
        description: payload.description ?? null,
        checkerType: payload.checkerType,
        params: payload.params as any,
        enabled: payload.enabled,
        createdBy: actorEmail,
        updatedBy: actorEmail,
      },
    });
    await recordAuditEvent(workspaceSlug, {
      category: "settings", action: "custom_check_created", actor: actorEmail,
      targetType: "custom_check", targetId: row.id, targetName: row.name,
      message: `Custom device check "${row.name}" (${row.platform}, ${row.checkerType}) created by ${actorEmail}`,
    });
    return toDTO(row);
  } catch (e: any) {
    if (e?.code === "P2002") throw new HttpError(409, `A ${payload.platform} check with key "${key}" already exists.`);
    throw e;
  }
}

export async function updateCustomCheck(workspaceSlug: string, id: string, body: unknown, actorEmail: string): Promise<CustomCheckDefinitionDTO> {
  const existing = await prisma.customCheckDefinition.findFirst({ where: { id, workspaceSlug } });
  if (!existing) throw new HttpError(404, "Custom check not found");
  const payload = parsePayload(body);
  const key = payload.key || existing.key;
  try {
    const row = await prisma.customCheckDefinition.update({
      where: { id },
      data: {
        platform: payload.platform,
        key,
        name: payload.name,
        description: payload.description ?? null,
        checkerType: payload.checkerType,
        params: payload.params as any,
        enabled: payload.enabled,
        updatedBy: actorEmail,
      },
    });
    await recordAuditEvent(workspaceSlug, {
      category: "settings", action: "custom_check_updated", actor: actorEmail,
      targetType: "custom_check", targetId: row.id, targetName: row.name,
      message: `Custom device check "${row.name}" (${row.platform}, ${row.checkerType}) updated by ${actorEmail}`,
    });
    return toDTO(row);
  } catch (e: any) {
    if (e?.code === "P2002") throw new HttpError(409, `A ${payload.platform} check with key "${key}" already exists.`);
    throw e;
  }
}

export async function deleteCustomCheck(workspaceSlug: string, id: string, actorEmail: string): Promise<void> {
  const existing = await prisma.customCheckDefinition.findFirst({ where: { id, workspaceSlug } });
  if (!existing) throw new HttpError(404, "Custom check not found");
  await prisma.customCheckDefinition.delete({ where: { id } });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "custom_check_deleted", actor: actorEmail,
    targetType: "custom_check", targetId: existing.id, targetName: existing.name,
    message: `Custom device check "${existing.name}" (${existing.platform}) deleted by ${actorEmail}`,
  });
}

/**
 * GET /api/device-data/custom-checks?platform=windows|macos — the agent
 * poll endpoint (deviceData.controller.ts), authenticated the same way as
 * the two report endpoints (X-Workspace-Slug + X-Device-Report-Secret).
 * Minimal shape: no id/audit metadata the agent has no use for, and
 * disabled checks are never sent (removing a check from a device's fleet
 * is as simple as toggling it off, no agent-side state to reconcile).
 */
export async function listEnabledChecksForAgent(workspaceSlug: string, platform: string): Promise<Array<{ key: string; checkerType: string; params: Record<string, unknown> }>> {
  const rows = await prisma.customCheckDefinition.findMany({ where: { workspaceSlug, platform, enabled: true } });
  return rows.map((r: any) => ({ key: r.key, checkerType: r.checkerType, params: (r.params as Record<string, unknown>) ?? {} }));
}

/**
 * GET /api/compliance/custom-check-names?platform= — the Policy Builder's
 * condition picker. Deliberately sourced from the check catalog itself
 * (not from observed report history like getSelfReportedAttributeNames) so
 * a brand-new check is selectable immediately, before any device has
 * reported it — see this file's module doc.
 */
export async function getCustomCheckNames(workspaceSlug: string, platform?: string): Promise<Array<{ key: string; name: string; platform: string }>> {
  const rows = await prisma.customCheckDefinition.findMany({
    where: { workspaceSlug, enabled: true, ...(platform ? { platform } : {}) },
    orderBy: { name: "asc" },
  });
  return rows.map((r: any) => ({ key: r.key, name: r.name, platform: r.platform }));
}
