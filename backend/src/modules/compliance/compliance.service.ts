import { prisma } from "../../services/prisma";
import { HttpError } from "../../utils/httpError";
import { recordAuditEvent } from "../../services/auditLog";
import { appliveryClient } from "../../services/appliveryClient";
import { resolveOrgBase } from "../auth/rbac.service";
import { platformPathSegment, type NormalizedDevice } from "../devices/deviceNormalize";
import { MDM_ACTIONS } from "../devices/mdmActions";
import { policyViolated, type AppListsContext } from "./complianceEvaluate";
import { loadAppListsContext } from "../appLists/appCatalog.service";
import { appListScopedDeviceIds, readInstalledAppsFromStore } from "../appLists/installedApps.service";
import type { CompliancePolicyPayload } from "./compliance.schemas";

/**
 * CompliancePolicy CRUD + the shared evaluation engine — port of
 * main.py:10639-11428 (Pydantic models, CRUD, autoRun circuit breaker,
 * `_run_compliance_evaluation`) plus the violations review queue
 * (main.py:11429-11599, `_approve_violation_core`/`_dismiss_violation_core`
 * and their single/bulk endpoints).
 *
 * Workflow execution (Phase 4) and Case management (Phase 5) don't exist
 * yet in this migration. Rather than fake their behavior, this file queries
 * the REAL (currently-empty) Workflow/Case Prisma tables — so a policy's
 * `workflowId` never resolves to anything yet, which naturally reproduces
 * the original's own "no_workflow" / "Linked workflow no longer exists"
 * codepaths rather than approximating them. `caseId` is always left null
 * with a TODO(Phase5) marker. This is the same code path the original takes
 * once Phase 4/5 land — not a stand-in for it.
 */

// ── Bounds/constants (main.py:10806-10815, 10972, 6620) ──

export const RISK_TIER_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const COMPLIANCE_MIN_EVAL_INTERVAL_MINUTES = 60;
const COMPLIANCE_MAX_EVAL_INTERVAL_MINUTES = 1440;
const AUTORUN_CIRCUIT_BREAKER_THRESHOLD = 3;
const COMPLIANCE_WRITE_CONCURRENCY = 20;

function clampEvalInterval(minutes: number | null | undefined): number | null {
  if (minutes === null || minutes === undefined) return null;
  return Math.max(COMPLIANCE_MIN_EVAL_INTERVAL_MINUTES, Math.min(COMPLIANCE_MAX_EVAL_INTERVAL_MINUTES, Math.trunc(minutes)));
}

/** Port of `_resolve_autorun_batch_cap` (main.py:10644). */
function resolveAutoRunBatchCap(policy: { autoRunBatchCap: number | null }): number | null {
  const raw = policy.autoRunBatchCap;
  if (raw === null || raw === undefined) return null;
  return raw > 0 ? raw : 15;
}

/** Port of `_workflow_has_destructive_step` (main.py:10658). */
function workflowHasDestructiveStep(workflow: { steps: any } | null | undefined): boolean {
  if (!workflow) return false;
  for (const step of (workflow.steps as any[]) ?? []) {
    if (step?.type === "mdm_action") {
      const actionKey = step?.config?.action;
      if (actionKey && MDM_ACTIONS[actionKey]?.destructive) return true;
    }
  }
  return false;
}

// ── CRUD (main.py:10828-10957) ──

export async function listCompliancePolicies(workspaceSlug: string) {
  return prisma.compliancePolicy.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
}

async function assertDestructiveAckIfNeeded(workspaceSlug: string, payload: CompliancePolicyPayload) {
  if (!payload.autoRun || (!payload.workflowId && !payload.escalatedWorkflowId)) return;
  const ids = [payload.workflowId, payload.escalatedWorkflowId].filter((v): v is string => Boolean(v));
  if (!ids.length) return;
  const workflows = await prisma.workflow.findMany({ where: { workspaceSlug, id: { in: ids } } });
  for (const workflow of workflows) {
    if (workflowHasDestructiveStep(workflow) && !payload.autoRunDestructiveAck) {
      throw new HttpError(
        400,
        `Workflow "${workflow.name}" contains a destructive action (wipe, unenroll, disable, etc.) — enabling autoRun with it requires explicit acknowledgment.`,
      );
    }
  }
}

