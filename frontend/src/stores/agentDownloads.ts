import { defineStore } from "pinia";
import { ref } from "vue";

/** Port of /api/settings/agent-downloads/* — Applivery SOAR Agent binaries, sourced
 * from the two agent repos' GitHub Releases (see DeviceDataWebhookPanel.vue). */

export interface AgentDownloadsConfigStatus {
  configured: boolean;
  tokenMasked: string;
  configuredBy: string | null;
  configuredAt: string | null;
}

export interface AgentAsset {
  platform: "windows" | "macos";
  repo: string;
  assetId: number;
  filename: string;
  sizeBytes: number;
  publishedAt: string;
  tag: string;
}

export const useAgentDownloadsStore = defineStore("agentDownloads", () => {
  const config = ref<AgentDownloadsConfigStatus | null>(null);
  const assets = ref<AgentAsset[]>([]);
  const isLoading = ref(false);
  const isLoadingAssets = ref(false);
  const error = ref<string | null>(null);
  const assetsError = ref<string | null>(null);

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

  return { config, assets, isLoading, isLoadingAssets, error, assetsError, fetchConfig, fetchAssets, setToken, clearToken, downloadAsset };
});
