import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { resolveOrgBase } from "../auth/rbac.service";
import { invalidateDevicesCache } from "../devices/devices.service";
import { MDM_ACTIONS } from "../devices/mdmActions";
import { loadAppListsContext } from "../appLists/appCatalog.service";
import { loadGeofenceZonesById } from "../geofencing/geofence.service";
import { loadDeviceLocations } from "../geofencing/locationsRefresh.service";
import { readInstalledAppsFromStore } from "../appLists/installedApps.service";
import { policyViolated } from "../compliance/complianceEvaluate";
import { executeMdmAction } from "./mdmActionExecutor";
import {
  executeHttpStep,
  executeMonitorStep,
  executeNotificationStep,
  executePolicyAddStep,
  executePolicyReplaceStep,
  executePolicyRestoreStep,
  getFullDevice,
  runRecoverySteps,
  type StepLogEntry,
} from "./workflowSteps";
import { renderTemplate } from "./templateRender";
import type { WorkflowDeviceRefPayload, WorkflowPayload, WorkflowStepPayload } from "./workflows.schemas";
import { executeWorkflowRunDurable, runView as durableRunView, listOpenRuns, type DurableRunView } from "./durableEngine";

/**
 * Workflow CRUD + version history/restore + dry-run + the in-memory
 * (synchronous, no Postgres wait-state) execution engine — Phase 4a — plus
 * the durable-engine dispatch wiring — Phase 4b. Port of main.py:6113-6962,
 * 7360-7412/7576-7611, and the `_execute_workflow_run` dispatcher
 * (main.py:7360-7369).
 */

// ── Shared helper (also used by compliance.service.ts's autoRun destructive-ack gate) ──

/** Port of `_workflow_has_destructive_step` (main.py:10658). */
export function workflowHasDestructiveStep(workflow: { steps: unknown } | null | undefined): boolean {
  if (!workflow) return false;
  for (const step of (workflow.steps as any[]) ?? []) {
    if (step?.type === "mdm_action") {
      const actionKey = step?.config?.action;
      if (actionKey && MDM_ACTIONS[actionKey]?.destructive) return true;
    }
  }
  return false;
}

// ── CRUD (main.py:6289-6335) ──

export async function listWorkflows(workspaceSlug: string) {
  return prisma.workflow.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
}

