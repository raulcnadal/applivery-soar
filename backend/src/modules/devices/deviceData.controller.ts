import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { deviceAppReportPayloadSchema, deviceReportPayloadSchema } from "./deviceData.schemas";
import { getAgentStatus, reportDeviceApps, reportDeviceData, verifyDeviceReportSecret } from "./deviceData.service";
import { listEnabledChecksForAgent } from "../compliance/customChecks.service";

/** Port of main.py:7758-7804 / 9714-9804 — POST /api/device-data/report, POST /api/device-data/report-apps. */

export const deviceDataRouter = Router();

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}

deviceDataRouter.post(
  "/api/device-data/report",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceReportSecret(workspaceSlug, req.header("X-Device-Report-Secret"));
    const payload = deviceReportPayloadSchema.parse(req.body);
    res.json(await reportDeviceData(workspaceSlug, payload));
  }),
);

deviceDataRouter.post(
  "/api/device-data/report-apps",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceReportSecret(workspaceSlug, req.header("X-Device-Report-Secret"));
    const payload = deviceAppReportPayloadSchema.parse(req.body);
    res.json(await reportDeviceApps(workspaceSlug, payload));
  }),
);

/**
 * Agent poll endpoint — GET /api/device-data/custom-checks?platform=windows|macos
 * (customChecks.service.ts's module doc has the full design). Same auth as
 * the two report endpoints above: this is an unattended device caller, not
 * a logged-in admin. The agent calls this once per report cycle, runs every
 * check it gets back locally, and includes the results in its next
 * POST /api/device-data/report call (customCheckResults field).
 */
deviceDataRouter.get(
  "/api/device-data/custom-checks",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceReportSecret(workspaceSlug, req.header("X-Device-Report-Secret"));
    const platform = typeof req.query.platform === "string" ? req.query.platform : "";
    if (platform !== "windows" && platform !== "macos") {
      res.status(400).json({ detail: "platform query param must be 'windows' or 'macos'" });
      return;
    }
    res.json({ items: await listEnabledChecksForAgent(workspaceSlug, platform) });
  }),
);

/**
 * Agent poll endpoint — GET /api/device-data/agent-status?serialNumber=...&platform=windows.
 * Powers the Windows agent's tray icon right-click menu (and, going
 * forward, any other platform's equivalent): which Compliance Policies
 * apply to this device, whether it's currently compliant, and its risk
 * score/tier. Same device-caller auth as every other endpoint in this
 * router — see getAgentStatus's own doc comment (deviceData.service.ts) for
 * why this always returns 200 with `compliance.available: false` instead of
 * erroring when compliance can't be computed yet.
 */
deviceDataRouter.get(
  "/api/device-data/agent-status",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceReportSecret(workspaceSlug, req.header("X-Device-Report-Secret"));
    const serialNumber = typeof req.query.serialNumber === "string" ? req.query.serialNumber.trim() : "";
    const platform = typeof req.query.platform === "string" ? req.query.platform : "";
    if (!serialNumber) {
      res.status(400).json({ detail: "serialNumber query param is required" });
      return;
    }
    res.json(await getAgentStatus(workspaceSlug, serialNumber, platform));
  }),
);
