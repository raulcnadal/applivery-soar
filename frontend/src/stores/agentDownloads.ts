import { defineStore } from "pinia";
import { ref } from "vue";

/** Port of /api/settings/agent-downloads/* — Applivery SOAR Agent binaries.
 * Two independent paths live here:
 *  - Zero-config (/api/agent-downloads/*, agentBuilds.controller.ts):
 *    publicly-served, no-token binaries this app's own backend stores
 *    directly (pushed there by each agent repo's CI) — the primary path,
 *    works for every customer with no setup. Three (platform, arch)
 *    variants exist — windows/amd64, windows/arm64, macos/universal — see
 *    AGENT_VARIANTS below.
 *  - GitHub-token (config/releases/download below): the original,
 *    now-optional fallback for whoever already configured it — proxies the
 *    agent repos' own GitHub Releases, requires a repo-read PAT most
 *    customers don't have. */

export type AgentPlatform = "windows" | "macos";
export type AgentArch = string;

export interface AgentVariant {
  platform: AgentPlatform;
  arch: AgentArch;
  label: string;
}

/** Every zero-config variant this app's backend can serve — one row each in the Settings panel. Windows ships both an x64 and an ARM64 MSI (the agent repo's CI builds both); macOS is a single universal binary. */
export const AGENT_VARIANTS: AgentVariant[] = [
  { platform: "windows", arch: "amd64", label: "Windows (x64)" },
  { platform: "windows", arch: "arm64", label: "Windows (ARM64)" },
  { platform: "macos", arch: "universal", label: "macOS" },
];

export function variantKey(platform: AgentPlatform, arch: AgentArch): string {
  return `${platform}:${arch}`;
}

export interface AgentDownloadsConfigStatus {
  configured: boolean;
  tokenMasked: string;
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

export interface AgentBuildMeta {
  platform: AgentPlatform;
  arch: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  version: string | null;
  publishedAt: string;
}

export interface PublishStatusEntry {
  applicationId: string | null;
  publishedAt: string | null;
}

export const useAgentDownloadsStore = defineStore("agentDownloads", () => {
  const config = ref<AgentDownloadsConfigStatus | null>(null);
  const assets = ref<AgentAsset[]>([]);
  const isLoading = ref(false);
  const isLoadingAssets = ref(false);
  const error = ref<string | null>(null);
  const assetsError = ref<string | null>(null);

  // ── Zero-config builds (no token, publicly served) — keyed by variantKey ──
  const builds = ref<Record<string, AgentBuildMeta | null>>(Object.fromEntries(AGENT_VARIANTS.map((v) => [variantKey(v.platform, v.arch), null])));
  const isLoadingBuilds = ref(false);
  const buildsError = ref<string | null>(null);
  const downloadingBuild = ref<string | null>(null);

  // ── Publish to Applivery — keyed by variantKey. Errors/info are per-variant
  // (not a single shared ref) so that publishing one variant can never leave
  // a stale error banner sitting under an unrelated, successfully-published
  // row — clicking Republish on Windows x64 only ever touches
  // publishErrors["windows:amd64"], so a still-in-flight or previously
  // failed macOS request can't clobber it (or vice versa) regardless of
  // which settles last. ──
  const publishStatus = ref<Record<string, PublishStatusEntry> | null>(null);
  const isPublishing = ref<string | null>(null);
  const publishErrors = ref<Record<string, string | null>>(Object.fromEntries(AGENT_VARIANTS.map((v) => [variantKey(v.platform, v.arch), null])));
  // Set only on a successful publish call whose result was a no-op (this
  // exact build was already published) — surfaced as an info notice,
  // distinct from publishErrors, so "nothing changed" doesn't read as a
  // failure.
  const publishInfos = ref<Record<string, string | null>>(Object.fromEntries(AGENT_VARIANTS.map((v) => [variantKey(v.platform, v.arch), null])));

  async function fetchConfig() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/settings/agent-downloads/config");
      config.value = res.data;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load agent downloads status.";
    } finally {
      isLoading.value = false;
    }
  }

  async function fetchAssets() {
    if (!config.value?.configured) return;
    isLoadingAssets.value = true;
    assetsError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/settings/agent-downloads/releases");
      assets.value = res.data.assets ?? [];
    } catch (err: any) {
      assetsError.value = err?.response?.data?.detail || "Failed to list agent releases.";
    } finally {
      isLoadingAssets.value = false;
    }
  }

  async function setToken(token: string) {
    const { api } = await import("../api/http");
    const res = await api.put("/settings/agent-downloads/config", { token });
    config.value = res.data;
    await fetchAssets();
  }

  async function clearToken() {
    const { api } = await import("../api/http");
    await api.delete("/settings/agent-downloads/config");
    assets.value = [];
    await fetchConfig();
  }

  async function downloadAsset(asset: AgentAsset) {
    const { api } = await import("../api/http");
    const res = await api.get(`/settings/agent-downloads/download/${asset.platform}/${asset.assetId}`, { responseType: "blob" });
    const blob = new Blob([res.data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = asset.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function fetchBuildMeta() {
    isLoadingBuilds.value = true;
    buildsError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/agent-downloads");
      const next: Record<string, AgentBuildMeta | null> = Object.fromEntries(AGENT_VARIANTS.map((v) => [variantKey(v.platform, v.arch), null]));
      for (const row of (res.data?.builds ?? []) as AgentBuildMeta[]) {
        next[variantKey(row.platform, row.arch)] = row;
      }
      builds.value = next;
    } catch (err: any) {
      buildsError.value = err?.response?.data?.detail || "Failed to check for published agent builds.";
    } finally {
      isLoadingBuilds.value = false;
    }
  }

  async function downloadBuild(variant: AgentVariant) {
    const key = variantKey(variant.platform, variant.arch);
    downloadingBuild.value = key;
    try {
      const { api } = await import("../api/http");
      const res = await api.get(`/agent-downloads/${variant.platform}`, { params: { arch: variant.arch }, responseType: "blob" });
      const blob = new Blob([res.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = builds.value[key]?.filename || `applivery-soar-agent-${key.replace(":", "-")}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      downloadingBuild.value = null;
    }
  }

  async function fetchPublishStatus() {
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/settings/agent-downloads/publish-status");
      publishStatus.value = res.data;
    } catch {
      // Non-critical — the panel just won't show "already published" state.
    }
  }

  async function publishToApplivery(variant: AgentVariant) {
    const key = variantKey(variant.platform, variant.arch);
    isPublishing.value = key;
    publishErrors.value = { ...publishErrors.value, [key]: null };
    publishInfos.value = { ...publishInfos.value, [key]: null };
    try {
      const { api } = await import("../api/http");
      const res = await api.post(`/settings/agent-downloads/publish/${variant.platform}/${variant.arch}`);
      if (res.data?.alreadyPublished) {
        publishInfos.value = { ...publishInfos.value, [key]: res.data.message || `This ${variant.label} agent build is already published to Applivery.` };
      }
      await fetchPublishStatus();
    } catch (err: any) {
      publishErrors.value = { ...publishErrors.value, [key]: err?.response?.data?.detail || `Failed to publish the ${variant.label} agent to Applivery.` };
      throw err;
    } finally {
      isPublishing.value = null;
    }
  }

  return {
    config, assets, isLoading, isLoadingAssets, error, assetsError, fetchConfig, fetchAssets, setToken, clearToken, downloadAsset,
    builds, isLoadingBuilds, buildsError, downloadingBuild, fetchBuildMeta, downloadBuild,
    publishStatus, isPublishing, publishErrors, publishInfos, fetchPublishStatus, publishToApplivery,
  };
});
