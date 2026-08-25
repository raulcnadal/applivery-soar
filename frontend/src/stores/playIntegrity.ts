import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * "Google Play Integrity API" Settings section (mobile telemetry roadmap
 * Phase 3) — GET/POST/DELETE /api/settings/play-integrity
 * (playIntegrity.controller.ts). Each workspace has its own distinct
 * GCP-linked Play Console listing, so an admin provides their own Cloud
 * Project Number plus the offline-decryption key pair downloaded from
 * Play Console (App integrity > Response encryption) — same "admin pastes
 * their own credential, we encrypt it at rest" shape as
 * workspaceAutomation.ts's Service Account token, not a single
 * server-wide/env-var value.
 *
 * The decryption key and verification key are write-only from the
 * frontend's perspective: GET only ever returns whether a config exists
 * (`configured`), never the key material itself, so this store never holds
 * secret values beyond the moment the admin submits the form.
 */
export interface PlayIntegrityStatus {
  configured: boolean;
  enabled: boolean;
  cloudProjectNumber: string | null;
  configuredBy: string | null;
  configuredAt: string | null;
}

export const usePlayIntegrityStore = defineStore("playIntegrity", () => {
  const status = ref<PlayIntegrityStatus>({ configured: false, enabled: false, cloudProjectNumber: null, configuredBy: null, configuredAt: null });
  const isLoading = ref(false);
  const isSaving = ref(false);
  const error = ref<string | null>(null);

  async function fetchStatus() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/settings/play-integrity");
      status.value = res.data;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load Google Play Integrity status.";
    } finally {
      isLoading.value = false;
    }
  }

  async function setConfig(payload: { cloudProjectNumber: string; decryptionKey: string; verificationKey: string; enabled: boolean }) {
    isSaving.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.post("/settings/play-integrity", payload);
      status.value = res.data;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to save Google Play Integrity configuration.";
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
      await api.delete("/settings/play-integrity");
      await fetchStatus();
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to remove Google Play Integrity configuration.";
      throw err;
    } finally {
      isSaving.value = false;
    }
  }

  return { status, isLoading, isSaving, error, fetchStatus, setConfig, remove };
});
