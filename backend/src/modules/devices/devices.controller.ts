import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import {
  bulkReattestDevices,
  getDeviceCompliance,
  getDeviceFirewallState,
  getDevicesFull,
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
