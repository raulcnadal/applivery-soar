import axios from "axios";
import { prisma } from "../../services/prisma";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";
import { HttpError } from "../../utils/httpError";
import type { NormalizedDevice } from "../devices/deviceNormalize";
import type { InstalledAppsEntry } from "../appLists/installedApps.service";
import { extractLeadingVersion, filterCvesByPatchLevel, getEnabledVulnSourcePlugins, isConfirmedCve, mergeRawVulnResults, type VulnSourceCacheRow } from "./vulnSources";
import { computeAppIntegrityStatus, type AppIntegrityInfo } from "./binaryIntegrityService";

/**
 * Vulnerability Service (Applivery-hosted CVE matching, CloudFlare Worker)
 * — port of main.py:16782-17237. Deliberately opt-in and per-workspace
 * (unlike EUVD): hits an admin-provided, admin-hosted service instance
 * requiring a Bearer token, configured like any other Integration.
 */

const CACHE_TTL_MS = 24 * 3600 * 1000;
const APPS_CHUNK_SIZE = 25;
const MAX_APPS_PER_TICK = 500;
export const VULN_SERVICE_TICK_MS = 3_600_000; // hourly check; actual refresh only fires once refreshIntervalHours elapsed

/**
 * An installed-apps slot (selfReported or serverFetch — installedApps.service.ts's
 * InstalledAppsRecord) older than this is excluded from vulnerability-exposure
 * matching, even though it's still shown as-is everywhere else (the Apps view,
 * the Device modal's own plain inventory list). Found via a real report: a
 * macOS device confirmed up to date, with no Adobe product installed, showed
 * 5531 "known" CVEs dominated by decade-old Adobe Flash/Reader entries with
 * very high EPSS scores. Root cause traced to fetchAndStoreInstalledApps
 * (installedApps.service.ts): on a persistent Applivery API error for a
 * device's app-inventory endpoint, that function deliberately preserves the
 * LAST successful serverFetch entry rather than clobbering it with an empty
 * one (a documented, correct fix for a different bug — a temporarily
 * unreachable endpoint shouldn't erase real data). But neither
 * computeVulnServiceStatus nor computeDeviceAppsDetail ever checked how OLD
 * that preserved entry actually was before treating every app in it as
 * "currently installed and exposed" — so a slot stuck on a months-old
 * snapshot (Adobe Flash Player included, back when it still shipped) kept
 * contributing its entire historical CVE backlog indefinitely, with no
 * expiry, long after the real device moved on. 30 days is deliberately
 * generous relative to any real report/refresh cadence in this app (agents
 * default to an hourly report; Applivery's own app-inventory refresher runs
 * continuously) — this is a dead-slot safety net, not something normal
 * operation should ever bump into.
 */
const APPS_STALE_AFTER_MS = 30 * 24 * 3600 * 1000;

function isAppsEntryFresh(entry: InstalledAppsEntry, now = Date.now()): boolean {
  const fetchedAt = entry.fetchedAt ? new Date(entry.fetchedAt).getTime() : NaN;
  return Number.isFinite(fetchedAt) && now - fetchedAt < APPS_STALE_AFTER_MS;
}

// Re-exported for callers that already import PLATFORM_MAP from here
// (devices.service.ts et al.) — canonical definition now lives in
// platformMap.ts so mispService.ts doesn't have to import this file (see
// that file's doc comment for why).
import { PLATFORM_MAP } from "./platformMap";
export { PLATFORM_MAP };

export interface VulnServiceConfigPublic {
  workspaceSlug: string;
  enabled: boolean;
  baseUrl: string;
  apiToken: string; // masked
  refreshIntervalHours: number;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  lastRefreshStats: Record<string, any> | null;
}

function maskSecretTail(secret: string): string {
  if (!secret) return "";
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

function clampRefreshHours(hours: unknown): number {
  const h = Number(hours);
  if (!Number.isFinite(h)) return 6;
  return Math.max(1, Math.min(h, 72));
}

async function loadConfigRow(workspaceSlug: string) {
  return prisma.vulnServiceConfig.findUnique({ where: { workspaceSlug } });
}

function toPublic(row: NonNullable<Awaited<ReturnType<typeof loadConfigRow>>> | null, workspaceSlug: string): VulnServiceConfigPublic {
  if (!row) {
    return { workspaceSlug, enabled: false, baseUrl: "", apiToken: "", refreshIntervalHours: 6, lastRefreshAt: null, lastRefreshError: null, lastRefreshStats: null };
  }
  const token = row.apiTokenEncrypted ? decryptSecret(row.apiTokenEncrypted) : "";
  return {
    workspaceSlug,
    enabled: row.enabled,
    baseUrl: row.baseUrl,
    apiToken: maskSecretTail(token),
    refreshIntervalHours: row.refreshIntervalHours,
    lastRefreshAt: row.lastRefreshAt?.toISOString() ?? null,
    lastRefreshError: row.lastRefreshError ?? null,
    lastRefreshStats: (row.lastRefreshStats as Record<string, any>) ?? null,
  };
}

/** GET /api/vuln-service/config (main.py:17170). */
export async function getVulnServiceConfig(workspaceSlug: string): Promise<VulnServiceConfigPublic> {
  return toPublic(await loadConfigRow(workspaceSlug), workspaceSlug);
}

/** PUT /api/vuln-service/config (main.py:17174) — blank apiToken means "leave the stored one alone". */
export async function updateVulnServiceConfig(
  workspaceSlug: string,
  payload: { enabled: boolean; baseUrl: string; apiToken: string; refreshIntervalHours: number },
  actorEmail: string,
): Promise<VulnServiceConfigPublic> {
  const existing = await loadConfigRow(workspaceSlug);
  const tokenEncrypted = payload.apiToken.trim() ? encryptSecret(payload.apiToken.trim()) : existing?.apiTokenEncrypted ?? null;
  const row = await prisma.vulnServiceConfig.upsert({
    where: { workspaceSlug },
    create: {
      workspaceSlug, enabled: payload.enabled, baseUrl: (payload.baseUrl || "").trim().replace(/\/+$/, ""),
      apiTokenEncrypted: tokenEncrypted, refreshIntervalHours: clampRefreshHours(payload.refreshIntervalHours),
    },
    update: {
      enabled: payload.enabled, baseUrl: (payload.baseUrl || "").trim().replace(/\/+$/, ""),
      apiTokenEncrypted: tokenEncrypted, refreshIntervalHours: clampRefreshHours(payload.refreshIntervalHours),
    },
  });
  const { recordAuditEvent } = await import("../../services/auditLog");
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "vuln_service_config_updated",
    actor: actorEmail,
    message: `Vulnerability Service integration ${payload.enabled ? "enabled" : "disabled"} by ${actorEmail}`,
  });
  return toPublic(row, workspaceSlug);
}

