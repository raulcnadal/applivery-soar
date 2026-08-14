import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { eventWatchPayloadSchema, slugifyWatchKey, validateWatchParams, type EventWatchPayload } from "./eventWatches.schemas";

/**
 * Admin-defined event-driven detection watches — Settings > Device Data
 * Webhook's "Event-Driven Detection" panel. See
 * backend/docs/event-driven-agent-detection-roadmap.md for the full design
 * this ships the first slice of (Phase 0 + Phase 2 there — config-driven
 * from day one, no hardcoded-watch throwaway step).
 *
 * The idea this closes the loop on: instead of the Windows SOAR Agent
 * discovering a change (an app installed, a registry key touched) only on
 * its next scheduled report cycle (`config.IntervalSec`, default 1h), an
 * admin can tell it here to watch specific OS-native signals directly —
 * currently just `registryKey` (RegNotifyChangeKeyValue against an
 * admin-specified key; `etwProvider` is a later phase, see the roadmap) —
 * and the agent notifies SOAR within seconds of the OS actually going quiet
 * after a burst of activity (the agent's own local debounce, `debounceMs`
 * below, matching the enhancement request's own 5-second-quiet spec).
 *
 * This is deliberately a SUPPLEMENT to the existing poll cycle, never a
 * replacement — see the roadmap doc §2. A watch firing calls
 * POST /api/device-data/event-notify (deviceData.controller.ts), which
 * looks the matching watch back up here by (workspaceSlug, platform, key)
 * and performs `action` for that one device — see
 * deviceData.service.ts's handleEventNotify.
 */

