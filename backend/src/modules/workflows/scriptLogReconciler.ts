import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { resolveOrgBase } from "../auth/rbac.service";
import { getAutomationBearer, listAutomationWorkspaces } from "../settings/automationCredential.service";
import { fetchScriptLogDetail, fetchScriptLogSummaryEntry } from "./scriptLogApi";
import { resumeWorkflowPendingStepByToken } from "./durableEngine";
import type { WorkflowResumeRef } from "./mdmActionExecutor";

/**
 * Polls Applivery's per-device script-logs/summary for every dispatch
 * recorded by executeRunScript, until the script's rolling success/error
 * counts move past the baseline snapshotted at dispatch time — then writes
 * the outcome to this workspace's Audit Log (severity 'critical' on error so
 * it's easy to spot among routine entries) and, if the dispatch came from a
 * durable engine 'run_script_wait' step, resumes that parked chain early
 * rather than waiting for its timeout. Gives up after SCRIPT_RUN_MAX_ATTEMPTS
 * ticks and logs a lower-severity 'no confirmation received' entry instead
 * of tracking a dispatch forever. Port of `script_log_reconciler_loop`
 * (main.py:8944-9053).
 */

export const SCRIPT_RUN_RECONCILE_TICK_MS = 90_000;
const SCRIPT_RUN_MAX_ATTEMPTS = 60; // ~90 minutes at the tick above before giving up on one dispatch
const BATCH_SIZE_PER_WORKSPACE = 50;

export async function runScriptLogReconcilerTick(): Promise<void> {
  const workspaces = await listAutomationWorkspaces();
  for (const slugKey of workspaces) {
    const tracking = await prisma.scriptRunTracking.findMany({ where: { workspaceSlug: slugKey }, orderBy: { dispatchedAt: "asc" }, take: BATCH_SIZE_PER_WORKSPACE });
    if (!tracking.length) continue;

    const bearer = await getAutomationBearer(slugKey);
    if (!bearer) continue;

    const headers = { Authorization: bearer, "Content-Type": "application/json" };
    const orgBase = await resolveOrgBase(headers, slugKey);

    for (const rec of tracking) {
      const workflowResume = (rec.workflowResume as unknown as WorkflowResumeRef | null) ?? null;

      const giveUp = async (message: string) => {
        await recordAuditEvent(slugKey, {
          category: "workflow", action: "script_execution_unconfirmed", severity: "warning", actor: "system",
          targetType: "device", targetId: rec.deviceId, targetName: rec.deviceName ?? undefined,
          message,
        });
        await prisma.scriptRunTracking.delete({ where: { id: rec.id } }).catch(() => undefined);
        if (workflowResume) await resumeWorkflowPendingStepByToken(workflowResume, false, message);
      };

      const entry = await fetchScriptLogSummaryEntry(headers, orgBase, rec.platformPath, rec.platformDeviceId, rec.assetId);
      if (entry === null) {
        const attempts = rec.attempts + 1;
        if (attempts >= SCRIPT_RUN_MAX_ATTEMPTS) {
          await giveUp(`No execution result received for script '${rec.scriptName}' on ${rec.deviceName || "device"} after ${SCRIPT_RUN_MAX_ATTEMPTS} checks — device may be offline or the script asset may have been removed.`);
        } else {
          await prisma.scriptRunTracking.update({ where: { id: rec.id }, data: { attempts } });
        }
        continue;
      }

      // Counts are monotonically-increasing rolling totals per (device,
      // script) — total_now > total_baseline by itself already proves at
      // least one NEW execution happened since the baseline was snapshotted
      // right before dispatch.
      const totalNow = (entry.status?.success ?? 0) + (entry.status?.error ?? 0);
      const totalBaseline = rec.baselineSuccess + rec.baselineError;
      if (totalNow <= totalBaseline) {
        const attempts = rec.attempts + 1;
        if (attempts >= SCRIPT_RUN_MAX_ATTEMPTS) {
          await giveUp(`No execution result received for script '${rec.scriptName}' on ${rec.deviceName || "device"} after ${SCRIPT_RUN_MAX_ATTEMPTS} checks — device may be offline or the script asset may have been removed.`);
        } else {
          await prisma.scriptRunTracking.update({ where: { id: rec.id }, data: { attempts } });
        }
        continue;
      }

      const deltaError = (entry.status?.error ?? 0) - rec.baselineError;
      const outcomeOk = deltaError <= 0;

      const detail = await fetchScriptLogDetail(headers, orgBase, rec.platformPath, rec.platformDeviceId, entry.id);
      let excerpt = "";
      if (detail && typeof detail === "object") {
        const raw = String((detail as any).logError || (detail as any).log || (detail as any).summary || "").trim();
        if (raw) excerpt = ` — ${raw.slice(0, 300)}`;
      }

      const scriptName = rec.scriptName || rec.assetId;
      const deviceLabel = rec.deviceName || "device";
      const message = outcomeOk
        ? `Script '${scriptName}' ran successfully on ${deviceLabel}.`
        : `Script '${scriptName}' FAILED on ${deviceLabel}${excerpt}`;

      await recordAuditEvent(slugKey, {
        category: "workflow", action: outcomeOk ? "script_execution_succeeded" : "script_execution_failed",
        severity: outcomeOk ? "info" : "critical", actor: "system",
        targetType: "device", targetId: rec.deviceId, targetName: rec.deviceName ?? undefined,
        message,
      });
      await prisma.scriptRunTracking.delete({ where: { id: rec.id } }).catch(() => undefined);
      if (workflowResume) await resumeWorkflowPendingStepByToken(workflowResume, outcomeOk, message);
    }
  }
}
