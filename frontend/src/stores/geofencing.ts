import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Geofencing — a disclosed new feature (no main.py precedent). Zones are
 * drawn on the Playground map (PlaygroundMapView.vue), saved here as
 * reusable assets, and referenced from Compliance Policy conditions
 * (geofenceZoneId, complianceFields.ts / PolicyBuilderDrawer.vue).
 */

export interface GeofenceZoneGeometry {
  // circle
  center?: { lat: number; lng: number };
  radiusMeters?: number;
  // polygon
  points?: Array<{ lat: number; lng: number }>;
}

export interface GeofenceZone {
  id: string;
  workspaceSlug: string;
  name: string;
  description: string | null;
  shape: "circle" | "polygon";
  geometry: GeofenceZoneGeometry;
  color: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeofenceZoneDraft {
  name: string;
  description?: string | null;
  shape: "circle" | "polygon";
  geometry: GeofenceZoneGeometry;
  color?: string | null;
}

// Mirrors InstalledAppsStatus (stores/compliance.ts) — same budget/staleness
// shape, surfaced in Settings for the location refresher.
export interface LocationRefreshStatus {
  targetDeviceCount: number;
  syncedCount: number;
  neverSyncedCount: number;
  errorCount: number;
  oldestSyncAgeMinutes: number | null;
  medianSyncAgeMinutes: number | null;
  refreshBudgetPerHour: number;
  refreshBudgetMin: number;
  refreshBudgetMax: number;
  estimatedFullCycleHours: number;
}

export const useGeofencingStore = defineStore("geofencing", () => {
  const zones = ref<GeofenceZone[]>([]);
  const isLoadingZones = ref(false);
  const zonesError = ref<string | null>(null);

  const refreshStatus = ref<LocationRefreshStatus | null>(null);
  const isLoadingRefreshStatus = ref(false);
  const refreshStatusError = ref<string | null>(null);

  async function fetchZones() {
    isLoadingZones.value = true;
    zonesError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/geofences");
      zones.value = res.data?.items ?? [];
    } catch (err: any) {
      zonesError.value = err?.response?.data?.detail || "Failed to load geofence zones.";
    } finally {
      isLoadingZones.value = false;
    }
  }

  async function createZone(draft: GeofenceZoneDraft) {
    const { api } = await import("../api/http");
    await api.post("/geofences", draft);
    await fetchZones();
  }

  async function updateZone(zoneId: string, draft: GeofenceZoneDraft) {
    const { api } = await import("../api/http");
    await api.put(`/geofences/${zoneId}`, draft);
    await fetchZones();
  }

  async function deleteZone(zoneId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/geofences/${zoneId}`);
    await fetchZones();
  }

  async function fetchRefreshStatus() {
    isLoadingRefreshStatus.value = true;
    refreshStatusError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/geofences/location-refresh-status");
      refreshStatus.value = res.data;
    } catch (err: any) {
      refreshStatusError.value = err?.response?.data?.detail || "Failed to load location refresh status.";
    } finally {
      isLoadingRefreshStatus.value = false;
    }
  }

  async function setRefreshBudget(budgetPerHour: number) {
    const { api } = await import("../api/http");
    await api.put("/geofences/location-refresh-budget", { budgetPerHour });
    await fetchRefreshStatus();
  }

  async function refreshLocationsNow(): Promise<{ queued: number }> {
    const { api } = await import("../api/http");
    const res = await api.post("/geofences/refresh-locations");
    return res.data;
  }

  return {
    zones,
    isLoadingZones,
    zonesError,
    refreshStatus,
    isLoadingRefreshStatus,
    refreshStatusError,
    fetchZones,
    createZone,
    updateZone,
    deleteZone,
    fetchRefreshStatus,
    setRefreshBudget,
    refreshLocationsNow,
  };
});
