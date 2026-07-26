import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { addCaseTimelineEntry, caseSlaStatus, caseToDispatchable, getCaseSlaSettings } from "./cases.service";
import { decryptIntegrationConfigForDispatch, dispatchCaseSlaBreach, syncCaseTicketRefs } from "../integrations/integrations.service";
import type { ExternalRef } from "../integrations/integrations.schemas";
import { CASE_OPEN_STATUSES } from "./cases.schemas";

/**
 * The two Case-related background jobs — port of `ticket_status_sync_loop`
 * (main.py:15813-15867) and `case_sla_monitor_loop` (main.py:15881-15932).
 * Both are per-workspace, plain interval loops wired into
 * jobs/backgroundJobs.ts's JOBS array, same pattern as every other
 * background job in this app.
 */

export const TICKET_SYNC_TICK_MS = 15 * 60_000; // 15 minutes — see main.py's TICKET_SYNC_TICK_SECONDS comment for why this polls instead of a webhook receiver
export const CASE_SLA_MONITOR_TICK_MS = 5 * 60_000; // 5 minutes — SLA windows here run minutes-to-hours, so this granularity is precise enough

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

async function workspacesWithIntegrations(): Promise<string[]> {
  const rows = await prisma.integration.findMany({ distinct: ["workspaceSlug"], select: { workspaceSlug: true } });
  return rows.map((r) => r.workspaceSlug);
}

async function workspacesWithCases(): Promise<string[]> {
  const rows = await prisma.case.findMany({ distinct: ["workspaceSlug"], select: { workspaceSlug: true } });
  return rows.map((r) => r.workspaceSlug);
}

/**
 * Inbound half of ticket sync — for every workspace with a Jira/ServiceNow
 * integration configured, pulls live status for every OPEN case's linked
 * ticket(s) from that same integration, auto-resolving the case when the
 * integration opts into it (autoCloseCaseOnRemoteResolve). Manual, on-demand
 * equivalent: POST /api/cases/{id}/sync-ticket-status.
 */
export async function runTicketStatusSyncTick(): Promise<void> {
  for (const workspaceSlug of await workspacesWithIntegrations()) {
    const integrations = await prisma.integration.findMany({ where: { workspaceSlug, type: { in: ["jira", "servicenow"] }, enabled: true } });
    if (!integrations.length) continue;
    const integrationsByType = new Map(
      integrations.map((i) => [i.type, { type: i.type, config: decryptIntegrationConfigForDispatch(i.type, (i.config as Record<string, any>) ?? {}) }]),
    );

    const openCases = await prisma.case.findMany({ where: { workspaceSlug, status: { in: [...CASE_OPEN_STATUSES] } } });
    for (const kase of openCases) {
      const refs = (kase.externalRefs as unknown as ExternalRef[]) ?? [];
      if (!refs.some((r) => integrationsByType.has(r.type))) continue;
      try {
        const { refs: updatedRefs, newlyResolved } = await syncCaseTicketRefs(refs, integrationsByType);
        await prisma.case.update({ where: { id: kase.id }, data: { externalRefs: updatedRefs as any, updatedAt: new Date() } });
        if (newlyResolved.length) {
          const ref = newlyResolved[0];
          const integ = integrations.find((i) => i.type === ref.type);
          if (integ?.autoCloseCaseOnRemoteResolve) {
            await prisma.case.update({ where: { id: kase.id }, data: { status: "resolved", closedAt: new Date() } });
            await addCaseTimelineEntry(kase.id, "note_added", `Auto-resolved — linked ${capitalize(ref.type)} ticket ${ref.id} was marked done externally`);
            await recordAuditEvent(workspaceSlug, {
              category: "case", action: "case_auto_resolved", actor: "system",
              targetType: "case", targetId: kase.id, targetName: kase.title,
              message: `Case "${kase.title}" auto-resolved — linked ${capitalize(ref.type)} ticket ${ref.id} was marked done externally`,
            });
          } else {
            await addCaseTimelineEntry(kase.id, "note_added", `Linked ${capitalize(ref.type)} ticket ${ref.id} is now marked done externally`);
          }
        }
      } catch (e) {
        console.warn(`[Ticket Sync] ${workspaceSlug} case ${kase.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

/**
 * Scans every workspace's OPEN cases each tick and, the moment a case's
 * acknowledge or resolve clock first crosses its configured threshold,
 * writes a critical Audit Log entry and — if notifyOnBreach is on — fires a
 * one-time chat/paging notification. 'First' is tracked via
 * slaAckBreachNotifiedAt/slaResolveBreachNotifiedAt stamped on the case, so
 * a case that's been breached for days doesn't renotify every tick.
 */
export async function runCaseSlaMonitorTick(): Promise<void> {
  for (const workspaceSlug of await workspacesWithCases()) {
    const settings = await getCaseSlaSettings(workspaceSlug);
    if (!settings.enabled) continue;
    const openCases = await prisma.case.findMany({ where: { workspaceSlug, status: { in: [...CASE_OPEN_STATUSES] } } });
    if (!openCases.length) continue;

    for (const kase of openCases) {
      const status = caseSlaStatus(kase, settings.thresholds);

      if (status.ackBreached && !kase.slaAckBreachNotifiedAt) {
        await prisma.case.update({ where: { id: kase.id }, data: { slaAckBreachNotifiedAt: new Date() } });
        await addCaseTimelineEntry(kase.id, "sla_breached", "Acknowledge SLA breached — no assignee or investigation started in time");
        await recordAuditEvent(workspaceSlug, {
          category: "case", action: "case_sla_ack_breached", actor: "system", severity: "critical",
          targetType: "case", targetId: kase.id, targetName: kase.title,
          message: `Case "${kase.title}" (${kase.severity}) breached its acknowledge SLA`,
        });
        if (settings.notifyOnBreach) await dispatchCaseSlaBreach(workspaceSlug, caseToDispatchable(kase), "acknowledge");
      }

      if (status.resolveBreached && !kase.slaResolveBreachNotifiedAt) {
        await prisma.case.update({ where: { id: kase.id }, data: { slaResolveBreachNotifiedAt: new Date() } });
        await addCaseTimelineEntry(kase.id, "sla_breached", "Resolve SLA breached — case still open past its due time");
        await recordAuditEvent(workspaceSlug, {
          category: "case", action: "case_sla_resolve_breached", actor: "system", severity: "critical",
          targetType: "case", targetId: kase.id, targetName: kase.title,
          message: `Case "${kase.title}" (${kase.severity}) breached its resolve SLA`,
        });
        if (settings.notifyOnBreach) await dispatchCaseSlaBreach(workspaceSlug, caseToDispatchable(kase), "resolve");
      }
    }
  }
}
