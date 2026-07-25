import { defineStore } from "pinia";
import { ref } from "vue";

export interface ScriptAssetSummary {
  id: string;
  name: string;
  description: string;
  platform?: string;
  alreadyInLibrary?: boolean;
}

export const useScriptAssetsStore = defineStore("scriptAssets", () => {
  const isSearching = ref(false);
  const isBrowsing = ref(false);
  const error = ref<string | null>(null);

  async function search(platform: "windows" | "macos", text: string): Promise<ScriptAssetSummary[]> {
    isSearching.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/script-assets", { params: { platform, text } });
      if (res.data.error) error.value = res.data.error;
      return res.data.items ?? [];
    } finally {
      isSearching.value = false;
    }
  }

  async function browse(platform: "windows" | "macos" | "all" = "all"): Promise<ScriptAssetSummary[]> {
    isBrowsing.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/script-assets/browse", { params: { platform } });
      if (res.data.error) error.value = res.data.error;
      return res.data.items ?? [];
    } finally {
      isBrowsing.value = false;
    }
  }

  async function getContent(assetId: string): Promise<{ content: string; url?: string }> {
    const { api } = await import("../api/http");
    const res = await api.get(`/script-assets/${assetId}/content`);
    return res.data;
  }

  async function createAsset(payload: { name: string; description?: string; platform: "windows" | "macos"; content: string; segmentId?: number | null; exposeToChildren?: boolean }) {
    const { api } = await import("../api/http");
    const res = await api.post("/script-assets", payload);
    return res.data as { id: string; name: string };
  }

  async function editAsset(assetId: string, payload: { name?: string; description?: string; platform: "windows" | "macos"; content: string; segmentId?: number | null; exposeToChildren?: boolean }) {
    const { api } = await import("../api/http");
    const res = await api.put(`/script-assets/${assetId}`, payload);
    return res.data as { asset: { id: string; name: string }; repointedLibraryEntryIds: string[] };
  }

  return { isSearching, isBrowsing, error, search, browse, getContent, createAsset, editAsset };
});
