import { appliveryClient } from "../../services/appliveryClient";
import { fetchAllPages } from "../../services/appliveryPaginate";
import { liveCacheGet, liveCacheSet, LIVE_CACHE_TTL_SECONDS } from "../../services/liveCache";
import { prisma } from "../../services/prisma";
import { extractItems } from "../../utils/extractItems";
import { resolveOrgBase } from "../auth/rbac.service";
import { humanPlatform, normalizePlatform } from "../devices/deviceNormalize";
import { getDevicesFull } from "../devices/devices.service";
import { isOpenCaseStatus } from "../cases/cases.schemas";
import { caseSlaStatus, getCaseSlaSettings } from "../cases/cases.service";
import { COMPLIANCE_FRAMEWORKS, COMPLIANCE_POLICY_TEMPLATES, MITRE_TECHNIQUES } from "../compliance/complianceFields";
import { loadOsUpdateCatalog } from "../catalogs/osUpdateCatalog";
import { loadVulnCatalog } from "../catalogs/vulnCatalog";
import { loadOsLifecycleCatalog } from "../catalogs/osLifecycleCatalog";
import { loadInstalledAppsStore } from "../appLists/installedApps.service";
import { getSystemHealth } from "../systemHealth/systemHealth.service";
import { listWorkflowRuns } from "../workflows/workflows.service";
import { aggregateSnapshotsForRange, loadSnapshot, listSnapshotDates, saveSnapshot } from "./snapshotEngine";
import { appliveryWebhookEventLabel } from "../settings/appliveryWebhookSettings.schemas";
import { isPointInZone, type GeofenceZoneGeometry } from "../geofencing/geofence.service";

/**
 * Analytics widget engine — port of `get_widget_data` (main.py:14386-15510),
 * the single source every Overview widget, the Reporting Builder, and the
 * snapshot capture job all read through. See migration-plan.md §8 Phase 7.
 *
 * Deliberate improvement over the original: the four early-return sources
 * (system_health_summary/os_updates_catalog_summary/vuln_catalog_summary/
 * os_lifecycle_summary) were the only ones in main.py that skipped the
 * org/hex_id resolution call — every other purely-local source (compliance_*,
 * cases_*, triggers_*, workflow_runs_*, device_risk_*, mitre_coverage,
 * threat_intel_summary, ticketing_summary) still paid for it despite never
 * using `orgBase`, simply because they all lived inside the same
 * `async with httpx.AsyncClient()` block. Here `orgBase` is resolved lazily
 * (memoized per call) only by the branches that actually touch the Applivery
 * API, so every local-only widget never makes that extra request.
 *
 * applivery_events_by_type / applivery_events_trend /
 * applivery_automation_outcomes read `AppliveryWebhookConfig.recentEvents`,
 * populated by the inbound webhook receiver
 * (appliveryWebhookReceive.service.ts, Phase 8) — see main.py:14860-14912.
 */

export interface WidgetResponse {
  chartData: Array<{ name: string; value: number }>;
  trendData: { labels: string[]; series: number[]; os_totals: { apple: number; android: number; windows: number } };
  scorecardValue: number;
  items: any[];
  orgProfile: Record<string, any>;
}

function emptyResponse(): WidgetResponse {
  return {
    chartData: [],
    trendData: { labels: [], series: [], os_totals: { apple: 0, android: 0, windows: 0 } },
    scorecardValue: 0,
    items: [],
    orgProfile: {},
  };
}

/** Port of `_widget_trend_date_map` (main.py:14362). */
function widgetTrendDateMap(dateIni?: string | null, dateEnd?: string | null, defaultDays = 14, maxDays = 60): Record<string, number> {
  const dateMap: Record<string, number> = {};
  if (dateIni && dateEnd) {
    try {
      const dStart = new Date(`${dateIni}T00:00:00.000Z`);
      const dStop = new Date(`${dateEnd}T23:59:59.000Z`);
      const deltaDays = Math.min(Math.floor((dStop.getTime() - dStart.getTime()) / 86_400_000) + 1, maxDays);
      if (deltaDays > 0 && Number.isFinite(deltaDays)) {
        for (let i = 0; i < deltaDays; i++) {
          const d = new Date(dStart.getTime() + i * 86_400_000);
          dateMap[mmdd(d)] = 0;
        }
        return dateMap;
      }
    } catch {
      /* fall through to default */
    }
  }
  const today = new Date();
  for (let i = defaultDays - 1; i >= 0; i--) {
    dateMap[mmdd(new Date(today.getTime() - i * 86_400_000))] = 0;
  }
  return dateMap;
}

function mmdd(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function isoToMmdd(iso: string | Date): string | null {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return mmdd(d);
  } catch {
    return null;
  }
}

