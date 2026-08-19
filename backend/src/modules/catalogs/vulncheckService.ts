import axios from "axios";
import { prisma } from "../../services/prisma";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";
import { HttpError } from "../../utils/httpError";
import type { NormalizedDevice } from "../devices/deviceNormalize";
import { appKeywordsFor, guessCpe, osKeywordsFor } from "./cpeTranslate";
import { PLATFORM_MAP } from "./platformMap";
import type { VulnSourcePlugin } from "./vulnSources";

/**
 * VulnCheck connector — third CVE source (after the Vulnerability Service
 * Worker and MISP), merged into the same aggregate via vulnSources.ts's
 * plugin registry. Uses VulnCheck's free community-tier REST API
 * (api.vulncheck.com/v3) — no self-hosting, so unlike MispConfig there's no
 * baseUrl field, just an API key.
 *
 * Per combo: guess a CPE vendor:product pair (cpeTranslate.ts, same as
 * MISP), then `GET /v3/search/cpe?vendor=&product=&version=&part=` for
 * matching CVE ids (isVulnerable=true — only configurations NVD's own CPE
 * match data tags as actually affected, not every CPE a CVE record merely
 * references). That endpoint returns bare CVE ids with no CVSS/severity, so
 * a second pass enriches every DISTINCT id seen across the whole refresh
 * batch exactly once via `GET /v3/index/vulncheck-nvd2?cve=` (NVD 2.0
 * schema mirror), rather than re-fetching the same CVE's detail once per
 * combo that happens to share it. A third call — `GET
 * /v3/backup/vulncheck-kev`, once per refresh, not per CVE — builds a KEV
 * id set so `is_kev` can be flagged for free instead of per-CVE lookups.
 */

const CACHE_TTL_MS = 24 * 3600 * 1000;
const MAX_COMBOS_PER_TICK = 300;
const REQUEST_CONCURRENCY = 8; // VulnCheck's community tier allows 1000 req/min — generous headroom
export const VULNCHECK_TICK_MS = 3_600_000;

const API_BASE = "https://api.vulncheck.com/v3";

export interface VulncheckConfigPublic {
  workspaceSlug: string;
  enabled: boolean;
  apiKey: string; // masked
  cpeGuesserBaseUrl: string;
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
  if (!Number.isFinite(h)) return 12;
  return Math.max(1, Math.min(h, 72));
}

async function loadConfigRow(workspaceSlug: string) {
  return prisma.vulncheckConfig.findUnique({ where: { workspaceSlug } });
}

function toPublic(row: NonNullable<Awaited<ReturnType<typeof loadConfigRow>>> | null, workspaceSlug: string): VulncheckConfigPublic {
  if (!row) {
    return { workspaceSlug, enabled: false, apiKey: "", cpeGuesserBaseUrl: "", refreshIntervalHours: 12, lastRefreshAt: null, lastRefreshError: null, lastRefreshStats: null };
  }
  const key = row.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : "";
  return {
    workspaceSlug,
    enabled: row.enabled,
    apiKey: maskSecretTail(key),
    cpeGuesserBaseUrl: row.cpeGuesserBaseUrl,
    refreshIntervalHours: row.refreshIntervalHours,
    lastRefreshAt: row.lastRefreshAt?.toISOString() ?? null,
    lastRefreshError: row.lastRefreshError ?? null,
    lastRefreshStats: (row.lastRefreshStats as Record<string, any>) ?? null,
  };
}

export async function getVulncheckConfig(workspaceSlug: string): Promise<VulncheckConfigPublic> {
  return toPublic(await loadConfigRow(workspaceSlug), workspaceSlug);
}

export async function updateVulncheckConfig(
  workspaceSlug: string,
  payload: { enabled: boolean; apiKey: string; cpeGuesserBaseUrl: string; refreshIntervalHours: number },
  actorEmail: string,
): Promise<VulncheckConfigPublic> {
  const existing = await loadConfigRow(workspaceSlug);
  const keyEncrypted = payload.apiKey.trim() ? encryptSecret(payload.apiKey.trim()) : existing?.apiKeyEncrypted ?? null;
  const data = {
    enabled: payload.enabled,
    apiKeyEncrypted: keyEncrypted,
    cpeGuesserBaseUrl: (payload.cpeGuesserBaseUrl || "").trim().replace(/\/+$/, ""),
    refreshIntervalHours: clampRefreshHours(payload.refreshIntervalHours),
  };
  const row = await prisma.vulncheckConfig.upsert({ where: { workspaceSlug }, create: { workspaceSlug, ...data }, update: data });
  const { recordAuditEvent } = await import("../../services/auditLog");
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "vulncheck_config_updated",
    actor: actorEmail,
    message: `VulnCheck threat intel connector ${payload.enabled ? "enabled" : "disabled"} by ${actorEmail}`,
  });
  return toPublic(row, workspaceSlug);
}

