import { randomUUID, timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { getDevicesFull } from "../devices/devices.service";
import type { NormalizedDevice } from "../devices/deviceNormalize";
import { getAutomationBearer } from "./automationCredential.service";
import { launchWorkflowRun, workflowHasDestructiveStep } from "../workflows/workflows.service";
import type { WorkflowDeviceRefPayload } from "../workflows/workflows.schemas";
import { addCaseTimelineEntry, dispatchAndAttachCaseEvent } from "../cases/cases.service";
import { APPLIVERY_WEBHOOK_EVENT_LABELS, appliveryWebhookEventLabel } from "./appliveryWebhookSettings.schemas";

/**
 * The inbound URL an admin pastes into Applivery's own Workspace/App >
 * Integrations > Webhook settings. Port of `receive_applivery_webhook`
 * (main.py:13098-13243). Deliberately NOT dashboard-token protected (the
 * caller is Applivery's own webhook engine) and not header-auth (Applivery's
 * webhook config UI only takes a URL) — the secret lives in the path,
 * same pattern as /api/triggers/fire/{id}/{secret}.
 *
 * Real improvement over the original: `_find_applivery_webhook_config_by_secret`
 * scanned every workspace's JSON file on disk to find the matching secret.
 * Here that's a single indexed Postgres lookup (secret has no unique
 * constraint but the table is tiny — one row per workspace).
 */

const OS_PREFIXES = ["apple_", "android_", "windows_", "aosp_", "macos_", "ios_"];

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return cryptoTimingSafeEqual(bufA, bufB);
}

/** Port of `_normalize_applivery_webhook_action` (main.py:12977). */
function normalizeAction(action: string): { os: string | null; canonicalKey: string } {
  const raw = (action ?? "").trim();
  for (const prefix of OS_PREFIXES) {
    if (raw.startsWith(prefix)) return { os: prefix.replace(/_$/, ""), canonicalKey: raw.slice(prefix.length) };
  }
  return { os: null, canonicalKey: raw };
}

/** Port of `_applivery_webhook_extract_device_hint`/`_resolve_applivery_webhook_device` (main.py:12993-13024). */
function resolveDevice(body: Record<string, unknown>, devices: NormalizedDevice[]): NormalizedDevice | null {
  const candidates: string[] = [];
  const containers: Array<Record<string, unknown>> = [body];
  if (body.data && typeof body.data === "object") containers.push(body.data as Record<string, unknown>);
  if (body.device && typeof body.device === "object") containers.push(body.device as Record<string, unknown>);
  for (const container of containers) {
    for (const key of ["id", "_id", "deviceId", "serialNumber", "serial", "udid", "platformDeviceId"]) {
      const v = container[key];
      if (v) candidates.push(String(v).trim().toLowerCase());
    }
  }
  for (const value of candidates) {
    for (const d of devices) {
      if (String(d.id || "").trim().toLowerCase() === value) return d;
      if (String(d.serialNumber || "").trim().toLowerCase() === value) return d;
      if (String(d.platformDeviceId || "").trim().toLowerCase() === value) return d;
      if (String(d.identifiers?.udid || "").trim().toLowerCase() === value) return d;
    }
  }
  return null;
}

interface AppliveryWebhookEventRecord {
  id: string;
  receivedAt: string;
  actionKey: string;
  canonicalKey: string;
  os: string | null;
  outcome: string;
  deviceId: string | null;
  deviceName: string | null;
  caseId: string | null;
  workflowRunId: string | null;
}

export interface ReceiveAppliveryWebhookResult {
  status: string;
  caseId: string | null;
  workflowRunId: string | null;
}

async function findConfigBySecret(secret: string) {
  // Scans in application code rather than a WHERE clause since secrets are
  // never indexed/hashed for lookup — the table is one row per workspace,
  // so this is cheap, and it keeps the constant-time compare intact instead
  // of leaking timing info through a database equality filter.
  const configs = await prisma.appliveryWebhookConfig.findMany();
  for (const config of configs) {
    if (timingSafeEqual(secret, config.secret)) return config;
  }
  return null;
}

