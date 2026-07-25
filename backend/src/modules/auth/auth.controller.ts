import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { setCachedAccess, type SoarRoleRecord } from "../../middleware/rbac.middleware";
import { prisma } from "../../services/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { toSoarRoleRecord, type RoleRow } from "../roles/roles.service";
import { loginSchema, refreshSchema } from "./auth.schemas";
import { loginWithApplivery, refreshAppliveryTokens } from "./auth.service";
import { resolveOrgBase, resolveSoarAccess } from "./rbac.service";

export const authRouter = Router();

// POST /api/auth/login — no dashboard-token gate (this IS the login call).
authRouter.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const payload = loginSchema.parse(req.body);
    const result = await loginWithApplivery(payload.email, payload.password, payload.twoFactorCode);
    res.json(result);
  }),
);

// POST /api/auth/refresh — only renews the Applivery-side tokens; never
// touches the dashboard JWT, so it's deliberately not gated by it either
// (main.py:1004 has no verify_dashboard_token dependency).
authRouter.post(
  "/api/auth/refresh",
  asyncHandler(async (req, res) => {
    const payload = refreshSchema.parse(req.body);
    const result = await refreshAppliveryTokens(payload.lastAccessToken, payload.refreshToken);
    if (result === null) {
      throw new HttpError(401, { error: "Session expired — please sign in again." });
    }
    res.json(result);
  }),
);

// POST /api/auth/resolve-access — called by the frontend right after login
// and right after every workspace switch. Resolves and caches this
// collaborator's SOAR access for the current workspace.
authRouter.post(
  "/api/auth/resolve-access",
  verifyDashboardToken,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    if (!authorization || !workspaceSlug) {
      throw new HttpError(401, "Missing credentials");
    }
    const email = req.dashboardUser?.sub ?? "";
    const headers = { Authorization: authorization, "Content-Type": "application/json" };

    const orgBase = await resolveOrgBase(headers, workspaceSlug);

    const roleRows: RoleRow[] = await prisma.role.findMany({ where: { workspaceSlug } });
    const roles: SoarRoleRecord[] = roleRows.map(toSoarRoleRecord);

    const access = await resolveSoarAccess(orgBase, headers, email, roles);
    setCachedAccess(workspaceSlug, email, access);
    res.json(access);
  }),
);
