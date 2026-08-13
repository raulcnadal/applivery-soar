import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { loadOsUpdateCatalog, refreshOsUpdateCatalog } from "./osUpdateCatalog";
import { loadVulnCatalog, refreshVulnCatalog } from "./vulnCatalog";
import { loadOsLifecycleCatalog, refreshOsLifecycleCatalog } from "./osLifecycleCatalog";
import { loadGdmfCatalog, refreshGdmfCatalog } from "./gdmfCatalog";
import { loadAppleDeviceIdentifiers, refreshAppleDeviceIdentifiers } from "./appleDeviceIdentifiers";
import { getMitreTechniques, refreshMitreCatalog } from "./mitreCatalog";
import { getVulnServiceConfig, refreshVulnServiceNow, testVulnServiceConfig, updateVulnServiceConfig } from "./vulnService";
import { z } from "zod";

/**
 * Shared controller wiring the five global intelligence catalogs (OS Update,
 * Vuln/EUVD, OS Lifecycle, GDMF, MITRE) plus the per-workspace, opt-in
 * Vulnerability Service — port of the read/refresh endpoints scattered
 * across main.py's compliance section (16523-17617). Reads are always
 * cache-only (never trigger a live fetch inline); refreshes are manual,
 * admin-triggered pokes of the same logic the background scheduler runs
 * on its own cadence (backgroundJobs.ts).
 */

export const catalogsRouter = Router();

const readCompliance = [verifyDashboardToken, requirePermission({ area: "compliance", level: "read" })];
const manageCompliance = [verifyDashboardToken, requirePermission({ area: "compliance", level: "manage" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}

// ── OS Update Intelligence (Windows / MSRC) ──
catalogsRouter.get(
  "/api/os-updates/catalog",
  ...readCompliance,
  asyncHandler(async (_req, res) => res.json(await loadOsUpdateCatalog())),
);
catalogsRouter.post(
  "/api/os-updates/refresh",
  ...manageCompliance,
  asyncHandler(async (_req, res) => res.json(await refreshOsUpdateCatalog())),
);

// ── Apple & Android Vulnerability Intelligence (EUVD) ──
catalogsRouter.get(
  "/api/vuln-catalog/catalog",
  ...readCompliance,
  asyncHandler(async (_req, res) => res.json(await loadVulnCatalog())),
);
catalogsRouter.post(
  "/api/vuln-catalog/refresh",
  ...manageCompliance,
  asyncHandler(async (_req, res) => res.json(await refreshVulnCatalog())),
);

// ── OS Lifecycle (endoflife.date) ──
catalogsRouter.get(
  "/api/os-lifecycle/catalog",
  ...readCompliance,
  asyncHandler(async (_req, res) => res.json(await loadOsLifecycleCatalog())),
);
catalogsRouter.post(
  "/api/os-lifecycle/refresh",
  ...manageCompliance,
  asyncHandler(async (_req, res) => res.json(await refreshOsLifecycleCatalog())),
);

// ── Apple Software Lookup Service (GDMF) ──
catalogsRouter.get(
  "/api/gdmf/catalog",
  ...readCompliance,
  asyncHandler(async (_req, res) => res.json(await loadGdmfCatalog())),
);
catalogsRouter.post(
  "/api/gdmf/refresh",
  ...manageCompliance,
  asyncHandler(async (_req, res) => res.json(await refreshGdmfCatalog())),
);

// ── Apple hardware-identifier resolver (marketing name → GDMF identifier) ──
catalogsRouter.get(
  "/api/apple-device-identifiers/catalog",
  ...readCompliance,
  asyncHandler(async (_req, res) => res.json(await loadAppleDeviceIdentifiers())),
);
catalogsRouter.post(
  "/api/apple-device-identifiers/refresh",
  ...manageCompliance,
  asyncHandler(async (_req, res) => res.json(await refreshAppleDeviceIdentifiers())),
);

// ── MITRE ATT&CK ──
catalogsRouter.get(
  "/api/mitre/techniques",
  ...readCompliance,
  asyncHandler(async (_req, res) => res.json(await getMitreTechniques())),
);
catalogsRouter.post(
  "/api/mitre/refresh",
  ...manageCompliance,
  asyncHandler(async (_req, res) => res.json(await refreshMitreCatalog())),
);

// ── Vulnerability Service (per-workspace, opt-in) ──
const vulnServiceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().default(""),
  apiToken: z.string().default(""),
  refreshIntervalHours: z.number().default(6),
});

catalogsRouter.get(
  "/api/vuln-service/config",
  ...readCompliance,
  asyncHandler(async (req, res) => res.json(await getVulnServiceConfig(workspaceOf(req)))),
);
catalogsRouter.put(
  "/api/vuln-service/config",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const payload = vulnServiceConfigSchema.parse(req.body);
    res.json(await updateVulnServiceConfig(workspaceOf(req), payload, req.dashboardUser?.sub ?? "unknown"));
  }),
);
catalogsRouter.post(
  "/api/vuln-service/test",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const payload = z.object({ baseUrl: z.string().default(""), apiToken: z.string().default("") }).parse(req.body);
    res.json(await testVulnServiceConfig(workspaceOf(req), payload));
  }),
);
catalogsRouter.post(
  "/api/vuln-service/refresh",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    if (!authorization) throw new HttpError(401, "Missing credentials");
    res.json(await refreshVulnServiceNow(workspaceOf(req), authorization));
  }),
);
