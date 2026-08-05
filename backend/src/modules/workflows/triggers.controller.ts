import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  createTrigger,
  deleteTrigger,
  fireTrigger,
  listTriggers,
  rotateTriggerSecret,
  updateTrigger,
  type TriggerPayload,
} from "./triggers.service";

/**
 * Port of main.py:12709-12901 — Triggers CRUD + secret rotation + the
 * inbound fire endpoint. CRUD/rotate now gated by the same workflows
 * feature-area RBAC as workflows.controller.ts itself (read to view,
 * manage to create/update/delete/rotate) — the original (and this port,
 * until now) only required a signed-in dashboard session with SOME
 * assigned role for these, same gap as several Settings-adjacent
 * endpoints (see settings.controller.ts's doc comment). A Trigger exposes
 * a secret that fires an arbitrary Workflow from outside the app, so it
 * belongs behind the same gate as managing Workflows themselves, not just
 * "has a role in this workspace at all."
 */

export const triggersRouter = Router();

const readTriggers = [verifyDashboardToken, requirePermission({ area: "workflows", level: "read" })];
const manageTriggers = [verifyDashboardToken, requirePermission({ area: "workflows", level: "manage" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

triggersRouter.get("/api/triggers", ...readTriggers, asyncHandler(async (req, res) => {
  res.json({ items: await listTriggers(workspaceOf(req)) });
}));

triggersRouter.post("/api/triggers", ...manageTriggers, asyncHandler(async (req, res) => {
  const payload = req.body as TriggerPayload;
  res.json(await createTrigger(workspaceOf(req), payload, actorOf(req)));
}));

triggersRouter.put("/api/triggers/:triggerId", ...manageTriggers, asyncHandler(async (req, res) => {
  const payload = req.body as TriggerPayload;
  res.json(await updateTrigger(workspaceOf(req), req.params.triggerId, payload, actorOf(req)));
}));

triggersRouter.delete("/api/triggers/:triggerId", ...manageTriggers, asyncHandler(async (req, res) => {
  res.json(await deleteTrigger(workspaceOf(req), req.params.triggerId, actorOf(req)));
}));

triggersRouter.post("/api/triggers/:triggerId/rotate-secret", ...manageTriggers, asyncHandler(async (req, res) => {
  res.json(await rotateTriggerSecret(workspaceOf(req), req.params.triggerId, actorOf(req)));
}));

// Deliberately NOT behind verifyDashboardToken — the caller is an external
// unattended system, authenticated only by the secret embedded in the URL
// itself (see triggers.service.ts's fireTrigger for the timing-safe compare).
triggersRouter.post("/api/triggers/fire/:triggerId/:secret", asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  res.json(await fireTrigger(req.params.triggerId, req.params.secret, body));
}));
