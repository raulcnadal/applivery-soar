import { prisma } from "../../services/prisma";
import { runComplianceEvaluation } from "./compliance.service";

/**
 * The Compliance scheduler — port of `compliance_scheduler_loop`
 * (ARCHITECTURE.md §2.5's background jobs table: "60s tick, per-policy
 * interval... evaluates only Compliance Policies whose own
 * evaluationIntervalMinutes is due"). This was the one job the module doc
 * comment on jobs/backgroundJobs.ts had flagged as "explicitly still NOT
 * started" pending Automation Credentials existing to drive it unattended
 * — those now exist (Phase 4b), so it's wired in for real here.
 *
 * Manual/on-demand equivalent: POST /api/compliance/evaluate (uses the
 * calling admin's own live session). External-cron equivalent (for anyone
 * who'd rather not rely on this container's own in-process loop — see
 * docs/README.md's TRIGGER_SECRET row): POST /api/compliance/evaluate-due,
 * secret-gated, calls this exact function.
 */
export const COMPLIANCE_SCHEDULER_TICK_MS = 60_000;

async function workspacesWithEnabledPolicies(): Promise<string[]> {
  const rows = await prisma.compliancePolicy.findMany({
    where: { enabled: true },
    distinct: ["workspaceSlug"],
    select: { workspaceSlug: true },
  });
  return rows.map((r) => r.workspaceSlug);
}

export async function runComplianceSchedulerTick(): Promise<void> {
  const { listAutomationWorkspaces, getAutomationBearer } = await import("../settings/automationCredential.service");
  const automationWorkspaces = new Set(await listAutomationWorkspaces());

  for (const workspaceSlug of await workspacesWithEnabledPolicies()) {
    // No stored Automation Credential -> can't evaluate unattended (no bearer
    // to call the live devices API with) — same skip-if-unconfigured pattern
    // as the Vuln Service refresher and ticket-status-sync jobs.
    if (!automationWorkspaces.has(workspaceSlug)) continue;

    const policies = await prisma.compliancePolicy.findMany({ where: { workspaceSlug, enabled: true } });
    const now = Date.now();
    const duePolicyIds = policies
      .filter((p) => !p.lastEvaluatedAt || now - p.lastEvaluatedAt.getTime() >= p.evaluationIntervalMinutes * 60_000)
      .map((p) => p.id);
    if (!duePolicyIds.length) continue;

    const bearer = await getAutomationBearer(workspaceSlug);
    if (!bearer) continue;

    try {
      const summary = await runComplianceEvaluation(bearer, workspaceSlug, duePolicyIds, "system");
      console.log(`[Compliance Scheduler] ${workspaceSlug}: evaluated ${duePolicyIds.length} due polic${duePolicyIds.length === 1 ? "y" : "ies"} — ${JSON.stringify(summary)}`);
    } catch (e) {
      console.warn(`[Compliance Scheduler] ${workspaceSlug} failed: ${e}`);
    }
  }
}