/** Port of `create_compliance_policy` (main.py:10832) — the background "evaluate the new policy now" kick is the caller's job (compliance.controller.ts), since it needs the live request's Authorization header. */
export async function createCompliancePolicy(workspaceSlug: string, payload: CompliancePolicyPayload, actorEmail: string) {
  await assertDestructiveAckIfNeeded(workspaceSlug, payload);
  const created = await prisma.compliancePolicy.create({
    data: {
      workspaceSlug,
      name: payload.name,
      description: payload.description ?? "",
      enabled: payload.enabled,
      autoRun: payload.autoRun,
      severity: payload.severity,
      conditionLogic: payload.conditionLogic,
      conditions: payload.conditions,
      workflowId: payload.workflowId ?? null,
      nonComplianceTag: payload.nonComplianceTag ?? null,
      nonComplianceSmartAttributeId: payload.nonComplianceSmartAttributeId ?? null,
      openCaseOnViolation: payload.openCaseOnViolation,
      autoResolveCaseOnRecovery: payload.autoResolveCaseOnRecovery,
      mitreTechniques: payload.mitreTechniques,
      framework: payload.framework ?? null,
      controlRef: payload.controlRef ?? null,
      targetDeviceAudienceId: payload.targetDeviceAudienceId ?? null,
      evaluationIntervalMinutes: clampEvalInterval(payload.evaluationIntervalMinutes) ?? 60,
      autoRunBatchCap: payload.autoRunBatchCap ?? 15,
      autoRunDestructiveAck: payload.autoRunDestructiveAck,
      escalatedWorkflowId: payload.escalatedWorkflowId ?? null,
      escalatedWorkflowMinRiskTier: payload.escalatedWorkflowMinRiskTier,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "policy", action: "policy_created", actor: actorEmail,
    targetType: "policy", targetId: created.id, targetName: created.name,
    message: `Compliance policy "${created.name}" created`,
  });
  return created;
}

/** Port of `update_compliance_policy` (main.py:10885). */
export async function updateCompliancePolicy(workspaceSlug: string, policyId: string, payload: CompliancePolicyPayload, actorEmail: string) {
  const existing = await prisma.compliancePolicy.findFirst({ where: { workspaceSlug, id: policyId } });
  if (!existing) throw new HttpError(404, "Compliance policy not found");
  await assertDestructiveAckIfNeeded(workspaceSlug, payload);

  const wasEnabled = existing.enabled;
  const updated = await prisma.compliancePolicy.update({
    where: { id: policyId },
    data: {
      name: payload.name,
      description: payload.description ?? "",
      enabled: payload.enabled,
      autoRun: payload.autoRun,
      severity: payload.severity,
      conditionLogic: payload.conditionLogic,
      conditions: payload.conditions,
      workflowId: payload.workflowId ?? null,
      nonComplianceTag: payload.nonComplianceTag ?? null,
      nonComplianceSmartAttributeId: payload.nonComplianceSmartAttributeId ?? null,
      openCaseOnViolation: payload.openCaseOnViolation,
      autoResolveCaseOnRecovery: payload.autoResolveCaseOnRecovery,
      mitreTechniques: payload.mitreTechniques,
      framework: payload.framework ?? null,
      controlRef: payload.controlRef ?? null,
      targetDeviceAudienceId: payload.targetDeviceAudienceId ?? null,
      evaluationIntervalMinutes: clampEvalInterval(payload.evaluationIntervalMinutes) ?? 60,
      autoRunBatchCap: payload.autoRunBatchCap ?? 15,
      autoRunDestructiveAck: payload.autoRunDestructiveAck,
      escalatedWorkflowId: payload.escalatedWorkflowId ?? null,
      escalatedWorkflowMinRiskTier: payload.escalatedWorkflowMinRiskTier,
      // Explicit save = the human review/reset step for the autoRun circuit
      // breaker (main.py:10921-10929) — clears the trip so autoRun resumes
      // on the next pass; it re-trips on its own if the same failure repeats.
      autoRunTripped: false,
      autoRunTrippedAt: null,
      autoRunTrippedReason: null,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "policy", action: "policy_updated", actor: actorEmail,
    targetType: "policy", targetId: policyId, targetName: updated.name,
    message: `Compliance policy "${updated.name}" updated`,
  });
  return { updated, justEnabled: updated.enabled && !wasEnabled };
}

/** Port of `delete_compliance_policy` (main.py:10947). */
export async function deleteCompliancePolicy(workspaceSlug: string, policyId: string, actorEmail: string) {
  const deleted = await prisma.compliancePolicy.findFirst({ where: { workspaceSlug, id: policyId } });
  if (deleted) {
    await prisma.complianceViolation.deleteMany({ where: { workspaceSlug, policyId } });
    await prisma.compliancePolicy.delete({ where: { id: policyId } });
    await recordAuditEvent(workspaceSlug, {
      category: "policy", action: "policy_deleted", actor: actorEmail, severity: "warning",
      targetType: "policy", targetId: policyId, targetName: deleted.name,
      message: `Compliance policy "${deleted.name}" deleted`,
    });
  }
  return { status: "ok" };
}

// ── Per-workspace suppression state (main.py:10575-10584) ──
// Keyed "{policyId}:{deviceId}" -> {violationId, status, lastDetectedAt}.
// Presence of a key is what stops a still-violating pair from spawning a
// duplicate violation on every pass; cleared only on recovery, never by
// approve/dismiss (those only change the violation record's own status).

interface SuppressionEntry {
  violationId: string;
  status: string;
  lastDetectedAt: string;
}

async function loadComplianceState(workspaceSlug: string): Promise<Record<string, SuppressionEntry>> {
  const row = await prisma.complianceEvaluationState.findUnique({ where: { workspaceSlug } });
  return (row?.state as Record<string, SuppressionEntry>) ?? {};
}

async function saveComplianceState(workspaceSlug: string, state: Record<string, SuppressionEntry>): Promise<void> {
  await prisma.complianceEvaluationState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, state },
    update: { state },
  });
}

