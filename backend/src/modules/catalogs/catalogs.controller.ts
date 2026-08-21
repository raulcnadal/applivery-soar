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
import { getMispConfig, refreshMispNow, testMispConfig, updateMispConfig } from "./mispService";
import { getVulncheckConfig, refreshVulncheckNow, testVulncheckConfig, updateVulncheckConfig } from "./vulncheckService";
import { getBinaryIntegrityConfig, refreshBinaryIntegrityNow, updateBinaryIntegrityConfig } from "./binaryIntegrityService";
import { getOsvAndroidConfig, refreshOsvAndroidNow, testOsvAndroidConnection, updateOsvAndroidConfig } from "./osvAndroidService";
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

// ── MISP Threat Intel connector (per-workspace, opt-in) — merges into the
// same Apps/Device Vulnerability Service aggregate above rather than
// surfacing as a separate section (see mispService.ts's doc comment). ──
const mispConfigSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().default(""),
  apiKey: z.string().default(""),
  verifySsl: z.boolean().default(true),
  cpeGuesserBaseUrl: z.string().default(""),
  refreshIntervalHours: z.number().default(12),
});

catalogsRouter.get(
  "/api/misp/config",
  ...readCompliance,
  asyncHandler(async (req, res) => res.json(await getMispConfig(workspaceOf(req)))),
);
catalogsRouter.put(
  "/api/misp/config",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const payload = mispConfigSchema.parse(req.body);
    res.json(await updateMispConfig(workspaceOf(req), payload, req.dashboardUser?.sub ?? "unknown"));
  }),
);
catalogsRouter.post(
  "/api/misp/test",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const payload = z.object({ baseUrl: z.string().default(""), apiKey: z.string().default(""), verifySsl: z.boolean().default(true) }).parse(req.body);
    res.json(await testMispConfig(workspaceOf(req), payload));
  }),
);
catalogsRouter.post(
  "/api/misp/refresh",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    if (!authorization) throw new HttpError(401, "Missing credentials");
    res.json(await refreshMispNow(workspaceOf(req), authorization));
  }),
);

// ── VulnCheck connector (per-workspace, opt-in) — third source merged into
// the same Vulnerability aggregate via vulnSources.ts's plugin registry. ──
const vulncheckConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().default(""),
  cpeGuesserBaseUrl: z.string().default(""),
  refreshIntervalHours: z.number().default(12),
});

catalogsRouter.get(
  "/api/vulncheck/config",
  ...readCompliance,
  asyncHandler(async (req, res) => res.json(await getVulncheckConfig(workspaceOf(req)))),
);
catalogsRouter.put(
  "/api/vulncheck/config",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const payload = vulncheckConfigSchema.parse(req.body);
    res.json(await updateVulncheckConfig(workspaceOf(req), payload, req.dashboardUser?.sub ?? "unknown"));
  }),
);
catalogsRouter.post(
  "/api/vulncheck/test",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const payload = z.object({ apiKey: z.string().default("") }).parse(req.body);
    res.json(await testVulncheckConfig(workspaceOf(req), payload));
  }),
);
catalogsRouter.post(
  "/api/vulncheck/refresh",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    if (!authorization) throw new HttpError(401, "Missing credentials");
    res.json(await refreshVulncheckNow(workspaceOf(req), authorization));
  }),
);

// ── Binary Integrity (software identity) — reuses the workspace's own
// VirusTotal Threat Intel provider, no separate API key here. No bearer
// needed for refresh: the hashes it reads already live in local Prisma
// data (InstalledAppInventory), unlike the three CVE sources above which
// need a live session to re-fetch the fleet from Applivery's own API. ──
const binaryIntegrityConfigSchema = z.object({ refreshIntervalHours: z.number().default(24) });

catalogsRouter.get(
  "/api/binary-integrity/config",
  ...readCompliance,
  asyncHandler(async (req, res) => res.json(await getBinaryIntegrityConfig(workspaceOf(req)))),
);
catalogsRouter.put(
  "/api/binary-integrity/config",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const payload = binaryIntegrityConfigSchema.parse(req.body);
    res.json(await updateBinaryIntegrityConfig(workspaceOf(req), payload));
  }),
);
catalogsRouter.post(
  "/api/binary-integrity/refresh",
  ...manageCompliance,
  asyncHandler(async (req, res) => res.json(await refreshBinaryIntegrityNow(workspaceOf(req)))),
);

// ── Android Security Bulletin (OSV.dev) — fourth CVE source merged into the
// same Vulnerability aggregate via vulnSources.ts's plugin registry. Free,
// public, no API key; refresh needs no Automation Credential either, since
// it's a bulk reference-data fetch, not a per-device Applivery query. ──
const osvAndroidConfigSchema = z.object({
  enabled: z.boolean().default(false),
  refreshIntervalHours: z.number().default(24),
});

catalogsRouter.get(
  "/api/osv-android/config",
  ...readCompliance,
  asyncHandler(async (req, res) => res.json(await getOsvAndroidConfig(workspaceOf(req)))),
);
catalogsRouter.put(
  "/api/osv-android/config",
  ...manageCompliance,
  asyncHandler(async (req, res) => {
    const payload = osvAndroidConfigSchema.parse(req.body);
    res.json(await updateOsvAndroidConfig(workspaceOf(req), payload, req.dashboardUser?.sub ?? "unknown"));
  }),
);
catalogsRouter.post(
  "/api/osv-android/test",
  ...manageCompliance,
  asyncHandler(async (_req, res) => res.json(await testOsvAndroidConnection())),
);
catalogsRouter.post(
  "/api/osv-android/refresh",
  ...manageCompliance,
  asyncHandler(async (req, res) => res.json(await refreshOsvAndroidNow(workspaceOf(req)))),
);
