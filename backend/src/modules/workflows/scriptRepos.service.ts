import axios from "axios";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";
import { resolveOrgBase } from "../auth/rbac.service";
import { createScriptAsset } from "./scriptAssetUpload";

/**
 * External Git script repos — lets an admin point the Script Library at a
 * GitHub, GitLab, or "custom" (any GitHub-Contents-API-compatible self-
 * hosted server — GitHub Enterprise Server and Gitea both qualify) repo of
 * script files and browse/import from it. Public GitHub needs no auth (an
 * optional GITHUB_TOKEN env var raises the otherwise-low unauthenticated
 * rate limit); every other case — GitLab, a self-hosted/custom server, or a
 * private GitHub repo — uses the repo's own per-connection access token.
 * Port of main.py:8700-8872, extended for multi-vendor + private-repo
 * support.
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const SCRIPT_REPO_EXTENSIONS: Record<string, string> = {
  ps1: "windows", bat: "windows", cmd: "windows", psm1: "windows",
  sh: "macos", command: "macos", zsh: "macos", bash: "macos",
};

export type ScriptRepoVendor = "github" | "gitlab" | "custom";

function normalizeVendor(raw: string | null | undefined): ScriptRepoVendor {
  return raw === "gitlab" || raw === "custom" ? raw : "github";
}

/** Strips the encrypted token before anything reaches the frontend, replacing it with a plain "is one set" flag. */
function toPublicRepo(row: any) {
  const { tokenEncrypted, ...rest } = row;
  return { ...rest, hasToken: !!tokenEncrypted };
}

export async function listScriptRepos(workspaceSlug: string) {
  const rows = await prisma.scriptRepo.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
  return (rows as any[]).map(toPublicRepo);
}

export interface ScriptRepoPayload {
  name: string;
  vendor?: string;
  owner: string;
  repo: string;
  branch?: string | null;
  path?: string | null;
  baseUrl?: string | null;
  /** Plaintext in — encrypted before it's ever written to the database. */
  token?: string | null;
}

