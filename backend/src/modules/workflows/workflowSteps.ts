import axios from "axios";
import nodemailer from "nodemailer";
import { appliveryClient } from "../../services/appliveryClient";
import { prisma } from "../../services/prisma";
import { applyDevicePolicies, getDevicesFull } from "../devices/devices.service";
import type { NormalizedDevice } from "../devices/deviceNormalize";
import { loadAppListsContext } from "../appLists/appCatalog.service";
import { readInstalledAppsFromStore } from "../appLists/installedApps.service";
import { policyViolated } from "../compliance/complianceEvaluate";
import { loadGeofenceZonesById } from "../geofencing/geofence.service";
import { loadDeviceLocations } from "../geofencing/locationsRefresh.service";
import { executeMdmAction, type MdmActionResult } from "./mdmActionExecutor";
import { renderTemplate } from "./templateRender";
import type { WorkflowDeviceRefPayload, WorkflowStepPayload } from "./workflows.schemas";

/**
 * Non-mdm_action step executors — http_request/notification (main.py:6000-
 * 6112), policy quarantine/restore/monitor (main.py:6653-6769), and the
 * Recovery gate's cleanup pass (main.py:6771-6833). mdm_action itself is
 * mdmActionExecutor.ts; both are called from workflows.execution.ts's
 * per-device step loop.
 */

export type StepResult = MdmActionResult;

/** Port of `_get_full_device` (main.py:6638) — the normalized-device fields (activePolicies, live compliance, etc.) that a bare WorkflowDeviceRef doesn't carry. `refresh` bypasses the live cache — used everywhere here since these decisions need current state. */
export async function getFullDevice(authorization: string, workspaceSlug: string, deviceId: string, refresh = true): Promise<NormalizedDevice | null> {
  try {
    const resp = await getDevicesFull(authorization, workspaceSlug, refresh);
    return resp.items.find((d) => d.id === deviceId) ?? null;
  } catch {
    return null;
  }
}

// ── http_request / notification (main.py:6000-6112) ──

