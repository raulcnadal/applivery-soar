import axios from "axios";
import https from "https";
import { prisma } from "../../services/prisma";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";
import { HttpError } from "../../utils/httpError";
import type { NormalizedDevice } from "../devices/deviceNormalize";
import { appKeywordsFor, guessCpe, isPlausibleOsCpeGuess, osKeywordsFor } from "./cpeTranslate";
import { PLATFORM_MAP } from "./platformMap";

/**
 * MISP Threat Intel connector — queries a customer-deployed MISP instance
 * (https://www.misp-project.org) for CVEs affecting the fleet's apps/OS
 * versions, translating our inventory into CPE via cpeTranslate.ts first
 * (MISP has no notion of "this app version" on its own — see that file's
 * doc comment). Deliberately mirrors vulnService.ts's shape (config CRUD,
 * per-combo 24h cache, force-refresh bypass, scheduled tick) so the two
 * behave identically from an admin's point of view and so their cache rows
 * share the exact same key scheme, letting vulnService.ts's read functions
 * (computeVulnServiceStatus / computeReportedAppsVulnSummaries /
 * computeDeviceAppsDetail) merge both sources into one aggregate per the
 * user's explicit choice, rather than surfacing MISP as a separate section.
 *
 * Unlike the Vulnerability Service Worker, MISP has no bulk "give me CVEs
 * for these 25 apps" endpoint — each combo costs 1 cpe-guesser call + up to
 * 2 MISP calls (attribute search, then event CVE lookup). MAX_PER_TICK is
 * kept modest and requests run with limited concurrency so a large fleet's
 * first refresh doesn't hammer either the public cpe-guesser instance or the
 * customer's own MISP.
 */

const CACHE_TTL_MS = 24 * 3600 * 1000;
const MAX_COMBOS_PER_TICK = 200;
const REQUEST_CONCURRENCY = 5;
export const MISP_TICK_MS = 3_600_000;

const SEVERITY_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export interface MispConfigPublic {
  workspaceSlug: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string; // masked
  verifySsl: boolean;
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
  return prisma.mispConfig.findUnique({ where: { workspaceSlug } });
}

function toPublic(row: NonNullable<Awaited<ReturnType<typeof loadConfigRow>>> | null, workspaceSlug: string): MispConfigPublic {
  if (!row) {
    return { workspaceSlug, enabled: false, baseUrl: "", apiKey: "", verifySsl: true, cpeGuesserBaseUrl: "", refreshIntervalHours: 12, lastRefreshAt: null, lastRefreshError: null, lastRefreshStats: null };
  }
  const key = row.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : "";
  return {
    workspaceSlug,
    enabled: row.enabled,
    baseUrl: row.baseUrl,
    apiKey: maskSecretTail(key),
    verifySsl: row.verifySsl,
    cpeGuesserBaseUrl: row.cpeGuesserBaseUrl,
    refreshIntervalHours: row.refreshIntervalHours,
    lastRefreshAt: row.lastRefreshAt?.toISOString() ?? null,
    lastRefreshError: row.lastRefreshError ?? null,
    lastRefreshStats: (row.lastRefreshStats as Record<string, any>) ?? null,
  };
}

export async function getMispConfig(workspaceSlug: string): Promise<MispConfigPublic> {
  return toPublic(await loadConfigRow(workspaceSlug), workspaceSlug);
}

export async function updateMispConfig(
  workspaceSlug: string,
  payload: { enabled: boolean; baseUrl: string; apiKey: string; verifySsl: boolean; cpeGuesserBaseUrl: string; refreshIntervalHours: number },
  actorEmail: string,
): Promise<MispConfigPublic> {
  const existing = await loadConfigRow(workspaceSlug);
  const keyEncrypted = payload.apiKey.trim() ? encryptSecret(payload.apiKey.trim()) : existing?.apiKeyEncrypted ?? null;
  const data = {
    enabled: payload.enabled,
    baseUrl: (payload.baseUrl || "").trim().replace(/\/+$/, ""),
    apiKeyEncrypted: keyEncrypted,
    verifySsl: payload.verifySsl ?? true,
    cpeGuesserBaseUrl: (payload.cpeGuesserBaseUrl || "").trim().replace(/\/+$/, ""),
    refreshIntervalHours: clampRefreshHours(payload.refreshIntervalHours),
  };
  const row = await prisma.mispConfig.upsert({ where: { workspaceSlug }, create: { workspaceSlug, ...data }, update: data });
  const { recordAuditEvent } = await import("../../services/auditLog");
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "misp_config_updated",
    actor: actorEmail,
    message: `MISP threat intel connector ${payload.enabled ? "enabled" : "disabled"} by ${actorEmail}`,
  });
  return toPublic(row, workspaceSlug);
}

