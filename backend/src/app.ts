import cors from "cors";
import express from "express";
import path from "path";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler.middleware";
import { rateLimiterMiddleware } from "./middleware/rateLimiter.middleware";
import { authRouter } from "./modules/auth/auth.controller";
import { deviceAudiencesRouter } from "./modules/devices/deviceAudiences.controller";
import { deviceCatalogRouter } from "./modules/devices/deviceCatalog.controller";
import { devicesRouter } from "./modules/devices/devices.controller";
import { deviceDataRouter } from "./modules/devices/deviceData.controller";
import { healthRouter } from "./modules/health/health.controller";
import { rolesRouter } from "./modules/roles/roles.controller";
import { appListsRouter } from "./modules/appLists/appLists.controller";
import { catalogsRouter } from "./modules/catalogs/catalogs.controller";
import { complianceRouter } from "./modules/compliance/compliance.controller";
import { workflowsRouter } from "./modules/workflows/workflows.controller";
import { settingsRouter } from "./modules/settings/settings.controller";
import { agentBuildsRouter } from "./modules/settings/agentBuilds.controller";
import { actionLibraryRouter } from "./modules/workflows/actionLibrary.controller";
import { scriptAssetsRouter } from "./modules/workflows/scriptAssets.controller";
import { scriptReposRouter } from "./modules/workflows/scriptRepos.controller";
import { firewallRuleSetsRouter } from "./modules/workflows/firewallRuleSets.controller";
import { triggersRouter } from "./modules/workflows/triggers.controller";
import { casesRouter } from "./modules/cases/cases.controller";
import { integrationsRouter } from "./modules/integrations/integrations.controller";
import { threatIntelRouter } from "./modules/threatIntel/threatIntel.controller";
import { auditLogsRouter } from "./modules/auditLogs/auditLogs.controller";
import { logExportDestinationsRouter } from "./modules/settings/logExportDestinations.controller";
import { deviceReportScriptsRouter } from "./modules/settings/deviceReportScripts.controller";
import { configRouter } from "./modules/config/config.controller";
import { systemHealthRouter } from "./modules/systemHealth/systemHealth.controller";
import { appliveryWebhookSettingsRouter } from "./modules/settings/appliveryWebhookSettings.controller";
import { analyticsRouter } from "./modules/analytics/analytics.controller";
import { dashboardStateRouter } from "./modules/analytics/dashboardState.controller";
import { reportsRouter } from "./modules/reports/reports.controller";
import { helpRouter } from "./modules/help/help.controller";
import { geofenceRouter } from "./modules/geofencing/geofence.controller";

export function createApp() {
  const app = express();

  // CORS is wide open at the transport layer, same as the original app —
  // access control is entirely at the application layer (dashboard JWT +
  // RBAC), not CORS (ARCHITECTURE.md §2.1).
  app.use(cors({ origin: env.corsOrigins.includes("*") ? true : env.corsOrigins }));
  app.use(express.json({ limit: "10mb" }));
  app.use(rateLimiterMiddleware);

  app.use(healthRouter);
  app.use(authRouter);
  app.use(rolesRouter);
  app.use(devicesRouter);
  app.use(deviceDataRouter);
  app.use(deviceCatalogRouter);
  app.use(deviceAudiencesRouter);
  app.use(appListsRouter);
  app.use(catalogsRouter);
  app.use(complianceRouter);
  app.use(workflowsRouter);
  app.use(settingsRouter);
  app.use(agentBuildsRouter);
  app.use(actionLibraryRouter);
  app.use(scriptAssetsRouter);
  app.use(scriptReposRouter);
  app.use(firewallRuleSetsRouter);
  app.use(triggersRouter);
  app.use(casesRouter);
  app.use(integrationsRouter);
  app.use(threatIntelRouter);
  app.use(auditLogsRouter);
  app.use(logExportDestinationsRouter);
  app.use(deviceReportScriptsRouter);
  app.use(configRouter);
  app.use(systemHealthRouter);
  app.use(appliveryWebhookSettingsRouter);
  app.use(analyticsRouter);
  app.use(dashboardStateRouter);
  app.use(reportsRouter);
  app.use(helpRouter);
  app.use(geofenceRouter);

  // Static frontend serving, mirroring the original single-image pattern
  // (ARCHITECTURE.md §2.1): serve Vue's built dist/, catch-all to
  // index.html for client-side routing, guarded against path traversal by
  // express.static + sendFile's own resolution.
  const frontendDist = path.resolve(__dirname, "../../frontend/dist");
  app.use(express.static(frontendDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"), (err) => {
      if (err) res.status(404).send("Frontend build not found — run `npm run build` in /frontend");
    });
  });

  // Must be registered last — catches errors thrown/forwarded by every
  // asyncHandler-wrapped route above.
  app.use(errorHandler);

  return app;
}
