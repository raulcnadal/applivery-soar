/**
 * Shared fleet-platform -> vulnerability-source-platform mapping, used by
 * both vulnService.ts (Applivery Vulnerability Service Worker) and
 * mispService.ts (MISP connector) so their cache keys
 * (`${identifier}|${version}|${platform}`) are byte-for-byte identical and
 * can be merged. Pulled out to its own file rather than exported from either
 * module so neither has to import the other (avoids a circular dependency
 * between the two — mispService.ts's merge helpers live in vulnService.ts,
 * which would otherwise need to import mispService.ts, which would need to
 * import vulnService.ts right back for this constant).
 */
export const PLATFORM_MAP: Record<string, string> = { macos: "macos", apple: "ios", android: "android", aosp: "android", windows: "windows" };
