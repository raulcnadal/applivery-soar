import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
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

/** Port of main.py:12709-12901 — Triggers CRUD + secret rotation + the inbound fire endpoint. */

export const triggersRouter = Router();

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

triggersRouter.get("/api/triggers", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json({ items: await listTriggers(workspaceOf(req)) });
}));

triggersRouter.post("/api/triggers", verifyDashboardToken, asyncHandler(async (req, res) => {
  const payload = req.body as TriggerPayload;
  res.json(await createTrigger(workspaceOf(req), payload, actorOf(req)));
}));

triggersRouter.put("/api/triggers/:triggerId", verifyDashboardToken, asyncHandler(async (req, res) => {
  const payload = req.body as TriggerPayload;
  res.json(await updateTrigger(workspaceOf(req), req.params.triggerId, payload, actorOf(req)));
}));

triggersRouter.delete("/api/triggers/:triggerId", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json(await deleteTrigger(workspaceOf(req), req.params.triggerId, actorOf(req)));
}));

triggersRouter.post("/api/triggers/:triggerId/rotate-secret", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json(await rotateTriggerSecret(workspaceOf(req), req.params.triggerId, actorOf(req)));
}));

// Deliberately NOT behind verifyDashboardToken — the caller is an external
// unattended system, authenticated only by the secret embedded in the URL
// itself (see triggers.service.ts's fireTrigger for the timing-safe compare).
triggersRouter.post("/api/triggers/fire/:triggerId/:secret", asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  res.json(await fireTrigger(req.params.triggerId, req.params.secret, body));
}));
