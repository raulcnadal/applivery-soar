import axios from "axios";

/**
 * CPE translation middleware — resolves a fleet-reported app name/identifier
 * or OS platform into a CPE 2.3 vendor:product pair, so mispService.ts can
 * build a proper `cpe:2.3:<part>:<vendor>:<product>` search value instead of
 * matching MISP attributes on raw, inconsistent app names. This is the
 * "translation layer" the user asked for, built around cpe-guesser
 * (https://github.com/cve-search/cpe-guesser), the same tool they proposed.
 *
 * Two intentional design choices, made without a further round-trip since
 * they're implementation details rather than open product questions:
 *
 * 1. Defaults to the public https://cpe-guesser.cve-search.org instance
 *    (run by CIRCL, the CVE-Search project). It only ever receives an app
 *    name/vendor keyword list — never device identifiers, users, or IPs —
 *    but it IS a third-party network call, so `cpeGuesserBaseUrl` on
 *    MispConfig lets a workspace point at a self-hosted instance instead
 *    (cpe-guesser is a small, self-hostable Flask+Valkey service).
 * 2. cpe-guesser only guesses vendor:product from keywords — it has no
 *    concept of "this is the macOS build" vs "this is the Windows build" of
 *    the same product name, and no version awareness at all. Version and
 *    platform/target_sw are things WE already know from fleet inventory, so
 *    they're layered on by the caller (mispService.ts) after this module
 *    returns the vendor:product guess, not guessed here.
 */

const CPE_GUESSER_DEFAULT_BASE = "https://cpe-guesser.cve-search.org";

const STOPWORDS = new Set(["app", "application", "inc", "llc", "corp", "corporation", "ltd", "the", "for", "and"]);

export type CpePart = "a" | "o";

export interface CpeGuessResult {
  vendor: string;
  product: string;
  /** cpe:2.3:<part>:<vendor>:<product> — no version, no trailing wildcards. */
  raw: string;
}

/** Splits a free-text app/OS name into keyword(s) suitable for cpe-guesser's ranked inverse index. */
export function splitKeywords(text: string): string[] {
  return (text || "")
    .replace(/[_\-.]+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// cpe-guesser resolves *products*, not OS versions — so OS lookups are
// seeded with the vendor+product pair the NVD CPE dictionary actually uses
// for each platform (cpe:2.3:o:apple:mac_os_x, cpe:2.3:o:apple:iphone_os,
// cpe:2.3:o:google:android, cpe:2.3:o:microsoft:windows_10 or similar),
// rather than our own internal platform keys.
const OS_KEYWORDS: Record<string, string[]> = {
  macos: ["apple", "mac", "os", "x"],
  ios: ["apple", "iphone", "os"],
  android: ["google", "android"],
  windows: ["microsoft", "windows"],
};

export function osKeywordsFor(platform: string): string[] {
  return OS_KEYWORDS[platform] ?? [platform];
}

// The vendor half of an OS CPE guess is never actually ambiguous — we know
// Apple/Google/Microsoft own these platforms outright, it's only the
// PRODUCT string (mac_os_x vs iphone_os, windows_10 vs windows_11, ...)
// that legitimately needs cpe-guesser's index. Found via a real report:
// an iPhone on a recent iOS build showed a pile of decade-old Adobe Flash
// Player CVEs under its OS-level Vulnerability Service section — a device
// with zero Flash Player exposure by any measure. cpe-guesser's `/search`
// ranks a free-text keyword query against its whole CPE index; short,
// extremely common OS keywords like "os" or "iphone" apparently rank some
// unrelated product's CPE above the real one for at least one CPE-guesser
// deployment, and callers (mispService.ts/vulncheckService.ts) were trusting
// the top-ranked hit unconditionally for OS lookups. Since we already know
// the correct vendor deterministically for the 4 platforms we ever look up
// an OS CPE for, this catches exactly that failure mode: reject a guess
// whose vendor doesn't match, treating the combo as unmapped (same as
// cpe-guesser returning nothing) rather than feeding a wrong vendor:product
// pair into a real CVE search. Never applied to app lookups — those
// legitimately span thousands of unpredictable vendors cpe-guesser has to
// resolve from scratch, there's no known-good answer to check against.
const EXPECTED_OS_VENDOR: Record<string, string> = { macos: "apple", ios: "apple", android: "google", windows: "microsoft" };

export function isPlausibleOsCpeGuess(platform: string, guessed: CpeGuessResult): boolean {
  const expected = EXPECTED_OS_VENDOR[platform];
  return !expected || guessed.vendor.toLowerCase() === expected;
}

export function appKeywordsFor(name: string | null | undefined, identifier: string): string[] {
  const fromName = splitKeywords(name ?? "");
  if (fromName.length) return fromName;
  return splitKeywords(identifier);
}

/**
 * Calls cpe-guesser's `/search` endpoint (`{"query": [...], "part": "a"|"o"}`)
 * and returns its top-ranked vendor:product guess, or null if it couldn't
 * guess anything or the service is unreachable — callers treat that the same
 * as "not mapped", exactly like an unmapped Vulnerability Service combo.
 */
export async function guessCpe(baseUrl: string, keywords: string[], part: CpePart, timeoutMs = 8000): Promise<CpeGuessResult | null> {
  if (!keywords.length) return null;
  const base = (baseUrl || CPE_GUESSER_DEFAULT_BASE).replace(/\/+$/, "");
  try {
    const res = await axios.post(`${base}/search`, { query: keywords, part }, { timeout: timeoutMs, validateStatus: () => true });
    if (res.status !== 200 || !Array.isArray(res.data) || res.data.length === 0) return null;
    // Response shape: [[rank, "cpe:2.3:<part>:<vendor>:<product>"], ...],
    // best match first.
    const first = res.data[0];
    const cpe = Array.isArray(first) ? first[1] : null;
    if (typeof cpe !== "string") return null;
    const segments = cpe.split(":");
    const vendor = segments[3];
    const product = segments[4];
    if (!vendor || !product) return null;
    return { vendor, product, raw: `cpe:2.3:${part}:${vendor}:${product}` };
  } catch {
    return null;
  }
}
