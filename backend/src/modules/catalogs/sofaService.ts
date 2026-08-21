import axios from "axios";
import { prisma } from "../../services/prisma";
import { HttpError } from "../../utils/httpError";
import { versionTuple } from "../compliance/complianceEvaluate";
import type { VulnSourcePlugin } from "./vulnSources";

/**
 * Apple SOFA feed connector (sofa.macadmins.io) — fifth CVE source (after
 * the Vulnerability Service Worker, MISP, VulnCheck, and OSV.dev Android),
 * merged into the same aggregate via vulnSources.ts's plugin registry.
 * SOFA (the macadmins community's "Simple Organized Feed for Apple
 * Software Updates") republishes Apple's own per-release security-content
 * disclosures in structured JSON — confirmed live against both feed URLs
 * the user specified: macOS (v2/macos_data_feed.json) and iOS/iPadOS
 * (v2/ios_data_feed.json). Free, public, no auth.
 *
 * Unlike OSV.dev's Android ecosystem (major-version-only matching — see
 * osvAndroidService.ts's doc comment for why), this connector does PRECISE
 * point-release matching: Applivery's own device.osVersion for Apple
 * platforms is a bare ProductVersion string with no separate build field
 * (confirmed — deviceNormalize.ts has no build-number field anywhere), and
 * that's exactly the same shape SOFA's own `ProductVersion` values use
 * ("26.6.1", "18.5", etc.), so device.osVersion can be joined directly
 * against SOFA's release history with full X.Y.Z precision via the same
 * versionTuple() helper gdmfCatalog.ts/osLifecycleCatalog.ts already use
 * for Apple version comparisons elsewhere in this codebase.
 *
 * Each SOFA "OSVersion" entry (e.g. "Tahoe 26", "Sequoia 15") is a single
 * support track: a `Latest` release plus a `SecurityReleases[]` history of
 * every prior point release in that track, each listing the CVEs IT fixed
 * (not CVEs present in it) and, for a subset of high-value entries, a
 * per-CVE `{NISTURL, ActivelyExploited, InKEV, Severity}` detail object
 * (most entries are bare `{}` — SOFA doesn't uniformly enrich every CVE).
 * For a device sitting on release R, "CVEs this device is still exposed
 * to" = the union of every CVE fixed by a chronologically LATER release in
 * the SAME track — R's own release already includes R's own fixes, so
 * only what comes after R is still outstanding. This is computed once per
 * refresh for every ProductVersion SOFA has ever published (a few dozen
 * per platform, not per-device) and cached as one row per
 * `${platform}|${ProductVersion}` key — same "bulk reference data, no
 * Automation Credential needed" shape as osvAndroidService.ts.
 */

const CACHE_TTL_MS = 24 * 3600 * 1000;
export const SOFA_TICK_MS = 3_600_000;

const SOFA_MACOS_URL = "https://sofa.macadmins.io/v2/macos_data_feed.json";
const SOFA_IOS_URL = "https://sofa.macadmins.io/v2/ios_data_feed.json";

export interface SofaConfigPublic {
  workspaceSlug: string;
  enabled: boolean;
  refreshIntervalHours: number;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  lastRefreshStats: Record<string, any> | null;
}

function clampRefreshHours(hours: unknown): number {
  const h = Number(hours);
  if (!Number.isFinite(h)) return 24;
  return Math.max(1, Math.min(h, 168));
}

async function loadConfigRow(workspaceSlug: string) {
  return prisma.sofaConfig.findUnique({ where: { workspaceSlug } });
}

function toPublic(row: Awaited<ReturnType<typeof loadConfigRow>>, workspaceSlug: string): SofaConfigPublic {
  if (!row) {
    return { workspaceSlug, enabled: false, refreshIntervalHours: 24, lastRefreshAt: null, lastRefreshError: null, lastRefreshStats: null };
  }
  return {
    workspaceSlug,
    enabled: row.enabled,
    refreshIntervalHours: row.refreshIntervalHours,
    lastRefreshAt: row.lastRefreshAt?.toISOString() ?? null,
    lastRefreshError: row.lastRefreshError ?? null,
    lastRefreshStats: (row.lastRefreshStats as Record<string, any>) ?? null,
  };
}

