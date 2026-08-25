import crypto from "crypto";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { getDevicesFull } from "../devices/devices.service";
import type { NormalizedDevice } from "../devices/deviceNormalize";
import { getAutomationBearer } from "../settings/automationCredential.service";
import { launchWorkflowRun } from "./workflows.service";
import type { WorkflowDeviceRefPayload } from "./workflows.schemas";
import { openCaseForTrigger } from "../cases/cases.service";

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

  // Per-device firing state, separate from the workspace-wide aggregate
  // just above — this is what backs both the Compliance Policy Builder's
  // "Inbound Webhook Fired" condition (complianceEvaluate.ts reads it via
  // NormalizedDevice.triggerFires, populated in deviceNormalize.ts) and
  // admin-facing visibility into "did THIS device's EDR/MTD/DEX tool
  // actually call this webhook." Only recorded when a device resolved —
  // a device-less fire (no deviceLookupField configured at all) has
  // nothing to key this row on. lastPayload is capped well under Postgres'
  // JSONB practical limits purely so a chatty/misbehaving external sender
  // can't bloat this table — it's kept for admin visibility only, never
  // read by the evaluator.
  if (matchedDevice) {
    const cappedPayload = capTriggerPayload(body);
    await prisma.triggerFireState.upsert({
      where: { workspaceSlug_triggerId_deviceId: { workspaceSlug: slugKey, triggerId, deviceId: matchedDevice.id } },
      create: { workspaceSlug: slugKey, triggerId, deviceId: matchedDevice.id, status: "active", lastFiredAt: new Date(), resolvedAt: null, fireCount: 1, lastPayload: cappedPayload as any },
      // A fresh fire always re-activates, even if this same (trigger, device)
      // pair was previously resolved — an EDR/MTD/DEX tool re-raising the
      // same alert type is exactly the "still/again violating" case this
      // condition exists for.
      update: { status: "active", lastFiredAt: new Date(), resolvedAt: null, fireCount: { increment: 1 }, lastPayload: cappedPayload as any },
    });
  }

  // Opens a Case (source="workflow_trigger") when this trigger is configured
  // to — port of the case-opening block inside `fire_trigger` (main.py:12873-12896).
  let caseId: string | null = null;
  if (trigger.openCase) {
    caseId = await openCaseForTrigger(
      slugKey, trigger.name, workflow.name, runRecord.id, trigger.caseSeverity,
      matchedDevice ? { id: matchedDevice.id, displayName: matchedDevice.displayName, segmentId: matchedDevice.segmentId } : null,
    );
  }

  await recordAuditEvent(slugKey, {
    category: "trigger", action: "trigger_fired", actor: "external",
    targetType: "workflow", targetId: workflow.id, targetName: workflow.name,
    message: `Inbound trigger "${trigger.name}" fired — ran "${workflow.name}"` + (matchedDevice ? ` against ${matchedDevice.displayName}` : " (no device context)"),
  });

  // Fire-and-forget — a Compliance Policy built on this trigger's "Inbound
  // Webhook Fired" condition should reflect the new violation promptly
  // rather than waiting out its own evaluationIntervalMinutes. See
  // compliance.service.ts's triggerEventDrivenReEvaluation doc comment for
  // why this is a dynamic import (breaks a compliance <-> workflows cycle).
  if (matchedDevice) {
    const { triggerEventDrivenReEvaluation } = await import("../compliance/compliance.service");
    triggerEventDrivenReEvaluation(slugKey, `inbound trigger "${trigger.name}" fired`, matchedDevice.serialNumber);
  }

  return { status: "ok", workflowRunId: runRecord.id, caseId, matchedDevice: matchedDevice?.displayName ?? null };
}

/** Caps a raw inbound payload well under Postgres' JSONB practical limits — kept for admin visibility only, never read by the evaluator, so a chatty/misbehaving external sender can't bloat this table. */
function capTriggerPayload(body: Record<string, unknown>): Record<string, unknown> {
  return JSON.stringify(body).length > 8000 ? { truncated: true, keys: Object.keys(body) } : body;
}

export interface ResolveTriggerResult {
  status: "ok";
  matchedDevice: string | null;
}

