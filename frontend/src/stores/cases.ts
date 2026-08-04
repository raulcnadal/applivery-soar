import { defineStore } from "pinia";
import { ref } from "vue";

/** Port of Case Management + SLA + Auto-Run Rules (main.py Case Management section). */

export interface CaseTimelineEntry {
  id: string;
  type: string;
  message: string;
  actor: string | null;
  at: string;
}

export interface CaseNote {
  id: string;
  authorEmail: string | null;
  text: string;
  createdAt: string;
}

export interface ThreatIntelResult {
  id: string;
  ioc: string;
  iocType: string;
  provider: string | null;
  providerType: string | null;
  verdict: string;
  score: number | null;
  detail: string;
  link: string | null;
  checkedAt: string;
  checkedBy: string | null;
  cached: boolean;
}

export interface ExternalRef {
  type: string;
  id: string;
  url: string;
  sysId?: string | null;
  remoteStatus?: string | null;
  remoteResolved?: boolean;
  remoteStatusCheckedAt?: string | null;
  remoteStatusError?: string | null;
}

export interface CaseSlaStatus {
  ackDueAt: string | null;
  ackBreached: boolean;
  resolveDueAt: string | null;
  resolveBreached: boolean;
}

export interface Case {
  id: string;
  title: string;
  status: string;
  severity: string;
  source: string;
  deviceId: string | null;
  deviceName: string | null;
  segmentId: string | null;
  policyId: string | null;
  policyName: string | null;
  violationIds: string[];
  workflowRunIds: string[];
  assignee: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  acknowledgedAt: string | null;
  slaClockStartedAt: string;
  slaAckBreachNotifiedAt: string | null;
  slaResolveBreachNotifiedAt: string | null;
  mitreTechniques: string[];
  threatIntel: ThreatIntelResult[];
  externalRefs: ExternalRef[];
  notes: CaseNote[];
  timeline: CaseTimelineEntry[];
  slaStatus?: CaseSlaStatus;
}

export interface CaseSlaThreshold {
  acknowledgeMinutes: number;
  resolveMinutes: number;
}

export interface CaseSlaSettings {
  enabled: boolean;
  notifyOnBreach: boolean;
  thresholds: Record<string, CaseSlaThreshold>;
}

export interface CaseAutoRunRule {
  id: string;
  name: string;
  enabled: boolean;
  minSeverity: string;
  mitreTechniques: string[];
  workflowId: string;
  autoRunDestructiveAck: boolean;
  maxFiresPerHour: number;
  recentFires: string[];
  createdAt: string;
  updatedAt: string;
}

