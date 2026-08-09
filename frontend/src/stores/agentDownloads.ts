import { defineStore } from "pinia";
import { ref } from "vue";

/** Port of /api/settings/agent-downloads/* — Applivery SOAR Agent binaries.
 * Two independent paths live here:
 *  - Zero-config (/api/agent-downloads/*, agentBuilds.controller.ts):
 *    publicly-served, no-token binaries this app's own backend stores
 *    directly (pushed there by each agent repo's CI) — the primary path,
 *    works for every customer with no setup.
 *  - GitHub-token (config/releases/download below): the original,
 *    now-optional fallback for whoever already configured it — proxies the
 *    agent repos' own GitHub Releases, requires a repo-read PAT most
 *    customers don't have. */

export type AgentPlatform = "windows" | "macos";

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

  // ── Zero-config builds (no token, publicly served) ──
  const builds = ref<Record<AgentPlatform, AgentBuildMeta | null>>({ windows: null, macos: null });
  const isLoadingBuilds = ref(false);
  const buildsError = ref<string | null>(null);
  const downloadingBuild = ref<AgentPlatform | null>(null);

  // ── Publish to Applivery App Distribution ──
  const publishStatus = ref<Record<AgentPlatform, PublishStatusEntry> | null>(null);
  const isPublishing = ref<AgentPlatform | null>(null);
  const publishError = ref<string | null>(null);

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
      const fetchOne = async (platform: AgentPlatform) => {
        try {
          const res = await api.get(`/agent-downloads/${platform}/meta`);
          return res.data as AgentBuildMeta;
        } catch (err: any) {
          if (err?.response?.status === 404) return null;
          throw err;
        }
      };
      const [windows, macos] = await Promise.all([fetchOne("windows"), fetchOne("macos")]);
      builds.value = { windows, macos };
    } catch (err: any) {
      buildsError.value = err?.response?.data?.detail || "Failed to check for published agent builds.";
    } finally {
      isLoadingBuilds.value = false;
    }
  }

  async function downloadBuild(platform: AgentPlatform) {
    downloadingBuild.value = platform;
    try {
      const { api } = await import("../api/http");
      const res = await api.get(`/agent-downloads/${platform}`, { responseType: "blob" });
      const blob = new Blob([res.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = builds.value[platform]?.filename || `applivery-soar-agent-${platform}`;
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

  async function publishToApplivery(platform: AgentPlatform) {
    isPublishing.value = platform;
    publishError.value = null;
    try {
      const { api } = await import("../api/http");
      await api.post(`/settings/agent-downloads/publish/${platform}`);
      await fetchPublishStatus();
    } catch (err: any) {
      publishError.value = err?.response?.data?.detail || `Failed to publish the ${platform} agent to Applivery.`;
      throw err;
    } finally {
      isPublishing.value = null;
    }
  }

  return {
    config, assets, isLoading, isLoadingAssets, error, assetsError, fetchConfig, fetchAssets, setToken, clearToken, downloadAsset,
    builds, isLoadingBuilds, buildsError, downloadingBuild, fetchBuildMeta, downloadBuild,
    publishStatus, isPublishing, publishError, fetchPublishStatus, publishToApplivery,
  };
});