async function appendEvent(workspaceSlug: string, event: AppliveryWebhookEventRecord): Promise<void> {
  const config = await prisma.appliveryWebhookConfig.findUnique({ where: { workspaceSlug } });
  if (!config) return;
  const recentEvents = [event, ...((config.recentEvents as unknown as AppliveryWebhookEventRecord[]) ?? [])].slice(0, 50);
  await prisma.appliveryWebhookConfig.update({
    where: { workspaceSlug },
    data: { recentEvents: recentEvents as any, receivedCount: { increment: 1 }, lastReceivedAt: new Date(event.receivedAt) },
  });
}

export async function receiveAppliveryWebhook(secret: string, body: Record<string, unknown>): Promise<ReceiveAppliveryWebhookResult> {
  const config = await findConfigBySecret(secret);
  if (!config) throw new HttpError(404, "Unknown webhook secret");
  const workspaceSlug = config.workspaceSlug;
  const nowIso = new Date().toISOString();

  const rawAction = String(body.action ?? body.event ?? "unknown");
  const { os: osHint, canonicalKey } = normalizeAction(rawAction);

  let rule = await prisma.appliveryWebhookRule.findUnique({ where: { workspaceSlug_actionKey: { workspaceSlug, actionKey: canonicalKey } } });
  if (!rule) {
    rule = await prisma.appliveryWebhookRule.create({
      data: {
        workspaceSlug, actionKey: canonicalKey,
        label: APPLIVERY_WEBHOOK_EVENT_LABELS[canonicalKey] ?? appliveryWebhookEventLabel(canonicalKey),
        enabled: false, openCase: false, caseSeverity: "medium", runWorkflow: false, workflowId: null, autoRunDestructiveAck: false,
      },
    });
  }

  const event: AppliveryWebhookEventRecord = {
    id: randomUUID(), receivedAt: nowIso, actionKey: rawAction, canonicalKey, os: osHint,
    outcome: "logged", deviceId: null, deviceName: null, caseId: null, workflowRunId: null,
  };

  const webhookOff = !config.enabled;
  const ruleOff = !rule.enabled;

  // Proactive device-fleet sync — deliberately independent of rule.enabled
  // (that toggle only gates the optional Case/Workflow automation below).
  // A newly enrolled device's own SOAR Agent build is pushed via the same
  // Managed Configuration profile Applivery applies at enrollment, and
  // typically attempts its first self-report/mTLS registration within
  // seconds — but that registration only succeeds once SOAR's own device
  // cache (DEVICES_CACHE_TTL_SECONDS, 15 min) actually contains the device,
  // since registration cross-checks the reported serial number against
  // Applivery's live fleet. Without this, a device enrolling mid-cache
  // window can lose that race and fail registration, needing a manual
  // resync to fix — exactly the race condition this closes. Fire-and-forget
  // (not awaited) so a slow full-fleet pull never delays this webhook's own
  // response to Applivery. See docs/settings.md's Applivery Events section
  // for why subscribing to this specific event is called out as required.
  let deviceSyncTriggered = false;
  if (!webhookOff && canonicalKey === "device_enrolled") {
    const syncAuth = await getAutomationBearer(workspaceSlug);
    if (syncAuth) {
      deviceSyncTriggered = true;
      getDevicesFull(syncAuth, workspaceSlug, true).catch((e) => {
        console.warn(`[AppliveryWebhook] Proactive device sync after "${rawAction}" failed: ${e}`);
      });
    }
  }

  if (webhookOff || ruleOff) {
    event.outcome = webhookOff ? "webhook_disabled" : deviceSyncTriggered ? "device_sync_triggered" : "logged";
    await appendEvent(workspaceSlug, event);
    await recordAuditEvent(workspaceSlug, {
      category: "webhook", action: "applivery_event_received", actor: "applivery",
      message: `Applivery event "${rawAction}" received — ${webhookOff ? "webhook is disabled" : deviceSyncTriggered ? "device fleet resync triggered" : "no automation configured for this event yet"}`,
    });
    return { status: event.outcome, caseId: null, workflowRunId: null };
  }

  const authorization = await getAutomationBearer(workspaceSlug);
  let matchedDevice: NormalizedDevice | null = null;
  if (authorization) {
    try {
      const devicesResp = await getDevicesFull(authorization, workspaceSlug, false);
      matchedDevice = resolveDevice(body, devicesResp.items);
    } catch {
      matchedDevice = null;
    }
  }
  if (matchedDevice) {
    event.deviceId = matchedDevice.id;
    event.deviceName = matchedDevice.displayName;
  }

  const outcomeParts: string[] = [];
  if (deviceSyncTriggered) outcomeParts.push("device_sync_triggered");
  let caseId: string | null = null;

  if (rule.openCase) {
    const label = APPLIVERY_WEBHOOK_EVENT_LABELS[canonicalKey] ?? appliveryWebhookEventLabel(canonicalKey);
    const title = label + (matchedDevice ? ` — ${matchedDevice.displayName}` : "");
    const created = await prisma.case.create({
      data: {
        workspaceSlug, title, status: "open", severity: rule.caseSeverity || "medium", source: "applivery_webhook",
        deviceId: matchedDevice?.id ?? null, deviceName: matchedDevice?.displayName ?? null,
        segmentId: matchedDevice?.segmentId != null ? String(matchedDevice.segmentId) : null,
        workflowRunIds: [], createdBy: "system", threatIntel: [], externalRefs: [],
      },
    });
    await addCaseTimelineEntry(created.id, "created", `Case opened by Applivery event "${rawAction}"`);
    await dispatchAndAttachCaseEvent(workspaceSlug, created.id, "created");
    caseId = created.id;
    event.caseId = caseId;
    outcomeParts.push("case_opened");
  }

  if (rule.runWorkflow && rule.workflowId) {
    const workflow = await prisma.workflow.findFirst({ where: { workspaceSlug, id: rule.workflowId } });
    if (!workflow) {
      outcomeParts.push("workflow_missing");
    } else if (!authorization) {
      outcomeParts.push("no_automation_credential");
    } else if (workflowHasDestructiveStep(workflow) && !rule.autoRunDestructiveAck) {
      outcomeParts.push("workflow_blocked_destructive");
      await recordAuditEvent(workspaceSlug, {
        category: "webhook", action: "applivery_event_workflow_blocked", actor: "applivery", severity: "critical",
        targetType: "workflow", targetId: workflow.id, targetName: workflow.name,
        message: `Applivery event "${rawAction}" — workflow "${workflow.name}" contains a destructive action and was not acknowledged, so it did not run`,
      });
    } else {
      const deviceRefs: WorkflowDeviceRefPayload[] = matchedDevice
        ? [{
            id: matchedDevice.id, displayName: matchedDevice.displayName, platform: matchedDevice.platform,
            platformDeviceId: matchedDevice.platformDeviceId, serialNumber: matchedDevice.serialNumber,
            osVersion: matchedDevice.osVersion, manufacturer: matchedDevice.manufacturer, model: matchedDevice.model,
            udid: matchedDevice.identifiers?.udid, mdmUser: matchedDevice.mdmUser as Record<string, unknown> | null,
          }]
        : [];
      const runRecord = await launchWorkflowRun(workflow, deviceRefs, authorization, workspaceSlug);
      if (runRecord !== null) {
        event.workflowRunId = runRecord.id;
        outcomeParts.push("workflow_fired");
        if (caseId) {
          await prisma.case.update({ where: { id: caseId }, data: { workflowRunIds: { push: runRecord.id }, updatedAt: new Date() } });
          await addCaseTimelineEntry(caseId, "workflow_run_linked", `Ran "${workflow.name}" (Applivery event automation)`);
        }
      } else {
        outcomeParts.push("workflow_unavailable");
      }
    }
  }

  event.outcome = outcomeParts.length ? outcomeParts.join("+") : "logged";
  await appendEvent(workspaceSlug, event);

  await recordAuditEvent(workspaceSlug, {
    category: "webhook", action: "applivery_event_received", actor: "applivery",
    targetType: matchedDevice ? "device" : undefined, targetId: matchedDevice?.id, targetName: matchedDevice?.displayName ?? undefined,
    message: `Applivery event "${rawAction}" — ${event.outcome.replace(/_/g, " ")}` + (matchedDevice ? ` (${matchedDevice.displayName})` : ""),
  });

  return { status: event.outcome, caseId, workflowRunId: event.workflowRunId };
}
