import { prisma } from "../../services/prisma";
import { runComplianceEvaluation } from "./compliance.service";
import { HttpError } from "../../utils/httpError";

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

  // Workspaces that had due policies this tick but couldn't actually be
  // evaluated (no/expired Automation Credential, or the evaluation itself
  // threw). Previously these were silently `continue`d — the tick still
  // completed without throwing, so runJobOnce recorded a plain "ok"
  // heartbeat regardless of whether any real evaluation happened. A
  // workspace's autonomous policy evaluation (and therefore autoRun
  // workflow firing, which happens from inside runComplianceEvaluation)
  // could stop running indefinitely with zero visibility anywhere — not
  // the Settings > System Health dashboard, not even a server log line for
  // the credential-missing case. Collected here and thrown at the end so
  // it surfaces both there and in POST /api/compliance/evaluate-due's
  // response for anyone driving this from an external cron instead.
  const blocked: string[] = [];

  for (const workspaceSlug of await workspacesWithEnabledPolicies()) {
    const policies = await prisma.compliancePolicy.findMany({ where: { workspaceSlug, enabled: true } });
    const now = Date.now();
    const duePolicyIds = policies
      .filter((p) => !p.lastEvaluatedAt || now - p.lastEvaluatedAt.getTime() >= p.evaluationIntervalMinutes * 60_000)
      .map((p) => p.id);
    if (!duePolicyIds.length) continue;

    // No stored Automation Credential -> can't evaluate unattended (no bearer
    // to call the live devices API with) — same skip-if-unconfigured pattern
    // as the Vuln Service refresher and ticket-status-sync jobs, but now
    // reported rather than silently skipped since there was actually work
    // due.
    if (!automationWorkspaces.has(workspaceSlug)) {
      blocked.push(`${workspaceSlug} (no Automation Credential configured — Settings > Workspace Automation)`);
      continue;
    }

    const bearer = await getAutomationBearer(workspaceSlug);
    if (!bearer) {
      blocked.push(`${workspaceSlug} (Automation Credential could not be refreshed — needs reconfiguring)`);
      continue;
    }

    try {
      const summary = await runComplianceEvaluation(bearer, workspaceSlug, duePolicyIds, "system");
      console.log(`[Compliance Scheduler] ${workspaceSlug}: evaluated ${duePolicyIds.length} due polic${duePolicyIds.length === 1 ? "y" : "ies"} — ${JSON.stringify(summary)}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[Compliance Scheduler] ${workspaceSlug} failed: ${e}`);
      blocked.push(`${workspaceSlug} (${message})`.slice(0, 150));
    }
  }

  if (blocked.length) {
    throw new HttpError(
      502,
      `${blocked.length} workspace(s) with due Compliance Policies were not evaluated this tick: ${blocked.join("; ")}`.slice(0, 500),
    );
  }
}
