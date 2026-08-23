import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Port of /api/applivery-webhook* config CRUD + receiver (main.py:13040-13243).
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

export interface AppliveryWebhookEvent {
  id: string;
  receivedAt: string;
  actionKey: string;
  canonicalKey: string;
  os: string | null;
  outcome: string;
  deviceId: string | null;
  deviceName: string | null;
  caseId: string | null;
  workflowRunId: string | null;
}

export interface AppliveryWebhookConfig {
  enabled: boolean;
  secret: string;
  rules: AppliveryWebhookRule[];
  recentEvents: AppliveryWebhookEvent[];
  receivedCount: number;
  lastReceivedAt: string | null;
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

  // Applivery's own "Create integration" webhook form takes a single URL
  // field, no separate secret field — the secret only has anywhere useful
  // to go once it's embedded in a full URL (same secret-in-path pattern as
  // triggers.ts's fireUrl/resolveUrl). Pure client-side templating, same
  // window.location.origin approach, for consistency.
  function receiverUrl(): string {
    return `${window.location.origin}/api/applivery-webhook/receive/${config.value?.secret ?? ""}`;
  }

  return { config, isLoading, error, fetchConfig, saveConfig, rotateSecret, receiverUrl };
});
