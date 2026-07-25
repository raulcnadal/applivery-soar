import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import {
  DEPLOYMENT_MODELS,
  getApps,
  getDeviceTags,
  getMdmUserTags,
  getMdmUsers,
  getPolicies,
  getSegments,
  getSmartAttributes,
} from "./deviceCatalog.service";
import { MDM_ACTIONS } from "./mdmActions";

export const deviceCatalogRouter = Router();

// Every catalog/picker endpoint below is read-only against Applivery, gated
// the same "devices" feature area as the Devices view itself (they only
// exist to feed its pickers) — main.py gates each with verify_dashboard_token
// only, but the migration plan declares "devices" as a real gated feature
// area (migration-plan.md), so these get the same requirePermission
// treatment as GET /api/devices for consistency.
const readDevices = [verifyDashboardToken, requirePermission({ area: "devices", level: "read" })];

function requireCreds(authorization: string | undefined, workspaceSlug: string | undefined): asserts authorization is string {
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
}

// GET /api/policies (main.py:3661)
deviceCatalogRouter.get(
  "/api/policies",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const platform = String(req.query.platform ?? "");
    res.json(await getPolicies(authorization, workspaceSlug!, platform));
  }),
);

// GET /api/apps (main.py:3692)
deviceCatalogRouter.get(
  "/api/apps",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const platform = String(req.query.platform ?? "");
    res.json(await getApps(authorization, workspaceSlug!, platform));
  }),
);

// GET /api/segments (main.py:3893)
deviceCatalogRouter.get(
  "/api/segments",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    res.json(await getSegments(authorization, workspaceSlug!));
  }),
);

// GET /api/smart-attributes (main.py:3923)
deviceCatalogRouter.get(
  "/api/smart-attributes",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    res.json(await getSmartAttributes(authorization, workspaceSlug!));
  }),
);

// GET /api/device-tags (main.py:3953)
deviceCatalogRouter.get(
  "/api/device-tags",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    res.json(await getDeviceTags(authorization, workspaceSlug!));
  }),
);

// GET /api/mdm-user-tags (main.py:3983)
deviceCatalogRouter.get(
  "/api/mdm-user-tags",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    res.json(await getMdmUserTags(authorization, workspaceSlug!));
  }),
);

// GET /api/mdm-users (main.py:4012)
deviceCatalogRouter.get(
  "/api/mdm-users",
  ...readDevices,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    res.json(await getMdmUsers(authorization, workspaceSlug!, search));
  }),
);

// GET /api/mdm-actions — exposes the MDM_ACTIONS registry (main.py:4357) for
// the workflow builder's action picker (Phase 4 builds the builder itself;
// this just serves the static catalog now, single source of truth for
// whichever frontend consumes it first).
deviceCatalogRouter.get(
  "/api/mdm-actions",
  verifyDashboardToken,
  asyncHandler(async (_req, res) => {
    res.json({ items: MDM_ACTIONS });
  }),
);

// GET /api/deployment-models (main.py:5513)
deviceCatalogRouter.get(
  "/api/deployment-models",
  verifyDashboardToken,
  asyncHandler(async (_req, res) => {
    res.json({ items: DEPLOYMENT_MODELS });
  }),
);
