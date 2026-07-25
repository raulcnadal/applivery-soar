import crypto from "crypto";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { getDevicesFull } from "../devices/devices.service";
import type { NormalizedDevice } from "../devices/deviceNormalize";
import { getAutomationBearer } from "../settings/automationCredential.service";
import { launchWorkflowRun } from "./workflows.service";
import type { WorkflowDeviceRefPayload } from "./workflows.schemas";

/**
 * Inbound webhook Triggers — a self-contained URL external systems (EDR,
 * SIEM, ticketing) can POST to in order to fire a workflow unattended. Port
 * of main.py:12660-12901. Firing runs the linked workflow using this
 * workspace's automation credential (the same one the compliance auto-fire
 * path uses), since the caller here is always an unattended external
 * system, never a logged-in admin.
 */

export interface TriggerPayload {
  name: string;
  description?: string | null;
  workflowId: string;
  enabled?: boolean;
  openCase?: boolean;
  caseSeverity?: string;
  deviceLookupField?: string | null;
}

export async function listTriggers(workspaceSlug: string) {
  return prisma.trigger.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
}

async function assertWorkflowExists(workspaceSlug: string, workflowId: string): Promise<void> {
  const workflow = await prisma.workflow.findFirst({ where: { workspaceSlug, id: workflowId } });
  if (!workflow) throw new HttpError(400, "Linked workflow not found");
}