/** POST /api/vuln-service/test (main.py:17197). */
export async function testVulnServiceConfig(workspaceSlug: string, payload: { baseUrl: string; apiToken: string }) {
  const base = (payload.baseUrl || "").trim().replace(/\/+$/, "");
  const existing = await loadConfigRow(workspaceSlug);
  const token = payload.apiToken.trim() || (existing?.apiTokenEncrypted ? decryptSecret(existing.apiTokenEncrypted) : "");
  if (!base || !token) throw new HttpError(400, "Base URL and API token are both required to test the connection.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const started = Date.now();
  let res;
  try {
    res = await axios.post(`${base}/v1/vulnerabilities/os`, { platform: "macos", os_version: "0.0.0-connectivity-test" }, { headers, timeout: 15000, validateStatus: () => true });
  } catch (e) {
    throw new HttpError(502, `Could not reach ${base}: ${e}`);
  }
  const latencyMs = Date.now() - started;
  if (res.status === 401) throw new HttpError(401, "Reached the service, but the API token was rejected.");
  if (res.status !== 200) throw new HttpError(502, `Service responded with ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 200)}`);
  return { status: "ok", latencyMs };
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

async function postWithRetry(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  let lastRes: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      lastRes = await axios.post(url, body, { headers, timeout: timeoutMs, validateStatus: () => true });
      if (!RETRY_STATUSES.has(lastRes.status)) return lastRes;
    } catch (e) {
      lastRes = null;
      if (attempt === 2) throw e;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, [1000, 2000][attempt]));
  }
  return lastRes;
}

/**
 * Gathers every distinct app/OS combo currently in the fleet, skips
 * anything fresh, queries the rest — port of
 * `_refresh_vuln_service_for_workspace` (main.py:16979). `bearer` is the
 * caller's own Applivery session (admin's live token for a manual refresh
 * in this phase — the automation-credential-driven unattended loop is
 * TODO(Phase6)).
 *
 * `force`: bypasses the 24h cache-freshness check entirely (both OS and
 * apps), so every combo currently in the fleet gets re-queried against the
 * Worker regardless of how recently it was last checked. Off for the
 * scheduled hourly tick (runVulnServiceRefresherTick below), which should
 * keep respecting each workspace's own refreshIntervalHours rather than
 * hammering the Worker every tick — on for a manual "Refresh now" click
 * (refreshVulnServiceNow), since a fully-cached fleet otherwise makes that
 * button silently do nothing for up to 24h, which is exactly what made this
 * genuinely hard to debug: appsQueried/appsRemaining both read 0 not
 * because nothing was ever queried, but because everything already had a
 * cache row, however that row's own `result.mapped` value turned out.
 */
