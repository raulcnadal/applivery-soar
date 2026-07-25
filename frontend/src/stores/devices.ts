import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type RiskTier = "low" | "medium" | "high" | "critical";

export interface RiskFactor {
  label: string;
  points: number;
}

export interface ActivePolicy {
  id: string | null;
  name: string;
  platform: string;
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
  state: string;
  lastSeen: string | null;
  enrolledAt: string | null;
  isCompliant: boolean;
  tags: string[];
  segmentId: number | string | null;
  deviceAudiences: Array<{ id: string; name: string }>;
  mdmUser: unknown;
  location: { lat: number; lng: number } | null;
  selfReported: unknown;
  nativeSecurity: Record<string, any> | null;
  identifiers: { udid: string; emmDeviceId: string; winId: string };
  smartAttributes: Array<{ name: string; value: string }>;
  totalStorageGb: number | null;
  availableStorageGb: number | null;
  ramGb: number | null;
  activePolicies: ActivePolicy[];
  openCases: Array<Record<string, any>>;
  activeViolations: Array<Record<string, any>>;
  policyViolations: Array<Record<string, any>>;
  policyCompliant: boolean;
  riskScore: number;
  riskTier: RiskTier;
  riskFactors: RiskFactor[];
}

export interface PickerItem {
  id: string;
  name: string;
}

/**
 * Devices module state — wraps GET /api/devices (Phase 2) plus the picker
 * endpoints the fleet table/detail drawer need (segments, device tags,
 * policies, device audiences). Mirrors the original App.jsx's Devices view
 * state (fetch-on-mount, client-side filter, single in-flight fetch guard)
 * without the class-component-style prop drilling.
 */
export const useDevicesStore = defineStore("devices", () => {
  const devices = ref<NormalizedDevice[]>([]);
  const total = ref(0);
  const fetchedAt = ref<string | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const segments = ref<PickerItem[]>([]);
  const deviceTags = ref<string[]>([]);
  const deviceAudiences = ref<PickerItem[]>([]);

  // Client-side filter state — the original's Devices view filters the
  // already-fetched fleet in memory rather than re-querying per filter
  // change (GET /api/devices is a full-fleet, cached pull).
  const searchQuery = ref("");
  const platformFilter = ref<string>("all");
  const complianceFilter = ref<"all" | "compliant" | "noncompliant">("all");
  const segmentFilter = ref<string>("all");
  const selectedDeviceIds = ref<Set<string>>(new Set());

  const filteredDevices = computed(() => {
    const q = searchQuery.value.trim().toLowerCase();
    return devices.value.filter((d) => {
      if (platformFilter.value !== "all" && d.platform !== platformFilter.value) return false;
      if (complianceFilter.value === "compliant" && !d.isCompliant) return false;
      if (complianceFilter.value === "noncompliant" && d.isCompliant) return false;
      if (segmentFilter.value !== "all" && String(d.segmentId ?? "") !== segmentFilter.value) return false;
      if (q) {
        const haystack = `${d.displayName} ${d.serialNumber} ${d.model} ${d.manufacturer} ${(d.tags ?? []).join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  });

  async function fetchDevices(refresh = false) {
    isLoading.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/devices", { params: refresh ? { refresh: "true" } : {} });
      devices.value = res.data.items ?? [];
      total.value = res.data.total ?? devices.value.length;
      fetchedAt.value = res.data.fetchedAt ?? null;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load devices.";
    } finally {
      isLoading.value = false;
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

  async function updateSegment(deviceId: string, platform: string, segmentId: number) {
    const { api } = await import("../api/http");
    await api.put(`/devices/${deviceId}/segment`, { platform, segmentId });
    await fetchDevices(true);
  }

  async function updateTags(deviceId: string, platform: string, tags: string[]) {
    const { api } = await import("../api/http");
    await api.put(`/devices/${deviceId}/tags`, { platform, tags });
    await fetchDevices(true);
  }

  async function updatePolicies(deviceId: string, platform: string, policies: Array<{ id?: string | null; name?: string | null }>) {
    const { api } = await import("../api/http");
    await api.put(`/devices/${deviceId}/policies`, { platform, policies });
    await fetchDevices(true);
  }

  async function bulkReattest(deviceIds: string[]) {
    const { api } = await import("../api/http");
    const res = await api.post("/devices/bulk-reattest", { deviceIds });
    return res.data as { results: Array<{ deviceId: string; displayName?: string; ok: boolean; detail: string }>; succeeded: number; total: number };
  }

  function toggleSelected(deviceId: string) {
    const next = new Set(selectedDeviceIds.value);
    if (next.has(deviceId)) next.delete(deviceId);
    else next.add(deviceId);
    selectedDeviceIds.value = next;
  }

  function clearSelection() {
    selectedDeviceIds.value = new Set();
  }

  return {
    devices,
    total,
    fetchedAt,
    isLoading,
    error,
    segments,
    deviceTags,
    deviceAudiences,
    searchQuery,
    platformFilter,
    complianceFilter,
    segmentFilter,
    selectedDeviceIds,
    filteredDevices,
    fetchDevices,
    fetchPickers,
    getPolicies,
    getDeviceCompliance,
    getFirewallState,
    updateSegment,
    updateTags,
    updatePolicies,
    bulkReattest,
    toggleSelected,
    clearSelection,
  };
});
