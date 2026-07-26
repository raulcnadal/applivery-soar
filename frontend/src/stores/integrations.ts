import { defineStore } from "pinia";
import { ref } from "vue";

/** Port of Integrations CRUD (main.py:13275-13413, 13893-13923). */

export interface Integration {
  id: string;
  name: string;
  type: string; // slack | teams | discord | jira | servicenow | generic_webhook | pagerduty | opsgenie
  enabled: boolean;
  notifyOnOpen: boolean;
  notifyOnClose: boolean;
  minSeverity: string;
  autoCloseCaseOnRemoteResolve: boolean;
  notifyOnSystemHealth: boolean;
  config: Record<string, any>;
  createdBy: string | null;
  lastFiredAt: string | null;
  fireCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export const useIntegrationsStore = defineStore("integrations", () => {
  const integrations = ref<Integration[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchIntegrations() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/integrations");
      integrations.value = res.data.items ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load integrations.";
    } finally {
      isLoading.value = false;
    }
  }

  async function createIntegration(payload: Partial<Integration>) {
    const { api } = await import("../api/http");
    await api.post("/integrations", payload);
    await fetchIntegrations();
  }

  async function updateIntegration(integrationId: string, payload: Partial<Integration>) {
    const { api } = await import("../api/http");
    await api.put(`/integrations/${integrationId}`, payload);
    await fetchIntegrations();
  }

  async function deleteIntegration(integrationId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/integrations/${integrationId}`);
    await fetchIntegrations();
  }

  async function testIntegration(integrationId: string, dryRun: boolean) {
    const { api } = await import("../api/http");
    const res = await api.post(`/integrations/${integrationId}/test`, {}, { params: { dry_run: dryRun } });
    return res.data as { status: string; dryRun: boolean; detail?: string };
  }

  return { integrations, isLoading, error, fetchIntegrations, createIntegration, updateIntegration, deleteIntegration, testIntegration };
});