export async function refreshVulnServiceForWorkspace(workspaceSlug: string, bearer: string, force = false): Promise<Record<string, any>> {
  const { getDevicesFull } = await import("../devices/devices.service");
  const { loadInstalledAppsStore, installedAppsRecordEntries } = await import("../appLists/installedApps.service");

  const cfgRow = await loadConfigRow(workspaceSlug);
  if (!cfgRow) throw new HttpError(400, "Vulnerability Service isn't configured for this workspace yet.");
  const token = cfgRow.apiTokenEncrypted ? decryptSecret(cfgRow.apiTokenEncrypted) : "";
  const base = (cfgRow.baseUrl || "").replace(/\/+$/, "");

  const devicesResp = await getDevicesFull(bearer, workspaceSlug, false);
  const devices: NormalizedDevice[] = devicesResp.items;
  const installedAppsStore = await loadInstalledAppsStore(workspaceSlug);

  const cacheRows = await prisma.vulnServiceCache.findMany({ where: { workspaceSlug } });
  const cacheByKey = new Map<string, (typeof cacheRows)[number]>(cacheRows.map((r) => [r.key, r]));

  const osCombos = new Map<string, [string, string]>();
  for (const d of devices) {
    const workerPlatform = PLATFORM_MAP[d.platform];
    if (workerPlatform && d.osVersion) osCombos.set(`${workerPlatform}|${d.osVersion}`, [workerPlatform, d.osVersion]);
  }

  const appCombos = new Map<string, { identifier: string; version: string; platform: string }>();
  for (const d of devices) {
    const workerPlatform = PLATFORM_MAP[d.platform];
    if (!workerPlatform) continue;
    // Both slots (self-reported and Applivery-UEM-fetched) — appCombos is a
    // Map keyed by (identifier|version|platform), so an app reported
    // identically by both sources naturally collapses to one query instead
    // of being queried twice.
    for (const entry of installedAppsRecordEntries(installedAppsStore[d.id])) {
      for (const a of entry.apps ?? []) {
        if (a.identifier && a.version) {
          appCombos.set(`${a.identifier.toLowerCase()}|${a.version}|${workerPlatform}`, { identifier: a.identifier, version: a.version, platform: workerPlatform });
        }
      }
    }
  }

  const isFresh = (fetchedAt: Date | undefined | null) => !force && Boolean(fetchedAt) && Date.now() - fetchedAt!.getTime() < CACHE_TTL_MS;

  // Total combos currently in the fleet, broken down by platform, computed
  // independent of caching/force — this alone answers "are non-macOS apps
  // even being enumerated at all" (they were, per the original bug report:
  // appsTotal was 1136 with only 4 macOS apps ever showing risk, which is
  // only explicable by SOME of those 1136 being non-macOS combos that
  // either never got queried or got queried and came back unmapped).
  const appsTotalByPlatform: Record<string, number> = {};
  for (const combo of appCombos.values()) appsTotalByPlatform[combo.platform] = (appsTotalByPlatform[combo.platform] ?? 0) + 1;

  // Evict cache entries for combos no longer present anywhere in the fleet.
  let evicted = 0;
  for (const row of cacheRows) {
    const isOs = osCombos.has(row.key);
    const isApp = appCombos.has(row.key);
    if (!isOs && !isApp) {
      await prisma.vulnServiceCache.delete({ where: { id: row.id } });
      evicted += 1;
    }
  }

  let osQueried = 0, osErrors = 0, appsQueried = 0, appsErrors = 0;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  for (const [key, [platform, osVersion]] of osCombos) {
    const cached = cacheByKey.get(key);
    if (isFresh(cached?.cachedAt)) continue;
    try {
      const res = await postWithRetry(`${base}/v1/vulnerabilities/os`, headers, { platform, os_version: osVersion }, 30000);
      if (res.status !== 200) throw new Error(`Vulnerability Service returned ${res.status} for an OS check`);
      await prisma.vulnServiceCache.upsert({
        where: { workspaceSlug_key: { workspaceSlug, key } },
        create: { workspaceSlug, key, result: res.data },
        update: { result: res.data, cachedAt: new Date() },
      });
      osQueried += 1;
    } catch (e) {
      osErrors += 1;
      console.warn(`[Vuln Service] OS query failed (${platform}/${osVersion}) for ${workspaceSlug}: ${e}`);
    }
  }

  const toQuery = Array.from(appCombos.entries()).filter(([key]) => !isFresh(cacheByKey.get(key)?.cachedAt));
  const batchToQuery = toQuery.slice(0, MAX_APPS_PER_TICK);
  // mapped/unmapped, by platform, for whatever actually got queried this
  // call — a combo can come back 200 OK and still be `mapped: false`
  // (Worker reached, request well-formed, it just has no CVE data for that
  // identifier/version/platform) which `appsErrors` alone can't distinguish
  // from "never queried at all". This is the piece that turns "appsQueried
  // is 0" from a dead end into an actual answer once a manual (forced)
  // refresh populates it.
  const appsMappedByPlatform: Record<string, number> = {};
  const appsUnmappedByPlatform: Record<string, number> = {};
  if (batchToQuery.length) {
    try {
      const results: any[] = [];
      for (let i = 0; i < batchToQuery.length; i += APPS_CHUNK_SIZE) {
        const chunk = batchToQuery.slice(i, i + APPS_CHUNK_SIZE).map(([, v]) => v);
        const res = await postWithRetry(`${base}/v1/vulnerabilities/apps`, headers, { apps: chunk }, 45000);
        if (res.status !== 200) throw new Error(`Vulnerability Service returned ${res.status} for an apps batch`);
        results.push(...(res.data?.results ?? []));
      }
      for (let i = 0; i < batchToQuery.length; i++) {
        const [key, combo] = batchToQuery[i];
        const result = results[i];
        await prisma.vulnServiceCache.upsert({
          where: { workspaceSlug_key: { workspaceSlug, key } },
          create: { workspaceSlug, key, result },
          update: { result, cachedAt: new Date() },
        });
        appsQueried += 1;
        const bucket = result?.mapped ? appsMappedByPlatform : appsUnmappedByPlatform;
        bucket[combo.platform] = (bucket[combo.platform] ?? 0) + 1;
      }
    } catch (e) {
      appsErrors += batchToQuery.length;
      console.warn(`[Vuln Service] Apps batch query failed for ${workspaceSlug}: ${e}`);
    }
  }

  const stats = {
    osQueried, osErrors, osTotal: osCombos.size,
    appsQueried, appsErrors, appsTotal: appCombos.size,
    appsTotalByPlatform,
    appsMappedByPlatform,
    appsUnmappedByPlatform,
    appsRemaining: Math.max(0, toQuery.length - batchToQuery.length),
    cacheEvicted: evicted,
    forced: force,
    refreshedAt: new Date().toISOString(),
  };
  await prisma.vulnServiceConfig.update({
    where: { workspaceSlug },
    data: {
      lastRefreshAt: new Date(),
      lastRefreshError: osErrors === 0 && appsErrors === 0 ? null : `${osErrors} OS + ${appsErrors} app quer${osErrors + appsErrors === 1 ? "y" : "ies"} failed`,
      lastRefreshStats: stats as any,
    },
  });
  return stats;
}

/**
 * POST /api/vuln-service/refresh (main.py:17224) — uses the calling admin's
 * own session. Always forces a full re-query (bypasses the 24h cache),
 * unlike the scheduled tick below: an admin pressing "Refresh now" wants an
 * actual fresh answer, not "everything's within its TTL, nothing to do" —
 * which is exactly what silently happened before this: a click here could
 * report appsQueried/appsRemaining both 0 with no indication that meant
 * "already cached" rather than "nothing wrong to find".
 */
export async function refreshVulnServiceNow(workspaceSlug: string, authorization: string) {
  const cfg = await loadConfigRow(workspaceSlug);
  if (!cfg?.enabled || !cfg.baseUrl || !cfg.apiTokenEncrypted) {
    throw new HttpError(400, "Vulnerability Service isn't configured/enabled for this workspace yet.");
  }
  return refreshVulnServiceForWorkspace(workspaceSlug, authorization, true);
}

/**
 * Unattended per-workspace refresh — port of `vuln_service_refresh_loop`
 * (main.py:17059), now that Automation Credentials exist (Phase 4b) to drive
 * it without an admin's live session. For every workspace with both an
 * automation credential AND the Vulnerability Service enabled+configured,
 * refreshes once its own `refreshIntervalHours` has elapsed since
 * `lastRefreshAt` — a per-workspace-configurable cadence, not one global
 * interval for every tenant. Wired into jobs/backgroundJobs.ts as
 * `vuln_service_refresh` (was TODO(Phase6) — see the comment on
 * `refreshVulnServiceForWorkspace` above).
 */