/** Port of `get_policy_violating_device_ids` (main.py:11417). */
export async function getPolicyViolatingDeviceIds(workspaceSlug: string, policyId: string): Promise<string[]> {
  const state = await loadComplianceState(workspaceSlug);
  const prefix = `${policyId}:`;
  return Object.keys(state).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}

// ── autoRun circuit breaker (main.py:10959-11018) ──

async function lookupWorkflowRun(workspaceSlug: string, runId: string) {
  return prisma.workflowRun.findFirst({ where: { workspaceSlug, id: runId } });
}

/**
 * True only if EVERY device this run targeted ended in a non-success,
 * non-partial state. Port of `_run_fully_failed` (main.py:10987) — adapted
 * to this schema's per-(device,step) WorkflowRunResult rows (Phase 4 isn't
 * built yet, so this always sees zero rows and returns false, matching the
 * original's own "no results -> False" case; the real per-device-final-
 * status shape gets validated once Phase 4 actually populates this table).
 */
async function runFullyFailed(runId: string): Promise<boolean> {
  const results = await prisma.workflowRunResult.findMany({ where: { runId }, orderBy: { recordedAt: "asc" } });
  if (!results.length) return false;
  const finalByDevice = new Map<string, string>();
  for (const r of results) finalByDevice.set(r.deviceId, r.status);
  return ![...finalByDevice.values()].some((s) => s === "success" || s === "partial");
}

/** Port of `_autorun_circuit_breaker_check` (main.py:10996). `violations` is this policy's own violation rows, most-recent-first. */
async function autorunCircuitBreakerCheck(
  workspaceSlug: string,
  policy: { id: string },
  violations: Array<{ policyId: string; status: string; workflowRunId: string | null }>,
): Promise<string | null> {
  let checked = 0;
  for (const v of violations) {
    if (v.policyId !== policy.id || v.status !== "auto_fired" || !v.workflowRunId) continue;
    const run = await lookupWorkflowRun(workspaceSlug, v.workflowRunId);
    if (!run || run.status === "running" || run.status === "waiting") continue;
    checked += 1;
    const fullyFailed = await runFullyFailed(v.workflowRunId);
    if (!fullyFailed) return null;
    if (checked >= AUTORUN_CIRCUIT_BREAKER_THRESHOLD) {
      return `Last ${AUTORUN_CIRCUIT_BREAKER_THRESHOLD} auto-run workflow executions for this policy failed on every targeted device`;
    }
  }
  return null;
}