export async function createScriptRepo(workspaceSlug: string, payload: ScriptRepoPayload, actorEmail: string) {
  const vendor = normalizeVendor(payload.vendor);
  const created = await prisma.scriptRepo.create({
    data: {
      workspaceSlug, name: payload.name, vendor, owner: payload.owner, repo: payload.repo,
      branch: payload.branch || "main", path: payload.path || "",
      baseUrl: payload.baseUrl?.trim() || null,
      tokenEncrypted: payload.token?.trim() ? encryptSecret(payload.token.trim()) : null,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "workflow", action: "script_repo_connected", actor: actorEmail,
    targetType: "script_repo", targetId: created.id, targetName: created.name,
    message: `Connected ${vendor} script repo "${created.name}" (${created.owner}/${created.repo})${created.tokenEncrypted ? " with an access token" : ""}`,
  });
  return toPublicRepo(created);
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

function sortBrowseItems(items: ScriptRepoBrowseItem[]) {
  items.sort((a, b) => {
    const dirCmp = Number(a.type !== "dir") - Number(b.type !== "dir");
    if (dirCmp !== 0) return dirCmp;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

/** GitHub's Contents API and its lookalikes (GitHub Enterprise, Gitea) all share this request/response shape. */
async function browseGithubStyle(apiBase: string, owner: string, repoName: string, branch: string, effectivePath: string, token: string | undefined): Promise<{ path: string; items: ScriptRepoBrowseItem[] }> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `${apiBase.replace(/\/$/, "")}/repos/${owner}/${repoName}/contents/${effectivePath.replace(/^\//, "")}`;

  let res;
  try {
    res = await axios.get(url, { headers, params: { ref: branch || "main" }, validateStatus: () => true, timeout: 20_000 });
  } catch (e) {
    throw new HttpError(502, `Git host request failed: ${e instanceof Error ? e.message : e}`);
  }
  if (res.status === 404) throw new HttpError(404, `Path not found in ${owner}/${repoName}: '${effectivePath}'`);
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(502, token ? "Access denied — double-check the repo's access token and its permissions." : "Access denied — this looks like a private repo. Edit the connection and add an access token, or you may be rate-limited.");
  }
  if (res.status >= 300) throw new HttpError(502, `Git host returned ${res.status}: ${String(JSON.stringify(res.data ?? "")).slice(0, 200)}`);

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
  sortBrowseItems(items);
  return { path: effectivePath, items };
}

/** GitLab's Repository Tree API — a different shape (tree/blob, no download_url), so it gets its own request + mapping. */
async function browseGitlab(apiBase: string, owner: string, repoName: string, branch: string, effectivePath: string, token: string | undefined): Promise<{ path: string; items: ScriptRepoBrowseItem[] }> {
  const projectPath = encodeURIComponent(`${owner}/${repoName}`);
  const headers: Record<string, string> = {};
  if (token) headers["PRIVATE-TOKEN"] = token;
  const url = `${apiBase.replace(/\/$/, "")}/api/v4/projects/${projectPath}/repository/tree`;

  let res;
  try {
    res = await axios.get(url, { headers, params: { path: effectivePath.replace(/^\//, ""), ref: branch || "main", per_page: 100 }, validateStatus: () => true, timeout: 20_000 });
  } catch (e) {
    throw new HttpError(502, `GitLab request failed: ${e instanceof Error ? e.message : e}`);
  }
  if (res.status === 404) throw new HttpError(404, `Path not found in ${owner}/${repoName}: '${effectivePath}'`);
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(502, token ? "Access denied — double-check the repo's access token and its permissions." : "Access denied — this looks like a private project. Edit the connection and add an access token.");
  }
  if (res.status >= 300) throw new HttpError(502, `GitLab returned ${res.status}: ${String(JSON.stringify(res.data ?? "")).slice(0, 200)}`);

  const entries: any[] = Array.isArray(res.data) ? res.data : [];
  const branchRef = encodeURIComponent(branch || "main");
  const items: ScriptRepoBrowseItem[] = entries.map((e) => {
    const name: string = e.name || "";
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    const isDir = e.type === "tree";
    return {
      name, path: e.path || "", type: isDir ? "dir" : "file",
      // GitLab's tree listing has no per-entry download URL like GitHub's —
      // this is the raw-file endpoint constructed instead. It needs the same
      // PRIVATE-TOKEN header as the listing call for a private project,
      // which importFromScriptRepo re-derives from the repo record rather
      // than relying on this URL alone.
      downloadUrl: isDir ? null : `${apiBase.replace(/\/$/, "")}/api/v4/projects/${projectPath}/repository/files/${encodeURIComponent(e.path || "")}/raw?ref=${branchRef}`,
      sizeBytes: null,
      importable: !isDir && ext in SCRIPT_REPO_EXTENSIONS,
      inferredPlatform: SCRIPT_REPO_EXTENSIONS[ext] ?? null,
    };
  });
  sortBrowseItems(items);
  return { path: effectivePath, items };
}

/** Lists one directory of a connected repo, dispatching to the right vendor's API. Port of `browse_script_repo` (main.py:8766-8806), extended for GitLab/custom. */
export async function browseScriptRepo(workspaceSlug: string, repoId: string, pathOverride: string | null | undefined): Promise<{ path: string; items: ScriptRepoBrowseItem[] }> {
  const repo = await prisma.scriptRepo.findFirst({ where: { workspaceSlug, id: repoId } });
  if (!repo) throw new HttpError(404, "Script repo not found");
  const effectivePath = pathOverride !== null && pathOverride !== undefined ? pathOverride : (repo.path || "");
  const vendor = normalizeVendor(repo.vendor);
  const token = repo.tokenEncrypted ? decryptSecret(repo.tokenEncrypted) : undefined;

  if (vendor === "gitlab") {
    return browseGitlab(repo.baseUrl || "https://gitlab.com", repo.owner, repo.repo, repo.branch, effectivePath, token);
  }
  const apiBase = repo.baseUrl || (vendor === "github" ? "https://api.github.com" : null);
  if (!apiBase) throw new HttpError(400, "This repo is missing its API base URL — edit the connection and set one (required for a custom/self-hosted repo).");
  const fallbackToken = vendor === "github" && !repo.baseUrl ? GITHUB_TOKEN : undefined;
  return browseGithubStyle(apiBase, repo.owner, repo.repo, repo.branch, effectivePath, token || fallbackToken);
}

export interface ScriptRepoImportFile {
  name: string;
  path?: string;
  downloadUrl?: string | null;
  inferredPlatform?: string | null;
}

/**
 * For each selected repo file: downloads its raw content (with the repo's
 * own vendor-appropriate auth header — needed for a private repo/project,
 * and previously missing here even for GitHub), uploads it to Applivery as
 * a new script Asset, and adds a matching local Action Library entry. Best-
 * effort per file — one failure doesn't block the rest. Port of
 * `import_from_script_repo` (main.py:8813-8872).
 */
export async function importFromScriptRepo(
  authorization: string,
  workspaceSlug: string,
  repoId: string,
  files: ScriptRepoImportFile[],
  segmentId: number | null | undefined,
  actorEmail: string,
) {
  const repo = await prisma.scriptRepo.findFirst({ where: { workspaceSlug, id: repoId } });
  if (!repo) throw new HttpError(404, "Script repo not found");
  const vendor = normalizeVendor(repo.vendor);
  const token = repo.tokenEncrypted ? decryptSecret(repo.tokenEncrypted) : (vendor === "github" && !repo.baseUrl ? GITHUB_TOKEN : undefined);
  const downloadHeaders: Record<string, string> = {};
  if (token) downloadHeaders[vendor === "gitlab" ? "PRIVATE-TOKEN" : "Authorization"] = vendor === "gitlab" ? token : `Bearer ${token}`;

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
      const contentRes = await axios.get(downloadUrl, { headers: downloadHeaders, timeout: 20_000, validateStatus: () => true, responseType: "text" });
      if (contentRes.status >= 300) {
        failed.push({ name, error: contentRes.status === 401 || contentRes.status === 403 ? "Access denied downloading this file — check the repo's access token" : `Download failed (${contentRes.status})` });
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
