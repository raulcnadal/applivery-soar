import axios from "axios";
import { loadGlobalCatalog, saveGlobalCatalog } from "../../services/globalCatalog";
import { versionTuple } from "../compliance/complianceEvaluate";
import { windowsDeviceBuild } from "./osUpdateCatalog";
import { gdmfBestTarget, gdmfActiveRsr, type GdmfCatalog } from "./gdmfCatalog";
import { resolveAppleHardwareIdentifiers, type AppleDeviceIdentifiersCatalog } from "./appleDeviceIdentifiers";

/** OS Lifecycle (endoflife.date) — port of main.py:17239-17596. Global, not per-workspace. */

const ENDOFLIFE_API_BASE = "https://endoflife.date/api/v1/products";
export const OS_LIFECYCLE_TICK_MS = 604_800_000; // weekly

interface OsLifecycleCatalog {
  platforms: Record<string, Array<Record<string, any>>>;
  lastFetchedAt: string | null;
  lastError: string | null;
}

export async function loadOsLifecycleCatalog(): Promise<OsLifecycleCatalog> {
  return loadGlobalCatalog("os_lifecycle_catalog", () => ({ platforms: {}, lastFetchedAt: null, lastError: null }));
}

async function fetchEndoflifeProduct(product: string): Promise<Record<string, any> | null> {
  try {
    const resp = await axios.get(`${ENDOFLIFE_API_BASE}/${product}`, { timeout: 30000, validateStatus: () => true });
    if (resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
    return resp.data?.result ?? null;
  } catch (e) {
    console.warn(`[OS Lifecycle] Failed to fetch endoflife.date product '${product}': ${e}`);
    return null;
  }
}

/** Port of `_refresh_os_lifecycle_catalog` (main.py:17284). */
export async function refreshOsLifecycleCatalog(): Promise<OsLifecycleCatalog> {
  const catalog = await loadOsLifecycleCatalog();
  let hadSuccess = false;
  const perPlatform: Record<string, Array<Record<string, any>>> = {};

  for (const [platform, product] of [
    ["windows", "windows"],
    ["apple", "ios"],
    ["macos", "macos"],
    ["android", "android"],
  ] as const) {
    const result = await fetchEndoflifeProduct(product);
    if (!result) continue;
    hadSuccess = true;
    const releases = (result.releases ?? []).map((r: any) => {
      const latest = r.latest ?? {};
      return {
        name: r.name, label: r.label, releaseDate: r.releaseDate,
        latestVersion: latest.name, latestDate: latest.date,
        isEol: Boolean(r.isEol), eolFrom: r.eolFrom, isMaintained: Boolean(r.isMaintained),
        isEoes: r.isEoes, eoesFrom: r.eoesFrom,
      };
    });
    perPlatform[platform] = releases;
  }

  if (hadSuccess) {
    catalog.platforms = perPlatform;
    catalog.lastFetchedAt = new Date().toISOString();
    catalog.lastError = null;
  } else if (!Object.keys(catalog.platforms ?? {}).length) {
    catalog.lastError = "No endoflife.date data fetched yet — check network access to endoflife.date";
  }
  await saveGlobalCatalog("os_lifecycle_catalog", catalog);
  return catalog;
}

/** Port of `_compute_os_lifecycle_status` (main.py:17510). */
export function computeOsLifecycleStatus(
  platform: string,
  osVersion: string | null | undefined,
  catalog: OsLifecycleCatalog,
  deviceModel?: string | null,
  gdmfCatalog?: GdmfCatalog | null,
  appleIdCatalog?: AppleDeviceIdentifiersCatalog | null,
): Record<string, any> | null {
  if (!osVersion) return null;
  const releases = (catalog.platforms ?? {})[platform] ?? [];
  if (!releases.length) return null;

  if (platform === "windows") {
    const deviceBuild = windowsDeviceBuild(osVersion);
    if (!deviceBuild) return null;
    const matches = releases.filter((r) => {
      const lv = versionTuple(r.latestVersion ?? "");
      return lv.length >= 3 && lv[2] === deviceBuild.buildMajor;
    });
    if (!matches.length) {
      return { trainLabel: deviceBuild.featureLabel, isEol: null, isMaintained: null, onLatestVersion: null, latestKnownVersion: null, eolFrom: null, esuUntil: null, confidence: "unknown" };
    }
    const isEol = matches.every((r) => r.isEol);
    const esuCandidates = matches.filter((r) => r.eoesFrom).map((r) => r.eoesFrom);
    const eolCandidates = matches.filter((r) => r.eolFrom).map((r) => r.eolFrom);
    return {
      trainLabel: deviceBuild.featureLabel, isEol, isMaintained: matches.some((r) => r.isMaintained),
      onLatestVersion: null, latestKnownVersion: matches[0].latestVersion,
      eolFrom: eolCandidates.length ? eolCandidates.reduce((a, b) => (a > b ? a : b)) : null,
      esuUntil: esuCandidates.length ? esuCandidates.reduce((a, b) => (a > b ? a : b)) : null,
      confidence: "version",
    };
  }

  const deviceV = versionTuple(osVersion);
  if (!deviceV.length || deviceV[0] === 0) return null;
  const deviceMajor = String(deviceV[0]);
  const match = releases.find((r) => String(r.name) === deviceMajor);
  if (!match) {
    return { trainLabel: `v${deviceMajor}`, isEol: null, isMaintained: null, onLatestVersion: null, latestKnownVersion: null, eolFrom: null, esuUntil: null, confidence: "unknown" };
  }
  const result: Record<string, any> = {
    trainLabel: match.label ?? match.name, isEol: match.isEol, isMaintained: match.isMaintained,
    onLatestVersion: null, latestKnownVersion: match.latestVersion, eolFrom: match.eolFrom, esuUntil: null, confidence: "version",
  };
  if (platform === "apple" || platform === "macos") {
    // Only resolves for iOS-family hardware (see appleDeviceIdentifiers.ts's
    // doc comment) — null for Macs or an unrecognized model, in which case
    // gdmfBestTarget/gdmfActiveRsr fall back to the same fleet-wide
    // comparison this always used before hardwareMatched existed.
    const deviceIdentifiers = platform === "apple" ? resolveAppleHardwareIdentifiers(deviceModel, appleIdCatalog ?? null) : null;
    const gdmfTarget = gdmfCatalog ? gdmfBestTarget(platform, deviceIdentifiers, gdmfCatalog) : null;
    if (gdmfTarget?.productVersion) {
      result.latestKnownVersion = gdmfTarget.productVersion;
      result.latestKnownBuild = gdmfTarget.build;
      result.updateExpirationDate = gdmfTarget.expirationDate;
      result.hardwareMatched = gdmfTarget.hardwareMatched;
    }
    result.onLatestVersion = result.latestKnownVersion ? versionCompareGte(osVersion, result.latestKnownVersion) : null;
    result.rapidSecurityResponse = gdmfCatalog ? gdmfActiveRsr(platform, osVersion, deviceIdentifiers, gdmfCatalog) : null;
  }
  return result;
}

function versionCompareGte(a: string, b: string): boolean {
  const av = versionTuple(a);
  const bv = versionTuple(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const x = av[i] ?? 0, y = bv[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
