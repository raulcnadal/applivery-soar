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

export interface SmartAttributeOption {
  id: string;
  name: string;
}

export const useWorkspaceAutomationStore = defineStore("workspaceAutomation", () => {
  const status = ref<AutomationCredentialStatus>({ configured: false, source: null });
  const isLoading = ref(false);
  const isSaving = ref(false);
  const error = ref<string | null>(null);

  // OS Patch Level Smart Attribute mapping (osPatchLevelMapping.service.ts)
  // — which Applivery Smart Attribute (by name) to surface as every
  // device's osPatchLevel, feeding CVE-matching precision and a Compliance
  // Policy condition. `smartAttributes` reuses the same GET
  // /api/smart-attributes catalog the Compliance Policy Builder's own
  // Smart Attribute picker uses (compliance.ts's fetchSmartAttributes).
  const osPatchLevelSmartAttributeName = ref<string | null>(null);
  const smartAttributes = ref<SmartAttributeOption[]>([]);
  const isLoadingMapping = ref(false);
  const isSavingMapping = ref(false);
  const mappingError = ref<string | null>(null);
  const smartAttributesError = ref<string | null>(null);
  // WorkspaceAutomationPanel.vue only calls fetchSmartAttributes() lazily
  // (when the admin opens the picker), not on every page mount — this
  // tracks that in-flight state for its own "Loading…" copy, separate from
  // isLoadingMapping (the cheap, always-on-mount fetchOsPatchLevelMapping).
  const isLoadingSmartAttributes = ref(false);

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

  async function fetchOsPatchLevelMapping() {
    isLoadingMapping.value = true;
    mappingError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/settings/os-patch-level-mapping");
      osPatchLevelSmartAttributeName.value = res.data.smartAttributeName ?? null;
    } catch (err: any) {
      mappingError.value = err?.response?.data?.detail || "Failed to load the OS Patch Level mapping.";
    } finally {
      isLoadingMapping.value = false;
    }
  }

  async function fetchSmartAttributes() {
    smartAttributesError.value = null;
    isLoadingSmartAttributes.value = true;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/smart-attributes");
      smartAttributes.value = res.data.items ?? [];
    } catch (err: any) {
      // GET /smart-attributes is documented elsewhere (appliveryClient.ts)
      // as a known-flaky, occasionally-timing-out Applivery API call. This
      // function used to have no try/catch at all, which meant a transient
      // failure here threw out of the Promise.all in
      // WorkspaceAutomationPanel.vue's onMounted — and since that await sat
      // ABOVE the line that seeds `selectedAttrName` from the already-saved
      // osPatchLevelSmartAttributeName, the whole assignment silently never
      // ran. The dropdown was left on its initial "" (Not mapped) value even
      // though the mapping was correctly saved and returned by the OTHER
      // (unrelated) fetch in the same Promise.all — looking exactly like a
      // save that "didn't stick," when the real save/read round-trip was
      // fine and this fetch's own failure was the only thing broken.
      smartAttributesError.value = err?.response?.data?.detail || "Failed to load the Smart Attributes list from Applivery — the OS Patch Level dropdown may be missing options. Try again.";
    } finally {
      isLoadingSmartAttributes.value = false;
    }
  }

  async function setOsPatchLevelMapping(smartAttributeName: string | null) {
    isSavingMapping.value = true;
    mappingError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.put("/settings/os-patch-level-mapping", { smartAttributeName });
      osPatchLevelSmartAttributeName.value = res.data.smartAttributeName ?? null;
    } catch (err: any) {
      mappingError.value = err?.response?.data?.detail || "Failed to save the OS Patch Level mapping.";
      throw err;
    } finally {
      isSavingMapping.value = false;
    }
  }

  return {
    status, isLoading, isSaving, error, fetchStatus, setServiceAccountToken, remove,
    osPatchLevelSmartAttributeName, smartAttributes, isLoadingMapping, isSavingMapping, mappingError, smartAttributesError,
    isLoadingSmartAttributes, fetchOsPatchLevelMapping, fetchSmartAttributes, setOsPatchLevelMapping,
  };
});
