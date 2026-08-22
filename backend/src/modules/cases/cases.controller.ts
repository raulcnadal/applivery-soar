import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { getCachedAccess, requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import {
  addCaseNote, bulkUpdateCases, caseAssigneeSuggestions, createCase, enrichCase, exportCasesCsv,
  getCase, getCaseSlaSettings, listCases, retryCaseIntegrations, runWorkflowFromCase, syncCaseTicketStatus,
  updateCase, updateCaseSlaSettings,
} from "./cases.service";
import { createCaseAutoRunRule, deleteCaseAutoRunRule, listCaseAutoRunRules, updateCaseAutoRunRule } from "./caseAutoRun.service";
import {
  caseAutoRunRuleSchema, caseBulkUpdateSchema, caseCreateSchema, caseEnrichSchema, caseNoteSchema,
  caseRunWorkflowSchema, caseSlaSettingsSchema, caseUpdateSchema,
} from "./cases.schemas";

/**
 * Case Management + SLA settings + Auto-Run Rules routes. Port of
 * main.py:11961-12349 (Case CRUD/notes/run-workflow/retry/sync-ticket/bulk),
 * main.py:12440-12459 (SLA settings), main.py:12511-12576 (Auto-Run Rules
 * CRUD), main.py:14326-14358 (enrich).
 */

export const casesRouter = Router();

const readGate = [verifyDashboardToken, requirePermission({ area: "cases", level: "read" })];
const manageGate = [verifyDashboardToken, requirePermission({ area: "cases", level: "manage" })];
const bulkTriageGate = [verifyDashboardToken, requirePermission({ area: "cases", level: "manage", action: "canBulkTriage" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

// ── Cases ──

casesRouter.get("/api/cases", ...readGate, asyncHandler(async (req, res) => {
  res.json(await listCases(workspaceOf(req)));
}));

casesRouter.get("/api/cases/export", ...readGate, asyncHandler(async (req, res) => {
  const workspaceSlug = workspaceOf(req);
  const csv = await exportCasesCsv(workspaceSlug);
  const filename = `cases-${workspaceSlug.replace(/[^a-zA-Z0-9_-]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.send(csv);
}));

casesRouter.get("/api/cases/assignee-suggestions", ...readGate, asyncHandler(async (req, res) => {
  res.json(await caseAssigneeSuggestions(workspaceOf(req)));
}));

casesRouter.get("/api/cases/:caseId", ...readGate, asyncHandler(async (req, res) => {
  res.json(await getCase(workspaceOf(req), req.params.caseId));
}));

casesRouter.post("/api/cases", ...manageGate, asyncHandler(async (req, res) => {
  const payload = caseCreateSchema.parse(req.body);
  const authorization = req.header("Authorization") ?? null;
  res.json(await createCase(workspaceOf(req), payload, actorOf(req), authorization));
}));

casesRouter.put("/api/cases/:caseId", ...manageGate, asyncHandler(async (req, res) => {
  const payload = caseUpdateSchema.parse(req.body);
  res.json(await updateCase(workspaceOf(req), req.params.caseId, payload, actorOf(req), req.header("Authorization")));
}));

casesRouter.post("/api/cases/:caseId/run-workflow", ...manageGate, asyncHandler(async (req, res) => {
  const authorization = req.header("Authorization");
  const workspaceSlug = workspaceOf(req);
  if (!authorization) throw new HttpError(401, "Missing credentials");
  const payload = caseRunWorkflowSchema.parse(req.body);
  // Base "cases: manage" access (checked above) is enough to run an
  // ordinary workflow; a destructive one additionally requires
  // canRunDestructiveWorkflow (main.py:12220-12221).
  const access = getCachedAccess(workspaceSlug, actorOf(req));
  res.json(await runWorkflowFromCase(
    workspaceSlug, req.params.caseId, payload.workflowId, authorization, actorOf(req),
    Boolean(access?.isSuperAdmin), Boolean(access?.role?.riskyActions?.canRunDestructiveWorkflow),
  ));
}));

casesRouter.post("/api/cases/:caseId/retry-integrations", ...manageGate, asyncHandler(async (req, res) => {
  res.json(await retryCaseIntegrations(workspaceOf(req), req.params.caseId, actorOf(req)));
}));

casesRouter.post("/api/cases/:caseId/sync-ticket-status", ...manageGate, asyncHandler(async (req, res) => {
  res.json(await syncCaseTicketStatus(workspaceOf(req), req.params.caseId, actorOf(req)));
}));

casesRouter.post("/api/cases/bulk-update", ...bulkTriageGate, asyncHandler(async (req, res) => {
  const payload = caseBulkUpdateSchema.parse(req.body);
  res.json(await bulkUpdateCases(workspaceOf(req), payload, actorOf(req), req.header("Authorization")));
}));

casesRouter.post("/api/cases/:caseId/notes", ...manageGate, asyncHandler(async (req, res) => {
  const payload = caseNoteSchema.parse(req.body);
  res.json(await addCaseNote(workspaceOf(req), req.params.caseId, payload.text, actorOf(req)));
}));

casesRouter.post("/api/cases/:caseId/enrich", ...manageGate, asyncHandler(async (req, res) => {
  const payload = caseEnrichSchema.parse(req.body);
  res.json(await enrichCase(workspaceOf(req), req.params.caseId, payload.value, payload.forceRefresh, actorOf(req)));
}));

// ── Case SLA settings ──

casesRouter.get("/api/case-sla-settings", ...readGate, asyncHandler(async (req, res) => {
  res.json(await getCaseSlaSettings(workspaceOf(req)));
}));

casesRouter.put("/api/case-sla-settings", ...manageGate, asyncHandler(async (req, res) => {
  const payload = caseSlaSettingsSchema.parse(req.body);
  res.json(await updateCaseSlaSettings(workspaceOf(req), payload, actorOf(req)));
}));

// ── Case Auto-Run Rules ──

casesRouter.get("/api/case-autorun-rules", ...readGate, asyncHandler(async (req, res) => {
  res.json(await listCaseAutoRunRules(workspaceOf(req)));
}));

casesRouter.post("/api/case-autorun-rules", ...manageGate, asyncHandler(async (req, res) => {
  const payload = caseAutoRunRuleSchema.parse(req.body);
  res.json(await createCaseAutoRunRule(workspaceOf(req), payload, actorOf(req)));
}));

casesRouter.put("/api/case-autorun-rules/:ruleId", ...manageGate, asyncHandler(async (req, res) => {
  const payload = caseAutoRunRuleSchema.parse(req.body);
  res.json(await updateCaseAutoRunRule(workspaceOf(req), req.params.ruleId, payload, actorOf(req)));
}));

casesRouter.delete("/api/case-autorun-rules/:ruleId", ...manageGate, asyncHandler(async (req, res) => {
  res.json(await deleteCaseAutoRunRule(workspaceOf(req), req.params.ruleId, actorOf(req)));
}));
