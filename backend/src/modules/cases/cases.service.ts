import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { isKnownMitreTechnique } from "../compliance/complianceFields";
import { getDevicesFull } from "../devices/devices.service";
import { launchWorkflowRun, workflowHasDestructiveStep } from "../workflows/workflows.service";
import type { WorkflowDeviceRefPayload } from "../workflows/workflows.schemas";
import {
  decryptIntegrationConfigForDispatch, dispatchCaseIntegrations, syncCaseTicketRefs,
  type DispatchableCase,
} from "../integrations/integrations.service";
import type { ExternalRef } from "../integrations/integrations.schemas";
import { extractIocCandidates, runThreatIntelLookup } from "../threatIntel/threatIntel.service";
import type { ThreatIntelResult } from "../threatIntel/threatIntel.schemas";
import { tryCaseAutorun } from "./caseAutoRun.service";
import {
  CASE_OPEN_STATUSES, CASE_SEVERITIES, CASE_STATUSES, isOpenCaseStatus,
  type CaseBulkUpdatePayload, type CaseCreatePayload, type CaseSlaSettingsPayload, type CaseUpdatePayload,
} from "./cases.schemas";

/**
 * The incident layer above raw Compliance Violations — port of main.py's
 * CASE MANAGEMENT section (main.py:11779-12360, 12440-12459). See
 * cases.schemas.ts for the payload shapes and schema.prisma's Case model
 * comment for the field-by-field mapping.
 */

type PrismaCase = Awaited<ReturnType<typeof prisma.case.findFirstOrThrow>>;

// ── Timeline (port of `_case_timeline_entry`, main.py:11816) ──

export async function addCaseTimelineEntry(caseId: string, type: string, message: string, actor?: string | null): Promise<void> {
  await prisma.caseTimelineEntry.create({ data: { caseId, type, message, actor: actor ?? "system" } });
}

// ── Serialization ──

const DEFAULT_CASE_SLA_THRESHOLDS: Record<string, { acknowledgeMinutes: number; resolveMinutes: number }> = {
  low: { acknowledgeMinutes: 480, resolveMinutes: 4320 }, // 8h / 3d
  medium: { acknowledgeMinutes: 240, resolveMinutes: 1440 }, // 4h / 1d
  high: { acknowledgeMinutes: 60, resolveMinutes: 480 }, // 1h / 8h
  critical: { acknowledgeMinutes: 15, resolveMinutes: 240 }, // 15m / 4h
};

export interface CaseSlaStatus {
  ackDueAt: string | null;
  ackBreached: boolean;
  resolveDueAt: string | null;
  resolveBreached: boolean;
}

/** Pure function, no I/O — safe to call once per case on every read. Port of `_case_sla_status` (main.py:12402-12429). */
export function caseSlaStatus(
  kase: { slaClockStartedAt: Date | null; createdAt: Date; acknowledgedAt: Date | null; status: string; severity: string },
  thresholds: Record<string, { acknowledgeMinutes: number; resolveMinutes: number }>,
): CaseSlaStatus {
  const result: CaseSlaStatus = { ackDueAt: null, ackBreached: false, resolveDueAt: null, resolveBreached: false };
  const anchor = kase.slaClockStartedAt ?? kase.createdAt;
  if (!anchor) return result;
  const sla = thresholds[kase.severity] ?? DEFAULT_CASE_SLA_THRESHOLDS[kase.severity] ?? DEFAULT_CASE_SLA_THRESHOLDS.medium;
  const now = Date.now();

  if (!kase.acknowledgedAt) {
    const ackDue = new Date(anchor.getTime() + sla.acknowledgeMinutes * 60_000);
    result.ackDueAt = ackDue.toISOString();
    result.ackBreached = now > ackDue.getTime();
  }
  if (isOpenCaseStatus(kase.status)) {
    const resolveDue = new Date(anchor.getTime() + sla.resolveMinutes * 60_000);
    result.resolveDueAt = resolveDue.toISOString();
    result.resolveBreached = now > resolveDue.getTime();
  }
  return result;
}

function backfillThresholds(thresholds: Record<string, any>): Record<string, { acknowledgeMinutes: number; resolveMinutes: number }> {
  const result = { ...(thresholds ?? {}) };
  for (const [sev, defaults] of Object.entries(DEFAULT_CASE_SLA_THRESHOLDS)) {
    if (!result[sev]) result[sev] = { ...defaults };
  }
  return result;
}

