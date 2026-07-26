import { prisma } from "./prisma";

/**
 * Port of `_record_audit_event`/`_append_audit_events` (main.py:1964-2009) —
 * writes into the AuditLogEntry table, then fans the new event out to any
 * real-time (syslog/webhook) log export destinations configured for this
 * workspace — the single choke-point every audit event passes through, same
 * as the original. The dispatch import is dynamic to avoid a module cycle:
 * logExportDestinations.service.ts itself calls recordAuditEvent (to log its
 * own CRUD actions), so a static top-level import here would form a cycle.
 * A destination that's down or misconfigured must never break the caller
 * that triggered this write — failures are swallowed (logged, not thrown),
 * matching the original's try/except around `_dispatch_realtime_log_exports`.
 */
export interface AuditEventInput {
  category: string;
  action: string;
  actor?: string | null;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  message: string;
  severity?: string;
}

export async function recordAuditEvent(workspaceSlug: string, event: AuditEventInput): Promise<void> {
  const created = await prisma.auditLogEntry.create({
    data: {
      workspaceSlug,
      category: event.category,
      action: event.action,
      actor: event.actor ?? "unknown",
      targetType: event.targetType,
      targetId: event.targetId,
      targetName: event.targetName,
      message: event.message,
      severity: event.severity ?? "info",
    },
  });

  try {
    const { dispatchRealtimeLogExports } = await import("../modules/settings/logExportDestinations.service");
    await dispatchRealtimeLogExports(workspaceSlug, [{
      id: created.id,
      timestamp: created.createdAt.toISOString(),
      category: created.category,
      action: created.action,
      severity: created.severity,
      actor: created.actor,
      targetType: created.targetType,
      targetId: created.targetId,
      targetName: created.targetName,
      message: created.message,
    }]);
  } catch (e) {
    console.warn(`[Log Export] Real-time dispatch error: ${e}`);
  }
}
