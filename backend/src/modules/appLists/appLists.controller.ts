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
import { lookupAndroidAppByPackageName, searchApps } from "./appSearch.service";
import { fetchWindowsApplicationDetail, fetchWindowsApplications, matchWindowsApplication } from "./windowsAppCatalog.service";
import { resolveOrgBase } from "../auth/rbac.service";
import { computeReportedAppsVulnSummaries } from "../catalogs/vulnService";
import { computeAppIntegrityStatusBulk } from "../catalogs/binaryIntegrityService";
import {
  getAppleAppUpdatesStatus,
  getInstalledAppsStatus,
  getReportedAppsOverview,
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

// ── Reported apps overview (Apps main-nav view) ──
appListsRouter.get(
  "/api/app-lists/reported-apps",
  ...readCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const devicesResp = await getDevicesFull(authorization, workspaceSlug!, false);
    const overview = await getReportedAppsOverview(workspaceSlug!, devicesResp.items);
    // Merged here rather than inside getReportedAppsOverview itself — keeps
    // installedApps.service.ts free of Vulnerability Service concerns (it
    // already has no other dependency on vulnService.ts) and lets this one
    // bulk lookup cover every app in the overview in a single query instead
    // of one per app. Risk score column (ReportedAppsPanel.vue) and the App
    // detail modal's per-version CVE breakdown (AppDetailModal.vue) both
    // read this same vulnSummary field.
    const vulnSummaries = await computeReportedAppsVulnSummaries(
      workspaceSlug!,
      overview.apps.map((a) => ({ identifier: a.identifier, platform: a.platform, versions: a.versions })),
    );
    for (const app of overview.apps) {
      app.vulnSummary = vulnSummaries.get(`${app.platform}:${app.identifier}`) ?? null;
    }
    // Same bulk-lookup rationale as vulnSummaries above: one query across
    // every device row in the whole overview instead of one per row. This
    // was missing entirely before — the Device modal's Apps tab has shown a
    // per-app VirusTotal verdict for a while (computeDeviceAppsDetail), but
    // this fleet-wide Apps view / AppDetailModal.vue never surfaced it, so a
    // binary flagged "malicious" on one device looked clean here.
    const allHashes = overview.apps.flatMap((a) => a.devices.map((d) => d.sha256));
    const integrityByHash = await computeAppIntegrityStatusBulk(workspaceSlug!, allHashes);
    for (const app of overview.apps) {
      for (const d of app.devices) {
        d.integrity = d.sha256 ? integrityByHash.get(d.sha256.toLowerCase()) ?? null : null;
      }
    }
    res.json(overview);
  }),
);

// ── Windows app catalog lookup (Apps view detail modal) ──
appListsRouter.get(
  "/api/app-lists/windows-app-detail",
  ...readCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    const productCode = typeof req.query.productCode === "string" ? req.query.productCode.trim() : "";
    if (!name) {
      res.json({ matched: false, application: null });
      return;
    }
    const headers = { Authorization: authorization, "Content-Type": "application/json" };
    const orgBase = await resolveOrgBase(headers, workspaceSlug!);
    const items = await fetchWindowsApplications(headers, orgBase);
    const match = matchWindowsApplication(items, name, productCode || null);
    if (!match) {
      res.json({ matched: false, application: null });
      return;
    }
    // Re-fetch via the single-application endpoint rather than returning the
    // list item directly — same data today, but this is the documented,
    // intended way to load one application's full detail (docs.applivery.com
    // Windows > Applications > Get Application) and leaves room for that
    // endpoint to return more than the list embed does in the future.
    const detail = await fetchWindowsApplicationDetail(headers, orgBase, match.id);
    res.json({ matched: true, application: detail ?? match });
  }),
);

// ── Android Google Play exact-package lookup (App Catalog add flow) ──
appListsRouter.get(
  "/api/app-lists/android-app-lookup",
  ...readCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const packageName = typeof req.query.packageName === "string" ? req.query.packageName.trim() : "";
    if (!packageName) {
      res.json({ found: false, name: null, error: null });
      return;
    }
    const headers = { Authorization: authorization, "Content-Type": "application/json" };
    const orgBase = await resolveOrgBase(headers, workspaceSlug!);
    res.json(await lookupAndroidAppByPackageName(headers, orgBase, packageName));
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
