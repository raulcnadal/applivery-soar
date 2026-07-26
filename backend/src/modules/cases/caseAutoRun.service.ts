import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { getDevicesFull } from "../devices/devices.service";
import { launchWorkflowRun, workflowHasDestructiveStep, type PublicRunView } from "../workflows/workflows.service";
import type { WorkflowDeviceRefPayload } from "../workflows/workflows.schemas";
import { CASE_SEVERITIES, CASE_SEVERITY_RANK, type CaseAutoRunRulePayload } from "./cases.schemas";

/**
 * Case Auto-Run Rules — closes the gap that manually-created Cases had no
 * unattended auto-fire path (unlike Compliance Policy autoRun and Inbound
 * Triggers). Evaluated once, at creation time only. Port of
 * main.py:12461-12651.
 */

export async function listCaseAutoRunRules(workspaceSlug: string) {
  return { items: await prisma.caseAutoRunRule.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } }) };
}

async function validateDestructive(workspaceSlug: string, payload: CaseAutoRunRulePayload): Promise<void> {
  if (!payload.enabled) return;
  const workflow = await prisma.workflow.findFirst({ where: { workspaceSlug, id: payload.workflowId } });
  if (workflowHasDestructiveStep(workflow) && !payload.autoRunDestructiveAck) {
    throw new HttpError(
      400,
      `Workflow "${workflow?.name}" contains a destructive action (wipe, unenroll, disable, etc.) — enabling this rule requires explicit acknowledgment.`,
    );
  }
}

function validateSeverity(payload: CaseAutoRunRulePayload): void {
  if (!(CASE_SEVERITIES as readonly string[]).includes(payload.minSeverity)) {
    throw new HttpError(400, `minSeverity must be one of ${JSON.stringify(CASE_SEVERITIES)}`);
  }
}

