import { Router } from "express";
import { prisma } from "../../services/prisma";

export const healthRouter = Router();

/**
 * Phase 0 sanity endpoint — not part of the original app's API surface.
 * Confirms the process is up and Prisma can reach Postgres.
 */
healthRouter.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected" });
  } catch (error: any) {
    res.status(503).json({ status: "error", database: "unreachable", message: error?.message });
  }
});
