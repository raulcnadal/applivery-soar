import { defineStore } from "pinia";
import { ref } from "vue";

export interface WorkflowStep {
  id: string;
  type: string; // 'mdm_action' | 'http_request' | 'notification' | 'policy_replace' | 'policy_add' | 'policy_restore' | 'monitor' | 'wait' | 'run_script_wait'
  name: string;
  config: Record<string, any>;
  onSuccess?: string | null;
  onFailure?: string | null;
}

export interface WorkflowRecovery {
  enabled: boolean;
  compliancePolicyId?: string | null;
  steps: WorkflowStep[];
}

export interface Workflow {
  id: string;
  name: string;
  description?: string | null;
  steps: WorkflowStep[];
  targetPlatform?: string | null;
  targetDeploymentModel?: string | null;
  recovery: WorkflowRecovery;
  allowUnattendedDestructive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  reason: string;
  createdBy?: string | null;
  snapshot: Partial<Workflow>;
  createdAt: string;
}

export interface DryRunStepPreview {
  stepId: string;
  name: string;
  type: string;
  summary: string;
  onSuccessStepId: string;
  onSuccessLabel: string;
  onFailureStepId: string;
  onFailureLabel: string;
}

export interface DryRunResult {
  workflowId: string;
  workflowName: string;
  device: { id: string; displayName?: string | null };
  steps: DryRunStepPreview[];
  recoverySteps: Array<{ stepId: string; name: string; type: string; summary: string }> | null;
  note: string;
}

export interface StepLogEntry {
  stepId: string;
  name: string;
  type: string;
  ok: boolean;
  detail: string;
  phase?: "recovery";
}

export interface WorkflowDeviceResult {
  deviceId: string;
  deviceName?: string | null;
  steps: StepLogEntry[];
  finalStatus: "success" | "partial" | "failed";
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  total: number;
  completed: number;
  results: WorkflowDeviceResult[];
  targetDescription?: string | null;
}

export interface MdmActionField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface MdmActionDef {
  key: string;
  label: string;
  destructive: boolean;
  platforms: string[];
  deploymentModels: Record<string, string[]>;
  fields?: MdmActionField[];
  unconfirmed: boolean;
}

export const useWorkflowsStore = defineStore("workflows", () => {
  const workflows = ref<Workflow[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const mdmActions = ref<MdmActionDef[]>([]);

  const runs = ref<WorkflowRun[]>([]);
  const runsTotal = ref(0);
  const isLoadingRuns = ref(false);

  async function fetchWorkflows() {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/workflows");
      workflows.value = res.data.items ?? [];
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load workflows.";
    } finally {
      isLoading.value = false;
    }
  }

  async function createWorkflow(payload: Partial<Workflow>) {
    const { api } = await import("../api/http");
    await api.post("/workflows", payload);
    await fetchWorkflows();
  }

  async function updateWorkflow(workflowId: string, payload: Partial<Workflow>) {
    const { api } = await import("../api/http");
    await api.put(`/workflows/${workflowId}`, payload);
    await fetchWorkflows();
  }

  async function deleteWorkflow(workflowId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/workflows/${workflowId}`);
    await fetchWorkflows();
  }

  async function fetchVersions(workflowId: string): Promise<WorkflowVersion[]> {
    const { api } = await import("../api/http");
    const res = await api.get(`/workflows/${workflowId}/versions`);
    return res.data.items ?? [];
  }

  async function restoreVersion(workflowId: string, versionId: string) {
    const { api } = await import("../api/http");
    await api.post(`/workflows/${workflowId}/versions/${versionId}/restore`);
    await fetchWorkflows();
  }

  async function dryRun(workflowId: string, device?: Record<string, any> | null): Promise<DryRunResult> {
    const { api } = await import("../api/http");
    const res = await api.post(`/workflows/${workflowId}/dry-run`, { device: device ?? null });
    return res.data;
  }

  async function runWorkflow(workflowId: string, devices: Array<Record<string, any>>, targetDescription?: string | null): Promise<WorkflowRun> {
    const { api } = await import("../api/http");
    const res = await api.post(`/workflows/${workflowId}/run`, { devices, targetDescription: targetDescription ?? null });
    return res.data;
  }

  async function fetchRun(runId: string): Promise<WorkflowRun> {
    const { api } = await import("../api/http");
    const res = await api.get(`/workflows/runs/${runId}`);
    return res.data;
  }

  async function fetchRuns(limit = 10, dateFrom?: string, dateTo?: string) {
    isLoadingRuns.value = true;
    try {
      const { api } = await import("../api/http");
      const params: Record<string, string | number> = { limit };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const res = await api.get("/workflows/runs", { params });
      runs.value = res.data.items ?? [];
      runsTotal.value = res.data.total ?? 0;
    } finally {
      isLoadingRuns.value = false;
    }
  }

  function exportRunsUrl(dateFrom?: string, dateTo?: string): string {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    const qs = params.toString();
    return `/api/workflows/runs/export${qs ? `?${qs}` : ""}`;
  }

  async function fetchMdmActions() {
    const { api } = await import("../api/http");
    const res = await api.get("/mdm-actions");
    mdmActions.value = res.data.items ?? [];
  }

  return {
    workflows,
    isLoading,
    error,
    mdmActions,
    runs,
    runsTotal,
    isLoadingRuns,
    fetchWorkflows,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    fetchVersions,
    restoreVersion,
    dryRun,
    runWorkflow,
    fetchRun,
    fetchRuns,
    exportRunsUrl,
    fetchMdmActions,
  };
});
