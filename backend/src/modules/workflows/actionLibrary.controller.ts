import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  createActionLibraryEntry,
  deleteActionLibraryEntry,
  importActionLibraryEntries,
  listActionLibraryEntries,
  updateActionLibraryEntry,
  type ActionLibraryEntryPayload,
} from "./actionLibrary.service";

/**
 * Port of main.py:4928-5023 — Script & OMA-URI Library CRUD + bulk import.
 * Gated by the workflows feature area — these entries are what
 * mdm_action/run_script_wait workflow steps pick from, so managing them
 * belongs behind the same RBAC as managing Workflows themselves (see
 * settings.controller.ts's doc comment for the broader pattern this
 * closes across several similarly under-gated endpoints).
 */

export const actionLibraryRouter = Router();

const readActionLibrary = [verifyDashboardToken, requirePermission({ area: "workflows", level: "read" })];
const manageActionLibrary = [verifyDashboardToken, requirePermission({ area: "workflows", level: "manage" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

actionLibraryRouter.get("/api/action-library", ...readActionLibrary, asyncHandler(async (req, res) => {
  res.json({ items: await listActionLibraryEntries(workspaceOf(req)) });
}));

actionLibraryRouter.post("/api/action-library", ...manageActionLibrary, asyncHandler(async (req, res) => {
  const payload = req.body as ActionLibraryEntryPayload;
  res.json(await createActionLibraryEntry(workspaceOf(req), payload, actorOf(req)));
}));

actionLibraryRouter.put("/api/action-library/:entryId", ...manageActionLibrary, asyncHandler(async (req, res) => {
  const payload = req.body as ActionLibraryEntryPayload;
  res.json(await updateActionLibraryEntry(workspaceOf(req), req.params.entryId, payload, actorOf(req)));
}));

actionLibraryRouter.delete("/api/action-library/:entryId", ...manageActionLibrary, asyncHandler(async (req, res) => {
  res.json(await deleteActionLibraryEntry(workspaceOf(req), req.params.entryId, actorOf(req)));
}));

actionLibraryRouter.post("/api/action-library/import", ...manageActionLibrary, asyncHandler(async (req, res) => {
  const assets = (req.body?.assets ?? []) as Array<{ id: string; name?: string; platform?: string; description?: string }>;
  res.json(await importActionLibraryEntries(workspaceOf(req), assets, actorOf(req)));
}));
