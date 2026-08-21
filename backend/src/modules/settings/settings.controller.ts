import { Router } from "express";
import { z } from "zod";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { clearAutomationCredential, getAutomationCredentialStatus, setAutomationCredential } from "./automationCredential.service";
import { getOsPatchLevelMapping, setOsPatchLevelMapping } from "./osPatchLevelMapping.service";
import { clearDeviceReportSecret, getDeviceReportSecretStatus, rotateDeviceReportSecret } from "./deviceReportSecret.service";
import { testSmtp } from "./smtp.service";
import { testNotificationsWebhook } from "./notificationsWebhook.service";
import { clearAgentDownloadsToken, getAgentDownloadsConfigStatus, listAgentDownloads, setAgentDownloadsToken, streamAgentAsset, type AgentPlatform } from "./agentDownloads.service";

/**
 * Port of main.py:1550-1594 — GET/POST/DELETE /api/settings/automation-credential.
 * Only the automation-credential endpoints are ported here; the rest of
 * Settings (SMTP, log export destinations, device report secrets) is a
 * separate roadmap item, not needed by Phase 4b's Triggers/durable engine.
 *
 * All of these were originally (main.py, faithfully ported here until now)
 * gated only by verify_dashboard_token — any signed-in collaborator with
 * SOME assigned role, not the `settings` feature-area RBAC every one of
 * these logically belongs to. Automation credentials and the device-report
 * secret in particular drive every unattended background job in this app
 * (compliance evaluation, workflow triggering, device self-reporting) —
 * tightened to require settings:read/manage explicitly, matching the level
 * already required to view/edit everything else under Settings.
 */

export const settingsRouter = Router();

const readSettings = [verifyDashboardToken, requirePermission({ area: "settings", level: "read" })];
const manageSettings = [verifyDashboardToken, requirePermission({ area: "settings", level: "manage" })];

const automationCredentialPayloadSchema = z.object({
  serviceAccountToken: z.string().min(1),
});

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

settingsRouter.get("/api/settings/automation-credential", ...readSettings, asyncHandler(async (req, res) => {
  res.json(await getAutomationCredentialStatus(workspaceOf(req)));
}));

settingsRouter.post("/api/settings/automation-credential", ...manageSettings, asyncHandler(async (req, res) => {
  const payload = automationCredentialPayloadSchema.parse(req.body);
  await setAutomationCredential(workspaceOf(req), payload, actorOf(req));
  res.json({ status: "ok" });
}));

settingsRouter.delete("/api/settings/automation-credential", ...manageSettings, asyncHandler(async (req, res) => {
  await clearAutomationCredential(workspaceOf(req), actorOf(req));
  res.json({ status: "ok" });
}));

// ── OS Patch Level Smart Attribute mapping (Settings > Workspace
// Automation) — which Applivery Smart Attribute name to surface as every
// device's osPatchLevel, feeding CVE-matching precision (Android/OSV.dev,
// Apple/SOFA) and a new Compliance Policy condition. See
// osPatchLevelMapping.service.ts's doc comment. ──

const osPatchLevelMappingPayloadSchema = z.object({
  smartAttributeName: z.string().nullable(),
});

settingsRouter.get("/api/settings/os-patch-level-mapping", ...readSettings, asyncHandler(async (req, res) => {
  res.json(await getOsPatchLevelMapping(workspaceOf(req)));
}));

settingsRouter.put("/api/settings/os-patch-level-mapping", ...manageSettings, asyncHandler(async (req, res) => {
  const payload = osPatchLevelMappingPayloadSchema.parse(req.body);
  res.json(await setOsPatchLevelMapping(workspaceOf(req), actorOf(req), payload.smartAttributeName));
}));

// ── Device-report webhook secret (main.py:7799-7843) ──

settingsRouter.get("/api/settings/device-report-secret", ...readSettings, asyncHandler(async (req, res) => {
  res.json(await getDeviceReportSecretStatus(workspaceOf(req)));
}));

settingsRouter.post("/api/settings/device-report-secret", ...manageSettings, asyncHandler(async (req, res) => {
  res.json(await rotateDeviceReportSecret(workspaceOf(req), actorOf(req)));
}));

settingsRouter.delete("/api/settings/device-report-secret", ...manageSettings, asyncHandler(async (req, res) => {
  await clearDeviceReportSecret(workspaceOf(req), actorOf(req));
  res.json({ status: "ok" });
}));

// ── Applivery SOAR Agent downloads (Settings > Device Data Webhook) — the
// GitHub token below is GLOBAL (not per-workspace), unlike the
// device-report secret above: it grants read access to two specific
// private repos (the Windows/macOS agent source), not tenant data. Any
// workspace's admin who can manage Settings can configure/use it. ──

const agentDownloadsTokenPayloadSchema = z.object({ token: z.string().min(1) });

settingsRouter.get("/api/settings/agent-downloads/config", ...readSettings, asyncHandler(async (_req, res) => {
  res.json(await getAgentDownloadsConfigStatus());
}));

settingsRouter.put("/api/settings/agent-downloads/config", ...manageSettings, asyncHandler(async (req, res) => {
  const payload = agentDownloadsTokenPayloadSchema.parse(req.body);
  await setAgentDownloadsToken(payload.token, actorOf(req));
  res.json(await getAgentDownloadsConfigStatus());
}));

settingsRouter.delete("/api/settings/agent-downloads/config", ...manageSettings, asyncHandler(async (req, res) => {
  await clearAgentDownloadsToken(actorOf(req));
  res.json({ status: "ok" });
}));

settingsRouter.get("/api/settings/agent-downloads/releases", ...readSettings, asyncHandler(async (_req, res) => {
  res.json({ assets: await listAgentDownloads() });
}));

settingsRouter.get(
  "/api/settings/agent-downloads/download/:platform/:assetId",
  ...readSettings,
  asyncHandler(async (req, res) => {
    const platform = req.params.platform as AgentPlatform;
    const assetId = Number(req.params.assetId);
    if (!Number.isFinite(assetId)) {
      res.status(400).json({ detail: "Invalid assetId" });
      return;
    }
    const { stream, filename, contentType, contentLength } = await streamAgentAsset(platform, assetId);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    stream.pipe(res);
  }),
);

// ── SMTP test send (main.py:1909-1937) ──

const smtpTestPayloadSchema = z.object({
  smtpConfig: z.record(z.any()),
  testRecipient: z.string().email(),
});

settingsRouter.post("/api/settings/test-smtp", ...manageSettings, asyncHandler(async (req, res) => {
  const payload = smtpTestPayloadSchema.parse(req.body);
  await testSmtp(payload.smtpConfig, payload.testRecipient);
  res.json({ status: "ok" });
}));

// ── Notifications Webhook URL test send ──

const webhookTestPayloadSchema = z.object({
  webhookUrl: z.string().min(1),
});

settingsRouter.post("/api/settings/test-webhook", ...manageSettings, asyncHandler(async (req, res) => {
  const payload = webhookTestPayloadSchema.parse(req.body);
  await testNotificationsWebhook(payload.webhookUrl);
  res.json({ status: "ok" });
}));
