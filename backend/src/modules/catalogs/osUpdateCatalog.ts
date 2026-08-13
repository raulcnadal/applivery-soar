import axios from "axios";
import { loadGlobalCatalog, saveGlobalCatalog } from "../../services/globalCatalog";
import { versionTuple } from "../compliance/complianceEvaluate";

/**
 * OS Update Intelligence (Windows) — port of main.py:16161-16521. Rolling
 * catalog of Microsoft's monthly Windows security updates (MSRC's public
 * CVRF API, free/no key) matched against a device's reported osVersion.
 * Global, not per-workspace — Microsoft's public data, not tenant-specific.
 */

const MONTHS_BACK = 15;
export const OS_UPDATE_TICK_MS = 86_400_000; // daily

/**
 * Bump whenever WINDOWS_BUILD_TO_FEATURE/WINDOWS_PRODUCT_KEYWORDS gains a
 * new build major. `kbEntries` only ever stores rows `matchWindowsBuildMajor`
 * recognized *at fetch time* — a month fetched before a given build major
 * was added to those maps silently dropped every row for it (see the
 * `buildMajor === null` skip in fetchMsrcMonth's parse loop) and that raw
 * data is gone; the rolled-up KB entries are all `refreshOsUpdateCatalog`
 * keeps. The incremental refresh below only ever re-fetches the 2 most
 * recent months once a month is in `monthsFetched` (`idx >= 2` guard), so
 * without this version check, older months stay permanently blind to any
 * build added after they were first cached — exactly what happened to
 * builds 26200 (25H2) and 28000 (26H1): both were added to the maps above
 * well after most of the rolling 15-month window had already been fetched,
 * so real, currently-serviced devices on those builds got zero matching
 * kbEntries and were stuck reporting confidence: "unknown" indefinitely.
 * A version bump forces every month to be re-fetched once, the only way to
 * recover rows that were dropped rather than cached.
 */
const CATALOG_VERSION = 2;

export const WINDOWS_BUILD_TO_FEATURE: Record<number, string> = {
  // 28000/26200 verified against Microsoft's own windows11-release-information
  // doc (learn.microsoft.com) as of 2026-08 — 26H1 is a hardware-scoped
  // release (new devices only, not offered as an in-place update on existing
  // 24H2/25H2 machines), and 25H2 is delivered as an enablement package on
  // top of 24H2's servicing branch (26100 and 26200 both keep receiving the
  // same monthly cumulative updates).
  28000: "Windows 11, version 26H1",
  26200: "Windows 11, version 25H2",
  26100: "Windows 11, version 24H2",
  22631: "Windows 11, version 23H2",
  22621: "Windows 11, version 22H2",
  22000: "Windows 11, version 21H2",
  19045: "Windows 10, version 22H2",
  19044: "Windows 10, version 21H2",
  19043: "Windows 10, version 21H1",
  19042: "Windows 10, version 20H2",
  20348: "Windows Server 2022",
  17763: "Windows Server 2019 / version 1809",
};
const WINDOWS_PRODUCT_KEYWORDS: Record<number, string[]> = {
  28000: ["windows 11", "26h1"],
  26200: ["windows 11", "25h2"],
  26100: ["windows 11", "24h2"],
  22631: ["windows 11", "23h2"],
  22621: ["windows 11", "22h2"],
  22000: ["windows 11", "21h2"],
  19045: ["windows 10", "22h2"],
  19044: ["windows 10", "21h2"],
  19043: ["windows 10", "21h1"],
  19042: ["windows 10", "20h2"],
  20348: ["windows server 2022"],
  17763: ["windows server 2019"],
};
const SEVERITY_RANK: Record<string, number> = { low: 0, moderate: 1, important: 2, critical: 3 };
const BUILD_REVISION_RE = new RegExp(`\\b(${Object.keys(WINDOWS_BUILD_TO_FEATURE).join("|")})\\.(\\d{1,6})\\b`);

function matchWindowsBuildMajor(productName: string): number | null {
  const name = (productName ?? "").toLowerCase();
  for (const [buildMajor, keywords] of Object.entries(WINDOWS_PRODUCT_KEYWORDS)) {
    if (keywords.every((kw) => name.includes(kw))) return Number(buildMajor);
  }
  return null;
}

