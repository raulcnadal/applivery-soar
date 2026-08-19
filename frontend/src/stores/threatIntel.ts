import { defineStore } from "pinia";
import { ref } from "vue";

/** Port of Threat Intel Providers CRUD (main.py:13960-14330). */

export interface ThreatIntelProvider {
  id: string;
  name: string;
  type: string; // virustotal — only remaining provider type, see backend threatIntel.schemas.ts
  enabled: boolean;
  config: Record<string, any>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const useThreatIntelStore = defineStore("threatIntel", () => {
  const providers = ref<ThreatIntelProvider[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchProviders() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/threat-intel/providers");
      providers.value = res.data.items ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load threat intel providers.";
    } finally {
      isLoading.value = false;
    }
  }

  async function createProvider(payload: Partial<ThreatIntelProvider>) {
    const { api } = await import("../api/http");
    await api.post("/threat-intel/providers", payload);
    await fetchProviders();
  }

  async function updateProvider(providerId: string, payload: Partial<ThreatIntelProvider>) {
    const { api } = await import("../api/http");
    await api.put(`/threat-intel/providers/${providerId}`, payload);
    await fetchProviders();
  }

  async function deleteProvider(providerId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/threat-intel/providers/${providerId}`);
    await fetchProviders();
  }

  async function testProvider(providerId: string) {
    const { api } = await import("../api/http");
    const res = await api.post(`/threat-intel/providers/${providerId}/test`);
    return res.data as { status: string; result: Record<string, any> };
  }

  return { providers, isLoading, error, fetchProviders, createProvider, updateProvider, deleteProvider, testProvider };
});
