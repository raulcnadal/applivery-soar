import { prisma } from "./prisma";

/**
 * Minimal port of _record_audit_event (main.py) — writes into the
 * AuditLogEntry table. Full Audit Logs feature (query/filter/export,
 * retention rotation, real-time log-export dispatch) is Phase 6; this
 * exists now because Roles CRUD (Phase 1) already calls it in the
 * original app and dropping that silently would be a real feature loss.
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
  await prisma.auditLogEntry.create({
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
}
