import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { getWidgetData } from "./widgets.service";
import { captureDailySnapshot } from "./snapshotCapture";
import { listSnapshotDates, loadSnapshot, SNAPSHOT_RETENTION_DAYS } from "./snapshotEngine";
import { syncDeviceLocations } from "./locationsSync.service";

export const analyticsRouter = Router();

function requireCreds(authorization: string | undefined, workspaceSlug: string | undefined): asserts authorization is string {
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
}

// GET /api/analytics/widget (main.py:14386)
analyticsRouter.get(
  "/api/analytics/widget",
  verifyDashboardToken,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const source = String(req.query.source ?? "");
    let filters: Record<string, any> = {};
    try {
      filters = JSON.parse(String(req.query.filters ?? "{}"));
    } catch {
      filters = {};
    }
    const dateIni = typeof req.query.dateIni === "string" ? req.query.dateIni : null;
    const dateEnd = typeof req.query.dateEnd === "string" ? req.query.dateEnd : null;
    res.json(await getWidgetData({ source, filters, dateIni, dateEnd, authorization, workspaceSlug: workspaceSlug! }));
  }),
);

// GET /api/analytics/snapshots (main.py:2822)
analyticsRouter.get(
  "/api/analytics/snapshots",
  verifyDashboardToken,
  asyncHandler(async (req, res) => {
    const slugKey = req.header("X-Workspace-Slug") || "global";
    const dates = await listSnapshotDates(slugKey);
    res.json({ dates, count: dates.length, retention_days: SNAPSHOT_RETENTION_DAYS });
  }),
);

// POST /api/analytics/snapshots/capture (main.py:2828)
analyticsRouter.post(
  "/api/analytics/snapshots/capture",
  verifyDashboardToken,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    const today = new Date().toISOString().slice(0, 10);
    const captured = await captureDailySnapshot(authorization, workspaceSlug!, today);
    res.json({ status: "ok", date: today, sources_captured: captured });
  }),
);

// GET /api/analytics/device-risk-trend (main.py:2840)
analyticsRouter.get(
  "/api/analytics/device-risk-trend",
  verifyDashboardToken,
  asyncHandler(async (req, res) => {
    const slugKey = req.header("X-Workspace-Slug") || "global";
    const days = Math.max(1, Math.min(Number(req.query.days ?? 30) || 30, 365));
    const dates = (await listSnapshotDates(slugKey)).slice(-days);
    const points: any[] = [];
    for (const dateStr of dates) {
      const summary = await loadSnapshot(slugKey, dateStr, "device_risk_summary");
      if (summary) points.push({ date: dateStr, ...summary });
    }
    res.json({ items: points });
  }),
);

// POST /api/analytics/locations/sync (main.py:2601)
analyticsRouter.post(
  "/api/analytics/locations/sync",
  verifyDashboardToken,
  asyncHandler(async (req, res) => {
    const authorization = req.header("Authorization");
    const workspaceSlug = req.header("X-Workspace-Slug");
    requireCreds(authorization, workspaceSlug);
    res.json(await syncDeviceLocations(authorization, workspaceSlug!));
  }),
);
