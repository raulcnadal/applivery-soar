import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { prisma } from "../../services/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { getDevicesFull } from "../devices/devices.service";
import {
  addAppCatalogEntry,
  createAppList,
  deleteAppCatalogEntry,
  deleteAppList,
  getAppListUsage,
  listAppCatalog,
  listAppLists,
  updateAppList,
} from "./appCatalog.service";
import { searchApps } from "./appSearch.service";
import {
  getAppleAppUpdatesStatus,
  getInstalledAppsStatus,
  manualRefreshInstalledApps,
  appListScopedDeviceIds,
  appleAppUpdateDeviceIds,
  setInstalledAppsBudget,
} from "./installedApps.service";
import { appCatalogAddSchema, appListSchema, installedAppsBudgetSchema } from "./appLists.schemas";

export const appListsRouter = Router();

const readCompliance = [verifyDashboardToken, requirePermission({ area: "compliance", level: "read" })];
const manageCompliance = [verifyDashboardToken, requirePermission({ area: "compliance", level: "manage" })];

function requireCreds(authorization: string | undefined, workspaceSlug: string | undefined): asserts authorization is string {
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
}

async function loadEnabledPolicies(workspaceSlug: string) {
  return prisma.compliancePolicy.findMany({ where: { workspaceSlug, enabled: true } });
}

// ── App Catalog ──
appListsRouter.get(
  "/api/app-catalog",
  ...readCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    res.json(await listAppCatalog(workspaceSlug, typeof req.query.platform === "string" ? req.query.platform : undefined));
  }),
);
appListsRouter.post(
  "/api/app-catalog",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    const payload = appCatalogAddSchema.parse(req.body);
    res.json(await addAppCatalogEntry(workspaceSlug, payload));
  }),
);
appListsRouter.delete(
  "/api/app-catalog/:entryId",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    res.json(await deleteAppCatalogEntry(workspaceSlug, req.params.entryId));
  }),
);

// ── App Lists ──
appListsRouter.get(
  "/api/app-lists",
  ...readCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    res.json(await listAppLists(workspaceSlug, typeof req.query.platform === "string" ? req.query.platform : undefined));
  }),
);
appListsRouter.post(
  "/api/app-lists",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    const payload = appListSchema.parse(req.body);
    res.json(await createAppList(workspaceSlug, payload, req.dashboardUser?.sub ?? "unknown"));
  }),
);
appListsRouter.put(
  "/api/app-lists/:listId",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    const payload = appListSchema.parse(req.body);
    res.json(await updateAppList(workspaceSlug, req.params.listId, payload, req.dashboardUser?.sub ?? "unknown"));
  }),
);
appListsRouter.delete(
  "/api/app-lists/:listId",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    res.json(await deleteAppList(workspaceSlug, req.params.listId, req.dashboardUser?.sub ?? "unknown"));
  }),
);
appListsRouter.get(
  "/api/app-lists/:listId/usage",
  ...readCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    res.json(await getAppListUsage(workspaceSlug, req.params.listId));
  }),
);

// ── App search ──
appListsRouter.get(
  "/api/app-search",
  ...readCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const platform = String(req.query.platform ?? "");
    const text = String(req.query.text ?? "");
    const source = typeof req.query.source === "string" ? req.query.source : undefined;
    res.json(await searchApps(authorization, workspaceSlug!, platform, text, source));
  }),
);

// ── Installed apps status/budget/refresh ──
appListsRouter.get(
  "/api/app-lists/installed-apps-status",
  ...readCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const [devicesResp, policies] = await Promise.all([getDevicesFull(authorization, workspaceSlug!, false), loadEnabledPolicies(workspaceSlug!)]);
    res.json(await getInstalledAppsStatus(workspaceSlug!, devicesResp.items, policies as any));
  }),
);
appListsRouter.put(
  "/api/app-lists/installed-apps-budget",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const workspaceSlug = req.header("X-Workspace-Slug") || "global";
    const payload = installedAppsBudgetSchema.parse(req.body);
    res.json(await setInstalledAppsBudget(workspaceSlug, payload.budgetPerHour));
  }),
);
appListsRouter.post(
  "/api/app-lists/refresh-installed-apps",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const [devicesResp, policies] = await Promise.all([getDevicesFull(authorization, workspaceSlug!, false), loadEnabledPolicies(workspaceSlug!)]);
    const targetIds = appListScopedDeviceIds(devicesResp.items, policies as any);
    if (targetIds.size === 0) {
      res.json({ queued: 0 });
      return;
    }
    // Fire-and-forget, mirroring the original's BackgroundTasks.add_task —
    // the response returns immediately with the queued count.
    void manualRefreshInstalledApps(Array.from(targetIds), devicesResp.items, authorization, workspaceSlug!);
    res.json({ queued: targetIds.size });
  }),
);

// ── Apple pending app updates ──
appListsRouter.get(
  "/api/apple-app-updates/status",
  ...readCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const devicesResp = await getDevicesFull(authorization, workspaceSlug!, false);
    res.json(await getAppleAppUpdatesStatus(workspaceSlug!, devicesResp.items));
  }),
);
appListsRouter.post(
  "/api/apple-app-updates/refresh",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const devicesResp = await getDevicesFull(authorization, workspaceSlug!, false);
    const targetIds = appleAppUpdateDeviceIds(devicesResp.items);
    if (targetIds.size === 0) {
      res.json({ queued: 0 });
      return;
    }
    void manualRefreshInstalledApps(Array.from(targetIds), devicesResp.items, authorization, workspaceSlug!);
    res.json({ queued: targetIds.size });
  }),
);
