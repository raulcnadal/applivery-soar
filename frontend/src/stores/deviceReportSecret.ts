import { defineStore } from "pinia";
import { ref } from "vue";

/** Port of /api/settings/device-report-secret* + device-report-scripts* (main.py:7799-7897). */

export interface DeviceReportSecretStatus {
  configured: boolean;
  secret: string | null;
  rotatedBy?: string | null;
  rotatedAt?: string | null;
}

export const useDeviceReportSecretStore = defineStore("deviceReportSecret", () => {
  const status = ref<DeviceReportSecretStatus | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function fetchStatus() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/settings/device-report-secret");
      status.value = res.data;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load device-report webhook status.";
    } finally {
      isLoading.value = false;
    }
  }

  async function rotate() {
    const { api } = await import("../api/http");
    const res = await api.post("/settings/device-report-secret");
    status.value = res.data;
  }

  async function clear() {
    const { api } = await import("../api/http");
    await api.delete("/settings/device-report-secret");
    await fetchStatus();
  }

  async function downloadScript(kind: "apps" | "security", platform: string, orgSlug: string) {
    const { api } = await import("../api/http");
    const path = kind === "apps" ? `/settings/device-report-scripts/${platform}` : `/settings/device-report-scripts-security/${platform}`;
    const res = await api.get(path, { responseType: "text" });
    const origin = window.location.origin;
    const secret = status.value?.secret ?? "";
    const webhookUrl = kind === "apps" ? `${origin}/api/device-data/report-apps` : `${origin}/api/device-data/report`;
    const content = String(res.data)
      .replaceAll("__WEBHOOK_URL__", webhookUrl)
      .replaceAll("__WORKSPACE_SLUG__", orgSlug)
      .replaceAll("__REPORT_SECRET__", secret);
    const filename = `${kind}-${platform}.${platform === "windows" ? "ps1" : "sh"}`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { status, isLoading, error, fetchStatus, rotate, clear, downloadScript };
});