function sortedChart(agg: Record<string, number>): Array<{ name: string; value: number }> {
  return Object.entries(agg)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export interface GetWidgetDataParams {
  source: string;
  filters: Record<string, any>;
  dateIni?: string | null;
  dateEnd?: string | null;
  authorization: string;
  workspaceSlug: string;
}

export async function getWidgetData(params: GetWidgetDataParams): Promise<WidgetResponse> {
  const { source, filters, dateIni, dateEnd, authorization, workspaceSlug } = params;
  const slugKey = workspaceSlug || "global";
  const todayStr = new Date().toISOString().slice(0, 10);

  // Segments panel scoping for our own device-derived widgets (compliance_*,
  // geofence_*, the *_device_status_summary sources, device_risk_distribution).
  // The frontend's Segments panel already walks its fetched tree client-side
  // to expand a selected segment into itself + every descendant id
  // (segments.ts's collectSegmentIds) — sent here as filters.segmentIds so
  // this file doesn't need its own copy of that tree-walk. null means
  // "Global selected, no filter" — same "no filter" meaning as
  // filters.segmentId's own "0" sentinel used below for the Applivery-proxied
  // sources. Bug fix: these device-derived sources previously ignored the
  // Segments panel selection entirely (only the Applivery-proxied sources via
  // baseParams.segmentId ever looked at it), which is why switching segments
  // visibly changed nothing on Overview even though it worked everywhere else.
  const segmentIds: string[] | null = Array.isArray(filters.segmentIds) && filters.segmentIds.length ? filters.segmentIds.map(String) : null;
  function inSegment(segId: unknown): boolean {
    return !segmentIds || segmentIds.includes(String(segId ?? "0"));
  }
  let deviceSegmentByIdPromise: Promise<Map<string, unknown>> | null = null;
  function deviceSegmentById(): Promise<Map<string, unknown>> {
    if (!deviceSegmentByIdPromise) {
      deviceSegmentByIdPromise = getDevicesFull(authorization, workspaceSlug, false).then((r) => new Map(r.items.map((d: any) => [String(d.id), d.segmentId])));
    }
    return deviceSegmentByIdPromise;
  }
  // Companion date-range filter for the same widgets, applied only where a
  // condition genuinely has its own timestamp to check against (a violation's
  // detectedAt/lastDetectedAt) — a "live current state" gauge with no stored
  // per-day history (e.g. compliance_devices_violating, geofence_*, the
  // *_device_status_summary sources) has no historical value to filter to,
  // so it deliberately always reflects live "now" regardless of date range.
  function inDateRange(ts: string | Date | null | undefined): boolean {
    if (!dateIni || !dateEnd || !ts) return true;
    const d = typeof ts === "string" ? ts.slice(0, 10) : ts.toISOString().slice(0, 10);
    return dateIni <= d && d <= dateEnd;
  }

  // Tier 2: historical range → snapshots only, no live call. Skipped
  // entirely when a segment filter is active: the daily AnalyticsSnapshot
  // rows this reads (snapshotCapture.ts's ALL_SNAPSHOT_SOURCES) are captured
  // once per workspace with no per-segment breakdown at all, so serving them
  // here would silently ignore the Segments panel selection the same way the
  // device-derived sources above used to — better to fall through to a live,
  // correctly-segment-scoped computation than return a fast but wrong answer.
  if (dateIni && dateEnd && !segmentIds) {
    const isTodayOnly = dateIni === todayStr && dateEnd === todayStr;
    if (!isTodayOnly) {
      const snap = await aggregateSnapshotsForRange(slugKey, source, dateIni, dateEnd);
      if (snap !== null) return snap;
      // Tier 3 fallback: no snapshots yet, fall through to live fetch below.
    }
  }

  // Tier 1: today (or no date filter) → in-memory live cache first. Also
  // skipped when a segment filter is active — this cache is keyed only by
  // (workspaceSlug, source), so serving it here would return whatever the
  // last-requested segment (or Global) happened to compute.
  if (!(dateIni && dateEnd && dateIni < todayStr) && !segmentIds) {
    const cached = liveCacheGet<WidgetResponse>(slugKey, source);
    if (cached !== null) return cached;
  }

  const baseParams: Record<string, unknown> = {};
  if (filters.segmentId && String(filters.segmentId) !== "0") baseParams.segmentId = filters.segmentId;

  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  let memoOrgBase: string | null = null;
  async function orgBase(): Promise<string> {
    if (memoOrgBase === null) memoOrgBase = await resolveOrgBase(headers, workspaceSlug);
    return memoOrgBase;
  }

  const response = emptyResponse();

  // ── 0. Purely-local sources needing no Applivery call at all ──
  if (source === "system_health_summary") {
    const jobs = (await getSystemHealth()).items as any[];
    const agg = { Healthy: 0, Overdue: 0, Erroring: 0, "No data yet": 0 };
    for (const job of jobs) {
      if (job.overdue) agg.Overdue++;
      else if (job.lastStatus === "error") agg.Erroring++;
      else if (job.lastStatus === "ok") agg.Healthy++;
      else agg["No data yet"]++;
    }
    response.chartData = Object.entries(agg).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
    response.scorecardValue = agg.Overdue + agg.Erroring;
    response.items = jobs;
    return response;
  }

  if (source === "os_updates_catalog_summary") {
    const catalog = await loadOsUpdateCatalog();
    const entries = catalog.kbEntries ?? [];
    const agg: Record<string, number> = {};
    for (const e of entries) {
      const sev = titleCase(e.maxSeverity || "Unknown");
      agg[sev] = (agg[sev] ?? 0) + 1;
    }
    response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    response.scorecardValue = entries.length;
    response.items = entries.slice(0, 100);
    response.orgProfile = { monthsFetched: catalog.monthsFetched ?? [], lastFetchedAt: catalog.lastFetchedAt, lastError: catalog.lastError };
    return response;
  }

  if (source === "vuln_catalog_summary") {
    const catalog = await loadVulnCatalog();
    const entries = catalog.entries ?? [];
    const agg: Record<string, number> = {};
    for (const e of entries) agg[e.baseSeverity || "Unknown"] = (agg[e.baseSeverity || "Unknown"] ?? 0) + 1;
    response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    response.scorecardValue = entries.length;
    response.items = entries.slice(0, 100);
    response.orgProfile = { lastFetchedAt: catalog.lastFetchedAt, lastError: catalog.lastError, windowFrom: catalog.windowFrom };
    return response;
  }

  if (source === "os_lifecycle_summary") {
    const catalog = await loadOsLifecycleCatalog();
    const platforms = catalog.platforms ?? {};
    const agg: Record<string, number> = {};
    for (const releases of Object.values(platforms)) {
      for (const r of releases as any[]) {
        const bucket = r.isEol ? "EOL" : r.isMaintained ? "Maintained" : "Unknown";
        agg[bucket] = (agg[bucket] ?? 0) + 1;
      }
    }
    response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    response.items = [];
    return response;
  }

  if (source === "apple_app_updates_summary") {
    // appleAppUpdates is only ever populated on the serverFetch slot — the
    // SOAR Agent's self-report never sets it (Applivery-only signal).
    const iastore = await loadInstalledAppsStore(slugKey);
    // "apple" OR "macos" — appleAppUpdates is populated for both (Applivery's
    // Applications API covers iOS/iPadOS/macOS alike, see fetchAndStoreInstalledApps's
    // platformPath === "apple" gate), but the entry's own `platform` field is
    // now the device's real normalized platform (installedApps.service.ts),
    // which correctly distinguishes a Mac from an iPhone/iPad — matching the
    // same apple/macos pairing used everywhere else a device's Apple-family
    // platform is checked (e.g. devices.service.ts's appleAppUpdateStatus).
    const appleEntries = Object.entries(iastore)
      .map(([did, record]) => [did, record?.serverFetch] as [string, any])
      .filter(([, e]) => e && (e.platform === "apple" || e.platform === "macos") && e.appleAppUpdates);
    let devicesWithPending = 0;
    let totalPendingInstances = 0;
    const appFrequency: Record<string, number> = {};
    const pendingItems: any[] = [];
    for (const [did, e] of appleEntries as Array<[string, any]>) {
      const pendingApps: any[] = e.appleAppUpdates?.pendingApps ?? [];
      if (pendingApps.length) {
        devicesWithPending++;
        totalPendingInstances += pendingApps.length;
        for (const a of pendingApps) {
          const name = a.name || a.identifier || "Unknown app";
          appFrequency[name] = (appFrequency[name] ?? 0) + 1;
          pendingItems.push({ deviceId: did, ...a });
        }
      }
    }
    response.chartData = Object.entries(appFrequency).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 15);
    response.scorecardValue = devicesWithPending;
    response.items = pendingItems.slice(0, 200);
    response.orgProfile = { devicesSynced: appleEntries.length, devicesWithPendingUpdates: devicesWithPending, totalPendingAppInstances: totalPendingInstances };
    return response;
  }

  // ── 2.5 Compliance (SOAR) — computed from our own policy/violation store ──
  const complianceSources = ["compliance_policies_summary", "compliance_devices_violating", "compliance_violations_by_policy", "compliance_violations_trend", "compliance_review_queue", "autorun_safety_summary"];
  if (complianceSources.includes(source)) {
    const [policies, stateRow, violations] = await Promise.all([
      prisma.compliancePolicy.findMany({ where: { workspaceSlug: slugKey } }),
      prisma.complianceEvaluationState.findUnique({ where: { workspaceSlug: slugKey } }),
      prisma.complianceViolation.findMany({ where: { workspaceSlug: slugKey } }),
    ]);
    const state = (stateRow?.state as unknown as Record<string, { status: string; lastDetectedAt: string }>) ?? {};
    const policiesById = new Map(policies.map((p) => [p.id, p]));

    if (source === "compliance_policies_summary") {
      const enabledCount = policies.filter((p) => p.enabled).length;
      response.scorecardValue = policies.length;
      response.chartData = [{ name: "Enabled", value: enabledCount }, { name: "Disabled", value: policies.length - enabledCount }];
      response.items = policies;
      return response;
    }

    if (source === "compliance_devices_violating") {
      const devicesResp = await getDevicesFull(authorization, workspaceSlug, false);
      const violatingIds = new Set(Object.keys(state).filter((k) => k.includes(":")).map((k) => k.split(":")[1]));
      const scopedDevices = devicesResp.items.filter((d: any) => inSegment(d.segmentId));
      const violating = scopedDevices.filter((d) => violatingIds.has(d.id));
      response.scorecardValue = violating.length;
      response.chartData = [{ name: "Non-compliant", value: violating.length }, { name: "Compliant", value: scopedDevices.length - violating.length }];
      response.items = violating;
      return response;
    }

    if (source === "compliance_violations_by_policy") {
      const segMap = segmentIds ? await deviceSegmentById() : null;
      const agg: Record<string, number> = {};
      let matched = 0;
      for (const [key, entry] of Object.entries(state)) {
        const [policyId, deviceId] = key.split(":");
        if (segMap && !inSegment(segMap.get(deviceId))) continue;
        if (!inDateRange(entry.lastDetectedAt)) continue;
        const name = policiesById.get(policyId)?.name ?? "Deleted policy";
        agg[name] = (agg[name] ?? 0) + 1;
        matched++;
      }
      response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
      response.scorecardValue = matched;
      return response;
    }

    if (source === "compliance_violations_trend") {
      const segMap = segmentIds ? await deviceSegmentById() : null;
      const dateMap = widgetTrendDateMap(dateIni, dateEnd, 14, 60);
      for (const v of violations) {
        if (segMap && !inSegment(segMap.get(v.deviceId))) continue;
        const dStr = isoToMmdd(v.detectedAt);
        if (dStr && dStr in dateMap) dateMap[dStr]++;
      }
      response.trendData = { labels: Object.keys(dateMap), series: Object.values(dateMap), os_totals: { apple: 0, android: 0, windows: 0 } };
      response.scorecardValue = Object.values(dateMap).reduce((a, b) => a + b, 0);
      return response;
    }

    if (source === "compliance_review_queue") {
      const segMap = segmentIds ? await deviceSegmentById() : null;
      const statusLabels: Record<string, string> = { pending: "Pending review", auto_fired: "Auto-fired", no_workflow: "No workflow", approved: "Approved", dismissed: "Dismissed" };
      const agg: Record<string, number> = {};
      let matched = 0;
      for (const [key, entry] of Object.entries(state)) {
        const deviceId = key.includes(":") ? key.split(":")[1] : "";
        if (segMap && !inSegment(segMap.get(deviceId))) continue;
        if (!inDateRange(entry.lastDetectedAt)) continue;
        const label = statusLabels[entry.status] ?? entry.status ?? "Unknown";
        agg[label] = (agg[label] ?? 0) + 1;
        matched++;
      }
      response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
      response.scorecardValue = matched;
      return response;
    }

    if (source === "autorun_safety_summary") {
      const segMap = segmentIds ? await deviceSegmentById() : null;
      const statusLabels: Record<string, string> = { auto_fired: "Auto-fired", autorun_blocked: "Blocked (safety)", autorun_capped: "Capped (batch limit)" };
      const agg: Record<string, number> = { "Auto-fired": 0, "Blocked (safety)": 0, "Capped (batch limit)": 0 };
      for (const v of violations) {
        if (segMap && !inSegment(segMap.get(v.deviceId))) continue;
        if (!inDateRange(v.detectedAt)) continue;
        const label = statusLabels[v.status];
        if (label) agg[label]++;
      }
      response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value }));
      response.scorecardValue = agg["Blocked (safety)"] + agg["Capped (batch limit)"];
      return response;
    }
  }

  // ── 2.52 Geofencing (SOAR) — computed from our own zone/location store,
  // no live Applivery call needed (mirrors the Compliance/Cases blocks
  // above; the point-in-zone geometry math is pure in-process work, not a
  // scaling concern — see geofence.service.ts's doc comment). Only
  // DeviceLocation rows that ever got a real GPS fix count: a row still
  // holding the "no_location_reported" placeholder (lat:0,lng:0, written
  // the first time a newly-scoped device is checked and nothing has come
  // back yet — see locationsRefresh.service.ts) is excluded from the
  // inside/outside/freshness math and folded into its own "no location data
  // yet" bucket instead, same fix just applied to loadDeviceLocations for
  // the Compliance evaluator itself.
  const geofenceSources = ["geofence_zones_summary", "geofence_devices_status", "geofence_location_freshness"];
  if (geofenceSources.includes(source)) {
    const [zones, locationsAll] = await Promise.all([
      prisma.geofenceZone.findMany({ where: { workspaceSlug: slugKey } }),
      prisma.deviceLocation.findMany({ where: { workspaceSlug: slugKey } }),
    ]);
    // A DeviceLocation row is always "current" (one per device, no history —
    // see the model's own @@unique([workspaceSlug, deviceId])), so this is
    // segment-scoped only, never date-scoped.
    const segMap = segmentIds ? await deviceSegmentById() : null;
    const locations = segMap ? locationsAll.filter((l: (typeof locationsAll)[number]) => inSegment(segMap.get(l.deviceId))) : locationsAll;
    const realLocations = locations.filter((l) => l.error !== "no_location_reported");
    const neverLocated = locations.length - realLocations.length;
    const insideZone = (loc: { lat: number; lng: number }, zone: { shape: string; geometry: unknown }) =>
      isPointInZone(loc, { shape: zone.shape, geometry: zone.geometry as GeofenceZoneGeometry });

    if (source === "geofence_zones_summary") {
      const countByZone: Record<string, number> = {};
      for (const zone of zones) countByZone[zone.name] = 0;
      for (const loc of realLocations) {
        for (const zone of zones) {
          if (insideZone(loc, zone)) countByZone[zone.name] = (countByZone[zone.name] ?? 0) + 1;
        }
      }
      response.scorecardValue = zones.length;
      response.chartData = zones.map((z) => ({ name: z.name, value: countByZone[z.name] ?? 0 })).sort((a, b) => b.value - a.value);
      response.items = zones;
      return response;
    }

    if (source === "geofence_devices_status") {
      let insideAny = 0;
      let outsideAll = 0;
      for (const loc of realLocations) {
        if (zones.some((zone) => insideZone(loc, zone))) insideAny++;
        else outsideAll++;
      }
      response.scorecardValue = locations.length;
      response.chartData = [
        { name: "Inside a zone", value: insideAny },
        { name: "Outside all zones", value: outsideAll },
        { name: "No location data yet", value: neverLocated },
      ].filter((d) => d.value > 0);
      response.items = locations;
      return response;
    }

    if (source === "geofence_location_freshness") {
      const now = Date.now();
      const buckets: Record<string, number> = { "< 1 hour": 0, "1-6 hours": 0, "6-24 hours": 0, "> 24 hours": 0 };
      for (const loc of realLocations) {
        const ageHours = (now - loc.fetchedAt.getTime()) / 3_600_000;
        if (ageHours < 1) buckets["< 1 hour"]++;
        else if (ageHours < 6) buckets["1-6 hours"]++;
        else if (ageHours < 24) buckets["6-24 hours"]++;
        else buckets["> 24 hours"]++;
      }
      if (neverLocated > 0) buckets["No location data yet"] = neverLocated;
      response.scorecardValue = locations.length;
      response.chartData = Object.entries(buckets).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
      return response;
    }
  }

  // ── 2.55 Compliance Framework reports (ISO27001/ENS/NIS2) ──
  const frameworkKeys = new Set(COMPLIANCE_FRAMEWORKS.map((f) => f.key));
  if (source === "compliance_framework_coverage" || [...frameworkKeys].some((k) => source === `${k}_compliance_status`)) {
    if (source === "compliance_framework_coverage") {
      const chartData: Array<{ name: string; value: number }> = [];
      const items: any[] = [];
      const coveragePcts: number[] = [];
      for (const fw of COMPLIANCE_FRAMEWORKS) {
        const { rows } = await complianceFrameworkRows(slugKey, fw.key);
        const total = rows.length;
        const configuredCount = rows.filter((r) => r.configured).length;
        const enabledCount = rows.filter((r) => r.enabled).length;
        const pct = total ? Math.round((enabledCount / total) * 100) : 0;
        coveragePcts.push(pct);
        chartData.push({ name: fw.shortLabel, value: pct });
        items.push({ framework: fw.key, label: fw.label, shortLabel: fw.shortLabel, controlsTotal: total, controlsConfigured: configuredCount, controlsEnabled: enabledCount, coveragePercent: pct });
      }
      response.chartData = chartData;
      response.scorecardValue = coveragePcts.length ? Math.round(coveragePcts.reduce((a, b) => a + b, 0) / coveragePcts.length) : 0;
      response.items = items;
      return response;
    }
    const frameworkKey = source.replace(/_compliance_status$/, "");
    const { rows, violatingIds } = await complianceFrameworkRows(slugKey, frameworkKey);
    response.chartData = rows.map((r) => ({ name: r.title, value: r.violatingDeviceCount }));
    response.scorecardValue = violatingIds.size;
    response.items = rows;
    return response;
  }

  // ── 2.6 Cases (SOAR) ──
  const caseSources = ["cases_summary", "cases_by_severity", "cases_by_source", "cases_trend", "cases_sla_summary", "cases_mttr_trend"];
  if (caseSources.includes(source)) {
    const cases = await prisma.case.findMany({ where: { workspaceSlug: slugKey } });

    if (source === "cases_sla_summary") {
      const settings = await getCaseSlaSettings(slugKey);
      const agg = { "On track": 0, "Acknowledge overdue": 0, "Resolve overdue": 0 };
      const openCases = cases.filter((c) => isOpenCaseStatus(c.status));
      for (const c of openCases) {
        const status = caseSlaStatus(c as any, settings.thresholds);
        if (status.resolveBreached) agg["Resolve overdue"]++;
        else if (status.ackBreached) agg["Acknowledge overdue"]++;
        else agg["On track"]++;
      }
      response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value }));
      response.scorecardValue = agg["Resolve overdue"] + agg["Acknowledge overdue"];
      response.items = openCases;
      return response;
    }

    if (source === "cases_mttr_trend") {
      const dateMap = widgetTrendDateMap(dateIni, dateEnd);
      const hourSums: Record<string, number> = Object.fromEntries(Object.keys(dateMap).map((k) => [k, 0]));
      const counts: Record<string, number> = Object.fromEntries(Object.keys(dateMap).map((k) => [k, 0]));
      for (const c of cases) {
        if (!c.closedAt || !c.createdAt) continue;
        const dStr = isoToMmdd(c.closedAt);
        if (dStr && dStr in dateMap) {
          hourSums[dStr] += (c.closedAt.getTime() - c.createdAt.getTime()) / 3_600_000;
          counts[dStr]++;
        }
      }
      const averages = Object.keys(dateMap).map((k) => (counts[k] ? Math.round((hourSums[k] / counts[k]) * 10) / 10 : 0));
      response.trendData = { labels: Object.keys(dateMap), series: averages, os_totals: { apple: 0, android: 0, windows: 0 } };
      const resolvedTotal = Object.values(counts).reduce((a, b) => a + b, 0);
      response.scorecardValue = resolvedTotal ? Math.round((Object.values(hourSums).reduce((a, b) => a + b, 0) / resolvedTotal) * 10) / 10 : 0;
      return response;
    }

    if (source === "cases_summary") {
      const statusLabels: Record<string, string> = { open: "Open", investigating: "Investigating", resolved: "Resolved", closed: "Closed", false_positive: "False positive" };
      const agg: Record<string, number> = {};
      for (const c of cases) {
        const label = statusLabels[c.status] ?? c.status ?? "Unknown";
        agg[label] = (agg[label] ?? 0) + 1;
      }
      response.scorecardValue = cases.filter((c) => isOpenCaseStatus(c.status)).length;
      response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value }));
      response.items = cases;
      return response;
    }

    if (source === "cases_by_severity") {
      const sevOrder = ["low", "medium", "high", "critical"];
      const agg: Record<string, number> = Object.fromEntries(sevOrder.map((s) => [s, 0]));
      for (const c of cases) {
        if (!isOpenCaseStatus(c.status)) continue;
        if (c.severity in agg) agg[c.severity]++;
      }
      response.chartData = sevOrder.map((s) => ({ name: titleCase(s), value: agg[s] }));
      response.scorecardValue = Object.values(agg).reduce((a, b) => a + b, 0);
      return response;
    }

    if (source === "cases_by_source") {
      const sourceLabels: Record<string, string> = { manual: "Manual", compliance_violation: "Compliance violation", workflow_trigger: "Inbound trigger", applivery_webhook: "Applivery event" };
      const agg: Record<string, number> = {};
      for (const c of cases) {
        const label = sourceLabels[c.source] ?? c.source ?? "Unknown";
        agg[label] = (agg[label] ?? 0) + 1;
      }
      response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
      response.scorecardValue = cases.length;
      return response;
    }

    if (source === "cases_trend") {
      const dateMap = widgetTrendDateMap(dateIni, dateEnd);
      for (const c of cases) {
        const dStr = isoToMmdd(c.createdAt);
        if (dStr && dStr in dateMap) dateMap[dStr]++;
      }
      response.trendData = { labels: Object.keys(dateMap), series: Object.values(dateMap), os_totals: { apple: 0, android: 0, windows: 0 } };
      response.scorecardValue = Object.values(dateMap).reduce((a, b) => a + b, 0);
      return response;
    }
  }

  // ── 2.6b Applivery Event Webhook — port of main.py:14860-14912. recentEvents
  // is capped at 50 (see appliveryWebhookReceive.service.ts), so these three
  // widgets reflect "the last 50 events received", not a true rolling
  // window — same caveat as the original, and the same store the Settings >
  // Applivery Events page's own recent-events feed reads. ──
  if (["applivery_events_by_type", "applivery_events_trend", "applivery_automation_outcomes"].includes(source)) {
    const config = await prisma.appliveryWebhookConfig.findUnique({ where: { workspaceSlug: slugKey } });
    const events = ((config?.recentEvents as unknown as Array<Record<string, any>>) ?? []);

    if (source === "applivery_events_by_type") {
      const agg: Record<string, number> = {};
      for (const ev of events) {
        const label = appliveryWebhookEventLabel(ev.canonicalKey || ev.actionKey || "");
        agg[label] = (agg[label] ?? 0) + 1;
      }
      response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
      response.scorecardValue = events.length;
      response.items = events;
      return response;
    }

    if (source === "applivery_events_trend") {
      const dateMap = widgetTrendDateMap(dateIni, dateEnd);
      for (const ev of events) {
        const dStr = ev.receivedAt ? isoToMmdd(ev.receivedAt) : null;
        if (dStr && dStr in dateMap) dateMap[dStr]++;
      }
      response.trendData = { labels: Object.keys(dateMap), series: Object.values(dateMap), os_totals: { apple: 0, android: 0, windows: 0 } };
      response.scorecardValue = Object.values(dateMap).reduce((a, b) => a + b, 0);
      return response;
    }

    // applivery_automation_outcomes
    const outcomeLabels: Record<string, string> = {
      logged: "Logged only", webhook_disabled: "Webhook disabled", case_opened: "Case opened",
      workflow_fired: "Workflow fired", workflow_blocked_destructive: "Blocked (destructive)",
      workflow_missing: "Workflow missing", no_automation_credential: "No automation credential",
      workflow_unavailable: "Workflow unavailable",
    };
    const agg: Record<string, number> = {};
    for (const ev of events) {
      const outcome = ev.outcome || "logged";
      const label = outcomeLabels[outcome] ?? String(outcome).replace(/\+/g, " + ").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
      agg[label] = (agg[label] ?? 0) + 1;
    }
    response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    response.scorecardValue = events.length;
    return response;
  }

  // ── 2.65 Inbound Webhook Triggers ──
  if (source === "triggers_summary" || source === "triggers_fired_trend") {
    if (source === "triggers_summary") {
      const triggers = await prisma.trigger.findMany({ where: { workspaceSlug: slugKey } });
      response.chartData = triggers.map((t) => ({ name: t.name || "Unnamed trigger", value: t.fireCount })).sort((a, b) => b.value - a.value);
      response.scorecardValue = triggers.reduce((a, t) => a + t.fireCount, 0);
      response.items = triggers;
      return response;
    }
    const dateMap = widgetTrendDateMap(dateIni, dateEnd);
    const entries = await prisma.auditLogEntry.findMany({ where: { workspaceSlug: slugKey, category: "trigger", action: { in: ["trigger_fired", "trigger_fired_no_device"] } } });
    for (const entry of entries) {
      const dStr = isoToMmdd(entry.createdAt);
      if (dStr && dStr in dateMap) dateMap[dStr]++;
    }
    response.trendData = { labels: Object.keys(dateMap), series: Object.values(dateMap), os_totals: { apple: 0, android: 0, windows: 0 } };
    response.scorecardValue = Object.values(dateMap).reduce((a, b) => a + b, 0);
    return response;
  }

  // ── 2.66-2.69 Fleet-wide device status rollups (reuse getDevicesFull) ──
  if (source === "os_updates_device_status_summary") {
    const devicesResp = await getDevicesFull(authorization, workspaceSlug, false);
    const winDevices = devicesResp.items.filter((d: any) => d.platform === "windows" && d.osUpdateStatus && inSegment(d.segmentId));
    const agg = { "Up to date": 0, "Behind (confirmed)": 0, "Possibly behind (unconfirmed)": 0 };
    for (const d of winDevices as any[]) {
      const status = d.osUpdateStatus;
      if (status.confidence === "unknown") agg["Possibly behind (unconfirmed)"]++;
      else if (status.pendingCount > 0) agg["Behind (confirmed)"]++;
      else agg["Up to date"]++;
    }
    response.chartData = Object.entries(agg).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
    response.scorecardValue = agg["Behind (confirmed)"];
    response.items = winDevices.map((d: any) => ({ id: d.id, displayName: d.displayName, ...d.osUpdateStatus }));
    return response;
  }

  if (source === "vuln_device_status_summary") {
    const devicesResp = await getDevicesFull(authorization, workspaceSlug, false);
    const scoped = devicesResp.items.filter((d: any) => ["apple", "macos", "android"].includes(d.platform) && d.vulnStatus && inSegment(d.segmentId));
    const agg = { "Up to date": 0, "Behind (confirmed)": 0, "Possibly behind (unconfirmed)": 0 };
    for (const d of scoped as any[]) {
      const status = d.vulnStatus;
      if (status.confidence === "unknown") agg["Possibly behind (unconfirmed)"]++;
      else if (status.pendingCount > 0) agg["Behind (confirmed)"]++;
      else agg["Up to date"]++;
    }
    response.chartData = Object.entries(agg).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
    response.scorecardValue = agg["Behind (confirmed)"];
    response.items = scoped.map((d: any) => ({ id: d.id, displayName: d.displayName, platform: d.platform, ...d.vulnStatus }));
    return response;
  }

  if (source === "os_lifecycle_device_status_summary") {
    const devicesResp = await getDevicesFull(authorization, workspaceSlug, false);
    const lcDevices = devicesResp.items.filter((d: any) => d.osLifecycleStatus && inSegment(d.segmentId));
    const agg = { Supported: 0, "End of life": 0, Unknown: 0 };
    for (const d of lcDevices as any[]) {
      const status = d.osLifecycleStatus;
      if (status.confidence === "unknown" || status.isEol === null) agg.Unknown++;
      else if (status.isEol) agg["End of life"]++;
      else agg.Supported++;
    }
    response.chartData = Object.entries(agg).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
    response.scorecardValue = agg["End of life"];
    response.items = lcDevices.map((d: any) => ({ id: d.id, displayName: d.displayName, platform: d.platform, ...d.osLifecycleStatus }));
    return response;
  }

  if (source === "vuln_service_device_status_summary") {
    const devicesResp = await getDevicesFull(authorization, workspaceSlug, false);
    const checked = devicesResp.items.filter((d: any) => d.vulnServiceStatus?.checked && inSegment(d.segmentId));
    const agg = { "Known-exploited (KEV)": 0, "Critical/high": 0, "Medium/low only": 0, Clean: 0 };
    for (const d of checked as any[]) {
      const status = d.vulnServiceStatus;
      const counts = status.counts ?? {};
      if (status.hasKev) agg["Known-exploited (KEV)"]++;
      else if ((counts.CRITICAL ?? 0) + (counts.HIGH ?? 0) > 0) agg["Critical/high"]++;
      else if ((counts.MEDIUM ?? 0) + (counts.LOW ?? 0) > 0) agg["Medium/low only"]++;
      else agg.Clean++;
    }
    response.chartData = Object.entries(agg).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
    response.scorecardValue = agg["Known-exploited (KEV)"] + agg["Critical/high"];
    response.items = checked.map((d: any) => ({ id: d.id, displayName: d.displayName, platform: d.platform, ...d.vulnServiceStatus }));
    return response;
  }

  // ── 2.7 Workflow runs ──
  if (source === "workflow_runs_summary" || source === "workflow_runs_trend") {
    const { items: runs } = await listWorkflowRuns(slugKey, 100_000);

    if (source === "workflow_runs_summary") {
      const agg = { Running: 0, Waiting: 0, Completed: 0, Partial: 0, Failed: 0 };
      for (const r of runs) {
        if (r.status === "running") { agg.Running++; continue; }
        if (r.status === "waiting") { agg.Waiting++; continue; }
        const statuses = (r.results ?? []).map((res: any) => res.finalStatus);
        if (statuses.length && statuses.every((s: string) => s === "success")) agg.Completed++;
        else if (statuses.some((s: string) => s === "success" || s === "partial")) agg.Partial++;
        else agg.Failed++;
      }
      response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value }));
      response.scorecardValue = runs.length;
      return response;
    }
    const dateMap = widgetTrendDateMap(dateIni, dateEnd);
    for (const r of runs) {
      if (!r.startedAt) continue;
      const dStr = isoToMmdd(r.startedAt);
      if (dStr && dStr in dateMap) dateMap[dStr]++;
    }
    response.trendData = { labels: Object.keys(dateMap), series: Object.values(dateMap), os_totals: { apple: 0, android: 0, windows: 0 } };
    response.scorecardValue = Object.values(dateMap).reduce((a, b) => a + b, 0);
    return response;
  }

  // ── 2.8 Device risk ──
  if (source === "device_risk_distribution" || source === "device_risk_trend") {
    if (source === "device_risk_distribution") {
      const devicesResp = await getDevicesFull(authorization, workspaceSlug, false);
      const scopedDevices = devicesResp.items.filter((d: any) => inSegment(d.segmentId));
      const tierOrder = ["low", "medium", "high", "critical"];
      const agg: Record<string, number> = Object.fromEntries(tierOrder.map((t) => [t, 0]));
      for (const d of scopedDevices as any[]) {
        const tier = d.riskTier ?? "low";
        if (tier in agg) agg[tier]++;
      }
      response.chartData = tierOrder.map((t) => ({ name: titleCase(t), value: agg[t] }));
      response.scorecardValue = scopedDevices.length;
      return response;
    }
    // device_risk_trend reads from the device_risk_summary daily snapshot
    // (a single fleet-wide average, captured by snapshotCapture.ts — see its
    // own doc comment), which has no per-segment breakdown to filter to;
    // acknowledged gap, left as fleet-wide regardless of segment selection.
    const dates = (await listSnapshotDates(slugKey)).slice(-30);
    const labels: string[] = [];
    const series: number[] = [];
    for (const dateStr of dates) {
      const summary = await loadSnapshot(slugKey, dateStr, "device_risk_summary");
      if (summary) {
        labels.push(dateStr.length > 5 ? dateStr.slice(5) : dateStr);
        series.push(summary.avgRiskScore ?? 0);
      }
    }
    response.trendData = { labels, series, os_totals: { apple: 0, android: 0, windows: 0 } };
    response.scorecardValue = series.length ? series[series.length - 1] : 0;
    return response;
  }

  // ── 2.9 MITRE ATT&CK coverage ──
  if (source === "mitre_coverage") {
    const [policies, cases] = await Promise.all([
      prisma.compliancePolicy.findMany({ where: { workspaceSlug: slugKey } }),
      prisma.case.findMany({ where: { workspaceSlug: slugKey } }),
    ]);
    const knownIds = new Set(MITRE_TECHNIQUES.map((t) => t.id));
    const covered = new Set<string>();
    for (const p of policies) for (const t of p.mitreTechniques) if (knownIds.has(t)) covered.add(t);
    for (const c of cases) for (const t of c.mitreTechniques) if (knownIds.has(t)) covered.add(t);
    const total = MITRE_TECHNIQUES.length;
    response.scorecardValue = covered.size;
    response.chartData = [{ name: "Covered", value: covered.size }, { name: "Not covered", value: Math.max(total - covered.size, 0) }];
    return response;
  }

  // ── 2.10 Threat Intel ──
  if (source === "threat_intel_summary") {
    const cases = await prisma.case.findMany({ where: { workspaceSlug: slugKey } });
    const agg = { malicious: 0, suspicious: 0, clean: 0, unknown: 0, error: 0 };
    let totalChecks = 0;
    for (const c of cases) {
      for (const entry of (c.threatIntel as any[]) ?? []) {
        const verdict = entry.verdict ?? "unknown";
        agg[(verdict in agg ? verdict : "unknown") as keyof typeof agg]++;
        totalChecks++;
      }
    }
    response.chartData = Object.entries(agg).map(([name, value]) => ({ name: titleCase(name), value }));
    response.scorecardValue = totalChecks;
    return response;
  }

  // ── 2.11 Ticketing ──
  if (source === "ticketing_summary") {
    const cases = await prisma.case.findMany({ where: { workspaceSlug: slugKey } });
    let totalTickets = 0;
    let resolved = 0;
    for (const c of cases) {
      for (const ref of (c.externalRefs as any[]) ?? []) {
        if (ref.type === "jira" || ref.type === "servicenow") {
          totalTickets++;
          if (ref.remoteResolved) resolved++;
        }
      }
    }
    response.scorecardValue = totalTickets;
    response.chartData = [{ name: "Resolved", value: resolved }, { name: "Open / unknown", value: Math.max(totalTickets - resolved, 0) }];
    return response;
  }

  // ── Everything below here needs live Applivery data ──
  const base = await orgBase();

  if (source === "org_profile") {
    const res = await appliveryClient.get<any>(base, { headers });
    if (res.status === 200) {
      const orgData = res.data?.data ?? res.data ?? {};
      const mdmRes = await appliveryClient.get<any>(`${base}/mdm/`, { headers });
      if (mdmRes.status === 200) orgData.mdmInfo = mdmRes.data?.data ?? {};
      response.orgProfile = orgData;
    }
    return response;
  }

  if (source === "mdm_segments") {
    const res = await appliveryClient.get<any>(`${base}/segments/by-user`, { headers });
    if (res.status === 200) {
      const flatItems = flattenSegments(extractItems(res.data));
      const agg: Record<string, number> = {};
      for (const item of flatItems) {
        const name = String(item.name ?? "Unnamed");
        const count = Number(item.counts?.devices ?? item.deviceCount ?? 1);
        agg[name] = (agg[name] ?? 0) + count;
      }
      response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value }));
      response.scorecardValue = flatItems.length;
      response.items = flatItems;
    }
    return response;
  }

  if (source === "app_dist_apps") {
    const res = await appliveryClient.get<any>(`${base}/apps/`, { headers, params: { limit: 200, ...baseParams } });
    const items = res.status === 200 ? extractItems(res.data) : [];
    const agg: Record<string, number> = {};
    for (const app of items) for (const osKey of app.oss ?? []) agg[humanPlatform(normalizePlatform(String(osKey)))] = (agg[humanPlatform(normalizePlatform(String(osKey)))] ?? 0) + 1;
    response.items = items;
    response.scorecardValue = items.length;
    response.chartData = sortedChart(agg);
    return response;
  }

  // 4d. Device engine (live MDM devices, paginated, with GPS cache attach)
  const deviceSources = ["mdm_devices", "stats_devices_os", "stats_devices_status", "stats_compliance", "stats_battery", "stats_models"];
  if (deviceSources.includes(source)) {
    // subType: "device" excludes pending enrollment-token records (see
    // devices.service.ts's getDevicesFull doc comment) — otherwise a
    // widget's device count/list would silently include enrollment tokens
    // nobody has redeemed yet.
    const reqParams: Record<string, unknown> = { ...baseParams, subType: "device" };
    const reqParamsComp: Record<string, unknown> = { ...baseParams, isCompliance: "true", subType: "device" };
    if (filters.type && filters.type !== "all") {
      const osMap: Record<string, string> = { apple: "ios", macos: "macos", android: "android", windows: "windows" };
      reqParams.os = osMap[filters.type] ?? filters.type;
      reqParamsComp.os = reqParams.os;
    }
    const itemsAll = await fetchAllPages(headers, `${base}/mdm/devices/`, reqParams);
    const itemsComp = await fetchAllPages(headers, `${base}/mdm/devices/`, reqParamsComp);
    const compIds = new Set(itemsComp.map((i) => String(i.id ?? i._id ?? "")));

    let locCache: Record<string, { lat: number; lng: number }> = {};
    try {
      const row = await prisma.locationCache.findUnique({ where: { key: "locations_cache" } });
      locCache = (row?.payload as any) ?? {};
    } catch {
      locCache = {};
    }

    for (const i of itemsAll) {
      const devId = String(i.id ?? i._id ?? "");
      (i as any).is_compliant_normalized = compIds.has(devId);
      (i as any).platform_normalized = normalizePlatform(i.type ?? i.platform ?? "");
      (i as any).state_normalized = String(i.state ?? i.status ?? "unknown").toLowerCase();
      if (devId in locCache) (i as any).locationCache = locCache[devId];
    }

    let filtered = itemsAll;
    if (filters.complianceStatus === "compliant" || filters.complianceStatus === "non_compliant") {
      const wantComp = filters.complianceStatus === "compliant";
      filtered = filtered.filter((i: any) => i.is_compliant_normalized === wantComp);
    }
    if (filters.inactive24h) {
      const threshold = Date.now() - 24 * 3_600_000;
      filtered = filtered.filter((i: any) => !i.lastSeen || new Date(i.lastSeen).getTime() < threshold);
    }
    response.items = filtered;
    response.scorecardValue = filtered.length;
    const agg: Record<string, number> = {};
    if (source === "stats_compliance") {
      const compCount = filtered.filter((i: any) => i.is_compliant_normalized).length;
      if (compCount > 0) agg.Compliant = compCount;
      if (filtered.length - compCount > 0) agg["Not compliant"] = filtered.length - compCount;
    } else if (source === "stats_devices_os" || source === "mdm_devices") {
      for (const i of filtered as any[]) agg[humanPlatform(i.platform_normalized)] = (agg[humanPlatform(i.platform_normalized)] ?? 0) + 1;
    } else if (source === "stats_devices_status") {
      for (const i of filtered as any[]) agg[titleCase(i.state_normalized)] = (agg[titleCase(i.state_normalized)] ?? 0) + 1;
    } else if (source === "stats_models") {
      for (const d of filtered as any[]) {
        const label = d.summary?.model || "Unknown";
        agg[label] = (agg[label] ?? 0) + 1;
      }
    } else if (source === "stats_battery") {
      Object.assign(agg, { "More than 70%": 0, "Between 70% and 20%": 0, "Less than 20%": 0 });
      for (const i of filtered as any[]) {
        const bat = i.summary?.battery;
        if (bat !== undefined && bat !== null) {
          const bVal = Number(bat);
          if (Number.isFinite(bVal)) {
            if (bVal > 70) agg["More than 70%"]++;
            else if (bVal >= 20) agg["Between 70% and 20%"]++;
            else agg["Less than 20%"]++;
          }
        }
      }
    }
    response.chartData = sortedChart(agg);
    return response;
  }

  // 5. User/collaborator engine
  const collabSources = ["stats_collaborators", "mdm_collaborators", "app_dist_collaborators", "mdm_users", "app_dist_store_users"];
  if (collabSources.includes(source)) {
    const endpoint = source === "app_dist_store_users" ? "/employees/" : source === "mdm_users" ? "/mdm/users/" : "/collaborators/";
    const res = await appliveryClient.get<any>(`${base}${endpoint}`, { headers, params: { limit: 500, ...baseParams } });
    let items = res.status === 200 ? extractItems(res.data) : [];
    items = items.map((i) => ({ ...i, role_normalized: String(i.role ?? "user").toLowerCase(), sso_normalized: Boolean(i.user?.ssoUser ?? i.ssoUser) }));
    if (filters.role && filters.role !== "all") items = items.filter((i: any) => i.role_normalized === String(filters.role).toLowerCase());
    if (filters.authOrigin && filters.authOrigin !== "all") {
      const fAuth = String(filters.authOrigin).toLowerCase();
      items = items.filter((i: any) => (fAuth === "sso" && i.sso_normalized) || (fAuth === "dashboard" && !i.sso_normalized));
    }
    response.items = items;
    response.scorecardValue = items.length;
    const agg: Record<string, number> = {};
    for (const c of items as any[]) {
      const roleStr = titleCase(c.role || "User");
      agg[roleStr] = (agg[roleStr] ?? 0) + 1;
    }
    response.chartData = Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    return response;
  }

  // 3. Line charts
  if (source === "stats_devices_trend") {
    // subType: "device" — see the deviceSources block above for why.
    const itemsAll = await fetchAllPages(headers, `${base}/mdm/devices/`, { ...baseParams, subType: "device" });
    const dateMap: Record<string, { apple: number; android: number; windows: number; total: number }> = {};
    const today = new Date();
    if (dateIni && dateEnd) {
      try {
        const dStart = new Date(`${dateIni}T00:00:00.000Z`);
        const dStop = new Date(`${dateEnd}T23:59:59.000Z`);
        const deltaDays = Math.min(Math.floor((dStop.getTime() - dStart.getTime()) / 86_400_000) + 1, 60);
        for (let i = 0; i < deltaDays; i++) dateMap[mmdd(new Date(dStart.getTime() + i * 86_400_000))] = { apple: 0, android: 0, windows: 0, total: 0 };
      } catch {
        for (let i = 13; i >= 0; i--) dateMap[mmdd(new Date(today.getTime() - i * 86_400_000))] = { apple: 0, android: 0, windows: 0, total: 0 };
      }
    } else {
      for (let i = 13; i >= 0; i--) dateMap[mmdd(new Date(today.getTime() - i * 86_400_000))] = { apple: 0, android: 0, windows: 0, total: 0 };
    }
    for (const dev of itemsAll) {
      const enrolled = dev.enrolledDate ?? dev.createdAt;
      if (!enrolled) continue;
      const dStr = isoToMmdd(enrolled);
      if (dStr && dStr in dateMap) {
        const plat = normalizePlatform(dev.type ?? dev.platform ?? "");
        dateMap[dStr].total++;
        if (plat === "apple" || plat === "android" || plat === "windows") dateMap[dStr][plat]++;
      }
    }
    const values = Object.values(dateMap);
    response.trendData = {
      labels: Object.keys(dateMap),
      series: values.map((v) => v.total),
      os_totals: { apple: values.reduce((a, v) => a + v.apple, 0), android: values.reduce((a, v) => a + v.android, 0), windows: values.reduce((a, v) => a + v.windows, 0) },
    };
    response.scorecardValue = response.trendData.series.reduce((a, b) => a + b, 0);
    response.items = itemsAll;
    return response;
  }

  if (source === "stats_downloads_trend" || source === "stats_builds_trend") {
    let dIniStr: string, dEndStr: string;
    if (dateIni && dateEnd) {
      dIniStr = `${dateIni}T00:00:00.000Z`;
      dEndStr = `${dateEnd}T23:59:59.000Z`;
    } else {
      const dateEndD = new Date();
      const dateIniD = new Date(dateEndD.getTime() - 30 * 86_400_000);
      dEndStr = dateEndD.toISOString().replace(/\.\d+Z$/, ".000Z");
      dIniStr = dateIniD.toISOString().replace(/\.\d+Z$/, ".000Z");
    }
    const statTypeMap: Record<string, string> = { stats_downloads_trend: "downloads-by-os-by-day", stats_builds_trend: "builds-by-os-by-day" };
    const statType = statTypeMap[source];
    let url = `${base}/stats/by-day?statTypes[]=${statType}&dateIni=${dIniStr}&dateEnd=${dEndStr}`;
    if ("segmentId" in baseParams) url += `&segmentId=${baseParams.segmentId}`;
    const res = await appliveryClient.get<any>(url, { headers });
    if (res.status === 200) {
      const topData = res.data?.data ?? {};
      const rawData = topData?.data?.[statType] ?? {};
      const labels: string[] = [];
      const series: number[] = [];
      const osTotals = { apple: 0, android: 0, windows: 0 };
      if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
        for (const [dateVal, counts] of Object.entries(rawData).sort(([a], [b]) => a.localeCompare(b))) {
          let labelStr = String(dateVal);
          if (labelStr.includes("T") && labelStr.startsWith("20")) labelStr = labelStr.split("T")[0].slice(-5);
          labels.push(labelStr);
          let total = 0;
          if (counts && typeof counts === "object") {
            for (const [osName, osVal] of Object.entries(counts as Record<string, unknown>)) {
              if (typeof osVal === "number") {
                total += osVal;
                const n = normalizePlatform(osName);
                if (n === "apple" || n === "android" || n === "windows") osTotals[n] += osVal;
              }
            }
          } else if (typeof counts === "number") total = counts;
          series.push(total);
        }
      }
      response.trendData = { labels: labels.slice(-14), series: series.slice(-14), os_totals: osTotals };
      response.scorecardValue = series.reduce((a, b) => a + b, 0);
    }
    return response;
  }

  if (source === "stats_os_updates_all") {
    const osFilter = filters.type ?? "all";
    let url = `${base}/mdm/devices/available-updates?limit=500`;
    if (osFilter && osFilter !== "all") url += `&type=${osFilter}`;
    const res = await appliveryClient.get<any>(url, { headers });
    if (res.status === 200) {
      const items = extractItems(res.data);
      const agg: Record<string, number> = {};
      for (const item of items) {
        const ver = item.version ?? item.osVersion ?? item.targetVersion ?? "Unknown";
        const osName = String(item.os ?? item.type ?? "").toLowerCase();
        const count = Number(item.deviceCount ?? item.count ?? item.devices ?? 1);
        let key: string;
        if (osFilter === "all" && osName) {
          const prefix: Record<string, string> = { apple: "\u{1F34E}", ios: "\u{1F34E}", android: "\u{1F916}", windows: "\u{1FA9F}" };
          key = `${prefix[osName] ?? ""} ${ver}`.trim();
        } else {
          key = String(ver);
        }
        agg[key] = (agg[key] ?? 0) + count;
      }
      response.chartData = Object.entries(agg).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value: Math.trunc(value) })).sort((a, b) => b.value - a.value);
      response.scorecardValue = items.length;
      response.items = items;
    }
    return response;
  }

  if (source === "stats_os_versions") {
    const osFilter = filters.type ?? "all";
    let url = `${base}/mdm/devices/os-versions`;
    if (osFilter && osFilter !== "all") url += `?os=${osFilter}`;
    const res = await appliveryClient.get<any>(url, { headers });
    if (res.status === 200) {
      const items = extractItems(res.data);
      const agg: Record<string, number> = {};
      for (const item of items) {
        const ver = item.value ?? "Unknown";
        const osName = String(item.os ?? "").toLowerCase();
        const count = Number(item.count ?? 1);
        let key: string;
        if (osFilter === "all" && osName) {
          const prefix: Record<string, string> = { apple: "\u{1F34E}", ios: "\u{1F34E}", android: "\u{1F916}", windows: "\u{1FA9F}" };
          key = `${prefix[osName] ?? ""} ${ver}`.trim();
        } else {
          key = String(ver);
        }
        agg[key] = (agg[key] ?? 0) + count;
      }
      response.chartData = Object.entries(agg).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value: Math.trunc(value) })).sort((a, b) => b.value - a.value);
      response.scorecardValue = Object.values(agg).reduce((a, b) => a + b, 0);
      response.items = items;
    }
    return response;
  }

  if (source === "stats_sync_errors") {
    const res = await appliveryClient.get<any>(`${base}/mdm/devices/sync-errors?limit=500`, { headers });
    if (res.status === 200) {
      const items = extractItems(res.data);
      const agg: Record<string, number> = {};
      for (const item of items) {
        const targetType = titleCase(String(item.target ?? "Unknown").replace("Device", ""));
        agg[targetType] = (agg[targetType] ?? 0) + 1;
      }
      response.chartData = Object.entries(agg).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
      response.scorecardValue = items.length;
      response.items = items;
    }
    return response;
  }

  if (source === "stats_builds_os") {
    const resApps = await appliveryClient.get<any>(`${base}/apps/`, { headers, params: { limit: 200, ...baseParams } });
    const apps = resApps.status === 200 ? extractItems(resApps.data) : [];
    const agg: Record<string, number> = { Apple: 0, Android: 0, Windows: 0 };
    let totalBuilds = 0;
    const allBuilds: any[] = [];
    const CONCURRENCY = 5;
    const appIds = apps.map((a) => a.id ?? a._id).filter(Boolean);
    for (let i = 0; i < appIds.length; i += CONCURRENCY) {
      const batch = appIds.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (appId) => {
          const r = await appliveryClient.get<any>(`${base}/apps/${appId}/builds/?limit=500`, { headers });
          return r.status === 200 ? extractItems(r.data) : [];
        }),
      );
      for (const buildList of results) {
        allBuilds.push(...buildList);
        for (const b of buildList) {
          totalBuilds++;
          const label = humanPlatform(normalizePlatform(b.os ?? b.buildPlatform ?? ""));
          agg[label] = (agg[label] ?? 0) + 1;
        }
      }
    }
    response.chartData = Object.entries(agg).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    response.scorecardValue = totalBuilds;
    response.items = allBuilds;
    return response;
  }

  // Unknown source — return the empty shape (matches original's implicit
  // fall-through when a source doesn't match any branch).
  liveCacheSet(slugKey, source, response, LIVE_CACHE_TTL_SECONDS);
  await saveSnapshot(slugKey, todayStr, source, response);
  return response;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function flattenSegments(segments: any[], depth = 0): any[] {
  const flat: any[] = [];
  for (const s of segments) {
    if (s && typeof s === "object") {
      flat.push({ ...s, type_normalized: "segment", depth });
      if (Array.isArray(s.children) && s.children.length) flat.push(...flattenSegments(s.children, depth + 1));
    }
  }
  return flat;
}

