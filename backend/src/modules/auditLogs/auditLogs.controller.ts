import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { exportAuditLogsCsv, listAuditLogActors, listAuditLogs, type AuditLogFilters } from "./auditLogs.service";

/**
 * Port of main.py:2530-2591 — GET /api/audit-logs, /api/audit-logs/actors,
 * /api/audit-logs/export.
 *
 * UPDATE: this originally carried no requirePermission gate beyond the
 * dashboard-token check, matching main.py (the `auditLog` RBAC area was
 * declared in SOAR_FEATURE_AREAS but never actually enforced anywhere —
 * migration-plan.md §9 / ARCHITECTURE.md §2.4). Per explicit direction
 * during the post-migration scale/completeness review, this gap is now
 * closed: all three routes require `auditLog:read`. This is a deliberate
 * deviation from 1:1 parity with the original, not an oversight.
 */

export const auditLogsRouter = Router();

const readAuditLog = [verifyDashboardToken, requirePermission({ area: "auditLog", level: "read" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}

function filtersOf(req: { query: Record<string, unknown> }): AuditLogFilters {
  const q = req.query;
  return {
    q: typeof q.q === "string" ? q.q : undefined,
    category: typeof q.category === "string" ? q.category : undefined,
    severity: typeof q.severity === "string" ? q.severity : undefined,
    dateFrom: typeof q.date_from === "string" ? q.date_from : undefined,
    dateTo: typeof q.date_to === "string" ? q.date_to : undefined,
    targetId: typeof q.target_id === "string" ? q.target_id : undefined,
    actor: typeof q.actor === "string" ? q.actor : undefined,
  };
}

auditLogsRouter.get("/api/audit-logs", ...readAuditLog, asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const offset = req.query.offset ? Number(req.query.offset) : 0;
  res.json(await listAuditLogs(workspaceOf(req), filtersOf(req), limit, offset));
}));

auditLogsRouter.get("/api/audit-logs/actors", ...readAuditLog, asyncHandler(async (req, res) => {
  res.json({ items: await listAuditLogActors(workspaceOf(req)) });
}));

auditLogsRouter.get("/api/audit-logs/export", ...readAuditLog, asyncHandler(async (req, res) => {
  const workspaceSlug = workspaceOf(req);
  const csv = await exportAuditLogsCsv(workspaceSlug, filtersOf(req));
  const filename = `audit-log-${workspaceSlug.replace(/[^a-zA-Z0-9_-]/g, "_")}-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.send(csv);
}));
