import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import {
  browseScriptRepo,
  createScriptRepo,
  deleteScriptRepo,
  importFromScriptRepo,
  listScriptRepos,
  type ScriptRepoImportFile,
  type ScriptRepoPayload,
} from "./scriptRepos.service";

/**
 * Port of main.py:8740-8872 — Script Repos (external Git) CRUD + browse +
 * import. Gated by the workflows feature area (same as
 * workflows.controller.ts and actionLibrary/scriptAssets controllers) — a
 * repo config stores a GitHub token and import feeds directly into the
 * Script Library workflows run, so it belongs behind workflows RBAC rather
 * than just "signed in with some role" (the original's own gate, faithfully
 * ported until now — see settings.controller.ts's doc comment for the
 * broader pattern this closes).
 */

export const scriptReposRouter = Router();

const readScriptRepos = [verifyDashboardToken, requirePermission({ area: "workflows", level: "read" })];
const manageScriptRepos = [verifyDashboardToken, requirePermission({ area: "workflows", level: "manage" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

scriptReposRouter.get("/api/script-repos", ...readScriptRepos, asyncHandler(async (req, res) => {
  res.json({ items: await listScriptRepos(workspaceOf(req)) });
}));

scriptReposRouter.post("/api/script-repos", ...manageScriptRepos, asyncHandler(async (req, res) => {
  const payload = req.body as ScriptRepoPayload;
  res.json(await createScriptRepo(workspaceOf(req), payload, actorOf(req)));
}));

scriptReposRouter.delete("/api/script-repos/:repoId", ...manageScriptRepos, asyncHandler(async (req, res) => {
  res.json(await deleteScriptRepo(workspaceOf(req), req.params.repoId));
}));

scriptReposRouter.get("/api/script-repos/:repoId/browse", ...readScriptRepos, asyncHandler(async (req, res) => {
  const path = typeof req.query.path === "string" ? req.query.path : undefined;
  res.json(await browseScriptRepo(workspaceOf(req), req.params.repoId, path));
}));

scriptReposRouter.post("/api/script-repos/import", ...manageScriptRepos, asyncHandler(async (req, res) => {
  const authorization = req.header("Authorization");
  const workspaceSlug = req.header("X-Workspace-Slug");
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing Applivery session — try refreshing the page and logging in again");
  const { repoId, files, segmentId } = req.body as { repoId: string; files: ScriptRepoImportFile[]; segmentId?: number | null };
  res.json(await importFromScriptRepo(authorization, workspaceSlug, repoId, files ?? [], segmentId, actorOf(req)));
}));
