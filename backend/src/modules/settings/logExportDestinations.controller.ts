import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { logExportDestinationPayloadSchema } from "./logExportDestinations.schemas";
import {
  createLogExportDestination, deleteLogExportDestination, listLogExportDestinations,
  testLogExportDestination, updateLogExportDestination,
} from "./logExportDestinations.service";

/** Port of main.py:2289-2403 — /api/settings/log-export-destinations*. */

export const logExportDestinationsRouter = Router();

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

logExportDestinationsRouter.get("/api/settings/log-export-destinations", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json({ items: await listLogExportDestinations(workspaceOf(req)) });
}));

logExportDestinationsRouter.post("/api/settings/log-export-destinations", verifyDashboardToken, asyncHandler(async (req, res) => {
  const payload = logExportDestinationPayloadSchema.parse(req.body);
  res.json(await createLogExportDestination(workspaceOf(req), payload, actorOf(req)));
}));

logExportDestinationsRouter.put("/api/settings/log-export-destinations/:id", verifyDashboardToken, asyncHandler(async (req, res) => {
  const payload = logExportDestinationPayloadSchema.parse(req.body);
  res.json(await updateLogExportDestination(workspaceOf(req), req.params.id, payload, actorOf(req)));
}));

logExportDestinationsRouter.delete("/api/settings/log-export-destinations/:id", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json(await deleteLogExportDestination(workspaceOf(req), req.params.id, actorOf(req)));
}));

logExportDestinationsRouter.post("/api/settings/log-export-destinations/:id/test", verifyDashboardToken, asyncHandler(async (req, res) => {
  await testLogExportDestination(workspaceOf(req), req.params.id, actorOf(req));
  res.json({ status: "ok" });
}));
