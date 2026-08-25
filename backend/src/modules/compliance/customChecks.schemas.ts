import { z } from "zod";
import { HttpError } from "../../utils/httpError";

/**
 * Admin-defined custom device checks — disclosed new feature (no main.py
 * equivalent). See customChecks.service.ts's module doc for the full design;
 * this file only owns payload validation + the per-(platform, checkerType)
 * params contract the two native agents (Windows/macOS, separate repos)
 * implement checkers against.
 */

export const CHECKER_TYPES = ["processRunning", "serviceStatus", "registryOrFileValue", "appInstalled", "command"] as const;
export type CheckerType = (typeof CHECKER_TYPES)[number];

// iOS/Android were originally included here with only "appInstalled" ever
// offered as a valid checkerType for them (see the removed
// MOBILE_CHECK_PLATFORMS/validateCheckParams branch this replaced) — but the
// SOAR Mobile Agent (separate repo) never actually implements ANY custom
// check: it has no method channel, no local probe, and never sends a
// customCheckResults field in its report payload (device_report_client.dart
// only ever sends platform/serialNumber/attributes/playIntegrityToken/
// reportedAt). So an iOS/Android "App installed" check could be created in
// the UI, looked completely valid, and would simply never produce a result
// — a dead, silently-never-matching option, not a working-but-limited one.
// Real installed-app data for iOS/Android already exists via the separate,
// actually-working App Lists feature (requiredAppList/disallowedAppList
// conditions, appLists/installedApps.service.ts), sourced from Apple/Android
// MDM's own installed-apps API — so removing mobile here isn't a capability
// loss, it's removing a redundant, non-functional path in favor of the one
// that already works. Only Windows/macOS agents (separate repos) actually
// poll this endpoint and execute checks locally.
export const CHECK_PLATFORMS = ["windows", "macos"] as const;
export type CheckPlatform = (typeof CHECK_PLATFORMS)[number];

export const customCheckPayloadSchema = z.object({
  platform: z.enum(CHECK_PLATFORMS),
  // Stable identifier a Compliance Policy condition references (the
  // "customCheckResult" field's value.key) — auto-derived from `name` when
  // omitted (see slugifyCheckKey), editable so an admin can rename a check
  // without breaking policies that already reference its key.
  key: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/i, "Key may only contain letters, numbers, - and _").optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullish(),
  checkerType: z.enum(CHECKER_TYPES),
  params: z.record(z.any()).default({}),
  enabled: z.boolean().default(true),
});
export type CustomCheckPayload = z.infer<typeof customCheckPayloadSchema>;

export function slugifyCheckKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * The params shape a checker needs is entirely determined by (platform,
 * checkerType) together — validated here as plain app code (same "loose
 * Json, app-code-validated" convention as CompliancePolicy.conditions /
 * ComplianceFieldDef's value shapes), not as a Zod discriminated union,
 * since it composes more simply with the platform-scoped create/update form
 * on the frontend. Throws HttpError(400, ...) with a message naming exactly
 * which key is missing/wrong — the admin authoring a check never sees a raw
 * Zod error here.
 */
export function validateCheckParams(platform: CheckPlatform, checkerType: CheckerType, params: Record<string, unknown>): void {
  const requireString = (key: string, label: string) => {
    const v = params?.[key];
    if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${label} is required for this check type.`);
  };

  switch (checkerType) {
    case "processRunning":
      requireString("processName", "Process name");
      return;
    case "serviceStatus":
      // Windows: Service name (sc.exe / Services.msc "Service name", not the
      // display name). macOS: launchd label (e.g. com.crowdstrike.falcon).
      requireString("serviceName", platform === "windows" ? "Service name" : "Launchd label");
      return;
    case "registryOrFileValue":
      if (platform === "windows") {
        requireString("registryPath", "Registry key path (under HKLM or HKCU)");
        requireString("valueName", "Registry value name");
      } else {
        requireString("path", "File or plist path");
        // plistKey is optional on macOS — omitted means "just check the file/path exists".
      }
      return;
    case "appInstalled":
      requireString("identifier", platform === "windows" ? "Winget package ID (or app display name)" : "Bundle identifier");
      return;
    case "command":
      requireString("command", "Command");
      return;
    default:
      throw new HttpError(400, `Unknown checker type "${checkerType}".`);
  }
}
