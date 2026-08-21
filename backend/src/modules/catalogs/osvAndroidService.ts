import axios from "axios";
import AdmZip from "adm-zip";
import { prisma } from "../../services/prisma";
import { HttpError } from "../../utils/httpError";
import { PLATFORM_MAP } from "./platformMap";
import type { VulnSourcePlugin } from "./vulnSources";

/**
 * OSV.dev "Android" ecosystem connector — fourth CVE source (after the
 * Vulnerability Service Worker, MISP, and VulnCheck), merged into the same
 * aggregate via vulnSources.ts's plugin registry. This is Google's own
 * Android Security Bulletin (ASB) in structured, machine-readable form —
 * confirmed live (not assumed): OSV.dev's "Android" ecosystem entries
 * (IDs like "ASB-A-405392600") carry the real CVE ID in their `aliases`
 * array, an AOSP component path as the affected "package" (e.g.
 * "platform/frameworks/base"), a `severity` string per Google's own
 * Critical/High/Moderate/Low bulletin categories, and — critically — an
 * `ecosystem_specific.spl` field: the exact Security Patch Level date
 * (e.g. "2026-06-01") a device needs to have applied to be patched.
 *
 * Unlike MISP/VulnCheck, this isn't a per-combo API connector: there's no
 * per-device/per-app query to make. The whole ecosystem is fetched as one
 * bulk ZIP dump per refresh (OSV's own documented bulk-consumption
 * mechanism — a one-off per-ID query loop would mean thousands of requests
 * for ~3,400 entries, and OSV explicitly asks integrators to prefer the
 * ZIP for full-ecosystem consumption), then re-indexed by Android major
 * version. Free, public, no auth — so unlike every other connector here,
 * there's no API key/secret field on OsvAndroidConfig at all, and
 * refreshing needs no Automation Credential/bearer (same "reads reference
 * data, not fleet data" shape as binaryIntegrityService.ts).
 *
 * KNOWN LIMITATION (see docs/settings.md#android-security-bulletin-osvdev):
 * this app does not currently capture a device's exact Security Patch
 * Level — only its Android major version (device.osVersion, e.g. "15") —
 * so matching is necessarily coarse: a device on last month's SPL and one
 * on this month's SPL of the same major version report identically. Every
 * CVE ever disclosed against a device's major version is surfaced,
 * regardless of whether that specific device has since patched. This is a
 * deliberate "assume unpatched unless proven otherwise" bias — safer than
 * silently under-reporting — but it does mean this source is much noisier
 * than MISP/VulnCheck's per-version CPE matches, hence being opt-in with
 * its own toggle like every other source here, not defaulted on.
 */

const CACHE_TTL_MS = 24 * 3600 * 1000;
export const OSV_ANDROID_TICK_MS = 3_600_000;

const OSV_ANDROID_ZIP_URL = "https://osv-vulnerabilities.storage.googleapis.com/Android/all.zip";
const CVE_ID_RE = /^CVE-\d{4}-\d{4,}$/i;

export interface OsvAndroidConfigPublic {
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
  return Math.max(1, Math.min(h, 168)); // up to weekly — ASB itself only publishes monthly
}

async function loadConfigRow(workspaceSlug: string) {
  return prisma.osvAndroidConfig.findUnique({ where: { workspaceSlug } });
}

function toPublic(row: Awaited<ReturnType<typeof loadConfigRow>>, workspaceSlug: string): OsvAndroidConfigPublic {
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

export async function getOsvAndroidConfig(workspaceSlug: string): Promise<OsvAndroidConfigPublic> {
  return toPublic(await loadConfigRow(workspaceSlug), workspaceSlug);
}

export async function updateOsvAndroidConfig(
  workspaceSlug: string,
  payload: { enabled: boolean; refreshIntervalHours: number },
  actorEmail: string,
): Promise<OsvAndroidConfigPublic> {
  const data = { enabled: payload.enabled, refreshIntervalHours: clampRefreshHours(payload.refreshIntervalHours) };
  const row = await prisma.osvAndroidConfig.upsert({ where: { workspaceSlug }, create: { workspaceSlug, ...data }, update: data });
  const { recordAuditEvent } = await import("../../services/auditLog");
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "osv_android_config_updated",
    actor: actorEmail,
    message: `Android Security Bulletin (OSV.dev) connector ${payload.enabled ? "enabled" : "disabled"} by ${actorEmail}`,
  });
  return toPublic(row, workspaceSlug);
}