export async function getSofaConfig(workspaceSlug: string): Promise<SofaConfigPublic> {
  return toPublic(await loadConfigRow(workspaceSlug), workspaceSlug);
}

export async function updateSofaConfig(
  workspaceSlug: string,
  payload: { enabled: boolean; refreshIntervalHours: number },
  actorEmail: string,
): Promise<SofaConfigPublic> {
  const data = { enabled: payload.enabled, refreshIntervalHours: clampRefreshHours(payload.refreshIntervalHours) };
  const row = await prisma.sofaConfig.upsert({ where: { workspaceSlug }, create: { workspaceSlug, ...data }, update: data });
  const { recordAuditEvent } = await import("../../services/auditLog");
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "sofa_config_updated",
    actor: actorEmail,
    message: `Apple Security Releases (SOFA) connector ${payload.enabled ? "enabled" : "disabled"} by ${actorEmail}`,
  });
  return toPublic(row, workspaceSlug);
}

/** POST /api/sofa/test — no credential to validate, just confirms this server can reach both SOFA feed URLs (useful for firewalled/on-prem deployments). */
export async function testSofaConnection() {
  const started = Date.now();
  const results = await Promise.all(
    [SOFA_MACOS_URL, SOFA_IOS_URL].map(async (url) => {
      try {
        const res = await axios.head(url, { timeout: 15000, validateStatus: () => true });
        return { url, status: res.status };
      } catch (e) {
        return { url, status: null, error: String(e) };
      }
    }),
  );
  const latencyMs = Date.now() - started;
  const failed = results.filter((r) => r.status !== 200);
  if (failed.length) throw new HttpError(502, `Could not reach: ${failed.map((f) => `${f.url} (${f.error ?? `HTTP ${f.status}`})`).join(", ")}`);
  return { status: "ok", latencyMs };
}

function mapSeverity(raw: unknown): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "CRITICAL") return "CRITICAL";
  if (s === "HIGH") return "HIGH";
  if (s === "MODERATE" || s === "MEDIUM") return "MEDIUM";
  if (s === "LOW") return "LOW";
  return null;
}

interface SofaCveDetail {
  NISTURL?: string;
  ActivelyExploited?: boolean;
  InKEV?: boolean;
  Severity?: string;
}

interface SofaRelease {
  UpdateName?: string;
  ProductVersion: string;
  ReleaseDate: string;
  SecurityInfo?: string;
  CVEs?: Record<string, SofaCveDetail>;
  ActivelyExploitedCVEs?: string[];
}

interface SofaOSVersionTrack {
  OSVersion: string;
  Latest?: SofaRelease;
  SecurityReleases?: SofaRelease[];
}

interface SofaFeed {
  OSVersions: SofaOSVersionTrack[];
}

