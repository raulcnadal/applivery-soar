import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { appliveryWebhookConfigPayloadSchema } from "./appliveryWebhookSettings.schemas";
import { getAppliveryWebhookConfig, rotateAppliveryWebhookSecret, updateAppliveryWebhookConfig } from "./appliveryWebhookSettings.service";

/** Port of main.py:13040-13096 — /api/applivery-webhook (config CRUD only; receiver is TODO(Phase8)). */

export const appliveryWebhookSettingsRouter = Router();

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

appliveryWebhookSettingsRouter.get("/api/applivery-webhook", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json(await getAppliveryWebhookConfig(workspaceOf(req)));
}));

appliveryWebhookSettingsRouter.put("/api/applivery-webhook", verifyDashboardToken, asyncHandler(async (req, res) => {
  const payload = appliveryWebhookConfigPayloadSchema.parse(req.body);
  res.json(await updateAppliveryWebhookConfig(workspaceOf(req), payload, actorOf(req)));
}));

appliveryWebhookSettingsRouter.post("/api/applivery-webhook/rotate-secret", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json(await rotateAppliveryWebhookSecret(workspaceOf(req), actorOf(req)));
}));
