import crypto from "crypto";
import { prisma } from "../../services/prisma";
import { HttpError } from "../../utils/httpError";
import { resolveOrgBase } from "../auth/rbac.service";
import { getAutomationBearer } from "../settings/automationCredential.service";
import { invalidateDevicesCache } from "../devices/devices.service";
import { loadAppListsContext } from "../appLists/appCatalog.service";
import { loadGeofenceZonesById } from "../geofencing/geofence.service";
import { loadDeviceLocations } from "../geofencing/locationsRefresh.service";
import { readInstalledAppsFromStore } from "../appLists/installedApps.service";
import { policyViolated } from "../compliance/complianceEvaluate";
import { executeMdmAction, type WorkflowResumeRef } from "./mdmActionExecutor";
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
import type { WorkflowDeviceRefPayload, WorkflowStepPayload } from "./workflows.schemas";

/**
 * Durable (Postgres-backed) workflow execution engine — port of main.py:
 * 6964-7501 ("DURABLE WORKFLOW ENGINE"). Only used for workflows containing
 * at least one 'wait'/'run_script_wait' step; everything else keeps using
 * the in-memory engine in workflows.service.ts, completely unchanged. A
 * 'wait' step here persists exactly enough to resume — the device snapshot,
 * which step comes next, and the log so far — then returns immediately.
 * workflow_wait_resumer_loop's Node equivalent (resumeDueWorkflowSteps,
 * wired into backgroundJobs.ts) picks resumable rows back up on its own
 * schedule, so a run survives a process restart mid-wait.
 */

export interface WorkflowRow {
  id: string;
  name: string;
  steps: unknown;
  recovery: unknown;
  targetDeploymentModel: string | null;
}

export interface DeviceChainResult {
  deviceId: string;
  deviceName: string | null;
  steps: StepLogEntry[];
  finalStatus: "success" | "partial" | "failed" | null;
  status: "done" | "waiting";
}

export interface DurableRunView {
  id: string;
  workflowId: string;
  workflowName: string | null;
  targetDescription: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  total: number;
  completed: number;
  results: Array<{ deviceId: string; deviceName: string | null; steps: unknown; finalStatus: string | null; status: string }>;
}

const WORKFLOW_RUN_CONCURRENCY = 20;

/** Port of `_pg_upsert_run_result` (main.py:6975-6987) — one row PER DEVICE in a run, upserted on (runId, deviceId). */
export async function upsertRunResult(runId: string, deviceId: string, deviceName: string | null, stepsLog: StepLogEntry[], status: "waiting" | "done", finalStatus: string | null): Promise<void> {
  await prisma.workflowRunResult.upsert({
    where: { runId_deviceId: { runId, deviceId } },
    create: { runId, deviceId, deviceName, steps: stepsLog as any, status, finalStatus },
    update: { deviceName, steps: stepsLog as any, status, finalStatus },
  });
}

/** Port of `_pg_finalize_run_if_done` (main.py:6989-7008) — marks the run 'completed' once every device's result is 'done', and (unlike the original, which keeps a separate append-only completed-runs JSON file) also writes the same `log` blob shape the in-memory engine uses, so getWorkflowRun/gatherWorkflowRuns in workflows.service.ts need no special-casing for a finished durable run. */
export async function finalizeRunIfDone(runId: string): Promise<void> {
  const run = await prisma.workflowRun.findUnique({ where: { id: runId } });
  if (!run || run.status === "completed") return;
  const results = await prisma.workflowRunResult.findMany({ where: { runId } });
  const doneCount = results.filter((r) => r.status === "done").length;
  if (run.total !== null && run.total !== undefined && doneCount >= run.total) {
    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: "completed",
        completedAt: new Date(),
        log: {
          workflowName: run.workflowName,
          total: run.total,
          completed: doneCount,
          results: results.map((r) => ({ deviceId: r.deviceId, deviceName: r.deviceName, steps: r.steps, finalStatus: r.finalStatus })),
        } as any,
      },
    });
  }
}

