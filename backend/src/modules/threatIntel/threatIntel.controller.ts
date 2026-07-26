import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { createThreatIntelProvider, deleteThreatIntelProvider, listThreatIntelProviders, testThreatIntelProvider, updateThreatIntelProvider } from "./threatIntel.service";
import { threatIntelProviderPayloadSchema } from "./threatIntel.schemas";

/** Port of main.py:14237-14320 (Threat Intel Providers CRUD + test). */

export const threatIntelRouter = Router();

const readGate = [verifyDashboardToken, requirePermission({ area: "integrations", level: "read" })];
const manageGate = [verifyDashboardToken, requirePermission({ area: "integrations", level: "manage", action: "canEditIntegrationSecrets" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

threatIntelRouter.get("/api/threat-intel/providers", ...readGate, asyncHandler(async (req, res) => {
  res.json(await listThreatIntelProviders(workspaceOf(req)));
}));

threatIntelRouter.post("/api/threat-intel/providers", ...manageGate, asyncHandler(async (req, res) => {
  const payload = threatIntelProviderPayloadSchema.parse(req.body);
  res.json(await createThreatIntelProvider(workspaceOf(req), payload, actorOf(req)));
}));

threatIntelRouter.put("/api/threat-intel/providers/:providerId", ...manageGate, asyncHandler(async (req, res) => {
  const payload = threatIntelProviderPayloadSchema.parse(req.body);
  res.json(await updateThreatIntelProvider(workspaceOf(req), req.params.providerId, payload, actorOf(req)));
}));

threatIntelRouter.delete("/api/threat-intel/providers/:providerId", ...manageGate, asyncHandler(async (req, res) => {
  res.json(await deleteThreatIntelProvider(workspaceOf(req), req.params.providerId, actorOf(req)));
}));

threatIntelRouter.post("/api/threat-intel/providers/:providerId/test", ...manageGate, asyncHandler(async (req, res) => {
  res.json(await testThreatIntelProvider(workspaceOf(req), req.params.providerId));
}));