function cmpTuples(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** For one OS track, builds a Map<ProductVersion, cve_list> — every entry represents "the CVEs a device on this exact ProductVersion is still exposed to" (everything fixed by a chronologically later release in this same track). */
function computeOutstandingByVersion(track: SofaOSVersionTrack): Map<string, Array<Record<string, any>>> {
  const byVersion = new Map<string, SofaRelease>();
  for (const r of [track.Latest, ...(track.SecurityReleases ?? [])]) {
    if (r?.ProductVersion && !byVersion.has(r.ProductVersion)) byVersion.set(r.ProductVersion, r);
  }
  const releases = Array.from(byVersion.values())
    .filter((r) => r.ReleaseDate)
    .sort((a, b) => new Date(a.ReleaseDate).getTime() - new Date(b.ReleaseDate).getTime());

  const out = new Map<string, Array<Record<string, any>>>();
  for (let i = 0; i < releases.length; i++) {
    const current = releases[i];
    const seen = new Map<string, Record<string, any>>();
    for (let j = i + 1; j < releases.length; j++) {
      const later = releases[j];
      const exploitedSet = new Set(later.ActivelyExploitedCVEs ?? []);
      for (const [cveId, detail] of Object.entries(later.CVEs ?? {})) {
        const id = cveId.toUpperCase();
        if (seen.has(id)) continue; // earliest fixing release wins — already the case since we iterate ascending
        seen.set(id, {
          id,
          severity: mapSeverity(detail?.Severity),
          epss_score: null,
          is_kev: Boolean(detail?.InKEV) || Boolean(detail?.ActivelyExploited) || exploitedSet.has(cveId),
          score: null,
          fixed_in: later.ProductVersion,
          source: "sofa",
          release_name: later.UpdateName ?? null,
          security_info: later.SecurityInfo ?? null,
        });
      }
    }
    out.set(current.ProductVersion, Array.from(seen.values()));
  }
  return out;
}

async function fetchSofaFeed(url: string): Promise<SofaFeed> {
  const res = await axios.get(url, { timeout: 60000, validateStatus: () => true, headers: { Accept: "application/json" } });
  if (res.status !== 200) throw new Error(`SOFA feed ${url} returned HTTP ${res.status}`);
  const data = res.data;
  if (!data || !Array.isArray(data.OSVersions)) throw new Error(`SOFA feed ${url} had an unexpected shape (no OSVersions array)`);
  return data as SofaFeed;
}

export async function refreshSofaForWorkspace(workspaceSlug: string, force = false): Promise<Record<string, any>> {
  const cfgRow = await loadConfigRow(workspaceSlug);
  if (!cfgRow?.enabled) throw new HttpError(400, "The Apple Security Releases (SOFA) connector isn't enabled for this workspace yet.");

  if (!force) {
    const fresh = cfgRow.lastRefreshAt && Date.now() - cfgRow.lastRefreshAt.getTime() < CACHE_TTL_MS;
    if (fresh) return (cfgRow.lastRefreshStats as Record<string, any>) ?? { skipped: "cache still fresh" };
  }

  let macosFeed: SofaFeed, iosFeed: SofaFeed;
  try {
    [macosFeed, iosFeed] = await Promise.all([fetchSofaFeed(SOFA_MACOS_URL), fetchSofaFeed(SOFA_IOS_URL)]);
  } catch (e) {
    await prisma.sofaConfig.update({ where: { workspaceSlug }, data: { lastRefreshAt: new Date(), lastRefreshError: String(e) } });
    throw e;
  }

  const currentKeys = new Set<string>();
  let tracksProcessed = 0, versionsIndexed = 0, cvesIndexed = 0;

  for (const [platform, feed] of [["macos", macosFeed], ["ios", iosFeed]] as const) {
    for (const track of feed.OSVersions ?? []) {
      tracksProcessed += 1;
      const byVersion = computeOutstandingByVersion(track);
      for (const [productVersion, cveList] of byVersion) {
        versionsIndexed += 1;
        cvesIndexed += cveList.length;
        const key = `${platform}|${productVersion}`;
        currentKeys.add(key);
        const result = { mapped: true, cve_list: cveList };
        await prisma.sofaCache.upsert({
          where: { workspaceSlug_key: { workspaceSlug, key } },
          create: { workspaceSlug, key, result },
          update: { result, cachedAt: new Date() },
        });
      }
    }
  }

  const cacheRows = await prisma.sofaCache.findMany({ where: { workspaceSlug } });
  let evicted = 0;
  for (const row of cacheRows) {
    if (!currentKeys.has(row.key)) {
      await prisma.sofaCache.delete({ where: { id: row.id } });
      evicted += 1;
    }
  }

  const stats = {
    tracksProcessed, versionsIndexed, cvesIndexed,
    cacheEvicted: evicted,
    forced: force,
    refreshedAt: new Date().toISOString(),
  };
  await prisma.sofaConfig.update({ where: { workspaceSlug }, data: { lastRefreshAt: new Date(), lastRefreshError: null, lastRefreshStats: stats as any } });
  return stats;
}

export async function refreshSofaNow(workspaceSlug: string) {
  return refreshSofaForWorkspace(workspaceSlug, true);
}

/** Scheduled tick — no Automation Credential needed (bulk reference-data fetch, same as osvAndroidService.ts), just the connector being enabled and the interval having elapsed. */
export async function runSofaRefresherTick(): Promise<void> {
  const configs = await prisma.sofaConfig.findMany({ where: { enabled: true } });
  for (const cfg of configs) {
    if (cfg.lastRefreshAt) {
      const elapsedMs = Date.now() - cfg.lastRefreshAt.getTime();
      if (elapsedMs < clampRefreshHours(cfg.refreshIntervalHours) * 3600 * 1000) continue;
    }
    try {
      const stats = await refreshSofaForWorkspace(cfg.workspaceSlug, true);
      console.log(`[SOFA] ${cfg.workspaceSlug}: ${JSON.stringify(stats)}`);
    } catch (e) {
      console.warn(`[SOFA Refresher] ${cfg.workspaceSlug} failed: ${e}`);
    }
  }
}

export async function isSofaEnabled(workspaceSlug: string): Promise<boolean> {
  const cfg = await loadConfigRow(workspaceSlug);
  return Boolean(cfg?.enabled);
}

export async function getSofaCacheRow(workspaceSlug: string, key: string) {
  const exact = await prisma.sofaCache.findUnique({ where: { workspaceSlug_key: { workspaceSlug, key } } });
  if (exact) return exact;
  // Fallback: a device's exact ProductVersion (e.g. a very recent point
  // release, or a beta build) may not yet appear as its own history entry
  // in SOFA — fall back to the nearest OLDER indexed version on the same
  // platform, since "everything fixed after the nearest known older
  // release" is still a materially useful (if very slightly stale) answer,
  // rather than silently reporting nothing at all for a device one point
  // release ahead of what SOFA has indexed so far.
  const [platform, versionStr] = key.split("|");
  if (!platform || !versionStr) return null;
  const candidates = await prisma.sofaCache.findMany({ where: { workspaceSlug, key: { startsWith: `${platform}|` } } });
  const deviceTuple = versionTuple(versionStr);
  let best: (typeof candidates)[number] | null = null;
  let bestTuple: number[] | null = null;
  for (const c of candidates) {
    const cVersion = c.key.slice(platform.length + 1);
    const cTuple = versionTuple(cVersion);
    if (cmpTuples(cTuple, deviceTuple) > 0) continue; // only consider versions at or below the device's own
    if (!bestTuple || cmpTuples(cTuple, bestTuple) > 0) {
      best = c;
      bestTuple = cTuple;
    }
  }
  return best;
}

/**
 * Batch form of getSofaCacheRow. IMPORTANT: a fallback hit (nearest older
 * indexed version) comes back from Prisma with its OWN `.key` field (e.g.
 * "macos|26.6"), not the key that was actually requested (e.g.
 * "macos|26.6.1") — but vulnService.ts's batch callers index this
 * function's results by `.key` to look them back up by the REQUESTED key
 * (see computeReportedAppsVulnSummaries's `pluginRowByKeyMaps`), so every
 * returned row here is re-tagged with the requested key it's answering
 * for, not the underlying cache row's own key.
 */
export async function getSofaCacheRows(workspaceSlug: string, keys: string[]) {
  if (!keys.length) return [];
  const pairs = await Promise.all(keys.map(async (key) => [key, await getSofaCacheRow(workspaceSlug, key)] as const));
  return pairs
    .filter((p): p is [string, NonNullable<(typeof p)[1]>] => Boolean(p[1]))
    .map(([requestedKey, row]) => ({ ...row, key: requestedKey }));
}

export function isSofaCacheFresh(cachedAt: Date | undefined | null): boolean {
  return Boolean(cachedAt) && Date.now() - cachedAt!.getTime() < CACHE_TTL_MS;
}

/** Registered with vulnSources.ts's generic plugin loop — see that file's doc comment. */
export const sofaVulnSourcePlugin: VulnSourcePlugin = {
  name: "sofa",
  isEnabled: isSofaEnabled,
  getCacheRow: async (workspaceSlug, key) => {
    const row = await getSofaCacheRow(workspaceSlug, key);
    return row ? { key, result: row.result, cachedAt: row.cachedAt } : null;
  },
  getCacheRows: async (workspaceSlug, keys) => {
    const rows = await getSofaCacheRows(workspaceSlug, keys);
    return rows.map((r) => ({ key: r.key, result: r.result, cachedAt: r.cachedAt }));
  },
  isCacheFresh: isSofaCacheFresh,
};
