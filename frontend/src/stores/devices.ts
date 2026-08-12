import { defineStore } from "pinia";
import { ref, watch } from "vue";

export type RiskTier = "low" | "medium" | "high" | "critical";

export interface RiskFactor {
  label: string;
  points: number;
}

export interface ActivePolicy {
  id: string | null;
  name: string;
  platform: string;
  // Real Applivery Policy Composition priority (lower number wins conflicts
  // against other assigned policies) — null for the device's single legacy
  // "primary policy" slot, which has no priority number of its own. See
  // deviceNormalize.ts's matching ActivePolicy comment on the backend.
  priority: number | null;
  isPrimary: boolean;
}

export interface NormalizedDevice {
  id: string;
  displayName: string;
  platform: "android" | "apple" | "macos" | "windows" | "other";
  platformLabel: string;
  rawPlatform: string;
  platformDeviceId: string;
  serialNumber: string;
  imei: string;
  model: string;
  manufacturer: string;
  osVersion: string;
  battery: number | null;
  // Populated for the merged device modal (Devices view + Playground/
  // Dashboard-widget entry points) — see backend/deviceNormalize.ts's
  // matching comment.
  macAddress: string;
  ipAddress: string;
  managementMode: string;
  state: string;
  lastSeen: string | null;
  enrolledAt: string | null;
  isCompliant: boolean;
  tags: string[];
  segmentId: number | string | null;
  deviceAudiences: Array<{ id: string; name: string }>;
  mdmUser: { name?: string; firstName?: string; lastName?: string; email?: string } | null;
  location: { lat: number; lng: number } | null;
  selfReported: unknown;
  nativeSecurity: Record<string, any> | null;
  identifiers: { udid: string; emmDeviceId: string; winId: string };
  smartAttributes: Array<{ name: string; value: string }>;
  totalStorageGb: number | null;
  availableStorageGb: number | null;
  ramGb: number | null;
  activePolicies: ActivePolicy[];
  openCases: Array<{ id: string; title: string; severity: string; status: string }>;
  activeViolations: Array<{ id: string; policyId: string; policyName: string | null; detectedAt: string }>;
  policyViolations: Array<{ policyId: string; policyName: string | null; status: string; lastDetectedAt: string }>;
  policyCompliant: boolean;
  riskScore: number;
  riskTier: RiskTier;
  riskFactors: RiskFactor[];
  // osUpdateStatus/vulnStatus/vulnServiceStatus/osLifecycleStatus/
  // appleAppUpdateStatus — populated by the backend's OS-update/vuln/
  // lifecycle/GDMF/vuln-service catalog jobs (backgroundJobs.ts) and
  // computed per-device in devices.service.ts's getDevicesFull.
  osUpdateStatus: Record<string, any> | null;
  vulnStatus: Record<string, any> | null;
  vulnServiceStatus: Record<string, any> | null;
  osLifecycleStatus: Record<string, any> | null;
  appleAppUpdateStatus: Record<string, any> | null;
}

export interface PickerItem {
  id: string;
  name: string;
}

export interface RiskTrendPoint {
  date: string;
  avgRiskScore: number;
  [key: string]: unknown;
}

const COMPLIANCE_SOURCE_KEY = "huginn.devices.complianceSource";

function loadComplianceSource(): "applivery" | "policy" {
  try {
    const v = window.localStorage.getItem(COMPLIANCE_SOURCE_KEY);
    return v === "policy" ? "policy" : "applivery";
  } catch {
    return "applivery";
  }
}

/**
 * Devices module state — wraps GET /api/devices plus the picker endpoints
 * the fleet table/detail drawer need (segments, device tags, policies,
 * device audiences, Compliance Policies for the source-scope dropdown).
 * Fetch-on-mount, single in-flight fleet pull; all table-local filtering
 * (search/platform/risk/saved-filters/selection) is owned by
 * DeviceFleetTable.vue itself, mirroring the original App.jsx's per-
 * component state ownership rather than lifting everything into one store.
 */
