import { prisma } from "../../services/prisma";
import { HttpError } from "../../utils/httpError";
import { decryptThreatIntelConfig, lookupVirustotal } from "../threatIntel/threatIntel.service";

/**
 * Binary integrity ("software identity") checking — hashes the fleet's
 * self-reported installed-app executables (Windows .exe / macOS Mach-O
 * binary, see apps_windows.go/apps_macos.go) against VirusTotal's file
 * reputation, to flag sideloaded, tampered, or outright malicious software.
 *
 * Deliberately NOT part of the CVE vulnerability aggregate
 * (vulnService.ts/vulnSources.ts) — a malware/tamper verdict on a specific
 * binary is a different kind of finding than "this app version has known
 * CVEs," and doesn't share that aggregate's cache-key scheme (a hash has no
 * natural identifier/version/platform triple; the same hash can appear
 * under many app identifiers, or — if tampered — the SAME identifier can
 * carry a different hash on different devices, which is exactly the case
 * this exists to catch). Surfaced separately in the Device modal's Apps tab
 * as each app's own `integrity` field, alongside (not merged with) `vuln`.
 *
 * Reuses the workspace's own VirusTotal ThreatIntelProvider (Settings ->
 * Threat Intel) instead of a second, redundant "VirusTotal API key" field —
 * that provider staying in THREAT_INTEL_PROVIDER_TYPES after the AbuseIPDB/
 * HIBP/Generic REST retirement was specifically so this feature could reuse
 * it. No live Applivery session/bearer is needed anywhere in this module —
 * unlike vulnService.ts/mispService.ts/vulncheckService.ts, which need
 * getDevicesFull to enumerate the fleet, the hashes this reads already live
 * in InstalledAppInventory rows written by reportDeviceApps, so refreshes
 * can run as a plain background tick with no Automation Credential either.
 */

const CACHE_TTL_MS = 24 * 3600 * 1000;
const MAX_HASHES_PER_TICK = 300;
const REQUEST_CONCURRENCY = 4; // VirusTotal's free/public tier is tightly rate-limited
export const BINARY_INTEGRITY_TICK_MS = 3_600_000;

export interface AppIntegrityInfo {
  checked: boolean;
  verdict: "clean" | "suspicious" | "malicious" | "unknown" | "error";
  score: number | null;
  detail: string;
  link: string | null;
  checkedAt: string | null;
}

export interface BinaryIntegrityConfigPublic {
  workspaceSlug: string;
  virustotalConfigured: boolean;
  refreshIntervalHours: number;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  lastRefreshStats: Record<string, any> | null;
}

function clampRefreshHours(hours: unknown): number {
  const h = Number(hours);
  if (!Number.isFinite(h)) return 24;
  return Math.max(1, Math.min(h, 72));
}

async function loadConfigRow(workspaceSlug: string) {
  return prisma.binaryIntegrityConfig.findUnique({ where: { workspaceSlug } });
}

/** The workspace's own enabled VirusTotal ThreatIntelProvider — the "is this feature usable" check, since there's no separate enable toggle here. */
async function loadVirustotalProvider(workspaceSlug: string): Promise<{ apiKey: string } | null> {
  const row = await prisma.threatIntelProvider.findFirst({ where: { workspaceSlug, type: "virustotal", enabled: true } });
  if (!row) return null;
  const cfg = decryptThreatIntelConfig("virustotal", (row.config as Record<string, any>) ?? {});
  return cfg.apiKey ? { apiKey: cfg.apiKey } : null;
}

export async function getBinaryIntegrityConfig(workspaceSlug: string): Promise<BinaryIntegrityConfigPublic> {
  const [row, vtProvider] = await Promise.all([loadConfigRow(workspaceSlug), loadVirustotalProvider(workspaceSlug)]);
  return {
    workspaceSlug,
    virustotalConfigured: Boolean(vtProvider),
    refreshIntervalHours: row?.refreshIntervalHours ?? 24,
    lastRefreshAt: row?.lastRefreshAt?.toISOString() ?? null,
    lastRefreshError: row?.lastRefreshError ?? null,
    lastRefreshStats: (row?.lastRefreshStats as Record<string, any>) ?? null,
  };
}

