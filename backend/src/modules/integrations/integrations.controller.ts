import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { createIntegration, deleteIntegration, listIntegrations, testIntegration, updateIntegration } from "./integrations.service";
import { integrationPayloadSchema } from "./integrations.schemas";

/** Port of main.py:13342-13413, 13893-13923 (Integrations CRUD + test). */

export const integrationsRouter = Router();

const readGate = [verifyDashboardToken, requirePermission({ area: "integrations", level: "read" })];
const manageGate = [verifyDashboardToken, requirePermission({ area: "integrations", level: "manage", action: "canEditIntegrationSecrets" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

integrationsRouter.get("/api/integrations", ...readGate, asyncHandler(async (req, res) => {
  res.json(await listIntegrations(workspaceOf(req)));
}));

integrationsRouter.post("/api/integrations", ...manageGate, asyncHandler(async (req, res) => {
  const payload = integrationPayloadSchema.parse(req.body);
  res.json(await createIntegration(workspaceOf(req), payload, actorOf(req)));
}));

integrationsRouter.put("/api/integrations/:integrationId", ...manageGate, asyncHandler(async (req, res) => {
  const payload = integrationPayloadSchema.parse(req.body);
  res.json(await updateIntegration(workspaceOf(req), req.params.integrationId, payload, actorOf(req)));
}));

integrationsRouter.delete("/api/integrations/:integrationId", ...manageGate, asyncHandler(async (req, res) => {
  res.json(await deleteIntegration(workspaceOf(req), req.params.integrationId, actorOf(req)));
}));

integrationsRouter.post("/api/integrations/:integrationId/test", ...manageGate, asyncHandler(async (req, res) => {
  const dryRun = String(req.query.dry_run ?? "false") === "true";
  res.json(await testIntegration(workspaceOf(req), req.params.integrationId, dryRun));
}));
