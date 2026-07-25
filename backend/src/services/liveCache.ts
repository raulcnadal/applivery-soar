/**
 * In-process TTL cache for live Applivery API pulls, keyed by
 * "{workspaceSlug}:{source}" — direct port of main.py's `_live_cache_get` /
 * `_live_cache_set` / `_live_cache_invalidate` (main.py:564-599). Same
 * rationale as the original: several widgets/views can all want the same
 * live Applivery data within a few seconds of each other (dashboard load,
 * compliance scheduler, Devices view), so this caches per (slug, source)
 * rather than letting each caller hit the Applivery API independently.
 *
 * In-memory only (never persisted) — a restart just means the next read is
 * a live pull, same as the original process-local dict.
 */

interface CacheEntry {
  data: unknown;
  expiresAtMs: number;
}

// 5 minutes — fresh enough for a dashboard, safe for the API (main.py:568).
export const LIVE_CACHE_TTL_SECONDS = 300;
// The full device-list pull gets its own longer TTL (main.py:576) — it's
// the most expensive/most-triggered live fetch, re-requested by the
// (future) compliance scheduler every 10 minutes and used as the Devices
// view/dashboard/Playground fallback.
export const DEVICES_CACHE_TTL_SECONDS = 900;

const cache = new Map<string, CacheEntry>();

function cacheKey(workspaceSlug: string, source: string): string {
  return `${workspaceSlug}:${source}`;
}

export function liveCacheGet<T = unknown>(workspaceSlug: string, source: string): T | null {
  const entry = cache.get(cacheKey(workspaceSlug, source));
  if (entry && entry.expiresAtMs > Date.now()) {
    return entry.data as T;
  }
  return null;
}

export function liveCacheSet(workspaceSlug: string, source: string, data: unknown, ttlSeconds = LIVE_CACHE_TTL_SECONDS): void {
  cache.set(cacheKey(workspaceSlug, source), { data, expiresAtMs: Date.now() + ttlSeconds * 1000 });
}

export function liveCacheInvalidateSource(workspaceSlug: string, source: string): void {
  cache.delete(cacheKey(workspaceSlug, source));
}

/** Clears every cached entry for a workspace (main.py's `_live_cache_invalidate`). */
export function liveCacheInvalidateWorkspace(workspaceSlug: string): void {
  const prefix = `${workspaceSlug}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
