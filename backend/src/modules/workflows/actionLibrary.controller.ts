import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  createActionLibraryEntry,
  deleteActionLibraryEntry,
  importActionLibraryEntries,
  listActionLibraryEntries,
  updateActionLibraryEntry,
  type ActionLibraryEntryPayload,
} from "./actionLibrary.service";

/** Port of main.py:4928-5023 — Script & OMA-URI Library CRUD + bulk import. */

export const actionLibraryRouter = Router();

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

actionLibraryRouter.get("/api/action-library", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json({ items: await listActionLibraryEntries(workspaceOf(req)) });
}));

actionLibraryRouter.post("/api/action-library", verifyDashboardToken, asyncHandler(async (req, res) => {
  const payload = req.body as ActionLibraryEntryPayload;
  res.json(await createActionLibraryEntry(workspaceOf(req), payload, actorOf(req)));
}));

actionLibraryRouter.put("/api/action-library/:entryId", verifyDashboardToken, asyncHandler(async (req, res) => {
  const payload = req.body as ActionLibraryEntryPayload;
  res.json(await updateActionLibraryEntry(workspaceOf(req), req.params.entryId, payload, actorOf(req)));
}));

actionLibraryRouter.delete("/api/action-library/:entryId", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json(await deleteActionLibraryEntry(workspaceOf(req), req.params.entryId, actorOf(req)));
}));

actionLibraryRouter.post("/api/action-library/import", verifyDashboardToken, asyncHandler(async (req, res) => {
  const assets = (req.body?.assets ?? []) as Array<{ id: string; name?: string; platform?: string; description?: string }>;
  res.json(await importActionLibraryEntries(workspaceOf(req), assets, actorOf(req)));
}));