// ── Marker writes (main.py:4135-4194) ──

/** Port of `_apply_compliance_tag` (main.py:4135). Mutates `device.tags` in place on success, mirroring the original's in-pass cache sync. */
async function applyComplianceTag(headers: Record<string, string>, orgBase: string, device: NormalizedDevice, tag: string, present: boolean): Promise<boolean> {
  const platformPath = platformPathSegment(device.platform);
  if (!platformPath || !tag) return false;
  const currentTags = device.tags ?? [];
  const hasTag = currentTags.includes(tag);
  if (present === hasTag) return false;
  const newTags = present ? [...currentTags, tag] : currentTags.filter((t) => t !== tag);
  const url = `${orgBase}/mdm/${platformPath}/enterprise/devices/${device.id}`;
  try {
    const res = await appliveryClient.put(url, { tags: newTags }, { headers });
    if (res.status >= 300) return false;
  } catch {
    return false;
  }
  device.tags = newTags;
  return true;
}

/** Port of `_apply_compliance_smart_attribute` (main.py:4160). */
async function applyComplianceSmartAttribute(headers: Record<string, string>, orgBase: string, device: NormalizedDevice, smartAttributeId: string, present: boolean): Promise<boolean> {
  const platformPath = platformPathSegment(device.platform);
  if (!platformPath || !smartAttributeId) return false;
  const currentIds = device.smartAttributeAssignmentIds ?? [];
  const hasIt = currentIds.includes(smartAttributeId);
  if (present === hasIt) return false;
  const newIds = present ? [...currentIds, smartAttributeId] : currentIds.filter((i) => i !== smartAttributeId);
  const url = `${orgBase}/mdm/${platformPath}/enterprise/devices/${device.id}`;
  const body = { smartAttributeAssignments: newIds.map((i) => ({ smartAttributeId: i })) };
  try {
    const res = await appliveryClient.put(url, body, { headers });
    if (res.status >= 300) return false;
  } catch {
    return false;
  }
  device.smartAttributeAssignmentIds = newIds;
  return true;
}

// ── Evaluation engine (main.py:11020-11374) ──

export interface EvaluationSummary {
  evaluatedPolicies: number;
  devicesChecked: number;
  violationsFound: number;
  autoFired: number;
  queuedForReview: number;
  recovered: number;
  autoRunSafetyBlocked: number;
}

interface MarkerAction {
  device: NormalizedDevice;
  tag: string | null;
  smartAttrId: string | null;
  present: boolean;
}

/**
 * Shared by the manual "Evaluate now" endpoint (policyIds=null -> every
 * enabled policy) and, once built, the scheduler loop. Port of
 * `_run_compliance_evaluation` (main.py:11025).
 */
