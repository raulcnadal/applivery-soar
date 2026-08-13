import axios from "axios";
import { loadGlobalCatalog, saveGlobalCatalog } from "../../services/globalCatalog";
import { versionTuple } from "../compliance/complianceEvaluate";

/**
 * Apple Software Lookup Service (GDMF) — port of main.py:17333-17617.
 * gdmf.apple.com/v2/pmv is Apple's own official feed of currently-signed,
 * installable OS releases. Public, unauthenticated. Global, not per-workspace.
 */

const GDMF_URL = "https://gdmf.apple.com/v2/pmv";
export const GDMF_TICK_MS = 86_400_000; // daily — Apple's own stated UEM polling limit
const GDMF_RSR_KEYS = ["PublicBackgroundSecurityImprovements", "PublicRapidSecurityResponses"];

export interface GdmfCatalog {
  platforms: Record<string, Array<Record<string, any>>>;
  rapidSecurityResponses: Record<string, Array<Record<string, any>>>;
  lastFetchedAt: string | null;
  lastError: string | null;
}

export async function loadGdmfCatalog(): Promise<GdmfCatalog> {
  return loadGlobalCatalog("gdmf_catalog", () => ({ platforms: {}, rapidSecurityResponses: {}, lastFetchedAt: null, lastError: null }));
}

function parseGdmfRelease(a: Record<string, any>, now: Date): Record<string, any> {
  const expiration = a.ExpirationDate;
  let isExpired = false;
  if (expiration) {
    const expDt = new Date(String(expiration));
    if (!Number.isNaN(expDt.getTime())) isExpired = now.getTime() > expDt.getTime();
  }
  return {
    productVersion: a.ProductVersion, build: a.Build, postingDate: a.PostingDate, expirationDate: expiration,
    isExpired, supportedDevices: a.SupportedDevices ?? [],
    supplementalBuildVersion: a.SupplementalBuildVersion ?? a.SEBuildVersion,
    cveIds: a.CVEs ?? a.cveIds ?? [],
  };
}

/** Port of `_refresh_gdmf_catalog` (main.py:17407). */
export async function refreshGdmfCatalog(): Promise<GdmfCatalog> {
  const catalog = await loadGdmfCatalog();
  try {
    const resp = await axios.get(GDMF_URL, { headers: { Accept: "application/json" }, timeout: 30000, validateStatus: () => true });
    if (resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
    const body = resp.data ?? {};
    const assetSets = body.AssetSets ?? {};
    let rsrSet: Record<string, any> = {};
    for (const key of GDMF_RSR_KEYS) {
      if (body[key]) {
        rsrSet = body[key];
        break;
      }
    }
    const now = new Date();
    const platforms: Record<string, Array<Record<string, any>>> = {};
    const rsrs: Record<string, Array<Record<string, any>>> = {};
    for (const [platform, gdmfKey] of [
      ["apple", "iOS"],
      ["macos", "macOS"],
    ] as const) {
      platforms[platform] = (assetSets[gdmfKey] ?? []).map((a: any) => parseGdmfRelease(a, now));
      try {
        rsrs[platform] = (rsrSet[gdmfKey] ?? []).map((a: any) => parseGdmfRelease(a, now));
      } catch (e) {
        console.warn(`[GDMF] RSR parse failed for '${gdmfKey}' (unverified schema): ${e}`);
        rsrs[platform] = [];
      }
    }
    catalog.platforms = platforms;
    catalog.rapidSecurityResponses = rsrs;
    catalog.lastFetchedAt = now.toISOString();
    catalog.lastError = null;
  } catch (e) {
    console.warn(`[GDMF] Fetch failed: ${e}`);
    if (!Object.keys(catalog.platforms ?? {}).length) catalog.lastError = `No GDMF data fetched yet: ${e}`;
  }
  await saveGlobalCatalog("gdmf_catalog", catalog);
  return catalog;
}

/**
 * Port of `_gdmf_best_target` (main.py:17459). `deviceIdentifiers` is the
 * device's *hardware* identifier(s) (e.g. "iPhone12,5"), resolved via
 * appleDeviceIdentifiers.ts — GDMF's own SupportedDevices lists are never
 * keyed by marketing name, so passing a raw model name here would silently
 * never match (see appleDeviceIdentifiers.ts's module doc comment).
 */
export function gdmfBestTarget(platform: string, deviceIdentifiers: string[] | null, catalog: GdmfCatalog | null): Record<string, any> | null {
  if (!catalog) return null;
  let entries = ((catalog.platforms ?? {})[platform] ?? []).filter((e) => !e.isExpired);
  if (!entries.length) return null;
  let hardwareMatched = false;
  if (deviceIdentifiers && deviceIdentifiers.length) {
    const matched = entries.filter((e) => (e.supportedDevices ?? []).some((sd: string) => deviceIdentifiers.includes(sd)));
    if (matched.length) {
      entries = matched;
      hardwareMatched = true;
    }
  }
  const best = entries.reduce((a, b) => (cmpVersions(a.productVersion, b.productVersion) >= 0 ? a : b));
  return { productVersion: best.productVersion, build: best.build, expirationDate: best.expirationDate, hardwareMatched };
}

function cmpVersions(a: string | undefined, b: string | undefined): number {
  const av = versionTuple(a ?? "");
  const bv = versionTuple(b ?? "");
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const x = av[i] ?? 0, y = bv[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Port of `_gdmf_active_rsr` (main.py:17482). See gdmfBestTarget's doc comment re: `deviceIdentifiers`. */
export function gdmfActiveRsr(platform: string, baseProductVersion: string | null, deviceIdentifiers: string[] | null, catalog: GdmfCatalog | null): Record<string, any> | null {
  if (!catalog || !baseProductVersion) return null;
  const rsrEntries = (catalog.rapidSecurityResponses ?? {})[platform] ?? [];
  if (!rsrEntries.length) return { available: false };
  let candidates = rsrEntries.filter((e) => !e.isExpired && String(e.productVersion ?? "").startsWith(String(baseProductVersion)));
  if (deviceIdentifiers && deviceIdentifiers.length) {
    const hwMatched = candidates.filter((e) => (e.supportedDevices ?? []).some((sd: string) => deviceIdentifiers.includes(sd)));
    if (hwMatched.length) candidates = hwMatched;
  }
  if (!candidates.length) return { available: false };
  const latest = candidates[0];
  return { available: true, version: latest.productVersion, supplementalBuildVersion: latest.supplementalBuildVersion, build: latest.build, cveIds: latest.cveIds ?? [] };
}