export async function runVulnServiceRefresherTick(): Promise<void> {
  const { listAutomationWorkspaces, getAutomationBearer } = await import("../settings/automationCredential.service");
  for (const workspaceSlug of await listAutomationWorkspaces()) {
    const cfg = await loadConfigRow(workspaceSlug);
    if (!cfg?.enabled || !cfg.baseUrl || !cfg.apiTokenEncrypted) continue;
    if (cfg.lastRefreshAt) {
      const elapsedMs = Date.now() - cfg.lastRefreshAt.getTime();
      if (elapsedMs < clampRefreshHours(cfg.refreshIntervalHours) * 3600 * 1000) continue;
    }
    const bearer = await getAutomationBearer(workspaceSlug);
    if (!bearer) continue;
    try {
      const stats = await refreshVulnServiceForWorkspace(workspaceSlug, bearer);
      console.log(`[Vuln Service] ${workspaceSlug}: ${JSON.stringify(stats)}`);
    } catch (e) {
      console.warn(`[Vuln Service Refresher] ${workspaceSlug} failed: ${e}`);
    }
  }
}

/**
 * Local-cache-only read (never calls the Worker inline) — port of
 * `_compute_vuln_service_status` (main.py:17099).
 */
export async function computeVulnServiceStatus(workspaceSlug: string, device: NormalizedDevice, appsEntries: InstalledAppsEntry[]): Promise<Record<string, any> | null> {
  const workerPlatform = PLATFORM_MAP[device.platform];
  if (!workerPlatform) return null;

  const plugins = await getEnabledVulnSourcePlugins(workspaceSlug);
  // Apple platforms: prefer a version extracted from OS Patch Level (Settings
  // > Workspace Automation's Smart Attribute mapping — e.g. "26.6.2 (25G82)"
  // -> "26.6.2") over device.osVersion when available, since it's a value
  // the customer has deliberately populated for exactly this purpose and may
  // be fresher/more precise than Applivery's own osVersion sync. This
  // benefits every OS-level source uniformly (MISP/VulnCheck's CPE version
  // match gets a more precise input; SOFA's exact-ProductVersion lookup
  // does too) without any of them needing to know about the mapping
  // themselves. Android and Windows keep using device.osVersion here
  // unchanged — Android's OS Patch Level is an SPL date, not a version
  // string (used instead for the CVE-list narrowing below, via
  // filterCvesByPatchLevel), and Windows's osVersion already carries the
  // full build the customer's Smart Attribute would otherwise duplicate.
  const effectiveOsVersion =
    (workerPlatform === "macos" || workerPlatform === "ios") && device.osPatchLevel
      ? extractLeadingVersion(device.osPatchLevel) ?? device.osVersion
      : device.osVersion;
  const osKey = effectiveOsVersion ? `${workerPlatform}|${effectiveOsVersion}` : null;
  const osRow = osKey ? await prisma.vulnServiceCache.findUnique({ where: { workspaceSlug_key: { workspaceSlug, key: osKey } } }) : null;
  const isFresh = (cachedAt: Date | undefined | null) => Boolean(cachedAt) && Date.now() - cachedAt!.getTime() < CACHE_TTL_MS;
  const osVulnMatch = osRow && isFresh(osRow.cachedAt) ? (osRow.result as Record<string, any>) : null;
  const osExtraRows = osKey ? await Promise.all(plugins.map((p) => p.getCacheRow(workspaceSlug, osKey))) : [];
  const osExtraMatches = osExtraRows.map((r, i) => (r && plugins[i].isCacheFresh(r.cachedAt) ? (r.result as Record<string, any>) : null));
  const osMergedRaw = osVulnMatch || osExtraMatches.some(Boolean) ? mergeRawVulnResults(...osExtraMatches, osVulnMatch) : null;
  // Narrow to only CVEs this exact device hasn't patched yet, when a real
  // OS Patch Level value is available (Settings > Workspace Automation) —
  // see filterCvesByPatchLevel's doc comment. No-op when device.osPatchLevel
  // is null, so this changes nothing for workspaces that haven't configured
  // the Smart Attribute mapping.
  const osMerged = osMergedRaw ? { ...osMergedRaw, cve_list: filterCvesByPatchLevel(osMergedRaw.cve_list, workerPlatform, device.osPatchLevel) } : null;
  // Split confirmed vs uncertain right here, at the source — every
  // downstream consumer of `osMatch` (this function's own aggregate
  // counting below, AND mergeOsVulnerabilities's OS-only merge for the
  // Device modal) then only ever sees genuinely confirmed CVEs in
  // `cve_list`, with the uncertain count exposed separately via
  // `uncertainCount` rather than silently folded in. See isConfirmedCve's
  // doc comment (vulnSources.ts) for why this exists.
  const osConfirmedList = osMerged ? osMerged.cve_list.filter(isConfirmedCve) : [];
  const osMatch: Record<string, any> | null = osMerged?.mapped
    ? { ...osMerged, cve_list: osConfirmedList, uncertainCount: osMerged.cve_list.length - osConfirmedList.length }
    : null;

  const appResults: Array<Record<string, any>> = [];
  const appTimestamps: string[] = [];
  // Both slots (self-reported and Applivery-UEM-fetched) — deduped by cache
  // key so an app reported identically by both sources doesn't get counted
  // (and its CVEs double-counted into totalCounts below) twice. Stale slots
  // (see APPS_STALE_AFTER_MS above) are excluded entirely here — a dead
  // snapshot shouldn't keep contributing its apps' CVEs to this device's
  // exposure count indefinitely.
  const seenAppKeys = new Set<string>();
  for (const entry of appsEntries.filter((e) => isAppsEntryFresh(e))) {
    for (const a of entry.apps ?? []) {
      const key = `${(a.identifier ?? "").toLowerCase()}|${a.version}|${workerPlatform}`;
      if (seenAppKeys.has(key)) continue;
      seenAppKeys.add(key);
      const row = await prisma.vulnServiceCache.findUnique({ where: { workspaceSlug_key: { workspaceSlug, key } } });
      const extraRows = await Promise.all(plugins.map((p) => p.getCacheRow(workspaceSlug, key)));
      const latest = [row?.cachedAt, ...extraRows.map((r) => r?.cachedAt)].filter(Boolean) as Date[];
      if (latest.length) appTimestamps.push(new Date(Math.max(...latest.map((d) => d.getTime()))).toISOString());
      const vulnMatch = row && isFresh(row.cachedAt) ? (row.result as any) : null;
      const extraMatches = extraRows.map((r, i) => (r && plugins[i].isCacheFresh(r.cachedAt) ? (r.result as any) : null));
      if (vulnMatch || extraMatches.some(Boolean)) {
        const merged = mergeRawVulnResults(...extraMatches, vulnMatch);
        if (merged.mapped) {
          const confirmedList = merged.cve_list.filter(isConfirmedCve);
          appResults.push({ ...merged, cve_list: confirmedList, uncertainCount: merged.cve_list.length - confirmedList.length });
        }
      }
    }
  }

  if (!osMatch && !appResults.length) {
    const candidateTimestamps = [...(osRow?.cachedAt ? [osRow.cachedAt.toISOString()] : []), ...appTimestamps];
    const lastCheckedAt = candidateTimestamps.length ? candidateTimestamps.sort().slice(-1)[0] : null;
    return { checked: false, lastCheckedAt, os: null, appsCheckedCount: 0, counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, uncertain: 0, hasKev: false, maxEpss: 0.0, topCves: [] };
  }

  const totalCounts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  let totalUncertain = 0;
  let hasKev = false;
  let maxEpss = 0.0;
  const allCves: Array<Record<string, any>> = [];
  for (const r of [...(osMatch ? [osMatch] : []), ...appResults]) {
    totalUncertain += r.uncertainCount ?? 0;
    for (const c of r.cve_list ?? []) {
      allCves.push(c);
      if (c.severity && c.severity in totalCounts) totalCounts[c.severity] += 1;
      if (c.is_kev) hasKev = true;
      maxEpss = Math.max(maxEpss, c.epss_score ?? 0);
    }
  }
  const sevRank: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  allCves.sort((a, b) => {
    const ak = [Number(Boolean(a.is_kev)), a.epss_score ?? 0, sevRank[a.severity] ?? 0, a.score ?? 0];
    const bk = [Number(Boolean(b.is_kev)), b.epss_score ?? 0, sevRank[b.severity] ?? 0, b.score ?? 0];
    for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return bk[i] - ak[i];
    return 0;
  });

  return {
    checked: true, lastCheckedAt: null, os: osMatch, appsCheckedCount: appResults.length,
    counts: totalCounts, uncertain: totalUncertain, hasKev, maxEpss: Math.round(maxEpss * 10000) / 10000, topCves: allCves.slice(0, 15),
  };
}

