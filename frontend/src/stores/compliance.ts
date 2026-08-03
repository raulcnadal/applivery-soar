import { defineStore } from "pinia";
import { ref } from "vue";

export interface ConditionRule {
  field: string;
  operator: string;
  value: any;
}

export interface CompliancePolicy {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  autoRun: boolean;
  severity: "low" | "medium" | "high" | "critical";
  conditionLogic: "any" | "all";
  conditions: ConditionRule[];
  workflowId?: string | null;
  nonComplianceTag?: string | null;
  nonComplianceSmartAttributeId?: string | null;
  openCaseOnViolation: boolean;
  autoResolveCaseOnRecovery: boolean;
  mitreTechniques: string[];
  framework?: string | null;
  controlRef?: string | null;
  targetDeviceAudienceId?: string | null;
  evaluationIntervalMinutes?: number | null;
  autoRunBatchCap?: number | null;
  autoRunDestructiveAck: boolean;
  escalatedWorkflowId?: string | null;
  escalatedWorkflowMinRiskTier: string;
  lastEvaluatedAt?: string | null;
  autoRunTripped: boolean;
  autoRunTrippedReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceViolation {
  id: string;
  policyId: string;
  policyName?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
  workflowRunId?: string | null;
  escalated: boolean;
  deviceId: string;
  deviceName?: string | null;
  platform?: string | null;
  platformDeviceId?: string | null;
  matchedConditions?: ConditionRule[];
  caseId?: string | null;
  status: string;
  severity: string;
  detectedAt: string;
  resolvedAt?: string | null;
}

export interface ComplianceFieldDef {
  key: string;
  label: string;
  type: string;
  operators: string[];
  options?: string[];
}

export interface SmartAttributeDef {
  id: string;
  name: string;
}

export interface MatchedDevice {
  id: string;
  displayName?: string | null;
  platformLabel?: string | null;
  isCompliant?: boolean;
}

export interface MatchedDevicesDiagnostics {
  error?: string | null;
  httpStatus?: number | null;
  rawMemberCount?: number;
  rawMembers?: Array<{ id: string; displayName?: string | null; platformKey?: string }>;
}

export interface MitreTechnique {
  id: string;
  name: string;
  tactic: string;
  triggeredByFields?: string[];
}

export interface ComplianceTemplate {
  id: string;
  framework: string;
  controlRef: string;
  title: string;
  severity: string;
  conditionLogic: "any" | "all";
  description: string;
  conditions: ConditionRule[];
}

export interface AppCatalogEntry {
  id: string;
  platform: string;
  identifier: string;
  name?: string | null;
  iconUrl?: string | null;
  source?: string | null;
}

export interface AppList {
  id: string;
  name: string;
  platform: string;
  appIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

export const useComplianceStore = defineStore("compliance", () => {
  const policies = ref<CompliancePolicy[]>([]);
  const isLoadingPolicies = ref(false);
  const policiesError = ref<string | null>(null);

  const violations = ref<ComplianceViolation[]>([]);
  const violationsTotal = ref(0);
  const violationsOffset = ref(0);
  const violationsLimit = ref(100);
  const violationsStatusFilter = ref<string>("pending");
  const isLoadingViolations = ref(false);
  const violationsError = ref<string | null>(null);

  const fields = ref<ComplianceFieldDef[]>([]);
  const mitreTechniques = ref<MitreTechnique[]>([]);
  const mitreTactics = ref<Array<{ key: string; name: string; order: number }>>([]);

  const templates = ref<ComplianceTemplate[]>([]);
  const frameworks = ref<Array<{ key: string; name: string; description?: string }>>([]);

  const appCatalog = ref<AppCatalogEntry[]>([]);
  const appLists = ref<AppList[]>([]);

  const smartAttributeNames = ref<string[]>([]);
  const selfReportedAttributeNames = ref<string[]>([]);
  const smartAttributes = ref<SmartAttributeDef[]>([]);
  // policyId -> live violator device count, for the policy grid cards.
  const violatorCounts = ref<Record<string, number | null>>({});

  async function fetchPolicies() {
    isLoadingPolicies.value = true;
    policiesError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/compliance/policies");
      policies.value = res.data.items ?? [];
    } catch (err: any) {
      policiesError.value = err?.response?.data?.detail || "Failed to load compliance policies.";
    } finally {
      isLoadingPolicies.value = false;
    }
  }

  async function createPolicy(payload: Partial<CompliancePolicy>) {
    const { api } = await import("../api/http");
    await api.post("/compliance/policies", payload);
    await fetchPolicies();
  }

  async function updatePolicy(policyId: string, payload: Partial<CompliancePolicy>) {
    const { api } = await import("../api/http");
    await api.put(`/compliance/policies/${policyId}`, payload);
    await fetchPolicies();
  }

  async function deletePolicy(policyId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/compliance/policies/${policyId}`);
    await fetchPolicies();
  }

  async function evaluateNow(policyId?: string) {
    const { api } = await import("../api/http");
    const res = await api.post("/compliance/evaluate", policyId ? { policyId } : {});
    return res.data as {
      evaluatedPolicies: number;
      devicesChecked: number;
      violationsFound: number;
      autoFired: number;
      queuedForReview: number;
      recovered: number;
      autoRunSafetyBlocked: number;
    };
  }

  async function fetchViolatingDeviceIds(policyId: string): Promise<string[]> {
    const { api } = await import("../api/http");
    const res = await api.get(`/compliance/policies/${policyId}/violating-device-ids`);
    return res.data.deviceIds ?? [];
  }

  async function fetchViolations() {
    isLoadingViolations.value = true;
    violationsError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/compliance/violations", {
        params: {
          status: violationsStatusFilter.value || undefined,
          limit: violationsLimit.value,
          offset: violationsOffset.value,
        },
      });
      violations.value = res.data.items ?? [];
      violationsTotal.value = res.data.total ?? 0;
    } catch (err: any) {
      violationsError.value = err?.response?.data?.detail || "Failed to load violations.";
    } finally {
      isLoadingViolations.value = false;
    }
  }

  function exportViolationsUrl(): string {
    const params = new URLSearchParams();
    if (violationsStatusFilter.value) params.set("status", violationsStatusFilter.value);
    return `/api/compliance/violations/export?${params.toString()}`;
  }

  async function approveViolation(violationId: string) {
    const { api } = await import("../api/http");
    await api.post(`/compliance/violations/${violationId}/approve`);
    await fetchViolations();
  }

  async function dismissViolation(violationId: string) {
    const { api } = await import("../api/http");
    await api.post(`/compliance/violations/${violationId}/dismiss`);
    await fetchViolations();
  }

  async function bulkApprove(violationIds: string[]) {
    const { api } = await import("../api/http");
    const res = await api.post("/compliance/violations/bulk-approve", { violationIds });
    await fetchViolations();
    return res.data as { approved: string[]; failed: Array<{ id: string; error: string }> };
  }

  async function bulkDismiss(violationIds: string[]) {
    const { api } = await import("../api/http");
    const res = await api.post("/compliance/violations/bulk-dismiss", { violationIds });
    await fetchViolations();
    return res.data as { dismissed: string[]; failed: Array<{ id: string; error: string }> };
  }

  async function fetchFields() {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/fields");
    fields.value = res.data.items ?? [];
  }

  async function fetchSmartAttributeNames(platform?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/smart-attribute-names", { params: platform ? { platform } : {} });
    smartAttributeNames.value = res.data.items ?? [];
  }

  async function fetchSelfReportedAttributeNames(platform?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/self-reported-attribute-names", { params: platform ? { platform } : {} });
    selfReportedAttributeNames.value = res.data.items ?? [];
  }

  async function fetchSmartAttributes() {
    const { api } = await import("../api/http");
    const res = await api.get("/smart-attributes");
    smartAttributes.value = res.data.items ?? [];
  }

  async function fetchMatchedDevices(deviceAudienceId: string): Promise<{ items: MatchedDevice[]; diagnostics: MatchedDevicesDiagnostics | null }> {
    const { api } = await import("../api/http");
    const res = await api.get(`/device-audiences/${deviceAudienceId}/matched-devices`);
    return { items: res.data.items ?? [], diagnostics: res.data.diagnostics ?? null };
  }

  async function refreshViolatorCounts(policyIds: string[]) {
    const { api } = await import("../api/http");
    const entries = await Promise.all(
      policyIds.map(async (id) => {
        try {
          const res = await api.get(`/compliance/policies/${id}/violating-device-ids`);
          return [id, (res.data?.deviceIds ?? []).length] as const;
        } catch {
          return [id, null] as const;
        }
      }),
    );
    violatorCounts.value = Object.fromEntries(entries);
  }

  async function suggestMitreTechniques(conditions: ConditionRule[]): Promise<MitreTechnique[]> {
    const { api } = await import("../api/http");
    const res = await api.post("/compliance/suggest-mitre-techniques", { conditions });
    return res.data.items ?? [];
  }

  async function fetchMitreTechniques() {
    const { api } = await import("../api/http");
    const res = await api.get("/mitre/techniques");
    mitreTechniques.value = res.data.items ?? [];
    mitreTactics.value = res.data.tactics ?? [];
  }

  async function fetchTemplates(framework?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/templates", { params: framework ? { framework } : {} });
    templates.value = res.data.items ?? [];
    frameworks.value = res.data.frameworks ?? [];
  }

  async function fetchAppCatalog(platform?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/app-catalog", { params: platform ? { platform } : {} });
    appCatalog.value = res.data.items ?? [];
  }

  async function addAppCatalogEntry(payload: { platform: string; identifier: string; name?: string; iconUrl?: string; source?: string }) {
    const { api } = await import("../api/http");
    await api.post("/app-catalog", payload);
    await fetchAppCatalog();
  }

  async function deleteAppCatalogEntry(entryId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/app-catalog/${entryId}`);
    await fetchAppCatalog();
  }