/**
 * The companion to fireTrigger — closes the gap where SOAR could move a
 * device out of compliance off an inbound Trigger's "Fired" call but had no
 * way to hear back from the same external system that the underlying
 * condition cleared. Deliberately much lighter than fireTrigger: it never
 * runs the linked Workflow or opens a Case (this is a state correction, not
 * a new incident) — it only flips this (trigger, device) pair's
 * TriggerFireState to "resolved" so the Compliance Policy Builder's
 * "Inbound Webhook Fired" condition (complianceEvaluate.ts) stops matching,
 * letting the standard evaluation pass's own recovery machinery (tag/
 * Smart-Attribute removal, Case auto-resolve) take it from there exactly
 * like any other condition clearing.
 *
 * Requires deviceLookupField to be configured — unlike fireTrigger,
 * resolving genuinely can't mean anything device-less (there is no
 * "everyone's state" to clear, only a specific device's).
 */
export async function resolveTrigger(triggerId: string, secret: string, body: Record<string, unknown>): Promise<ResolveTriggerResult> {
  const trigger = await findTriggerById(triggerId);
  if (!trigger) throw new HttpError(404, "Unknown trigger");
  if (!timingSafeEqual(secret, trigger.secret)) throw new HttpError(401, "Invalid trigger secret");
  if (!trigger.enabled) throw new HttpError(403, "This trigger is disabled");
  if (!trigger.deviceLookupField) {
    throw new HttpError(400, "This trigger has no Device lookup field configured — set one (Settings > Inbound Webhooks) so a Resolved call knows which device's state to clear.");
  }

  const slugKey = trigger.workspaceSlug;
  const authorization = await getAutomationBearer(slugKey);
  if (!authorization) {
    throw new HttpError(503, "No automation credential configured for this workspace — set one in Settings > Workspace Automation.");
  }

  const devicesResp = await getDevicesFull(authorization, slugKey, false);
  const matchedDevice = resolveTriggerDevice(trigger.deviceLookupField, body, devicesResp.items);
  if (!matchedDevice) {
    await recordAuditEvent(slugKey, {
      category: "trigger", action: "trigger_resolved_no_device", actor: "external", severity: "warning",
      targetType: "trigger", targetId: triggerId, targetName: trigger.name,
      message: `Trigger "${trigger.name}" resolve received but no device matched ${trigger.deviceLookupField}=${JSON.stringify(body[trigger.deviceLookupField])} — nothing cleared`,
    });
    throw new HttpError(404, `No device matched on field '${trigger.deviceLookupField}'`);
  }

  await prisma.triggerFireState.upsert({
    where: { workspaceSlug_triggerId_deviceId: { workspaceSlug: slugKey, triggerId, deviceId: matchedDevice.id } },
    // A resolve for a (trigger, device) pair that never actually fired is a
    // no-op from a compliance standpoint (there's nothing "active" to clear)
    // but still upserted rather than rejected — an external tool that fires
    // a "resolved" webhook defensively/idempotently on every check shouldn't
    // get an error back for it, and the row itself remains useful admin
    // visibility either way.
    create: { workspaceSlug: slugKey, triggerId, deviceId: matchedDevice.id, status: "resolved", lastFiredAt: new Date(0), resolvedAt: new Date(), fireCount: 0, lastPayload: capTriggerPayload(body) as any },
    update: { status: "resolved", resolvedAt: new Date(), lastPayload: capTriggerPayload(body) as any },
  });

  await recordAuditEvent(slugKey, {
    category: "trigger", action: "trigger_resolved", actor: "external",
    targetType: "device", targetId: matchedDevice.id, targetName: matchedDevice.displayName,
    message: `Inbound trigger "${trigger.name}" resolved for ${matchedDevice.displayName} — condition reported no longer active`,
  });

  // Fire-and-forget — see the identical call in fireTrigger above. A resolve
  // is exactly as time-sensitive as a fire from a device-compliance
  // standpoint: the device shouldn't sit falsely out of compliance any
  // longer than a fresh violation should sit undetected.
  const { triggerEventDrivenReEvaluation } = await import("../compliance/compliance.service");
  triggerEventDrivenReEvaluation(slugKey, `inbound trigger "${trigger.name}" resolved`, matchedDevice.serialNumber);

  return { status: "ok", matchedDevice: matchedDevice.displayName };
}
