import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Port of the "Workspace Automation" Settings section (docs/settings.md) —
 * GET/POST/DELETE /api/settings/automation-credential
 * (settings.controller.ts). Background jobs (compliance evaluator, ticket
 * sync, scheduled reports, etc.) run with no human logged in, but Applivery
 * API tokens are per-session and expire, so this stores a standing
 * credential per workspace.
 */
export interface AutomationCredentialStatus {
  configured: boolean;
  source: "stored" | null;
  configuredBy?: string | null;
  configuredAt?: string | null;
  lastRefreshedAt?: string | null;
}

export const useWorkspaceAutomationStore = defineStore("workspaceAutomation", () => {
  const status = ref<AutomationCredentialStatus>({ configured: false, source: null });
  const isLoading = ref(false);
  const isSaving = ref(false);
  const error = ref<string | null>(null);

  async function fetchStatus() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/settings/automation-credential");
      status.value = res.data;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load automation credential status.";
    } finally {
      isLoading.value = false;
    }
  }

  /** "Use this session for automation" — captures the currently-signed-in session's own tokens. */
  async function useCurrentSession(payload: {
    apiToken: string;
    refreshToken: string;
    apiTokenExpireAt?: string | null;
    refreshTokenExpireAt?: string | null;
  }) {
    isSaving.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      await api.post("/settings/automation-credential", payload);
      await fetchStatus();
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to set automation credential.";
      throw err;
    } finally {
      isSaving.value = false;
    }
  }

  async function remove() {
    isSaving.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      await api.delete("/settings/automation-credential");
      await fetchStatus();
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to remove automation credential.";
      throw err;
    } finally {
      isSaving.value = false;
    }
  }

  return { status, isLoading, isSaving, error, fetchStatus, useCurrentSession, remove };
});
