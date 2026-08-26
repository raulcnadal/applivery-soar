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

/**
 * Microsoft's MSRC CVRF bulletins (fetchMsrcMonth below) never actually carry
 * the fixed OS build revision number — confirmed against production data:
 * 0 of 574 real kbEntries had a non-null fixedUbr, across every single build
 * major, not just the newly-added ones. Also confirmed against Microsoft's
 * own MSRC-Microsoft-Security-Updates-API PowerShell module: its Remediation
 * objects expose only Description/URL/ProductID/RestartRequired — no build
 * field anywhere. BUILD_REVISION_RE above was ported from main.py assuming
 * the revision was embedded in remediation/notes text; it never is, so
 * `computeWindowsPendingUpdates` always fell back to confidence: "unknown".
 *
 * The one place Microsoft *does* publish "this KB fixes OS Build X.Y" is its
 * public Windows release-health update-history pages — plain HTML, no auth,
 * and (verified 2026-08) the Windows 11, version 25H2 page's own sidebar
 * cross-lists every currently- and recently-serviced Windows 11 feature
 * version (26H1, 25H2, 24H2, 23H2, 22H2, back through 21H2) with a full
 * KB → OS Build history for each, so one fetch backfills all of them.
 * fetchReleaseHealthBuildRevisions below scrapes that page as a second,
 * independent enrichment pass over the kbEntries the CVRF fetch already
 * produced (matched by KB number + build major) — it doesn't discover new
 * KBs or CVEs, only fills in the fixedUbr the CVRF feed can't provide.
 */
const WINDOWS11_RELEASE_HEALTH_URL = "https://support.microsoft.com/en-us/servicing/os/windows-11/2025/07/windows-11-version-25h2-update-history";

/**
 * Parses "<Month> <Day>, <Year>—KB<number> (OS Build[s] <major>.<ubr>[ and
 * <major>.<ubr>])" occurrences out of a release-health page's raw HTML
 * (matched against the whole page text, so it survives whatever markup
 * surrounds each link). A single KB commonly patches two build majors at
 * once (a shared servicing branch, e.g. 26200 and 26100 both getting the
 * same monthly cumulative update) — captures both when present.
 */
function parseReleaseHealthBuildRevisions(html: string): Array<{ kb: string; buildMajor: number; ubr: number }> {
  const text = html.replace(/<[^>]+>/g, " ");
  const re = /KB(\d{5,8})\s*\(OS Builds?\s+(\d{4,6})\.(\d{1,6})(?:\s+and\s+(\d{4,6})\.(\d{1,6}))?\)/g;
  const out: Array<{ kb: string; buildMajor: number; ubr: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const kb = m[1];
    out.push({ kb, buildMajor: Number(m[2]), ubr: Number(m[3]) });
    if (m[4] && m[5]) out.push({ kb, buildMajor: Number(m[4]), ubr: Number(m[5]) });
  }
  return out;
}

/** Fetch + parse the release-health page — returns null (not throw) on any
 * failure so a hiccup here never blocks the core CVRF refresh above. */
async function fetchReleaseHealthBuildRevisions(): Promise<Map<string, number> | null> {
  try {
    const resp = await axios.get(WINDOWS11_RELEASE_HEALTH_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ApplierySOAR/1.0)", Accept: "text/html" },
      timeout: 30000,
      validateStatus: () => true,
    });
    if (resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
    const rows = parseReleaseHealthBuildRevisions(String(resp.data));
    if (rows.length === 0) throw new Error("parsed 0 KB→build rows — page layout may have changed");
    const map = new Map<string, number>();
    for (const row of rows) map.set(`${row.kb}:${row.buildMajor}`, row.ubr);
    return map;
  } catch (e: any) {
    console.warn(`[OS Update Catalog] Release-health fetch failed: ${e?.message ?? e}`);
    return null;
  }
}

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

  // Backfill fixedUbr from the release-health page (see its doc comment) —
  // runs every refresh regardless of CATALOG_VERSION/monthsFetched, since it
  // re-derives from a live page each time rather than anything cached.
  const releaseHealthMap = await fetchReleaseHealthBuildRevisions();
  if (releaseHealthMap) {
    let backfilled = 0;
    for (const entry of catalog.kbEntries ?? []) {
      if (entry.fixedUbr) continue;
      const ubr = releaseHealthMap.get(`${entry.kb}:${entry.buildMajor}`);
      if (ubr) {
        entry.fixedUbr = ubr;
        backfilled++;
      }
    }
    if (backfilled > 0) console.warn(`[OS Update Catalog] Backfilled fixedUbr on ${backfilled} entries from release-health page`);
  } else if (!(catalog.kbEntries ?? []).some((e) => e.fixedUbr)) {
    // Only worth surfacing if we still have zero patch-level data overall —
    // if some entries already have fixedUbr from a previous successful
    // backfill, a transient fetch failure here isn't worth alarming over.
    const suffix = "release-health page fetch failed — patch-level (fixedUbr) comparison unavailable this run";
    catalog.lastError = catalog.lastError ? `${catalog.lastError} | ${suffix}` : suffix;
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
    // Full list, not capped — a real report: "11 security updates behind"
    // (pendingCount, always accurate) while the KB list itself only ever
    // showed 10 (this used to be .slice(0, 10)). Display-side collapsing
    // (Overview tab) handles keeping a long list out of the way by default.
    pendingKbs: pending.map((e) => ({ kb: e.kb, fixedUbr: e.fixedUbr, updateType: e.updateType ?? "Security", cveIds: e.cveIds ?? [], cveCount: e.cveCount, maxSeverity: e.maxSeverity, exploited: e.exploited, releaseMonth: e.releaseMonth })),
    confidence: sameFamily.length ? "build" : "unknown",
  };
}