/** POST /api/misp/test — hits MISP's lightweight, read-only `/servers/getVersion` to confirm reachability + auth without touching any data. */
export async function testMispConfig(workspaceSlug: string, payload: { baseUrl: string; apiKey: string; verifySsl: boolean }) {
  const base = (payload.baseUrl || "").trim().replace(/\/+$/, "");
  const existing = await loadConfigRow(workspaceSlug);
  const apiKey = payload.apiKey.trim() || (existing?.apiKeyEncrypted ? decryptSecret(existing.apiKeyEncrypted) : "");
  if (!base || !apiKey) throw new HttpError(400, "Base URL and API key are both required to test the connection.");
  const verifySsl = payload.verifySsl ?? true;
  const started = Date.now();
  let res;
  try {
    res = await axios.get(`${base}/servers/getVersion`, {
      headers: { Authorization: apiKey, Accept: "application/json" },
      timeout: 15000,
      validateStatus: () => true,
      httpsAgent: verifySsl ? undefined : new https.Agent({ rejectUnauthorized: false }),
    });
  } catch (e) {
    throw new HttpError(502, `Could not reach ${base}: ${e}`);
  }
  const latencyMs = Date.now() - started;
  if (res.status === 401 || res.status === 403) throw new HttpError(401, "Reached the server, but the API key was rejected.");
  if (res.status !== 200) throw new HttpError(502, `Server responded with ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 200)}`);
  return { status: "ok", latencyMs, version: res.data?.version ?? null };
}

function threatLevelToSeverity(id: number | null | undefined): "HIGH" | "MEDIUM" | "LOW" {
  // MISP's own threat_level_id enum: 1=High, 2=Medium, 3=Low, 4=Undefined.
  // Undefined is deliberately bucketed as MEDIUM rather than dropped or
  // treated as LOW — an event an analyst hasn't rated yet shouldn't read as
  // "confirmed low risk" once it's merged next to CVSS-backed severities
  // from the Vulnerability Service.
  if (id === 1) return "HIGH";
  if (id === 3) return "LOW";
  return "MEDIUM";
}

interface MispCpeHit { eventId: string; eventInfo: string; threatLevelId: number | null }

async function mispSearchCpeAttributes(base: string, apiKey: string, verifySsl: boolean, valuePattern: string): Promise<MispCpeHit[]> {
  const res = await axios.post(
    `${base}/attributes/restSearch`,
    { returnFormat: "json", type: ["cpe"], value: valuePattern, searchall: 1, includeEventTags: true, includeContext: true, limit: 100 },
    {
      headers: { Authorization: apiKey, Accept: "application/json", "Content-Type": "application/json" },
      timeout: 20000, validateStatus: () => true,
      httpsAgent: verifySsl ? undefined : new https.Agent({ rejectUnauthorized: false }),
    },
  );
  if (res.status !== 200) throw new Error(`MISP returned ${res.status} for a CPE attribute search`);
  const attrs: any[] = res.data?.response?.Attribute ?? [];
  const hits = new Map<string, MispCpeHit>();
  for (const a of attrs) {
    const eventId = a?.event_id ?? a?.Event?.id;
    if (!eventId) continue;
    hits.set(String(eventId), {
      eventId: String(eventId),
      eventInfo: a?.Event?.info ?? "",
      threatLevelId: a?.Event?.threat_level_id != null ? Number(a.Event.threat_level_id) : null,
    });
  }
  return Array.from(hits.values());
}

