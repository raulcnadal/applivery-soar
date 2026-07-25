import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { deviceAudienceCreateSchema } from "./devices.schemas";
import { createDeviceAudience, getDeviceAudienceMatchedDevices, listDeviceAudiences } from "./deviceAudiences.service";

export const deviceAudiencesRouter = Router();

const readDevices = [verifyDashboardToken, requirePermission({ area: "devices", level: "read" })];
const manageDevices = [verifyDashboardToken, requirePermission({ area: "devices", level: "manage" })];

function requireCreds(authorization: string | undefined, workspaceSlug: string | undefined): asserts authorization is string {
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
}

// GET /api/device-audiences (main.py:3728)
deviceAudiencesRouter.get(
  "/api/device-audiences",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    res.json(await listDeviceAudiences(authorization, workspaceSlug!));
  }),
);

// POST /api/device-audiences (main.py:4053)
deviceAudiencesRouter.post(
  "/api/device-audiences",
  ...manageDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const payload = deviceAudienceCreateSchema.parse(req.body);
    res.json(await createDeviceAudience(authorization, workspaceSlug!, payload));
  }),
);

// GET /api/device-audiences/{audience_id}/matched-devices (main.py:3758)
deviceAudiencesRouter.get(
  "/api/device-audiences/:audienceId/matched-devices",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    res.json(await getDeviceAudienceMatchedDevices(authorization, workspaceSlug!, req.params.audienceId));
  }),
);
