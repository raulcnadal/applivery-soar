import axios from "axios";
import { loadGlobalCatalog, saveGlobalCatalog } from "../../services/globalCatalog";

/**
 * Apple hardware-identifier resolver — new, not a main.py port.
 *
 * gdmfCatalog.ts's `SupportedDevices` list (Apple's own GDMF feed) is keyed
 * by internal hardware identifiers ("iPhone12,5"), never marketing names.
 * Applivery's device API only ever gives us the marketing name ("iPhone 11
 * Pro Max", sometimes prefixed "Apple iPhone 11 Pro Max") — confirmed no
 * `modelIdentifier`/`hardwareModel`-style raw field exists anywhere in
 * deviceNormalize.ts's harvest of the raw payload. Without a name→identifier
 * bridge, `gdmfBestTarget`'s `.includes(deviceModel)` check can never match,
 * so every Apple device permanently falls back to the fleet-wide "best
 * across all currently-signed releases" comparison and the UI shows
 * "Hardware match Unconfirmed" — that's a *correct* fallback (Apple ships
 * one unified build for all currently-supported iPhones almost always), just
 * an imprecise one when hardware-specific signing windows genuinely differ.
 *
 * api.ipsw.me/v4/devices is a free, public, unauthenticated, CORS-open feed
 * (used by many open-source jailbreak/firmware tools) that lists every
 * {name, identifier} pair Apple has ever shipped for iPhone/iPad/iPod
 * touch/Apple TV/Apple Watch — exactly the marketing-name → identifier
 * mapping needed here. It does not cover Mac hardware (Macs don't have IPSW
 * firmware in the same sense), so `resolveAppleHardwareIdentifiers` only
 * ever returns matches for iOS-family models; macOS devices keep the
 * existing fleet-wide fallback unchanged.
 */

const IPSW_DEVICES_URL = "https://api.ipsw.me/v4/devices";
export const APPLE_DEVICE_IDENTIFIERS_TICK_MS = 604_800_000; // weekly — new hardware ships a few times a year at most

export interface AppleDeviceIdentifiersCatalog {
  /** normalized (lowercased, "apple " prefix stripped) marketing name -> hardware identifier(s). An array because a couple of marketing names (e.g. regional dual-SIM variants) map to more than one identifier. */
  nameToIdentifiers: Record<string, string[]>;
  lastFetchedAt: string | null;
  lastError: string | null;
}

export async function loadAppleDeviceIdentifiers(): Promise<AppleDeviceIdentifiersCatalog> {
  return loadGlobalCatalog("apple_device_identifiers", () => ({ nameToIdentifiers: {}, lastFetchedAt: null, lastError: null }));
}

function normalizeModelName(name: string): string {
  return name.trim().toLowerCase().replace(/^apple\s+/, "");
}

export async function refreshAppleDeviceIdentifiers(): Promise<AppleDeviceIdentifiersCatalog> {
  const catalog = await loadAppleDeviceIdentifiers();
  try {
    const resp = await axios.get(IPSW_DEVICES_URL, { timeout: 30000, validateStatus: () => true });
    if (resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
    const rows = resp.data;
    if (!Array.isArray(rows)) throw new Error("unexpected response shape (not an array)");
    const map: Record<string, string[]> = {};
    for (const row of rows) {
      const name = row?.name;
      const identifier = row?.identifier;
      if (typeof name !== "string" || typeof identifier !== "string") continue;
      const key = normalizeModelName(name);
      (map[key] ??= []).push(identifier);
    }
    if (!Object.keys(map).length) throw new Error("parsed 0 devices");
    catalog.nameToIdentifiers = map;
    catalog.lastFetchedAt = new Date().toISOString();
    catalog.lastError = null;
  } catch (e) {
    console.warn(`[Apple Device Identifiers] Fetch failed: ${e}`);
    if (!Object.keys(catalog.nameToIdentifiers ?? {}).length) catalog.lastError = `No device identifier data fetched yet: ${e}`;
  }
  await saveGlobalCatalog("apple_device_identifiers", catalog);
  return catalog;
}

/** Resolve a device's reported marketing name to Apple hardware identifier(s), or null if unresolvable (unknown model, or a Mac — see module doc comment). */
export function resolveAppleHardwareIdentifiers(deviceModel: string | null | undefined, catalog: AppleDeviceIdentifiersCatalog | null): string[] | null {
  if (!deviceModel || !catalog) return null;
  const ids = (catalog.nameToIdentifiers ?? {})[normalizeModelName(deviceModel)];
  return ids && ids.length ? ids : null;
}