export async function getCaseSlaSettings(workspaceSlug: string) {
  const row = await prisma.caseSlaSettings.findUnique({ where: { workspaceSlug } });
  return {
    enabled: row?.enabled ?? true,
    notifyOnBreach: row?.notifyOnBreach ?? true,
    thresholds: backfillThresholds((row?.thresholds as Record<string, any>) ?? {}),
  };
}

export async function updateCaseSlaSettings(workspaceSlug: string, payload: CaseSlaSettingsPayload, actorEmail: string) {
  const thresholds: Record<string, { acknowledgeMinutes: number; resolveMinutes: number }> = {};
  for (const sev of CASE_SEVERITIES) {
    const t = payload.thresholds[sev];
    const defaults = DEFAULT_CASE_SLA_THRESHOLDS[sev];
    thresholds[sev] = {
      acknowledgeMinutes: t ? Math.max(1, t.acknowledgeMinutes) : defaults.acknowledgeMinutes,
      resolveMinutes: t ? Math.max(1, t.resolveMinutes) : defaults.resolveMinutes,
    };
  }
  const settings = { enabled: payload.enabled, notifyOnBreach: payload.notifyOnBreach, thresholds };
  await prisma.caseSlaSettings.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, enabled: settings.enabled, notifyOnBreach: settings.notifyOnBreach, thresholds: thresholds as any },
    update: { enabled: settings.enabled, notifyOnBreach: settings.notifyOnBreach, thresholds: thresholds as any },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "case_sla_updated", actor: actorEmail,
    message: `Case SLA settings updated by ${actorEmail} — ${payload.enabled ? "enabled" : "disabled"}`,
  });
  return settings;
}