export async function executeHttpStep(config: Record<string, any>, context: Record<string, unknown>): Promise<StepResult> {
  try {
    const method = String(config.method || "POST").toUpperCase();
    const url = renderTemplate(config.url || "", context);
    if (!url) return { ok: false, detail: "Missing URL" };
    const reqHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries((config.headers as Record<string, unknown>) || {})) {
      reqHeaders[k] = renderTemplate(String(v), context);
    }
    const bodyStr = renderTemplate(config.body || "", context);
    let data: unknown;
    if (bodyStr.trim()) {
      try {
        data = JSON.parse(bodyStr);
      } catch {
        data = bodyStr;
      }
    }
    const res = await axios.request({ method, url, headers: reqHeaders, data, timeout: 30_000, validateStatus: () => true });
    if (res.status < 300) return { ok: true, detail: `HTTP ${res.status}` };
    return { ok: false, detail: `HTTP ${res.status}: ${String(res.data ?? "").slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

interface WorkspaceNotificationSettings {
  webhookUrl?: string | null;
  smtpConfig?: { host?: string; port?: number; user?: string; pass?: string; from?: string } | null;
}

/**
 * channel: 'webhook' (reuses WorkspaceState.webhookUrl), 'email' (reuses
 * WorkspaceState.smtpConfig — NOTE: unlike the original, which decrypts
 * smtpConfig.pass on every state read, this migration hasn't ported the
 * Settings feature yet (Phase 6), so nothing encrypts it at rest here
 * either; this reads the column as-is, which is correct for the current
 * state of the migration and forward-compatible with Phase 6 adding
 * encryption the same way vulnService.ts's apiTokenEncrypted does), or
 * 'applivery_push' (native Applivery Agent push).
 */
export async function executeNotificationStep(
  orgBase: string,
  headers: Record<string, string>,
  config: Record<string, any>,
  context: Record<string, unknown>,
  workspaceState: WorkspaceNotificationSettings | null,
): Promise<StepResult> {
  const channel = config.channel || "webhook";
  const device = (context.device as Record<string, any>) ?? {};
  try {
    const message = renderTemplate(config.message || "", context);

    if (channel === "webhook") {
      const webhookUrl = config.webhookUrl || workspaceState?.webhookUrl;
      if (!webhookUrl) return { ok: false, detail: "No webhook URL configured" };
      const res = await axios.post(webhookUrl, { text: message }, { timeout: 15_000, validateStatus: () => true });
      if (res.status < 300) return { ok: true, detail: "Webhook sent" };
      return { ok: false, detail: `Webhook returned ${res.status}` };
    }

    if (channel === "email") {
      const smtpConfig = workspaceState?.smtpConfig;
      const target = config.target || "admin";
      const mdmUser = device.mdmUser && typeof device.mdmUser === "object" ? device.mdmUser : {};
      const userEmail = mdmUser.email;
      const adminRecipients = renderTemplate(config.recipients || "", context);

      const parts: string[] = [];
      if ((target === "admin" || target === "admin_and_user") && adminRecipients) parts.push(adminRecipients);
      if (target === "user" || target === "admin_and_user") {
        if (userEmail) parts.push(userEmail);
        else if (target === "user") return { ok: false, detail: "Device has no assigned MDM user email" };
      }
      const recipients = parts.filter(Boolean).join(", ");
      const subject = renderTemplate(config.subject || "Applivery SOAR notification", context);
      if (!smtpConfig?.host || !recipients) return { ok: false, detail: "SMTP not configured or missing recipients" };

      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: Number(smtpConfig.port ?? 587),
        secure: false,
        requireTLS: true,
        auth: { user: smtpConfig.user, pass: smtpConfig.pass },
      });
      await transporter.sendMail({ from: smtpConfig.from || smtpConfig.user, to: recipients, subject, text: message });
      return { ok: true, detail: `Email sent to ${recipients}` };
    }

    if (channel === "applivery_push") {
      const deviceId = device.id;
      if (!deviceId) return { ok: false, detail: "Device is missing an Applivery device ID" };
      const osMap: Record<string, string> = { apple: "ios", macos: "macos", android: "android", windows: "windows" };
      const osValue = osMap[device.platform] || String(device.rawPlatform || "").toLowerCase();
      const title = renderTemplate(config.title || "Compliance notification", context);
      const bodyText = renderTemplate(config.message || message, context);
      const payload = { os: osValue, identifier: deviceId, app: "mdmAgent", type: "notification", notification: { title, body: bodyText, data: {} } };
      const res = await appliveryClient.post(`${orgBase}/mdm/push-notifications/send`, payload, { headers });
      if (res.status < 300) return { ok: true, detail: "Push notification sent" };
      const text = String(JSON.stringify(res.data ?? "")).slice(0, 200);
      if (text.includes("3001") || text.toLowerCase().includes("fbtoken")) {
        return { ok: false, detail: "Applivery Agent not installed/registered on this device" };
      }
      return { ok: false, detail: `Push failed (${res.status}): ${text}` };
    }

    return { ok: false, detail: `Unknown notification channel '${channel}'` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// ── Policy quarantine (main.py:6653-6731) ──

/** Port of `_snapshot_policies_if_needed` (main.py:6653) — no-op if a snapshot already exists, so a later escalation tier never clobbers the original pre-quarantine baseline. */
export async function snapshotPoliciesIfNeeded(workspaceSlug: string, deviceId: string, deviceFull: NormalizedDevice, workflowId: string | null | undefined): Promise<void> {
  const existing = await prisma.policyQuarantineEntry.findUnique({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId } } });
  if (existing) return;
  await prisma.policyQuarantineEntry.create({
    data: {
      workspaceSlug,
      deviceId,
      platform: deviceFull.platform,
      policies: (deviceFull.activePolicies ?? []) as any,
      workflowId: workflowId ?? null,
    },
  });
}

/** Port of `_execute_policy_replace_step` (main.py:6668) — quarantine: replace ALL of a device's currently-applied policies with exactly one selected policy. */
export async function executePolicyReplaceStep(
  authorization: string,
  workspaceSlug: string,
  device: WorkflowDeviceRefPayload,
  config: Record<string, any>,
  workflowId: string | null | undefined,
): Promise<StepResult> {
  const policyId = config?.policyId;
  if (!policyId) return { ok: false, detail: "No replacement policy selected" };

  const deviceFull = await getFullDevice(authorization, workspaceSlug, device.id);
  if (!deviceFull) return { ok: false, detail: "Could not read the device's current policy stack" };

  await snapshotPoliciesIfNeeded(workspaceSlug, device.id, deviceFull, workflowId);

  const { ok, detail } = await applyDevicePolicies(authorization, workspaceSlug, device.platform, device.platformDeviceId, [{ id: policyId }]);
  if (!ok) return { ok: false, detail };
  const priorCount = (deviceFull.activePolicies ?? []).length;
  const policyName = config?.policyName || policyId;
  const noun = priorCount === 1 ? "policy" : "policies";
  return { ok: true, detail: `Quarantined — replaced ${priorCount} ${noun} with '${policyName}'` };
}

/** Port of `_execute_policy_add_step` (main.py:6690) — add one policy alongside whatever's already assigned, at admin-chosen priority. */
export async function executePolicyAddStep(
  authorization: string,
  workspaceSlug: string,
  device: WorkflowDeviceRefPayload,
  config: Record<string, any>,
  workflowId: string | null | undefined,
): Promise<StepResult> {
  const policyId = config?.policyId;
  if (!policyId) return { ok: false, detail: "No policy selected" };
  const priority = config?.priority || "bottom";

  const deviceFull = await getFullDevice(authorization, workspaceSlug, device.id);
  if (!deviceFull) return { ok: false, detail: "Could not read the device's current policy stack" };

  await snapshotPoliciesIfNeeded(workspaceSlug, device.id, deviceFull, workflowId);

  const current = deviceFull.activePolicies ?? [];
  const currentIds = current.filter((p: any) => p.id).map((p: any) => ({ id: p.id }));
  const newEntry = { id: policyId };
  const newStack = priority === "top" ? [newEntry, ...currentIds] : [...currentIds, newEntry];

  const { ok, detail } = await applyDevicePolicies(authorization, workspaceSlug, device.platform, device.platformDeviceId, newStack);
  if (!ok) return { ok: false, detail };
  const policyName = config?.policyName || policyId;
  const noun = newStack.length === 1 ? "policy" : "policies";
  return { ok: true, detail: `Added '${policyName}' as ${priority === "top" ? "primary" : "lowest-priority fallback"} (${newStack.length} ${noun} total)` };
}

/** Port of `_execute_policy_restore_step` (main.py:6718) — put back exactly the policy stack that was in place before the first quarantine step touched this device, then clear the snapshot. */
export async function executePolicyRestoreStep(
  authorization: string,
  workspaceSlug: string,
  device: WorkflowDeviceRefPayload,
): Promise<StepResult> {
  const snapshot = await prisma.policyQuarantineEntry.findUnique({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId: device.id } } });
  if (!snapshot) return { ok: false, detail: "No saved policy snapshot for this device — nothing to restore" };

  const policies = ((snapshot.policies as any[]) ?? []).filter((p) => p?.id).map((p) => ({ id: p.id }));
  const { ok, detail } = await applyDevicePolicies(authorization, workspaceSlug, device.platform, device.platformDeviceId, policies);
  if (!ok) return { ok: false, detail };
  await prisma.policyQuarantineEntry.delete({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId: device.id } } });
  const noun = policies.length === 1 ? "policy" : "policies";
  return { ok: true, detail: `Restored ${policies.length} previous ${noun}` };
}

/**
 * Port of `_execute_monitor_step` (main.py:6733) — re-checks the linked
 * Compliance Policy against fresh device data. ok=true (compliant again)
 * takes onSuccess (default 'stop'); ok=false (still violating) takes
 * onFailure (default 'next step') — how a tiered escalation chain advances.
 */
export async function executeMonitorStep(
  authorization: string,
  workspaceSlug: string,
  device: WorkflowDeviceRefPayload,
  config: Record<string, any>,
): Promise<StepResult> {
  const policyId = config?.compliancePolicyId;
  if (!policyId) return { ok: false, detail: "No compliance policy selected to monitor against" };

  const policy = await prisma.compliancePolicy.findFirst({ where: { workspaceSlug, id: policyId } });
  if (!policy) return { ok: false, detail: "Linked compliance policy no longer exists" };

  const deviceFull = await getFullDevice(authorization, workspaceSlug, device.id, true);
  if (!deviceFull) return { ok: false, detail: "Could not re-fetch device state to evaluate compliance" };

  const conditions = (policy.conditions as any[]) ?? [];
  if (conditions.some((c) => ["requiredAppList", "disallowedAppList"].includes(c?.field))) {
    (deviceFull as any).installedApps = await readInstalledAppsFromStore(workspaceSlug, device.id);
  }
  const appLists = await loadAppListsContext(workspaceSlug);
  // Single-device re-check, so the geofencing lookup is cheap even though
  // it's not the fleet-wide batched pass compliance.service.ts does.
  const geo = conditions.some((c) => c?.field === "geofenceZoneId")
    ? { zonesById: await loadGeofenceZonesById(workspaceSlug), locationsByDeviceId: await loadDeviceLocations(workspaceSlug, [device.id]) }
    : undefined;
  const matched = policyViolated(deviceFull as any, { conditions: conditions as any, conditionLogic: policy.conditionLogic }, appLists, geo);
  if (matched.length) {
    return { ok: false, detail: `Still violating '${policy.name || "policy"}' — ${matched.length} condition(s) matched` };
  }

  if (config?.restoreOnCompliant) {
    const hasQuarantine = await prisma.policyQuarantineEntry.findUnique({ where: { workspaceSlug_deviceId: { workspaceSlug, deviceId: device.id } } });
    if (hasQuarantine) {
      const { ok, detail } = await executePolicyRestoreStep(authorization, workspaceSlug, device);
      if (!ok) return { ok: true, detail: `Compliant again, but restore failed: ${detail}` };
      return { ok: true, detail: `Compliant again — ${detail}` };
    }
    return { ok: true, detail: "Compliant again — no quarantine snapshot to restore" };
  }

  return { ok: true, detail: "Compliant again" };
}

export interface StepLogEntry {
  stepId: string;
  name: string;
  type: string;
  ok: boolean;
  detail: string;
  phase?: "recovery";
}

/**
 * Port of `_run_recovery_steps` (main.py:6771) — fires once the workflow's
 * Recovery gate detects the device is no longer violating the linked
 * Compliance Policy. Phase 1: auto-reversal of any already-executed
 * 'Run script' escalation step that had a paired restore script configured.
 * Phase 2: the workflow's own `recovery.steps`, run linearly (no branching).
 */
export async function runRecoverySteps(
  headers: Record<string, string>,
  orgBase: string,
  authorization: string,
  workspaceSlug: string,
  device: WorkflowDeviceRefPayload,
  workflow: { id: string; steps?: WorkflowStepPayload[]; targetDeploymentModel?: string | null; recovery?: unknown },
  executedLog: StepLogEntry[],
  workspaceState: WorkspaceNotificationSettings | null,
): Promise<StepLogEntry[]> {
  const out: StepLogEntry[] = [];
  const context = { device };
  const recoveryCfg = (workflow.recovery as { enabled?: boolean; steps?: WorkflowStepPayload[] }) ?? {};
  const stepsById = new Map<string, WorkflowStepPayload>((workflow.steps ?? []).map((s) => [s.id, s]));

  for (const entry of executedLog) {
    const step = stepsById.get(entry.stepId);
    if (!step || step.type !== "mdm_action") continue;
    const cfg = step.config ?? {};
    if (cfg.action !== "runScript") continue;
    const restoreLibraryId = cfg.params?.restoreLibraryId;
    if (!restoreLibraryId) continue;
    const { ok, detail } = await executeMdmAction(
      headers, orgBase, workspaceSlug, device.platform, device.platformDeviceId, "runScript",
      workflow.targetDeploymentModel, { libraryId: restoreLibraryId }, device.id, context,
    );
    out.push({ stepId: step.id, name: `Restore script for "${step.name || "Run script"}"`, type: "mdm_action", ok, detail, phase: "recovery" });
  }

  for (const step of recoveryCfg.steps ?? []) {
    const stepType = step.type;
    const cfg = step.config ?? {};
    let ok: boolean, detail: string;
    if (stepType === "mdm_action") {
      ({ ok, detail } = await executeMdmAction(
        headers, orgBase, workspaceSlug, device.platform, device.platformDeviceId, cfg.action, workflow.targetDeploymentModel, cfg.params, device.id, context,
      ));
    } else if (stepType === "http_request") {
      ({ ok, detail } = await executeHttpStep(cfg, context));
    } else if (stepType === "notification") {
      ({ ok, detail } = await executeNotificationStep(orgBase, headers, cfg, context, workspaceState));
    } else if (stepType === "policy_replace") {
      ({ ok, detail } = await executePolicyReplaceStep(authorization, workspaceSlug, device, cfg, workflow.id));
    } else if (stepType === "policy_add") {
      ({ ok, detail } = await executePolicyAddStep(authorization, workspaceSlug, device, cfg, workflow.id));
    } else if (stepType === "policy_restore") {
      ({ ok, detail } = await executePolicyRestoreStep(authorization, workspaceSlug, device));
    } else {
      ok = false;
      detail = `Unsupported recovery step type '${stepType}'`;
    }
    out.push({ stepId: step.id, name: step.name, type: stepType, ok, detail, phase: "recovery" });
  }

  return out;
}
