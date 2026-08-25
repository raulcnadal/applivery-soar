import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * "Google Play Integrity API" Settings section (mobile telemetry roadmap
 * Phase 3) — GET/POST/DELETE /api/settings/play-integrity
 * (playIntegrity.controller.ts). Each workspace has its own distinct
 * GCP-linked Play Console listing, so an admin provides their own Cloud
 * Project Number plus the RSA private key + encrypted response file that
 * Play Console's own "Manage and download my response encryption keys"
 * flow requires (see playIntegrity.service.ts's module doc for why this
 * isn't as simple as pasting two base64 strings) — same "admin supplies
 * their own credential material, we derive-then-encrypt it at rest" shape
 * as workspaceAutomation.ts's Service Account token, not a single
 * server-wide/env-var value.
 *
 * Every field submitted in `setConfig` is write-only from the frontend's
 * perspective: GET only ever returns whether a config exists (`configured`),
 * never the key material itself, so this store never holds secret values
 * beyond the moment the admin submits the form. The RSA private key and
 * passphrase aren't even stored server-side — see setPlayIntegrityConfig's
 * own doc comment.
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

  async function setConfig(payload: { cloudProjectNumber: string; privateKeyPem: string; privateKeyPassphrase?: string; encryptedResponseFile: string; enabled: boolean }) {
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