export interface EventWatchDefinitionDTO {
  id: string;
  workspaceSlug: string;
  platform: string;
  key: string;
  name: string;
  description: string | null;
  watchType: string;
  params: Record<string, unknown>;
  debounceMs: number;
  action: string;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

function toDTO(row: any): EventWatchDefinitionDTO {
  return {
    id: row.id,
    workspaceSlug: row.workspaceSlug,
    platform: row.platform,
    key: row.key,
    name: row.name,
    description: row.description ?? null,
    watchType: row.watchType,
    params: (row.params as Record<string, unknown>) ?? {},
    debounceMs: row.debounceMs,
    action: row.action,
    enabled: row.enabled,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listEventWatches(workspaceSlug: string, platform?: string): Promise<EventWatchDefinitionDTO[]> {
  const rows = await prisma.eventWatchDefinition.findMany({
    where: { workspaceSlug, ...(platform ? { platform } : {}) },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toDTO);
}

function parsePayload(body: unknown): EventWatchPayload {
  const payload = eventWatchPayloadSchema.parse(body);
  validateWatchParams(payload.watchType, payload.params);
  return payload;
}

export async function createEventWatch(workspaceSlug: string, body: unknown, actorEmail: string): Promise<EventWatchDefinitionDTO> {
  const payload = parsePayload(body);
  const key = payload.key || slugifyWatchKey(payload.name);
  if (!key) throw new HttpError(400, "Couldn't derive a key from that name — set one explicitly.");
  try {
    const row = await prisma.eventWatchDefinition.create({
      data: {
        workspaceSlug,
        platform: payload.platform,
        key,
        name: payload.name,
        description: payload.description ?? null,
        watchType: payload.watchType,
        params: payload.params as any,
        debounceMs: payload.debounceMs,
        action: payload.action,
        enabled: payload.enabled,
        createdBy: actorEmail,
        updatedBy: actorEmail,
      },
    });
    await recordAuditEvent(workspaceSlug, {
      category: "settings", action: "event_watch_created", actor: actorEmail,
      targetType: "event_watch", targetId: row.id, targetName: row.name,
      message: `Event-driven detection watch "${row.name}" (${row.platform}, ${row.watchType} → ${row.action}) created by ${actorEmail}`,
    });
    return toDTO(row);
  } catch (e: any) {
    if (e?.code === "P2002") throw new HttpError(409, `A ${payload.platform} watch with key "${key}" already exists.`);
    throw e;
  }
}

export async function updateEventWatch(workspaceSlug: string, id: string, body: unknown, actorEmail: string): Promise<EventWatchDefinitionDTO> {
  const existing = await prisma.eventWatchDefinition.findFirst({ where: { id, workspaceSlug } });
  if (!existing) throw new HttpError(404, "Event watch not found");
  const payload = parsePayload(body);
  const key = payload.key || existing.key;
  try {
    const row = await prisma.eventWatchDefinition.update({
      where: { id },
      data: {
        platform: payload.platform,
        key,
        name: payload.name,
        description: payload.description ?? null,
        watchType: payload.watchType,
        params: payload.params as any,
        debounceMs: payload.debounceMs,
        action: payload.action,
        enabled: payload.enabled,
        updatedBy: actorEmail,
      },
    });
    await recordAuditEvent(workspaceSlug, {
      category: "settings", action: "event_watch_updated", actor: actorEmail,
      targetType: "event_watch", targetId: row.id, targetName: row.name,
      message: `Event-driven detection watch "${row.name}" (${row.platform}, ${row.watchType} → ${row.action}) updated by ${actorEmail}`,
    });
    return toDTO(row);
  } catch (e: any) {
    if (e?.code === "P2002") throw new HttpError(409, `A ${payload.platform} watch with key "${key}" already exists.`);
    throw e;
  }
}

export async function deleteEventWatch(workspaceSlug: string, id: string, actorEmail: string): Promise<void> {
  const existing = await prisma.eventWatchDefinition.findFirst({ where: { id, workspaceSlug } });
  if (!existing) throw new HttpError(404, "Event watch not found");
  await prisma.eventWatchDefinition.delete({ where: { id } });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "event_watch_deleted", actor: actorEmail,
    targetType: "event_watch", targetId: existing.id, targetName: existing.name,
    message: `Event-driven detection watch "${existing.name}" (${existing.platform}) deleted by ${actorEmail}`,
  });
}

/**
 * GET /api/device-data/event-watches?platform=windows — the agent poll
 * endpoint (deviceData.controller.ts), authenticated the same way as every
 * other agent-facing endpoint (X-Workspace-Slug + X-Device-Report-Secret).
 * Minimal shape: no id/audit metadata the agent has no use for. `action` is
 * NOT included — that's resolved server-side when the watch actually fires
 * (POST /api/device-data/event-notify passes back just `key`), so the agent
 * never needs to know or care what SOAR does in response to a given watch.
 * Disabled watches are never sent — removing a watch from a device's fleet
 * is as simple as toggling it off, no agent-side state to reconcile beyond
 * the normal start/stop-watchers-to-match-config diff each poll already does.
 */
export async function listEnabledWatchesForAgent(
  workspaceSlug: string,
  platform: string,
): Promise<Array<{ key: string; watchType: string; params: Record<string, unknown>; debounceMs: number }>> {
  const rows = await prisma.eventWatchDefinition.findMany({ where: { workspaceSlug, platform, enabled: true } });
  return rows.map((r: any) => ({ key: r.key, watchType: r.watchType, params: (r.params as Record<string, unknown>) ?? {}, debounceMs: r.debounceMs }));
}

/**
 * Looked up by deviceData.service.ts's handleEventNotify when a watch
 * fires, to resolve `action` (and confirm the watch is still enabled — an
 * admin may have disabled/deleted it after the agent last polled but before
 * this particular debounce window closed).
 */
export async function getEnabledWatchByKey(workspaceSlug: string, platform: string, key: string): Promise<EventWatchDefinitionDTO | null> {
  const row = await prisma.eventWatchDefinition.findFirst({ where: { workspaceSlug, platform, key, enabled: true } });
  return row ? toDTO(row) : null;
}