/** POST /api/osv-android/test — no credential to validate, just confirms this server can actually reach the GCS bucket the refresh depends on (useful for firewalled/on-prem deployments). */
export async function testOsvAndroidConnection() {
  const started = Date.now();
  let res;
  try {
    res = await axios.head(OSV_ANDROID_ZIP_URL, { timeout: 15000, validateStatus: () => true });
  } catch (e) {
    throw new HttpError(502, `Could not reach ${OSV_ANDROID_ZIP_URL}: ${e}`);
  }
  const latencyMs = Date.now() - started;
  if (res.status !== 200) throw new HttpError(502, `OSV.dev's Android bulk dump responded with HTTP ${res.status}.`);
  const sizeBytes = Number(res.headers["content-length"] ?? 0) || null;
  return { status: "ok", latencyMs, sizeBytes };
}

function mapSeverity(raw: unknown): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "CRITICAL") return "CRITICAL";
  if (s === "HIGH") return "HIGH";
  if (s === "MODERATE" || s === "MEDIUM") return "MEDIUM"; // Google's bulletin says "Moderate"; our vocabulary says "MEDIUM"
  if (s === "LOW") return "LOW";
  return null;
}

interface OsvAndroidEntry {
  id: string;
  aliases?: string[];
  affected?: Array<{
    package?: { name?: string; ecosystem?: string };
    versions?: string[];
    ecosystem_specific?: { severity?: string; spl?: string };
  }>;
}

/** Accumulates every (majorVersion, CVE) pair seen across the whole dataset, keeping the entry with the latest SPL when the same CVE appears more than once for the same version (rare, but a later ASB revision should win). */
function indexByMajorVersion(entries: OsvAndroidEntry[]): Map<string, Map<string, Record<string, any>>> {
  const byVersion = new Map<string, Map<string, Record<string, any>>>();
  for (const entry of entries) {
    const cveId = (entry.aliases ?? []).find((a) => CVE_ID_RE.test(a))?.toUpperCase();
    if (!cveId) continue; // ASB entries without a mapped CVE alias aren't useful here — vulnLink(c.id) expects a real CVE id.
    for (const affected of entry.affected ?? []) {
      if (affected.package?.ecosystem !== "Android") continue;
      const severity = mapSeverity(affected.ecosystem_specific?.severity);
      const spl = affected.ecosystem_specific?.spl ?? null;
      for (const version of affected.versions ?? []) {
        // Android major-version strings look like "15", "16-qpr2", "17-next"
        // — this app's device.osVersion only ever carries the bare major
        // number (osvAndroidService.ts's own doc comment / devices research
        // confirms Applivery reports Android osVersion without a build
        // suffix), so QPR/next-prerelease variants are folded into their
        // base major version rather than kept as distinct keys nothing
        // would ever match.
        const majorVersion = version.split("-")[0];
        if (!majorVersion) continue;
        let byId = byVersion.get(majorVersion);
        if (!byId) byVersion.set(majorVersion, (byId = new Map()));
        const existing = byId.get(cveId);
        if (!existing || (spl && (!existing.fixed_in || spl > existing.fixed_in))) {
          byId.set(cveId, {
            id: cveId, severity, epss_score: null, is_kev: false, score: null,
            fixed_in: spl, source: "osv-android", asb_id: entry.id,
          });
        }
      }
    }
  }
  return byVersion;
}

/** Downloads + parses the full Android/all.zip bulk dump (OSV's documented bulk-consumption mechanism), one JSON file per vuln entry. */
async function fetchOsvAndroidEntries(): Promise<OsvAndroidEntry[]> {
  const res = await axios.get(OSV_ANDROID_ZIP_URL, { responseType: "arraybuffer", timeout: 120000, validateStatus: () => true });
  if (res.status !== 200) throw new Error(`OSV.dev Android bulk dump returned HTTP ${res.status}`);
  const zip = new AdmZip(Buffer.from(res.data));
  const entries: OsvAndroidEntry[] = [];
  for (const zipEntry of zip.getEntries()) {
    if (zipEntry.isDirectory || !zipEntry.entryName.endsWith(".json")) continue;
    try {
      entries.push(JSON.parse(zipEntry.getData().toString("utf8")));
    } catch {
      // A single malformed entry shouldn't sink the whole refresh.
    }
  }
  return entries;
}

