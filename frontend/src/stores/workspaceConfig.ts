import { defineStore } from "pinia";
import { ref } from "vue";

/** Port of /api/config/* (main.py:1802-1907) — Backup & Restore. */

export const CONFIG_STORE_LABELS: Record<string, string> = {
  compliancePolicies: "Compliance Policies",
  workflows: "Workflows",
  triggers: "Inbound Webhook Triggers",
  integrations: "Ticketing & Chat Integrations",
  caseAutoRunRules: "Case Auto-Run Rules",
  caseSlaSettings: "Case SLA Settings",
  threatIntelProviders: "Threat Intel Providers",
  appliveryWebhookConfig: "Applivery Events Webhook",
  actionLibrary: "Action Library",
  appLists: "App Lists",
  scriptRepos: "Script Library",
  dashboardState: "Dashboard Settings",
  vulnServiceConfig: "Vulnerability Service Config",
  firewallRuleSets: "Firewall Rule Sets",
};

export const useWorkspaceConfigStore = defineStore("workspaceConfig", () => {
  const isEmpty = ref<boolean | null>(null);
  const hasData = ref<Record<string, boolean>>({});
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchStatus() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/config/workspace-status");
      isEmpty.value = res.data.isEmpty;
      hasData.value = res.data.hasData ?? {};
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load workspace config status.";
    } finally {
      isLoading.value = false;
    }
  }

  async function exportConfig(): Promise<{ schemaVersion: number; exportedAt: string; workspaceSlug: string; data: Record<string, any> }> {
    const { api } = await import("../api/http");
    const res = await api.get("/config/export");
    return res.data;
  }

  async function importConfig(bundle: { schemaVersion: number; data: Record<string, any> }, stores: string[]) {
    const { api } = await import("../api/http");
    const res = await api.post("/config/import", { schemaVersion: bundle.schemaVersion, data: bundle.data, stores });
    await fetchStatus();
    return res.data as { status: string; imported: string[]; failed: Array<{ store: string; error: string }> };
  }

  async function cloneFrom(sourceWorkspaceSlug: string, stores: string[]) {
    const { api } = await import("../api/http");
    const res = await api.post("/config/clone-from", { sourceWorkspaceSlug, stores });
    await fetchStatus();
    return res.data as { status: string; cloned: string[]; sourceWorkspaceSlug: string };
  }

  return { isEmpty, hasData, isLoading, error, fetchStatus, exportConfig, importConfig, cloneFrom };
});
