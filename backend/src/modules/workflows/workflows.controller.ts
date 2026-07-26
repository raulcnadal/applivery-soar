import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { getCachedAccess, requirePermission } from "../../middleware/rbac.middleware";
import { verifyTriggerSecret } from "../../middleware/triggerSecret.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { resumeDueWorkflowSteps } from "./durableEngine";
import {
  createWorkflow,
  deleteWorkflow,
  dryRunWorkflow,
  exportWorkflowRunsCsv,
  getWorkflowRun,
  getWorkflowVersion,
  launchWorkflowRun,
  listWorkflowRuns,
  listWorkflowVersions,
  listWorkflows,
  restoreWorkflowVersion,
  updateWorkflow,
  workflowHasDestructiveStep,
} from "./workflows.service";
import { workflowDryRunRequestSchema, workflowPayloadSchema, workflowRunRequestSchema } from "./workflows.schemas";

/**
 * Workflow CRUD + version history/restore + dry-run + manual run (in-memory
 * engine only — Phase 4a) — port of main.py:6289-6608, 7576-7611. Trigger-
 * fired runs, the durable wait engine, and resume-due polling are Phase 4b.
 */

export const workflowsRouter = Router();

const readWorkflows = [verifyDashboardToken, requirePermission({ area: "workflows", level: "read" })];
const manageWorkflows = [verifyDashboardToken, requirePermission({ area: "workflows", level: "manage" })];
const deleteWorkflowGate = [verifyDashboardToken, requirePermission({ area: "workflows", level: "manage", action: "canDeletePolicyOrWorkflow" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

// ── CRUD (main.py:6291-6335) ──

workflowsRouter.get("/api/workflows", ...readWorkflows, asyncHandler(async (req, res) => {
  res.json({ items: await listWorkflows(workspaceOf(req)) });
}));

workflowsRouter.post("/api/workflows", ...manageWorkflows, asyncHandler(async (req, res) => {
  const payload = workflowPayloadSchema.parse(req.body);
  res.json(await createWorkflow(workspaceOf(req), payload, actorOf(req)));
}));

workflowsRouter.put("/api/workflows/:workflowId", ...manageWorkflows, asyncHandler(async (req, res) => {
  const payload = workflowPayloadSchema.parse(req.body);
  res.json(await updateWorkflow(workspaceOf(req), req.params.workflowId, payload, actorOf(req)));
}));

workflowsRouter.delete("/api/workflows/:workflowId", ...deleteWorkflowGate, asyncHandler(async (req, res) => {
  res.json(await deleteWorkflow(workspaceOf(req), req.params.workflowId, actorOf(req)));
}));

// ── Versions (main.py:6337-6372) ──

workflowsRouter.get("/api/workflows/:workflowId/versions", ...readWorkflows, asyncHandler(async (req, res) => {
  res.json({ items: await listWorkflowVersions(req.params.workflowId) });
}));

workflowsRouter.get("/api/workflows/:workflowId/versions/:versionId", ...readWorkflows, asyncHandler(async (req, res) => {
  res.json(await getWorkflowVersion(req.params.workflowId, req.params.versionId));
}));

workflowsRouter.post("/api/workflows/:workflowId/versions/:versionId/restore", ...manageWorkflows, asyncHandler(async (req, res) => {
  res.json(await restoreWorkflowVersion(workspaceOf(req), req.params.workflowId, req.params.versionId, actorOf(req)));
}));

// ── Dry run (main.py:6499-6519) ──

workflowsRouter.post("/api/workflows/:workflowId/dry-run", ...readWorkflows, asyncHandler(async (req, res) => {
  const workspaceSlug = workspaceOf(req);
  const workflow = await prisma.workflow.findFirst({ where: { workspaceSlug, id: req.params.workflowId } });
  if (!workflow) throw new HttpError(404, "Workflow not found");
  const payload = workflowDryRunRequestSchema.parse(req.body ?? {});
  res.json(dryRunWorkflow(workflow, payload.device ?? null));
}));

// ── Run history (main.py:6552-6608) ──
// Registered ahead of nothing in particular — these are literal-path GETs
// under /api/workflows/runs*, which never collides with the dynamic
// /api/workflows/:workflowId/* routes above (different HTTP methods/shapes).

workflowsRouter.get("/api/workflows/runs", ...readWorkflows, asyncHandler(async (req, res) => {
  const workspaceSlug = workspaceOf(req);
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const dateFrom = typeof req.query.date_from === "string" ? req.query.date_from : undefined;
  const dateTo = typeof req.query.date_to === "string" ? req.query.date_to : undefined;
  res.json(await listWorkflowRuns(workspaceSlug, limit, dateFrom, dateTo));
}));

workflowsRouter.get("/api/workflows/runs/export", ...readWorkflows, asyncHandler(async (req, res) => {
  const workspaceSlug = workspaceOf(req);
  const dateFrom = typeof req.query.date_from === "string" ? req.query.date_from : undefined;
  const dateTo = typeof req.query.date_to === "string" ? req.query.date_to : undefined;
  const csv = await exportWorkflowRunsCsv(workspaceSlug, dateFrom, dateTo);
  const filename = `workflow-runs-${workspaceSlug.replace(/[^a-zA-Z0-9_-]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.send(csv);
}));

workflowsRouter.get("/api/workflows/runs/:runId", ...readWorkflows, asyncHandler(async (req, res) => {
  res.json(await getWorkflowRun(workspaceOf(req), req.params.runId));
}));

// POST /api/workflows/resume-due — external-cron-triggerable alternative to
// this container's own in-process workflow_wait_resumer loop
// (backgroundJobs.ts, already running every 30s unattended). Secret-gated
// (TRIGGER_SECRET), not dashboard-token gated — same reasoning as
// compliance's /evaluate-due sibling (see docs/README.md's TRIGGER_SECRET
// row). `limit` mirrors resumeDueWorkflowSteps' own default of 50.
workflowsRouter.post("/api/workflows/resume-due", verifyTriggerSecret, asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const resumedCount = await resumeDueWorkflowSteps(limit);
  res.json({ resumedCount });
}));

// ── Manual run (main.py:7576-7611) ──

workflowsRouter.post("/api/workflows/:workflowId/run", ...manageWorkflows, asyncHandler(async (req, res) => {
  const authorization = req.header("Authorization");
  const workspaceSlug = req.header("X-Workspace-Slug");
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");

  const workflow = await prisma.workflow.findFirst({ where: { workspaceSlug, id: req.params.workflowId } });
  if (!workflow) throw new HttpError(404, "Workflow not found");

  const payload = workflowRunRequestSchema.parse(req.body);
  if (!payload.devices.length) throw new HttpError(400, "No target devices provided");

  // Base "workflows: manage" access (checked above) is enough to run an
  // ordinary workflow; a workflow with a real destructive MDM step
  // additionally requires canRunDestructiveWorkflow — only knowable once
  // the workflow itself is loaded, so it's checked here rather than in the
  // route-level dependency (main.py:7596-7602).
  if (workflowHasDestructiveStep(workflow)) {
    const access = getCachedAccess(workspaceSlug, actorOf(req));
    if (!access?.isSuperAdmin && !access?.role?.riskyActions?.canRunDestructiveWorkflow) {
      throw new HttpError(403, "This workflow contains a destructive MDM action (wipe/unenroll/etc.) — your role isn't permitted to run destructive workflows.");
    }
  }

  const runRecord = await launchWorkflowRun(workflow, payload.devices, authorization, workspaceSlug, payload.targetDescription);
  if (runRecord === null) {
    throw new HttpError(400, "This workflow includes a 'wait' or 'run script and wait for result' step, which requires durable storage (DATABASE_URL) not configured on this server.");
  }
  const targetSuffix = payload.targetDescription ? ` (${payload.targetDescription})` : "";
  await recordAuditEvent(workspaceSlug, {
    category: "workflow", action: "workflow_run_started", actor: actorOf(req),
    targetType: "workflow", targetId: req.params.workflowId, targetName: workflow.name,
    message: `Workflow "${workflow.name}" run manually on ${payload.devices.length} device${payload.devices.length !== 1 ? "s" : ""}${targetSuffix}`,
  });
  res.json(runRecord);
}));
