import axios from "axios";
import { loadGlobalCatalog, saveGlobalCatalog } from "../../services/globalCatalog";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";
import { HttpError } from "../../utils/httpError";
import { recordAuditEvent } from "../../services/auditLog";

/**
 * Applivery SOAR Agent binary downloads — Settings > Device Data Webhook.
 * The two native agents (github.com/raulcnadal/applivery-soar-agent-windows
 * and -macos — separate repos, separate Go toolchains, not part of this
 * monorepo's own CI) each publish a rolling "latest" GitHub Release on
 * every push to main, same rolling-tag pattern as this repo's own
 * docker-publish.yml. Both agent repos are private, so listing/downloading
 * release assets needs a GitHub token server-side, proxied through here —
 * the browser never sees the token, and the agent binaries themselves
 * never have anything workspace-specific baked in (see each repo's fix for
 * the hardcoded-secret issue) — only the generated Managed Configuration
 * snippet (built client-side, see DeviceDataWebhookPanel.vue) carries the
 * real per-workspace secret, exactly like the existing report scripts.
 *
 * This is GLOBAL configuration, not per-workspace — the token grants read
 * access to two specific repos regardless of which SOAR workspace is
 * asking, same reasoning as the EUVD vulnerability catalog (vulnCatalog.ts)
 * being global infrastructure rather than tenant data.
 */

const GH_API = "https://api.github.com";
const REPOS: Record<AgentPlatform, string> = {
  windows: "raulcnadal/applivery-soar-agent-windows",
  macos: "raulcnadal/applivery-soar-agent-macos",
};
// Avoid hammering GitHub's API rate limit (and every admin's page load
// waiting on two live HTTP round trips) — the release only changes when
// someone pushes to one of the agent repos, so a short cache is plenty.
const RELEASES_CACHE_TTL_MS = 10 * 60 * 1000;

export type AgentPlatform = "windows" | "macos";

interface AgentDownloadsConfig {
  tokenEncrypted: string | null;
  configuredBy: string | null;
  configuredAt: string | null;
}

export interface AgentAsset {
  platform: AgentPlatform;
  repo: string;
  assetId: number;
  filename: string;
  sizeBytes: number;
  publishedAt: string;
  tag: string;
}

interface CachedRelease {
  fetchedAt: number;
  assets: AgentAsset[];
}

// Process-local cache — fine here the same way liveCache.ts's in-memory
// caches are fine elsewhere in this app: a restart just means the next
// request re-fetches, no correctness issue.
const releaseCache: Partial<Record<AgentPlatform, CachedRelease>> = {};

async function loadConfig(): Promise<AgentDownloadsConfig> {
  return loadGlobalCatalog<AgentDownloadsConfig>("agent_downloads_config", () => ({ tokenEncrypted: null, configuredBy: null, configuredAt: null }));
}

