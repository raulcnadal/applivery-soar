/**
 * Generic "additional vuln source" plugin registry + merge logic — the
 * normalization layer the user asked for when adding a third CVE source
 * (VulnCheck, after the Worker-based Vulnerability Service and MISP): every
 * source that isn't the primary Vulnerability Service Worker registers here
 * as a VulnSourcePlugin, and vulnService.ts's three read functions
 * (computeVulnServiceStatus / computeReportedAppsVulnSummaries /
 * computeDeviceAppsDetail) loop over ALL registered plugins uniformly
 * instead of each source needing its own hand-copied plumbing bolted onto
 * those three functions. Adding a 4th source (Android via OSV.dev, now
 * registered below) or a 5th (Apple via SOFA) means writing one plugin
 * object here, not touching vulnService.ts's read functions again.
 *
 * Every source — the Worker, MISP, VulnCheck, OSV.dev Android, and any
 * future one — writes its per-combo cache rows in the SAME normalized
 * shape:
 *   { mapped: boolean, cve_list: Array<{ id, severity, epss_score, is_kev,
 *     score, fixed_in, source, ... source-specific extra fields }> }
 * keyed by the SAME `${identifier}|${version}|${platform}` scheme (see
 * platformMap.ts). That shared shape/key scheme is what makes merging
 * "just union the cve_list arrays, dedupe by id" instead of a bespoke
 * translation per source pair.
 */

export interface VulnSourceCacheRow {
  key: string;
  result: unknown;
  cachedAt: Date;
}

export interface VulnSourcePlugin {
  /** Short id used in stats/logging — e.g. "misp", "vulncheck". */
  name: string;
  isEnabled(workspaceSlug: string): Promise<boolean>;
  getCacheRow(workspaceSlug: string, key: string): Promise<VulnSourceCacheRow | null>;
  getCacheRows(workspaceSlug: string, keys: string[]): Promise<VulnSourceCacheRow[]>;
  isCacheFresh(cachedAt: Date | undefined | null): boolean;
}

// Populated lazily via dynamic import (registerVulnSourcePlugins) rather
// than static imports at module load, so this file — imported by
// vulnService.ts — never has to import misp/vulncheck service modules
// directly at the top level (avoids the same class of circular-import
// problem platformMap.ts was split out to solve for MISP alone; with N
// sources doing static top-level imports of each other, a cycle is far
// more likely).
let plugins: VulnSourcePlugin[] | null = null;

async function loadPlugins(): Promise<VulnSourcePlugin[]> {
  if (plugins) return plugins;
  const { mispVulnSourcePlugin } = await import("./mispService");
  const { vulncheckVulnSourcePlugin } = await import("./vulncheckService");
  const { osvAndroidVulnSourcePlugin } = await import("./osvAndroidService");
  const { sofaVulnSourcePlugin } = await import("./sofaService");
  plugins = [mispVulnSourcePlugin, vulncheckVulnSourcePlugin, osvAndroidVulnSourcePlugin, sofaVulnSourcePlugin];
  return plugins;
}

/** Which registered plugins are enabled for this workspace right now — computed once per read so callers don't re-check config for every device/app. */
export async function getEnabledVulnSourcePlugins(workspaceSlug: string): Promise<VulnSourcePlugin[]> {
  const all = await loadPlugins();
  const flags = await Promise.all(all.map((p) => p.isEnabled(workspaceSlug)));
  return all.filter((_, i) => flags[i]);
}

/** True if ANY additional source (MISP, VulnCheck, ...) is enabled — used alongside the Worker's own `enabled` flag to decide whether a read is worth doing at all. */
export async function anyVulnSourceEnabled(workspaceSlug: string): Promise<boolean> {
  return (await getEnabledVulnSourcePlugins(workspaceSlug)).length > 0;
}

/**
 * Merges any number of raw `{mapped, cve_list}` results (the Vulnerability
 * Service Worker's own result plus zero or more plugin results) for the
 * SAME (identifier, version, platform) key. CVEs are deduped by id; on a
 * collision, whichever entry already has real CVSS/EPSS data wins over a
 * source that only ever supplies a bare id (e.g. a raw MISP CPE match with
 * no CVSS of its own) — sources are merged in listed order, so pass the
 * richest source (the Worker) LAST if you want it to win ties, which every
 * call site below does.
 */
export function mergeRawVulnResults(...sources: Array<{ mapped?: boolean; cve_list?: Array<Record<string, any>> } | null | undefined>): { mapped: boolean; cve_list: Array<Record<string, any>> } {
  const byId = new Map<string, Record<string, any>>();
  let anyMapped = false;
  for (const source of sources) {
    if (!source?.mapped) continue;
    anyMapped = true;
    for (const c of source.cve_list ?? []) {
      const id = String(c.id ?? c.cve_id ?? "").toUpperCase();
      if (!id) continue;
      const existing = byId.get(id);
      // Prefer whichever entry already carries a real CVSS score — a
      // richer source overwrites a bare-id stub, but a later bare-id
      // source doesn't clobber an earlier richer one.
      if (!existing || (existing.score == null && c.score != null)) byId.set(id, c);
    }
  }
  return { mapped: anyMapped, cve_list: Array.from(byId.values()) };
}

