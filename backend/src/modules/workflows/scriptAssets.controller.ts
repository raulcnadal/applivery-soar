import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import {
  browseScriptAssets,
  createNewScriptAsset,
  editScriptAsset,
  getScriptAssetContent,
  searchScriptAssetsForPicker,
  type ScriptAssetCreatePayload,
  type ScriptAssetEditPayload,
} from "./scriptAssets.service";

/**
 * Port of main.py:8451-8698 — Script Assets search/browse/content/create/edit.
 * Gated by the workflows feature area, same reasoning as
 * actionLibrary.controller.ts / scriptRepos.controller.ts.
 */

export const scriptAssetsRouter = Router();

const readScriptAssets = [verifyDashboardToken, requirePermission({ area: "workflows", level: "read" })];
const manageScriptAssets = [verifyDashboardToken, requirePermission({ area: "workflows", level: "manage" })];

function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}
function requireCreds(req: { header(name: string): string | undefined }): { authorization: string; workspaceSlug: string } {
  const authorization = req.header("Authorization");
  const workspaceSlug = req.header("X-Workspace-Slug");
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing Applivery session — try refreshing the page and logging in again");
  return { authorization, workspaceSlug };
}

scriptAssetsRouter.get("/api/script-assets", ...readScriptAssets, asyncHandler(async (req, res) => {
  const { authorization, workspaceSlug } = requireCreds(req);
  const platform = String(req.query.platform ?? "");
  const text = String(req.query.text ?? "");
  res.json(await searchScriptAssetsForPicker(authorization, workspaceSlug, platform, text));
}));

scriptAssetsRouter.get("/api/script-assets/browse", ...readScriptAssets, asyncHandler(async (req, res) => {
  const { authorization, workspaceSlug } = requireCreds(req);
  const platform = String(req.query.platform ?? "all");
  res.json(await browseScriptAssets(authorization, workspaceSlug, platform));
}));

scriptAssetsRouter.get("/api/script-assets/:assetId/content", ...readScriptAssets, asyncHandler(async (req, res) => {
  const { authorization, workspaceSlug } = requireCreds(req);
  res.json(await getScriptAssetContent(authorization, workspaceSlug, req.params.assetId));
}));

scriptAssetsRouter.post("/api/script-assets", ...manageScriptAssets, asyncHandler(async (req, res) => {
  const { authorization, workspaceSlug } = requireCreds(req);
  const payload = req.body as ScriptAssetCreatePayload;
  res.json(await createNewScriptAsset(authorization, workspaceSlug, payload, actorOf(req)));
}));

scriptAssetsRouter.put("/api/script-assets/:assetId", ...manageScriptAssets, asyncHandler(async (req, res) => {
  const { authorization, workspaceSlug } = requireCreds(req);
  const payload = req.body as ScriptAssetEditPayload;
  res.json(await editScriptAsset(authorization, workspaceSlug, req.params.assetId, payload, actorOf(req)));
}));
