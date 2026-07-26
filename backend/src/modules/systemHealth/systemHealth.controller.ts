import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { getSystemHealth } from "./systemHealth.service";

/** Port of main.py:17707-17727 — GET /api/system-health. */

export const systemHealthRouter = Router();

systemHealthRouter.get("/api/system-health", verifyDashboardToken, asyncHandler(async (_req, res) => {
  res.json(await getSystemHealth());
}));