  async function fetchAppLists(platform?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/app-lists", { params: platform ? { platform } : {} });
    appLists.value = res.data.items ?? [];
  }

  async function createAppList(payload: { name: string; platform: string; appIds: string[] }) {
    const { api } = await import("../api/http");
    await api.post("/app-lists", payload);
    await fetchAppLists();
  }

  async function updateAppList(listId: string, payload: { name: string; platform: string; appIds: string[] }) {
    const { api } = await import("../api/http");
    await api.put(`/app-lists/${listId}`, payload);
    await fetchAppLists();
  }

  async function deleteAppList(listId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/app-lists/${listId}`);
    await fetchAppLists();
  }

  async function searchApps(platform: string, query: string, source?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/app-search", { params: { platform, text: query, source } });
    return res.data.items ?? [];
  }

  return {
    policies,
    isLoadingPolicies,
    policiesError,
    violations,
    violationsTotal,
    violationsOffset,
    violationsLimit,
    violationsStatusFilter,
    isLoadingViolations,
    violationsError,
    fields,
    mitreTechniques,
    mitreTactics,
    templates,
    frameworks,
    appCatalog,
    appLists,
    smartAttributeNames,
    selfReportedAttributeNames,
    smartAttributes,
    violatorCounts,
    fetchSmartAttributeNames,
    fetchSelfReportedAttributeNames,
    fetchSmartAttributes,
    fetchMatchedDevices,
    refreshViolatorCounts,
    fetchPolicies,
    createPolicy,
    updatePolicy,
    deletePolicy,
    evaluateNow,
    fetchViolatingDeviceIds,
    fetchViolations,
    exportViolationsUrl,
    approveViolation,
    dismissViolation,
    bulkApprove,
    bulkDismiss,
    fetchFields,
    suggestMitreTechniques,
    fetchMitreTechniques,
    fetchTemplates,
    fetchAppCatalog,
    addAppCatalogEntry,
    deleteAppCatalogEntry,
    fetchAppLists,
    createAppList,
    updateAppList,
    deleteAppList,
    searchApps,
  };
});
