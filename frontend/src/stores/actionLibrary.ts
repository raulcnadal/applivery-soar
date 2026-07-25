import { defineStore } from "pinia";
import { ref } from "vue";

export interface ActionLibraryEntry {
  id: string;
  type: "script" | "oma_uri";
  name: string;
  description?: string | null;
  platform: string;
  assetId?: string | null;
  assetName?: string | null;
  arguments?: string | null;
  scope?: string | null;
  path?: string | null;
  action?: string | null;
  format?: string | null;
  value?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const useActionLibraryStore = defineStore("actionLibrary", () => {
  const entries = ref<ActionLibraryEntry[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchEntries() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/action-library");
      entries.value = res.data.items ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load the Script & OMA-URI library.";
    } finally {
      isLoading.value = false;
    }
  }

  async function createEntry(payload: Partial<ActionLibraryEntry>) {
    const { api } = await import("../api/http");
    await api.post("/action-library", payload);
    await fetchEntries();
  }

  async function updateEntry(entryId: string, payload: Partial<ActionLibraryEntry>) {
    const { api } = await import("../api/http");
    await api.put(`/action-library/${entryId}`, payload);
    await fetchEntries();
  }

  async function deleteEntry(entryId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/action-library/${entryId}`);
    await fetchEntries();
  }

  async function importEntries(assets: Array<{ id: string; name?: string; platform?: string; description?: string }>) {
    const { api } = await import("../api/http");
    const res = await api.post("/action-library/import", { assets });
    await fetchEntries();
    return res.data as { imported: ActionLibraryEntry[]; skippedCount: number };
  }

  return { entries, isLoading, error, fetchEntries, createEntry, updateEntry, deleteEntry, importEntries };
});
