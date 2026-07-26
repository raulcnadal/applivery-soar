import { prisma } from "../../services/prisma";

/**
 * Daily analytics snapshot engine — port of main.py:556-654 (`_save_snapshot`
 * / `_load_snapshot` / `_list_snapshot_dates` / `_purge_old_snapshots` /
 * `_aggregate_snapshots_for_range`). The original stored one JSON file per
 * (workspace, date, source); here that's the `AnalyticsSnapshot` table with
 * a `@@unique([workspaceSlug, date, source])` constraint doing the same job.
 */

export const SNAPSHOT_RETENTION_DAYS = 60;

// Same 3 sources whose widget shape is a trend (not a scorecard/chartData
// snapshot) — aggregation across a date range concatenates their daily
// series instead of averaging (main.py:678).
const TREND_SOURCES = new Set(["stats_devices_trend", "stats_downloads_trend", "stats_builds_trend"]);

export async function saveSnapshot(workspaceSlug: string, dateStr: string, source: string, data: unknown): Promise<void> {
  try {
    await prisma.analyticsSnapshot.upsert({
      where: { workspaceSlug_date_source: { workspaceSlug, date: dateStr, source } },
      create: { workspaceSlug, date: dateStr, source, payload: data as any },
      update: { payload: data as any },
    });
  } catch (e) {
    console.warn(`[Snapshot] Failed to save ${source} for ${dateStr}: ${e}`);
  }
}

export async function loadSnapshot(workspaceSlug: string, dateStr: string, source: string): Promise<any | null> {
  try {
    const row = await prisma.analyticsSnapshot.findUnique({ where: { workspaceSlug_date_source: { workspaceSlug, date: dateStr, source } } });
    return row?.payload ?? null;
  } catch (e) {
    console.warn(`[Snapshot] Failed to load ${source} for ${dateStr}: ${e}`);
    return null;
  }
}

/** All dates (ascending) for which at least one snapshot exists for this workspace. */
export async function listSnapshotDates(workspaceSlug: string): Promise<string[]> {
  const rows = await prisma.analyticsSnapshot.findMany({
    where: { workspaceSlug },
    distinct: ["date"],
    select: { date: true },
    orderBy: { date: "asc" },
  });
  return rows.map((r: { date: string }) => r.date);
}

/** Deletes snapshots older than SNAPSHOT_RETENTION_DAYS, across every workspace. */
export async function purgeOldSnapshots(): Promise<void> {
  const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  try {
    const { count } = await prisma.analyticsSnapshot.deleteMany({ where: { date: { lt: cutoff } } });
    if (count) console.log(`[Snapshot] Purged ${count} snapshot(s) older than ${cutoff}`);
  } catch (e) {
    console.warn(`[Snapshot] Purge error: ${e}`);
  }
}

/**
 * Reconstructs a single widget response for a historical date range purely
 * from stored snapshots (Tier 2 of the widget engine's cache strategy — see
 * widgets.service.ts). Returns null if no snapshot exists anywhere in range.
 * Port of `_aggregate_snapshots_for_range` (main.py:655-717).
 */
export async function aggregateSnapshotsForRange(workspaceSlug: string, source: string, dateIni: string, dateEnd: string): Promise<any | null> {
  const dates = await listSnapshotDates(workspaceSlug);
  const inRange = dates.filter((d) => dateIni <= d && d <= dateEnd);
  if (!inRange.length) return null;

  const snapshots: Array<[string, any]> = [];
  for (const d of inRange) {
    const snap = await loadSnapshot(workspaceSlug, d, source);
    if (snap) snapshots.push([d, snap]);
  }
  if (!snapshots.length) return null;

  if (TREND_SOURCES.has(source)) {
    const allLabels: string[] = [];
    const allSeries: number[] = [];
    const osTotals = { apple: 0, android: 0, windows: 0 };
    for (const [, snap] of snapshots) {
      const td = snap.trendData ?? {};
      const labels: string[] = td.labels ?? [];
      const series: number[] = td.series ?? [];
      labels.forEach((lbl, i) => {
        if (!allLabels.includes(lbl)) {
          allLabels.push(lbl);
          allSeries.push(series[i] ?? 0);
        }
      });
      for (const k of Object.keys(osTotals) as Array<keyof typeof osTotals>) {
        osTotals[k] += td.os_totals?.[k] ?? 0;
      }
    }
    const result = { ...snapshots[snapshots.length - 1][1] };
    result.trendData = { labels: allLabels, series: allSeries, os_totals: osTotals };
    result.scorecardValue = allSeries.reduce((a, b) => a + b, 0);
    return result;
  }

  const aggChart: Record<string, number[]> = {};
  const scorecardVals: number[] = [];
  const lastSnap = snapshots[snapshots.length - 1][1];
  for (const [, snap] of snapshots) {
    scorecardVals.push(snap.scorecardValue ?? 0);
    for (const item of snap.chartData ?? []) {
      (aggChart[item.name ?? ""] ??= []).push(item.value ?? 0);
    }
  }
  const n = snapshots.length;
  const avgChart = Object.entries(aggChart)
    .map(([name, values]) => ({ name, value: Math.round(values.reduce((a, b) => a + b, 0) / n) }))
    .sort((a, b) => b.value - a.value);
  const avgScorecard = scorecardVals.length ? Math.round(scorecardVals.reduce((a, b) => a + b, 0) / scorecardVals.length) : 0;

  return { ...lastSnap, chartData: avgChart, scorecardValue: avgScorecard };
}
