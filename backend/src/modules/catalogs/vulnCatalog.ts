import axios from "axios";
import { loadGlobalCatalog, saveGlobalCatalog } from "../../services/globalCatalog";
import { versionTuple } from "../compliance/complianceEvaluate";

/**
 * Apple & Android Vulnerability Intelligence (EUVD) — port of
 * main.py:16523-16780. Sourced from ENISA's EU Vulnerability Database
 * (euvdservices.enisa.europa.eu), free/no key. Global, not per-workspace.
 */

const EUVD_SEARCH_URL = "https://euvdservices.enisa.europa.eu/api/search";
const MONTHS_BACK = 15;
export const VULN_CATALOG_TICK_MS = 86_400_000; // daily

interface VulnCatalog {
  entries: Array<Record<string, any>>;
  lastFetchedAt: string | null;
  lastError: string | null;
  windowFrom: string | null;
}

export async function loadVulnCatalog(): Promise<VulnCatalog> {
  return loadGlobalCatalog("vuln_catalog", () => ({ entries: [], lastFetchedAt: null, lastError: null, windowFrom: null }));
}

function cvssBand(score: number | null | undefined): string | null {
  if (score === null || score === undefined) return null;
  if (score >= 9.0) return "Critical";
  if (score >= 7.0) return "High";
  if (score >= 4.0) return "Medium";
  if (score > 0.0) return "Low";
  return null;
}

function parseAppleFixedVersion(productVersion: string): string | null {
  if (!productVersion) return null;
  const m = /<\s*([\d][\d.]*)\s*$/.exec(String(productVersion));
  return m ? m[1] : null;
}

function parseAndroidMajorVersion(productVersion: string): string | null {
  const v = (productVersion ?? "").trim();
  return /^\d{1,2}[A-Za-z]?$/.test(v) ? v : null;
}

/** Paginate EUVD's search endpoint — port of `_fetch_euvd` (main.py:16591). */
async function fetchEuvd(vendor: string, product: string, fromDate: string, toDate: string): Promise<Array<Record<string, any>>> {
  const items: Array<Record<string, any>> = [];
  let page = 0;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resp = await axios.get(EUVD_SEARCH_URL, {
        params: { vendor, product, fromDate, toDate, size: 100, page },
        timeout: 30000,
        validateStatus: () => true,
      });
      if (resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
      const body = resp.data ?? {};
      const batch = body.items ?? [];
      items.push(...batch);
      const total = body.total ?? items.length;
      page += 1;
      if (!batch.length || items.length >= total || page > 20) break;
    }
  } catch (e) {
    console.warn(`[Vuln Catalog] EUVD fetch failed for vendor=${vendor} product=${product}: ${e}`);
  }
  return items;
}

/** Port of `_parse_euvd_items` (main.py:16615). */
function parseEuvdItems(items: Array<Record<string, any>>, platform: "apple" | "android", productNameFilter: (name: string) => boolean): Array<Record<string, any>> {
  const entries: Array<Record<string, any>> = [];
  for (const item of items) {
    let cveId: string | null = null;
    for (const alias of String(item.aliases ?? "").split("\n")) {
      const trimmed = alias.trim();
      if (trimmed.startsWith("CVE-")) {
        cveId = trimmed;
        break;
      }
    }
    const score = item.baseScore;
    const exploited = Boolean(item.exploitedSince);
    const refs = String(item.references ?? "").split("\n").filter((r) => r.trim());
    const seenProducts = new Set<string>();
    for (const p of item.enisaIdProduct ?? []) {
      const product = p.product ?? {};
      const name = product.name ?? "";
      if (!productNameFilter(name)) continue;
      const versionRaw = p.product_version ?? "";
      const fixedVersion = platform === "apple" ? parseAppleFixedVersion(versionRaw) : null;
      const androidMajor = platform === "android" ? parseAndroidMajorVersion(versionRaw) : null;
      const dedupKey = `${item.id}:${name}:${versionRaw}`;
      if (seenProducts.has(dedupKey)) continue;
      seenProducts.add(dedupKey);
      entries.push({
        cveId: cveId ?? item.id, euvdId: item.id, platform, productLabel: name, description: item.description,
        baseScore: score, baseSeverity: cvssBand(score), epss: item.epss, exploited, datePublished: item.datePublished,
        fixedVersion, androidMajorVersion: androidMajor, references: refs.slice(0, 3),
      });
    }
  }
  return entries;
}