export async function runComplianceEvaluation(
  authorization: string,
  workspaceSlug: string,
  policyIds: string[] | null = null,
  actor: string | null = null,
): Promise<EvaluationSummary> {
  const allPolicies = await prisma.compliancePolicy.findMany({ where: { workspaceSlug } });
  const policies = allPolicies.filter((p) => p.enabled && (policyIds === null || policyIds.includes(p.id)));
  const summary: EvaluationSummary = { evaluatedPolicies: policies.length, devicesChecked: 0, violationsFound: 0, autoFired: 0, queuedForReview: 0, recovered: 0, autoRunSafetyBlocked: 0 };
  if (!policies.length) return summary;

  const { getDevicesFull } = await import("../devices/devices.service");
  // refresh=true deliberately — this pass decides real violations/autoRun
  // firings and Device Audience membership needs to be current, unlike most
  // other callers of getDevicesFull which tolerate the 15-min live cache.
  const devicesResp = await getDevicesFull(authorization, workspaceSlug, true);
  const devices: NormalizedDevice[] = devicesResp.items;

  // Attach installed-app inventories, but only for devices actually scoped
  // by a policy with a requiredAppList/disallowedAppList condition — a pure
  // read from the persistent store (installedApps refresher owns keeping it
  // fresh), so this never triggers a live Applivery call.
  const needsAppsDeviceIds = appListScopedDeviceIds(devices, policies as any);
  if (needsAppsDeviceIds.size) {
    const devicesById = new Map(devices.map((d) => [d.id, d]));
    for (const did of needsAppsDeviceIds) {
      const d = devicesById.get(did);
      if (d) (d as any).installedApps = await readInstalledAppsFromStore(workspaceSlug, did);
    }
  }

  const appLists: AppListsContext = await loadAppListsContext(workspaceSlug);
  const workflows = await prisma.workflow.findMany({ where: { workspaceSlug } });
  const workflowsById = new Map(workflows.map((w) => [w.id, w]));
  const state = await loadComplianceState(workspaceSlug);
  const violations = await prisma.complianceViolation.findMany({ where: { workspaceSlug }, orderBy: { detectedAt: "desc" } });
  const nowIso = new Date().toISOString();

  const auditEvents: Array<{ category: string; action: string; actor?: string | null; targetType?: string; targetId?: string; targetName?: string; message: string; severity?: string }> = [];
  const markerActions: MarkerAction[] = [];
  const newViolationRows: Array<Parameters<typeof prisma.complianceViolation.create>[0]["data"]> = [];
  let policiesChanged = false;

  for (const policy of policies) {
    const workflow = policy.workflowId ? workflowsById.get(policy.workflowId) ?? null : null;
    const escalatedWorkflow = workflow && policy.escalatedWorkflowId ? workflowsById.get(policy.escalatedWorkflowId) ?? null : null;
    const escalatedMinRank = RISK_TIER_RANK[policy.escalatedWorkflowMinRiskTier || "high"] ?? 2;
    const tag = policy.nonComplianceTag;
    const smartAttrId = policy.nonComplianceSmartAttributeId;
    const targetAudienceId = policy.targetDeviceAudienceId;
    const scopedDevices = targetAudienceId
      ? devices.filter((d) => (d.deviceAudiences ?? []).some((a) => String(a.id) === String(targetAudienceId)))
      : devices;
    summary.devicesChecked += scopedDevices.length;

    // autoRun circuit breaker — resolved once per policy per pass.
    let autorunBlockReason: string | null = null;
    if (policy.autoRun && workflow) {
      if (policy.autoRunTripped) {
        autorunBlockReason = policy.autoRunTrippedReason || "autoRun previously tripped — re-save the policy to re-arm it";
      } else if ((workflowHasDestructiveStep(workflow) || workflowHasDestructiveStep(escalatedWorkflow)) && !policy.autoRunDestructiveAck) {
        const offending = workflowHasDestructiveStep(workflow) ? workflow : escalatedWorkflow;
        autorunBlockReason = `Linked workflow "${offending?.name}" now contains a destructive action — re-save this policy to acknowledge it before autoRun can fire again`;
      } else {
        const freshTripReason = await autorunCircuitBreakerCheck(workspaceSlug, policy, violations);
        if (freshTripReason) {
          await prisma.compliancePolicy.update({ where: { id: policy.id }, data: { autoRunTripped: true, autoRunTrippedAt: new Date(nowIso), autoRunTrippedReason: freshTripReason } });
          policiesChanged = true;
          autorunBlockReason = freshTripReason;
          auditEvents.push({
            category: "policy", action: "autorun_tripped", actor: actor ?? "system", severity: "critical",
            targetType: "policy", targetId: policy.id, targetName: policy.name,
            message: `autoRun disabled for "${policy.name}" — ${freshTripReason}. Review and re-save the policy to re-enable it.`,
          });
        }
      }
    }

    const autorunBatchCap = resolveAutoRunBatchCap(policy);
    let policyAutofiredCount = 0;
    let policyNewViolations = 0;
    let policyRecovered = 0;

    for (const device of scopedDevices) {
      const key = `${policy.id}:${device.id}`;
      const matched = policyViolated(device, { conditions: (policy.conditions as any[]) ?? [], conditionLogic: policy.conditionLogic }, appLists);

      if (!matched.length) {
        if (state[key]) {
          delete state[key];
          summary.recovered += 1;
          policyRecovered += 1;
          if (tag) markerActions.push({ device, tag, smartAttrId: null, present: false });
          if (smartAttrId) markerActions.push({ device, tag: null, smartAttrId, present: false });
          auditEvents.push({
            category: "violation", action: "violation_recovered", actor: actor ?? "system", severity: "info",
            targetType: "device", targetId: device.id, targetName: device.displayName,
            message: `${device.displayName} recovered from "${policy.name}"`,
          });
          // TODO(Phase5): Case auto-resolve-on-recovery isn't wired yet — Cases don't exist.
        }
        continue;
      }

      if (state[key]) continue; // already flagged and still violating

      summary.violationsFound += 1;
      policyNewViolations += 1;
      if (tag) markerActions.push({ device, tag, smartAttrId: null, present: true });
      if (smartAttrId) markerActions.push({ device, tag: null, smartAttrId, present: true });
      const violationId = crypto.randomUUID();

      const escalated = Boolean(escalatedWorkflow) && (RISK_TIER_RANK[device.riskTier ?? "low"] ?? 0) >= escalatedMinRank;
      const effectiveWorkflow = escalated ? escalatedWorkflow : workflow;

      let status: string;
      let workflowRunId: string | null = null;
      if (policy.autoRun && workflow && autorunBlockReason) {
        status = "autorun_blocked";
        summary.autoRunSafetyBlocked += 1;
        summary.queuedForReview += 1;
        auditEvents.push({
          category: "violation", action: "violation_detected", actor: actor ?? "system", severity: "critical",
          targetType: "device", targetId: device.id, targetName: device.displayName,
          message: `${device.displayName} violated "${policy.name}" — autoRun blocked (${autorunBlockReason}), queued for review`,
        });
      } else if (policy.autoRun && workflow && autorunBatchCap !== null && policyAutofiredCount >= autorunBatchCap) {
        status = "autorun_capped";
        summary.autoRunSafetyBlocked += 1;
        summary.queuedForReview += 1;
        auditEvents.push({
          category: "violation", action: "violation_detected", actor: actor ?? "system", severity: "warning",
          targetType: "device", targetId: device.id, targetName: device.displayName,
          message: `${device.displayName} violated "${policy.name}" — autoRun batch cap (${autorunBatchCap}) reached this pass, queued for manual review`,
        });
      } else if (policy.autoRun && workflow && effectiveWorkflow) {
        // TODO(Phase4): no real workflow execution engine exists yet — the
        // Workflow table is currently always empty for a fresh workspace,
        // so this branch is unreachable in practice until Phase 4 lands.
        // Kept faithful to the original's shape (launch -> auto_fired /
        // workflow_unavailable) rather than collapsed, so wiring in the
        // real launcher later is a one-line swap, not a rewrite.
        policyAutofiredCount += 1;
        status = "workflow_unavailable";
        const escalationNote = escalated ? ` — escalated (device risk tier: ${device.riskTier ?? "low"})` : "";
        auditEvents.push({
          category: "violation", action: "violation_detected", actor: actor ?? "system", severity: "critical",
          targetType: "device", targetId: device.id, targetName: device.displayName,
          message: `${device.displayName} violated "${policy.name}" — workflow "${effectiveWorkflow.name}" could not run (workflow execution engine not available yet)${escalationNote}`,
        });
      } else if (!workflow) {
        status = "no_workflow";
        auditEvents.push({
          category: "violation", action: "violation_detected", actor: actor ?? "system", severity: "warning",
          targetType: "device", targetId: device.id, targetName: device.displayName,
          message: `${device.displayName} violated "${policy.name}" — no workflow linked`,
        });
      } else {
        status = "pending";
        summary.queuedForReview += 1;
        auditEvents.push({
          category: "violation", action: "violation_detected", actor: actor ?? "system", severity: "warning",
          targetType: "device", targetId: device.id, targetName: device.displayName,
          message: `${device.displayName} violated "${policy.name}" — queued for review`,
        });
      }

      newViolationRows.push({
        id: violationId,
        workspaceSlug,
        policyId: policy.id,
        policyName: policy.name,
        workflowId: effectiveWorkflow?.id ?? policy.workflowId ?? null,
        workflowName: effectiveWorkflow?.name ?? null,
        workflowRunId,
        escalated,
        deviceId: device.id,
        deviceName: device.displayName,
        platform: device.platform,
        platformDeviceId: device.platformDeviceId,
        matchedConditions: matched as any,
        detectedAt: new Date(nowIso),
        resolvedAt: null,
        status,
        severity: policy.severity || "medium",
        // TODO(Phase5): Cases don't exist yet — openCaseOnViolation has no effect until then.
        caseId: null,
      });
      state[key] = { violationId, status, lastDetectedAt: nowIso };
    }

    auditEvents.push({
      category: "policy", action: "policy_evaluated", actor: actor ?? "system",
      severity: policyNewViolations ? "warning" : "info",
      targetType: "policy", targetId: policy.id, targetName: policy.name,
      message: policyNewViolations
        ? `"${policy.name}" evaluated — ${policyNewViolations} new violation(s) found among ${scopedDevices.length} device(s)`
        : policyRecovered
          ? `"${policy.name}" evaluated — clean (${policyRecovered} device(s) recovered) among ${scopedDevices.length} device(s)`
          : `"${policy.name}" evaluated — no violations found among ${scopedDevices.length} device(s)`,
    });
  }

  await saveComplianceState(workspaceSlug, state);
  if (newViolationRows.length) await prisma.complianceViolation.createMany({ data: newViolationRows as any });
  if (auditEvents.length) {
    await Promise.all(auditEvents.map((e) => recordAuditEvent(workspaceSlug, e)));
  }
  void policiesChanged; // per-policy circuit-breaker trips are already persisted individually above

  // Pass 2 — dispatch marker writes, bounded concurrency across devices;
  // each device's own actions still run in order (read-modify-write safety).
  const actionsByDevice = new Map<string, MarkerAction[]>();
  for (const action of markerActions) {
    const list = actionsByDevice.get(action.device.id) ?? [];
    list.push(action);
    actionsByDevice.set(action.device.id, list);
  }

  let tagsChanged = false;
  if (actionsByDevice.size) {
    const headers = { Authorization: authorization, "Content-Type": "application/json" };
    const orgBase = await resolveOrgBase(headers, workspaceSlug);
    const groups = Array.from(actionsByDevice.values());
    let cursor = 0;
    const worker = async () => {
      while (cursor < groups.length) {
        const myIndex = cursor++;
        const devActions = groups[myIndex];
        for (const { device, tag, smartAttrId, present } of devActions) {
          try {
            const changed = tag
              ? await applyComplianceTag(headers, orgBase, device, tag, present)
              : await applyComplianceSmartAttribute(headers, orgBase, device, smartAttrId!, present);
            if (changed) tagsChanged = true;
          } catch (e) {
            console.warn(`[Compliance] Marker write failed for device ${device.id}: ${e}`);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(COMPLIANCE_WRITE_CONCURRENCY, groups.length) }, worker));
  }
  if (tagsChanged) {
    const { invalidateDevicesCache } = await import("../devices/devices.service");
    invalidateDevicesCache(workspaceSlug);
  }

  // Stamp lastEvaluatedAt on every policy actually evaluated this pass.
  await prisma.compliancePolicy.updateMany({ where: { id: { in: policies.map((p) => p.id) } }, data: { lastEvaluatedAt: new Date(nowIso) } });

  return summary;
}

// ── Violations review queue (main.py:11429-11599) ──

export async function listComplianceViolations(workspaceSlug: string, status: string | undefined, limit: number, offset: number) {
  const where = { workspaceSlug, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    prisma.complianceViolation.findMany({ where, orderBy: { detectedAt: "desc" }, skip: offset, take: Math.max(1, Math.min(limit, 500)) }),
    prisma.complianceViolation.count({ where }),
  ]);
  return { items, total, offset, limit };
}

