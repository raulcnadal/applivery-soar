import { defineStore } from "pinia";
import { ref } from "vue";

/** Port of /api/settings/log-export-destinations* (main.py:2289-2403). */

export interface LogExportDestination {
  id: string;
  type: string; // syslog | webhook | s3 | nfs | sftp
  name: string;
  enabled: boolean;
  format: string; // json | cef
  config: Record<string, any>;
  createdBy: string | null;
  lastExportedAt: string | null;
  lastExportError: string | null;
  createdAt: string;
  updatedAt: string;
}

export const useLogExportDestinationsStore = defineStore("logExportDestinations", () => {
  const destinations = ref<LogExportDestination[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchDestinations() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/settings/log-export-destinations");
      destinations.value = res.data.items ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load log export destinations.";
    } finally {
      isLoading.value = false;
    }
  }

  async function createDestination(payload: Partial<LogExportDestination>) {
    const { api } = await import("../api/http");
    await api.post("/settings/log-export-destinations", payload);
    await fetchDestinations();
  }

  async function updateDestination(id: string, payload: Partial<LogExportDestination>) {
    const { api } = await import("../api/http");
    await api.put(`/settings/log-export-destinations/${id}`, payload);
    await fetchDestinations();
  }

  async function deleteDestination(id: string) {
    const { api } = await import("../api/http");
    await api.delete(`/settings/log-export-destinations/${id}`);
    await fetchDestinations();
  }

  async function testDestination(id: string) {
    const { api } = await import("../api/http");
    await api.post(`/settings/log-export-destinations/${id}/test`);
  }

  return { destinations, isLoading, error, fetchDestinations, createDestination, updateDestination, deleteDestination, testDestination };
});
