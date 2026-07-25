import { appliveryClient } from "../../services/appliveryClient";

/**
 * Port of `_create_script_asset` (main.py:8557-8580) — POSTs a new script
 * Asset with real file content to upload.applivery.io (a DIFFERENT host
 * than the normal api.applivery.io API — confirmed via Applivery's OpenAPI
 * schema; asset creation is genuine multipart/form-data, not JSON, despite
 * what api.applivery.io's own "Add new asset" page schema suggests). Shared
 * by Script Assets (create/edit), Script Repos (import), and Firewall Rule
 * Sets (auto-provisioned Apply/Restore scripts).
 */

const SCRIPT_EXTENSION_BY_PLATFORM: Record<string, string> = { windows: "ps1", macos: "sh" };

export function scriptAssetFilename(name: string, platform: string): string {
  const base = (name || "script").replace(/[^a-zA-Z0-9_\-. ]/g, "").trim() || "script";
  const ext = SCRIPT_EXTENSION_BY_PLATFORM[platform] ?? "sh";
  return `${base}.${ext}`;
}

export interface CreatedScriptAsset {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface CreateScriptAssetResult {
  asset: CreatedScriptAsset | null;
  error: string | null;
}

/**
 * `segmentId` defaults to 0 (the Global/root segment) when omitted — new
 * scripts should be reachable from workflows regardless of which segment a
 * target device belongs to. `exposeToChildren` mirrors Applivery's own
 * field: whether descendant segments can see/use this Asset.
 */
export async function createScriptAsset(
  authorization: string,
  uploadBase: string,
  name: string,
  description: string,
  content: string,
  platform: string,
  segmentId?: number | null,
  exposeToChildren?: boolean | null,
): Promise<CreateScriptAssetResult> {
  const filename = scriptAssetFilename(name, platform);
  const form = new FormData();
  form.append("name", name);
  form.append("description", description || "");
  form.append("segmentId", String(segmentId ?? 0));
  if (exposeToChildren !== undefined && exposeToChildren !== null) {
    form.append("exposeToChildren", exposeToChildren ? "true" : "false");
  }
  form.append("file", new Blob([content || ""], { type: "text/plain" }), filename);

  try {
    const res = await appliveryClient.request({
      method: "POST",
      url: `${uploadBase}/mdm/assets`,
      data: form,
      headers: { Authorization: authorization },
      timeout: 30_000,
    });
    if (res.status >= 300) {
      return { asset: null, error: `Applivery returned ${res.status}: ${String(JSON.stringify(res.data ?? "")).slice(0, 300)}` };
    }
    return { asset: ((res.data as any)?.data as CreatedScriptAsset) ?? null, error: null };
  } catch (e) {
    return { asset: null, error: `Upload to Applivery failed: ${e instanceof Error ? e.message : e}` };
  }
}

/** 'MyScript' -> 'MyScript v2'; 'MyScript v2' -> 'MyScript v3'. Port of `_next_version_name` (main.py:8582). */
export function nextVersionName(name: string): string {
  const m = /^(.*)\sv(\d+)$/.exec((name || "").trim());
  if (m) return `${m[1]} v${Number(m[2]) + 1}`;
  return `${(name || "").trim()} v2`;
}