/**
 * Unifies the Vulnerability Catalog's (vulnCatalog.ts — EUVD-sourced,
 * Apple/Android-only, global daily refresh) OS-level pending-CVE comparison
 * with the Vulnerability Service's own OS-only slice (computeVulnServiceStatus's
 * `.os` field above — itself already merged across the Worker plus any
 * registered plugin: MISP/VulnCheck/SOFA/OSV-Android) into the ONE
 * "Vulnerabilities" section the Device modal's Compliance tab shows.
 *
 * Previously these were two separate sections ("Vulnerabilities" and
 * "Vulnerability Service") that could show flatly contradictory answers for
 * the exact same device — e.g. Overview says "up to date," the
 * "Vulnerabilities" section (this catalog) agreed with "no known pending
 * CVEs," yet "Vulnerability Service" showed 5000+ CVEs — because that second
 * section also mixed in APP-level CVEs for every installed app on the
 * device, dominated in the reported case by long-EOL Adobe products that
 * weren't even installed (stale installed-apps snapshot — see
 * APPS_STALE_AFTER_MS above for that half of the fix). App-level CVEs are
 * now surfaced ONLY via computeDeviceAppsDetail (Device modal Apps tab) and
 * computeReportedAppsVulnSummaries (fleet-wide Apps view's Risk column) —
 * this function and the section it powers never look at apps, only the OS.
 *
 * Dedup is by CVE id via mergeRawVulnResults (same "richer source wins a
 * collision" rule used everywhere else in this file). The Catalog's
 * `pendingCves` are only folded in when `confidence === "version"` — a
 * genuine fixed-version comparison — never "unknown" confidence, which would
 * just re-surface every catalog entry for the product as if it were
 * pending. `vulnServiceStatus.os` is already gated the same way internally
 * (only non-null when the Worker/a plugin actually mapped this exact OS
 * version), so no extra check is needed on that side.
 */
