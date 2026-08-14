import axios from "axios";
import { appliveryClient } from "../../services/appliveryClient";
import { extractItems } from "../../utils/extractItems";
import { HttpError } from "../../utils/httpError";
import { resolveOrgBase } from "../auth/rbac.service";

type Headers = Record<string, string>;
interface SearchResult {
  identifier: string;
  name: string;
  iconUrl?: string | null;
  source: string;
}
type SearchOutcome = { items: SearchResult[]; error: string | null };

/** Applivery's app-store-search endpoints wrap results a couple of different ways — port of `_extract_search_results` (main.py:8226). */
function extractSearchResults(body: any): any[] | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const data = body.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      if (Array.isArray(data.results)) return data.results;
      if (Array.isArray(data.items)) return data.items;
    }
    if (Array.isArray(data)) return data;
    if (Array.isArray(body.results)) return body.results;
    if (Array.isArray(body.items)) return body.items;
  }
  if (Array.isArray(body)) return body;
  return null;
}

/** Port of `_search_apple_store` (main.py:8249). */
async function searchAppleStore(headers: Headers, orgBase: string, text: string, platform: string): Promise<SearchOutcome> {
  const osValue = platform === "macos" ? "macos" : "ios";
  const url = `${orgBase}/mdm/apple/enterprise/applications/search`;
  let res;
  try {
    res = await appliveryClient.get<any>(url, { headers, params: { text, os: osValue, kind: "app", country: "US" } });
  } catch (e) {
    return { items: [], error: `Request to Applivery failed: ${e}` };
  }
  if (res.status >= 300) return { items: [], error: `Applivery returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 200)}` };
  const results = extractSearchResults(res.data);
  if (results === null) return { items: [], error: "Unrecognized response shape from Applivery — see server logs" };
  const out: SearchResult[] = [];
  for (const item of results.slice(0, 25)) {
    if (!item || typeof item !== "object" || !item.bundleId) continue;
    out.push({ identifier: item.bundleId, name: item.name ?? item.bundleId, iconUrl: item.icon, source: "apple_store" });
  }
  return { items: out, error: null };
}

/** Port of `_search_ms_store` (main.py:8281). */
async function searchMsStore(headers: Headers, orgBase: string, text: string): Promise<SearchOutcome> {
  const url = `${orgBase}/mdm/windows/enterprise/applications/search`;
  let res;
  try {
    res = await appliveryClient.get<any>(url, { headers, params: { text, country: "US" } });
  } catch (e) {
    return { items: [], error: `Request to Applivery failed: ${e}` };
  }
  if (res.status >= 300) return { items: [], error: `Applivery returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 200)}` };
  const results = extractSearchResults(res.data);
  if (results === null) return { items: [], error: "Unrecognized response shape from Applivery — see server logs" };
  const out: SearchResult[] = [];
  for (const item of results.slice(0, 25)) {
    if (!item || typeof item !== "object") continue;
    const identifier = item.productId ?? item.id ?? item.packageFamilyName ?? item.storeId;
    const name = item.title ?? item.name ?? item.displayName;
    if (!identifier || !name) continue;
    out.push({ identifier: String(identifier), name, iconUrl: item.icon ?? item.iconUrl, source: "ms_store" });
  }
  return { items: out, error: null };
}

/** Best-effort secondary source for Windows — port of `_search_winget` (main.py:8318). */
async function searchWinget(text: string): Promise<SearchOutcome> {
  try {
    const res = await axios.get("https://api.winget.run/v2/packages", { params: { query: text }, timeout: 8000, validateStatus: () => true });
    if (res.status >= 300) return { items: [], error: `winget.run returned ${res.status}` };
    const items = (res.data ?? {}).Packages ?? [];
    const out: SearchResult[] = [];
    for (const item of items.slice(0, 15)) {
      const pkgId = item.Id;
      if (!pkgId) continue;
      out.push({ identifier: pkgId, name: item.Latest?.Name ?? item.Name ?? pkgId, iconUrl: null, source: "winget" });
    }
    return { items: out, error: null };
  } catch (e) {
    return { items: [], error: `winget.run request failed: ${e}` };
  }
}

let homebrewCache: { data: any[] | null; expiresAtMs: number } = { data: null, expiresAtMs: 0 };

/** Best-effort secondary source for macOS — port of `_search_homebrew` (main.py:8342). */
async function searchHomebrew(text: string): Promise<SearchOutcome> {
  const now = Date.now();
  if (homebrewCache.data === null || homebrewCache.expiresAtMs < now) {
    try {
      const res = await axios.get("https://formulae.brew.sh/api/cask.json", { timeout: 20000, validateStatus: () => true });
      if (res.status >= 300) return { items: [], error: `formulae.brew.sh returned ${res.status}` };
      homebrewCache = { data: res.data, expiresAtMs: now + 21_600_000 };
    } catch (e) {
      return { items: [], error: `formulae.brew.sh request failed: ${e}` };
    }
  }
  const textLower = text.toLowerCase();
  const out: SearchResult[] = [];
  for (const cask of homebrewCache.data ?? []) {
    const names: string[] = cask.name ?? [];
    if (names.some((n) => (n ?? "").toLowerCase().includes(textLower)) || (cask.token ?? "").includes(textLower)) {
      out.push({ identifier: cask.token, name: names[0] ?? cask.token, iconUrl: null, source: "homebrew_unconfirmed_id" });
    }
    if (out.length >= 15) break;
  }
  return { items: out, error: null };
}