async function serializeCase(kase: PrismaCase, thresholds?: Record<string, { acknowledgeMinutes: number; resolveMinutes: number }>) {
  const [notes, timeline] = await Promise.all([
    prisma.caseNote.findMany({ where: { caseId: kase.id }, orderBy: { createdAt: "asc" } }),
    prisma.caseTimelineEntry.findMany({ where: { caseId: kase.id }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    id: kase.id, title: kase.title, status: kase.status, severity: kase.severity, source: kase.source,
    deviceId: kase.deviceId, deviceName: kase.deviceName, segmentId: kase.segmentId,
    policyId: kase.policyId, policyName: kase.policyName,
    violationIds: kase.violationIds, workflowRunIds: kase.workflowRunIds,
    assignee: kase.assignee, createdBy: kase.createdBy,
    createdAt: kase.createdAt.toISOString(), updatedAt: kase.updatedAt.toISOString(),
    closedAt: kase.closedAt?.toISOString() ?? null, acknowledgedAt: kase.acknowledgedAt?.toISOString() ?? null,
    slaClockStartedAt: kase.slaClockStartedAt.toISOString(),
    slaAckBreachNotifiedAt: kase.slaAckBreachNotifiedAt?.toISOString() ?? null,
    slaResolveBreachNotifiedAt: kase.slaResolveBreachNotifiedAt?.toISOString() ?? null,
    mitreTechniques: kase.mitreTechniques,
    threatIntel: (kase.threatIntel as ThreatIntelResult[]) ?? [],
    externalRefs: (kase.externalRefs as ExternalRef[]) ?? [],
    notes: notes.map((n) => ({ id: n.id, authorEmail: n.authorEmail, text: n.text, createdAt: n.createdAt.toISOString() })),
    timeline: timeline.map((t) => ({ id: t.id, type: t.type, message: t.message, actor: t.actor, at: t.createdAt.toISOString() })),
    ...(thresholds ? { slaStatus: caseSlaStatus(kase, thresholds) } : {}),
  };
}

export function caseToDispatchable(kase: PrismaCase): DispatchableCase {
  return {
    id: kase.id, title: kase.title, severity: kase.severity, status: kase.status, source: kase.source,
    deviceName: kase.deviceName, policyName: kase.policyName, externalRefs: (kase.externalRefs as ExternalRef[]) ?? [],
  };
}

/** Fetches the case fresh, dispatches its integrations for `eventType`, and attaches any new ticket refs. Shared by create/update/retry/trigger-open/compliance-auto-resolve. */
export async function dispatchAndAttachCaseEvent(workspaceSlug: string, caseId: string, eventType: "created" | "reopened" | "closed"): Promise<void> {
  const kase = await prisma.case.findUnique({ where: { id: caseId } });
  if (!kase) return;
  const refs = await dispatchCaseIntegrations(workspaceSlug, caseToDispatchable(kase), eventType);
  if (refs.length) await attachExternalRefs(caseId, refs);
}

/** Port of `_attach_external_refs` (main.py:13878-13888). */
async function attachExternalRefs(caseId: string, refs: ExternalRef[]): Promise<void> {
  const kase = await prisma.case.findUnique({ where: { id: caseId } });
  if (!kase) return;
  const existing = (kase.externalRefs as ExternalRef[]) ?? [];
  await prisma.case.update({ where: { id: caseId }, data: { externalRefs: [...existing, ...refs] as any, updatedAt: new Date() } });
  for (const ref of refs) {
    await addCaseTimelineEntry(caseId, "note_added", `Ticket created: ${ref.type} ${ref.id}`);
  }
}

/**
 * Scans `text` for IOC-looking tokens and, if any are found and at least one
 * Threat Intel provider is configured, runs enrichment automatically.
 * Mutates the case's threatIntel/timeline directly in Postgres. Best-effort
 * — provider failures already degrade to an 'error' verdict entry inside
 * runThreatIntelLookup. Port of `_auto_enrich_case_from_text` (main.py:14074-14108).
 */
async function autoEnrichCaseFromText(workspaceSlug: string, caseId: string, text: string | null | undefined, actor: string | null): Promise<void> {
  const candidates = extractIocCandidates(text ?? "");
  if (!candidates.length) return;
  const providerCount = await prisma.threatIntelProvider.count({ where: { workspaceSlug } });
  if (providerCount === 0) return;

  const kase = await prisma.case.findUnique({ where: { id: caseId } });
  if (!kase) return;
  const existingIntel = (kase.threatIntel as ThreatIntelResult[]) ?? [];
  const alreadyChecked = new Set(existingIntel.map((r) => (r.ioc ?? "").toLowerCase()));
  let added: ThreatIntelResult[] = [];
  let changed = false;

  for (const iocValue of candidates) {
    if (alreadyChecked.has(iocValue.toLowerCase())) continue;
    let results: ThreatIntelResult[];
    try {
      results = await runThreatIntelLookup(workspaceSlug, iocValue, actor ?? "system");
    } catch {
      continue;
    }
    if (!results.length) continue;
    added = added.concat(results);
    const verdicts = new Set(results.filter((r) => r.provider).map((r) => r.verdict));
    const summary = verdicts.has("malicious") ? "malicious" : verdicts.has("suspicious") ? "suspicious" : verdicts.size ? "clean" : "no result";
    await addCaseTimelineEntry(caseId, "note_added", `Threat intel: auto-detected "${iocValue}" and enriched it — ${summary}`, "system");
    alreadyChecked.add(iocValue.toLowerCase());
    changed = true;
  }
  if (changed) {
    await prisma.case.update({ where: { id: caseId }, data: { threatIntel: [...existingIntel, ...added] as any, updatedAt: new Date() } });
  }
}

// ── CRUD (main.py:11961-12349) ──

export async function listCases(workspaceSlug: string) {
  const [cases, settings] = await Promise.all([
    prisma.case.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "desc" } }),
    getCaseSlaSettings(workspaceSlug),
  ]);
  return { items: await Promise.all(cases.map((c) => serializeCase(c, settings.thresholds))) };
}

export async function exportCasesCsv(workspaceSlug: string): Promise<string> {
  const cases = await prisma.case.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
  const notesCounts = await prisma.caseNote.groupBy({ by: ["caseId"], where: { caseId: { in: cases.map((c) => c.id) } }, _count: { id: true } });
  const notesCountByCase = new Map(notesCounts.map((n) => [n.caseId, n._count.id]));
  const rows: string[][] = [["Created At", "Closed At", "Title", "Status", "Severity", "Source", "Device", "Assignee", "Policy", "Notes Count"]];
  for (const c of cases) {
    rows.push([
      c.createdAt.toISOString(), c.closedAt?.toISOString() ?? "", c.title, c.status, c.severity, c.source,
      c.deviceName ?? "", c.assignee ?? "", c.policyName ?? "", String(notesCountByCase.get(c.id) ?? 0),
    ]);
  }
  return rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

/** Distinct actor emails recently seen in this workspace's audit log — "the audit trail IS the roster" (main.py:11989-12004). */
export async function caseAssigneeSuggestions(workspaceSlug: string): Promise<{ items: string[] }> {
  const entries = await prisma.auditLogEntry.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "desc" }, take: 500, select: { actor: true } });
  const seen: string[] = [];
  for (const e of entries) {
    if (e.actor && e.actor !== "system" && !seen.includes(e.actor)) seen.push(e.actor);
    if (seen.length >= 20) break;
  }
  return { items: seen };
}