export async function updateBinaryIntegrityConfig(workspaceSlug: string, payload: { refreshIntervalHours: number }): Promise<BinaryIntegrityConfigPublic> {
  const data = { refreshIntervalHours: clampRefreshHours(payload.refreshIntervalHours) };
  await prisma.binaryIntegrityConfig.upsert({ where: { workspaceSlug }, create: { workspaceSlug, ...data }, update: data });
  return getBinaryIntegrityConfig(workspaceSlug);
}

function isFresh(cachedAt: Date | undefined | null): boolean {
  return Boolean(cachedAt) && Date.now() - cachedAt!.getTime() < CACHE_TTL_MS;
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

/** lookupVirustotal throws a plain Error with the HTTP status embedded on any non-200/404 — retries a 429 with backoff, same pattern as vulnService.ts's postWithRetry. */
async function lookupVirustotalWithRetry(apiKey: string, sha256: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await lookupVirustotal({ apiKey }, "sha256", sha256);
    } catch (e) {
      const isRateLimited = e instanceof Error && e.message.includes("429");
      if (!isRateLimited || attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, [2000, 5000][attempt]));
    }
  }
  throw new Error("unreachable");
}

/**
 * Enumerates every distinct SHA256 the fleet's self-reported app inventory
 * currently carries, checks whichever aren't already cached fresh against
 * VirusTotal, and caches the verdicts. `force` bypasses the 24h freshness
 * check, same contract as the CVE-source refreshers.
 */
export async function refreshBinaryIntegrityForWorkspace(workspaceSlug: string, force = false): Promise<Record<string, any>> {
  const vtProvider = await loadVirustotalProvider(workspaceSlug);
  if (!vtProvider) throw new HttpError(400, "No enabled VirusTotal provider found — configure one under Settings > Threat Intel first.");

  const { loadInstalledAppsStore } = await import("../appLists/installedApps.service");
  const store = await loadInstalledAppsStore(workspaceSlug);
  const hashes = new Set<string>();
  for (const record of Object.values(store)) {
    // sha256 is only ever populated on the self-reported slot — the agent's
    // own report, not Applivery's server-fetch path (see
    // installedApps.service.ts's InstalledAppsEntry.apps[].sha256 doc
    // comment) — but reading .apps off whichever slot has it is harmless
    // either way, since server_fetch entries simply never carry the field.
    for (const app of record.selfReported?.apps ?? []) {
      if (app.sha256 && /^[a-f0-9]{64}$/.test(app.sha256)) hashes.add(app.sha256.toLowerCase());
    }
  }

  const cacheRows = await prisma.binaryHashCache.findMany({ where: { workspaceSlug } });
  const cacheByHash = new Map<string, (typeof cacheRows)[number]>(cacheRows.map((r) => [r.sha256, r]));

  let evicted = 0;
  for (const row of cacheRows) {
    if (!hashes.has(row.sha256)) {
      await prisma.binaryHashCache.delete({ where: { id: row.id } });
      evicted += 1;
    }
  }

  const staleOrMissing = Array.from(hashes).filter((h) => !isFresh(cacheByHash.get(h)?.cachedAt) || force);
  const toCheck = staleOrMissing.slice(0, MAX_HASHES_PER_TICK);

  let checked = 0, errors = 0;
  const verdictCounts: Record<string, number> = { clean: 0, suspicious: 0, malicious: 0, unknown: 0, error: 0 };
  await mapWithConcurrency(toCheck, REQUEST_CONCURRENCY, async (sha256) => {
    try {
      const result = await lookupVirustotalWithRetry(vtProvider.apiKey, sha256);
      const info: AppIntegrityInfo = { checked: true, verdict: result.verdict as AppIntegrityInfo["verdict"], score: result.score, detail: result.detail, link: result.link, checkedAt: new Date().toISOString() };
      await prisma.binaryHashCache.upsert({
        where: { workspaceSlug_sha256: { workspaceSlug, sha256 } },
        create: { workspaceSlug, sha256, result: info as any },
        update: { result: info as any, cachedAt: new Date() },
      });
      verdictCounts[info.verdict] = (verdictCounts[info.verdict] ?? 0) + 1;
      checked += 1;
    } catch (e) {
      errors += 1;
      console.warn(`[Binary Integrity] Lookup failed (${sha256}) for ${workspaceSlug}: ${e}`);
    }
  });

  const stats = {
    hashesTracked: hashes.size, checked, errors, verdictCounts,
    remaining: Math.max(0, staleOrMissing.length - toCheck.length),
    cacheEvicted: evicted, forced: force, refreshedAt: new Date().toISOString(),
  };
  await prisma.binaryIntegrityConfig.upsert({
    where: { workspaceSlug },
    create: { workspaceSlug, lastRefreshAt: new Date(), lastRefreshError: errors === 0 ? null : `${errors} lookup(s) failed`, lastRefreshStats: stats as any },
    update: { lastRefreshAt: new Date(), lastRefreshError: errors === 0 ? null : `${errors} lookup(s) failed`, lastRefreshStats: stats as any },
  });
  return stats;
}