/** No free-text Play Store search exists for EMMs — port of `_search_android_known` (main.py:8373). */
async function searchAndroidKnown(headers: Headers, orgBase: string, text: string): Promise<SearchOutcome> {
  const textLower = text.toLowerCase();
  const out: SearchResult[] = [];
  const errors: string[] = [];
  try {
    const res = await appliveryClient.get<any>(`${orgBase}/apps`, { headers, params: { oss: "android" } });
    if (res.status < 300) {
      for (const item of extractItems(res.data)) {
        const name = item.name ?? "";
        if (textLower && name.toLowerCase().includes(textLower)) {
          out.push({ identifier: String(item.id ?? item._id ?? ""), name, iconUrl: item.icon, source: "applivery_catalog" });
        }
      }
    } else {
      errors.push(`App Distribution catalog: ${res.status}`);
    }
  } catch (e) {
    errors.push(`App Distribution catalog request failed: ${e}`);
  }
  try {
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/android/enterprise/applications/emm-application`, { headers });
    if (res.status < 300) {
      for (const item of extractItems(res.data)) {
        const info = item.info ?? {};
        const name = info.title ?? info.name ?? item.title ?? "";
        const pkg = info.bundleId ?? item.packageName ?? item.bundleId;
        if (pkg && (name || pkg).toLowerCase().includes(textLower)) {
          out.push({ identifier: pkg, name: name || pkg, iconUrl: info.icon, source: "android_enterprise" });
        }
      }
    } else if (res.status !== 404) {
      errors.push(`Android Enterprise catalog: ${res.status}`);
    }
  } catch (e) {
    errors.push(`Android Enterprise catalog request failed: ${e}`);
  }
  return { items: out.slice(0, 25), error: errors.length && !out.length ? errors.join("; ") : null };
}

/**
 * Exact Google Play package lookup — NOT a search. Confirmed via the
 * Applivery Docs MCP (android/applications/get-by-name) that no free-text
 * Play Store search exists for EMMs, but this endpoint resolves one exact
 * package name against Google Play directly (live, not just Applivery's own
 * catalog), returning the real title so an admin adding a known package to
 * the App Catalog doesn't have to hand-type the display name blind and can
 * confirm the package actually exists first. Distinct from
 * searchAndroidKnown above, which only ever searches apps already staged in
 * Applivery's own org (App Distribution / Android Enterprise catalogs).
 */
export async function lookupAndroidAppByPackageName(headers: Headers, orgBase: string, packageName: string): Promise<{ found: boolean; name: string | null; error: string | null }> {
  const pkg = (packageName ?? "").trim();
  if (!pkg) return { found: false, name: null, error: null };
  try {
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/android/enterprise/applications/${encodeURIComponent(pkg)}`, { headers });
    if (res.status === 404) return { found: false, name: null, error: null };
    if (res.status >= 300) return { found: false, name: null, error: `Applivery returned ${res.status}` };
    const data = res.data?.data ?? res.data;
    const name = typeof data?.title === "string" && data.title.trim() ? data.title.trim() : null;
    return { found: true, name, error: null };
  } catch (e) {
    return { found: false, name: null, error: String(e) };
  }
}

const SEARCH_SOURCES_BY_PLATFORM: Record<string, string[]> = {
  apple: ["apple_store"],
  macos: ["apple_store", "homebrew"],
  windows: ["ms_store", "winget"],
  android: ["android_known"],
};

/** Port of `search_apps` / GET /api/app-search (main.py:9062). */
export async function searchApps(authorization: string, workspaceSlug: string, platform: string, rawText: string, source?: string): Promise<SearchOutcome> {
  const text = (rawText ?? "").trim();
  if (text.length < 2) return { items: [], error: null };
  const validSources = SEARCH_SOURCES_BY_PLATFORM[platform];
  if (!validSources) throw new HttpError(400, `Unknown platform '${platform}'`);
  const resolvedSource = source || validSources[0];
  if (!validSources.includes(resolvedSource)) {
    throw new HttpError(400, `'${resolvedSource}' isn't a valid source for ${platform} — expected one of ${validSources.join(", ")}`);
  }

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);

  switch (resolvedSource) {
    case "apple_store":
      return searchAppleStore(headers, orgBase, text, platform);
    case "ms_store":
      return searchMsStore(headers, orgBase, text);
    case "winget":
      return searchWinget(text);
    case "homebrew":
      return searchHomebrew(text);
    case "android_known":
      return searchAndroidKnown(headers, orgBase, text);
    default:
      return { items: [], error: null };
  }
}