/** POST /api/vulncheck/test — a minimal, cheap KEV index query (limit=1) to confirm reachability and that the API key is valid. */
export async function testVulncheckConfig(workspaceSlug: string, payload: { apiKey: string }) {
  const existing = await loadConfigRow(workspaceSlug);
  const apiKey = payload.apiKey.trim() || (existing?.apiKeyEncrypted ? decryptSecret(existing.apiKeyEncrypted) : "");
  if (!apiKey) throw new HttpError(400, "An API key is required to test the connection.");
  const started = Date.now();
  let res;
  try {
    res = await axios.get(`${API_BASE}/index/vulncheck-kev`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, params: { limit: 1 }, timeout: 15000, validateStatus: () => true });
  } catch (e) {
    throw new HttpError(502, `Could not reach api.vulncheck.com: ${e}`);
  }
  const latencyMs = Date.now() - started;
  if (res.status === 401 || res.status === 403) throw new HttpError(401, "Reached VulnCheck, but the API key was rejected.");
  if (res.status !== 200) throw new HttpError(502, `VulnCheck responded with ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 200)}`);
  return { status: "ok", latencyMs };
}

function cvssSeverityFromNvd2(entry: any): { severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | null; score: number | null } {
  const metricsGroups = ["cvssMetricV31", "cvssMetricV30", "cvssMetricV2"];
  for (const group of metricsGroups) {
    const metric = entry?.metrics?.[group]?.[0];
    if (!metric) continue;
    const score = metric.cvssData?.baseScore ?? null;
    const rawSeverity = String(metric.cvssData?.baseSeverity ?? metric.baseSeverity ?? "").toUpperCase();
    if (["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(rawSeverity)) return { severity: rawSeverity as any, score };
    if (typeof score === "number") {
      if (score >= 9) return { severity: "CRITICAL", score };
      if (score >= 7) return { severity: "HIGH", score };
      if (score >= 4) return { severity: "MEDIUM", score };
      if (score > 0) return { severity: "LOW", score };
    }
  }
  return { severity: null, score: null };
}

/** GET /v3/search/cpe -> distinct CVE ids for one vendor/product/version/part combo. */
async function searchCpeForCves(apiKey: string, vendor: string, product: string, version: string, part: "a" | "o"): Promise<string[]> {
  const res = await axios.get(`${API_BASE}/search/cpe`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    params: { vendor, product, version, part, isVulnerable: true },
    timeout: 20000, validateStatus: () => true,
  });
  if (res.status !== 200) throw new Error(`VulnCheck /search/cpe returned ${res.status}`);
  const entries: any[] = res.data?.data ?? [];
  const ids = new Set<string>();
  for (const entry of entries) for (const cve of entry?.cves ?? []) if (typeof cve === "string") ids.add(cve.toUpperCase());
  return Array.from(ids);
}

/** GET /v3/index/vulncheck-nvd2?cve= -> CVSS severity/score for one CVE id. */
async function enrichCve(apiKey: string, cveId: string): Promise<{ severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | null; score: number | null }> {
  const res = await axios.get(`${API_BASE}/index/vulncheck-nvd2`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    params: { cve: cveId }, timeout: 15000, validateStatus: () => true,
  });
  if (res.status !== 200) return { severity: null, score: null };
  const entry = res.data?.data?.[0];
  return entry ? cvssSeverityFromNvd2(entry) : { severity: null, score: null };
}

