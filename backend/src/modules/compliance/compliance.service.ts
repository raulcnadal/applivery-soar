import { prisma } from "../../services/prisma";
import { HttpError } from "../../utils/httpError";
import { recordAuditEvent } from "../../services/auditLog";
import { appliveryClient } from "../../services/appliveryClient";
import { resolveOrgBase } from "../auth/rbac.service";
import { platformPathSegment, type NormalizedDevice } from "../devices/deviceNormalize";
import { policyViolated, type AppListsContext, type GeoContext } from "./complianceEvaluate";
import { loadAppListsContext } from "../appLists/appCatalog.service";
import { appListScopedDeviceIds, readInstalledAppsFromStore } from "../appLists/installedApps.service";
import { geofenceScopedDeviceIds, loadGeofenceZonesById } from "../geofencing/geofence.service";
import { loadDeviceLocations } from "../geofencing/locationsRefresh.service";
import { getWorkflowRun, launchWorkflowRun, workflowHasDestructiveStep } from "../workflows/workflows.service";
import type { WorkflowDeviceRefPayload } from "../workflows/workflows.schemas";
import type { CompliancePolicyPayload } from "./compliance.schemas";
import { addCaseTimelineEntry, dispatchAndAttachCaseEvent, markCaseRecovered, upsertCaseForViolation } from "../cases/cases.service";
import { sendChatText } from "../settings/notificationsWebhook.service";
import { sendAlertEmail } from "../../services/alertEmail";
import { getAutomationBearer } from "../settings/automationCredential.service";

/**
 * CompliancePolicy CRUD + the shared evaluation engine — port of
 * main.py:10639-11428 (Pydantic models, CRUD, autoRun circuit breaker,
 * `_run_compliance_evaluation`) plus the violations review queue
 * (main.py:11429-11599, `_approve_violation_core`/`_dismiss_violation_core`
 * and their single/bulk endpoints).
 *
 * Case Management (Phase 5) is wired in: `openCaseOnViolation`/
 * `autoResolveCaseOnRecovery` drive `upsertCaseForViolation`/
 * `markCaseRecovered` inline in the per-device loop, and Ticketing/Chat
 * integrations for any Case that opened/reopened/closed this pass are
 * dispatched once the whole pass finishes (see `caseNotifyEvents` below).
 */

// ── Bounds/constants (main.py:10806-10815, 10972, 6620) ──