export async function createTrigger(workspaceSlug: string, payload: TriggerPayload, actorEmail: string) {
  await assertWorkflowExists(workspaceSlug, payload.workflowId);
  const created = await prisma.trigger.create({
    data: {
      workspaceSlug, name: payload.name, description: payload.description ?? "", workflowId: payload.workflowId,
      enabled: payload.enabled ?? true, openCase: payload.openCase ?? false, caseSeverity: payload.caseSeverity ?? "medium",
      deviceLookupField: payload.deviceLookupField ?? null, secret: crypto.randomBytes(24).toString("base64url"),
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "trigger", action: "trigger_created", actor: actorEmail,
    targetType: "trigger", targetId: created.id, targetName: created.name,
    message: `Inbound webhook trigger "${created.name}" created by ${actorEmail}`,
  });
  return created;
}

export async function updateTrigger(workspaceSlug: string, triggerId: string, payload: TriggerPayload, actorEmail: string) {
  await assertWorkflowExists(workspaceSlug, payload.workflowId);
  const existing = await prisma.trigger.findFirst({ where: { workspaceSlug, id: triggerId } });
  if (!existing) throw new HttpError(404, "Trigger not found");
  const updated = await prisma.trigger.update({
    where: { id: triggerId },
    data: {
      name: payload.name, description: payload.description ?? "", workflowId: payload.workflowId,
      enabled: payload.enabled ?? true, openCase: payload.openCase ?? false, caseSeverity: payload.caseSeverity ?? "medium",
      deviceLookupField: payload.deviceLookupField ?? null,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "trigger", action: "trigger_updated", actor: actorEmail,
    targetType: "trigger", targetId: triggerId, targetName: updated.name,
    message: `Inbound webhook trigger "${updated.name}" updated by ${actorEmail}`,
  });
  return updated;
}

export async function deleteTrigger(workspaceSlug: string, triggerId: string, actorEmail: string) {
  const existing = await prisma.trigger.findFirst({ where: { workspaceSlug, id: triggerId } });
  if (!existing) throw new HttpError(404, "Trigger not found");
  await prisma.trigger.delete({ where: { id: triggerId } });
  await recordAuditEvent(workspaceSlug, {
    category: "trigger", action: "trigger_deleted", actor: actorEmail, severity: "warning",
    targetType: "trigger", targetId: triggerId, targetName: existing.name,
    message: `Inbound webhook trigger "${existing.name}" deleted by ${actorEmail} — its URL stops working immediately`,
  });
  return { status: "ok" };
}

export async function rotateTriggerSecret(workspaceSlug: string, triggerId: string, actorEmail: string) {
  const existing = await prisma.trigger.findFirst({ where: { workspaceSlug, id: triggerId } });
  if (!existing) throw new HttpError(404, "Trigger not found");
  const updated = await prisma.trigger.update({ where: { id: triggerId }, data: { secret: crypto.randomBytes(24).toString("base64url") } });
  await recordAuditEvent(workspaceSlug, {
    category: "trigger", action: "trigger_secret_rotated", actor: actorEmail, severity: "warning",
    targetType: "trigger", targetId: triggerId, targetName: updated.name,
    message: `Webhook URL rotated for trigger "${updated.name}" by ${actorEmail} — the old URL stops working immediately`,
  });
  return updated;
}

/** Scans every workspace's triggers to find one by id — the inbound /fire URL carries no X-Workspace-Slug header, so resolving ownership has to happen by search. Port of `_find_trigger_by_id` (main.py:12678-12690). */
async function findTriggerById(triggerId: string) {
  return prisma.trigger.findUnique({ where: { id: triggerId } });
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Port of `_resolve_trigger_device` (main.py:12787-12805) — matches the inbound body's configured field against serialNumber, then id, then mdmUser.email. */
function resolveTriggerDevice(deviceLookupField: string | null, body: Record<string, unknown>, devices: NormalizedDevice[]): NormalizedDevice | null {
  if (!deviceLookupField) return null;
  const rawValue = body[deviceLookupField];
  if (rawValue === null || rawValue === undefined) return null;
  const value = String(rawValue).trim().toLowerCase();
  if (!value) return null;
  for (const d of devices) {
    if (String(d.serialNumber || "").trim().toLowerCase() === value) return d;
    if (String(d.id || "").trim().toLowerCase() === value) return d;
    const mdmUser = (d.mdmUser as Record<string, unknown>) || {};
    if (String(mdmUser.email || "").trim().toLowerCase() === value) return d;
  }
  return null;
}

export interface FireTriggerResult {
  status: "ok";
  workflowRunId: string;
  caseId: string | null;
  matchedDevice: string | null;
}

/**
 * The actual inbound URL handler — deliberately NOT dashboard-token
 * protected (the caller is an external system) and not header-based auth
 * (many webhook-capable tools can only be configured with a URL). Both the
 * trigger id and its secret live in the path, same pattern Slack/Teams/
 * PagerDuty use for their own incoming webhooks. Port of `fire_trigger`
 * (main.py:12807-12901).
 */
export async function fireTrigger(triggerId: string, secret: string, body: Record<string, unknown>): Promise<FireTriggerResult> {
  const trigger = await findTriggerById(triggerId);
  if (!trigger) throw new HttpError(404, "Unknown trigger");
  if (!timingSafeEqual(secret, trigger.secret)) throw new HttpError(401, "Invalid trigger secret");
  if (!trigger.enabled) throw new HttpError(403, "This trigger is disabled");

  const slugKey = trigger.workspaceSlug;
  const workflow = await prisma.workflow.findFirst({ where: { workspaceSlug: slugKey, id: trigger.workflowId } });
  if (!workflow) throw new HttpError(400, "Linked workflow no longer exists");

  const authorization = await getAutomationBearer(slugKey);
  if (!authorization) {
    throw new HttpError(503, "No automation credential configured for this workspace — set one in Settings > Workspace Automation so unattended triggers can run workflows.");
  }

  const devicesResp = await getDevicesFull(authorization, slugKey, false);
  const matchedDevice = resolveTriggerDevice(trigger.deviceLookupField, body, devicesResp.items);

  let deviceRefs: WorkflowDeviceRefPayload[] = [];
  if (matchedDevice) {
    deviceRefs = [{
      id: matchedDevice.id, displayName: matchedDevice.displayName, platform: matchedDevice.platform,
      platformDeviceId: matchedDevice.platformDeviceId, serialNumber: matchedDevice.serialNumber,
      osVersion: matchedDevice.osVersion, manufacturer: matchedDevice.manufacturer, model: matchedDevice.model,
      udid: matchedDevice.identifiers?.udid, mdmUser: matchedDevice.mdmUser as Record<string, unknown> | null,
    }];
  } else if (trigger.deviceLookupField) {
    // Configured to look a device up but couldn't find one — fail loudly
    // rather than silently running a device-scoped workflow against
    // nobody, which would look like success but do nothing.
    await recordAuditEvent(slugKey, {
      category: "trigger", action: "trigger_fired_no_device", actor: "external", severity: "warning",
      targetType: "trigger", targetId: triggerId, targetName: trigger.name,
      message: `Trigger "${trigger.name}" fired but no device matched ${trigger.deviceLookupField}=${JSON.stringify(body[trigger.deviceLookupField])} — workflow not run`,
    });
    throw new HttpError(404, `No device matched on field '${trigger.deviceLookupField}'`);
  }

  const runRecord = await launchWorkflowRun(workflow, deviceRefs, authorization, slugKey);
  if (runRecord === null) {
    throw new HttpError(400, "This workflow includes a 'wait' step, which requires durable storage (DATABASE_URL) not configured on this server.");
  }

  await prisma.trigger.update({ where: { id: triggerId }, data: { lastFiredAt: new Date(), fireCount: { increment: 1 } } });

  // TODO(Phase5): Cases don't exist yet — the original opens/reuses a Case
  // here when trigger.openCase is set (source="workflow_trigger", linked to
  // this run's id). caseId is always null until Phase 5 lands.
  const caseId: string | null = null;

  await recordAuditEvent(slugKey, {
    category: "trigger", action: "trigger_fired", actor: "external",
    targetType: "workflow", targetId: workflow.id, targetName: workflow.name,
    message: `Inbound trigger "${trigger.name}" fired — ran "${workflow.name}"` + (matchedDevice ? ` against ${matchedDevice.displayName}` : " (no device context)"),
  });

  return { status: "ok", workflowRunId: runRecord.id, caseId, matchedDevice: matchedDevice?.displayName ?? null };
}
