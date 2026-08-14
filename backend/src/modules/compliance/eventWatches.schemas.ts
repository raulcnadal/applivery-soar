import { z } from "zod";
import { HttpError } from "../../utils/httpError";

/**
 * Admin-defined event-driven detection watches — disclosed new feature (no
 * main.py equivalent). See eventWatches.service.ts's module doc for the full
 * design; this file only owns payload validation + the per-watchType params
 * contract the Windows SOAR Agent (separate repo) implements watchers
 * against. Mirrors customChecks.schemas.ts's shape deliberately — same
 * "admin authors in Settings, agent polls read-only" feature class.
 */

// Only "registryKey" for now — RegNotifyChangeKeyValue against an
// admin-specified key (the mechanism this ships with). "etwProvider" is a
// later phase (see the roadmap doc) and deliberately not accepted yet: the
// Windows Agent has no ETW consumer built, so a watch of that type would
// silently never fire.
export const WATCH_TYPES = ["registryKey"] as const;
export type WatchType = (typeof WATCH_TYPES)[number];

// "macos" is intentionally not offered yet — no macOS agent support exists
// for this feature (see the roadmap doc's Phase 5, explicitly deferred).
export const WATCH_PLATFORMS = ["windows"] as const;
export type WatchPlatform = (typeof WATCH_PLATFORMS)[number];

// What SOAR does when the agent's own local debounce goes quiet and calls
// POST /api/device-data/event-notify. Stored per-watch (not inferred from
// watchKey string-matching) so a new watch is fully usable from Settings
// alone — see the Prisma model's own doc comment (schema.prisma).
export const WATCH_ACTIONS = ["refreshInstalledApps", "evaluateComplianceNow"] as const;
export type WatchAction = (typeof WATCH_ACTIONS)[number];

export const eventWatchPayloadSchema = z.object({
  platform: z.enum(WATCH_PLATFORMS),
  // Stable identifier the agent's config poll and its later event-notify
  // call both reference — auto-derived from `name` when omitted (see
  // slugifyWatchKey), editable so an admin can rename a watch without
  // breaking an agent that's already watching it (the agent re-syncs its
  // watcher set against `key`, not `id`, every poll cycle).
  key: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/i, "Key may only contain letters, numbers, - and _").optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullish(),
  watchType: z.enum(WATCH_TYPES),
  params: z.record(z.any()).default({}),
  // Matches the enhancement request's own spec verbatim: "it starts a
  // 5-second countdown timer" — 5000ms is the default every new watch gets,
  // editable per-watch from 1s (fast, riskier of an event storm if the
  // underlying signal is itself noisy) to 60s (slow, but still miles ahead
  // of the hour-plus full poll cycle it supplements).
  debounceMs: z.number().int().min(1000).max(60_000).default(5000),
  action: z.enum(WATCH_ACTIONS),
  enabled: z.boolean().default(true),
});
export type EventWatchPayload = z.infer<typeof eventWatchPayloadSchema>;

export function slugifyWatchKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * The params shape a watcher needs is entirely determined by `watchType` —
 * validated here as plain app code (same "loose Json, app-code-validated"
 * convention as CustomCheckDefinition/CompliancePolicy.conditions), not as a
 * Zod discriminated union, so it composes simply with the watchType-scoped
 * create/update form on the frontend. Throws HttpError(400, ...) naming
 * exactly which key is missing/wrong.
 */
export function validateWatchParams(watchType: WatchType, params: Record<string, unknown>): void {
  switch (watchType) {
    case "registryKey": {
      const hive = params?.hive;
      if (hive !== "HKLM" && hive !== "HKCU") throw new HttpError(400, "Hive must be HKLM or HKCU.");
      const path = params?.path;
      if (typeof path !== "string" || !path.trim()) throw new HttpError(400, "Registry key path is required (e.g. SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall).");
      if (typeof params?.watchSubtree !== "boolean") throw new HttpError(400, "watchSubtree must be true or false.");
      return;
    }
    default:
      throw new HttpError(400, `Unknown watch type "${watchType}".`);
  }
}
