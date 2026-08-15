import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Settings > mTLS Agent Authentication — admin-facing store for the
 * backend's mtls.controller.ts routes (backend/docs/mtls-agent-auth-roadmap.md).
 * Covers CA lifecycle, bootstrap-token minting, issued-certificate visibility,
 * and the Phase C enforcement cutover flag. Same dynamic-import-per-action
 * shape as every other settings store (see deviceReportSecret.ts) — the
 * dashboard token + X-Workspace-Slug header are stamped on automatically by
 * api/http.ts's interceptor.
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

export interface BootstrapTokenStatus {
  id: string;
  serialNumber: string;
  status: "pending" | "used" | "expired";
  expiresAt: string;
  usedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface MintedBootstrapToken {
  id: string;
  serialNumber: string;
  token: string;
  expiresAt: string;
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

export const useMtlsStore = defineStore("mtls", () => {
  const caStatus = ref<CaStatus | null>(null);
  const caLoading = ref(false);
  const caError = ref<string | null>(null);
  const caBusy = ref(false);

  const bootstrapTokens = ref<BootstrapTokenStatus[]>([]);
  const tokensLoading = ref(false);
  const tokensError = ref<string | null>(null);
  const tokenBusy = ref(false);
  // Plaintext tokens are only ever visible at mint time — held here just
  // long enough for the panel to show a copy-once banner, never persisted.
  const lastMintedTokens = ref<MintedBootstrapToken[]>([]);

  const certificates = ref<CertificateStatus[]>([]);
  const certsLoading = ref(false);
  const certsError = ref<string | null>(null);
  const certBusy = ref(false);

  const enforcementEnabled = ref<boolean | null>(null);
  const enforcementLoading = ref(false);
  const enforcementError = ref<string | null>(null);
  const enforcementBusy = ref(false);

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

  async function fetchBootstrapTokens() {
    tokensLoading.value = true;
    tokensError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/mtls/bootstrap-tokens");
      bootstrapTokens.value = res.data.items;
    } catch (err: any) {
      tokensError.value = errMsg(err, "Failed to load bootstrap tokens.");
    } finally {
      tokensLoading.value = false;
    }
  }

  async function mintBootstrapToken(serialNumber: string, expiresInDays: number) {
    tokenBusy.value = true;
    tokensError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.post("/mtls/bootstrap-tokens", { serialNumber, expiresInDays });
      lastMintedTokens.value = [res.data];
      await fetchBootstrapTokens();
    } catch (err: any) {
      tokensError.value = errMsg(err, "Failed to mint bootstrap token.");
      throw err;
    } finally {
      tokenBusy.value = false;
    }
  }

  async function mintBootstrapTokensBulk(serialNumbers: string[], expiresInDays: number) {
    tokenBusy.value = true;
    tokensError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.post("/mtls/bootstrap-tokens/bulk", { serialNumbers, expiresInDays });
      lastMintedTokens.value = res.data.items;
      await fetchBootstrapTokens();
    } catch (err: any) {
      tokensError.value = errMsg(err, "Failed to mint bootstrap tokens.");
      throw err;
    } finally {
      tokenBusy.value = false;
    }
  }

  function dismissMintedTokens() {
    lastMintedTokens.value = [];
  }

  async function revokeBootstrapToken(id: string) {
    tokenBusy.value = true;
    tokensError.value = null;
    try {
      const { api } = await import("../api/http");
      await api.delete(`/mtls/bootstrap-tokens/${id}`);
      await fetchBootstrapTokens();
    } catch (err: any) {
      tokensError.value = errMsg(err, "Failed to revoke bootstrap token.");
      throw err;
    } finally {
      tokenBusy.value = false;
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

  return {
    caStatus, caLoading, caError, caBusy,
    fetchCaStatus, generateCa, uploadCa, setLeafValidityDays,
    bootstrapTokens, tokensLoading, tokensError, tokenBusy, lastMintedTokens,
    fetchBootstrapTokens, mintBootstrapToken, mintBootstrapTokensBulk, dismissMintedTokens, revokeBootstrapToken,
    certificates, certsLoading, certsError, certBusy,
    fetchCertificates, revokeCertificate,
    enforcementEnabled, enforcementLoading, enforcementError, enforcementBusy,
    fetchEnforcement, setEnforcement,
  };
});
