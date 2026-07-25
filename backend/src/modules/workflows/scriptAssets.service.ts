import { appliveryClient } from "../../services/appliveryClient";
import { resolveOrgBase } from "../auth/rbac.service";
import { prisma } from "../../services/prisma";
import { HttpError } from "../../utils/httpError";
import { recordAuditEvent } from "../../services/auditLog";
import { createScriptAsset, nextVersionName } from "./scriptAssetUpload";

/**
 * Script Assets — powers the Script & OMA-URI Library's script picker/
 * bulk-import browser/in-app editor. Port of main.py:8414-8698. Scripts live
 * in Applivery's general Asset library (Resources > Scripts in the
 * Dashboard), not inside a Policy.
 */

export interface ScriptAssetSummary {
  id: string;
  name: string;
  description: string;
  platform?: string;
  alreadyInLibrary?: boolean;
}

/**
 * Port of `_search_script_assets` (main.py:8421-8449). No documented
 * server-side text search on Applivery's GET .../mdm/assets — a batch is
 * fetched (filtered by `type=script`/`subType`) and text-filtered
 * client-side, same approach as the Homebrew/Android catalog search.
 */
async function searchScriptAssets(
  headers: Record<string, string>,
  orgBase: string,
  platform: "windows" | "macos" | "all",
  text: string,
  limit = 100,
): Promise<{ items: ScriptAssetSummary[]; error: string | null }> {
  const params: Record<string, string | number> = { type: "script", limit };
  if (platform !== "all") params.subType = platform === "macos" ? "macos" : "windows";
  let res;
  try {
    res = await appliveryClient.get(`${orgBase}/mdm/assets`, { headers, params });
  } catch (e) {
    return { items: [], error: `Request to Applivery failed: ${e instanceof Error ? e.message : e}` };
  }
  if (res.status >= 300) {
    return { items: [], error: `Applivery returned ${res.status}: ${String(JSON.stringify(res.data ?? "")).slice(0, 200)}` };
  }
  let items: any[];
  try {
    items = ((res.data as any)?.data?.items as any[]) ?? [];
  } catch (e) {
    return { items: [], error: `Could not parse Applivery's response: ${e}` };
  }
  const textLower = (text || "").trim().toLowerCase();
  const out: ScriptAssetSummary[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !item.id) continue;
    const name: string = item.name || "";
    if (textLower && !name.toLowerCase().includes(textLower)) continue;
    out.push({ id: item.id, name, description: item.description || "" });
  }
  return { items: out, error: null };
}

export async function searchScriptAssetsForPicker(authorization: string, workspaceSlug: string, platform: string, text: string) {
  if (platform !== "windows" && platform !== "macos") throw new HttpError(400, "platform must be 'windows' or 'macos'");
  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const { items, error } = await searchScriptAssets(headers, orgBase, platform, text, 25);
  return { items: items.slice(0, 25), error };
}

/**
 * Bulk-fetch browser for "Fetch from Applivery" import — deliberately no
 * text filter and a much higher cap. Port of main.py:8471-8504.
 */
export async function browseScriptAssets(authorization: string, workspaceSlug: string, platform: string) {
  if (!["windows", "macos", "all"].includes(platform)) throw new HttpError(400, "platform must be 'windows', 'macos', or 'all'");
  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const platformsToFetch: Array<"windows" | "macos"> = platform === "all" ? ["windows", "macos"] : [platform as "windows" | "macos"];
  const errors: string[] = [];
  let allItems: ScriptAssetSummary[] = [];
  for (const p of platformsToFetch) {
    const { items, error } = await searchScriptAssets(headers, orgBase, p, "", 500);
    for (const it of items) it.platform = p;
    allItems = allItems.concat(items);
    if (error) errors.push(error);
  }
  const localLibrary = await prisma.actionLibraryEntry.findMany({ where: { workspaceSlug, type: "script", assetId: { not: null } }, select: { assetId: true } });
  const alreadyImported = new Set(localLibrary.map((e) => e.assetId));
  for (const it of allItems) it.alreadyInLibrary = alreadyImported.has(it.id);
  return { items: allItems, error: errors.length && !allItems.length ? errors.join("; ") : null };
}

/** Fetches a script Asset's raw source text via Applivery's undocumented .../mdm/assets/:id/view endpoint. Port of main.py:8506-8531. */
export async function getScriptAssetContent(authorization: string, workspaceSlug: string, assetId: string) {
  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  let res;
  try {
    res = await appliveryClient.get(`${orgBase}/mdm/assets/${assetId}/view`, { headers });
  } catch (e) {
    throw new HttpError(502, `Request to Applivery failed: ${e instanceof Error ? e.message : e}`);
  }
  if (res.status >= 300) throw new HttpError(502, `Applivery returned ${res.status}: ${String(JSON.stringify(res.data ?? "")).slice(0, 200)}`);
  const data = (res.data as any)?.data ?? {};
  return { content: data.content || "", url: data.url };
}

