import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { appliveryWebhookConfigPayloadSchema } from "./appliveryWebhookSettings.schemas";
import { getAppliveryWebhookConfig, rotateAppliveryWebhookSecret, updateAppliveryWebhookConfig } from "./appliveryWebhookSettings.service";
import { receiveAppliveryWebhook } from "./appliveryWebhookReceive.service";

/** Port of main.py:13040-13096 — /api/applivery-webhook (config CRUD) and main.py:13098-13243 — POST /api/applivery-webhook/receive/:secret. */

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

// The actual inbound URL Applivery's own webhook engine POSTs to —
// deliberately NOT dashboard-token protected, secret lives in the path.
appliveryWebhookSettingsRouter.post("/api/applivery-webhook/receive/:secret", asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  res.json(await receiveAppliveryWebhook(req.params.secret, body));
}));