export function mergeOsVulnerabilities(catalogStatus: Record<string, any> | null, vulnServiceStatus: Record<string, any> | null): Record<string, any> {
  const catalogConfirmed = catalogStatus?.confidence === "version";
  const catalogRaw = catalogConfirmed
    ? {
        mapped: true,
        cve_list: (catalogStatus!.pendingCves ?? []).map((c: any) => ({
          id: c.cveId,
          severity: c.baseSeverity ? String(c.baseSeverity).toUpperCase() : null,
          epss_score: typeof c.epss === "number" ? c.epss : null,
          is_kev: Boolean(c.exploited),
          score: typeof c.baseScore === "number" ? c.baseScore : null,
          fixed_in: c.fixedVersion ?? c.fixedInMajor ?? null,
        })),
      }
    : null;
  const workerRaw = vulnServiceStatus?.os ?? null; // already OS-only, already confirmed-only, already mapped:true when present — see osMatch above

  const uncertain = (catalogStatus?.unconfirmedCount ?? 0) + (vulnServiceStatus?.os?.uncertainCount ?? 0);

  if (!catalogRaw && !workerRaw) {
    // Neither source has a confirmed OS-version comparison to offer.
    if (vulnServiceStatus && !vulnServiceStatus.checked) {
      return {
        visible: true,
        state: "not_checked",
        pendingCount: 0,
        cves: [],
        uncertain,
        notCheckedDetail: vulnServiceStatus.lastCheckedAt
          ? `Last checked ${new Date(vulnServiceStatus.lastCheckedAt).toLocaleString()} — nothing conclusive was found then, and it hasn't been refreshed since. If this device is still active, check Settings > Vulnerability Service for refresh errors.`
          : "Not checked yet — waiting on the next scheduled refresh (Settings > Vulnerability Service).",
      };
    }
    if (catalogStatus) {
      // Apple/Android platform, catalog exists, but no confirmed
      // fixed-version comparison yet (confidence "unknown"), and no
      // Vulnerability Service configured/checked either.
      return { visible: true, state: "unconfirmed", pendingCount: 0, cves: [], uncertain };
    }
    // Windows (no catalog coverage) with no Vulnerability Service configured
    // — neither source has anything to say about this device's OS.
    return { visible: false, state: "unconfirmed", pendingCount: 0, cves: [], uncertain: 0 };
  }

  const merged = mergeRawVulnResults(catalogRaw, workerRaw);
  const cves = merged.cve_list
    .slice()
    .sort((a: any, b: any) => {
      const ak = [Number(Boolean(a.is_kev)), a.epss_score ?? 0, SEVERITY_RANK[a.severity] ?? 0, a.score ?? 0];
      const bk = [Number(Boolean(b.is_kev)), b.epss_score ?? 0, SEVERITY_RANK[b.severity] ?? 0, b.score ?? 0];
      for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return bk[i] - ak[i];
      return 0;
    })
    .slice(0, 15);

  return cves.length > 0
    ? { visible: true, state: "cves", pendingCount: cves.length, cves, uncertain }
    : { visible: true, state: "clean", pendingCount: 0, cves: [], uncertain };
}

// ── Per-app / per-device CVE detail — added for the Apps view's "risk
// score" column, the App detail modal's per-version breakdown, and the
// Device modal's new Apps tab. computeVulnServiceStatus above only ever
// returns an OS+apps-merged view for one device's overall posture (its
// appResults loop discards per-app identity once folded into totalCounts/
// allCves) — none of that is reusable for "which CVEs affect THIS app at
// THIS version", so these are new, deliberately separate reads rather than
// a refactor of computeVulnServiceStatus (which stays exactly as the
// Compliance tab's existing Vulnerability Service section already expects).

export interface AppVersionVulnInfo {
  checked: boolean;
  mapped: boolean;
  counts: Record<string, number>;
  hasKev: boolean;
  maxEpss: number;
  cveList: Array<Record<string, any>>;
  cachedAt: string | null;
  // Matches confirmed by product/version but with no upper-bound affected
  // range in NVD's data, per the Worker's `confirmed` field — see
  // isConfirmedCve's doc comment (vulnSources.ts). NOT included in
  // counts/hasKev/maxEpss/cveList above; surfaced here only as a count so
  // the Apps tab/Apps view can show "N additional matches unconfirmed"
  // instead of silently dropping them or (the previous bug) silently
  // treating them as ordinary confirmed CVEs.
  uncertainCount: number;
}

