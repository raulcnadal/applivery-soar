import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { cloneWorkspaceConfig, exportWorkspaceConfig, importWorkspaceConfig, workspaceConfigIsEmpty } from "./config.service";
import { configClonePayloadSchema, configImportPayloadSchema, CONFIG_EXPORT_SCHEMA_VERSION } from "./config.schemas";
import { HttpError } from "../../utils/httpError";

/** Port of main.py:1802-1907 — /api/config/workspace-status, clone-from, export, import. */

export const configRouter = Router();

const manageGate = [verifyDashboardToken, requirePermission({ area: "settings", level: "manage", action: "canExportOrImportConfig" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

configRouter.get("/api/config/workspace-status", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json(await workspaceConfigIsEmpty(workspaceOf(req)));
}));

configRouter.post("/api/config/clone-from", ...manageGate, asyncHandler(async (req, res) => {
  const payload = configClonePayloadSchema.parse(req.body);
  res.json(await cloneWorkspaceConfig(workspaceOf(req), payload.sourceWorkspaceSlug, payload.stores, actorOf(req)));
}));

configRouter.get("/api/config/export", ...manageGate, asyncHandler(async (req, res) => {
  res.json(await exportWorkspaceConfig(workspaceOf(req), actorOf(req)));
}));

configRouter.post("/api/config/import", ...manageGate, asyncHandler(async (req, res) => {
  const payload = configImportPayloadSchema.parse(req.body);
  if (payload.schemaVersion !== CONFIG_EXPORT_SCHEMA_VERSION) {
    throw new HttpError(400, `Unsupported schemaVersion ${payload.schemaVersion} — this deployment reads version ${CONFIG_EXPORT_SCHEMA_VERSION} bundles only.`);
  }
  res.json(await importWorkspaceConfig(workspaceOf(req), payload.data, payload.stores, actorOf(req)));
}));
