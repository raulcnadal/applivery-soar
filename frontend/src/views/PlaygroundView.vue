<script setup lang="ts">
// Playground — 3D device globe. Port of App.jsx's GlobeWidget (see
// wow-dashboard/src/App.jsx:1805-1990) using globe.gl directly (a vanilla
// Three.js wrapper, not a Vue component), mounted imperatively into a ref'd
// container. Scoped down from the original for this pass: the 2D
// zoomed-in-map fallback (PlaygroundMapView) and its auto-switch-on-zoom
// behavior aren't ported — the 3D globe with real GPS data, sync, and
// click-to-inspect is the core deliverable (migration-plan.md §8 Phase 7
// checkpoint: "Playground globe").
import Globe, { type GlobeInstance } from "globe.gl";
import { Alert, Button, PageHeader } from "@applivery/bluesky-vue";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { fetchWidgetData } from "../lib/widgetData";

const containerEl = ref<HTMLDivElement | null>(null);
let globe: GlobeInstance | null = null;
let resizeObserver: ResizeObserver | null = null;

const isLoading = ref(true);
const isSyncing = ref(false);
const error = ref<string | null>(null);
const totalDevices = ref(0);
const locatedDevices = ref(0);
const selectedDevice = ref<Record<string, any> | null>(null);

interface GlobePoint {
  lat: number;
  lng: number;
  color: string;
  device: Record<string, any>;
}

function colorForDevice(d: Record<string, any>): string {
  return d.is_compliant_normalized ? "#3DDC84" : "#EF4444";
}

async function loadDevices() {
  isLoading.value = true;
  error.value = null;
  try {
    const data = await fetchWidgetData("mdm_devices");
    const items: any[] = data.items ?? [];
    totalDevices.value = items.length;
    const points: GlobePoint[] = items
      .filter((d) => d.locationCache?.lat !== undefined && d.locationCache?.lng !== undefined)
      .map((d) => ({ lat: Number(d.locationCache.lat), lng: Number(d.locationCache.lng), color: colorForDevice(d), device: d }));
    locatedDevices.value = points.length;
    globe
      ?.pointsData(points)
      .pointLat("lat")
      .pointLng("lng")
      .pointColor("color")
      .pointAltitude(0.012)
      .pointRadius(0.35)
      .pointLabel((p: any) => `${p.device.displayName ?? "Unknown device"} — ${p.device.platform_normalized ?? p.device.type ?? ""}`)
      .onPointClick((p: any) => {
        selectedDevice.value = p.device;
      });
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Failed to load devices.";
  } finally {
    isLoading.value = false;
  }
}

async function syncLocations() {
  isSyncing.value = true;
  error.value = null;
  try {
    const { api } = await import("../api/http");
    await api.post("/analytics/locations/sync");
    await loadDevices();
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Location sync failed (it's rate-limited to once every 5 minutes).";
  } finally {
    isSyncing.value = false;
  }
}

function resizeGlobe() {
  if (!globe || !containerEl.value) return;
  globe.width(containerEl.value.clientWidth).height(containerEl.value.clientHeight);
}

onMounted(async () => {
  if (!containerEl.value) return;
  globe = new Globe(containerEl.value)
    .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
    .backgroundImageUrl("https://unpkg.com/three-globe/example/img/night-sky.png")
    .backgroundColor("#020817")
    .width(containerEl.value.clientWidth)
    .height(containerEl.value.clientHeight);

  const controls = globe.controls?.();
  if (controls) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;
  }

  resizeObserver = new ResizeObserver(() => resizeGlobe());
  resizeObserver.observe(containerEl.value);

  await loadDevices();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  (globe as any)?._destructor?.();
  globe = null;
});
</script>

<template>
  <div class="p-8 space-y-6 animate-page-enter h-full flex flex-col">
    <PageHeader title="Playground" description="Your fleet, mapped by last-known GPS location.">
      <template #action>
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-500">{{ locatedDevices }} / {{ totalDevices }} devices with a location</span>
          <Button variant="ghost" size="sm" :disabled="isSyncing" @click="syncLocations">{{ isSyncing ? "Syncing…" : "Sync locations" }}</Button>
        </div>
      </template>
    </PageHeader>

    <Alert v-if="error" type="danger">{{ error }}</Alert>

    <div class="flex-1 min-h-[500px] relative rounded-xl overflow-hidden border border-gray-800">
      <div ref="containerEl" class="w-full h-full" />
      <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-sm">Loading fleet…</div>

      <div v-if="selectedDevice" class="absolute top-4 right-4 w-72 bg-white rounded-xl shadow-xl p-4 space-y-2 text-sm">
        <div class="flex items-center justify-between">
          <p class="font-medium text-gray-900">{{ selectedDevice.displayName }}</p>
          <button class="text-gray-400 hover:text-gray-600" @click="selectedDevice = null">✕</button>
        </div>
        <p class="text-gray-500">Platform: <span class="text-gray-800">{{ selectedDevice.platform_normalized ?? selectedDevice.platform }}</span></p>
        <p class="text-gray-500">Model: <span class="text-gray-800">{{ selectedDevice.model || "—" }}</span></p>
        <p class="text-gray-500">
          Compliance:
          <span :class="selectedDevice.is_compliant_normalized ? 'text-green-600' : 'text-red-600'">
            {{ selectedDevice.is_compliant_normalized ? "Compliant" : "Non-compliant" }}
          </span>
        </p>
        <p class="text-gray-500">State: <span class="text-gray-800">{{ selectedDevice.state_normalized }}</span></p>
      </div>
    </div>
  </div>
</template>
