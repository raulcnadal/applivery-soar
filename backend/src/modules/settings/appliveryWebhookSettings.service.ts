import { randomBytes } from "crypto";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { workflowHasDestructiveStep } from "../workflows/workflows.service";
import { APPLIVERY_WEBHOOK_EVENT_LABELS, appliveryWebhookEventLabel, type AppliveryWebhookConfigPayload } from "./appliveryWebhookSettings.schemas";

/**
 * Applivery inbound-webhook Settings tab — port of main.py:13036-13096
 * (GET/PUT config + rotate-secret). The actual event receiver
 * (`POST /api/applivery-webhook/receive/{secret}`, main.py:13098-13243) is
 * appliveryWebhookReceive.service.ts (Phase 8) — this module covers the
 * config CRUD (viewing/enabling rules, rotating the secret, and the
 * recentEvents/receivedCount/lastReceivedAt bookkeeping the receiver writes).
 */

function newSecret(): string {
  return randomBytes(18).toString("base64url");
}

async function ensureConfig(workspaceSlug: string) {
  const existing = await prisma.appliveryWebhookConfig.findUnique({ where: { workspaceSlug } });
  if (existing) return existing;
  const created = await prisma.appliveryWebhookConfig.create({ data: { workspaceSlug, enabled: true, secret: newSecret() } });
  // Pre-seed a disabled rule for every event Applivery's catalog documents
  // today, so there's something to configure immediately — port of the
  // first_load branch in `get_applivery_webhook_config`.
  await prisma.appliveryWebhookRule.createMany({
    data: Object.entries(APPLIVERY_WEBHOOK_EVENT_LABELS).map(([actionKey, label]) => ({
      workspaceSlug, actionKey, label, enabled: false, openCase: false, caseSeverity: "medium",
      runWorkflow: false, workflowId: null, autoRunDestructiveAck: false,
    })),
  });
  return created;
}

export async function getAppliveryWebhookConfig(workspaceSlug: string) {
  const config = await ensureConfig(workspaceSlug);
  const rules = await prisma.appliveryWebhookRule.findMany({ where: { workspaceSlug }, orderBy: { actionKey: "asc" } });
  return {
    enabled: config.enabled, secret: config.secret, rules,
    recentEvents: config.recentEvents, receivedCount: config.receivedCount, lastReceivedAt: config.lastReceivedAt,
  };
}

export async function updateAppliveryWebhookConfig(workspaceSlug: string, payload: AppliveryWebhookConfigPayload, actor: string) {
  await ensureConfig(workspaceSlug);
  const workflowIds = [...new Set(payload.rules.filter((r) => r.runWorkflow && r.workflowId).map((r) => r.workflowId!))];
  const workflows = workflowIds.length ? await prisma.workflow.findMany({ where: { id: { in: workflowIds }, workspaceSlug } }) : [];
  const workflowsById = new Map(workflows.map((w) => [w.id, w]));

  for (const rule of payload.rules) {
    if (!rule.runWorkflow) continue;
    const workflow = rule.workflowId ? workflowsById.get(rule.workflowId) : undefined;
    if (!workflow) {
      throw new HttpError(400, `Rule "${rule.label || appliveryWebhookEventLabel(rule.actionKey)}" is set to run a workflow but no valid workflow is selected`);
    }
    if (workflowHasDestructiveStep(workflow) && !rule.autoRunDestructiveAck) {
      throw new HttpError(400, `Workflow "${workflow.name}" contains a destructive action step — acknowledge this before rule "${rule.label || appliveryWebhookEventLabel(rule.actionKey)}" can auto-run it unattended`);
    }
  }

  await prisma.appliveryWebhookConfig.update({ where: { workspaceSlug }, data: { enabled: payload.enabled } });
  await prisma.appliveryWebhookRule.deleteMany({ where: { workspaceSlug } });
  if (payload.rules.length) {
    await prisma.appliveryWebhookRule.createMany({
      data: payload.rules.map((r) => ({
        workspaceSlug, actionKey: r.actionKey, label: r.label ?? null, enabled: r.enabled,
        openCase: r.openCase, caseSeverity: r.caseSeverity, runWorkflow: r.runWorkflow,
        workflowId: r.workflowId ?? null, autoRunDestructiveAck: r.autoRunDestructiveAck,
      })),
    });
  }

  const enabledCount = payload.rules.filter((r) => r.enabled).length;
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "applivery_webhook_updated", actor,
    message: `Applivery event webhook settings updated by ${actor} — ${enabledCount} rule(s) enabled, webhook ${payload.enabled ? "on" : "off"}`,
  });

  return getAppliveryWebhookConfig(workspaceSlug);
}

export async function rotateAppliveryWebhookSecret(workspaceSlug: string, actor: string) {
  await ensureConfig(workspaceSlug);
  await prisma.appliveryWebhookConfig.update({ where: { workspaceSlug }, data: { secret: newSecret() } });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "applivery_webhook_secret_rotated", actor, severity: "warning",
    message: `Applivery event webhook URL rotated by ${actor} — update it in Applivery's own Integrations settings or events stop arriving`,
  });
  return getAppliveryWebhookConfig(workspaceSlug);
}