function extractBuildRevision(...texts: Array<string | null | undefined>): { buildMajor: number; ubr: number } | null {
  for (const text of texts) {
    if (!text) continue;
    const m = BUILD_REVISION_RE.exec(String(text));
    if (m) return { buildMajor: Number(m[1]), ubr: Number(m[2]) };
  }
  return null;
}

export function windowsDeviceBuild(osVersion: string): { buildMajor: number; ubr: number; featureLabel: string } | null {
  const t = versionTuple(osVersion);
  if (t.length < 3 || t[0] !== 10 || t[1] !== 0) return null;
  const buildMajor = t[2];
  if (buildMajor < 10000) return null;
  const ubr = t.length > 3 ? t[3] : 0;
  return { buildMajor, ubr, featureLabel: WINDOWS_BUILD_TO_FEATURE[buildMajor] ?? `Windows (build ${buildMajor})` };
}

interface OsUpdateCatalog {
  kbEntries: Array<Record<string, any>>;
  monthsFetched: string[];
  lastFetchedAt: string | null;
  lastError: string | null;
  catalogVersion?: number;
}

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function loadOsUpdateCatalog(): Promise<OsUpdateCatalog> {
  return loadGlobalCatalog("os_update_catalog", () => ({ kbEntries: [], monthsFetched: [], lastFetchedAt: null, lastError: null, catalogVersion: CATALOG_VERSION }));
}

interface FetchMsrcMonthResult {
  entries: Array<Record<string, any>> | null;
  /** Set only for genuine failures (bad shape, network error, non-404 HTTP
   * status) — never for a 404, which just means MSRC hasn't published a
   * bulletin for that month (a perfectly normal, silent no-op). Surfacing
   * this lets refreshOsUpdateCatalog report a real `lastError` instead of
   * quietly degrading to zero entries with no diagnostic trail. */
  error?: string;
}

