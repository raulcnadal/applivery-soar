import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { collaboratorTagsSchema, rolePayloadSchema, testAccessSchema } from "./roles.schemas";
import * as rolesService from "./roles.service";

export const rolesRouter = Router();

// Every Roles endpoint is Super-Admin-only in the original app (main.py
// :1293-1467) — no area/level distinction, just the same gate on all 7
// routes.
const superAdminOnly = [verifyDashboardToken, requirePermission({ superAdminOnly: true })];

rolesRouter.get(
  "/api/roles",
  ...superAdminOnly,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    res.json(await rolesService.listRoles(workspaceSlug));
  }),
);

rolesRouter.post(
  "/api/roles",
  ...superAdminOnly,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    const payload = rolePayloadSchema.parse(req.body);
    res.json(await rolesService.createRole(workspaceSlug, payload, req.dashboardUser?.sub ?? "unknown"));
  }),
);

rolesRouter.put(
  "/api/roles/:roleId",
  ...superAdminOnly,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    const payload = rolePayloadSchema.parse(req.body);
    res.json(await rolesService.updateRole(workspaceSlug, req.params.roleId, payload, req.dashboardUser?.sub ?? "unknown"));
  }),
);

rolesRouter.delete(
  "/api/roles/:roleId",
  ...superAdminOnly,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    res.json(await rolesService.deleteRole(workspaceSlug, req.params.roleId, req.dashboardUser?.sub ?? "unknown"));
  }),
);

rolesRouter.get(
  "/api/roles/collaborators-directory",
  ...superAdminOnly,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
    res.json(await rolesService.getCollaboratorsDirectory(authorization, workspaceSlug));
  }),
);

rolesRouter.put(
  "/api/roles/collaborators/:collaboratorId",
  ...superAdminOnly,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
    const payload = collaboratorTagsSchema.parse(req.body);
    res.json(
      await rolesService.updateCollaboratorTags(
        req.params.collaboratorId,
        payload,
        authorization,
        workspaceSlug,
        req.dashboardUser?.sub ?? "unknown",
      ),
    );
  }),
);

rolesRouter.post(
  "/api/roles/test-access",
  ...superAdminOnly,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
    const payload = testAccessSchema.parse(req.body);
    res.json(await rolesService.testAccess(payload, authorization, workspaceSlug));
  }),
);
