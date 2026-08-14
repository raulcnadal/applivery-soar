import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { eventDrivenSettingsPayloadSchema, eventWatchPayloadSchema, slugifyWatchKey, validateWatchParams, type EventDrivenSettingsPayload, type EventWatchPayload } from "./eventWatches.schemas";

/**
 * Admin-defined event-driven detection watches — Settings > Device Data
 * Webhook's "Event-Driven Detection" panel. See
 * backend/docs/event-driven-agent-detection-roadmap.md for the full design
 * (Phases 0-4 implemented: config-driven registry + ETW watchers, plus this
 * round's rollout controls — workspace kill switch, remote IntervalSec
 * override, and notify metrics).
 *
 * The idea this closes the loop on: instead of the Windows SOAR Agent
 * discovering a change (an app installed, a registry key touched) only on
 * its next scheduled report cycle (`config.IntervalSec`, default 1h), an
 * admin can tell it here to watch specific OS-native signals directly —
 * `registryKey` (RegNotifyChangeKeyValue against an admin-specified key) or
 * `etwProvider` (a real-time ETW session scoped to one provider) — and the
 * agent notifies SOAR within seconds of the OS actually going quiet
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
  // The Phase 4 kill switch short-circuits here — a workspace with
  // eventDrivenDetectionEnabled=false gets an empty list regardless of how
  // many individual watches are marked enabled, so every agent stops all of
  // its watchers on the very next poll with zero agent-side special-casing.
  const settings = await getEventDrivenSettings(workspaceSlug);
  if (!settings.enabled) return [];
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

// ── Phase 4: rollout controls (workspace-wide kill switch + IntervalSec
// relaxation lever) — see backend/docs/event-driven-agent-detection-roadmap.md
// §4. Stored on WorkspaceState (schema.prisma) rather than a new table,
// since this is genuinely a per-workspace singleton, same shape as e.g.
// installedAppsRefreshBudgetPerHour there. Unlike WorkspaceState's other
// consumer (GET/POST /api/state, dashboardState.controller.ts), which is
// hardcoded to a shared "global" slug by the frontend, these two fields are
// read/written against the REAL workspace slug — each workspace's Windows
// Agent fleet is independent, same tenancy as EventWatchDefinition itself. ──

export interface EventDrivenSettings {
  enabled: boolean;
  remoteIntervalSec: number | null;
}

export async function getEventDrivenSettings(workspaceSlug: string): Promise<EventDrivenSettings> {
  const row = await prisma.workspaceState.findUnique({ where: { workspaceSlug } });
  return {
    enabled: row?.eventDrivenDetectionEnabled ?? true,
    remoteIntervalSec: row?.eventDrivenRemoteIntervalSec ?? null,
  };
}

export async function updateEventDrivenSettings(workspaceSlug: string, body: unknown, actorEmail: string): Promise<EventDrivenSettings> {
  const payload: EventDrivenSettingsPayload = eventDrivenSettingsPayloadSchema.parse(body);
  await prisma.workspaceState.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, eventDrivenDetectionEnabled: payload.enabled, eventDrivenRemoteIntervalSec: payload.remoteIntervalSec },
    update: { eventDrivenDetectionEnabled: payload.enabled, eventDrivenRemoteIntervalSec: payload.remoteIntervalSec },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "event_driven_settings_updated", actor: actorEmail,
    message: payload.enabled
      ? `Event-driven detection enabled${payload.remoteIntervalSec ? `, remote poll interval override set to ${payload.remoteIntervalSec}s` : ""} by ${actorEmail}`
      : `Event-driven detection disabled by ${actorEmail} — every agent stops all watchers on its next poll`,
  });
  return { enabled: payload.enabled, remoteIntervalSec: payload.remoteIntervalSec };
}

// ── Phase 4: metrics (webhook volume, debounce-collapse ratio,
// event-to-reaction latency) — see EventNotifyMetric's own doc comment
// (schema.prisma) for what each field captures and why. ──

export async function recordEventNotifyMetric(
  workspaceSlug: string,
  watchKey: string,
  action: string | null,
  status: string,
  rawEventCount: number | null,
  latencyMs: number | null,
): Promise<void> {
  try {
    await prisma.eventNotifyMetric.create({
      data: { workspaceSlug, watchKey, action, status, rawEventCount, latencyMs },
    });
  } catch (e) {
    // Best-effort — a metrics-write failure must never fail the actual
    // notify handling (handleEventNotify already did the real work by the
    // time this is called).
    console.warn(`[EventWatch] failed to record notify metric for workspace ${workspaceSlug}: ${e}`);
  }
}

export interface EventWatchMetricsSummary {
  windowHours: number;
  webhookVolume: number;
  avgRawEventsPerNotify: number | null; // the "debounce-collapse ratio"
  avgLatencyMs: number | null;
  medianLatencyMs: number | null;
}

const METRICS_WINDOW_HOURS = 24;

export async function getEventWatchMetrics(workspaceSlug: string): Promise<EventWatchMetricsSummary> {
  const since = new Date(Date.now() - METRICS_WINDOW_HOURS * 3_600_000);
  const rows = await prisma.eventNotifyMetric.findMany({
    where: { workspaceSlug, createdAt: { gte: since } },
    select: { rawEventCount: true, latencyMs: true },
  });

  const rawCounts = rows.map((r: any) => r.rawEventCount).filter((n: number | null): n is number => n !== null && n !== undefined);
  const avgRawEventsPerNotify = rawCounts.length > 0 ? rawCounts.reduce((a: number, b: number) => a + b, 0) / rawCounts.length : null;

  const latencies = rows
    .map((r: any) => r.latencyMs)
    .filter((n: number | null): n is number => n !== null && n !== undefined)
    .sort((a: number, b: number) => a - b);
  const avgLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length) : null;
  const medianLatencyMs = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : null;

  return {
    windowHours: METRICS_WINDOW_HOURS,
    webhookVolume: rows.length,
    avgRawEventsPerNotify,
    avgLatencyMs,
    medianLatencyMs,
  };
}

const METRIC_RETENTION_DAYS = 30;

/** Registered in jobs/backgroundJobs.ts (jobKey: "event_notify_metrics_rotation"), once a day. */
export async function rotateEventNotifyMetrics(): Promise<number> {
  const cutoff = new Date(Date.now() - METRIC_RETENTION_DAYS * 86_400_000);
  const result = await prisma.eventNotifyMetric.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
