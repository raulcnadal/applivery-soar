import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { deviceAppReportPayloadSchema, deviceReportPayloadSchema } from "./deviceData.schemas";
import { reportDeviceApps, reportDeviceData, verifyDeviceReportSecret } from "./deviceData.service";

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
