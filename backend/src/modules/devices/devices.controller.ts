import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import {
  bulkReattestDevices,
  fetchDeviceAgentDiagnostics,
  getDeviceAssets,
  getDeviceCompliance,
  getDeviceFirewallState,
  getDeviceLocations,
  getDeviceNetworkStatus,
  getDevicesFull,
  getStoredAgentDiagnostics,
  updateDevicePolicies,
  updateDeviceSegment,
  updateDeviceTags,
} from "./devices.service";
import { bulkReattestSchema, policiesUpdateSchema, segmentUpdateSchema, tagsUpdateSchema } from "./devices.schemas";

export const devicesRouter = Router();

const readDevices = [verifyDashboardToken, requirePermission({ area: "devices", level: "read" })];
const manageDevices = [verifyDashboardToken, requirePermission({ area: "devices", level: "manage" })];

function requireCreds(authorization: string | undefined, workspaceSlug: string | undefined): asserts authorization is string {
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
}

// GET /api/devices (main.py:3419)
devicesRouter.get(
  "/api/devices",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const refresh = req.query.refresh === "true";
    res.json(await getDevicesFull(authorization, workspaceSlug!, refresh));
  }),
);

// GET /api/devices/{device_id}/compliance (main.py:3589)
devicesRouter.get(
  "/api/devices/:deviceId/compliance",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    res.json(await getDeviceCompliance(authorization, workspaceSlug!, req.params.deviceId));
  }),
);

// GET /api/devices/{device_id}/locations, /network-status, /assets —
// Playground's DeviceInsightModal "extras" tabs (Phase 8). Proxied
// server-side (see devices.service.ts's getDeviceLocations/etc doc comment
// for why this doesn't call api.applivery.io directly from the browser like
// the original did) rather than a literal main.py line, since the original
// never proxied these through its own backend at all. Agent Logs/Trace used
// to be auto-loaded here too, alongside locations/network-status — moved to
// its own on-demand GET/POST pair below (agent-diagnostics) since it's
// troubleshooting data, not something worth a live Applivery call on every
// Device modal open.
devicesRouter.get(
  "/api/devices/:deviceId/locations",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    res.json(await getDeviceLocations(authorization, workspaceSlug!, req.params.deviceId, String(req.query.platform ?? "")));
  }),
);

devicesRouter.get(
  "/api/devices/:deviceId/network-status",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    res.json(await getDeviceNetworkStatus(authorization, workspaceSlug!, req.params.deviceId, String(req.query.platform ?? "")));
  }),
);

// GET /api/devices/{device_id}/agent-diagnostics — stored-only read, no live
// Applivery call. Troubleshooting-only Agent Logs/Trace data is deliberately
// NOT part of the auto-loaded "extras" above (locations/network-status) —
// see devices.service.ts's getStoredAgentDiagnostics doc comment for why.
devicesRouter.get(
  "/api/devices/:deviceId/agent-diagnostics",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug");
    if (!workspaceSlug) throw new HttpError(401, "Missing credentials");
    res.json(await getStoredAgentDiagnostics(workspaceSlug, req.params.deviceId));
  }),
);

// POST /api/devices/{device_id}/agent-diagnostics/fetch — the Device modal
// Agent tab's on-demand "Fetch Agent Logs & Traces" button. manageDevices-
// gated like bulk-reattest above: this is an active, Applivery-API-consuming
// action an admin explicitly triggers, not a passive read.
devicesRouter.post(
  "/api/devices/:deviceId/agent-diagnostics/fetch",
  ...manageDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    res.json(await fetchDeviceAgentDiagnostics(authorization, workspaceSlug!, req.params.deviceId, String(req.query.platform ?? "")));
  }),
);

devicesRouter.get(
  "/api/devices/:deviceId/assets",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const segmentId = typeof req.query.segmentId === "string" ? req.query.segmentId : null;
    res.json(await getDeviceAssets(authorization, workspaceSlug!, segmentId));
  }),
);

// GET /api/devices/{device_id}/firewall-state (main.py:5488 — gated by
// requirePermission in the original too, not just verify_dashboard_token).
devicesRouter.get(
  "/api/devices/:deviceId/firewall-state",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    res.json(await getDeviceFirewallState(workspaceSlug, req.params.deviceId));
  }),
);

// PUT /api/devices/{device_id}/segment (main.py:4085)
devicesRouter.put(
  "/api/devices/:deviceId/segment",
  ...manageDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const payload = segmentUpdateSchema.parse(req.body);
    res.json(await updateDeviceSegment(authorization, workspaceSlug!, req.params.deviceId, payload));
  }),
);

// PUT /api/devices/{device_id}/tags (main.py:4110)
devicesRouter.put(
  "/api/devices/:deviceId/tags",
  ...manageDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const payload = tagsUpdateSchema.parse(req.body);
    res.json(await updateDeviceTags(authorization, workspaceSlug!, req.params.deviceId, payload));
  }),
);

// PUT /api/devices/{device_id}/policies (main.py:4223)
devicesRouter.put(
  "/api/devices/:deviceId/policies",
  ...manageDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const payload = policiesUpdateSchema.parse(req.body);
    res.json(await updateDevicePolicies(authorization, workspaceSlug!, req.params.deviceId, payload));
  }),
);

// POST /api/devices/bulk-reattest (main.py:7942)
devicesRouter.post(
  "/api/devices/bulk-reattest",
  ...manageDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const payload = bulkReattestSchema.parse(req.body);
    res.json(await bulkReattestDevices(authorization, workspaceSlug!, payload, req.dashboardUser?.sub ?? "unknown"));
  }),
);