export async function refreshOsvAndroidForWorkspace(workspaceSlug: string, force = false): Promise<Record<string, any>> {
  const cfgRow = await loadConfigRow(workspaceSlug);
  if (!cfgRow?.enabled) throw new HttpError(400, "The Android Security Bulletin (OSV.dev) connector isn't enabled for this workspace yet.");

  if (!force) {
    const fresh = cfgRow.lastRefreshAt && Date.now() - cfgRow.lastRefreshAt.getTime() < CACHE_TTL_MS;
    if (fresh) return (cfgRow.lastRefreshStats as Record<string, any>) ?? { skipped: "cache still fresh" };
  }

  let entries: OsvAndroidEntry[];
  try {
    entries = await fetchOsvAndroidEntries();
  } catch (e) {
    await prisma.osvAndroidConfig.update({ where: { workspaceSlug }, data: { lastRefreshAt: new Date(), lastRefreshError: String(e) } });
    throw e;
  }

  const byVersion = indexByMajorVersion(entries);

  const workerPlatform = PLATFORM_MAP.android; // "android"
  let cvesIndexed = 0;
  for (const [majorVersion, byId] of byVersion) {
    const cveList = Array.from(byId.values());
    cvesIndexed += cveList.length;
    const key = `${workerPlatform}|${majorVersion}`;
    const result = { mapped: cveList.length > 0, cve_list: cveList };
    await prisma.osvAndroidCache.upsert({
      where: { workspaceSlug_key: { workspaceSlug, key } },
      create: { workspaceSlug, key, result },
      update: { result, cachedAt: new Date() },
    });
  }

  // Evict any cached major version no longer present in the current dump
  // (e.g. a QPR-only key that folded into its base version above, or an ASB
  // revision that dropped a version entirely).
  const currentKeys = new Set(Array.from(byVersion.keys()).map((v) => `${workerPlatform}|${v}`));
  const cacheRows = await prisma.osvAndroidCache.findMany({ where: { workspaceSlug } });
  let evicted = 0;
  for (const row of cacheRows) {
    if (!currentKeys.has(row.key)) {
      await prisma.osvAndroidCache.delete({ where: { id: row.id } });
      evicted += 1;
    }
  }

  const stats = {
    entriesParsed: entries.length,
    androidVersionsIndexed: byVersion.size,
    cvesIndexed,
    cacheEvicted: evicted,
    forced: force,
    refreshedAt: new Date().toISOString(),
  };
  await prisma.osvAndroidConfig.update({ where: { workspaceSlug }, data: { lastRefreshAt: new Date(), lastRefreshError: null, lastRefreshStats: stats as any } });
  return stats;
}

export async function refreshOsvAndroidNow(workspaceSlug: string) {
  return refreshOsvAndroidForWorkspace(workspaceSlug, true);
}

/** Scheduled tick — no Automation Credential needed (see this module's doc comment), just the connector being enabled and the interval having elapsed. */
export async function runOsvAndroidRefresherTick(): Promise<void> {
  const configs = await prisma.osvAndroidConfig.findMany({ where: { enabled: true } });
  for (const cfg of configs) {
    if (cfg.lastRefreshAt) {
      const elapsedMs = Date.now() - cfg.lastRefreshAt.getTime();
      if (elapsedMs < clampRefreshHours(cfg.refreshIntervalHours) * 3600 * 1000) continue;
    }
    try {
      const stats = await refreshOsvAndroidForWorkspace(cfg.workspaceSlug, true);
      console.log(`[OSV Android] ${cfg.workspaceSlug}: ${JSON.stringify(stats)}`);
    } catch (e) {
      console.warn(`[OSV Android Refresher] ${cfg.workspaceSlug} failed: ${e}`);
    }
  }
}

export async function isOsvAndroidEnabled(workspaceSlug: string): Promise<boolean> {
  const cfg = await loadConfigRow(workspaceSlug);
  return Boolean(cfg?.enabled);
}

export async function getOsvAndroidCacheRow(workspaceSlug: string, key: string) {
  return prisma.osvAndroidCache.findUnique({ where: { workspaceSlug_key: { workspaceSlug, key } } });
}

export async function getOsvAndroidCacheRows(workspaceSlug: string, keys: string[]) {
  if (!keys.length) return [];
  return prisma.osvAndroidCache.findMany({ where: { workspaceSlug, key: { in: keys } } });
}

export function isOsvAndroidCacheFresh(cachedAt: Date | undefined | null): boolean {
  // Rows are only ever refreshed all-at-once from a single bulk dump (see
  // refreshOsvAndroidForWorkspace), so freshness here really just reflects
  // whether the last connector-wide refresh happened within the TTL — a
  // generous window is fine since ASB itself only publishes monthly.
  return Boolean(cachedAt) && Date.now() - cachedAt!.getTime() < CACHE_TTL_MS;
}

/** Registered with vulnSources.ts's generic plugin loop — see that file's doc comment. */
export const osvAndroidVulnSourcePlugin: VulnSourcePlugin = {
  name: "osv-android",
  isEnabled: isOsvAndroidEnabled,
  getCacheRow: async (workspaceSlug, key) => {
    const row = await getOsvAndroidCacheRow(workspaceSlug, key);
    return row ? { key, result: row.result, cachedAt: row.cachedAt } : null;
  },
  getCacheRows: async (workspaceSlug, keys) => {
    const rows: Awaited<ReturnType<typeof getOsvAndroidCacheRows>> = await getOsvAndroidCacheRows(workspaceSlug, keys);
    return rows.map((r) => ({ key: r.key, result: r.result, cachedAt: r.cachedAt }));
  },
  isCacheFresh: isOsvAndroidCacheFresh,
};
