import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Port of /api/applivery-webhook* config CRUD (main.py:13040-13096). The
 * actual event receiver is TODO(Phase8) — rules configured here won't fire
 * anything until that receiver exists; this store only covers viewing/
 * editing the config so the Settings tab is functional now.
 */

export interface AppliveryWebhookRule {
  id: string;
  actionKey: string;
  label: string | null;
  enabled: boolean;
  openCase: boolean;
  caseSeverity: string;
  runWorkflow: boolean;
  workflowId: string | null;
  autoRunDestructiveAck: boolean;
}

export interface AppliveryWebhookConfig {
  enabled: boolean;
  secret: string;
  rules: AppliveryWebhookRule[];
}

export const useAppliveryWebhookSettingsStore = defineStore("appliveryWebhookSettings", () => {
  const config = ref<AppliveryWebhookConfig | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchConfig() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/applivery-webhook");
      config.value = res.data;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load Applivery event webhook settings.";
    } finally {
      isLoading.value = false;
    }
  }

  async function saveConfig(enabled: boolean, rules: Array<Partial<AppliveryWebhookRule>>) {
    const { api } = await import("../api/http");
    const res = await api.put("/applivery-webhook", { enabled, rules });
    config.value = res.data;
  }

  async function rotateSecret() {
    const { api } = await import("../api/http");
    const res = await api.post("/applivery-webhook/rotate-secret");
    config.value = res.data;
  }

  return { config, isLoading, error, fetchConfig, saveConfig, rotateSecret };
});
