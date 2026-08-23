import { defineStore } from "pinia";
import { ref } from "vue";

export interface ScriptRepo {
  id: string;
  workspaceSlug: string;
  name: string;
  vendor: "github" | "gitlab" | "custom";
  owner: string;
  repo: string;
  branch: string;
  path?: string | null;
  baseUrl?: string | null;
  // Whether an access token is configured — the encrypted token itself is
  // never sent to the frontend.
  hasToken: boolean;
  createdAt: string;
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

export const useScriptReposStore = defineStore("scriptRepos", () => {
  const repos = ref<ScriptRepo[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchRepos() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/script-repos");
      repos.value = res.data.items ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load script repos.";
    } finally {
      isLoading.value = false;
    }
  }

  async function createRepo(payload: { name: string; vendor?: string; owner: string; repo: string; branch?: string; path?: string; baseUrl?: string; token?: string }): Promise<ScriptRepo> {
    const { api } = await import("../api/http");
    const res = await api.post("/script-repos", payload);
    await fetchRepos();
    return res.data as ScriptRepo;
  }

  async function deleteRepo(repoId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/script-repos/${repoId}`);
    await fetchRepos();
  }

  async function browse(repoId: string, path?: string): Promise<{ path: string; items: ScriptRepoBrowseItem[] }> {
    const { api } = await import("../api/http");
    const res = await api.get(`/script-repos/${repoId}/browse`, { params: path !== undefined ? { path } : {} });
    return res.data;
  }

  async function importFiles(repoId: string, files: ScriptRepoBrowseItem[], segmentId?: number | null) {
    const { api } = await import("../api/http");
    const res = await api.post("/script-repos/import", { repoId, files, segmentId });
    return res.data as { imported: unknown[]; failed: Array<{ name?: string; error: string }> };
  }

  return { repos, isLoading, error, fetchRepos, createRepo, deleteRepo, browse, importFiles };
});
