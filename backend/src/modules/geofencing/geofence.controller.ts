import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { prisma } from "../../services/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { getDevicesFull } from "../devices/devices.service";
import { geofenceZoneSchema, locationRefreshBudgetSchema } from "./geofence.schemas";
import { createGeofenceZone, deleteGeofenceZone, geofenceScopedDeviceIds, listGeofenceZones, updateGeofenceZone } from "./geofence.service";
import { getLocationRefreshStatus, manualRefreshDeviceLocations, setLocationRefreshBudget } from "./locationsRefresh.service";

export const geofenceRouter = Router();

// Geofence zones feed Compliance Policy conditions, so they ride the same
// "compliance" permission area as App Lists (also a compliance-policy
// building block reached from a different part of the UI) rather than a
// new dedicated area.
const readCompliance = [verifyDashboardToken, requirePermission({ area: "compliance", level: "read" })];
const manageCompliance = [verifyDashboardToken, requirePermission({ area: "compliance", level: "manage" })];

function requireCreds(authorization: string | undefined, workspaceSlug: string | undefined): asserts authorization is string {
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
}

async function loadEnabledPolicies(workspaceSlug: string) {
  return prisma.compliancePolicy.findMany({ where: { workspaceSlug, enabled: true } });
}

// ── Zones ──
geofenceRouter.get(
  "/api/geofences",
  ...readCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    res.json({ items: await listGeofenceZones(workspaceSlug) });
  }),
);
geofenceRouter.post(
  "/api/geofences",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    const payload = geofenceZoneSchema.parse(req.body);
    res.json(await createGeofenceZone(workspaceSlug, payload, req.dashboardUser?.sub ?? "unknown"));
  }),
);
geofenceRouter.put(
  "/api/geofences/:zoneId",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    const payload = geofenceZoneSchema.parse(req.body);
    res.json(await updateGeofenceZone(workspaceSlug, req.params.zoneId, payload));
  }),
);
geofenceRouter.delete(
  "/api/geofences/:zoneId",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    res.json(await deleteGeofenceZone(workspaceSlug, req.params.zoneId));
  }),
);

// ── Location refresh status/budget/manual-refresh — same shape as the
// Installed Apps status/budget/refresh trio (appLists.controller.ts) ──
geofenceRouter.get(
  "/api/geofences/location-refresh-status",
  ...readCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const [devicesResp, policies] = await Promise.all([getDevicesFull(authorization, workspaceSlug!, false), loadEnabledPolicies(workspaceSlug!)]);
    res.json(await getLocationRefreshStatus(workspaceSlug!, devicesResp.items, policies as any));
  }),
);
geofenceRouter.put(
  "/api/geofences/location-refresh-budget",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    const payload = locationRefreshBudgetSchema.parse(req.body);
    res.json(await setLocationRefreshBudget(workspaceSlug, payload.budgetPerHour));
  }),
);
geofenceRouter.post(
  "/api/geofences/refresh-locations",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const [devicesResp, policies] = await Promise.all([getDevicesFull(authorization, workspaceSlug!, false), loadEnabledPolicies(workspaceSlug!)]);
    const targetIds = geofenceScopedDeviceIds(devicesResp.items, policies as any);
    if (targetIds.size === 0) {
      res.json({ queued: 0 });
      return;
    }
    // Fire-and-forget, same pattern as /api/app-lists/refresh-installed-apps
    // — the response returns immediately with the queued count while the
    // actual per-device fetches run in the background.
    void manualRefreshDeviceLocations(Array.from(targetIds), devicesResp.items, authorization, workspaceSlug!);
    res.json({ queued: targetIds.size });
  }),
);
