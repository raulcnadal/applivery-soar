import { prisma } from "../../services/prisma";
import { HttpError } from "../../utils/httpError";

/**
 * Audit Logs query/export — port of main.py:2475-2591 (`_filter_audit_entries`,
 * `list_audit_logs`, `list_audit_log_actors`, `export_audit_logs`). The
 * original filters an in-memory list loaded from one JSON-per-workspace file;
 * here every filter maps onto a real Postgres WHERE clause against
 * AuditLogEntry, so this is a straight SQL translation rather than a literal
 * port of the filtering function bodies.
 */

export interface AuditLogFilters {
  q?: string;
  category?: string;
  severity?: string;
  dateFrom?: string;
  dateTo?: string;
  targetId?: string;
  actor?: string;
}

// Plain object rather than a generated Prisma.AuditLogEntryWhereInput type —
// the real generated client would type this fine, but this codebase avoids
// depending on generated-client types for query construction (see every
// other *.service.ts's "where" builders) since `prisma generate` can't run
// in every dev/CI environment consistently.
function buildWhere(workspaceSlug: string, f: AuditLogFilters): Record<string, any> {
  const where: Record<string, any> = { workspaceSlug };
  if (f.category) where.category = f.category;
  if (f.severity) where.severity = f.severity;
  if (f.actor) where.actor = { equals: f.actor, mode: "insensitive" };
  if (f.targetId) where.targetId = f.targetId;

  if (f.dateFrom || f.dateTo) {
    const createdAt: Record<string, Date> = {};
    if (f.dateFrom) {
      const d = new Date(f.dateFrom.slice(0, 10));
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (f.dateTo) {
      const d = new Date(f.dateTo.slice(0, 10));
      if (!Number.isNaN(d.getTime())) createdAt.lte = new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1);
    }
    if (Object.keys(createdAt).length) where.createdAt = createdAt;
  }

  if (f.q?.trim()) {
    const needle = f.q.trim();
    // Scoped to the same human-relevant fields as the original's `q` search
    // (message/actor/action/category/severity/targetType/targetName/targetId).
    where.OR = [
      { message: { contains: needle, mode: "insensitive" } },
      { actor: { contains: needle, mode: "insensitive" } },
      { action: { contains: needle, mode: "insensitive" } },
      { category: { contains: needle, mode: "insensitive" } },
      { severity: { contains: needle, mode: "insensitive" } },
      { targetType: { contains: needle, mode: "insensitive" } },
      { targetName: { contains: needle, mode: "insensitive" } },
      { targetId: { contains: needle, mode: "insensitive" } },
    ];
  }
  return where;
}

const AUDIT_EXPORT_ROW_CAP = 20000;

export async function listAuditLogs(workspaceSlug: string, filters: AuditLogFilters, limit: number, offset: number) {
  const where = buildWhere(workspaceSlug, filters);
  const boundedLimit = Math.max(1, Math.min(limit || 100, 500));
  const [items, total, retentionDays] = await Promise.all([
    prisma.auditLogEntry.findMany({ where, orderBy: { createdAt: "desc" }, skip: offset || 0, take: boundedLimit }),
    prisma.auditLogEntry.count({ where }),
    getAuditLogRetentionDays(),
  ]);
  return {
    items: items.map(toApiShape),
    total,
    retentionDays,
  };
}

export async function listAuditLogActors(workspaceSlug: string): Promise<string[]> {
  const rows = await prisma.auditLogEntry.findMany({
    where: { workspaceSlug },
    select: { actor: true },
    distinct: ["actor"],
  });
  return rows.map((r) => r.actor).sort((a, b) => a.localeCompare(b));
}

function toApiShape(e: {
  id: string; category: string; action: string; actor: string; targetType: string | null;
  targetId: string | null; targetName: string | null; message: string; severity: string; createdAt: Date;
}) {
  return {
    id: e.id,
    timestamp: e.createdAt.toISOString(),
    category: e.category,
    action: e.action,
    severity: e.severity,
    actor: e.actor,
    targetType: e.targetType,
    targetId: e.targetId,
    targetName: e.targetName,
    message: e.message,
  };
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Port of `export_audit_logs` — chronological (oldest first) CSV, capped same as the original. */
export async function exportAuditLogsCsv(workspaceSlug: string, filters: AuditLogFilters): Promise<string> {
  const where = buildWhere(workspaceSlug, filters);
  const total = await prisma.auditLogEntry.count({ where });
  if (total > AUDIT_EXPORT_ROW_CAP && !filters.dateFrom && !filters.dateTo) {
    throw new HttpError(400, `${total} entries match — narrow with a date range before exporting more than ${AUDIT_EXPORT_ROW_CAP} rows at once.`);
  }
  const rows = await prisma.auditLogEntry.findMany({ where, orderBy: { createdAt: "asc" }, take: AUDIT_EXPORT_ROW_CAP });
  const header = ["Timestamp", "Category", "Severity", "Action", "Actor", "Target Type", "Target Name", "Target ID", "Message"];
  const lines = [header.join(",")];
  for (const e of rows) {
    lines.push([
      e.createdAt.toISOString(), e.category, e.severity, e.action, e.actor,
      e.targetType ?? "", e.targetName ?? "", e.targetId ?? "", e.message,
    ].map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}

const AUDIT_LOG_DEFAULT_RETENTION_DAYS = 90;

/**
 * Reads retention straight out of the 'global' WorkspaceState row — same
 * single-bucket-regardless-of-workspace behavior as `_audit_log_retention_days`
 * (main.py:2410), pending Phase 7's full /api/state CRUD. Falls back to the
 * default until that row exists.
 */
export async function getAuditLogRetentionDays(): Promise<number> {
  try {
    const state = await prisma.workspaceState.findUnique({ where: { workspaceSlug: "global" } });
    if (state?.auditLogRetentionDays !== null && state?.auditLogRetentionDays !== undefined && state.auditLogRetentionDays >= 0) {
      return state.auditLogRetentionDays;
    }
  } catch {
    // fall through to default
  }
  return AUDIT_LOG_DEFAULT_RETENTION_DAYS;
}

/**
 * Daily rotation — port of `_rotate_audit_log` (main.py:2429), called by
 * audit_log_rotation_loop for every workspace that has at least one entry.
 * A no-op when retention is 0 (keep forever).
 */
export async function rotateAuditLogsForAllWorkspaces(): Promise<number> {
  const retentionDays = await getAuditLogRetentionDays();
  if (retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.auditLogEntry.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