export const RISK_TIER_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
// Lowered from a hard 60-minute floor — the scheduler tick itself
// (complianceJobs.ts's COMPLIANCE_SCHEDULER_TICK_MS) already runs every
// 60s, so 5 minutes is the fastest an autonomous per-policy interval could
// ever actually matter. "Evaluate now" / device-side "Force evaluate"
// remain the right tool for true immediate feedback — this floor only
// governs the unattended background cadence. The frontend surfaces a
// warning below this same value (PolicyBuilderDrawer.vue) since a fleet
// evaluated every few minutes multiplies Applivery API calls accordingly.
const COMPLIANCE_MIN_EVAL_INTERVAL_MINUTES = 5;
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
      conditions: payload.conditions as any,
      targetPlatform: payload.targetPlatform ?? null,
      targetDeploymentModel: payload.targetDeploymentModel ?? null,
      workflowId: payload.workflowId ?? null,
      nonComplianceTag: payload.nonComplianceTag ?? null,
      nonComplianceSmartAttributeId: payload.nonComplianceSmartAttributeId ?? null,
      openCaseOnViolation: payload.openCaseOnViolation,
      autoResolveCaseOnRecovery: payload.autoResolveCaseOnRecovery,
      caseAssignee: payload.caseAssignee?.trim() || null,
      mitreTechniques: payload.mitreTechniques,
      framework: payload.framework ?? null,
      controlRef: payload.controlRef ?? null,
      targetDeviceAudienceId: payload.targetDeviceAudienceId ?? null,
      segmentId: payload.segmentId ?? null,
      evaluationIntervalMinutes: clampEvalInterval(payload.evaluationIntervalMinutes) ?? 60,
      autoRunBatchCap: payload.autoRunBatchCap ?? 15,
      autoRunDestructiveAck: payload.autoRunDestructiveAck,
      escalatedWorkflowId: payload.escalatedWorkflowId ?? null,
      escalatedWorkflowMinRiskTier: payload.escalatedWorkflowMinRiskTier,
      alertOnViolation: payload.alertOnViolation,
      alertViaWebhook: payload.alertViaWebhook,
      alertViaEmail: payload.alertViaEmail,
      alertWebhookUrl: payload.alertWebhookUrl?.trim() || null,
      alertEmailRecipients: payload.alertEmailRecipients?.trim() || null,
      alertWebhookMaxPerDay: payload.alertWebhookMaxPerDay ?? null,
      alertEmailMaxPerDay: payload.alertEmailMaxPerDay ?? null,
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
  // "Audience change" (and every other scoping change) — who this policy
  // even evaluates against. Previously only the disabled->enabled
  // transition below (justEnabled) triggered an immediate re-check; a
  // routine edit that changed WHICH devices an already-enabled policy
  // targets (re-pointing it at a different Device Audience, narrowing/
  // widening targetPlatform or targetDeploymentModel, or editing the
  // conditions/logic it actually checks) still silently waited out its own
  // evaluationIntervalMinutes before the new scope took effect anywhere.
  // Compared against the payload (not the post-update row) since this only
  // needs to know whether the save is CHANGING scope, not what it changed
  // to. JSON.stringify is good enough for the conditions array — it's
  // always written back as a full replace from the same builder UI, never
  // hand-edited, so there's no risk of a semantically-identical-but-
  // differently-ordered array being misread as a change.
  const scopeChanged =
    existing.targetDeviceAudienceId !== (payload.targetDeviceAudienceId ?? null) ||
    existing.targetPlatform !== (payload.targetPlatform ?? null) ||
    existing.targetDeploymentModel !== (payload.targetDeploymentModel ?? null) ||
    existing.segmentId !== (payload.segmentId ?? null) ||
    existing.conditionLogic !== payload.conditionLogic ||
    JSON.stringify(existing.conditions ?? []) !== JSON.stringify(payload.conditions ?? []);
  const updated = await prisma.compliancePolicy.update({
    where: { id: policyId },
    data: {
      name: payload.name,
      description: payload.description ?? "",
      enabled: payload.enabled,
      autoRun: payload.autoRun,
      severity: payload.severity,
      conditionLogic: payload.conditionLogic,
      conditions: payload.conditions as any,
      targetPlatform: payload.targetPlatform ?? null,
      targetDeploymentModel: payload.targetDeploymentModel ?? null,
      workflowId: payload.workflowId ?? null,
      nonComplianceTag: payload.nonComplianceTag ?? null,
      nonComplianceSmartAttributeId: payload.nonComplianceSmartAttributeId ?? null,
      openCaseOnViolation: payload.openCaseOnViolation,
      autoResolveCaseOnRecovery: payload.autoResolveCaseOnRecovery,
      caseAssignee: payload.caseAssignee?.trim() || null,
      mitreTechniques: payload.mitreTechniques,
      framework: payload.framework ?? null,
      controlRef: payload.controlRef ?? null,
      targetDeviceAudienceId: payload.targetDeviceAudienceId ?? null,
      segmentId: payload.segmentId ?? null,
      evaluationIntervalMinutes: clampEvalInterval(payload.evaluationIntervalMinutes) ?? 60,
      autoRunBatchCap: payload.autoRunBatchCap ?? 15,
      autoRunDestructiveAck: payload.autoRunDestructiveAck,
      escalatedWorkflowId: payload.escalatedWorkflowId ?? null,
      escalatedWorkflowMinRiskTier: payload.escalatedWorkflowMinRiskTier,
      alertOnViolation: payload.alertOnViolation,
      alertViaWebhook: payload.alertViaWebhook,
      alertViaEmail: payload.alertViaEmail,
      alertWebhookUrl: payload.alertWebhookUrl?.trim() || null,
      alertEmailRecipients: payload.alertEmailRecipients?.trim() || null,
      alertWebhookMaxPerDay: payload.alertWebhookMaxPerDay ?? null,
      alertEmailMaxPerDay: payload.alertEmailMaxPerDay ?? null,
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
  return { updated, justEnabled: updated.enabled && !wasEnabled, scopeChanged: updated.enabled && scopeChanged };
}

/** Port of `delete_compliance_policy` (main.py:10947). */
export async function deleteCompliancePolicy(workspaceSlug: string, policyId: string, actorEmail: string) {
  const deleted = await prisma.compliancePolicy.findFirst({ where: { workspaceSlug, id: policyId } });
  if (deleted) {
    await prisma.complianceViolation.deleteMany({ where: { workspaceSlug, policyId } });
    // Also purge this policy's suppression-state keys ("{policyId}:{deviceId}")
    // from complianceEvaluationState. Without this, a device this policy once
    // flagged keeps an orphaned entry forever — getDevicesFull resolves its
    // policyName via a live lookup against CompliancePolicy (devices.service.ts),
    // which now fails since the policy is gone, so it renders as a permanent
    // "Unknown policy" / stuck-status row on the device's Compliance tab even
    // though the device is otherwise fully compliant (recovery is the only
    // other code path that clears a key, and it only ever revisits policies
    // still present in compliancePolicy, so a deleted policy's key is never
    // reached again). Deleting the CompliancePolicy row itself has no FK
    // cascade onto this table (it's a bare Json blob, not a relation), so
    // this has to be done explicitly here.
    const state = await loadComplianceState(workspaceSlug);
    const prefix = `${policyId}:`;
    let changed = false;
    for (const key of Object.keys(state)) {
      if (key.startsWith(prefix)) {
        delete state[key];
        changed = true;
      }
    }
    if (changed) await saveComplianceState(workspaceSlug, state);
    await prisma.compliancePolicy.delete({ where: { id: policyId } });
    const { invalidateDevicesCache } = await import("../devices/devices.service");
    invalidateDevicesCache(workspaceSlug);
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
  return (row?.state as unknown as Record<string, SuppressionEntry>) ?? {};
}

async function saveComplianceState(workspaceSlug: string, state: Record<string, SuppressionEntry>): Promise<void> {
  await prisma.complianceEvaluationState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, state: state as any },
    update: { state: state as any },
  });
}