export async function createCaseAutoRunRule(workspaceSlug: string, payload: CaseAutoRunRulePayload, actorEmail: string) {
  validateSeverity(payload);
  await validateDestructive(workspaceSlug, payload);
  const created = await prisma.caseAutoRunRule.create({
    data: {
      workspaceSlug, name: payload.name, enabled: payload.enabled, minSeverity: payload.minSeverity,
      mitreTechniques: payload.mitreTechniques, workflowId: payload.workflowId,
      autoRunDestructiveAck: payload.autoRunDestructiveAck, maxFiresPerHour: payload.maxFiresPerHour, recentFires: [],
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "case", action: "case_autorun_rule_created", actor: actorEmail,
    targetType: "case_autorun_rule", targetId: created.id, targetName: created.name,
    message: `Case Auto-Run rule "${created.name}" created by ${actorEmail}`,
  });
  return created;
}

export async function updateCaseAutoRunRule(workspaceSlug: string, ruleId: string, payload: CaseAutoRunRulePayload, actorEmail: string) {
  validateSeverity(payload);
  await validateDestructive(workspaceSlug, payload);
  const existing = await prisma.caseAutoRunRule.findFirst({ where: { workspaceSlug, id: ruleId } });
  if (!existing) throw new HttpError(404, "Case Auto-Run rule not found");
  const updated = await prisma.caseAutoRunRule.update({
    where: { id: ruleId },
    data: {
      name: payload.name, enabled: payload.enabled, minSeverity: payload.minSeverity,
      mitreTechniques: payload.mitreTechniques, workflowId: payload.workflowId,
      autoRunDestructiveAck: payload.autoRunDestructiveAck, maxFiresPerHour: payload.maxFiresPerHour,
      // recentFires preserved across an edit — not part of the payload.
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "case", action: "case_autorun_rule_updated", actor: actorEmail,
    targetType: "case_autorun_rule", targetId: ruleId, targetName: updated.name,
    message: `Case Auto-Run rule "${updated.name}" updated by ${actorEmail}`,
  });
  return updated;
}

export async function deleteCaseAutoRunRule(workspaceSlug: string, ruleId: string, actorEmail: string) {
  const existing = await prisma.caseAutoRunRule.findFirst({ where: { workspaceSlug, id: ruleId } });
  if (!existing) throw new HttpError(404, "Case Auto-Run rule not found");
  await prisma.caseAutoRunRule.delete({ where: { id: ruleId } });
  await recordAuditEvent(workspaceSlug, {
    category: "case", action: "case_autorun_rule_deleted", actor: actorEmail, severity: "warning",
    targetType: "case_autorun_rule", targetId: ruleId, targetName: existing.name,
    message: `Case Auto-Run rule "${existing.name}" deleted by ${actorEmail}`,
  });
  return { status: "ok" };
}

export interface CaseAutorunTarget {
  id: string;
  title: string;
  deviceId: string | null;
  severity: string;
  mitreTechniques: string[];
}

/**
 * Evaluated once, right after a manually-created Case is saved. Walks
 * enabled rules in list order, first match wins. A rule "matches but can't
 * fire" (no device, missing workflow, destructive-unacked, rate cap hit)
 * stops evaluation rather than falling through to a weaker rule. Port of
 * `_try_case_autorun` (main.py:12577-12651).
 */
export async function tryCaseAutorun(workspaceSlug: string, kase: CaseAutorunTarget, authorization: string | null | undefined): Promise<PublicRunView | null> {
  if (!kase.deviceId || !authorization) return null;
  const rules = await prisma.caseAutoRunRule.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
  if (!rules.length) return null;

  const severityRank = CASE_SEVERITY_RANK[kase.severity] ?? 1;
  const caseTechniques = new Set(kase.mitreTechniques ?? []);

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (severityRank < (CASE_SEVERITY_RANK[rule.minSeverity] ?? 2)) continue;
    const ruleTechniques: string[] = rule.mitreTechniques ?? [];
    if (ruleTechniques.length && !ruleTechniques.some((t) => caseTechniques.has(t))) continue;

    const workflow = await prisma.workflow.findFirst({ where: { workspaceSlug, id: rule.workflowId } });
    if (!workflow) return null; // matched but misconfigured — don't fall through
    if (workflowHasDestructiveStep(workflow) && !rule.autoRunDestructiveAck) return null;

    const now = new Date();
    const cutoff = now.getTime() - 3600_000;
    const recentFires = ((rule.recentFires as string[]) ?? []).filter((ts) => {
      const dt = new Date(ts);
      return !Number.isNaN(dt.getTime()) && dt.getTime() >= cutoff;
    });
    const maxPerHour = rule.maxFiresPerHour || 10;
    if (recentFires.length >= maxPerHour) {
      await recordAuditEvent(workspaceSlug, {
        category: "case", action: "case_autorun_rate_limited", actor: "system", severity: "warning",
        targetType: "case", targetId: kase.id, targetName: kase.title,
        message: `Case Auto-Run rule "${rule.name}" matched case "${kase.title}" but hit its ${maxPerHour}/hour rate cap — not fired`,
      });
      return null;
    }

    const devicesResp = await getDevicesFull(authorization, workspaceSlug, false);
    const device = devicesResp.items.find((d) => d.id === kase.deviceId);
    if (!device) return null;

    const deviceRef: WorkflowDeviceRefPayload = {
      id: device.id, displayName: device.displayName, platform: device.platform, platformDeviceId: device.platformDeviceId,
    };
    const runRecord = await launchWorkflowRun(workflow, [deviceRef], authorization, workspaceSlug);
    if (runRecord === null) return null;

    recentFires.push(now.toISOString());
    await prisma.caseAutoRunRule.update({ where: { id: rule.id }, data: { recentFires: recentFires.slice(-200) as any } });

    await recordAuditEvent(workspaceSlug, {
      category: "case", action: "case_autorun_fired", actor: "system",
      targetType: "case", targetId: kase.id, targetName: kase.title,
      message: `Case Auto-Run rule "${rule.name}" auto-ran "${workflow.name}" against ${device.displayName} for case "${kase.title}"`,
    });
    return runRecord;
  }
  return null;
}
