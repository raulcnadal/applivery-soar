import { getDevicesFull } from "../devices/devices.service";
import { liveCacheInvalidateWorkspace } from "../../services/liveCache";
import { getWidgetData } from "./widgets.service";
import { saveSnapshot } from "./snapshotEngine";

/** Port of `ALL_SNAPSHOT_SOURCES` (main.py:15514-15521). */
export const ALL_SNAPSHOT_SOURCES = [
  "mdm_devices", "stats_devices_os", "stats_devices_status", "stats_compliance",
  "stats_battery", "stats_models", "stats_os_versions", "stats_sync_errors",
  "stats_devices_trend", "stats_downloads_trend", "stats_builds_trend",
  "mdm_users", "mdm_collaborators", "stats_collaborators",
  "app_dist_apps", "app_dist_store_users", "app_dist_collaborators",
  "mdm_segments",
];

const SNAPSHOT_SOURCE_DELAY_MS = 3000; // polite pacing between live API calls

/**
 * Sequentially (not concurrently, to respect rate limits) captures every
 * snapshot source, plus a locally-computed `device_risk_summary`. Port of
 * `_capture_daily_snapshot` (main.py:15549-15604).
 */
export async function captureDailySnapshot(authorization: string, workspaceSlug: string, dateStr: string): Promise<number> {
  let captured = 0;
  for (let i = 0; i < ALL_SNAPSHOT_SOURCES.length; i++) {
    const src = ALL_SNAPSHOT_SOURCES[i];
    if (i > 0) await new Promise((r) => setTimeout(r, SNAPSHOT_SOURCE_DELAY_MS));
    try {
      const data = await getWidgetData({ source: src, filters: {}, dateIni: null, dateEnd: null, authorization, workspaceSlug });
      if (data) {
        await saveSnapshot(workspaceSlug, dateStr, src, data);
        captured++;
        console.log(`[Snapshot] ${src} (${i + 1}/${ALL_SNAPSHOT_SOURCES.length}) captured for ${workspaceSlug}`);
      }
    } catch (e) {
      console.warn(`[Snapshot] ${src}: ${e}`);
    }
  }

  // device_risk_summary — computed locally from the live fleet, bypassing
  // the generic widget-source path entirely (main.py:15577-15600).
  try {
    const devicesRes = await getDevicesFull(authorization, workspaceSlug, true);
    const items = devicesRes.items ?? [];
    if (items.length) {
      const scores = items.map((d: any) => d.riskScore ?? 0);
      const tierCounts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const d of items as any[]) {
        const tier = d.riskTier ?? "low";
        tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
      }
      const summary = {
        deviceCount: items.length,
        avgRiskScore: Math.round((scores.reduce((a: number, b: number) => a + b, 0) / scores.length) * 10) / 10,
        maxRiskScore: Math.max(...scores),
        tierCounts,
      };
      await saveSnapshot(workspaceSlug, dateStr, "device_risk_summary", summary);
      captured++;
      console.log(`[Snapshot] device_risk_summary (${items.length} devices, avg ${summary.avgRiskScore}) for ${workspaceSlug}`);
    }
  } catch (e) {
    console.warn(`[Snapshot] device_risk_summary: ${e}`);
  }

  console.log(`[Snapshot] Done: ${captured}/${ALL_SNAPSHOT_SOURCES.length} sources captured for ${workspaceSlug} on ${dateStr}`);
  liveCacheInvalidateWorkspace(workspaceSlug); // fresh snapshots → invalidate stale cache
  return captured;
}