export interface AppVulnSummary {
  riskScore: number;
  maxSeverity: string | null;
  hasKev: boolean;
  totalCveCount: number;
  byVersion: Record<string, AppVersionVulnInfo>;
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const SEVERITY_WEIGHT: Record<string, number> = { CRITICAL: 40, HIGH: 20, MEDIUM: 8, LOW: 2 };
const KEV_BONUS = 25;

function isFreshCache(cachedAt: Date | undefined | null): boolean {
  return Boolean(cachedAt) && Date.now() - cachedAt!.getTime() < CACHE_TTL_MS;
}

/**
 * Turns a VulnServiceCache row plus zero or more same-key rows from OTHER
 * registered vuln sources (MISP, VulnCheck, ... — see vulnSources.ts) into
 * the per-version shape both functions below share. The Worker's own row is
 * passed last into mergeRawVulnResults so it wins CVE-id collisions (it
 * carries real CVSS/EPSS/KEV data a raw CPE match from another source can't
 * supply); a source-only CVE is kept as-is with that source's own severity.
 */
function toVersionVulnInfo(row: { result: unknown; cachedAt: Date } | null, extraRows: Array<VulnSourceCacheRow | null> = []): AppVersionVulnInfo {
  const merged = mergeRawVulnResults(...extraRows.map((r) => r?.result as any), row?.result as any);
  // Confirmed-only — see isConfirmedCve's doc comment. An "uncertain" match
  // (product matched, no NVD-confirmed upper-bound/fix version) must never
  // count toward this app's severity counts/KEV flag/risk score, same
  // reasoning as computeVulnServiceStatus's osMatch/appResults above.
  const cveList = merged.cve_list.filter(isConfirmedCve);
  const uncertainCount = merged.cve_list.length - cveList.length;
  const counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  let hasKev = false;
  let maxEpss = 0;
  for (const c of cveList) {
    if (c.severity && counts[c.severity] !== undefined) counts[c.severity] += 1;
    if (c.is_kev) hasKev = true;
    maxEpss = Math.max(maxEpss, c.epss_score ?? 0);
  }
  const cachedTimestamps = [row?.cachedAt, ...extraRows.map((r) => r?.cachedAt)].filter(Boolean) as Date[];
  const cachedAt = cachedTimestamps.length ? new Date(Math.max(...cachedTimestamps.map((d) => d.getTime()))) : new Date();
  return {
    checked: true, mapped: merged.mapped, counts, hasKev, maxEpss: Math.round(maxEpss * 10000) / 10000, uncertainCount,
    cveList: cveList
      .slice()
      .sort((a, b) => (Number(Boolean(b.is_kev)) - Number(Boolean(a.is_kev))) || ((SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)))
      .slice(0, 15),
    cachedAt: cachedAt.toISOString(),
  };
}

function rollUpAppSummary(byVersion: Record<string, AppVersionVulnInfo>): AppVulnSummary {
  let score = 0;
  let maxRank = 0;
  let maxSeverity: string | null = null;
  let hasKev = false;
  let totalCveCount = 0;
  for (const v of Object.values(byVersion)) {
    totalCveCount += v.cveList.length;
    if (v.hasKev) hasKev = true;
    for (const sev of Object.keys(SEVERITY_WEIGHT)) {
      const n = v.counts[sev] ?? 0;
      score += n * SEVERITY_WEIGHT[sev];
      if (n > 0 && SEVERITY_RANK[sev] > maxRank) {
        maxRank = SEVERITY_RANK[sev];
        maxSeverity = sev;
      }
    }
  }
  if (hasKev) score += KEV_BONUS;
  return { riskScore: Math.min(100, Math.round(score)), maxSeverity, hasKev, totalCveCount, byVersion };
}

/**
 * Bulk read for the Apps view — one `findMany` covering every distinct
 * (app, version) combo currently reported across the fleet, rather than a
 * per-app/per-version round trip. Returns a Map keyed the same way
 * getReportedAppsOverview's own `byIdentifier` map is (`${platform}:${identifier}`)
 * so the controller can merge results straight onto each ReportedAppSummary.
 * Cache-only (never calls the Worker inline) — same contract as
 * computeVulnServiceStatus. Returns an empty Map (not per-app nulls) when the
 * Vulnerability Service isn't enabled for this workspace, so callers can
 * treat "no data" and "not enabled" identically without an extra config
 * fetch of their own.
 */
export async function computeReportedAppsVulnSummaries(
  workspaceSlug: string,
  apps: Array<{ identifier: string; platform: string; versions: string[] }>,
): Promise<Map<string, AppVulnSummary>> {
  const cfg = await loadConfigRow(workspaceSlug);
  const plugins = await getEnabledVulnSourcePlugins(workspaceSlug);
  if (!cfg?.enabled && plugins.length === 0) return new Map();

  const keyToAppVersion = new Map<string, { appKey: string; version: string }>();
  for (const app of apps) {
    const workerPlatform = PLATFORM_MAP[app.platform];
    if (!workerPlatform) continue;
    const appKey = `${app.platform}:${app.identifier}`;
    for (const version of app.versions) {
      keyToAppVersion.set(`${app.identifier.toLowerCase()}|${version}|${workerPlatform}`, { appKey, version });
    }
  }
  if (keyToAppVersion.size === 0) return new Map();

  type VulnCacheRow = Awaited<ReturnType<typeof prisma.vulnServiceCache.findMany>>[number];

  const keys = Array.from(keyToAppVersion.keys());
  const rows: VulnCacheRow[] = cfg?.enabled ? await prisma.vulnServiceCache.findMany({ where: { workspaceSlug, key: { in: keys } } }) : [];
  const rowByKey = new Map<string, VulnCacheRow>(rows.map((r) => [r.key, r]));

  // One getCacheRows call per registered, enabled plugin (MISP, VulnCheck,
  // ...), each producing its own key -> row map.
  const pluginRows = await Promise.all(plugins.map((p) => p.getCacheRows(workspaceSlug, keys)));
  const pluginRowByKeyMaps = pluginRows.map((rowsForPlugin) => new Map(rowsForPlugin.map((r) => [r.key, r])));

  // Union of every key ANY source has a row for — a plugin-only mapping
  // with no Vulnerability Service row at all still needs a pass below.
  const allKnownKeys = new Set<string>(rows.map((r) => r.key));
  for (const m of pluginRowByKeyMaps) for (const k of m.keys()) allKnownKeys.add(k);

  const byVersionByApp = new Map<string, Record<string, AppVersionVulnInfo>>();
  for (const key of allKnownKeys) {
    const mapping = keyToAppVersion.get(key);
    if (!mapping) continue;
    const row = rowByKey.get(key) ?? null;
    const rowFresh = row && isFreshCache(row.cachedAt) ? row : null;
    const freshExtraRows = pluginRowByKeyMaps.map((m, i) => {
      const r = m.get(key);
      return r && plugins[i].isCacheFresh(r.cachedAt) ? r : null;
    });
    if (!rowFresh && !freshExtraRows.some(Boolean)) continue;
    let byVersion = byVersionByApp.get(mapping.appKey);
    if (!byVersion) {
      byVersion = {};
      byVersionByApp.set(mapping.appKey, byVersion);
    }
    byVersion[mapping.version] = toVersionVulnInfo(rowFresh, freshExtraRows);
  }

  const summaries = new Map<string, AppVulnSummary>();
  for (const [appKey, byVersion] of byVersionByApp) {
    summaries.set(appKey, rollUpAppSummary(byVersion));
  }
  return summaries;
}

/**
 * Per-device read for the Device modal's Apps tab — pairs each app this
 * device actually reports (across BOTH the self-reported and Applivery-UEM-
 * fetched slots) with its own cached CVE result, so the tab can show "this
 * specific device has Chrome 118 with these 3 CVEs" rather than the
 * fleet-wide aggregate computeReportedAppsVulnSummaries returns.
 *
 * An app reported by both sources produces exactly ONE row here (merged,
 * `sources: string[]` records which side(s) saw it) — an earlier version of
 * this produced two visually-identical rows per app in that case, which is
 * the same data-integrity complaint that prompted getReportedAppsOverview's
 * own merge (installedApps.service.ts): a device shouldn't appear to have
 * "Chrome" installed twice just because two sources both confirm it's
 * there. See installedApps.service.ts's InstalledAppsRecord doc comment for
 * the two-slot storage model this merges back down from.
 *
 * One query per distinct installed app (not batched, and not one per raw
 * source contribution) — acceptable since this runs inside getDevicesFull's
 * per-device loop, same cost class as computeVulnServiceStatus's own
 * per-app cache reads immediately above, and that whole response is cached
 * for DEVICES_CACHE_TTL_SECONDS (15 min), not recomputed per request.
 * `vulnServiceEnabled` mirrors the caller's own vulnServiceCfg.enabled check
 * for computeVulnServiceStatus: false skips every VulnServiceCache lookup
 * here too (a device with 80 self-reported apps would otherwise add 80
 * no-op queries per fleet-cache refresh for a workspace that never turned
 * the integration on). Every OTHER registered vuln source (MISP, VulnCheck,
 * ...) resolves its own enabled flag internally via
 * getEnabledVulnSourcePlugins, same as computeVulnServiceStatus/
 * computeReportedAppsVulnSummaries — so a workspace with only e.g. VulnCheck
 * turned on and the Worker off still gets `vuln` populated here without
 * this function's signature needing a new boolean param per source added.
 * If every source is off, every app gets `vuln: null` at zero extra DB
 * cost — the tab still shows the plain installed-apps inventory either way.
 */
export async function computeDeviceAppsDetail(
  workspaceSlug: string,
  device: NormalizedDevice,
  appsEntries: InstalledAppsEntry[],
  vulnServiceEnabled: boolean,
): Promise<Array<{
  identifier: string;
  name: string | null;
  version: string;
  sources: string[];
  updateAvailable: boolean;
  productCode: string | null;
  enforcedByPolicy: boolean;
  origin?: "winget" | "msi" | "store";
  installLocation: string | null;
  vuln: AppVersionVulnInfo | null;
  // Malware/tamper verdict for this app's specific binary — a SEPARATE
  // signal from `vuln` (CVE match), see binaryIntegrityService.ts's doc
  // comment for why they aren't merged. null whenever the agent couldn't
  // resolve a hash for this app (older agent build, or a source this
  // wasn't confidently resolvable for) or nothing's been checked yet.
  integrity: AppIntegrityInfo | null;
  // True when the freshest contribution for this app is older than
  // APPS_STALE_AFTER_MS above — `vuln` is deliberately left null in that
  // case rather than reporting CVEs for software that may no longer be
  // installed. Lets the UI show "last confirmed N days ago" instead of a
  // misleading clean CVE check.
  stale: boolean;
}>> {
  if (appsEntries.length === 0) return [];
  const plugins = await getEnabledVulnSourcePlugins(workspaceSlug);
  const workerPlatform = vulnServiceEnabled || plugins.length > 0 ? PLATFORM_MAP[device.platform] : null;

  // Merge contributions from every entry (slot) down to one bucket per
  // identifier before building output rows — same two-pass shape as
  // getReportedAppsOverview's per-device merge.
  const byIdentifier = new Map<string, Array<{ entry: InstalledAppsEntry; app: InstalledAppsEntry["apps"][number] }>>();
  for (const entry of appsEntries) {
    for (const a of entry.apps ?? []) {
      const key = a.identifier;
      let bucket = byIdentifier.get(key);
      if (!bucket) {
        bucket = [];
        byIdentifier.set(key, bucket);
      }
      bucket.push({ entry, app: a });
    }
  }

  const out: Array<{
    identifier: string; name: string | null; version: string; sources: string[]; updateAvailable: boolean;
    productCode: string | null; enforcedByPolicy: boolean; origin?: "winget" | "msi" | "store"; installLocation: string | null;
    vuln: AppVersionVulnInfo | null; integrity: AppIntegrityInfo | null; stale: boolean;
  }> = [];
  for (const [identifier, contributions] of byIdentifier) {
    // Freshest contribution wins for the headline name/version, same rule
    // getReportedAppsOverview uses.
    const ranked = [...contributions].sort((a, b) => new Date(b.entry.fetchedAt).getTime() - new Date(a.entry.fetchedAt).getTime());
    const primary = ranked[0].app;
    const sources = Array.from(new Set(contributions.map((c) => c.entry.source)));
    // Whether the freshest contribution is itself stale (see
    // APPS_STALE_AFTER_MS above) — the app row is still shown either way
    // (this is the plain inventory list, not a vuln-only view), but a stale
    // row's `vuln` is deliberately left null rather than reporting CVEs for
    // software that may no longer even be installed. Exposed on the row so
    // the UI can show "last confirmed N days ago" instead of implying a
    // clean, current CVE check.
    const stale = !isAppsEntryFresh(ranked[0].entry);

    let vuln: AppVersionVulnInfo | null = null;
    if (workerPlatform && primary.version && !stale) {
      const key = `${identifier.toLowerCase()}|${primary.version}|${workerPlatform}`;
      const row = vulnServiceEnabled ? await prisma.vulnServiceCache.findUnique({ where: { workspaceSlug_key: { workspaceSlug, key } } }) : null;
      const extraRows = await Promise.all(plugins.map((p) => p.getCacheRow(workspaceSlug, key)));
      const freshRow = row && isFreshCache(row.cachedAt) ? row : null;
      const freshExtraRows = extraRows.map((r, i) => (r && plugins[i].isCacheFresh(r.cachedAt) ? r : null));
      if (freshRow || freshExtraRows.some(Boolean)) vuln = toVersionVulnInfo(freshRow, freshExtraRows);
    }
    const sha256 = contributions.map((c) => c.app.sha256).find(Boolean) ?? null;
    const integrity = sha256 ? await computeAppIntegrityStatus(workspaceSlug, sha256) : null;
    out.push({
      identifier,
      name: contributions.map((c) => c.app.name).find(Boolean) ?? null,
      version: primary.version,
      sources,
      updateAvailable: contributions.some((c) => Boolean(c.app.updateAvailable)),
      productCode: contributions.map((c) => c.app.productCode).find(Boolean) ?? null,
      enforcedByPolicy: contributions.some((c) => Boolean(c.app.enforcedByPolicy)),
      origin: contributions.map((c) => c.app.origin).find(Boolean),
      installLocation: contributions.map((c) => c.app.installLocation).find(Boolean) ?? null,
      vuln,
      integrity,
      stale,
    });
  }
  return out;
}