/** Port of `_persist_pending_step` (main.py:7010-7029). */
async function persistPendingStep(
  runId: string,
  deviceSnapshot: WorkflowDeviceRefPayload,
  workflowId: string,
  slugKey: string,
  nextStepId: string,
  log: StepLogEntry[],
  resumeAt: Date,
  stepKind: "timer" | "script" = "timer",
  onFailureStepId?: string | null,
  pendingToken?: string | null,
): Promise<void> {
  await prisma.workflowPendingStep.create({
    data: {
      runId, deviceSnapshot: deviceSnapshot as any, workflowId, slugKey, nextStepId, log: log as any, resumeAt,
      stepKind, onFailureStepId: onFailureStepId ?? null, pendingToken: pendingToken ?? null,
    },
  });
}

/** Port of `_pg_run_view` (main.py:7031-7083) — reconstructs a run's public view straight from Postgres, since the resumer/reconciler update workflow_run_results directly without any in-memory state. */
export async function runView(runId: string): Promise<DurableRunView | null> {
  const run = await prisma.workflowRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  const resultRows = await prisma.workflowRunResult.findMany({ where: { runId } });

  let completed = 0;
  let anyWaiting = false;
  const results = resultRows.map((r) => {
    if (r.status === "done") completed += 1;
    else if (r.status === "waiting") anyWaiting = true;
    return { deviceId: r.deviceId, deviceName: r.deviceName, steps: r.steps, finalStatus: r.finalStatus, status: r.status };
  });

  let status: string;
  if (run.status === "completed") status = "completed";
  else if (anyWaiting) status = "waiting";
  else if (run.total && completed >= run.total) status = "completed";
  else status = "running";

  return {
    id: run.id, workflowId: run.workflowId, workflowName: run.workflowName, targetDescription: run.targetDescription,
    startedAt: run.startedAt?.toISOString() ?? null, finishedAt: run.completedAt?.toISOString() ?? null,
    status, total: run.total ?? 0, completed, results,
  };
}

/** Port of `_pg_list_open_runs` (main.py:7085-7101) — all not-yet-completed durable runs for a workspace. */
export async function listOpenRuns(workspaceSlug: string): Promise<DurableRunView[]> {
  const rows = await prisma.workflowRun.findMany({ where: { workspaceSlug, status: { not: "completed" } }, orderBy: { startedAt: "desc" } });
  const views: DurableRunView[] = [];
  for (const row of rows) {
    const view = await runView(row.id);
    if (view) views.push(view);
  }
  return views;
}

/**
 * Walk one device's step chain from startStepId (default: the workflow's
 * first step). Used both for a fresh durable run and to resume a device
 * after its persisted 'wait' comes due. Port of `_run_device_step_chain`
 * (main.py:7103-7324).
 */