export async function exportComplianceViolationsCsv(workspaceSlug: string, status: string | undefined): Promise<string> {
  const where = { workspaceSlug, ...(status ? { status } : {}) };
  const items = await prisma.complianceViolation.findMany({ where, orderBy: { detectedAt: "asc" } });
  const rows = [["Created At", "Resolved At", "Status", "Policy", "Device", "Platform", "Case ID"]];
  for (const v of items) {
    rows.push([
      v.detectedAt.toISOString(), v.resolvedAt?.toISOString() ?? "", v.status, v.policyName ?? "",
      v.deviceName ?? "", v.platform ?? "", v.caseId ?? "",
    ]);
  }
  return rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

/**
 * Shared body behind single-approve and bulk-approve. Port of
 * `_approve_violation_core` (main.py:11464). `_authorization`/`_actorEmail`
 * are unused for now — kept in the signature (rather than dropped) since
 * both are needed the moment Phase 4's real workflow launcher replaces the
 * throw below (launch needs the live session token; a successful approval
 * needs the actor for its audit event), so wiring that in later is a
 * one-line change here, not a signature change at every call site.
 */
export async function approveViolationCore(violationId: string, workspaceSlug: string, _authorization: string, _actorEmail: string) {
  const violation = await prisma.complianceViolation.findFirst({ where: { workspaceSlug, id: violationId } });
  if (!violation) throw new HttpError(404, "Violation not found");
  if (violation.status !== "pending") throw new HttpError(400, `Violation already '${violation.status}'`);

  const workflow = violation.workflowId ? await prisma.workflow.findFirst({ where: { workspaceSlug, id: violation.workflowId } }) : null;
  if (!workflow) throw new HttpError(400, "Linked workflow no longer exists");

  // TODO(Phase4): no real workflow launcher exists yet — once it does, this
  // replaces the 400 below with an actual launch + workflowRunId, same as
  // the original's `_launch_workflow_run` call.
  throw new HttpError(400, "This workflow requires the workflow execution engine, which isn't available yet.");
}

export async function bulkApproveViolations(violationIds: string[], workspaceSlug: string, authorization: string, actorEmail: string) {
  const approved: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const vid of violationIds) {
    try {
      await approveViolationCore(vid, workspaceSlug, authorization, actorEmail);
      approved.push(vid);
    } catch (e) {
      failed.push({ id: vid, error: e instanceof HttpError ? String(e.detail) : String(e) });
    }
  }
  return { approved, failed };
}