/** Port of `_compliance_framework_rows` (main.py:10600-10635). */
async function complianceFrameworkRows(workspaceSlug: string, frameworkKey: string): Promise<{ rows: Array<{ templateId: string; controlRef: string; title: string; severity: string; configured: boolean; enabled: boolean; policyIds: string[]; violatingDeviceCount: number }>; violatingIds: Set<string> }> {
  const templates = COMPLIANCE_POLICY_TEMPLATES.filter((t) => t.framework === frameworkKey);
  const [policies, stateRow] = await Promise.all([
    prisma.compliancePolicy.findMany({ where: { workspaceSlug, framework: frameworkKey } }),
    prisma.complianceEvaluationState.findUnique({ where: { workspaceSlug } }),
  ]);
  const state = (stateRow?.state as unknown as Record<string, unknown>) ?? {};
  const rows = [];
  const allViolatingIds = new Set<string>();
  for (const t of templates) {
    const matching = policies.filter((p) => p.controlRef === t.controlRef);
    const enabledMatching = matching.filter((p) => p.enabled);
    const violatingIds = new Set<string>();
    for (const p of enabledMatching) {
      for (const key of Object.keys(state)) {
        if (key.startsWith(`${p.id}:`)) violatingIds.add(key.split(":")[1]);
      }
    }
    for (const id of violatingIds) allViolatingIds.add(id);
    rows.push({
      templateId: t.id, controlRef: t.controlRef, title: t.title, severity: t.severity,
      configured: matching.length > 0, enabled: enabledMatching.length > 0,
      policyIds: matching.map((p) => p.id), violatingDeviceCount: violatingIds.size,
    });
  }
  return { rows, violatingIds: allViolatingIds };
}