export async function createWorkflow(workspaceSlug: string, payload: WorkflowPayload, actorEmail: string) {
  const created = await prisma.workflow.create({
    data: {
      workspaceSlug,
      name: payload.name,
      description: payload.description ?? "",
      steps: payload.steps as any,
      targetPlatform: payload.targetPlatform ?? null,
      targetDeploymentModel: payload.targetDeploymentModel ?? null,
      recovery: payload.recovery as any,
      allowUnattendedDestructive: payload.allowUnattendedDestructive,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "workflow", action: "workflow_created", actor: actorEmail,
    targetType: "workflow", targetId: created.id, targetName: created.name,
    message: `Workflow "${created.name}" created`,
  });
  return created;
}

const WORKFLOW_VERSION_FIELDS = ["name", "description", "steps", "targetPlatform", "targetDeploymentModel", "recovery"] as const;
const WORKFLOW_VERSION_CAP = 50;

/** Port of `_snapshot_workflow_version` (main.py:6167) — capped at 50 most-recent versions per workflow (an undo/audit aid, not a permanent archive). */
async function snapshotWorkflowVersion(
  workflow: Record<string, unknown> & { id: string },
  reason: "update" | "restore",
  actor: string | null,
): Promise<void> {
  const definition: Record<string, unknown> = {};
  for (const field of WORKFLOW_VERSION_FIELDS) definition[field] = workflow[field];
  await prisma.workflowVersion.create({
    data: { workflowId: workflow.id, reason, createdBy: actor, snapshot: definition as any },
  });
  const existing = await prisma.workflowVersion.findMany({ where: { workflowId: workflow.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (existing.length > WORKFLOW_VERSION_CAP) {
    const dropIds = existing.slice(WORKFLOW_VERSION_CAP).map((v) => v.id);
    await prisma.workflowVersion.deleteMany({ where: { id: { in: dropIds } } });
  }
}

export async function updateWorkflow(workspaceSlug: string, workflowId: string, payload: WorkflowPayload, actorEmail: string) {
  const existing = await prisma.workflow.findFirst({ where: { workspaceSlug, id: workflowId } });
  if (!existing) throw new HttpError(404, "Workflow not found");
  // Snapshot the pre-update definition before it's overwritten.
  await snapshotWorkflowVersion(existing, "update", actorEmail);

  const updated = await prisma.workflow.update({
    where: { id: workflowId },
    data: {
      name: payload.name,
      description: payload.description ?? "",
      steps: payload.steps as any,
      targetPlatform: payload.targetPlatform ?? null,
      targetDeploymentModel: payload.targetDeploymentModel ?? null,
      recovery: payload.recovery as any,
      allowUnattendedDestructive: payload.allowUnattendedDestructive,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "workflow", action: "workflow_updated", actor: actorEmail,
    targetType: "workflow", targetId: workflowId, targetName: updated.name,
    message: `Workflow "${updated.name}" updated`,
  });
  return updated;
}

export async function deleteWorkflow(workspaceSlug: string, workflowId: string, actorEmail: string) {
  const deleted = await prisma.workflow.findFirst({ where: { workspaceSlug, id: workflowId } });
  if (deleted) {
    await prisma.workflow.delete({ where: { id: workflowId } }); // cascades WorkflowVersion rows (schema.prisma)
    await recordAuditEvent(workspaceSlug, {
      category: "workflow", action: "workflow_deleted", actor: actorEmail, severity: "warning",
      targetType: "workflow", targetId: workflowId, targetName: deleted.name,
      message: `Workflow "${deleted.name}" deleted`,
    });
  }
  return { status: "ok" };
}

// ── Versions (main.py:6337-6372) ──

export async function listWorkflowVersions(workflowId: string) {
  return prisma.workflowVersion.findMany({ where: { workflowId }, orderBy: { createdAt: "desc" } });
}

export async function getWorkflowVersion(workflowId: string, versionId: string) {
  const version = await prisma.workflowVersion.findFirst({ where: { id: versionId, workflowId } });
  if (!version) throw new HttpError(404, "Version not found");
  return version;
}

export async function restoreWorkflowVersion(workspaceSlug: string, workflowId: string, versionId: string, actorEmail: string) {
  const workflow = await prisma.workflow.findFirst({ where: { workspaceSlug, id: workflowId } });
  if (!workflow) throw new HttpError(404, "Workflow not found");
  const version = await prisma.workflowVersion.findFirst({ where: { id: versionId, workflowId } });
  if (!version) throw new HttpError(404, "Version not found");

  // Snapshot the current (pre-restore) state too, so restoring is itself undoable via the same version list.
  await snapshotWorkflowVersion(workflow, "restore", actorEmail);

  const def = version.snapshot as any;
  const restored = await prisma.workflow.update({
    where: { id: workflowId },
    data: {
      name: def.name, description: def.description ?? "", steps: def.steps as any,
      targetPlatform: def.targetPlatform ?? null, targetDeploymentModel: def.targetDeploymentModel ?? null,
      recovery: def.recovery as any,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "workflow", action: "workflow_version_restored", actor: actorEmail,
    targetType: "workflow", targetId: workflowId, targetName: restored.name,
    message: `Workflow "${restored.name}" restored to a previous version`,
  });
  return restored;
}

// ── Dry run (main.py:6374-6497) ──

export interface DryRunStepPreview {
  stepId: string;
  name: string;
  type: string;
  summary: string;
  onSuccessStepId: string;
  onSuccessLabel: string;
  onFailureStepId: string;
  onFailureLabel: string;
}

export interface DryRunResult {
  workflowId: string;
  workflowName: string;
  device: { id: string; displayName?: string | null };
  steps: DryRunStepPreview[];
  recoverySteps: Array<{ stepId: string; name: string; type: string; summary: string }> | null;
  note: string;
}

const SAMPLE_DRY_RUN_DEVICE: Record<string, unknown> = {
  id: "sample-device", displayName: "Sample Device", platform: "apple",
  platformDeviceId: "sample-platform-id", serialNumber: "SAMPLESERIAL01", osVersion: "18.0",
  manufacturer: "Apple", model: "iPhone 15", udid: "SAMPLE-UDID-0000",
  mdmUser: { email: "jane.doe@example.com", firstName: "Jane", lastName: "Doe" },
};

/**
 * Safe, read-only preview of a workflow's step chain for a single device.
 * Never calls Applivery, never touches the execution engine — a standalone
 * function rather than threading a `dryRun` flag through the real engine.
 * Port of `_dry_run_workflow` (main.py:6374). Since no step is actually
 * executed, dry-run has no real "did it succeed" signal, so it always walks
 * the assumed-SUCCESS branch; both onSuccess/onFailure targets are still
 * surfaced per step so branching is visible to whoever reviews the preview.
 */
export function dryRunWorkflow(workflow: { id: string; name: string; steps: unknown; recovery: unknown }, deviceDict?: Record<string, unknown> | null): DryRunResult {
  const device = deviceDict ?? SAMPLE_DRY_RUN_DEVICE;
  const steps = (workflow.steps as WorkflowStepPayload[]) ?? [];
  const stepsById = new Map(steps.map((s) => [s.id, s]));
  const stepOrder = steps.map((s) => s.id);
  const context = { device };

  const render = (value: unknown): string => {
    if (!value) return value as string;
    try {
      return renderTemplate(String(value), context);
    } catch {
      return String(value);
    }
  };

  function describeStep(step: WorkflowStepPayload): string {
    const stepType = step.type;
    const config = step.config ?? {};
    if (stepType === "mdm_action") {
      const actionKey = config.action;
      const actionMeta = MDM_ACTIONS[actionKey] ?? ({} as any);
      let summary = actionMeta.label || actionKey || "Unknown action";
      const params: Record<string, unknown> = config.params ?? {};
      const entries = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "");
      if (entries.length) summary += " — " + entries.map(([k, v]) => `${k}: ${render(v)}`).join(", ");
      return summary;
    }
    if (stepType === "http_request") {
      const method = String(config.method || "POST").toUpperCase();
      return `${method} ${render(config.url || "")}`;
    }
    if (stepType === "notification") {
      const channel = config.channel || "webhook";
      const target = config.target;
      let label = `Send ${channel} notification` + (target ? ` to ${target}` : "");
      const message = render(config.message || "");
      if (message) {
        const trimmed = message.length <= 120 ? message : message.slice(0, 120) + "…";
        label += `: "${trimmed}"`;
      }
      return label;
    }
    if (stepType === "policy_replace") {
      const names: string[] = config.policyNames ?? ((config.policies ?? []) as any[]).filter((p) => p && typeof p === "object").map((p) => p.name);
      return names?.length ? `Replace active policies with: ${names.join(", ")}` : "Replace active policies";
    }
    if (stepType === "policy_add") {
      const names: string[] = config.policyNames ?? ((config.policies ?? []) as any[]).filter((p) => p && typeof p === "object").map((p) => p.name);
      return names?.length ? `Add polic${names.length === 1 ? "y" : "ies"}: ${names.join(", ")}` : "Add a policy";
    }
    if (stepType === "policy_restore") return "Restore this device's previously-quarantined policies";
    if (stepType === "monitor") {
      const attr = config.attribute || config.smartAttributeName || config.name;
      return attr ? `Monitor for: ${attr}` : "Monitor device state";
    }
    if (stepType === "wait") return `Wait ${config.amount} ${config.unit || "minutes"}`;
    if (stepType === "run_script_wait") {
      const scriptName = config.scriptName || config.assetName;
      return `Run script${scriptName ? ": " + scriptName : ""} and wait for its result`;
    }
    return `Unrecognized step type '${stepType}'`;
  }

  function targetLabel(stepId: string | null | undefined): string {
    if (!stepId || stepId === "end") return "End";
    const targetStep = stepsById.get(stepId);
    return targetStep?.name || stepId;
  }

  const preview: DryRunStepPreview[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = stepOrder[0] ?? "end";
  let guard = 0;
  while (currentId && currentId !== "end" && guard < 50) {
    guard++;
    const step = stepsById.get(currentId);
    if (!step || visited.has(currentId)) break;
    visited.add(currentId);
    const idx = stepOrder.indexOf(currentId);
    const defaultNext = idx + 1 < stepOrder.length ? stepOrder[idx + 1] : "end";
    const resolvedSuccess = step.onSuccess ?? defaultNext;
    const onFailure = step.onFailure || "end";

    preview.push({
      stepId: step.id, name: step.name, type: step.type, summary: describeStep(step),
      onSuccessStepId: resolvedSuccess, onSuccessLabel: targetLabel(resolvedSuccess),
      onFailureStepId: onFailure, onFailureLabel: targetLabel(onFailure),
    });
    currentId = resolvedSuccess;
  }

  const recoveryCfg = (workflow.recovery as { enabled?: boolean; steps?: WorkflowStepPayload[] }) ?? {};
  const recoveryPreview = recoveryCfg.enabled
    ? (recoveryCfg.steps ?? []).map((s) => ({ stepId: s.id, name: s.name, type: s.type, summary: describeStep(s) }))
    : null;

  return {
    workflowId: workflow.id,
    workflowName: workflow.name,
    device: { id: String(device.id ?? ""), displayName: (device as any).displayName ?? null },
    steps: preview,
    recoverySteps: recoveryPreview,
    note: "Dry run — no real actions were executed. Each step assumes it succeeds; onFailure targets are shown for reference only.",
  };
}

// ── Execution engine (main.py:6610-6962) — in-memory only; no 'wait' support (Phase 4b) ──

const WORKFLOW_RUN_CONCURRENCY = 20;

export interface DeviceRunResult {
  deviceId: string;
  deviceName?: string | null;
  steps: StepLogEntry[];
  finalStatus: "success" | "partial" | "failed";
}

interface ActiveRun {
  id: string;
  workspaceSlug: string;
  workflowId: string;
  workflowName: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed";
  total: number;
  completed: number;
  results: DeviceRunResult[];
  targetDescription: string | null;
}

export interface PublicRunView {
  id: string;
  workflowId: string;
  workflowName: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  total: number;
  completed: number;
  results: DeviceRunResult[];
  targetDescription: string | null;
}

// In-memory while a run is executing — the frontend polls GET .../runs/{id}
// until status flips to "completed"; only the finished record is written to
// Postgres once, to avoid write amplification on every device completion.
// Port of `_active_runs` (main.py:6621).
const activeRuns = new Map<string, ActiveRun>();

function publicRunView(run: ActiveRun): PublicRunView {
  return {
    id: run.id, workflowId: run.workflowId, workflowName: run.workflowName,
    startedAt: run.startedAt, finishedAt: run.finishedAt ?? null, status: run.status,
    total: run.total, completed: run.completed, results: run.results, targetDescription: run.targetDescription,
  };
}

interface WorkflowRow {
  id: string;
  name: string;
  steps: unknown;
  recovery: unknown;
  targetDeploymentModel: string | null;
}

function durableViewToPublicRun(view: DurableRunView, targetDescriptionOverride?: string | null): PublicRunView {
  return {
    id: view.id, workflowId: view.workflowId, workflowName: view.workflowName ?? "",
    startedAt: view.startedAt ?? "", finishedAt: view.finishedAt, status: view.status,
    total: view.total, completed: view.completed, results: view.results as unknown as DeviceRunResult[],
    targetDescription: targetDescriptionOverride !== undefined ? targetDescriptionOverride : view.targetDescription,
  };
}

/**
 * Create a run record and schedule its execution in the background (fire-
 * and-forget — the caller's HTTP request returns immediately regardless of
 * fleet size). Port of `_launch_workflow_run` (main.py:7371) plus the
 * `_execute_workflow_run` dispatcher (main.py:7360-7369): workflows with a
 * 'wait'/'run_script_wait' step go through the durable (Postgres-backed)
 * engine; everything else uses the original fully in-memory engine.
 */
export async function launchWorkflowRun(
  workflow: WorkflowRow,
  devices: WorkflowDeviceRefPayload[],
  authorization: string,
  workspaceSlug: string,
  targetDescription?: string | null,
): Promise<PublicRunView | null> {
  const steps = (workflow.steps as WorkflowStepPayload[]) ?? [];
  const hasWait = steps.some((s) => s.type === "wait" || s.type === "run_script_wait");

  if (hasWait) {
    const runId = crypto.randomUUID();
    await prisma.workflowRun.create({
      data: {
        id: runId, workspaceSlug, workflowId: workflow.id, workflowName: workflow.name,
        targetDescription: targetDescription ?? null, status: "running", total: devices.length,
        startedAt: new Date(),
      },
    });
    void executeWorkflowRunDurable(runId, workflow, devices, authorization, workspaceSlug).catch((e) => {
      console.error(`[Workflows] Durable run ${runId} crashed: ${e}`);
    });
    const view = await durableRunView(runId);
    return view ? durableViewToPublicRun(view) : null;
  }

  const runId = crypto.randomUUID();
  const run: ActiveRun = {
    id: runId, workspaceSlug, workflowId: workflow.id, workflowName: workflow.name,
    startedAt: new Date().toISOString(), status: "running", total: devices.length, completed: 0,
    results: [], targetDescription: targetDescription ?? null,
  };
  activeRuns.set(runId, run);
  void executeWorkflowRun(run, workflow, devices, authorization, workspaceSlug).catch((e) => {
    console.error(`[Workflows] Run ${runId} crashed: ${e}`);
    run.status = "completed";
    run.finishedAt = new Date().toISOString();
  });
  return publicRunView(run);
}

/** Port of `_execute_workflow_run_in_memory` (main.py:6835) — unchanged core logic, adapted to Postgres-backed policy quarantine instead of an in-memory dict (see workflowSteps.ts's snapshot helpers, which persist the same way the original's JSON-file quarantine store did — across runs, keyed by device id). */
async function executeWorkflowRun(
  run: ActiveRun,
  workflow: WorkflowRow,
  devices: WorkflowDeviceRefPayload[],
  authorization: string,
  workspaceSlug: string,
): Promise<void> {
  const steps = (workflow.steps as WorkflowStepPayload[]) ?? [];
  const stepsById = new Map(steps.map((s) => [s.id, s]));
  const stepOrder = steps.map((s) => s.id);

  // "global", not workspaceSlug — Settings > General/SMTP/Notifications
  // Webhook URL is a single deployment-wide config (dashboardState.ts's
  // GLOBAL_HEADERS convention: the frontend always saves it under the
  // "global" WorkspaceState row, never per-workspace), which is what a
  // 'notification' step's email/webhook channel reads below. Looking this
  // up under the real workspaceSlug returned null for any workspace not
  // literally named "global" — a notification step silently did nothing
  // (no error, `ok:false` swallowed into "SMTP not configured") in every
  // real multi-workspace deployment. Same fix as services/alertEmail.ts.
  const workspaceState = await prisma.workspaceState.findUnique({ where: { workspaceSlug: "global" } });

  // The workflow's Recovery gate — resolved once per run, not per device.
  const recoveryCfg = (workflow.recovery as { enabled?: boolean; compliancePolicyId?: string | null }) ?? {};
  const recoveryPolicy = recoveryCfg.enabled && recoveryCfg.compliancePolicyId
    ? await prisma.compliancePolicy.findFirst({ where: { workspaceSlug, id: recoveryCfg.compliancePolicyId } })
    : null;
  const appLists = recoveryPolicy ? await loadAppListsContext(workspaceSlug) : undefined;
  // Same "resolved once per run, not per device" treatment as appLists —
  // loads every device in this run's location in one pass rather than
  // per-device inside runForDevice below.
  const recoveryConditions = (recoveryPolicy?.conditions as any[]) ?? [];
  const geo = recoveryConditions.some((c) => c?.field === "geofenceZoneId")
    ? { zonesById: await loadGeofenceZonesById(workspaceSlug), locationsByDeviceId: await loadDeviceLocations(workspaceSlug, devices.map((d) => d.id)) }
    : undefined;

  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);

  async function runForDevice(device: WorkflowDeviceRefPayload): Promise<DeviceRunResult> {
    if (!steps.length) return { deviceId: device.id, deviceName: device.displayName, steps: [], finalStatus: "success" };

    const log: StepLogEntry[] = [];
    let currentId: string | null | undefined = stepOrder[0] ?? "end";
    let guard = 0;

    while (currentId && currentId !== "end" && guard < 50) {
      guard++;
      const step = stepsById.get(currentId);
      if (!step) break;

      // Recovery gate — checked before every escalation step (including the
      // first), on fresh device data. The instant the device no longer
      // violates the linked Compliance Policy, escalation stops for good and
      // Recovery takes over instead.
      if (recoveryPolicy) {
        const deviceFull = await getFullDevice(authorization, workspaceSlug, device.id, true);
        if (deviceFull) {
          const conditions = (recoveryPolicy.conditions as any[]) ?? [];
          if (conditions.some((c) => ["requiredAppList", "disallowedAppList"].includes(c?.field))) {
            (deviceFull as any).installedApps = await readInstalledAppsFromStore(workspaceSlug, device.id);
          }
          const stillViolating = policyViolated(deviceFull as any, { conditions, conditionLogic: recoveryPolicy.conditionLogic }, appLists, geo).length > 0;
          if (!stillViolating) {
            const recoveryLog = await runRecoverySteps(headers, orgBase, authorization, workspaceSlug, device, workflow as any, log, workspaceState as any);
            log.push(...recoveryLog);
            break;
          }
        }
      }

      const context = { device };
      const stepType = step.type;
      const cfg = step.config ?? {};
      let ok: boolean, detail: string;
      if (stepType === "mdm_action") {
        ({ ok, detail } = await executeMdmAction(headers, orgBase, workspaceSlug, device.platform, device.platformDeviceId, cfg.action, workflow.targetDeploymentModel, cfg.params, device.id, context));
      } else if (stepType === "http_request") {
        ({ ok, detail } = await executeHttpStep(cfg, context));
      } else if (stepType === "notification") {
        ({ ok, detail } = await executeNotificationStep(orgBase, headers, cfg, context, workspaceState as any));
      } else if (stepType === "policy_replace") {
        ({ ok, detail } = await executePolicyReplaceStep(authorization, workspaceSlug, device, cfg, workflow.id));
      } else if (stepType === "policy_add") {
        ({ ok, detail } = await executePolicyAddStep(authorization, workspaceSlug, device, cfg, workflow.id));
      } else if (stepType === "policy_restore") {
        ({ ok, detail } = await executePolicyRestoreStep(authorization, workspaceSlug, device));
      } else if (stepType === "monitor") {
        ({ ok, detail } = await executeMonitorStep(authorization, workspaceSlug, device, cfg));
      } else if (stepType === "wait" || stepType === "run_script_wait") {
        // Should never be reached — launchWorkflowRun routes any workflow
        // with a wait step to the durable engine (Phase 4b) and refuses
        // (returns null) otherwise. Fail loudly rather than silently
        // skipping the wait if that routing is ever bypassed.
        ok = false;
        detail = "Wait steps require the durable engine and cannot run here";
      } else {
        ok = false;
        detail = `Unknown step type '${stepType}'`;
      }

      log.push({ stepId: step.id, name: step.name, type: stepType, ok, detail });

      let next: string | null | undefined;
      if (ok) {
        next = step.onSuccess;
        if (next === null || next === undefined) {
          const idx = stepOrder.indexOf(currentId);
          next = idx + 1 < stepOrder.length ? stepOrder[idx + 1] : "end";
        }
      } else {
        next = step.onFailure || "end";
      }
      currentId = next;
    }

    const finalStatus: DeviceRunResult["finalStatus"] = !log.length || log.every((s) => s.ok) ? "success" : log.some((s) => s.ok) ? "partial" : "failed";
    return { deviceId: device.id, deviceName: device.displayName ?? null, steps: log, finalStatus };
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < devices.length) {
      const myIndex = cursor++;
      const result = await runForDevice(devices[myIndex]);
      run.results.push(result);
      run.completed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKFLOW_RUN_CONCURRENCY, devices.length) }, worker));

  run.status = "completed";
  run.finishedAt = new Date().toISOString();

  await prisma.workflowRun.create({
    data: {
      id: run.id,
      workspaceSlug,
      workflowId: run.workflowId,
      targetDescription: run.targetDescription,
      status: run.status,
      log: { workflowName: run.workflowName, total: run.total, completed: run.completed, results: run.results } as any,
      startedAt: new Date(run.startedAt),
      completedAt: new Date(run.finishedAt),
    },
  });
  invalidateDevicesCache(workspaceSlug); // a step may have changed tags/segment/state
  activeRuns.delete(run.id);
}

// ── Run history (main.py:6534-6608) ──

function rowToPublicRun(row: { id: string; workflowId: string; targetDescription: string | null; status: string; log: unknown; startedAt: Date; completedAt: Date | null }): PublicRunView {
  const log = (row.log as { workflowName?: string; total?: number; completed?: number; results?: DeviceRunResult[] }) ?? {};
  return {
    id: row.id, workflowId: row.workflowId, workflowName: log.workflowName ?? "", startedAt: row.startedAt.toISOString(),
    finishedAt: row.completedAt ? row.completedAt.toISOString() : null, status: row.status,
    total: log.total ?? 0, completed: log.completed ?? 0, results: log.results ?? [], targetDescription: row.targetDescription,
  };
}

/**
 * Port of `_gather_workflow_runs` (main.py:6534) — combines still-running
 * in-memory runs (Phase 4a engine) with still-open durable runs (Phase 4b
 * engine, via `listOpenRuns`'s Postgres read) and persisted/finalized
 * history, de-duped by id.
 */
async function gatherWorkflowRuns(workspaceSlug: string): Promise<PublicRunView[]> {
  const inProgress = Array.from(activeRuns.values())
    .filter((r) => r.workspaceSlug === workspaceSlug && r.status === "running")
    .map(publicRunView);

  const durableOpen = (await listOpenRuns(workspaceSlug)).map((v) => durableViewToPublicRun(v));

  const open = [...inProgress, ...durableOpen].sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
  const openIds = new Set(open.map((r) => r.id));

  const rows = await prisma.workflowRun.findMany({ where: { workspaceSlug, log: { not: Prisma.DbNull } }, orderBy: { startedAt: "desc" } });
  const history = rows.filter((r) => !openIds.has(r.id)).map(rowToPublicRun);

  return [...open, ...history];
}

export async function listWorkflowRuns(workspaceSlug: string, limit: number, dateFrom?: string | null, dateTo?: string | null) {
  let combined = await gatherWorkflowRuns(workspaceSlug);
  if (dateFrom) combined = combined.filter((r) => (r.startedAt || "") >= dateFrom);
  if (dateTo) combined = combined.filter((r) => (r.startedAt || "") <= dateTo);
  return { items: combined.slice(0, limit), total: combined.length };
}

export async function exportWorkflowRunsCsv(workspaceSlug: string, dateFrom?: string | null, dateTo?: string | null): Promise<string> {
  let combined = await gatherWorkflowRuns(workspaceSlug);
  if (dateFrom) combined = combined.filter((r) => (r.startedAt || "") >= dateFrom);
  if (dateTo) combined = combined.filter((r) => (r.startedAt || "") <= dateTo);
  combined = combined.sort((a, b) => (a.startedAt || "").localeCompare(b.startedAt || ""));

  const rows: string[][] = [["Started At", "Finished At", "Workflow", "Status", "Devices Completed", "Devices Total"]];
  for (const r of combined) {
    rows.push([r.startedAt || "", r.finishedAt || "", r.workflowName || "", r.status || "", String(r.completed ?? 0), String(r.total ?? 0)]);
  }
  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export async function getWorkflowRun(workspaceSlug: string, runId: string): Promise<PublicRunView> {
  const active = activeRuns.get(runId);
  if (active) return publicRunView(active);
  const row = await prisma.workflowRun.findFirst({ where: { workspaceSlug, id: runId } });
  if (row) {
    if (row.log) return rowToPublicRun(row);
    // Still-open durable run (Phase 4b) — not yet finalized, so `log` is
    // null; reconstruct the live view from the WorkflowRunResult relation
    // instead (port of `_pg_run_view`, main.py:7031-7083).
    const view = await durableRunView(runId);
    if (view) return durableViewToPublicRun(view);
  }
  throw new HttpError(404, "Run not found");
}
