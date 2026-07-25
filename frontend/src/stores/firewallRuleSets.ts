import { defineStore } from "pinia";
import { ref } from "vue";

export interface FirewallRule {
  id?: string | null;
  name?: string;
  direction?: string;
  action?: string;
  protocol?: string;
  localPorts?: string;
  remoteAddresses?: string;
  profile?: string;
  enabled?: boolean;
}

export interface FirewallRuleSet {
  id: string;
  workspaceSlug: string;
  name: string;
  description?: string | null;
  ensureFirewallEnabled: boolean;
  defaultInboundAction: string;
  defaultOutboundAction: string;
  rules: FirewallRule[];
  applyLibraryId?: string | null;
  restoreLibraryId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FirewallRulesetTemplate {
  key: string;
  name: string;
  description: string;
  ensureFirewallEnabled: boolean;
  defaultInboundAction: string;
  defaultOutboundAction: string;
  rules: FirewallRule[];
}

export const useFirewallRuleSetsStore = defineStore("firewallRuleSets", () => {
  const ruleSets = ref<FirewallRuleSet[]>([]);
  const templates = ref<FirewallRulesetTemplate[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchRuleSets() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/firewall-rulesets");
      ruleSets.value = res.data.items ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load firewall rule sets.";
    } finally {
      isLoading.value = false;
    }
  }

  async function fetchTemplates() {
    const { api } = await import("../api/http");
    const res = await api.get("/firewall-ruleset-templates");
    templates.value = res.data.items ?? [];
  }

  async function createRuleSet(payload: Partial<FirewallRuleSet>) {
    const { api } = await import("../api/http");
    await api.post("/firewall-rulesets", payload);
    await fetchRuleSets();
  }

  async function updateRuleSet(ruleSetId: string, payload: Partial<FirewallRuleSet>) {
    const { api } = await import("../api/http");
    await api.put(`/firewall-rulesets/${ruleSetId}`, payload);
    await fetchRuleSets();
  }

  async function deleteRuleSet(ruleSetId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/firewall-rulesets/${ruleSetId}`);
    await fetchRuleSets();
  }

  return { ruleSets, templates, isLoading, error, fetchRuleSets, fetchTemplates, createRuleSet, updateRuleSet, deleteRuleSet };
});