/** Port of `get_policy_violating_device_ids` (main.py:11417). */
export async function getPolicyViolatingDeviceIds(workspaceSlug: string, policyId: string): Promise<string[]> {
  const state = await loadComplianceState(workspaceSlug);
  const prefix = `${policyId}:`;
  return Object.keys(state).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}

// ── autoRun circuit breaker (main.py:10959-11018) ──

/** Port of `_lookup_workflow_run` (main.py:10974) — checks the in-memory active-run table first, falling back to persisted history; see workflows.service.ts's `getWorkflowRun`, the same two-source lookup `_gather_workflow_runs` merges. */
async function lookupWorkflowRun(workspaceSlug: string, runId: string) {
  try {
    return await getWorkflowRun(workspaceSlug, runId);
  } catch {
    return null;
  }
}

/**
 * True only if EVERY device result in this run failed outright — a
 * 'partial' or any 'success' means autoRun is at least doing something
 * real, so it shouldn't count toward the failure streak. Port of
 * `_run_fully_failed` (main.py:10987).
 */
function runFullyFailed(run: { results: Array<{ finalStatus: string }> }): boolean {
  const results = run.results ?? [];
  if (!results.length) return false;
  return !results.some((r) => r.finalStatus === "success" || r.finalStatus === "partial");
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
    if (!runFullyFailed(run)) return null;
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

/**
 * Removes this policy's configured non-compliance tag/smart-attribute from a
 * device via the same Applivery API calls the automatic recovery branch of
 * the evaluation pass uses below (see the `present: false` marker-action
 * pushes) — but reachable on demand from a manual Case close/resolve
 * (cases.service.ts's updateCase), for when an admin resolves or closes the
 * case without the device ever actually stopping violating on its own (per
 * the standard evaluation pass, which only clears the marker once the device
 * genuinely recovers). Best-effort and silent: no-ops if the policy has no
 * tag/smart-attr configured, has since been deleted, or the device can't be
 * found; swallows API failures rather than surfacing them, mirroring the
 * evaluation pass's own tolerance for marker-write failures.
 */
export async function removeComplianceMarkersForDevice(authorization: string, workspaceSlug: string, policyId: string, deviceId: string): Promise<void> {
  const policy = await prisma.compliancePolicy.findFirst({ where: { workspaceSlug, id: policyId } });
  if (!policy || (!policy.nonComplianceTag && !policy.nonComplianceSmartAttributeId)) return;
  try {
    const { getDevicesFull, invalidateDevicesCache } = await import("../devices/devices.service");
    const devicesResp = await getDevicesFull(authorization, workspaceSlug, false);
    const device = devicesResp.items.find((d: NormalizedDevice) => d.id === deviceId);
    if (!device) return;
    const headers = { Authorization: authorization, "Content-Type": "application/json" };
    const orgBase = await resolveOrgBase(headers, workspaceSlug);
    let changed = false;
    if (policy.nonComplianceTag && (await applyComplianceTag(headers, orgBase, device, policy.nonComplianceTag, false))) changed = true;
    if (policy.nonComplianceSmartAttributeId && (await applyComplianceSmartAttribute(headers, orgBase, device, policy.nonComplianceSmartAttributeId, false))) changed = true;
    if (changed) invalidateDevicesCache(workspaceSlug);
  } catch (e) {
    console.warn(`[Compliance] Failed to remove marker(s) for device ${deviceId} on manual case close (policy ${policyId}): ${e instanceof Error ? e.message : e}`);
  }
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
 * Fires this policy's own violation alert — a single rolled-up
 * webhook/email message per evaluation pass (never per-device: a policy
 * matching dozens of devices in one pass still only sends one message),
 * only when `alertOnViolation` is on and this pass actually found at least
 * one NEW violation for it. Independent of autoRun/workflow entirely — a
 * policy with no workflow linked at all can still alert.
 *
 * alertWebhookUrl is this policy's own override; falls back to Settings >
 * General's single global "Notifications Webhook URL" (WorkspaceState's
 * "global" row — see services/alertEmail.ts's doc comment for why that's
 * always "global", never the real workspaceSlug) when left blank.
 * alertEmailRecipients is this policy's own list, deliberately NOT the
 * global "Alert Email Recipients" field (that one's reserved for SLA
 * breach/System Health per its own Settings > SMTP help text) — passed as
 * sendAlertEmail's recipientsOverride.
 *
 * Best-effort per channel (one channel failing doesn't block the other)
 * but NOT silent — lastAlertSentAt/lastAlertError are updated so a
 * misconfigured URL/recipient list is visible on the policy itself,
 * mirroring Integration.lastFiredAt/lastError.
 */
async function firePolicyViolationAlert(
  workspaceSlug: string,
  policy: {
    id: string; name: string; alertOnViolation: boolean; alertViaWebhook: boolean; alertViaEmail: boolean;
    alertWebhookUrl: string | null; alertEmailRecipients: string | null;
    alertWebhookMaxPerDay: number | null; alertEmailMaxPerDay: number | null;
    alertWebhookSentToday: number; alertEmailSentToday: number; alertCountersDate: string | null;
  },
  newViolationCount: number,
  deviceCount: number,
): Promise<void> {
  if (!policy.alertOnViolation || newViolationCount < 1) return;
  if (!policy.alertViaWebhook && !policy.alertViaEmail) return;

  const subject = `[Compliance] "${policy.name}" — ${newViolationCount} new violation${newViolationCount === 1 ? "" : "s"}`;
  const text = `${newViolationCount} device${newViolationCount === 1 ? "" : "s"} newly violated Compliance Policy "${policy.name}" this evaluation pass (${deviceCount} device${deviceCount === 1 ? "" : "s"} in scope). Review in Compliance > Violations.`;

  const errors: string[] = [];

  // Optional per-channel daily send caps (Compliance Policy Builder > Alerts
  // > "Limit to N alerts per day") — a guardrail against a misconfigured or
  // overly broad policy that keeps finding new violations every evaluation
  // pass and would otherwise flood a webhook/inbox unboundedly. Counts are
  // scoped to a "YYYY-MM-DD" day key (UTC, same convention as
  // AnalyticsSnapshot's date column) and reset the moment today's key no
  // longer matches what's stored — no separate cron/reset job needed since
  // this function already runs on every evaluation pass.
  const todayKey = new Date().toISOString().slice(0, 10);
  const countersStale = policy.alertCountersDate !== todayKey;
  let webhookSentToday = countersStale ? 0 : policy.alertWebhookSentToday;
  let emailSentToday = countersStale ? 0 : policy.alertEmailSentToday;

  if (policy.alertViaWebhook) {
    if (policy.alertWebhookMaxPerDay != null && webhookSentToday >= policy.alertWebhookMaxPerDay) {
      errors.push(`webhook: daily limit reached (${policy.alertWebhookMaxPerDay}/day) — skipped, resets after ${todayKey}`);
    } else {
      try {
        const url = policy.alertWebhookUrl?.trim()
          || (await prisma.workspaceState.findUnique({ where: { workspaceSlug: "global" } }))?.webhookUrl?.trim()
          || null;
        if (!url) throw new Error("no webhook URL configured (set one on this policy or in Settings > General)");
        await sendChatText(url, text);
        webhookSentToday += 1;
      } catch (e) {
        errors.push(`webhook: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  if (policy.alertViaEmail) {
    if (policy.alertEmailMaxPerDay != null && emailSentToday >= policy.alertEmailMaxPerDay) {
      errors.push(`email: daily limit reached (${policy.alertEmailMaxPerDay}/day) — skipped, resets after ${todayKey}`);
    } else if (!policy.alertEmailRecipients?.trim()) {
      errors.push("email: no recipients configured on this policy");
    } else {
      // sendAlertEmail is itself best-effort (never throws) and only
      // no-ops silently when SMTP host/user aren't configured at all —
      // that specific case is common/expected (SMTP is optional) and not
      // worth surfacing as a per-policy error, unlike a genuinely broken
      // per-policy recipients list or webhook URL above.
      await sendAlertEmail(workspaceSlug, subject, text, policy.alertEmailRecipients);
      emailSentToday += 1;
    }
  }

  await prisma.compliancePolicy.update({
    where: { id: policy.id },
    data: {
      lastAlertSentAt: new Date(),
      lastAlertError: errors.length ? errors.join("; ").slice(0, 500) : null,
      alertWebhookSentToday: webhookSentToday,
      alertEmailSentToday: emailSentToday,
      alertCountersDate: todayKey,
    },
  }).catch((e: unknown) => console.warn(`[Compliance] Failed to record alert status for policy ${policy.id}: ${e}`));
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

  // Geofencing context — pure reads, never a live Applivery call (keeping
  // device location fresh is the location refresher's job, see
  // locationsRefresh.service.ts). Only devices actually scoped by a
  // geofenceZoneId-using policy get a lookup, mirroring the installed-apps
  // attachment above.
  const needsGeoDeviceIds = geofenceScopedDeviceIds(devices, policies as any);
  const geo: GeoContext = {
    zonesById: await loadGeofenceZonesById(workspaceSlug),
    locationsByDeviceId: needsGeoDeviceIds.size ? await loadDeviceLocations(workspaceSlug, Array.from(needsGeoDeviceIds)) : new Map(),
  };

  const workflows = await prisma.workflow.findMany({ where: { workspaceSlug } });
  const workflowsById = new Map(workflows.map((w) => [w.id, w]));
  const state = await loadComplianceState(workspaceSlug);
  const violations = await prisma.complianceViolation.findMany({ where: { workspaceSlug }, orderBy: { detectedAt: "desc" } });
  const nowIso = new Date().toISOString();

  const auditEvents: Array<{ category: string; action: string; actor?: string | null; targetType?: string; targetId?: string; targetName?: string; message: string; severity?: string }> = [];
  const markerActions: MarkerAction[] = [];
  const newViolationRows: Array<Parameters<typeof prisma.complianceViolation.create>[0]["data"]> = [];
  // Cases/Integrations dispatch is deferred until the whole pass finishes
  // (see the loop after "await saveComplianceState" below) — dispatching
  // real HTTP calls per device inline would defeat the point of batching.
  // Port of `case_notify_events` (main.py:11073 and its dispatch loop).
  const caseNotifyEvents: Array<{ caseId: string; eventType: "created" | "reopened" | "closed" }> = [];
  // Same deferred-dispatch reasoning as caseNotifyEvents — one alert per
  // policy per pass, fired after the whole pass finishes, not inline per
  // device.
  const policyAlertEvents: Array<{ policy: (typeof policies)[number]; newViolations: number; deviceCount: number }> = [];
  let policiesChanged = false;

  // Cross-policy dedup for the shared-workflow scenario: nothing stops two
  // different CompliancePolicy rows from pointing at the same workflowId
  // (no uniqueness constraint on that column), and each policy tracks its
  // own violation-suppression independently, keyed by policy+device — not
  // by workflow. Without this, a device that violates two policies sharing
  // a workflow in the same pass (e.g. an ISO 27001 policy and a NIS2 policy
  // both flagging the same missing-encryption issue, both wired to the same
  // remediation workflow) would launch that workflow twice back-to-back,
  // with no benefit — the device only needs remediating once. Keyed by
  // (effectiveWorkflow.id, device.id), populated the first time a workflow
  // actually launches for a device this pass; every subsequent policy
  // hitting the same pair reuses that WorkflowRun's id instead of launching
  // again.
  const firedWorkflowThisPass = new Map<string, string>(); // `${workflowId}:${deviceId}` -> WorkflowRun.id

  for (const policy of policies) {
    const workflow = policy.workflowId ? workflowsById.get(policy.workflowId) ?? null : null;
    const escalatedWorkflow = workflow && policy.escalatedWorkflowId ? workflowsById.get(policy.escalatedWorkflowId) ?? null : null;
    const escalatedMinRank = RISK_TIER_RANK[policy.escalatedWorkflowMinRiskTier || "high"] ?? 2;
    const tag = policy.nonComplianceTag;
    const smartAttrId = policy.nonComplianceSmartAttributeId;
    const targetAudienceId = policy.targetDeviceAudienceId;
    // targetPlatform narrows which devices this policy is even evaluated
    // against, on top of (not instead of) the Device Audience scoping below
    // -- a policy with no targetPlatform set (every pre-existing policy,
    // before this column existed) keeps evaluating against every platform
    // unchanged. targetDeploymentModel is deliberately NOT used here to
    // filter devices -- see schema.prisma's comment on that column for why
    // (no reliable per-device signal for it, same limitation Workflow's own
    // targetDeploymentModel has always had).
    const scopedDevices = (targetAudienceId
      ? devices.filter((d) => (d.deviceAudiences ?? []).some((a) => String(a.id) === String(targetAudienceId)))
      : devices
    ).filter((d) => !policy.targetPlatform || d.platform === policy.targetPlatform);
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
      const matched = policyViolated(device, { conditions: (policy.conditions as any[]) ?? [], conditionLogic: policy.conditionLogic }, appLists, geo);

      if (!matched.length) {
        const suppressed = state[key];
        if (suppressed) {
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
          const recovery = await markCaseRecovered(workspaceSlug, suppressed.violationId, Boolean(policy.autoResolveCaseOnRecovery));
          if (recovery?.notifyEvent) caseNotifyEvents.push({ caseId: recovery.caseId, eventType: recovery.notifyEvent });
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

      // Opens (or reuses/reopens) a Case the moment this policy is newly
      // violated — off for policies with openCaseOnViolation=false. Port of
      // `record["caseId"] = _upsert_case_for_violation_inmem(...) if policy.get('openCaseOnViolation', True) else None`
      // (main.py:11207).
      let caseId: string | null = null;
      if (policy.openCaseOnViolation) {
        const upserted = await upsertCaseForViolation(
          workspaceSlug,
          { id: policy.id, name: policy.name, severity: policy.severity, mitreTechniques: policy.mitreTechniques ?? [], caseAssignee: policy.caseAssignee },
          { id: device.id, displayName: device.displayName, segmentId: (device as any).segmentId },
          violationId,
        );
        caseId = upserted.caseId;
        if (upserted.notifyEvent) caseNotifyEvents.push({ caseId: upserted.caseId, eventType: upserted.notifyEvent });
      }

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
        policyAutofiredCount += 1;
        const escalationNote = escalated ? ` — escalated (device risk tier: ${device.riskTier ?? "low"})` : "";
        const dedupKey = `${effectiveWorkflow.id}:${device.id}`;
        const alreadyFiredRunId = firedWorkflowThisPass.get(dedupKey);

        if (alreadyFiredRunId) {
          status = "auto_fired";
          workflowRunId = alreadyFiredRunId;
          auditEvents.push({
            category: "violation", action: "violation_auto_fired", actor: actor ?? "system", severity: "warning",
            targetType: "device", targetId: device.id, targetName: device.displayName,
            message: `${device.displayName} violated "${policy.name}" — "${effectiveWorkflow.name}" was already auto-run for this device earlier in this pass (another policy shares this workflow), so it wasn't launched a second time${escalationNote}`,
          });
          if (caseId) {
            await prisma.case.update({ where: { id: caseId }, data: { workflowRunIds: { push: alreadyFiredRunId }, updatedAt: new Date(nowIso) } });
            await addCaseTimelineEntry(caseId, "workflow_run_linked", `Linked to the "${effectiveWorkflow.name}" run another policy already triggered this pass${escalationNote}`);
          }
        } else {
          const deviceRef: WorkflowDeviceRefPayload = {
            id: device.id, displayName: device.displayName, platform: device.platform, platformDeviceId: device.platformDeviceId,
            osLifecycleStatus: (device as any).osLifecycleStatus ?? null,
          };
          const runRecord = await launchWorkflowRun(effectiveWorkflow, [deviceRef], authorization, workspaceSlug);
          if (runRecord === null) {
            // Workflow has a 'wait'/'run_script_wait' step — needs the durable
            // engine (Phase 4b). Log it clearly instead of crashing the
            // evaluation pass or silently dropping the violation.
            status = "workflow_unavailable";
            auditEvents.push({
              category: "violation", action: "violation_detected", actor: actor ?? "system", severity: "critical",
              targetType: "device", targetId: device.id, targetName: device.displayName,
              message: `${device.displayName} violated "${policy.name}" — workflow "${effectiveWorkflow.name}" could not run (durable storage not configured)${escalationNote}`,
            });
          } else {
            status = "auto_fired";
            workflowRunId = runRecord.id;
            firedWorkflowThisPass.set(dedupKey, runRecord.id);
            summary.autoFired += 1;
            auditEvents.push({
              category: "violation", action: "violation_auto_fired", actor: actor ?? "system", severity: "warning",
              targetType: "device", targetId: device.id, targetName: device.displayName,
              message: `${device.displayName} violated "${policy.name}" — auto-ran "${effectiveWorkflow.name}"${escalationNote}`,
            });
            if (caseId) {
              await prisma.case.update({ where: { id: caseId }, data: { workflowRunIds: { push: runRecord.id }, updatedAt: new Date(nowIso) } });
              await addCaseTimelineEntry(caseId, "workflow_run_linked", `Auto-ran "${effectiveWorkflow.name}" (policy autoRun is on)${escalationNote}`);
            }
          }
        }
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
        caseId,
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

    if (policyNewViolations > 0) policyAlertEvents.push({ policy, newViolations: policyNewViolations, deviceCount: scopedDevices.length });
  }

  await saveComplianceState(workspaceSlug, state);
  if (newViolationRows.length) await prisma.complianceViolation.createMany({ data: newViolationRows as any });
  if (auditEvents.length) {
    await Promise.all(auditEvents.map((e) => recordAuditEvent(workspaceSlug, e)));
  }
  void policiesChanged; // per-policy circuit-breaker trips are already persisted individually above

  // Now that the whole pass has finished, dispatch Ticketing/Chat
  // integrations for every Case that newly opened/reopened/closed this pass
  // — deliberately deferred from the per-device loop above (real HTTP calls
  // per device would defeat the point of batching). Port of the
  // `case_notify_events` dispatch loop (main.py, after `_save_cases`).
  for (const { caseId, eventType } of caseNotifyEvents) {
    try {
      await dispatchAndAttachCaseEvent(workspaceSlug, caseId, eventType);
    } catch (e) {
      console.error(`[Compliance] Case integration dispatch failed for case ${caseId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  for (const { policy, newViolations, deviceCount } of policyAlertEvents) {
    try {
      await firePolicyViolationAlert(workspaceSlug, policy, newViolations, deviceCount);
    } catch (e) {
      console.error(`[Compliance] Violation alert failed for policy ${policy.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

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

// Per-workspace cooldown for forceEvaluateNow below — in-memory only (a
// restart just resets it, same tradeoff as liveCache.ts), purely to stop one
// misbehaving/misconfigured device from hammering a full fleet evaluation on
// every tray click or a tight retry loop. Admins triggering "Evaluate now"
// from the web UI (POST /api/compliance/evaluate) are NOT subject to this —
// that's a logged-in human action, this is specifically the unattended
// device-agent path.
const lastForcedEvaluationAt = new Map<string, number>();
const FORCED_EVALUATION_COOLDOWN_MS = 60_000;

/**
 * The device-agent equivalent of the web UI's "Evaluate now" button
 * (POST /api/compliance/evaluate, which runs with the calling admin's own
 * live session) — called from a new device-secret-gated endpoint
 * (deviceData.controller.ts's POST /api/device-data/evaluate-now) so the
 * Windows/macOS SOAR Agent tray/menu can offer a "Force evaluate compliance"
 * action without needing an admin bearer of its own. Reuses the workspace's
 * stored Automation Credential (automationCredential.service.ts) — the same
 * unattended-bearer source the 60s scheduler (complianceJobs.ts) already
 * relies on — rather than inventing a second credential concept.
 */
export async function forceEvaluateNow(workspaceSlug: string): Promise<EvaluationSummary> {
  const last = lastForcedEvaluationAt.get(workspaceSlug) ?? 0;
  const now = Date.now();
  if (now - last < FORCED_EVALUATION_COOLDOWN_MS) {
    throw new HttpError(429, "A compliance evaluation was already triggered for this workspace in the last minute — please wait a moment before trying again.");
  }
  const bearer = await getAutomationBearer(workspaceSlug);
  if (!bearer) {
    throw new HttpError(
      503,
      "No Automation Credential is configured for this workspace (Settings > Workspace Automation) — the SOAR Agent can't trigger an unattended compliance evaluation without one.",
    );
  }
  lastForcedEvaluationAt.set(workspaceSlug, now);
  return runComplianceEvaluation(bearer, workspaceSlug, null, "device-agent");
}

/**
 * Event-driven re-evaluation — the "attribute change" half of trigger-on-
 * change (the "audience/scope change" half lives in
 * compliance.controller.ts's policy PUT handler, which has a live admin
 * bearer to work with and so calls runComplianceEvaluation directly
 * instead). Called from deviceData.service.ts's reportDeviceData right
 * after a device's self-reported attributes are persisted — that request
 * has no admin session (it's an unattended device-agent caller), so this
 * reuses forceEvaluateNow's Automation Credential + per-workspace 60s
 * cooldown exactly as-is rather than inventing a second bearer/cooldown
 * concept. Fire-and-forget by design: the device-report webhook response
 * already went out (or is about to) reporting the attributes were stored
 * successfully regardless of whether a re-evaluation could actually run
 * this instant, so a cooldown-active (429) or no-credential (503) result
 * here is expected and unremarkable, not a failure of the report itself —
 * only a genuinely unexpected error is worth a log line.
 */
export function triggerEventDrivenReEvaluation(workspaceSlug: string, reason: string): void {
  forceEvaluateNow(workspaceSlug)
    .then((summary) => {
      if (summary.violationsFound > 0 || summary.recovered > 0) {
        console.log(`[Compliance] Event-driven re-evaluation (${reason}) for ${workspaceSlug}: ${JSON.stringify(summary)}`);
      }
    })
    .catch((e) => {
      const statusCode = e instanceof HttpError ? e.statusCode : null;
      if (statusCode !== 429 && statusCode !== 503) {
        console.warn(`[Compliance] Event-driven re-evaluation (${reason}) failed for ${workspaceSlug}: ${e}`);
      }
    });
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
export async function approveViolationCore(violationId: string, workspaceSlug: string, authorization: string, actorEmail: string) {
  const violation = await prisma.complianceViolation.findFirst({ where: { workspaceSlug, id: violationId } });
  if (!violation) throw new HttpError(404, "Violation not found");
  if (violation.status !== "pending") throw new HttpError(400, `Violation already '${violation.status}'`);

  const workflow = violation.workflowId ? await prisma.workflow.findFirst({ where: { workspaceSlug, id: violation.workflowId } }) : null;
  if (!workflow) throw new HttpError(400, "Linked workflow no longer exists");

  const deviceRef: WorkflowDeviceRefPayload = {
    id: violation.deviceId, displayName: violation.deviceName, platform: violation.platform ?? "", platformDeviceId: violation.platformDeviceId ?? "",
  };
  const runRecord = await launchWorkflowRun(workflow, [deviceRef], authorization, workspaceSlug);
  if (runRecord === null) {
    throw new HttpError(400, "This workflow includes a 'wait' or 'run script and wait for result' step, which requires durable storage (Phase 4b).");
  }

  const updated = await prisma.complianceViolation.update({
    where: { id: violationId },
    data: { status: "approved", resolvedAt: new Date(), workflowRunId: runRecord.id },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "violation", action: "violation_approved", actor: actorEmail,
    targetType: "device", targetId: violation.deviceId, targetName: violation.deviceName ?? undefined,
    message: `${violation.deviceName} violation of "${violation.policyName}" approved — running "${workflow.name}"`,
  });

  const state = await loadComplianceState(workspaceSlug);
  const key = `${violation.policyId}:${violation.deviceId}`;
  if (state[key]) {
    state[key].status = "approved";
    await saveComplianceState(workspaceSlug, state);
  }
  if (violation.caseId) {
    await prisma.case.update({ where: { id: violation.caseId }, data: { workflowRunIds: { push: runRecord.id }, updatedAt: new Date() } });
    await addCaseTimelineEntry(violation.caseId, "workflow_run_linked", `Violation approved by ${actorEmail} — ran "${workflow.name}"`, actorEmail);
  }
  return updated;
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
  if (violation.caseId) {
    await addCaseTimelineEntry(violation.caseId, "note_added", `Violation dismissed by ${actorEmail} — remediation not run`, actorEmail);
  }
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