/**
 * The Vulnerability Service Worker's own documented per-CVE `confirmed`
 * field (see its README's cve_list field table): `true` when NVD's affected
 * range for that product/CPE has an upper bound, so the fix version — and
 * therefore whether THIS exact installed version/OS build is still actually
 * exposed — is reliably known. `false` means the product matched but NVD
 * gives no upper bound: "surfaced for manual review, not counted in
 * `counts`" per the Worker's own docs, and explicitly NOT part of the
 * Worker's own severity-count totals for exactly that reason.
 *
 * Found via a real report: every device (all 4 platforms) showed a run of
 * old, clearly-irrelevant CVEs (decade-old Adobe Reader/Flash Player
 * entries on iOS/macOS/Windows/Android devices) — root-caused to this
 * codebase silently discarding the Worker's `confirmed` flag everywhere it
 * consumes `cve_list`: computeVulnServiceStatus counted every entry
 * (confirmed AND uncertain) into its severity totals/hasKev/topCves with no
 * distinction, and separately tried to read a top-level `.uncertain` count
 * off the ALREADY-MERGED `{mapped, cve_list}` result — a shape
 * mergeRawVulnResults above never produces (it only returns those two
 * keys), so that counter was silently stuck at 0 forever. Net effect: every
 * "uncertain — matched the product, no confirmed version-scoped fix"
 * result was displayed as an ordinary, fully-confirmed pending CVE, with no
 * indication whatsoever that NVD couldn't actually confirm it applies to
 * this specific version.
 *
 * Only ever checked against an EXPLICIT `false` — every non-Worker plugin
 * source (MISP/VulnCheck/SOFA/OSV-Android) has no equivalent concept and
 * never sets this field at all, so `undefined`/`true` both count as
 * confirmed for those, which is correct: SOFA/OSV-Android are already
 * precise point-release matches with no "uncertain" state of their own, and
 * MISP/VulnCheck's own version-scoping (see cpeTranslate.ts/mispService.ts)
 * is the closest equivalent they have.
 */
export function isConfirmedCve(c: Record<string, any>): boolean {
  return c.confirmed !== false;
}

function versionTuple(v: string): number[] {
  return v.split(/[.\-_]/).map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

function compareVersionTuples(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** "26.6.2 (25G82)" -> "26.6.2" — the leading dotted-version prefix of an OS Patch Level value, discarding any trailing build parenthetical. Exported for vulnService.ts, which uses it to prefer a fresher/more-precise Apple version (when OS Patch Level is mapped) over device.osVersion for the shared OS cache key every plugin (Worker/MISP/VulnCheck/SOFA) reads. */
export function extractLeadingVersion(raw: string): string | null {
  const m = raw.match(/^([\d]+(?:\.[\d]+)*)/);
  return m ? m[1] : null;
}

/**
 * When a device has a real, precise OS Patch Level value (Settings >
 * Workspace Automation's Smart Attribute mapping —
 * osPatchLevelMapping.service.ts), narrows a merged OS-level CVE list down
 * to only entries THIS exact device hasn't received the fix for yet, using
 * each entry's own `fixed_in` field. Only osvAndroidService.ts (an SPL
 * date) and sofaService.ts (an Apple ProductVersion) ever populate
 * `fixed_in` — every other source (Worker/MISP/VulnCheck) leaves it null,
 * so this is a safe no-op for their entries regardless of platform.
 * No-op entirely when osPatchLevel is null/undefined (no mapping
 * configured, or this device doesn't carry the attribute) — callers keep
 * today's coarser osVersion-only behavior in that case.
 */
export function filterCvesByPatchLevel(cveList: Array<Record<string, any>>, workerPlatform: string, osPatchLevel: string | null | undefined): Array<Record<string, any>> {
  if (!osPatchLevel) return cveList;
  return cveList.filter((c) => {
    const fixedIn = c.fixed_in;
    if (!fixedIn || typeof fixedIn !== "string") return true; // no fixed_in info to compare against — can't rule it out, keep it
    if (workerPlatform === "android") {
      // Both sides are "YYYY-MM-DD" ISO date strings — safe to compare lexicographically.
      return fixedIn > osPatchLevel;
    }
    if (workerPlatform === "macos" || workerPlatform === "ios") {
      const deviceVersion = extractLeadingVersion(osPatchLevel);
      if (!deviceVersion) return true;
      return compareVersionTuples(versionTuple(fixedIn), versionTuple(deviceVersion)) > 0;
    }
    return true; // no comparator defined for this platform/source pairing — keep as-is
  });
}