export async function runDeviceStepChain(
  runId: string,
  workflow: WorkflowRow,
  device: WorkflowDeviceRefPayload,
  authorization: string,
  workspaceSlug: string,
  startStepId?: string | null,
  existingLog?: StepLogEntry[],
): Promise<DeviceChainResult> {
  const slugKey = workspaceSlug || "global";
  const deviceId = device.id;
  const deviceName = device.displayName ?? null;

  const steps = (workflow.steps as WorkflowStepPayload[]) ?? [];
  const stepsById = new Map(steps.map((s) => [s.id, s]));
  const stepOrder = steps.map((s) => s.id);

  if (!steps.length) {
    await upsertRunResult(runId, deviceId, deviceName, [], "done", "success");
    await finalizeRunIfDone(runId);
    return { deviceId, deviceName, steps: [], finalStatus: "success", status: "done" };
  }

  const log: StepLogEntry[] = [...(existingLog ?? [])];

  // Everything below can throw (a Prisma hiccup, an unexpected null, a
  // transient network error not already normalized into an { ok: false }
  // step result by the executeXStep helpers) — previously nothing here
  // caught that: the exception propagated straight out of
  // runDeviceStepChain to whichever of the three callers invoked it
  // (executeWorkflowRunDurable's fire-and-forget launch, resumeOne's timer
  // resume, or resumeWorkflowPendingStepByToken's fast-path resume), and
  // all three call sites only console.error the failure — none of them
  // call upsertRunResult/finalizeRunIfDone for the device that blew up.
  // Since finalizeRunIfDone only flips a WorkflowRun to "completed" once
  // every device has a WorkflowRunResult row, a device that never gets one
  // leaves that run stuck showing "running" in the UI forever, with no
  // System Health alert (that only covers the JOBS heartbeat, not
  // individual runs) and no sweeper anywhere to ever revisit it. Wrapping
  // the chain so an unexpected error still records a "failed" result and
  // finalizes the run turns a silent, permanent stall into a visible,
  // completed-with-a-failed-step outcome — matching how every *expected*
  // failure in this loop already behaves.
  try {
    const workspaceState = await prisma.workspaceState.findUnique({ where: { workspaceSlug: slugKey } });

    const recoveryCfg = (workflow.recovery as { enabled?: boolean; compliancePolicyId?: string | null }) ?? {};
    const recoveryPolicy = recoveryCfg.enabled && recoveryCfg.compliancePolicyId
      ? await prisma.compliancePolicy.findFirst({ where: { workspaceSlug: slugKey, id: recoveryCfg.compliancePolicyId } })
      : null;
    const appLists = recoveryPolicy ? await loadAppListsContext(slugKey) : undefined;
    const geoConditions = (recoveryPolicy?.conditions as any[]) ?? [];
    const geo = geoConditions.some((c) => c?.field === "geofenceZoneId")
      ? { zonesById: await loadGeofenceZonesById(slugKey), locationsByDeviceId: await loadDeviceLocations(slugKey, [deviceId]) }
      : undefined;

    // A resumed chain (startStepId set) may run long after the launching
    // human's session token expired, so it switches to the automation
    // credential. A fresh/live chain still uses the launching request's own
    // token, same as the in-memory engine always has. Port of main.py:7147-7155.
    let credsAuthorization = authorization;
    if (startStepId) {
      const automationBearer = await getAutomationBearer(slugKey);
      if (automationBearer) credsAuthorization = automationBearer;
    }

    const headers = { Authorization: credsAuthorization, "Content-Type": "application/json" };
    const orgBase = await resolveOrgBase(headers, slugKey);

    let currentId: string | null | undefined = startStepId || stepOrder[0];
    let guard = log.length;

    while (currentId && currentId !== "end" && guard < 50) {
      guard++;
      const step = stepsById.get(currentId);
      if (!step) break;

      if (recoveryPolicy) {
        const deviceFull = await getFullDevice(credsAuthorization, slugKey, deviceId, true);
        if (deviceFull) {
          const conditions = (recoveryPolicy.conditions as any[]) ?? [];
          if (conditions.some((c) => ["requiredAppList", "disallowedAppList"].includes(c?.field))) {
            (deviceFull as any).installedApps = await readInstalledAppsFromStore(slugKey, deviceId);
          }
          const stillViolating = policyViolated(deviceFull as any, { conditions, conditionLogic: recoveryPolicy.conditionLogic }, appLists, geo).length > 0;
          if (!stillViolating) {
            const recoveryLog = await runRecoverySteps(headers, orgBase, credsAuthorization, slugKey, device, workflow as any, log, workspaceState as any);
            log.push(...recoveryLog);
            currentId = "end";
            break;
          }
        }
      }

      const context = { device };
      const stepType = step.type;
      const cfg = step.config ?? {};

      if (stepType === "wait") {
        const amountRaw = cfg.amount;
        const unit = cfg.unit || "minutes";
        const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
        if (!Number.isFinite(amount) || amount <= 0) {
          log.push({ stepId: step.id, name: step.name, type: stepType, ok: false, detail: "Invalid wait duration" });
          currentId = step.onFailure || "end";
          continue;
        }
        const secondsPerUnit: Record<string, number> = { minutes: 60, hours: 3600, days: 86400 };
        const seconds = amount * (secondsPerUnit[unit] ?? 60);
        const resumeAt = new Date(Date.now() + seconds * 1000);
        const idx = stepOrder.indexOf(currentId);
        const nextStepId = step.onSuccess ?? (idx + 1 < stepOrder.length ? stepOrder[idx + 1] : "end");
        log.push({ stepId: step.id, name: step.name, type: stepType, ok: true, detail: `Waiting ${amount} ${unit} — resumes at ${resumeAt.toISOString()}` });

        await persistPendingStep(runId, device, workflow.id, slugKey, nextStepId, log, resumeAt);
        await upsertRunResult(runId, deviceId, deviceName, log, "waiting", null);
        return { deviceId, deviceName, steps: log, finalStatus: null, status: "waiting" };
      }

      if (stepType === "run_script_wait") {
        const libraryId = cfg.libraryId;
        let timeoutMinutes = Number(cfg.timeoutMinutes);
        if (!timeoutMinutes || timeoutMinutes <= 0) timeoutMinutes = 30;

        const idx = stepOrder.indexOf(currentId);
        const nextStepId = step.onSuccess ?? (idx + 1 < stepOrder.length ? stepOrder[idx + 1] : "end");
        const failureStepId = step.onFailure || "end";

        if (!libraryId) {
          log.push({ stepId: step.id, name: step.name, type: stepType, ok: false, detail: "No script selected from the Library" });
          currentId = failureStepId;
          continue;
        }

        const pendingToken = crypto.randomUUID();
        const workflowResume: WorkflowResumeRef = { pendingToken, slugKey };
        const { ok, detail } = await executeMdmAction(
          headers, orgBase, slugKey, device.platform, device.platformDeviceId, "runScript",
          workflow.targetDeploymentModel, { libraryId }, deviceId, context, workflowResume,
        );
        if (!ok) {
          log.push({ stepId: step.id, name: step.name, type: stepType, ok: false, detail });
          currentId = failureStepId;
          continue;
        }

        const timeoutAt = new Date(Date.now() + timeoutMinutes * 60_000);
        log.push({ stepId: step.id, name: step.name, type: stepType, ok: true, detail: `Dispatched — waiting up to ${timeoutMinutes} min for the script's actual result before continuing` });
        await persistPendingStep(runId, device, workflow.id, slugKey, nextStepId, log, timeoutAt, "script", failureStepId, pendingToken);
        await upsertRunResult(runId, deviceId, deviceName, log, "waiting", null);
        return { deviceId, deviceName, steps: log, finalStatus: null, status: "waiting" };
      }

      let ok: boolean, detail: string;
      if (stepType === "mdm_action") {
        ({ ok, detail } = await executeMdmAction(headers, orgBase, slugKey, device.platform, device.platformDeviceId, cfg.action, workflow.targetDeploymentModel, cfg.params, deviceId, context));
      } else if (stepType === "http_request") {
        ({ ok, detail } = await executeHttpStep(cfg, context));
      } else if (stepType === "notification") {
        ({ ok, detail } = await executeNotificationStep(orgBase, headers, cfg, context, workspaceState as any));
      } else if (stepType === "policy_replace") {
        ({ ok, detail } = await executePolicyReplaceStep(credsAuthorization, slugKey, device, cfg, workflow.id));
      } else if (stepType === "policy_add") {
        ({ ok, detail } = await executePolicyAddStep(credsAuthorization, slugKey, device, cfg, workflow.id));
      } else if (stepType === "policy_restore") {
        ({ ok, detail } = await executePolicyRestoreStep(credsAuthorization, slugKey, device));
      } else if (stepType === "monitor") {
        ({ ok, detail } = await executeMonitorStep(credsAuthorization, slugKey, device, cfg));
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

    const finalStatus: "success" | "partial" | "failed" = !log.length || log.every((s) => s.ok) ? "success" : log.some((s) => s.ok) ? "partial" : "failed";
    await upsertRunResult(runId, deviceId, deviceName, log, "done", finalStatus);
    await finalizeRunIfDone(runId);
    return { deviceId, deviceName, steps: log, finalStatus, status: "done" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[Workflow Engine] Unexpected error running device ${deviceId}'s step chain (run ${runId}): ${e}`);
    log.push({ stepId: null as any, name: "Workflow engine error", type: "error", ok: false, detail: `Unexpected error — this device's chain was stopped and marked failed: ${message}`.slice(0, 500) });
    await upsertRunResult(runId, deviceId, deviceName, log, "done", "failed").catch(() => undefined);
    await finalizeRunIfDone(runId).catch(() => undefined);
    return { deviceId, deviceName, steps: log, finalStatus: "failed", status: "done" };
  }
}

/**
 * Port of `_execute_workflow_run_durable` (main.py:7326-7358). Unlike the
 * original (which INSERTs the workflow_runs row itself, here on the
 * background task), the WorkflowRun row is created synchronously by
 * launchWorkflowRun (workflows.service.ts) before this is even scheduled —
 * so a client polling GET .../runs/{id} immediately after launch always
 * finds a row, no race window.
 */
export async function executeWorkflowRunDurable(
  runId: string,
  workflow: WorkflowRow,
  devices: WorkflowDeviceRefPayload[],
  authorization: string,
  workspaceSlug: string,
): Promise<void> {
  const slugKey = workspaceSlug || "global";

  let cursor = 0;
  const worker = async () => {
    while (cursor < devices.length) {
      const myIndex = cursor++;
      await runDeviceStepChain(runId, workflow, devices[myIndex], authorization, slugKey);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKFLOW_RUN_CONCURRENCY, devices.length) }, worker));

  await finalizeRunIfDone(runId);
  invalidateDevicesCache(slugKey); // a step may have changed tags/segment/state
}

interface ClaimedPendingRow {
  id: string;
  runId: string;
  deviceSnapshot: WorkflowDeviceRefPayload;
  workflowId: string;
  slugKey: string;
  nextStepId: string;
  log: StepLogEntry[];
  stepKind: string;
  onFailureStepId: string | null;
}

/**
 * Claims due rows from WorkflowPendingStep (resumeAt <= now(), unclaimed)
 * with FOR UPDATE SKIP LOCKED, so this can safely be called concurrently.
 * Port of `_resume_due_workflow_steps` (main.py:7416-7500).
 */
export async function resumeDueWorkflowSteps(limit = 50): Promise<number> {
  const rows = await prisma.$queryRaw<ClaimedPendingRow[]>`
    UPDATE "WorkflowPendingStep"
    SET "claimedAt" = now()
    WHERE id IN (
      SELECT id FROM "WorkflowPendingStep"
      WHERE "resumeAt" <= now() AND "claimedAt" IS NULL
      ORDER BY "resumeAt"
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, "runId", "deviceSnapshot", "workflowId", "slugKey", "nextStepId", log, "stepKind", "onFailureStepId"
  `;

  if (!rows.length) return 0;

  const workflowsCache = new Map<string, WorkflowRow | null>();

  // Pending device resumes blocked this tick — a missing/expired Automation
  // Credential (each already recorded clearly on the specific run's own log
  // below, so an admin looking at that one run understands why) or an
  // unexpected error resuming the chain. Previously these never propagated
  // past this function at all: resumeDueWorkflowSteps() always resolved
  // once Promise.all(rows.map(resumeOne)) settled, so runJobOnce recorded a
  // plain "ok" heartbeat for workflow_wait_resumer even on a tick where
  // every single resume failed. Collected and thrown at the end so it
  // surfaces in Settings > System Health too, not just the individual run.
  const blocked: string[] = [];

  async function resumeOne(row: ClaimedPendingRow): Promise<void> {
    const { runId, slugKey, deviceSnapshot, workflowId } = row;
    const log = row.log ?? [];
    const isScriptKind = row.stepKind === "script";
    // A step_kind='script' row only ever reaches this timer-based path when
    // scriptLogReconciler never resolved it in time (it deletes the row
    // itself the moment it resolves) — so getting here always means "timed
    // out", and the target is the failure branch, not the success one
    // nextStepId points to.
    const targetStepId = isScriptKind ? (row.onFailureStepId || "end") : row.nextStepId;
    const stepLabel = isScriptKind ? "run_script_wait" : "wait";

    const authorization = (await getAutomationBearer(slugKey)) || "";

    const cacheKey = `${slugKey}:${workflowId}`;
    if (!workflowsCache.has(cacheKey)) {
      const w = await prisma.workflow.findFirst({ where: { workspaceSlug: slugKey, id: workflowId } });
      workflowsCache.set(cacheKey, w as unknown as WorkflowRow | null);
    }
    const workflow = workflowsCache.get(cacheKey) ?? null;

    try {
      if (!workflow) {
        log.push({ stepId: null as any, name: "Resume", type: stepLabel, ok: false, detail: "Linked workflow no longer exists" });
        await upsertRunResult(runId, deviceSnapshot.id, deviceSnapshot.displayName ?? null, log, "done", "failed");
        await finalizeRunIfDone(runId);
      } else if (!authorization) {
        log.push({ stepId: null as any, name: "Resume", type: stepLabel, ok: false, detail: "No automation credential is configured for this workspace — cannot resume without one. Configure one from Settings." });
        await upsertRunResult(runId, deviceSnapshot.id, deviceSnapshot.displayName ?? null, log, "done", "failed");
        await finalizeRunIfDone(runId);
        blocked.push(`${slugKey} (run ${runId}: no Automation Credential configured)`);
      } else {
        if (isScriptKind) {
          log.push({ stepId: null as any, name: "Script result", type: stepLabel, ok: false, detail: "No script result received before the timeout — following the failure branch" });
        }
        const result = await runDeviceStepChain(runId, workflow, deviceSnapshot, authorization, slugKey, targetStepId, log);
        if (result.status === "done") invalidateDevicesCache(slugKey);
      }
    } catch (e) {
      console.error(`[Workflow Resumer] Error resuming run ${runId} / device ${deviceSnapshot.id}: ${e}`);
      blocked.push(`${slugKey} (run ${runId}: ${e instanceof Error ? e.message : String(e)})`.slice(0, 150));
    } finally {
      await prisma.workflowPendingStep.delete({ where: { id: row.id } }).catch(() => undefined);
    }
  }

  await Promise.all(rows.map(resumeOne));

  if (blocked.length) {
    throw new HttpError(
      502,
      `${blocked.length} pending workflow step(s) could not resume this tick: ${blocked.join("; ")}`.slice(0, 500),
    );
  }

  return rows.length;
}

/**
 * Called from scriptLogReconciler.ts the moment a tracking entry created by
 * a 'run_script_wait' step resolves (success/failure/gave up unconfirmed) —
 * resumes that device's parked chain down whichever branch matches, well
 * before the timer-based fallback in resumeDueWorkflowSteps would otherwise
 * catch it at its timeout deadline. A safe no-op if the pending row is
 * already gone. Port of `_resume_workflow_pending_step_by_token`
 * (main.py:7502-7554).
 */
export async function resumeWorkflowPendingStepByToken(resumeInfo: WorkflowResumeRef | null | undefined, outcomeOk: boolean, extraDetail = ""): Promise<void> {
  const token = resumeInfo?.pendingToken;
  if (!token) return;

  const rows = await prisma.$queryRaw<ClaimedPendingRow[]>`
    DELETE FROM "WorkflowPendingStep" WHERE "pendingToken" = ${token}
    RETURNING id, "runId", "deviceSnapshot", "workflowId", "slugKey", "nextStepId", "onFailureStepId", log
  `;
  const row = rows[0];
  if (!row) return;

  const { runId, slugKey, deviceSnapshot, workflowId } = row;
  const log = row.log ?? [];
  const targetStepId = outcomeOk ? row.nextStepId : (row.onFailureStepId || "end");
  log.push({
    stepId: null as any, name: "Script result", type: "run_script_wait", ok: outcomeOk,
    detail: extraDetail || (outcomeOk ? "Script completed successfully — resuming" : "Script failed — following the failure branch"),
  });

  const workflow = await prisma.workflow.findFirst({ where: { workspaceSlug: slugKey, id: workflowId } });
  if (!workflow) {
    log.push({ stepId: null as any, name: "Resume", type: "run_script_wait", ok: false, detail: "Linked workflow no longer exists" });
    await upsertRunResult(runId, deviceSnapshot.id, deviceSnapshot.displayName ?? null, log, "done", "failed");
    await finalizeRunIfDone(runId);
    return;
  }

  const authorization = (await getAutomationBearer(slugKey)) || "";
  if (!authorization) {
    log.push({ stepId: null as any, name: "Resume", type: "run_script_wait", ok: false, detail: "No automation credential is configured for this workspace — cannot resume without one. Configure one from Settings." });
    await upsertRunResult(runId, deviceSnapshot.id, deviceSnapshot.displayName ?? null, log, "done", "failed");
    await finalizeRunIfDone(runId);
    return;
  }

  try {
    const result = await runDeviceStepChain(runId, workflow as unknown as WorkflowRow, deviceSnapshot, authorization, slugKey, targetStepId, log);
    if (result.status === "done") invalidateDevicesCache(slugKey);
  } catch (e) {
    console.error(`[Script Wait Resume] Error resuming run ${runId} / device ${deviceSnapshot.id}: ${e}`);
  }
}