export const useDevicesStore = defineStore("devices", () => {
  const devices = ref<NormalizedDevice[]>([]);
  const total = ref(0);
  const fetchedAt = ref<string | null>(null);
  const isLoading = ref(false);
  const isRefreshing = ref(false);
  const error = ref<string | null>(null);

  const segments = ref<PickerItem[]>([]);
  const deviceTags = ref<string[]>([]);
  const deviceAudiences = ref<PickerItem[]>([]);

  // "Compliance shown" toggle (docs/devices.md) — Applivery's own flag vs
  // SOAR's own Compliance Policies engine. Persisted per-browser.
  const complianceSource = ref<"applivery" | "policy">(loadComplianceSource());
  const policies = ref<PickerItem[]>([]);
  const selectedPolicyId = ref<string>("");
  const policyViolatingIds = ref<Set<string> | null>(null);
  const isLoadingPolicyFilter = ref(false);

  const riskTrend = ref<RiskTrendPoint[]>([]);

  function setComplianceSource(source: "applivery" | "policy") {
    complianceSource.value = source;
    try {
      window.localStorage.setItem(COMPLIANCE_SOURCE_KEY, source);
    } catch {
      // storage unavailable — choice just won't persist this session
    }
    if (source !== "policy") selectedPolicyId.value = "";
  }

  watch(selectedPolicyId, async (policyId) => {
    if (!policyId) {
      policyViolatingIds.value = null;
      return;
    }
    isLoadingPolicyFilter.value = true;
    try {
      const { api } = await import("../api/http");
      const res = await api.get(`/compliance/policies/${policyId}/violating-device-ids`);
      policyViolatingIds.value = new Set((res.data?.deviceIds ?? []).map(String));
    } catch {
      policyViolatingIds.value = new Set();
    } finally {
      isLoadingPolicyFilter.value = false;
    }
  });

  async function fetchPolicies() {
    if (policies.value.length > 0) return;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/compliance/policies");
      policies.value = res.data?.items ?? [];
    } catch {
      policies.value = [];
    }
  }

  async function fetchRiskTrend() {
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/analytics/device-risk-trend", { params: { days: 14 } });
      riskTrend.value = res.data?.items ?? [];
    } catch {
      riskTrend.value = [];
    }
  }

  async function syncLocations() {
    const { api } = await import("../api/http");
    await api.post("/analytics/locations/sync", {});
  }

  async function fetchDevices(refresh = false) {
    if (refresh) isRefreshing.value = true;
    else isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/devices", { params: refresh ? { refresh: "true" } : {} });
      devices.value = res.data.items ?? [];
      total.value = res.data.total ?? devices.value.length;
      fetchedAt.value = res.data.fetchedAt ?? null;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load devices from Applivery.";
    } finally {
      isLoading.value = false;
      isRefreshing.value = false;
    }
  }

  async function fetchPickers() {
    const { api } = await import("../api/http");
    const [segmentsRes, tagsRes, audiencesRes] = await Promise.all([
      api.get("/segments").catch(() => ({ data: { items: [] } })),
      api.get("/device-tags").catch(() => ({ data: { items: [] } })),
      api.get("/device-audiences").catch(() => ({ data: { items: [] } })),
    ]);
    segments.value = segmentsRes.data.items ?? [];
    deviceTags.value = tagsRes.data.items ?? [];
    deviceAudiences.value = audiencesRes.data.items ?? [];
  }

  async function getPolicies(platform: string): Promise<PickerItem[]> {
    const { api } = await import("../api/http");
    const res = await api.get("/policies", { params: { platform } });
    return res.data.items ?? [];
  }

  // Backs the mdm_action step editor's app_select fields (Install/Uninstall
  // App actions) — WorkflowBuilder.jsx:328-339's `apps` fetch.
  async function getApps(platform: string): Promise<PickerItem[]> {
    const { api } = await import("../api/http");
    const res = await api.get("/apps", { params: { platform } });
    return res.data.items ?? [];
  }

  async function getDeviceCompliance(deviceId: string) {
    const { api } = await import("../api/http");
    const res = await api.get(`/devices/${deviceId}/compliance`);
    return res.data;
  }

  async function getFirewallState(deviceId: string) {
    const { api } = await import("../api/http");
    const res = await api.get(`/devices/${deviceId}/firewall-state`);
    return res.data;
  }

  // NOTE: all three mutations below take the Applivery-side
  // `platformDeviceId` (not our internal normalized `id`) — the two differ
  // for Apple/Android/Windows devices (deviceNormalize.ts), and the backend
  // forwards this id straight through to Applivery's own device API.
  async function updateSegment(platformDeviceId: string, platform: string, segmentId: number) {
    const { api } = await import("../api/http");
    await api.put(`/devices/${platformDeviceId}/segment`, { platform, segmentId });
    await fetchDevices(true);
  }

  async function updateTags(platformDeviceId: string, platform: string, tags: string[]) {
    const { api } = await import("../api/http");
    await api.put(`/devices/${platformDeviceId}/tags`, { platform, tags });
    await fetchDevices(true);
  }

  async function updatePolicies(platformDeviceId: string, platform: string, policyList: Array<{ id?: string | null; name?: string | null; priority?: number | null; isPrimary?: boolean | null }>) {
    const { api } = await import("../api/http");
    await api.put(`/devices/${platformDeviceId}/policies`, { platform, policies: policyList });
    await fetchDevices(true);
  }

  async function bulkReattest(deviceIds: string[]) {
    const { api } = await import("../api/http");
    const res = await api.post("/devices/bulk-reattest", { deviceIds });
    return res.data as { results: Array<{ deviceId: string; displayName?: string; ok: boolean; detail: string }>; succeeded: number; total: number };
  }

  return {
    devices,
    total,
    fetchedAt,
    isLoading,
    isRefreshing,
    error,
    segments,
    deviceTags,
    deviceAudiences,
    complianceSource,
    policies,
    selectedPolicyId,
    policyViolatingIds,
    isLoadingPolicyFilter,
    riskTrend,
    setComplianceSource,
    fetchPolicies,
    fetchRiskTrend,
    syncLocations,
    fetchDevices,
    fetchPickers,
    getPolicies,
    getApps,
    getDeviceCompliance,
    getFirewallState,
    updateSegment,
    updateTags,
    updatePolicies,
    bulkReattest,
  };
});