/** GET /v3/backup/vulncheck-kev -> the full KEV id set, once per refresh (not per CVE). */
async function fetchKevIdSet(apiKey: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const res = await axios.get(`${API_BASE}/backup/vulncheck-kev`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, timeout: 30000, validateStatus: () => true });
    if (res.status !== 200) return out;
    for (const entry of res.data?.data ?? []) for (const cve of entry?.cve ?? []) if (typeof cve === "string") out.add(cve.toUpperCase());
  } catch {
    // KEV enrichment is best-effort — a failure here shouldn't fail the whole refresh, just leaves is_kev false for everything this tick.
  }
  return out;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function refreshVulncheckForWorkspace(workspaceSlug: string, bearer: string, force = false): Promise<Record<string, any>> {
  const { getDevicesFull } = await import("../devices/devices.service");
  const { loadInstalledAppsStore, installedAppsRecordEntries } = await import("../appLists/installedApps.service");

  const cfgRow = await loadConfigRow(workspaceSlug);
  if (!cfgRow) throw new HttpError(400, "VulnCheck isn't configured for this workspace yet.");
  const apiKey = cfgRow.apiKeyEncrypted ? decryptSecret(cfgRow.apiKeyEncrypted) : "";
  if (!apiKey) throw new HttpError(400, "VulnCheck API key is required.");

  const devicesResp = await getDevicesFull(bearer, workspaceSlug, false);
  const devices: NormalizedDevice[] = devicesResp.items;
  const installedAppsStore = await loadInstalledAppsStore(workspaceSlug);

  const cacheRows = await prisma.vulncheckCache.findMany({ where: { workspaceSlug } });
  const cacheByKey = new Map<string, (typeof cacheRows)[number]>(cacheRows.map((r) => [r.key, r]));

  const osCombos = new Map<string, { platform: string }>();
  for (const d of devices) {
    const p = PLATFORM_MAP[d.platform];
    if (p && d.osVersion) osCombos.set(`${p}|${d.osVersion}`, { platform: p });
  }
  const appCombos = new Map<string, { identifier: string; name: string; version: string; platform: string }>();
  for (const d of devices) {
    const p = PLATFORM_MAP[d.platform];
    if (!p) continue;
    for (const entry of installedAppsRecordEntries(installedAppsStore[d.id])) {
      for (const a of entry.apps ?? []) {
        if (a.identifier && a.version) {
          appCombos.set(`${a.identifier.toLowerCase()}|${a.version}|${p}`, { identifier: a.identifier, name: a.name ?? a.identifier, version: a.version, platform: p });
        }
      }
    }
  }
  // OS combos need a version string for /search/cpe — reuse the device's
  // own osVersion (already the map key's second segment).
  const osVersionByKey = new Map<string, string>();
  for (const d of devices) {
    const p = PLATFORM_MAP[d.platform];
    if (p && d.osVersion) osVersionByKey.set(`${p}|${d.osVersion}`, d.osVersion);
  }

  const isFresh = (cachedAt?: Date | null) => !force && Boolean(cachedAt) && Date.now() - cachedAt!.getTime() < CACHE_TTL_MS;

  let evicted = 0;
  for (const row of cacheRows) {
    if (!osCombos.has(row.key) && !appCombos.has(row.key)) {
      await prisma.vulncheckCache.delete({ where: { id: row.id } });
      evicted += 1;
    }
  }

  const osToQuery = Array.from(osCombos.entries()).filter(([key]) => !isFresh(cacheByKey.get(key)?.cachedAt));
  const appsToQueryAll = Array.from(appCombos.entries()).filter(([key]) => !isFresh(cacheByKey.get(key)?.cachedAt));
  const combosToQuery = [...osToQuery, ...appsToQueryAll].slice(0, MAX_COMBOS_PER_TICK);

  let osQueried = 0, osErrors = 0, appsQueried = 0, appsErrors = 0;
  const appsTotalByPlatform: Record<string, number> = {};
  for (const c of appCombos.values()) appsTotalByPlatform[c.platform] = (appsTotalByPlatform[c.platform] ?? 0) + 1;

  // Phase 1: resolve each combo to a (possibly empty) list of CVE ids.
  const idsByComboKey = new Map<string, string[]>();
  await mapWithConcurrency(combosToQuery, REQUEST_CONCURRENCY, async ([key, combo]) => {
    const isOs = osCombos.has(key);
    try {
      const keywords = isOs ? osKeywordsFor((combo as { platform: string }).platform) : appKeywordsFor((combo as any).name, (combo as any).identifier);
      const guessed = await guessCpe(cfgRow.cpeGuesserBaseUrl, keywords, isOs ? "o" : "a");
      if (!guessed) {
        idsByComboKey.set(key, []);
      } else {
        const version = isOs ? osVersionByKey.get(key) ?? "" : (combo as any).version;
        const ids = await searchCpeForCves(apiKey, guessed.vendor, guessed.product, version, isOs ? "o" : "a");
        idsByComboKey.set(key, ids);
      }
      if (isOs) osQueried += 1; else appsQueried += 1;
    } catch (e) {
      if (isOs) osErrors += 1; else appsErrors += 1;
      console.warn(`[VulnCheck] CPE search failed (${key}) for ${workspaceSlug}: ${e}`);
    }
  });

  // Phase 2: enrich every DISTINCT CVE id seen across the whole batch exactly once.
  const allIds = Array.from(new Set(Array.from(idsByComboKey.values()).flat()));
  const enrichment = new Map<string, { severity: string | null; score: number | null }>();
  await mapWithConcurrency(allIds, REQUEST_CONCURRENCY, async (id) => {
    try {
      enrichment.set(id, await enrichCve(apiKey, id));
    } catch {
      enrichment.set(id, { severity: null, score: null });
    }
  });

  // KEV set — once per refresh, not per CVE.
  const kevIds = allIds.length ? await fetchKevIdSet(apiKey) : new Set<string>();

  // Phase 3: assemble + cache each queried combo's final result.
  for (const [key, ids] of idsByComboKey) {
    const cveList = ids.map((id) => {
      const e = enrichment.get(id) ?? { severity: null, score: null };
      return { id, severity: e.severity, epss_score: null, is_kev: kevIds.has(id), score: e.score, fixed_in: null, source: "vulncheck" };
    });
    const result = { mapped: cveList.length > 0, cve_list: cveList };
    await prisma.vulncheckCache.upsert({
      where: { workspaceSlug_key: { workspaceSlug, key } },
      create: { workspaceSlug, key, result },
      update: { result, cachedAt: new Date() },
    });
  }

  const stats = {
    osQueried, osErrors, osTotal: osCombos.size,
    appsQueried, appsErrors, appsTotal: appCombos.size,
    appsTotalByPlatform,
    distinctCvesEnriched: allIds.length,
    appsRemaining: Math.max(0, osToQuery.length + appsToQueryAll.length - combosToQuery.length),
    cacheEvicted: evicted,
    forced: force,
    refreshedAt: new Date().toISOString(),
  };
  await prisma.vulncheckConfig.update({
    where: { workspaceSlug },
    data: {
      lastRefreshAt: new Date(),
      lastRefreshError: osErrors === 0 && appsErrors === 0 ? null : `${osErrors} OS + ${appsErrors} app quer${osErrors + appsErrors === 1 ? "y" : "ies"} failed`,
      lastRefreshStats: stats as any,
    },
  });
  return stats;
}