export async function getCase(workspaceSlug: string, caseId: string) {
  const kase = await prisma.case.findFirst({ where: { workspaceSlug, id: caseId } });
  if (!kase) throw new HttpError(404, "Case not found");
  const settings = await getCaseSlaSettings(workspaceSlug);
  return serializeCase(kase, settings.thresholds);
}

export async function createCase(
  workspaceSlug: string,
  payload: CaseCreatePayload,
  actorEmail: string,
  authorization: string | null,
) {
  if (!(CASE_SEVERITIES as readonly string[]).includes(payload.severity)) {
    throw new HttpError(400, `severity must be one of ${JSON.stringify(CASE_SEVERITIES)}`);
  }
  const mitreTechniques = (payload.mitreTechniques ?? []).filter(isKnownMitreTechnique);

  const created = await prisma.case.create({
    data: {
      workspaceSlug, title: payload.title, status: "open", severity: payload.severity, source: "manual",
      deviceId: payload.deviceId ?? null, deviceName: payload.deviceName ?? null,
      createdBy: actorEmail, mitreTechniques, threatIntel: [], externalRefs: [],
    },
  });
  await addCaseTimelineEntry(created.id, "created", `Case opened manually by ${actorEmail}`, actorEmail);
  if (payload.notes && payload.notes.trim()) {
    await prisma.caseNote.create({ data: { caseId: created.id, authorEmail: actorEmail, text: payload.notes.trim() } });
  }
  await recordAuditEvent(workspaceSlug, {
    category: "case", action: "case_created", actor: actorEmail,
    targetType: "case", targetId: created.id, targetName: created.title,
    message: `Case "${created.title}" opened manually by ${actorEmail}`,
  });

  await dispatchAndAttachCaseEvent(workspaceSlug, created.id, "created");
  await autoEnrichCaseFromText(workspaceSlug, created.id, payload.notes, actorEmail);

  // Case Auto-Run Rules — best-effort, a rule failing to fire shouldn't
  // block the Case itself from being created (main.py:12057-12070).
  if (authorization) {
    try {
      const runRecord = await tryCaseAutorun(workspaceSlug, await prisma.case.findUniqueOrThrow({ where: { id: created.id } }), authorization);
      if (runRecord) {
        await prisma.case.update({ where: { id: created.id }, data: { workflowRunIds: { push: runRecord.id }, updatedAt: new Date() } });
        await addCaseTimelineEntry(created.id, "workflow_run_linked", `Auto-ran a workflow via Case Auto-Run rule (run ${runRecord.id.slice(0, 8)})`);
      }
    } catch (e) {
      console.error(`[Case Auto-Run] Error evaluating rules for case ${created.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const settings = await getCaseSlaSettings(workspaceSlug);
  const final = await prisma.case.findUniqueOrThrow({ where: { id: created.id } });
  return serializeCase(final, settings.thresholds);
}

export async function updateCase(workspaceSlug: string, caseId: string, payload: CaseUpdatePayload, actorEmail: string) {
  const kase = await prisma.case.findFirst({ where: { workspaceSlug, id: caseId } });
  if (!kase) throw new HttpError(404, "Case not found");
  const now = new Date();
  const data: Record<string, unknown> = {};

  if (payload.title !== undefined && payload.title !== null && payload.title !== kase.title) {
    data.title = payload.title;
  }
  if (payload.severity !== undefined && payload.severity !== null && payload.severity !== kase.severity) {
    if (!(CASE_SEVERITIES as readonly string[]).includes(payload.severity)) {
      throw new HttpError(400, `severity must be one of ${JSON.stringify(CASE_SEVERITIES)}`);
    }
    await addCaseTimelineEntry(caseId, "severity_changed", `Severity changed from ${kase.severity} to ${payload.severity}`, actorEmail);
    data.severity = payload.severity;
  }

  let newAcknowledgedAt: Date | null | undefined;
  if (payload.assignee !== undefined && payload.assignee !== null && payload.assignee !== kase.assignee) {
    await addCaseTimelineEntry(caseId, "assigned", payload.assignee ? `Assigned to ${payload.assignee}` : "Unassigned", actorEmail);
    data.assignee = payload.assignee || null;
    // First assignee is treated as "acknowledged" for SLA purposes.
    if (!kase.acknowledgedAt && payload.assignee) newAcknowledgedAt = now;
  }

  if (payload.mitreTechniques !== undefined && payload.mitreTechniques !== null) {
    const cleaned = payload.mitreTechniques.filter(isKnownMitreTechnique);
    if (JSON.stringify(cleaned) !== JSON.stringify(kase.mitreTechniques)) {
      await addCaseTimelineEntry(caseId, "note_added", `MITRE ATT&CK tags updated by ${actorEmail}`, actorEmail);
      data.mitreTechniques = cleaned;
    }
  }

  let notifyEvent: "closed" | "reopened" | null = null;
  if (payload.status !== undefined && payload.status !== null && payload.status !== kase.status) {
    if (!(CASE_STATUSES as readonly string[]).includes(payload.status)) {
      throw new HttpError(400, `status must be one of ${JSON.stringify(CASE_STATUSES)}`);
    }
    const wasClosed = !isOpenCaseStatus(kase.status);
    const nowClosed = !isOpenCaseStatus(payload.status);
    await addCaseTimelineEntry(caseId, "status_changed", `Status changed from ${kase.status} to ${payload.status}`, actorEmail);
    data.status = payload.status;
    if (!kase.acknowledgedAt && newAcknowledgedAt === undefined && payload.status === "investigating") newAcknowledgedAt = now;
    if (nowClosed && !wasClosed) {
      data.closedAt = now;
      notifyEvent = "closed";
    } else if (!nowClosed && wasClosed) {
      data.closedAt = null;
      notifyEvent = "reopened";
      newAcknowledgedAt = null;
      data.slaClockStartedAt = now;
      data.slaAckBreachNotifiedAt = null;
      data.slaResolveBreachNotifiedAt = null;
    }
  }
  if (newAcknowledgedAt !== undefined) data.acknowledgedAt = newAcknowledgedAt;

  data.updatedAt = now;
  await prisma.case.update({ where: { id: caseId }, data });
  await recordAuditEvent(workspaceSlug, {
    category: "case", action: "case_updated", actor: actorEmail,
    targetType: "case", targetId: caseId, targetName: (data.title as string) ?? kase.title,
    message: `Case "${(data.title as string) ?? kase.title}" updated by ${actorEmail}`,
  });

  if (notifyEvent) await dispatchAndAttachCaseEvent(workspaceSlug, caseId, notifyEvent);

  const settings = await getCaseSlaSettings(workspaceSlug);
  const final = await prisma.case.findUniqueOrThrow({ where: { id: caseId } });
  return serializeCase(final, settings.thresholds);
}

export async function runWorkflowFromCase(
  workspaceSlug: string,
  caseId: string,
  workflowId: string,
  authorization: string,
  actorEmail: string,
  isSuperAdmin: boolean,
  canRunDestructiveWorkflow: boolean,
) {
  const kase = await prisma.case.findFirst({ where: { workspaceSlug, id: caseId } });
  if (!kase) throw new HttpError(404, "Case not found");
  if (!kase.deviceId) throw new HttpError(400, "This case has no linked device to target");

  const workflow = await prisma.workflow.findFirst({ where: { workspaceSlug, id: workflowId } });
  if (!workflow) throw new HttpError(404, "Workflow not found");
  if (workflowHasDestructiveStep(workflow) && !isSuperAdmin && !canRunDestructiveWorkflow) {
    throw new HttpError(403, "This workflow contains a destructive MDM action (wipe/unenroll/etc.) — your role isn't permitted to run destructive workflows.");
  }

  const devicesRes = await getDevicesFull(authorization, workspaceSlug, false);
  const device = devicesRes.items.find((d) => d.id === kase.deviceId);
  if (!device) throw new HttpError(404, "Linked device was not found in the current fleet (it may have been unenrolled)");

  const deviceRef: WorkflowDeviceRefPayload = {
    id: device.id, displayName: device.displayName, platform: device.platform, platformDeviceId: device.platformDeviceId,
  };
  const runRecord = await launchWorkflowRun(workflow, [deviceRef], authorization, workspaceSlug);
  if (runRecord === null) {
    throw new HttpError(400, "This workflow includes a 'wait' or 'run script and wait for result' step, which requires durable storage. Set DATABASE_URL on the server to enable it.");
  }

  await prisma.case.update({ where: { id: caseId }, data: { workflowRunIds: { push: runRecord.id }, updatedAt: new Date() } });
  await addCaseTimelineEntry(caseId, "workflow_run_linked", `${actorEmail} ran "${workflow.name}" against ${device.displayName}`, actorEmail);
  await recordAuditEvent(workspaceSlug, {
    category: "case", action: "case_workflow_run", actor: actorEmail,
    targetType: "case", targetId: caseId, targetName: kase.title,
    message: `Workflow "${workflow.name}" run against ${device.displayName} from case "${kase.title}"`,
  });
  const final = await prisma.case.findUniqueOrThrow({ where: { id: caseId } });
  return { case: await serializeCase(final), runId: runRecord.id };
}

export async function retryCaseIntegrations(workspaceSlug: string, caseId: string, actorEmail: string) {
  const kase = await prisma.case.findFirst({ where: { workspaceSlug, id: caseId } });
  if (!kase) throw new HttpError(404, "Case not found");
  const eventType = isOpenCaseStatus(kase.status) ? "created" : "closed";
  await dispatchAndAttachCaseEvent(workspaceSlug, caseId, eventType);
  await prisma.case.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
  await recordAuditEvent(workspaceSlug, {
    category: "case", action: "integration_retry", actor: actorEmail,
    targetType: "case", targetId: caseId, targetName: kase.title,
    message: `Integration dispatch retried for case "${kase.title}" by ${actorEmail}`,
  });
  const final = await prisma.case.findUniqueOrThrow({ where: { id: caseId } });
  return serializeCase(final);
}

export async function syncCaseTicketStatus(workspaceSlug: string, caseId: string, actorEmail: string) {
  const kase = await prisma.case.findFirst({ where: { workspaceSlug, id: caseId } });
  if (!kase) throw new HttpError(404, "Case not found");
  const refs = (kase.externalRefs as ExternalRef[]) ?? [];
  if (!refs.some((r) => r.type === "jira" || r.type === "servicenow")) {
    throw new HttpError(400, "This case has no linked Jira or ServiceNow ticket to sync");
  }

  const integrations = await prisma.integration.findMany({ where: { workspaceSlug, type: { in: ["jira", "servicenow"] } } });
  const integrationsByType = new Map(integrations.map((i) => [i.type, { type: i.type, config: decryptIntegrationConfigForDispatch(i.type, (i.config as Record<string, any>) ?? {}) }]));
  const { refs: updatedRefs, newlyResolved } = await syncCaseTicketRefs(refs, integrationsByType);

  let autoClosed = false;
  const kaseNow = await prisma.case.findUniqueOrThrow({ where: { id: caseId } });
  if (newlyResolved.length && isOpenCaseStatus(kaseNow.status)) {
    const ref = newlyResolved[0];
    const integ = integrations.find((i) => i.type === ref.type);
    if (integ?.autoCloseCaseOnRemoteResolve) {
      await prisma.case.update({ where: { id: caseId }, data: { status: "resolved", closedAt: new Date(), externalRefs: updatedRefs as any, updatedAt: new Date() } });
      await addCaseTimelineEntry(caseId, "status_changed", `Auto-resolved — linked ${(ref.type ?? "").replace(/^./, (c) => c.toUpperCase())} ticket ${ref.id} was marked done externally`);
      autoClosed = true;
    } else {
      await prisma.case.update({ where: { id: caseId }, data: { externalRefs: updatedRefs as any, updatedAt: new Date() } });
      await addCaseTimelineEntry(caseId, "note_added", `Linked ${(ref.type ?? "").replace(/^./, (c) => c.toUpperCase())} ticket ${ref.id} is now marked done externally (auto-close is off for this integration)`);
    }
  } else {
    await prisma.case.update({ where: { id: caseId }, data: { externalRefs: updatedRefs as any, updatedAt: new Date() } });
  }

  await recordAuditEvent(workspaceSlug, {
    category: "case", action: "case_ticket_synced", actor: actorEmail,
    targetType: "case", targetId: caseId, targetName: kase.title,
    message: `Ticket status synced for case "${kase.title}" by ${actorEmail}` + (autoClosed ? " — auto-resolved" : ""),
  });
  const final = await prisma.case.findUniqueOrThrow({ where: { id: caseId } });
  return { case: await serializeCase(final), autoClosed };
}

export async function bulkUpdateCases(workspaceSlug: string, payload: CaseBulkUpdatePayload, actorEmail: string) {
  if (payload.status === undefined || payload.status === null) {
    if (payload.assignee === undefined || payload.assignee === null) {
      throw new HttpError(400, "Provide at least one of status or assignee");
    }
  }
  const updated: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const cid of payload.caseIds) {
    try {
      await updateCase(workspaceSlug, cid, { status: payload.status ?? null, assignee: payload.assignee ?? null }, actorEmail);
      updated.push(cid);
    } catch (e) {
      failed.push({ id: cid, error: e instanceof HttpError ? String(e.detail) : String(e) });
    }
  }
  return { updated, failed };
}

export async function addCaseNote(workspaceSlug: string, caseId: string, text: string, actorEmail: string) {
  if (!text || !text.trim()) throw new HttpError(400, "Note text is required");
  const kase = await prisma.case.findFirst({ where: { workspaceSlug, id: caseId } });
  if (!kase) throw new HttpError(404, "Case not found");
  await prisma.caseNote.create({ data: { caseId, authorEmail: actorEmail, text: text.trim() } });
  await addCaseTimelineEntry(caseId, "note_added", `${actorEmail} added a note`, actorEmail);
  await prisma.case.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
  await autoEnrichCaseFromText(workspaceSlug, caseId, text, actorEmail);
  const final = await prisma.case.findUniqueOrThrow({ where: { id: caseId } });
  return serializeCase(final);
}

export async function enrichCase(workspaceSlug: string, caseId: string, value: string, forceRefresh: boolean, actorEmail: string) {
  if (!value || !value.trim()) throw new HttpError(400, "value is required");
  const kase = await prisma.case.findFirst({ where: { workspaceSlug, id: caseId } });
  if (!kase) throw new HttpError(404, "Case not found");
  const iocValue = value.trim();

  const providerCount = await prisma.threatIntelProvider.count({ where: { workspaceSlug } });
  if (providerCount === 0) throw new HttpError(400, "No threat intel providers configured yet — add one under Settings > Threat Intel.");

  const existingIntel = (kase.threatIntel as ThreatIntelResult[]) ?? [];
  if (!forceRefresh) {
    const already = existingIntel.find((r) => (r.ioc ?? "").toLowerCase() === iocValue.toLowerCase());
    if (already) throw new HttpError(409, `'${iocValue}' was already checked on this case (${already.checkedAt ?? "earlier"}) — use force refresh to re-check.`);
  }

  const results = await runThreatIntelLookup(workspaceSlug, iocValue, actorEmail, !forceRefresh);
  const verdicts = new Set(results.filter((r) => r.provider).map((r) => r.verdict));
  const summary = verdicts.has("malicious") ? "malicious" : verdicts.has("suspicious") ? "suspicious" : verdicts.size ? "clean" : "no result";
  await prisma.case.update({ where: { id: caseId }, data: { threatIntel: [...existingIntel, ...results] as any, updatedAt: new Date() } });
  await addCaseTimelineEntry(caseId, "note_added", `Threat intel: ${iocValue} enriched by ${actorEmail} — ${summary} (${results.length} provider result${results.length !== 1 ? "s" : ""})`, actorEmail);
  const final = await prisma.case.findUniqueOrThrow({ where: { id: caseId } });
  return serializeCase(final);
}

// ── Upsert/recovery from Compliance evaluation (main.py:11825-11936) ──

export interface CasePolicyRef {
  id: string;
  name: string;
  severity: string | null;
  mitreTechniques: string[];
}
export interface CaseDeviceRef {
  id: string;
  displayName: string | null;
  segmentId?: unknown;
}

/**
 * Called once per NEW violation from inside the compliance evaluation loop.
 * Returns the case id and, if the case newly opened/reopened, the notify
 * event the caller should dispatch AFTER the whole evaluation pass finishes
 * (dispatching real HTTP calls per device inline would defeat the point of
 * batching). Port of `_upsert_case_for_violation_inmem` (main.py:11825-11912).
 */
export async function upsertCaseForViolation(
  workspaceSlug: string,
  policy: CasePolicyRef,
  device: CaseDeviceRef,
  violationId: string,
): Promise<{ caseId: string; notifyEvent: "created" | "reopened" | null }> {
  const nowIso = new Date();
  const existing = await prisma.case.findFirst({
    where: { workspaceSlug, policyId: policy.id, deviceId: device.id, status: { in: [...CASE_OPEN_STATUSES] } },
  });
  if (existing) {
    await prisma.case.update({ where: { id: existing.id }, data: { violationIds: { push: violationId }, updatedAt: nowIso } });
    await addCaseTimelineEntry(existing.id, "violation_linked", `New violation detected — case re-triggered (${existing.violationIds.length + 1} total)`);
    return { caseId: existing.id, notifyEvent: null };
  }

  const closedMatch = await prisma.case.findFirst({
    where: { workspaceSlug, policyId: policy.id, deviceId: device.id, status: { notIn: [...CASE_OPEN_STATUSES] } },
    orderBy: { updatedAt: "desc" },
  });
  if (closedMatch) {
    await prisma.case.update({
      where: { id: closedMatch.id },
      data: {
        status: "open", closedAt: null, updatedAt: nowIso, violationIds: { push: violationId },
        acknowledgedAt: null, slaClockStartedAt: nowIso, slaAckBreachNotifiedAt: null, slaResolveBreachNotifiedAt: null,
        mitreTechniques: policy.mitreTechniques ?? [],
      },
    });
    await addCaseTimelineEntry(closedMatch.id, "reopened", "Violation recurred — case reopened");
    return { caseId: closedMatch.id, notifyEvent: "reopened" };
  }

  const created = await prisma.case.create({
    data: {
      workspaceSlug, title: `${device.displayName ?? device.id} — ${policy.name}`, status: "open",
      severity: policy.severity ?? "medium", source: "compliance_violation",
      deviceId: device.id, deviceName: device.displayName, segmentId: device.segmentId != null ? String(device.segmentId) : null,
      policyId: policy.id, policyName: policy.name, violationIds: [violationId], workflowRunIds: [],
      createdBy: "system", slaClockStartedAt: nowIso, mitreTechniques: policy.mitreTechniques ?? [],
      threatIntel: [], externalRefs: [],
    },
  });
  await addCaseTimelineEntry(created.id, "created", `Case opened — "${policy.name}" violated by ${device.displayName ?? device.id}`);
  return { caseId: created.id, notifyEvent: "created" };
}

/** Companion to upsertCaseForViolation, called from the compliance recovery branch. Port of `_mark_case_recovered_inmem` (main.py:11914-11936). */
export async function markCaseRecovered(
  workspaceSlug: string,
  violationId: string | null | undefined,
  autoResolve: boolean,
): Promise<{ caseId: string; notifyEvent: "closed" | null } | null> {
  if (!violationId) return null;
  const kase = await prisma.case.findFirst({
    where: { workspaceSlug, violationIds: { has: violationId }, status: { in: [...CASE_OPEN_STATUSES] } },
  });
  if (!kase) return null;
  if (autoResolve) {
    await prisma.case.update({ where: { id: kase.id }, data: { status: "resolved", closedAt: new Date(), updatedAt: new Date() } });
    await addCaseTimelineEntry(kase.id, "status_changed", "Device no longer violates the linked policy — case auto-resolved (policy has autoResolveCaseOnRecovery on)");
    return { caseId: kase.id, notifyEvent: "closed" };
  }
  await prisma.case.update({ where: { id: kase.id }, data: { updatedAt: new Date() } });
  await addCaseTimelineEntry(kase.id, "device_recovered", "Device no longer violates the linked policy — case left open for confirmation");
  return { caseId: kase.id, notifyEvent: null };
}

/** Opens a Case from an inbound Trigger fire (source='workflow_trigger'). Port of the case-opening block inside `fire_trigger` (main.py:12873-12896). */
export async function openCaseForTrigger(
  workspaceSlug: string,
  triggerName: string,
  workflowName: string,
  runId: string,
  caseSeverity: string,
  matchedDevice: { id: string; displayName: string | null; segmentId?: unknown } | null,
): Promise<string> {
  const title = `Trigger: ${triggerName}` + (matchedDevice ? ` — ${matchedDevice.displayName}` : "");
  const created = await prisma.case.create({
    data: {
      workspaceSlug, title, status: "open", severity: caseSeverity || "medium", source: "workflow_trigger",
      deviceId: matchedDevice?.id ?? null, deviceName: matchedDevice?.displayName ?? null,
      segmentId: matchedDevice?.segmentId != null ? String(matchedDevice.segmentId) : null,
      workflowRunIds: [runId], createdBy: "system", threatIntel: [], externalRefs: [],
    },
  });
  await addCaseTimelineEntry(created.id, "created", `Case opened by inbound trigger "${triggerName}" — ran workflow "${workflowName}"`);
  await dispatchAndAttachCaseEvent(workspaceSlug, created.id, "created");
  return created.id;
}
