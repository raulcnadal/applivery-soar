import axios from "axios";
import { prisma } from "../../services/prisma";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";
import { HttpError } from "../../utils/httpError";
import type { NormalizedDevice } from "../devices/deviceNormalize";
import type { InstalledAppsEntry } from "../appLists/installedApps.service";

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

const PLATFORM_MAP: Record<string, string> = { macos: "macos", apple: "ios", android: "android", aosp: "android", windows: "windows" };

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
 */
export async function refreshVulnServiceForWorkspace(workspaceSlug: string, bearer: string): Promise<Record<string, any>> {
  const { getDevicesFull } = await import("../devices/devices.service");
  const { loadInstalledAppsStore } = await import("../appLists/installedApps.service");

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
    const entry: InstalledAppsEntry | undefined = installedAppsStore[d.id];
    for (const a of entry?.apps ?? []) {
      if (a.identifier && a.version) {
        appCombos.set(`${a.identifier.toLowerCase()}|${a.version}|${workerPlatform}`, { identifier: a.identifier, version: a.version, platform: workerPlatform });
      }
    }
  }

  const isFresh = (fetchedAt: Date | undefined | null) => Boolean(fetchedAt) && Date.now() - fetchedAt!.getTime() < CACHE_TTL_MS;

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
        const [key] = batchToQuery[i];
        const result = results[i];
        await prisma.vulnServiceCache.upsert({
          where: { workspaceSlug_key: { workspaceSlug, key } },
          create: { workspaceSlug, key, result },
          update: { result, cachedAt: new Date() },
        });
        appsQueried += 1;
      }
    } catch (e) {
      appsErrors += batchToQuery.length;
      console.warn(`[Vuln Service] Apps batch query failed for ${workspaceSlug}: ${e}`);
    }
  }

  const stats = {
    osQueried, osErrors, osTotal: osCombos.size,
    appsQueried, appsErrors, appsTotal: appCombos.size,
    appsRemaining: Math.max(0, toQuery.length - batchToQuery.length),
    cacheEvicted: evicted,
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

/** POST /api/vuln-service/refresh (main.py:17224) — uses the calling admin's own session. */
export async function refreshVulnServiceNow(workspaceSlug: string, authorization: string) {
  const cfg = await loadConfigRow(workspaceSlug);
  if (!cfg?.enabled || !cfg.baseUrl || !cfg.apiTokenEncrypted) {
    throw new HttpError(400, "Vulnerability Service isn't configured/enabled for this workspace yet.");
  }
  return refreshVulnServiceForWorkspace(workspaceSlug, authorization);
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
export async function computeVulnServiceStatus(workspaceSlug: string, device: NormalizedDevice, appsEntry: InstalledAppsEntry | null): Promise<Record<string, any> | null> {
  const workerPlatform = PLATFORM_MAP[device.platform];
  if (!workerPlatform) return null;

  const osKey = device.osVersion ? `${workerPlatform}|${device.osVersion}` : null;
  const osRow = osKey ? await prisma.vulnServiceCache.findUnique({ where: { workspaceSlug_key: { workspaceSlug, key: osKey } } }) : null;
  const isFresh = (cachedAt: Date | undefined | null) => Boolean(cachedAt) && Date.now() - cachedAt!.getTime() < CACHE_TTL_MS;
  const osMatch = osRow && isFresh(osRow.cachedAt) ? (osRow.result as Record<string, any>) : null;

  const appResults: Array<Record<string, any>> = [];
  const appTimestamps: string[] = [];
  for (const a of appsEntry?.apps ?? []) {
    const key = `${(a.identifier ?? "").toLowerCase()}|${a.version}|${workerPlatform}`;
    const row = await prisma.vulnServiceCache.findUnique({ where: { workspaceSlug_key: { workspaceSlug, key } } });
    if (row) appTimestamps.push(row.cachedAt.toISOString());
    if (row && isFresh(row.cachedAt) && (row.result as any)?.mapped) appResults.push(row.result as Record<string, any>);
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
    for (const [sev, n] of Object.entries(r.counts ?? {})) {
      if (sev in totalCounts) totalCounts[sev] += Number(n);
    }
    totalUncertain += r.uncertain ?? 0;
    for (const c of r.cve_list ?? []) {
      allCves.push(c);
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
