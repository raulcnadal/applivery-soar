import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { logExportDestinationPayloadSchema } from "./logExportDestinations.schemas";
import {
  createLogExportDestination, deleteLogExportDestination, listLogExportDestinations,
  testLogExportDestination, updateLogExportDestination,
} from "./logExportDestinations.service";

/**
 * Port of main.py:2289-2403 — /api/settings/log-export-destinations*.
 * Gated by the settings feature area (see settings.controller.ts's doc
 * comment) — a destination stores credentials (syslog/webhook/s3/nfs/sftp)
 * and controls where audit-log data gets shipped, so it belongs behind
 * settings:read/manage rather than just "signed in with some role".
 */

export const logExportDestinationsRouter = Router();

const readLogExport = [verifyDashboardToken, requirePermission({ area: "settings", level: "read" })];
const manageLogExport = [verifyDashboardToken, requirePermission({ area: "settings", level: "manage" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

logExportDestinationsRouter.get("/api/settings/log-export-destinations", ...readLogExport, asyncHandler(async (req, res) => {
  res.json({ items: await listLogExportDestinations(workspaceOf(req)) });
}));

logExportDestinationsRouter.post("/api/settings/log-export-destinations", ...manageLogExport, asyncHandler(async (req, res) => {
  const payload = logExportDestinationPayloadSchema.parse(req.body);
  res.json(await createLogExportDestination(workspaceOf(req), payload, actorOf(req)));
}));

logExportDestinationsRouter.put("/api/settings/log-export-destinations/:id", ...manageLogExport, asyncHandler(async (req, res) => {
  const payload = logExportDestinationPayloadSchema.parse(req.body);
  res.json(await updateLogExportDestination(workspaceOf(req), req.params.id, payload, actorOf(req)));
}));

logExportDestinationsRouter.delete("/api/settings/log-export-destinations/:id", ...manageLogExport, asyncHandler(async (req, res) => {
  res.json(await deleteLogExportDestination(workspaceOf(req), req.params.id, actorOf(req)));
}));

logExportDestinationsRouter.post("/api/settings/log-export-destinations/:id/test", ...manageLogExport, asyncHandler(async (req, res) => {
  await testLogExportDestination(workspaceOf(req), req.params.id, actorOf(req));
  res.json({ status: "ok" });
}));