function maskSecretTail(secret: string): string {
  if (!secret) return "";
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

export async function getAgentDownloadsConfigStatus(): Promise<{ configured: boolean; tokenMasked: string; configuredBy: string | null; configuredAt: string | null }> {
  const cfg = await loadConfig();
  const token = cfg.tokenEncrypted ? decryptSecret(cfg.tokenEncrypted) : "";
  return { configured: Boolean(token), tokenMasked: maskSecretTail(token), configuredBy: cfg.configuredBy, configuredAt: cfg.configuredAt };
}

export async function setAgentDownloadsToken(token: string, actorEmail: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new HttpError(400, "Token is required");
  await saveGlobalCatalog("agent_downloads_config", {
    tokenEncrypted: encryptSecret(trimmed),
    configuredBy: actorEmail,
    configuredAt: new Date().toISOString(),
  } as AgentDownloadsConfig);
  delete releaseCache.windows;
  delete releaseCache.macos;
  await recordAuditEvent("global", {
    category: "settings",
    action: "agent_downloads_token_set",
    actor: actorEmail,
    message: `GitHub token for Applivery SOAR Agent downloads configured by ${actorEmail}`,
  });
}

export async function clearAgentDownloadsToken(actorEmail: string): Promise<void> {
  await saveGlobalCatalog("agent_downloads_config", { tokenEncrypted: null, configuredBy: null, configuredAt: null } as AgentDownloadsConfig);
  delete releaseCache.windows;
  delete releaseCache.macos;
  await recordAuditEvent("global", {
    category: "settings",
    action: "agent_downloads_token_cleared",
    actor: actorEmail,
    message: `GitHub token for Applivery SOAR Agent downloads removed by ${actorEmail}`,
  });
}

async function getToken(): Promise<string> {
  const cfg = await loadConfig();
  if (!cfg.tokenEncrypted) {
    throw new HttpError(400, "No GitHub token configured for agent downloads yet — set one in Settings > Applivery SOAR Agent.");
  }
  return decryptSecret(cfg.tokenEncrypted);
}

async function fetchReleaseAssets(platform: AgentPlatform, token: string): Promise<AgentAsset[]> {
  const cached = releaseCache[platform];
  if (cached && Date.now() - cached.fetchedAt < RELEASES_CACHE_TTL_MS) return cached.assets;

  const repo = REPOS[platform];
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const res = await axios.get(`${GH_API}/repos/${repo}/releases/latest`, { headers, timeout: 15000, validateStatus: () => true });

  if (res.status === 404) {
    // No release published yet (e.g. right after the workflow change lands,
    // before its first run completes) — not an error, just nothing to offer.
    const empty: AgentAsset[] = [];
    releaseCache[platform] = { fetchedAt: Date.now(), assets: empty };
    return empty;
  }
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(502, `GitHub rejected the configured token listing releases for ${repo} (HTTP ${res.status}) — it may be expired or missing read access to this repo.`);
  }
  if (res.status !== 200) {
    throw new HttpError(502, `GitHub returned HTTP ${res.status} listing releases for ${repo}.`);
  }

  const assets: AgentAsset[] = (res.data.assets ?? []).map((a: any) => ({
    platform,
    repo,
    assetId: a.id,
    filename: a.name,
    sizeBytes: a.size,
    publishedAt: a.updated_at ?? res.data.published_at ?? null,
    tag: res.data.tag_name ?? "latest",
  }));
  releaseCache[platform] = { fetchedAt: Date.now(), assets };
  return assets;
}

/** GET /api/settings/agent-downloads/releases — every asset from both repos' latest release, for Settings to render as download buttons. */
export async function listAgentDownloads(): Promise<AgentAsset[]> {
  const token = await getToken();
  const [windowsAssets, macosAssets] = await Promise.all([
    fetchReleaseAssets("windows", token).catch((e) => {
      console.warn(`[Agent Downloads] Failed to list windows release assets: ${e}`);
      return [] as AgentAsset[];
    }),
    fetchReleaseAssets("macos", token).catch((e) => {
      console.warn(`[Agent Downloads] Failed to list macos release assets: ${e}`);
      return [] as AgentAsset[];
    }),
  ]);
  return [...windowsAssets, ...macosAssets];
}

/**
 * Proxies one release asset's binary content straight from GitHub —
 * necessary because both agent repos are private, so a plain `<a href>` to
 * github.com wouldn't carry the Authorization header a browser download
 * needs, and the token itself must never reach the browser.
 */
export async function streamAgentAsset(platform: AgentPlatform, assetId: number) {
  const repo = REPOS[platform];
  if (!repo) throw new HttpError(400, "Unknown platform — expected 'windows' or 'macos'");
  const token = await getToken();

  const assets = await fetchReleaseAssets(platform, token);
  const asset = assets.find((a) => a.assetId === assetId);
  if (!asset) {
    throw new HttpError(404, "That asset isn't in the current latest release — it may have just been rebuilt. Refresh Settings and try again.");
  }

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/octet-stream" };
  const res = await axios.get(`${GH_API}/repos/${repo}/releases/assets/${assetId}`, {
    headers,
    responseType: "stream",
    timeout: 60000,
  });
  return {
    stream: res.data as NodeJS.ReadableStream,
    filename: asset.filename,
    contentType: (res.headers["content-type"] as string) || "application/octet-stream",
    contentLength: res.headers["content-length"] as string | undefined,
  };
}
