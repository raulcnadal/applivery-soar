import { defineStore } from "pinia";
import { reactive, ref } from "vue";

/**
 * Settings > mTLS Agent Authentication — admin-facing store for the
 * backend's mtls.controller.ts routes (backend/docs/mtls-agent-auth-roadmap.md).
 * Covers CA lifecycle, the single Global Bootstrap Token, issued-certificate
 * visibility, the reverse-proxy config reference, and the Phase C
 * enforcement cutover flag. Same dynamic-import-per-action shape as every
 * other settings store (see deviceReportSecret.ts) — the dashboard token +
 * X-Workspace-Slug header are stamped on automatically by api/http.ts's
 * interceptor.
 *
 * Superseded the original per-device Bootstrap Tokens (Phase A/B/D) and the
 * Phase E "self-service enrollment" shared-secret + mode addendum — both
 * retired in favor of this single always-on mechanism (see
 * globalBootstrapToken.service.ts's module doc on the backend).
 */

export interface CaStatus {
  configured: boolean;
  source?: "generated" | "uploaded";
  keyAlgorithm?: string;
  leafValidityDays?: number;
  notBefore?: string;
  notAfter?: string;
  uploadedBy?: string | null;
  certPem?: string;
  updatedAt?: string;
}

export interface CertificateStatus {
  id: string;
  serialNumber: string;
  serialHex: string;
  thumbprint: string | null;
  status: "active" | "expiring-soon" | "expired" | "revoked" | "superseded";
  notBefore: string;
  notAfter: string;
  supersededAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  issuedAt: string;
  deviceId: string | null;
  deviceDisplayName: string | null;
  employeeName: string | null;
}

export interface CertificateCounts {
  active: number;
  revoked: number;
}

export interface CertPurgeSettings {
  enabled: boolean;
  retentionDays: number;
}

/** One independently paginated/searchable section (Active or Revoked) of the Issued Device Certificates panel. */
export interface CertificateListState {
  items: CertificateStatus[];
  total: number;
  search: string;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
}

function makeCertListState(): CertificateListState {
  return { items: [], total: 0, search: "", loading: false, error: null, hasMore: false };
}

const CERT_PAGE_SIZE = 50;

export interface GlobalBootstrapTokenStatus {
  configured: boolean;
  secret: string | null;
  rotatedBy?: string | null;
  rotatedAt?: string | null;
}

export interface ProxyConfig {
  headerCertVerified: string;
  headerCertCn: string;
  headerProxySecret: string;
  proxySecretConfigured: boolean;
}

