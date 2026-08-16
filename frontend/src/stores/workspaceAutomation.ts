import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Port of the "Workspace Automation" Settings section (docs/settings.md) —
 * GET/POST/DELETE /api/settings/automation-credential
 * (settings.controller.ts). Background jobs (compliance evaluator, ticket
 * sync, scheduled reports, etc.) run with no human logged in, so this stores
 * a standing credential per workspace: an Applivery Service Account Bearer
 * token (https://docs.applivery.com/en/platform/api/service-accounts/).
 *
 * Rewritten from an earlier "Use this session for automation" design that
 * snapshotted the signed-in admin's own apiToken/refreshToken pair. That
 * broke in production: Applivery's refresh endpoint rotates the refresh
 * token on every call, and the live browser session (useSessionGuards.ts)
 * kept refreshing itself independently of this stored snapshot — the two
 * consumers raced to rotate the same token and kept invalidating each
 * other's copy. A Service Account token has no refresh flow at all, so
 * there's nothing left to race.
 */
export interface AutomationCredentialStatus {
  configured: boolean;
  source: "stored" | null;
  configuredBy?: string | null;
  configuredAt?: string | null;
  lastVerifiedAt?: string | null;
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

  /** Persists a Service Account Bearer token for this workspace — validated against Applivery before it's stored (see automationCredential.service.ts). */
  async function setServiceAccountToken(serviceAccountToken: string) {
    isSaving.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      await api.post("/settings/automation-credential", { serviceAccountToken });
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

  return { status, isLoading, isSaving, error, fetchStatus, setServiceAccountToken, remove };
});