/** Port of `_dismiss_violation_core` (main.py:11550). */
export async function dismissViolationCore(violationId: string, workspaceSlug: string, actorEmail: string) {
  const violation = await prisma.complianceViolation.findFirst({ where: { workspaceSlug, id: violationId } });
  if (!violation) throw new HttpError(404, "Violation not found");

  const updated = await prisma.complianceViolation.update({
    where: { id: violationId },
    data: { status: "dismissed", resolvedAt: new Date() },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "violation", action: "violation_dismissed", actor: actorEmail,
    targetType: "device", targetId: violation.deviceId, targetName: violation.deviceName ?? undefined,
    message: `${violation.deviceName} violation of "${violation.policyName}" dismissed`,
  });

  const state = await loadComplianceState(workspaceSlug);
  const key = `${violation.policyId}:${violation.deviceId}`;
  if (state[key]) {
    state[key].status = "dismissed";
    await saveComplianceState(workspaceSlug, state);
  }
  // TODO(Phase5): Cases don't exist yet — the original notes the dismissal on the linked Case's timeline here.
  return updated;
}

export async function bulkDismissViolations(violationIds: string[], workspaceSlug: string, actorEmail: string) {
  const dismissed: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const vid of violationIds) {
    try {
      await dismissViolationCore(vid, workspaceSlug, actorEmail);
      dismissed.push(vid);
    } catch (e) {
      failed.push({ id: vid, error: e instanceof HttpError ? String(e.detail) : String(e) });
    }
  }
  return { dismissed, failed };
}
