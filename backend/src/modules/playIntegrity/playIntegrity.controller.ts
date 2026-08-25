import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { playIntegrityConfigPayloadSchema } from "./playIntegrity.schemas";
import { clearPlayIntegrityConfig, getPlayIntegrityStatus, setPlayIntegrityConfig } from "./playIntegrity.service";

/**
 * Admin-facing Google Play Integrity API settings — Settings > Google Play
 * Integrity API. Same dashboard-token + RBAC ("settings" area) gating shape
 * as every other Settings sub-resource (settings.controller.ts's
 * automation-credential routes) — no risky-action flag beyond plain
 * settings:manage, since this isn't a destructive/hard-to-reverse action the
 * way replacing the mTLS CA or rotating the fleet bootstrap token are.
 *
 * The device-facing nonce-issuance route lives in deviceData.controller.ts
 * alongside every other mTLS-gated device-caller endpoint, not here — this
 * router is admin-session-only.
 */
export const playIntegrityRouter = Router();

const readPlayIntegrity = [verifyDashboardToken, requirePermission({ area: "settings", level: "read" })];
const managePlayIntegrity = [verifyDashboardToken, requirePermission({ area: "settings", level: "manage" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

playIntegrityRouter.get("/api/settings/play-integrity", ...readPlayIntegrity, asyncHandler(async (req, res) => {
  res.json(await getPlayIntegrityStatus(workspaceOf(req)));
}));

playIntegrityRouter.post("/api/settings/play-integrity", ...managePlayIntegrity, asyncHandler(async (req, res) => {
  const payload = playIntegrityConfigPayloadSchema.parse(req.body);
  await setPlayIntegrityConfig(workspaceOf(req), payload, actorOf(req));
  res.json(await getPlayIntegrityStatus(workspaceOf(req)));
}));

playIntegrityRouter.delete("/api/settings/play-integrity", ...managePlayIntegrity, asyncHandler(async (req, res) => {
  await clearPlayIntegrityConfig(workspaceOf(req), actorOf(req));
  res.json({ status: "ok" });
}));