export const useMtlsStore = defineStore("mtls", () => {
  const caStatus = ref<CaStatus | null>(null);
  const caLoading = ref(false);
  const caError = ref<string | null>(null);
  const caBusy = ref(false);

  // Two independently paginated/searchable sections — see certificates
  // .service.ts's listCertificates doc comment (backend) for why this
  // moved off "fetch every row, filter/paginate client-side" once fleets
  // reach thousands of issued certificates.
  const activeCerts = reactive(makeCertListState());
  const revokedCerts = reactive(makeCertListState());
  const certCounts = ref<CertificateCounts | null>(null);
  const certCountsLoading = ref(false);
  const certBusy = ref(false);

  const certPurgeSettings = ref<CertPurgeSettings | null>(null);
  const certPurgeSettingsLoading = ref(false);
  const certPurgeSettingsError = ref<string | null>(null);
  const certPurgeBusy = ref(false);
  const certPurgeError = ref<string | null>(null);
  const certPurgeLastResult = ref<{ purged: number } | null>(null);

  const enforcementEnabled = ref<boolean | null>(null);
  const enforcementLoading = ref(false);
  const enforcementError = ref<string | null>(null);
  const enforcementBusy = ref(false);

  const bootstrapTokenStatus = ref<GlobalBootstrapTokenStatus | null>(null);
  const bootstrapTokenLoading = ref(false);
  const bootstrapTokenError = ref<string | null>(null);
  const bootstrapTokenBusy = ref(false);

  const proxyConfig = ref<ProxyConfig | null>(null);
  const proxyConfigLoading = ref(false);
  const proxyConfigError = ref<string | null>(null);

  // Single source of truth for the dedicated reverse-proxy vhost — set only
  // from this panel's Reverse Proxy Configuration section; Device Data
  // Webhook reads agentSubdomain back read-only to build its Agent Base URL.
  const agentSubdomain = ref<string | null>(null);
  const agentSubdomainLoading = ref(false);
  const agentSubdomainError = ref<string | null>(null);
  const agentSubdomainBusy = ref(false);

  function errMsg(err: any, fallback: string): string {
    return err?.response?.data?.detail || fallback;
  }

  async function fetchCaStatus() {
    caLoading.value = true;
    caError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/mtls/ca");
      caStatus.value = res.data;
    } catch (err: any) {
      caError.value = errMsg(err, "Failed to load CA status.");
    } finally {
      caLoading.value = false;
    }
  }

  async function generateCa(confirmReplace = false) {
    caBusy.value = true;
    caError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.post("/mtls/ca/generate", { confirmReplace });
      caStatus.value = res.data;
    } catch (err: any) {
      caError.value = errMsg(err, "Failed to generate CA.");
      throw err;
    } finally {
      caBusy.value = false;
    }
  }

  async function uploadCa(certPem: string, privateKeyPem: string, confirmReplace = false) {
    caBusy.value = true;
    caError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.post("/mtls/ca/upload", { certPem, privateKeyPem, confirmReplace });
      caStatus.value = res.data;
    } catch (err: any) {
      caError.value = errMsg(err, "Failed to upload CA.");
      throw err;
    } finally {
      caBusy.value = false;
    }
  }

  async function setLeafValidityDays(leafValidityDays: number) {
    caBusy.value = true;
    caError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.patch("/mtls/ca/leaf-validity", { leafValidityDays });
      caStatus.value = res.data;
    } catch (err: any) {
      caError.value = errMsg(err, "Failed to update leaf certificate validity.");
      throw err;
    } finally {
      caBusy.value = false;
    }
  }

  async function fetchBootstrapTokenStatus() {
    bootstrapTokenLoading.value = true;
    bootstrapTokenError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/mtls/bootstrap-token");
      bootstrapTokenStatus.value = res.data;
    } catch (err: any) {
      bootstrapTokenError.value = errMsg(err, "Failed to load the global bootstrap token status.");
    } finally {
      bootstrapTokenLoading.value = false;
    }
  }

  async function rotateBootstrapToken() {
    bootstrapTokenBusy.value = true;
    bootstrapTokenError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.post("/mtls/bootstrap-token");
      bootstrapTokenStatus.value = res.data;
    } catch (err: any) {
      bootstrapTokenError.value = errMsg(err, "Failed to generate/rotate the global bootstrap token.");
      throw err;
    } finally {
      bootstrapTokenBusy.value = false;
    }
  }

  async function clearBootstrapToken() {
    bootstrapTokenBusy.value = true;
    bootstrapTokenError.value = null;
    try {
      const { api } = await import("../api/http");
      await api.delete("/mtls/bootstrap-token");
      await fetchBootstrapTokenStatus();
    } catch (err: any) {
      bootstrapTokenError.value = errMsg(err, "Failed to remove the global bootstrap token.");
      throw err;
    } finally {
      bootstrapTokenBusy.value = false;
    }
  }

  function stateFor(status: "active" | "revoked") {
    return status === "active" ? activeCerts : revokedCerts;
  }

  /**
   * Loads (or reloads, or appends the next page of) one section. `append`
   * drives "Load more": true fetches starting at the section's current item
   * count instead of resetting to the top — the search bar and section
   * (re)opening both call this with append=false to start over.
   */
  async function fetchCertificates(status: "active" | "revoked", options: { append?: boolean } = {}) {
    const state = stateFor(status);
    state.loading = true;
    state.error = null;
    const offset = options.append ? state.items.length : 0;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/mtls/certificates", {
        params: { status, search: state.search.trim() || undefined, limit: CERT_PAGE_SIZE, offset },
      });
      const items: CertificateStatus[] = res.data.items ?? [];
      const total: number = res.data.total ?? items.length;
      state.items = options.append ? [...state.items, ...items] : items;
      state.total = total;
      state.hasMore = state.items.length < total;
    } catch (err: any) {
      state.error = errMsg(err, `Failed to load ${status} certificates.`);
    } finally {
      state.loading = false;
    }
  }

  /** Updates a section's search term and re-fetches from the top — call sites debounce the keystroke, not this. */
  async function setCertSearch(status: "active" | "revoked", search: string) {
    stateFor(status).search = search;
    await fetchCertificates(status);
  }

  async function fetchCertCounts() {
    certCountsLoading.value = true;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/mtls/certificates/counts");
      certCounts.value = res.data;
    } catch {
      // Non-critical summary chip — the two section lists below still work without it.
    } finally {
      certCountsLoading.value = false;
    }
  }

  async function revokeCertificate(id: string, reason: string) {
    certBusy.value = true;
    activeCerts.error = null;
    try {
      const { api } = await import("../api/http");
      await api.post(`/mtls/certificates/${id}/revoke`, { reason });
      await Promise.all([fetchCertificates("active"), fetchCertificates("revoked"), fetchCertCounts()]);
    } catch (err: any) {
      activeCerts.error = errMsg(err, "Failed to revoke certificate.");
      throw err;
    } finally {
      certBusy.value = false;
    }
  }

  async function fetchCertPurgeSettings() {
    certPurgeSettingsLoading.value = true;
    certPurgeSettingsError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/mtls/certificates/purge-settings");
      certPurgeSettings.value = res.data;
    } catch (err: any) {
      certPurgeSettingsError.value = errMsg(err, "Failed to load the certificate purge schedule.");
    } finally {
      certPurgeSettingsLoading.value = false;
    }
  }

  async function saveCertPurgeSettings(settings: CertPurgeSettings) {
    certPurgeSettingsLoading.value = true;
    certPurgeSettingsError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.put("/mtls/certificates/purge-settings", settings);
      certPurgeSettings.value = res.data;
    } catch (err: any) {
      certPurgeSettingsError.value = errMsg(err, "Failed to save the certificate purge schedule.");
      throw err;
    } finally {
      certPurgeSettingsLoading.value = false;
    }
  }

  /** On-demand purge (the "Purge now" button) — independent of whether the scheduled toggle above is on. */
  async function purgeRevokedCertificatesNow(olderThanDays: number) {
    certPurgeBusy.value = true;
    certPurgeError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.post("/mtls/certificates/purge-now", { olderThanDays });
      certPurgeLastResult.value = res.data;
      await Promise.all([fetchCertificates("revoked"), fetchCertCounts()]);
      return res.data as { purged: number };
    } catch (err: any) {
      certPurgeError.value = errMsg(err, "Failed to purge revoked certificates.");
      throw err;
    } finally {
      certPurgeBusy.value = false;
    }
  }

  async function fetchEnforcement() {
    enforcementLoading.value = true;
    enforcementError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/mtls/enforcement");
      enforcementEnabled.value = res.data.enabled;
    } catch (err: any) {
      enforcementError.value = errMsg(err, "Failed to load enforcement status.");
    } finally {
      enforcementLoading.value = false;
    }
  }

  async function setEnforcement(enabled: boolean) {
    enforcementBusy.value = true;
    enforcementError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.put("/mtls/enforcement", { enabled });
      enforcementEnabled.value = res.data.enabled;
    } catch (err: any) {
      enforcementError.value = errMsg(err, "Failed to update enforcement setting.");
      throw err;
    } finally {
      enforcementBusy.value = false;
    }
  }

  async function fetchProxyConfig() {
    proxyConfigLoading.value = true;
    proxyConfigError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/mtls/proxy-config");
      proxyConfig.value = res.data;
    } catch (err: any) {
      proxyConfigError.value = errMsg(err, "Failed to load reverse-proxy configuration status.");
    } finally {
      proxyConfigLoading.value = false;
    }
  }

  async function fetchAgentSubdomain() {
    agentSubdomainLoading.value = true;
    agentSubdomainError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/mtls/agent-subdomain");
      agentSubdomain.value = res.data.agentSubdomain;
    } catch (err: any) {
      agentSubdomainError.value = errMsg(err, "Failed to load the agent subdomain.");
    } finally {
      agentSubdomainLoading.value = false;
    }
  }

  async function setAgentSubdomain(value: string | null) {
    agentSubdomainBusy.value = true;
    agentSubdomainError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.put("/mtls/agent-subdomain", { agentSubdomain: value });
      agentSubdomain.value = res.data.agentSubdomain;
    } catch (err: any) {
      agentSubdomainError.value = errMsg(err, "Failed to save the agent subdomain.");
      throw err;
    } finally {
      agentSubdomainBusy.value = false;
    }
  }

  return {
    caStatus, caLoading, caError, caBusy,
    fetchCaStatus, generateCa, uploadCa, setLeafValidityDays,
    activeCerts, revokedCerts, certCounts, certCountsLoading, certBusy,
    fetchCertificates, setCertSearch, fetchCertCounts, revokeCertificate,
    certPurgeSettings, certPurgeSettingsLoading, certPurgeSettingsError,
    certPurgeBusy, certPurgeError, certPurgeLastResult,
    fetchCertPurgeSettings, saveCertPurgeSettings, purgeRevokedCertificatesNow,
    enforcementEnabled, enforcementLoading, enforcementError, enforcementBusy,
    fetchEnforcement, setEnforcement,
    bootstrapTokenStatus, bootstrapTokenLoading, bootstrapTokenError, bootstrapTokenBusy,
    fetchBootstrapTokenStatus, rotateBootstrapToken, clearBootstrapToken,
    proxyConfig, proxyConfigLoading, proxyConfigError, fetchProxyConfig,
    agentSubdomain, agentSubdomainLoading, agentSubdomainError, agentSubdomainBusy,
    fetchAgentSubdomain, setAgentSubdomain,
  };
});