export interface ScriptAssetCreatePayload {
  name: string;
  description?: string | null;
  platform: "windows" | "macos";
  content: string;
  segmentId?: number | null;
  exposeToChildren?: boolean | null;
}

/** Port of `create_script_asset` (main.py:8597-8624). Uploads brand-new script source as a new Applivery Asset — does not touch the local Action Library. */
export async function createNewScriptAsset(authorization: string, workspaceSlug: string, payload: ScriptAssetCreatePayload, actorEmail: string) {
  if (payload.platform !== "windows" && payload.platform !== "macos") throw new HttpError(400, "platform must be 'windows' or 'macos'");
  if (!payload.content.trim()) throw new HttpError(400, "Script content cannot be empty");
  const headers = { Authorization: authorization };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const uploadBase = orgBase.replace("https://api.applivery.io", "https://upload.applivery.io");
  const { asset, error } = await createScriptAsset(authorization, uploadBase, payload.name, payload.description ?? "", payload.content, payload.platform, payload.segmentId, payload.exposeToChildren ?? true);
  if (error || !asset) throw new HttpError(502, error ?? "Upload failed");
  await recordAuditEvent(workspaceSlug, {
    category: "workflow", action: "script_asset_created", actor: actorEmail,
    targetType: "script_asset", targetId: asset.id, targetName: asset.name,
    message: `Created script Asset "${asset.name}" on Applivery (${payload.platform})`,
  });
  return asset;
}

export interface ScriptAssetEditPayload {
  name?: string | null;
  description?: string | null;
  platform: "windows" | "macos";
  content: string;
  segmentId?: number | null;
  exposeToChildren?: boolean | null;
}

/**
 * "Editing" an existing script Asset — Applivery has no content-replace
 * endpoint, so this uploads the edited content as a new Asset (" vN" suffix)
 * and repoints every local Action Library entry that referenced the old
 * Asset id to the new one. The old Asset is deliberately left in place, not
 * deleted. Port of `edit_script_asset` (main.py:8634-8698).
 */
export async function editScriptAsset(authorization: string, workspaceSlug: string, assetId: string, payload: ScriptAssetEditPayload, actorEmail: string) {
  if (payload.platform !== "windows" && payload.platform !== "macos") throw new HttpError(400, "platform must be 'windows' or 'macos'");
  if (!payload.content.trim()) throw new HttpError(400, "Script content cannot be empty");
  const headers = { Authorization: authorization };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const uploadBase = orgBase.replace("https://api.applivery.io", "https://upload.applivery.io");

  let currentName = payload.name ?? null;
  let currentDescription = payload.description ?? null;
  let currentSegmentId = payload.segmentId ?? null;
  let currentExpose = payload.exposeToChildren ?? null;
  if (currentName === null || currentDescription === null || currentSegmentId === null || currentExpose === null) {
    try {
      const getRes = await appliveryClient.get(`${orgBase}/mdm/assets/${assetId}`, { headers });
      if (getRes.status < 300) {
        const current = (getRes.data as any)?.data ?? {};
        currentName = currentName ?? current.name ?? null;
        currentDescription = currentDescription !== null ? currentDescription : current.description ?? null;
        currentSegmentId = currentSegmentId !== null ? currentSegmentId : current.segmentId ?? null;
        currentExpose = currentExpose !== null ? currentExpose : current.exposeToChildren ?? null;
      }
    } catch {
      /* best-effort — fall through with whatever was explicitly provided */
    }
  }
  currentName = currentName || "script";
  const newName = nextVersionName(currentName);

  const { asset, error } = await createScriptAsset(authorization, uploadBase, newName, currentDescription || "", payload.content, payload.platform, currentSegmentId, currentExpose);
  if (error || !asset) throw new HttpError(502, error ?? "Upload failed");

  const library = await prisma.actionLibraryEntry.findMany({ where: { workspaceSlug, type: "script", assetId } });
  const repointed: string[] = [];
  for (const entry of library) {
    await prisma.actionLibraryEntry.update({ where: { id: entry.id }, data: { assetId: asset.id, assetName: asset.name } });
    repointed.push(entry.id);
  }

  await recordAuditEvent(workspaceSlug, {
    category: "workflow", action: "script_asset_edited", actor: actorEmail,
    targetType: "script_asset", targetId: asset.id, targetName: asset.name,
    message: `Edited script "${currentName}" — saved as new Applivery Asset "${newName}" (previous version "${currentName}" left in place on Applivery)`
      + (repointed.length ? `; ${repointed.length} library entr${repointed.length === 1 ? "y" : "ies"} repointed` : ""),
  });
  return { asset, repointedLibraryEntryIds: repointed };
}
