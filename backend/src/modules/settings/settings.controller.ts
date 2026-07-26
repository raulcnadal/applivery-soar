import { Router } from "express";
import { z } from "zod";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { clearAutomationCredential, getAutomationCredentialStatus, setAutomationCredential } from "./automationCredential.service";
import { clearDeviceReportSecret, getDeviceReportSecretStatus, rotateDeviceReportSecret } from "./deviceReportSecret.service";
import { testSmtp } from "./smtp.service";

/**
 * Port of main.py:1550-1594 — GET/POST/DELETE /api/settings/automation-credential.
 * Only the automation-credential endpoints are ported here; the rest of
 * Settings (SMTP, log export destinations, device report secrets) is a
 * separate roadmap item, not needed by Phase 4b's Triggers/durable engine.
 */

export const settingsRouter = Router();

const automationCredentialPayloadSchema = z.object({
  apiToken: z.string().min(1),
  refreshToken: z.string().min(1),
  apiTokenExpireAt: z.string().nullish(),
  refreshTokenExpireAt: z.string().nullish(),
});

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

settingsRouter.get("/api/settings/automation-credential", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json(await getAutomationCredentialStatus(workspaceOf(req)));
}));

settingsRouter.post("/api/settings/automation-credential", verifyDashboardToken, asyncHandler(async (req, res) => {
  const payload = automationCredentialPayloadSchema.parse(req.body);
  await setAutomationCredential(workspaceOf(req), payload, actorOf(req));
  res.json({ status: "ok" });
}));

settingsRouter.delete("/api/settings/automation-credential", verifyDashboardToken, asyncHandler(async (req, res) => {
  await clearAutomationCredential(workspaceOf(req), actorOf(req));
  res.json({ status: "ok" });
}));

// ── Device-report webhook secret (main.py:7799-7843) ──

settingsRouter.get("/api/settings/device-report-secret", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json(await getDeviceReportSecretStatus(workspaceOf(req)));
}));

settingsRouter.post("/api/settings/device-report-secret", verifyDashboardToken, asyncHandler(async (req, res) => {
  res.json(await rotateDeviceReportSecret(workspaceOf(req), actorOf(req)));
}));

settingsRouter.delete("/api/settings/device-report-secret", verifyDashboardToken, asyncHandler(async (req, res) => {
  await clearDeviceReportSecret(workspaceOf(req), actorOf(req));
  res.json({ status: "ok" });
}));

// ── SMTP test send (main.py:1909-1937) ──

const smtpTestPayloadSchema = z.object({
  smtpConfig: z.record(z.any()),
  testRecipient: z.string().email(),
});

settingsRouter.post("/api/settings/test-smtp", verifyDashboardToken, asyncHandler(async (req, res) => {
  const payload = smtpTestPayloadSchema.parse(req.body);
  await testSmtp(payload.smtpConfig, payload.testRecipient);
  res.json({ status: "ok" });
}));
