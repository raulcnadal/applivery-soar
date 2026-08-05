import { Router } from "express";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";

/**
 * Serves the raw device self-report script templates — port of
 * main.py:7845-7897 (`get_device_report_script` / `get_security_report_script`).
 * The frontend fills in the __WEBHOOK_URL__/__WORKSPACE_SLUG__/
 * __REPORT_SECRET__ placeholders client-side before offering the file for
 * download (it's the browser that knows the public origin, not this
 * backend process — same reasoning as the original).
 */

export const deviceReportScriptsRouter = Router();

const readDeviceReportScripts = [verifyDashboardToken, requirePermission({ area: "settings", level: "read" })];

const SCRIPTS_DIR = path.resolve(__dirname, "../../../scripts");

const APP_INVENTORY_SCRIPT_FILES: Record<string, string> = {
  macos: "report-installed-apps.sh",
  windows: "report-installed-apps.ps1",
};

const SECURITY_REPORT_SCRIPT_FILES: Record<string, string> = {
  windows: "report-security-attributes.ps1",
  macos: "report-security-attributes.sh",
};

async function serveScript(res: import("express").Response, table: Record<string, string>, platform: string, unknownMsg: string) {
  const filename = table[platform];
  if (!filename) {
    res.status(404).json({ detail: unknownMsg });
    return;
  }
  const filePath = path.join(SCRIPTS_DIR, filename);
  if (!existsSync(filePath)) {
    res.status(404).json({ detail: "Script template not found on the server" });
    return;
  }
  const content = await readFile(filePath, "utf-8");
  res.setHeader("Content-Type", "text/plain");
  res.send(content);
}

deviceReportScriptsRouter.get("/api/settings/device-report-scripts/:platform", ...readDeviceReportScripts, asyncHandler(async (req, res) => {
  await serveScript(res, APP_INVENTORY_SCRIPT_FILES, req.params.platform, "Unknown platform — expected 'macos' or 'windows'");
}));

deviceReportScriptsRouter.get("/api/settings/device-report-scripts-security/:platform", ...readDeviceReportScripts, asyncHandler(async (req, res) => {
  await serveScript(res, SECURITY_REPORT_SCRIPT_FILES, req.params.platform, "Unknown platform — expected 'windows' or 'macos'");
}));