/** For each matched event, pulls its sibling "vulnerability"-typed attributes (CVE IDs) — restSearch on an attribute never returns its event's other attributes, only the event's own metadata, so this is a required second hop. */
async function mispSearchEventCves(base: string, apiKey: string, verifySsl: boolean, eventIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!eventIds.length) return out;
  const res = await axios.post(
    `${base}/attributes/restSearch`,
    { returnFormat: "json", type: ["vulnerability"], eventid: eventIds, limit: 500 },
    {
      headers: { Authorization: apiKey, Accept: "application/json", "Content-Type": "application/json" },
      timeout: 20000, validateStatus: () => true,
      httpsAgent: verifySsl ? undefined : new https.Agent({ rejectUnauthorized: false }),
    },
  );
  if (res.status !== 200) throw new Error(`MISP returned ${res.status} for an event CVE lookup`);
  const attrs: any[] = res.data?.response?.Attribute ?? [];
  for (const a of attrs) {
    const eventId = String(a?.event_id ?? a?.Event?.id ?? "");
    const cveId = String(a?.value ?? "").toUpperCase().trim();
    if (!eventId || !/^CVE-\d{4}-\d+$/.test(cveId)) continue;
    const list = out.get(eventId) ?? [];
    if (!list.includes(cveId)) list.push(cveId);
    out.set(eventId, list);
  }
  return out;
}

/**
 * Most-specific-first dotted-version prefixes — "26.6.2" -> ["26.6.2",
 * "26.6", "26"]. Used to retry a MISP CPE search at progressively coarser
 * version granularity: a real MISP CPE attribute might record a version at
 * a coarser precision than our own inventory does (e.g. "18.4" vs our
 * "18.4.1"), so an exact full-string match can miss a real hit that a
 * major.minor-level match would still find, without falling all the way
 * back to a version-LESS search (see lookupMispForCombo's own doc comment
 * for why that's no longer acceptable).
 */
function versionPrefixes(version: string): string[] {
  const parts = version.split(/[.\-_]/).filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i >= 1; i--) {
    const p = parts.slice(0, i).join(".");
    if (!out.includes(p)) out.push(p);
  }
  return out.length ? out : [version];
}

/**
 * Full per-combo pipeline: guess CPE -> search MISP for that CPE, narrowed
 * to this exact combo's version -> pull CVE IDs from the matched events.
 * Returns the same `{mapped, cve_list}` shape vulnService.ts's Worker
 * results use, so both cache tables merge cleanly.
 *
 * The version narrowing (added after a real report: an up-to-date, no-Adobe
 * macOS device showed 5531 CVEs dominated by decade-old Adobe Flash/Reader
 * entries) is the fix for what was a genuine bug, not a tuning knob —
 * `guessed.vendor:guessed.product` alone (no version) previously matched
 * ANY MISP CPE attribute value ever recorded for that vendor:product across
 * MISP's entire history, e.g. "apple:mac_os_x" matching events from every
 * macOS release since 2009, AND then pulled every "vulnerability"-typed
 * attribute sibling in each matched event — which can include CVEs for
 * entirely different software an event happens to also reference (a
 * cross-platform advisory bundling Adobe Flash CVEs alongside an Apple CPE
 * tag, for instance). Retrying at progressively coarser version prefixes
 * (versionPrefixes above) balances real match recall against that
 * over-matching risk; if every prefix comes back empty, this combo is
 * correctly reported as unmapped rather than falling back to the unscoped
 * search that caused the bug.
 */
async function lookupMispForCombo(
  base: string, apiKey: string, verifySsl: boolean, cpeGuesserBase: string, keywords: string[], part: "a" | "o", version: string,
  // Non-null only for OS lookups — see cpeTranslate.ts's isPlausibleOsCpeGuess
  // doc comment for why OS guesses get this extra check and app guesses
  // don't (we deterministically know Apple/Google/Microsoft own these
  // platforms; there's no equivalent known-good answer for arbitrary apps).
  osPlatform: string | null = null,
): Promise<{ mapped: boolean; cve_list: Array<Record<string, any>> }> {
  const guessed = await guessCpe(cpeGuesserBase, keywords, part);
  if (!guessed) return { mapped: false, cve_list: [] };
  if (osPlatform && !isPlausibleOsCpeGuess(osPlatform, guessed)) return { mapped: false, cve_list: [] };

  let hits: MispCpeHit[] = [];
  for (const prefix of versionPrefixes(version)) {
    hits = await mispSearchCpeAttributes(base, apiKey, verifySsl, `%${guessed.vendor}:${guessed.product}:${prefix}%`);
    if (hits.length) break;
  }
  if (!hits.length) return { mapped: false, cve_list: [] };

  const eventCves = await mispSearchEventCves(base, apiKey, verifySsl, hits.map((h) => h.eventId));
  const byId = new Map<string, Record<string, any>>();
  for (const hit of hits) {
    const severity = threatLevelToSeverity(hit.threatLevelId);
    for (const cveId of eventCves.get(hit.eventId) ?? []) {
      const existing = byId.get(cveId);
      if (!existing || SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity]) {
        // `id` (not `cve_id`) is deliberate — matches the Vulnerability
        // Service Worker's own cve_list entry shape exactly
        // (AppDetailModal.vue keys/renders on `c.id`), so a merged list
        // displays MISP-sourced CVEs identically to Worker-sourced ones.
        byId.set(cveId, { id: cveId, severity, epss_score: null, is_kev: false, score: null, fixed_in: null, source: "misp", misp_event_id: hit.eventId, misp_event_info: hit.eventInfo });
      }
    }
  }
  return { mapped: byId.size > 0, cve_list: Array.from(byId.values()) };
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

