import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Port of the five "status/monitoring only" intelligence-catalog Settings
 * sections plus the opt-in Vulnerability Service and Apple App Updates
 * status (docs/settings.md#os-updates / #vulnerability-catalog /
 * #vulnerability-service / #os-lifecycle / #apple-app-updates). Backend:
 * catalogs.controller.ts + appLists.controller.ts's apple-app-updates routes.
 */
export interface OsUpdateCatalog {
  kbEntries: Array<Record<string, any>>;
  monthsFetched: string[];
  lastFetchedAt: string | null;
  lastError: string | null;
}
export interface VulnCatalog {
  entries: Array<Record<string, any>>;
  lastFetchedAt: string | null;
  lastError: string | null;
  windowFrom: string | null;
}
export interface OsLifecycleCatalog {
  platforms: Record<string, Array<Record<string, any>>>;
  lastFetchedAt: string | null;
  lastError: string | null;
}
export interface GdmfCatalog {
  platforms: Record<string, Array<Record<string, any>>>;
  rapidSecurityResponses: Record<string, Array<Record<string, any>>>;
  lastFetchedAt: string | null;
  lastError: string | null;
}
export interface VulnServiceConfig {
  workspaceSlug: string;
  enabled: boolean;
  baseUrl: string;
  apiToken: string; // masked
  refreshIntervalHours: number;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  lastRefreshStats: Record<string, any> | null;
}
export interface MispConfig {
  workspaceSlug: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string; // masked
  verifySsl: boolean;
  cpeGuesserBaseUrl: string;
  refreshIntervalHours: number;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  lastRefreshStats: Record<string, any> | null;
}
export interface VulncheckConfig {
  workspaceSlug: string;
  enabled: boolean;
  apiKey: string; // masked
  cpeGuesserBaseUrl: string;
  refreshIntervalHours: number;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  lastRefreshStats: Record<string, any> | null;
}
export interface AppleAppUpdatesStatus {
  targetDeviceCount: number;
  syncedCount: number;
  neverSyncedCount: number;
  errorCount: number;
  devicesWithPendingUpdates: number;
  totalPendingAppInstances: number;
  topPendingApps: Array<{ name: string; deviceCount: number }>;
  oldestSyncAgeMinutes: number | null;
  medianSyncAgeMinutes: number | null;
  refreshBudgetPerHour: number;
  estimatedFullCycleHours: number;
}

export const useCatalogsStore = defineStore("catalogs", () => {
  const osUpdateCatalog = ref<OsUpdateCatalog | null>(null);
  const vulnCatalog = ref<VulnCatalog | null>(null);
  const osLifecycleCatalog = ref<OsLifecycleCatalog | null>(null);
  const gdmfCatalog = ref<GdmfCatalog | null>(null);
  const vulnServiceConfig = ref<VulnServiceConfig | null>(null);
  const mispConfig = ref<MispConfig | null>(null);
  const vulncheckConfig = ref<VulncheckConfig | null>(null);
  const appleAppUpdatesStatus = ref<AppleAppUpdatesStatus | null>(null);

  const isLoading = ref(false);
  const isRefreshing = ref(false);
  const error = ref<string | null>(null);

  async function fetchOsUpdateCatalog() {
    const { api } = await import("../api/http");
    osUpdateCatalog.value = (await api.get("/os-updates/catalog")).data;
  }
  async function refreshOsUpdateCatalog() {
    isRefreshing.value = true;
    try {
      const { api } = await import("../api/http");
      osUpdateCatalog.value = (await api.post("/os-updates/refresh")).data;
    } finally {
      isRefreshing.value = false;
    }
  }

  async function fetchVulnCatalog() {
    const { api } = await import("../api/http");
    vulnCatalog.value = (await api.get("/vuln-catalog/catalog")).data;
  }
  async function refreshVulnCatalog() {
    isRefreshing.value = true;
    try {
      const { api } = await import("../api/http");
      vulnCatalog.value = (await api.post("/vuln-catalog/refresh")).data;
    } finally {
      isRefreshing.value = false;
    }
  }

  async function fetchOsLifecycleCatalog() {
    const { api } = await import("../api/http");
    osLifecycleCatalog.value = (await api.get("/os-lifecycle/catalog")).data;
  }
  async function refreshOsLifecycleCatalog() {
    isRefreshing.value = true;
    try {
      const { api } = await import("../api/http");
      osLifecycleCatalog.value = (await api.post("/os-lifecycle/refresh")).data;
    } finally {
      isRefreshing.value = false;
    }
  }

  async function fetchGdmfCatalog() {
    const { api } = await import("../api/http");
    gdmfCatalog.value = (await api.get("/gdmf/catalog")).data;
  }
  async function refreshGdmfCatalog() {
    isRefreshing.value = true;
    try {
      const { api } = await import("../api/http");
      gdmfCatalog.value = (await api.post("/gdmf/refresh")).data;
    } finally {
      isRefreshing.value = false;
    }
  }

  async function fetchVulnServiceConfig() {
    const { api } = await import("../api/http");
    vulnServiceConfig.value = (await api.get("/vuln-service/config")).data;
  }
  async function saveVulnServiceConfig(payload: { enabled: boolean; baseUrl: string; apiToken: string; refreshIntervalHours: number }) {
    const { api } = await import("../api/http");
    vulnServiceConfig.value = (await api.put("/vuln-service/config", payload)).data;
  }
  async function testVulnServiceConfig(payload: { baseUrl: string; apiToken: string }) {
    const { api } = await import("../api/http");
    return (await api.post("/vuln-service/test", payload)).data as { status: string; latencyMs: number };
  }
  async function refreshVulnServiceNow() {
    isRefreshing.value = true;
    try {
      const { api } = await import("../api/http");
      await api.post("/vuln-service/refresh");
      await fetchVulnServiceConfig();
    } finally {
      isRefreshing.value = false;
    }
  }

  async function fetchMispConfig() {
    const { api } = await import("../api/http");
    mispConfig.value = (await api.get("/misp/config")).data;
  }
  async function saveMispConfig(payload: { enabled: boolean; baseUrl: string; apiKey: string; verifySsl: boolean; cpeGuesserBaseUrl: string; refreshIntervalHours: number }) {
    const { api } = await import("../api/http");
    mispConfig.value = (await api.put("/misp/config", payload)).data;
  }
  async function testMispConfig(payload: { baseUrl: string; apiKey: string; verifySsl: boolean }) {
    const { api } = await import("../api/http");
    return (await api.post("/misp/test", payload)).data as { status: string; latencyMs: number; version: string | null };
  }
  async function refreshMispNow() {
    isRefreshing.value = true;
    try {
      const { api } = await import("../api/http");
      await api.post("/misp/refresh");
      await fetchMispConfig();
    } finally {
      isRefreshing.value = false;
    }
  }

  async function fetchVulncheckConfig() {
    const { api } = await import("../api/http");
    vulncheckConfig.value = (await api.get("/vulncheck/config")).data;
  }
  async function saveVulncheckConfig(payload: { enabled: boolean; apiKey: string; cpeGuesserBaseUrl: string; refreshIntervalHours: number }) {
    const { api } = await import("../api/http");
    vulncheckConfig.value = (await api.put("/vulncheck/config", payload)).data;
  }
  async function testVulncheckConfig(payload: { apiKey: string }) {
    const { api } = await import("../api/http");
    return (await api.post("/vulncheck/test", payload)).data as { status: string; latencyMs: number };
  }
  async function refreshVulncheckNow() {
    isRefreshing.value = true;
    try {
      const { api } = await import("../api/http");
      await api.post("/vulncheck/refresh");
      await fetchVulncheckConfig();
    } finally {
      isRefreshing.value = false;
    }
  }

  async function fetchAppleAppUpdatesStatus() {
    const { api } = await import("../api/http");
    appleAppUpdatesStatus.value = (await api.get("/apple-app-updates/status")).data;
  }
  async function refreshAppleAppUpdates(): Promise<{ queued: number }> {
    isRefreshing.value = true;
    try {
      const { api } = await import("../api/http");
      return (await api.post("/apple-app-updates/refresh")).data;
    } finally {
      isRefreshing.value = false;
    }
  }

  return {
    osUpdateCatalog, vulnCatalog, osLifecycleCatalog, gdmfCatalog, vulnServiceConfig, mispConfig, vulncheckConfig, appleAppUpdatesStatus,
    isLoading, isRefreshing, error,
    fetchOsUpdateCatalog, refreshOsUpdateCatalog,
    fetchVulnCatalog, refreshVulnCatalog,
    fetchOsLifecycleCatalog, refreshOsLifecycleCatalog,
    fetchGdmfCatalog, refreshGdmfCatalog,
    fetchVulnServiceConfig, saveVulnServiceConfig, testVulnServiceConfig, refreshVulnServiceNow,
    fetchMispConfig, saveMispConfig, testMispConfig, refreshMispNow,
    fetchVulncheckConfig, saveVulncheckConfig, testVulncheckConfig, refreshVulncheckNow,
    fetchAppleAppUpdatesStatus, refreshAppleAppUpdates,
  };
});