export async function refreshVulncheckNow(workspaceSlug: string, authorization: string) {
  const cfg = await loadConfigRow(workspaceSlug);
  if (!cfg?.enabled || !cfg.apiKeyEncrypted) throw new HttpError(400, "VulnCheck isn't configured/enabled for this workspace yet.");
  return refreshVulncheckForWorkspace(workspaceSlug, authorization, true);
}

export async function runVulncheckRefresherTick(): Promise<void> {
  const { listAutomationWorkspaces, getAutomationBearer } = await import("../settings/automationCredential.service");
  for (const workspaceSlug of await listAutomationWorkspaces()) {
    const cfg = await loadConfigRow(workspaceSlug);
    if (!cfg?.enabled || !cfg.apiKeyEncrypted) continue;
    if (cfg.lastRefreshAt) {
      const elapsedMs = Date.now() - cfg.lastRefreshAt.getTime();
      if (elapsedMs < clampRefreshHours(cfg.refreshIntervalHours) * 3600 * 1000) continue;
    }
    const bearer = await getAutomationBearer(workspaceSlug);
    if (!bearer) continue;
    try {
      const stats = await refreshVulncheckForWorkspace(workspaceSlug, bearer);
      console.log(`[VulnCheck] ${workspaceSlug}: ${JSON.stringify(stats)}`);
    } catch (e) {
      console.warn(`[VulnCheck Refresher] ${workspaceSlug} failed: ${e}`);
    }
  }
}

export async function isVulncheckEnabled(workspaceSlug: string): Promise<boolean> {
  const cfg = await loadConfigRow(workspaceSlug);
  return Boolean(cfg?.enabled);
}

export async function getVulncheckCacheRow(workspaceSlug: string, key: string) {
  return prisma.vulncheckCache.findUnique({ where: { workspaceSlug_key: { workspaceSlug, key } } });
}

export async function getVulncheckCacheRows(workspaceSlug: string, keys: string[]) {
  if (!keys.length) return [];
  return prisma.vulncheckCache.findMany({ where: { workspaceSlug, key: { in: keys } } });
}

export function isVulncheckCacheFresh(cachedAt: Date | undefined | null): boolean {
  return Boolean(cachedAt) && Date.now() - cachedAt!.getTime() < CACHE_TTL_MS;
}

/** Registered with vulnSources.ts's generic plugin loop — see that file's doc comment. */
export const vulncheckVulnSourcePlugin: VulnSourcePlugin = {
  name: "vulncheck",
  isEnabled: isVulncheckEnabled,
  getCacheRow: async (workspaceSlug, key) => {
    const row = await getVulncheckCacheRow(workspaceSlug, key);
    return row ? { key, result: row.result, cachedAt: row.cachedAt } : null;
  },
  getCacheRows: async (workspaceSlug, keys) => {
    const rows: Awaited<ReturnType<typeof getVulncheckCacheRows>> = await getVulncheckCacheRows(workspaceSlug, keys);
    return rows.map((r) => ({ key: r.key, result: r.result, cachedAt: r.cachedAt }));
  },
  isCacheFresh: isVulncheckCacheFresh,
};