/**
 * Enumerates the exact same fleet-wide app/OS combos as
 * refreshVulnServiceForWorkspace (same PLATFORM_MAP, same cache key shape),
 * queries MISP for whichever aren't already cached fresh, and writes results
 * to MispVulnCache. `force` bypasses the 24h freshness check, same contract
 * as vulnService.ts's own force parameter.
 */
export async function refreshMispForWorkspace(workspaceSlug: string, bearer: string, force = false): Promise<Record<string, any>> {
  const { getDevicesFull } = await import("../devices/devices.service");
  const { loadInstalledAppsStore, installedAppsRecordEntries } = await import("../appLists/installedApps.service");

  const cfgRow = await loadConfigRow(workspaceSlug);
  if (!cfgRow) throw new HttpError(400, "MISP isn't configured for this workspace yet.");
  const apiKey = cfgRow.apiKeyEncrypted ? decryptSecret(cfgRow.apiKeyEncrypted) : "";
  const base = (cfgRow.baseUrl || "").replace(/\/+$/, "");
  if (!base || !apiKey) throw new HttpError(400, "MISP base URL and API key are both required.");

  const devicesResp = await getDevicesFull(bearer, workspaceSlug, false);
  const devices: NormalizedDevice[] = devicesResp.items;
  const installedAppsStore = await loadInstalledAppsStore(workspaceSlug);

  const cacheRows = await prisma.mispVulnCache.findMany({ where: { workspaceSlug } });
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

  const isFresh = (cachedAt?: Date | null) => !force && Boolean(cachedAt) && Date.now() - cachedAt!.getTime() < CACHE_TTL_MS;

  let evicted = 0;
  for (const row of cacheRows) {
    if (!osCombos.has(row.key) && !appCombos.has(row.key)) {
      await prisma.mispVulnCache.delete({ where: { id: row.id } });
      evicted += 1;
    }
  }

  const osToQuery = Array.from(osCombos.entries()).filter(([key]) => !isFresh(cacheByKey.get(key)?.cachedAt));
  const appsToQueryAll = Array.from(appCombos.entries()).filter(([key]) => !isFresh(cacheByKey.get(key)?.cachedAt));
  const combosToQuery = [...osToQuery, ...appsToQueryAll].slice(0, MAX_COMBOS_PER_TICK);

  let osQueried = 0, osErrors = 0, appsQueried = 0, appsErrors = 0;
  const appsTotalByPlatform: Record<string, number> = {};
  for (const c of appCombos.values()) appsTotalByPlatform[c.platform] = (appsTotalByPlatform[c.platform] ?? 0) + 1;

  await mapWithConcurrency(combosToQuery, REQUEST_CONCURRENCY, async ([key, combo]) => {
    const isOs = osCombos.has(key);
    try {
      const keywords = isOs ? osKeywordsFor((combo as { platform: string }).platform) : appKeywordsFor((combo as any).name, (combo as any).identifier);
      // OS combo keys are "${platform}|${osVersion}" (osCombos.set above) —
      // the version isn't stored separately on the combo value for OS
      // entries, so pull it back out of the key itself rather than
      // threading a third shape through this Map.
      const version = isOs ? key.split("|")[1] ?? "" : (combo as any).version;
      const result = await lookupMispForCombo(base, apiKey, cfgRow.verifySsl, cfgRow.cpeGuesserBaseUrl, keywords, isOs ? "o" : "a", version, isOs ? (combo as { platform: string }).platform : null);
      await prisma.mispVulnCache.upsert({
        where: { workspaceSlug_key: { workspaceSlug, key } },
        create: { workspaceSlug, key, result },
        update: { result, cachedAt: new Date() },
      });
      if (isOs) osQueried += 1; else appsQueried += 1;
    } catch (e) {
      if (isOs) osErrors += 1; else appsErrors += 1;
      console.warn(`[MISP] Query failed (${key}) for ${workspaceSlug}: ${e}`);
    }
  });

  const stats = {
    osQueried, osErrors, osTotal: osCombos.size,
    appsQueried, appsErrors, appsTotal: appCombos.size,
    appsTotalByPlatform,
    appsRemaining: Math.max(0, osToQuery.length + appsToQueryAll.length - combosToQuery.length),
    cacheEvicted: evicted,
    forced: force,
    refreshedAt: new Date().toISOString(),
  };
  await prisma.mispConfig.update({
    where: { workspaceSlug },
    data: {
      lastRefreshAt: new Date(),
      lastRefreshError: osErrors === 0 && appsErrors === 0 ? null : `${osErrors} OS + ${appsErrors} app quer${osErrors + appsErrors === 1 ? "y" : "ies"} failed`,
      lastRefreshStats: stats as any,
    },
  });
  return stats;
}