/** Fetch + parse one month's MSRC CVRF bulletin — port of `_fetch_msrc_month` (main.py:16279). */
async function fetchMsrcMonth(year: number, month: number): Promise<FetchMsrcMonthResult> {
  const monthCode = `${year}-${MONTH_ABBR[month]}`;
  const url = `https://api.msrc.microsoft.com/cvrf/v3.0/cvrf/${monthCode}`;
  let doc: any;
  try {
    const resp = await axios.get(url, { headers: { Accept: "application/json" }, timeout: 30000, validateStatus: () => true });
    if (resp.status === 404) return { entries: null };
    if (resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
    doc = resp.data;
    // MSRC's content negotiation is header-driven (Accept: application/json
    // above) rather than always honored — a proxy/CDN hiccup or an API
    // change could hand back XML or an HTML error page instead. Catch that
    // here rather than silently treating `doc.ProductTree ?? {}` /
    // `doc.Vulnerability ?? []` as "zero entries this month".
    if (typeof doc !== "object" || doc === null || Array.isArray(doc) || !("ProductTree" in doc || "Vulnerability" in doc)) {
      throw new Error(`unexpected response shape for ${monthCode} (Content-Type: ${resp.headers?.["content-type"] ?? "unknown"}) — MSRC may have changed its API`);
    }
  } catch (e: any) {
    const message = `Failed to fetch ${monthCode}: ${e?.message ?? e}`;
    console.warn(`[OS Update Catalog] ${message}`);
    return { entries: null, error: message };
  }

  const productNames = new Map<string, string>();
  function collectFullProductNames(node: any) {
    if (!node || typeof node !== "object") return;
    for (const fpn of node.FullProductName ?? []) {
      if (fpn?.ProductID && fpn?.Value) productNames.set(String(fpn.ProductID), fpn.Value);
    }
    for (const branch of node.Branch ?? []) collectFullProductNames(branch);
  }
  collectFullProductNames(doc.ProductTree ?? {});

  const entries: Array<Record<string, any>> = [];
  for (const vuln of doc.Vulnerability ?? []) {
    const cve = vuln.CVE;
    const titleRaw = vuln.Title;
    const title = typeof titleRaw === "object" ? titleRaw?.Value : titleRaw;
    const notes = vuln.Notes ?? [];
    const noteTexts = notes.filter((n: any) => n?.Value).map((n: any) => n.Value);

    let severity: string | null = null;
    let exploited = false;
    for (const threat of vuln.Threats ?? []) {
      const desc = threat.Description;
      const descVal = typeof desc === "object" ? desc?.Value : desc;
      if (!descVal) continue;
      if (threat.Type === 3) severity = descVal;
      if (String(descVal).toLowerCase().replace(/ /g, "").includes("exploited:yes")) exploited = true;
    }

    const affectedProductIds = new Set<string>();
    const remediationTexts: string[] = [];
    let kb: string | null = null;
    for (const rem of vuln.Remediations ?? []) {
      for (const pid of rem.ProductID ?? []) affectedProductIds.add(String(pid));
      const desc = rem.Description;
      const descVal = typeof desc === "object" ? desc?.Value : desc;
      if (descVal) {
        remediationTexts.push(descVal);
        if (!kb && /^\d{5,7}$/.test(String(descVal).trim())) kb = String(descVal).trim();
      }
      if (rem.URL) remediationTexts.push(rem.URL);
    }
    if (!kb) {
      const m = /\bKB(\d{5,7})\b/i.exec([...remediationTexts, ...noteTexts, title ?? ""].join(" "));
      if (m) kb = m[1];
    }

    const buildInfo = extractBuildRevision(...remediationTexts, ...noteTexts, title);

    for (const pid of affectedProductIds) {
      const productName = productNames.get(pid) ?? "";
      const buildMajor = matchWindowsBuildMajor(productName);
      if (buildMajor === null) continue;
      entries.push({
        kb, cve, title, severity, exploited, productName, buildMajor,
        fixedUbr: buildInfo && buildInfo.buildMajor === buildMajor ? buildInfo.ubr : null,
        releaseMonth: monthCode,
      });
    }
  }
  return { entries };
}

interface KbRollupEntry {
  kb: string;
  buildMajor: number;
  featureLabel: string;
  productName: string;
  releaseMonth: string;
  updateType: string;
  cveIds: Set<string>;
  maxSeverity: string | null;
  exploited: boolean;
  fixedUbr: number | null;
}

/** Collapse per-CVE-per-product rows into one row per (KB, buildMajor) — port of `_rollup_kb_entries` (main.py:16373). */
function rollupKbEntries(rawEntries: Array<Record<string, any>>): Array<Record<string, any>> {
  const grouped = new Map<string, KbRollupEntry>();
  for (const e of rawEntries) {
    if (!e.kb) continue;
    const key = `${e.kb}:${e.buildMajor}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        kb: e.kb, buildMajor: e.buildMajor, featureLabel: WINDOWS_BUILD_TO_FEATURE[e.buildMajor] ?? `Windows (build ${e.buildMajor})`,
        productName: e.productName, releaseMonth: e.releaseMonth, updateType: "Security",
        cveIds: new Set<string>(), maxSeverity: null, exploited: false, fixedUbr: null,
      });
    }
    const g = grouped.get(key)!;
    if (e.cve) g.cveIds.add(e.cve);
    if (e.exploited) g.exploited = true;
    if (e.fixedUbr && !g.fixedUbr) g.fixedUbr = e.fixedUbr;
    const sev = (e.severity ?? "").toLowerCase();
    if ((SEVERITY_RANK[sev] ?? -1) > (SEVERITY_RANK[(g.maxSeverity ?? "").toLowerCase()] ?? -1)) g.maxSeverity = e.severity;
  }
  const out = Array.from(grouped.values()).map((g) => ({ ...g, cveIds: Array.from(g.cveIds).sort(), cveCount: g.cveIds.size }));
  out.sort((a, b) => b.releaseMonth.localeCompare(a.releaseMonth) || b.buildMajor - a.buildMajor);
  return out;
}

/** Port of `_refresh_os_update_catalog` (main.py:16418). */
export async function refreshOsUpdateCatalog(): Promise<OsUpdateCatalog> {
  const catalog = await loadOsUpdateCatalog();

  if (catalog.catalogVersion !== CATALOG_VERSION) {
    // See CATALOG_VERSION's doc comment — a build major was added to
    // WINDOWS_BUILD_TO_FEATURE/WINDOWS_PRODUCT_KEYWORDS after some of these
    // months were already cached, so those months need to be re-parsed from
    // scratch to pick up rows for the newly-recognized build(s). Clearing
    // monthsFetched (not kbEntries) forces every month in the window through
    // the `idx >= 2` fetch below on this run; existing kbEntries for months
    // that fail to refetch are kept as-is via the `kept` filter further down.
    catalog.monthsFetched = [];
    catalog.catalogVersion = CATALOG_VERSION;
  }

  const now = new Date();
  const monthsToFetch: Array<[number, number]> = [];
  for (let i = 0; i < MONTHS_BACK; i++) {
    let y = now.getUTCFullYear();
    let m = now.getUTCMonth() + 1 - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    monthsToFetch.push([y, m]);
  }

  const allEntriesByMonth = new Map<string, Array<Record<string, any>>>();
  const fetchErrors: string[] = [];
  for (let idx = 0; idx < monthsToFetch.length; idx++) {
    const [y, m] = monthsToFetch[idx];
    const monthCode = `${y}-${MONTH_ABBR[m]}`;
    const alreadyHave = (catalog.monthsFetched ?? []).includes(monthCode);
    if (alreadyHave && idx >= 2) continue;
    const result = await fetchMsrcMonth(y, m);
    if (result.error) fetchErrors.push(result.error);
    if (result.entries === null) continue;
    allEntriesByMonth.set(monthCode, result.entries);
    if (!catalog.monthsFetched.includes(monthCode)) catalog.monthsFetched.push(monthCode);
  }

  if (allEntriesByMonth.size > 0) {
    const refreshedMonths = new Set(allEntriesByMonth.keys());
    const kept = (catalog.kbEntries ?? []).filter((e) => !refreshedMonths.has(e.releaseMonth));
    const newRolled: Array<Record<string, any>> = [];
    for (const entries of allEntriesByMonth.values()) newRolled.push(...rollupKbEntries(entries));
    catalog.kbEntries = [...kept, ...newRolled];
    catalog.lastFetchedAt = new Date().toISOString();
    // Even on a partly-successful run, a real failure is worth surfacing —
    // the old code only ever set lastError when *every* month failed, so a
    // broken current month (the one that matters most for freshness) could
    // fail silently forever as long as older months still fetched fine.
    catalog.lastError = fetchErrors.length ? `${fetchErrors.length} of ${monthsToFetch.length} months failed to fetch: ${fetchErrors.slice(0, 3).join(" | ")}` : null;
  } else if (!catalog.kbEntries?.length) {
    catalog.lastError = fetchErrors.length ? fetchErrors.slice(0, 3).join(" | ") : "No MSRC data fetched yet — check network access to api.msrc.microsoft.com";
  }
  await saveGlobalCatalog("os_update_catalog", catalog);
  return catalog;
}

/** Compare a device's osVersion against the catalog — port of `_compute_windows_pending_updates` (main.py:16472). */
export function computeWindowsPendingUpdates(osVersion: string | null | undefined, catalog: OsUpdateCatalog): Record<string, any> | null {
  const deviceBuild = windowsDeviceBuild(osVersion ?? "");
  if (!deviceBuild) return null;
  const sameFamily = (catalog.kbEntries ?? []).filter((e) => e.buildMajor === deviceBuild.buildMajor && e.fixedUbr);
  const pending = sameFamily.filter((e) => e.fixedUbr > deviceBuild.ubr).sort((a, b) => b.fixedUbr - a.fixedUbr);
  const latestKnownUbr = sameFamily.length ? Math.max(...sameFamily.map((e) => e.fixedUbr)) : null;
  const allPendingCves = Array.from(new Set(pending.flatMap((e) => e.cveIds ?? []))).sort();
  return {
    featureLabel: deviceBuild.featureLabel, buildMajor: deviceBuild.buildMajor, ubr: deviceBuild.ubr,
    latestKnownUbr, pendingCount: pending.length, pendingCveCount: allPendingCves.length,
    pendingKbs: pending.slice(0, 10).map((e) => ({ kb: e.kb, fixedUbr: e.fixedUbr, updateType: e.updateType ?? "Security", cveIds: e.cveIds ?? [], cveCount: e.cveCount, maxSeverity: e.maxSeverity, exploited: e.exploited, releaseMonth: e.releaseMonth })),
    confidence: sameFamily.length ? "build" : "unknown",
  };
}
