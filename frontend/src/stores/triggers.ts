import { defineStore } from "pinia";
import { ref } from "vue";

export interface Trigger {
  id: string;
  workspaceSlug: string;
  name: string;
  description?: string | null;
  workflowId: string;
  enabled: boolean;
  openCase: boolean;
  caseSeverity: string;
  deviceLookupField?: string | null;
  secret: string;
  lastFiredAt?: string | null;
  fireCount: number;
  createdAt: string;
  updatedAt: string;
}

export const useTriggersStore = defineStore("triggers", () => {
  const triggers = ref<Trigger[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchTriggers() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/triggers");
      triggers.value = res.data.items ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load triggers.";
    } finally {
      isLoading.value = false;
    }
  }

  async function createTrigger(payload: Partial<Trigger>) {
    const { api } = await import("../api/http");
    await api.post("/triggers", payload);
    await fetchTriggers();
  }

  async function updateTrigger(triggerId: string, payload: Partial<Trigger>) {
    const { api } = await import("../api/http");
    await api.put(`/triggers/${triggerId}`, payload);
    await fetchTriggers();
  }

  async function deleteTrigger(triggerId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/triggers/${triggerId}`);
    await fetchTriggers();
  }

  async function rotateSecret(triggerId: string) {
    const { api } = await import("../api/http");
    await api.post(`/triggers/${triggerId}/rotate-secret`);
    await fetchTriggers();
  }

  function fireUrl(trigger: Trigger): string {
    return `${window.location.origin}/api/triggers/fire/${trigger.id}/${trigger.secret}`;
  }

  // Companion to fireUrl — point the SAME external system's "condition
  // cleared" callback here so a device this trigger moved out of
  // compliance can actually recover instead of staying flagged forever.
  // Requires Device lookup field to be configured (see resolveTrigger's
  // own doc comment on the backend) — there's no "everyone's state" to
  // clear, only a specific device's.
  function resolveUrl(trigger: Trigger): string {
    return `${window.location.origin}/api/triggers/resolve/${trigger.id}/${trigger.secret}`;
  }

  return { triggers, isLoading, error, fetchTriggers, createTrigger, updateTrigger, deleteTrigger, rotateSecret, fireUrl, resolveUrl };
});