export const useCasesStore = defineStore("cases", () => {
  const cases = ref<Case[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const activeCase = ref<Case | null>(null);
  const assigneeSuggestions = ref<string[]>([]);

  const slaSettings = ref<CaseSlaSettings | null>(null);
  const autoRunRules = ref<CaseAutoRunRule[]>([]);

  async function fetchCases() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/cases");
      cases.value = res.data.items ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load cases.";
    } finally {
      isLoading.value = false;
    }
  }

  async function fetchCase(caseId: string) {
    const { api } = await import("../api/http");
    const res = await api.get(`/cases/${caseId}`);
    activeCase.value = res.data;
    return res.data as Case;
  }

  // Port of handleExportCases (CasesView.jsx:319-330) — the export endpoint
  // sits behind verifyDashboardToken, which only reads the X-Dashboard-Token
  // header (auth.middleware.ts:28), so a plain `<a href>`/`window.open` to
  // this URL 401s with no header attached. Must go through `api` (whose
  // request interceptor stamps that header on every call) and pull the
  // response down as an authenticated blob instead — same fix as
  // compliance.ts's exportViolationsCsv.
  async function exportCasesCsv() {
    const { api } = await import("../api/http");
    const res = await api.get("/cases/export", { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = "cases.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function fetchAssigneeSuggestions() {
    const { api } = await import("../api/http");
    const res = await api.get("/cases/assignee-suggestions");
    assigneeSuggestions.value = res.data.items ?? [];
  }

  async function createCase(payload: { title: string; severity?: string; deviceId?: string | null; deviceName?: string | null; notes?: string | null; mitreTechniques?: string[] }) {
    const { api } = await import("../api/http");
    await api.post("/cases", payload);
    await fetchCases();
  }

  async function updateCase(caseId: string, payload: Partial<Pick<Case, "title" | "status" | "severity" | "assignee" | "mitreTechniques">>) {
    const { api } = await import("../api/http");
    const res = await api.put(`/cases/${caseId}`, payload);
    if (activeCase.value?.id === caseId) activeCase.value = res.data;
    await fetchCases();
    return res.data as Case;
  }

  async function bulkUpdateCases(caseIds: string[], payload: { status?: string | null; assignee?: string | null }) {
    const { api } = await import("../api/http");
    const res = await api.post("/cases/bulk-update", { caseIds, ...payload });
    await fetchCases();
    return res.data as { updated: string[]; failed: Array<{ id: string; error: string }> };
  }

  async function addNote(caseId: string, text: string) {
    const { api } = await import("../api/http");
    const res = await api.post(`/cases/${caseId}/notes`, { text });
    if (activeCase.value?.id === caseId) activeCase.value = res.data;
    return res.data as Case;
  }

  async function runWorkflowFromCase(caseId: string, workflowId: string) {
    const { api } = await import("../api/http");
    const res = await api.post(`/cases/${caseId}/run-workflow`, { workflowId });
    if (activeCase.value?.id === caseId) activeCase.value = res.data.case;
    return res.data as { case: Case; runId: string };
  }

  async function retryIntegrations(caseId: string) {
    const { api } = await import("../api/http");
    const res = await api.post(`/cases/${caseId}/retry-integrations`);
    if (activeCase.value?.id === caseId) activeCase.value = res.data;
    return res.data as Case;
  }

  async function syncTicketStatus(caseId: string) {
    const { api } = await import("../api/http");
    const res = await api.post(`/cases/${caseId}/sync-ticket-status`);
    if (activeCase.value?.id === caseId) activeCase.value = res.data.case;
    return res.data as { case: Case; autoClosed: boolean };
  }

  async function enrichCase(caseId: string, value: string, forceRefresh = false) {
    const { api } = await import("../api/http");
    const res = await api.post(`/cases/${caseId}/enrich`, { value, forceRefresh });
    if (activeCase.value?.id === caseId) activeCase.value = res.data;
    return res.data as Case;
  }

  async function fetchSlaSettings() {
    // Previously had no try/catch — a failed GET here left slaSettings.value
    // untouched (null), and CaseSlaSettingsForm.vue's onMounted awaited this
    // with no try/catch of its own either, so its `form` just silently kept
    // its hardcoded defaults with no on-screen indication anything failed —
    // indistinguishable from "my SLA settings got reset" even though
    // nothing was actually lost server-side.
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/case-sla-settings");
      slaSettings.value = res.data;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load SLA settings.";
      throw err;
    }
  }

  async function updateSlaSettings(payload: CaseSlaSettings) {
    const { api } = await import("../api/http");
    const res = await api.put("/case-sla-settings", payload);
    slaSettings.value = res.data;
  }

  async function fetchAutoRunRules() {
    // Same missing-try/catch pattern as fetchSlaSettings above — an
    // unhandled rejection here previously left autoRunRules.value at
    // whatever it was (empty on first load), with no visible error.
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/case-autorun-rules");
      autoRunRules.value = res.data.items ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load auto-run rules.";
      throw err;
    }
  }

  async function createAutoRunRule(payload: Partial<CaseAutoRunRule>) {
    const { api } = await import("../api/http");
    await api.post("/case-autorun-rules", payload);
    await fetchAutoRunRules();
  }

  async function updateAutoRunRule(ruleId: string, payload: Partial<CaseAutoRunRule>) {
    const { api } = await import("../api/http");
    await api.put(`/case-autorun-rules/${ruleId}`, payload);
    await fetchAutoRunRules();
  }

  async function deleteAutoRunRule(ruleId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/case-autorun-rules/${ruleId}`);
    await fetchAutoRunRules();
  }

  return {
    cases, isLoading, error, activeCase, assigneeSuggestions, slaSettings, autoRunRules,
    fetchCases, fetchCase, exportCasesCsv, fetchAssigneeSuggestions,
    createCase, updateCase, bulkUpdateCases, addNote, runWorkflowFromCase,
    retryIntegrations, syncTicketStatus, enrichCase,
    fetchSlaSettings, updateSlaSettings,
    fetchAutoRunRules, createAutoRunRule, updateAutoRunRule, deleteAutoRunRule,
  };
});