/** POST /api/misp/refresh — always forces, same rationale as refreshVulnServiceNow. */
export async function refreshMispNow(workspaceSlug: string, authorization: string) {
  const cfg = await loadConfigRow(workspaceSlug);
  if (!cfg?.enabled || !cfg.baseUrl || !cfg.apiKeyEncrypted) throw new HttpError(400, "MISP isn't configured/enabled for this workspace yet.");
  return refreshMispForWorkspace(workspaceSlug, authorization, true);
}

/** Scheduled tick — same Automation Credential pattern as runVulnServiceRefresherTick. */
export async function runMispRefresherTick(): Promise<void> {
  const { listAutomationWorkspaces, getAutomationBearer } = await import("../settings/automationCredential.service");
  for (const workspaceSlug of await listAutomationWorkspaces()) {
    const cfg = await loadConfigRow(workspaceSlug);
    if (!cfg?.enabled || !cfg.baseUrl || !cfg.apiKeyEncrypted) continue;
    if (cfg.lastRefreshAt) {
      const elapsedMs = Date.now() - cfg.lastRefreshAt.getTime();
      if (elapsedMs < clampRefreshHours(cfg.refreshIntervalHours) * 3600 * 1000) continue;
    }
    const bearer = await getAutomationBearer(workspaceSlug);
    if (!bearer) continue;
    try {
      const stats = await refreshMispForWorkspace(workspaceSlug, bearer);
      console.log(`[MISP] ${workspaceSlug}: ${JSON.stringify(stats)}`);
    } catch (e) {
      console.warn(`[MISP Refresher] ${workspaceSlug} failed: ${e}`);
    }
  }
}

// ── Cache reads for vulnService.ts's merge (kept here so mispVulnCache
// stays this module's own concern — vulnService.ts only ever gets back
// already-shaped {mapped, cve_list} results, never touches the table). ──

export async function isMispEnabled(workspaceSlug: string): Promise<boolean> {
  const cfg = await loadConfigRow(workspaceSlug);
  return Boolean(cfg?.enabled);
}

export async function getMispCacheRow(workspaceSlug: string, key: string) {
  return prisma.mispVulnCache.findUnique({ where: { workspaceSlug_key: { workspaceSlug, key } } });
}

export async function getMispCacheRows(workspaceSlug: string, keys: string[]) {
  if (!keys.length) return [];
  return prisma.mispVulnCache.findMany({ where: { workspaceSlug, key: { in: keys } } });
}

export function isMispCacheFresh(cachedAt: Date | undefined | null): boolean {
  return Boolean(cachedAt) && Date.now() - cachedAt!.getTime() < CACHE_TTL_MS;
}

/** Registered with vulnSources.ts's generic plugin loop — see that file's doc comment. */
export const mispVulnSourcePlugin: import("./vulnSources").VulnSourcePlugin = {
  name: "misp",
  isEnabled: isMispEnabled,
  getCacheRow: async (workspaceSlug, key) => {
    const row = await getMispCacheRow(workspaceSlug, key);
    return row ? { key, result: row.result, cachedAt: row.cachedAt } : null;
  },
  getCacheRows: async (workspaceSlug, keys) => {
    const rows: Awaited<ReturnType<typeof getMispCacheRows>> = await getMispCacheRows(workspaceSlug, keys);
    return rows.map((r) => ({ key: r.key, result: r.result, cachedAt: r.cachedAt }));
  },
  isCacheFresh: isMispCacheFresh,
};
