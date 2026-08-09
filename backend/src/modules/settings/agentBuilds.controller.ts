import { Router } from "express";
import express from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { verifyAgentBuildSecret } from "../../middleware/agentBuildSecret.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { getAgentBuildMeta, getPublishStatus, publishAgentBuildToApplivery, receiveAgentBuild, streamAgentBuild } from "./agentBuilds.service";

/**
 * Zero-configuration Applivery SOAR Agent distribution — see
 * agentBuilds.service.ts's module doc for the full design. Three trust
 * levels in one file:
 *  - POST /api/internal/agent-builds/:platform — CI-only, gated by the
 *    shared AGENT_BUILD_INGEST_SECRET header (verifyAgentBuildSecret).
 *  - GET  /api/agent-downloads/:platform[/meta] — deliberately public, no
 *    auth at all, exactly like pulling a public Docker image — this is the
 *    entire point of the feature (no GitHub PAT required from customers).
 *  - POST /api/settings/agent-downloads/publish/:platform and its status
 *    GET — dashboard-authenticated, settings:manage/read, run with the
 *    requesting admin's own live Applivery session.
 */

export const agentBuildsRouter = Router();

const readSettings = [verifyDashboardToken, requirePermission({ area: "settings", level: "read" })];
const manageSettings = [verifyDashboardToken, requirePermission({ area: "settings", level: "manage" })];

function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}
function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}

// ── CI ingest — raw binary body, not JSON, so this route gets its own
// express.raw() parser instead of relying on app.ts's global express.json()
// (which no-ops on a non-JSON Content-Type and leaves the stream for us). ──

agentBuildsRouter.post(
  "/api/internal/agent-builds/:platform",
  verifyAgentBuildSecret,
  express.raw({ type: () => true, limit: "250mb" }),
  asyncHandler(async (req, res) => {
    const filename = req.header("X-Agent-Filename") || `agent-${req.params.platform}.bin`;
    const contentType = req.header("X-Agent-Content-Type") || "application/octet-stream";
    const version = req.header("X-Agent-Version") || null;
    const data = req.body as Buffer;
    const meta = await receiveAgentBuild(req.params.platform, filename, contentType, data, version);
    res.status(201).json(meta);
  }),
);

// ── Public downloads — no auth, by design. ──

agentBuildsRouter.get(
  "/api/agent-downloads/:platform/meta",
  asyncHandler(async (req, res) => {
    const meta = await getAgentBuildMeta(req.params.platform);
    if (!meta) {
      res.status(404).json({ detail: `No ${req.params.platform} agent build has been published yet.` });
      return;
    }
    res.json(meta);
  }),
);

agentBuildsRouter.get(
  "/api/agent-downloads/:platform",
  asyncHandler(async (req, res) => {
    const { filename, contentType, data } = await streamAgentBuild(req.params.platform);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(data.length));
    res.send(data);
  }),
);

// ── Publish to Applivery App Distribution — dashboard-authenticated. ──

agentBuildsRouter.get("/api/settings/agent-downloads/publish-status", ...readSettings, asyncHandler(async (req, res) => {
  res.json(await getPublishStatus(workspaceOf(req)));
}));

agentBuildsRouter.post(
  "/api/settings/agent-downloads/publish/:platform",
  ...manageSettings,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing Applivery session — try refreshing the page and logging in again");
    const result = await publishAgentBuildToApplivery(authorization, workspaceSlug, req.params.platform, actorOf(req));
    res.json(result);
  }),
);
