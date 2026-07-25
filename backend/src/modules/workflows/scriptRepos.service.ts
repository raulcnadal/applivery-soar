import axios from "axios";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { resolveOrgBase } from "../auth/rbac.service";
import { createScriptAsset } from "./scriptAssetUpload";

/**
 * External Git script repos — lets an admin point the Script Library at any
 * public GitHub repo of script files and browse/import from it. Uses
 * GitHub's public Contents API (no auth required for public repos; an
 * optional GITHUB_TOKEN env var raises the otherwise-low unauthenticated
 * rate limit). Port of main.py:8700-8872.
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const SCRIPT_REPO_EXTENSIONS: Record<string, string> = {
  ps1: "windows", bat: "windows", cmd: "windows", psm1: "windows",
  sh: "macos", command: "macos", zsh: "macos", bash: "macos",
};

export async function listScriptRepos(workspaceSlug: string) {
  return prisma.scriptRepo.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
}

export interface ScriptRepoPayload {
  name: string;
  owner: string;
  repo: string;
  branch?: string | null;
  path?: string | null;
}

export async function createScriptRepo(workspaceSlug: string, payload: ScriptRepoPayload, actorEmail: string) {
  const created = await prisma.scriptRepo.create({
    data: {
      workspaceSlug, name: payload.name, owner: payload.owner, repo: payload.repo,
      branch: payload.branch || "main", path: payload.path || "",
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "workflow", action: "script_repo_connected", actor: actorEmail,
    targetType: "script_repo", targetId: created.id, targetName: created.name,
    message: `Connected script repo "${created.name}" (${created.owner}/${created.repo})`,
  });
  return created;
}

export async function deleteScriptRepo(workspaceSlug: string, repoId: string) {
  await prisma.scriptRepo.deleteMany({ where: { workspaceSlug, id: repoId } });
  return { status: "ok" };
}

export interface ScriptRepoBrowseItem {
  name: string;
  path: string;
  type: string;
  downloadUrl: string | null;
  sizeBytes: number | null;
  importable: boolean;
  inferredPlatform: string | null;
}

/** Lists one directory of a connected repo via GitHub's Contents API. Port of `browse_script_repo` (main.py:8766-8806). */
export async function browseScriptRepo(workspaceSlug: string, repoId: string, pathOverride: string | null | undefined): Promise<{ path: string; items: ScriptRepoBrowseItem[] }> {
  const repo = await prisma.scriptRepo.findFirst({ where: { workspaceSlug, id: repoId } });
  if (!repo) throw new HttpError(404, "Script repo not found");
  const effectivePath = pathOverride !== null && pathOverride !== undefined ? pathOverride : (repo.path || "");

  const ghHeaders: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${effectivePath.replace(/^\//, "")}`;

  let res;
  try {
    res = await axios.get(url, { headers: ghHeaders, params: { ref: repo.branch || "main" }, validateStatus: () => true, timeout: 20_000 });
  } catch (e) {
    throw new HttpError(502, `GitHub request failed: ${e instanceof Error ? e.message : e}`);
  }
  if (res.status === 404) throw new HttpError(404, `Path not found in ${repo.owner}/${repo.repo}: '${effectivePath}'`);
  if (res.status === 403) throw new HttpError(502, "GitHub rate-limited this request — try again in a bit, or set a GITHUB_TOKEN on the server for a higher limit.");
  if (res.status >= 300) throw new HttpError(502, `GitHub returned ${res.status}: ${String(JSON.stringify(res.data ?? "")).slice(0, 200)}`);

  const raw = res.data;
  const entries: any[] = Array.isArray(raw) ? raw : [raw];
  const items: ScriptRepoBrowseItem[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const name: string = e.name || "";
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    items.push({
      name, path: e.path || "", type: e.type || "file",
      downloadUrl: e.download_url ?? null, sizeBytes: e.size ?? null,
      importable: e.type === "file" && ext in SCRIPT_REPO_EXTENSIONS,
      inferredPlatform: SCRIPT_REPO_EXTENSIONS[ext] ?? null,
    });
  }
  items.sort((a, b) => {
    const dirCmp = Number(a.type !== "dir") - Number(b.type !== "dir");
    if (dirCmp !== 0) return dirCmp;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return { path: effectivePath, items };
}

export interface ScriptRepoImportFile {
  name: string;
  path?: string;
  downloadUrl?: string | null;
  inferredPlatform?: string | null;
}

/**
 * For each selected repo file: downloads its raw content from GitHub,
 * uploads it to Applivery as a new script Asset, and adds a matching local
 * Action Library entry. Best-effort per file — one failure doesn't block
 * the rest. Port of `import_from_script_repo` (main.py:8813-8872).
 */
export async function importFromScriptRepo(
  authorization: string,
  workspaceSlug: string,
  repoId: string,
  files: ScriptRepoImportFile[],
  segmentId: number | null | undefined,
  actorEmail: string,
) {
  const headers = { Authorization: authorization };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const uploadBase = orgBase.replace("https://api.applivery.io", "https://upload.applivery.io");

  const imported: Array<Record<string, unknown>> = [];
  const failed: Array<{ name?: string; error: string }> = [];

  for (const f of files) {
    const { name, downloadUrl, inferredPlatform: platform } = f;
    if (!downloadUrl) {
      failed.push({ name, error: "No downloadable content for this file" });
      continue;
    }
    if (platform !== "windows" && platform !== "macos") {
      failed.push({ name, error: "Could not infer platform (.ps1/.bat/.cmd → Windows, .sh/.command → macOS) — skip and add manually" });
      continue;
    }
    let contentText: string;
    try {
      const contentRes = await axios.get(downloadUrl, { timeout: 20_000, validateStatus: () => true, responseType: "text" });
      if (contentRes.status >= 300) {
        failed.push({ name, error: `Download failed (${contentRes.status})` });
        continue;
      }
      contentText = typeof contentRes.data === "string" ? contentRes.data : JSON.stringify(contentRes.data);
    } catch (e) {
      failed.push({ name, error: `Download failed: ${e instanceof Error ? e.message : e}` });
      continue;
    }

    const displayName = name && name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name || "script";
    const { asset, error } = await createScriptAsset(authorization, uploadBase, displayName, `Imported from ${repoId}`, contentText, platform, segmentId ?? undefined);
    if (error || !asset) {
      failed.push({ name, error: error ?? "Upload failed" });
      continue;
    }

    const created = await prisma.actionLibraryEntry.create({
      data: {
        workspaceSlug, type: "script", name: displayName, description: "Imported from Git repo",
        platform, assetId: asset.id, assetName: asset.name || displayName, arguments: "", scope: "machine",
      },
    });
    imported.push(created);
  }

  if (imported.length) {
    await recordAuditEvent(workspaceSlug, {
      category: "workflow", action: "script_repo_import", actor: actorEmail,
      message: `Imported ${imported.length} script${imported.length !== 1 ? "s" : ""} from a Git repo into the Script & OMA-URI library`
        + (failed.length ? `; ${failed.length} failed` : ""),
    });
  }
  return { imported, failed };
}
