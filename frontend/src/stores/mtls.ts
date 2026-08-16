import { defineStore } from "pinia";
import { ref } from "vue";

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
  status: "active" | "expiring-soon" | "expired" | "revoked" | "superseded";
  notBefore: string;
  notAfter: string;
  supersededAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  issuedAt: string;
}

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

  const certificates = ref<CertificateStatus[]>([]);
  const certsLoading = ref(false);
  const certsError = ref<string | null>(null);
  const certBusy = ref(false);

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

  async function fetchCertificates() {
    certsLoading.value = true;
    certsError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/mtls/certificates");
      certificates.value = res.data.items;
    } catch (err: any) {
      certsError.value = errMsg(err, "Failed to load issued certificates.");
    } finally {
      certsLoading.value = false;
    }
  }

  async function revokeCertificate(id: string, reason: string) {
    certBusy.value = true;
    certsError.value = null;
    try {
      const { api } = await import("../api/http");
      await api.post(`/mtls/certificates/${id}/revoke`, { reason });
      await fetchCertificates();
    } catch (err: any) {
      certsError.value = errMsg(err, "Failed to revoke certificate.");
      throw err;
    } finally {
      certBusy.value = false;
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
    certificates, certsLoading, certsError, certBusy,
    fetchCertificates, revokeCertificate,
    enforcementEnabled, enforcementLoading, enforcementError, enforcementBusy,
    fetchEnforcement, setEnforcement,
    bootstrapTokenStatus, bootstrapTokenLoading, bootstrapTokenError, bootstrapTokenBusy,
    fetchBootstrapTokenStatus, rotateBootstrapToken, clearBootstrapToken,
    proxyConfig, proxyConfigLoading, proxyConfigError, fetchProxyConfig,
    agentSubdomain, agentSubdomainLoading, agentSubdomainError, agentSubdomainBusy,
    fetchAgentSubdomain, setAgentSubdomain,
  };
});