export async function refreshBinaryIntegrityNow(workspaceSlug: string) {
  return refreshBinaryIntegrityForWorkspace(workspaceSlug, true);
}

/** Scheduled tick — no Automation Credential needed (see this module's doc comment), just an enabled VirusTotal provider and the interval having elapsed. */
export async function runBinaryIntegrityRefresherTick(): Promise<void> {
  const configs = await prisma.binaryIntegrityConfig.findMany();
  const workspaceSlugs = new Set(configs.map((c) => c.workspaceSlug));
  // Also cover workspaces that have a VirusTotal provider but have never
  // saved a BinaryIntegrityConfig row yet (defaults apply) — same
  // "discover from ThreatIntelProvider, not just from our own config table"
  // gate as getBinaryIntegrityConfig.
  const vtWorkspaces = await prisma.threatIntelProvider.findMany({ where: { type: "virustotal", enabled: true }, select: { workspaceSlug: true }, distinct: ["workspaceSlug"] });
  for (const { workspaceSlug } of vtWorkspaces) workspaceSlugs.add(workspaceSlug);

  for (const workspaceSlug of workspaceSlugs) {
    const cfg = configs.find((c) => c.workspaceSlug === workspaceSlug);
    if (cfg?.lastRefreshAt) {
      const elapsedMs = Date.now() - cfg.lastRefreshAt.getTime();
      if (elapsedMs < clampRefreshHours(cfg.refreshIntervalHours) * 3600 * 1000) continue;
    }
    try {
      const stats = await refreshBinaryIntegrityForWorkspace(workspaceSlug);
      console.log(`[Binary Integrity] ${workspaceSlug}: ${JSON.stringify(stats)}`);
    } catch (e) {
      console.warn(`[Binary Integrity Refresher] ${workspaceSlug} failed: ${e}`);
    }
  }
}

/** Cache-only read for a single hash — used by computeDeviceAppsDetail (vulnService.ts) to attach an `integrity` field to each app row. */
export async function computeAppIntegrityStatus(workspaceSlug: string, sha256: string | null | undefined): Promise<AppIntegrityInfo | null> {
  if (!sha256) return null;
  const row = await prisma.binaryHashCache.findUnique({ where: { workspaceSlug_sha256: { workspaceSlug, sha256: sha256.toLowerCase() } } });
  if (!row || !isFresh(row.cachedAt)) return null;
  return row.result as unknown as AppIntegrityInfo;
}

/**
 * Bulk cache-only read for many hashes at once, keyed by lowercased sha256 —
 * used by the fleet-wide Apps view's reported-apps overview route
 * (appLists.controller.ts) to attach an `integrity` verdict to every
 * device row across every app in one query. computeAppIntegrityStatus above
 * does the equivalent one-hash-at-a-time lookup, which is fine inside
 * computeDeviceAppsDetail (bounded to a single device's own app list) but
 * would be an N+1 query per device row here, across the whole fleet's app
 * catalog — this was missing entirely until the Apps view's App modal had no
 * integrity signal at all (VirusTotal "malicious" flags were only ever
 * visible in the Device modal's Apps tab, per-device).
 */
export async function computeAppIntegrityStatusBulk(workspaceSlug: string, sha256s: Array<string | null | undefined>): Promise<Map<string, AppIntegrityInfo>> {
  const unique = Array.from(new Set(sha256s.filter((h): h is string => Boolean(h)).map((h) => h.toLowerCase())));
  const out = new Map<string, AppIntegrityInfo>();
  if (unique.length === 0) return out;
  const rows = await prisma.binaryHashCache.findMany({ where: { workspaceSlug, sha256: { in: unique } } });
  for (const row of rows) {
    if (!isFresh(row.cachedAt)) continue;
    out.set(row.sha256, row.result as unknown as AppIntegrityInfo);
  }
  return out;
}