/** Port of `_refresh_vuln_catalog` (main.py:16655). */
export async function refreshVulnCatalog(): Promise<VulnCatalog> {
  const catalog = await loadVulnCatalog();
  const now = new Date();
  const fromDate = new Date(now.getTime() - 30 * MONTHS_BACK * 86_400_000).toISOString().slice(0, 10);
  const toDate = now.toISOString().slice(0, 10);

  let allEntries: Array<Record<string, any>> = [];
  let hadSuccess = false;

  const appleRaw = await fetchEuvd("apple", "ios", fromDate, toDate);
  if (appleRaw.length) {
    hadSuccess = true;
    const appleProducts = new Set(["ios and ipados", "macos", "ipados"]);
    allEntries = allEntries.concat(parseEuvdItems(appleRaw, "apple", (n) => appleProducts.has(n.toLowerCase())));
  }

  const androidRaw = await fetchEuvd("google", "android", fromDate, toDate);
  if (androidRaw.length) {
    hadSuccess = true;
    allEntries = allEntries.concat(parseEuvdItems(androidRaw, "android", (n) => n.toLowerCase() === "android"));
  }

  if (hadSuccess) {
    const dedup = new Map<string, Record<string, any>>();
    for (const e of allEntries) {
      const key = `${e.cveId}:${e.platform}:${e.productLabel}:${e.fixedVersion ?? ""}:${e.androidMajorVersion ?? ""}`;
      dedup.set(key, e);
    }
    catalog.entries = Array.from(dedup.values()).sort((a, b) => (b.datePublished ?? "").localeCompare(a.datePublished ?? ""));
    catalog.lastFetchedAt = now.toISOString();
    catalog.lastError = null;
    catalog.windowFrom = fromDate;
  } else if (!catalog.entries?.length) {
    catalog.lastError = "No EUVD data fetched yet — check network access to euvdservices.enisa.europa.eu";
  }
  await saveGlobalCatalog("vuln_catalog", catalog);
  return catalog;
}

/** Port of `_compute_apple_pending_vulns` (main.py:16711). */
export function computeApplePendingVulns(platform: "apple" | "macos", osVersion: string | null | undefined, catalog: VulnCatalog): Record<string, any> | null {
  if (!osVersion) return null;
  const deviceV = versionTuple(osVersion);
  const productName = platform === "macos" ? "macOS" : "iOS and iPadOS";
  const candidates = (catalog.entries ?? []).filter((e) => e.platform === "apple" && e.productLabel === productName);
  const confirmed = candidates.filter((e) => e.fixedVersion);
  const cmp = (a: number[], b: number[]) => {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] ?? 0, bv = b[i] ?? 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  };
  const pending = confirmed.filter((e) => cmp(versionTuple(e.fixedVersion), deviceV) > 0).sort((a, b) => cmp(versionTuple(b.fixedVersion), versionTuple(a.fixedVersion)));
  return {
    pendingCount: pending.length,
    pendingCves: pending.slice(0, 10).map((e) => ({ cveId: e.cveId, baseScore: e.baseScore, baseSeverity: e.baseSeverity, epss: e.epss, exploited: e.exploited, fixedVersion: e.fixedVersion })),
    confidence: confirmed.length ? "version" : "unknown",
    unconfirmedCount: candidates.length - confirmed.length,
  };
}

/** Port of `_compute_android_pending_vulns` (main.py:16735). */
export function computeAndroidPendingVulns(osVersion: string | null | undefined, catalog: VulnCatalog): Record<string, any> | null {
  if (!osVersion) return null;
  const m = /^\D*(\d{1,2})/.exec(String(osVersion));
  if (!m) return null;
  const deviceMajor = Number(m[1]);
  const candidates = (catalog.entries ?? []).filter((e) => e.platform === "android");
  const confirmed = candidates.filter((e) => e.androidMajorVersion);
  const pending: Array<Record<string, any>> = [];
  for (const e of confirmed) {
    const fm = /^(\d{1,2})/.exec(e.androidMajorVersion ?? "");
    if (!fm) continue;
    if (Number(fm[1]) > deviceMajor) pending.push(e);
  }
  pending.sort((a, b) => (b.baseScore ?? 0) - (a.baseScore ?? 0));
  return {
    pendingCount: pending.length,
    pendingCves: pending.slice(0, 10).map((e) => ({ cveId: e.cveId, baseScore: e.baseScore, baseSeverity: e.baseSeverity, epss: e.epss, exploited: e.exploited, fixedInMajor: e.androidMajorVersion })),
    confidence: confirmed.length ? "version" : "unknown",
    unconfirmedCount: candidates.length - confirmed.length,
  };
}
