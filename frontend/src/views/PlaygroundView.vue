<script setup lang="ts">
// Playground — the 3D device globe (+ 2D map fallback for dense regions).
// Port of App.jsx's Playground main-view block (App.jsx:4736-4879) and its
// supporting state (App.jsx:3330-3352, 3589-3625). A genuinely live view —
// devices are fetched from the same `mdm_devices` widget-data source the
// globe/map both plot, not a static demo.
import { RouterLink } from "vue-router";
import { computed, onMounted, ref, watch } from "vue";
import { ICONS } from "../lib/solarIcons";
import HelpIcon from "../components/shared/HelpIcon.vue";
import OsIcon from "../components/shared/OsIcon.vue";
import PlaygroundGlobe from "../components/playground/PlaygroundGlobe.vue";
import PlaygroundMapView from "../components/playground/PlaygroundMapView.vue";
import DeviceDetailDrawer from "../components/devices/DeviceDetailDrawer.vue";
import { fetchWidgetData } from "../lib/widgetData";
import { useSegmentsStore } from "../stores/segments";

const segmentsStore = useSegmentsStore();

// Camera altitude (globe radii) below which the view auto-switches from the
// 3D globe to the 2D map — App.jsx:1833's GLOBE_TO_MAP_ALTITUDE_THRESHOLD.
const GLOBE_TO_MAP_ALTITUDE_THRESHOLD = 0.32;

const isLoadingGlobe = ref(true);
const isSyncingLocations = ref(false);
const error = ref<string | null>(null);
const globeDevices = ref<any[]>([]);
const selectedDevice = ref<Record<string, any> | null>(null);

const playgroundMode = ref<"globe" | "map">("globe");
const playgroundMapCenter = ref({ lat: 20, lng: 0 });
const isGlobeRotationPaused = ref(false);

const showOnlyNonCompliantGlobe = ref(false);
const globeCompliancePolicies = ref<Array<{ id: string; name: string }>>([]);
const selectedGlobePolicyId = ref("");
const globePolicyViolatingIds = ref<Set<string> | null>(null);
const isLoadingGlobePolicyFilter = ref(false);

const filterActive = computed(() => showOnlyNonCompliantGlobe.value || !!selectedGlobePolicyId.value);

const filteredDevices = computed(() => {
  let list = globeDevices.value;
  if (globePolicyViolatingIds.value) list = list.filter((d) => globePolicyViolatingIds.value!.has(String(d.id ?? d._id)));
  if (showOnlyNonCompliantGlobe.value) list = list.filter((d) => d.is_compliant_normalized === false);
  return list;
});

const compliantCount = computed(() => globeDevices.value.filter((d) => d.is_compliant_normalized === true).length);
const nonCompliantCount = computed(() => globeDevices.value.filter((d) => d.is_compliant_normalized === false).length);
const appleCount = computed(() => globeDevices.value.filter((d) => String(d.platform_normalized || "").toLowerCase().includes("apple") || String(d.platform_normalized || "").toLowerCase().includes("ios")).length);
const androidCount = computed(() => globeDevices.value.filter((d) => String(d.platform_normalized || "").toLowerCase().includes("android")).length);
const winCount = computed(() => globeDevices.value.filter((d) => String(d.platform_normalized || "").toLowerCase().includes("win")).length);

async function loadDevices() {
  isLoadingGlobe.value = true;
  error.value = null;
  try {
    // Segment scoping — same filters.segmentId shape every other widget
    // source already sends (see OverviewView.vue); mdm_devices forwards it
    // straight through to Applivery's own /mdm/devices/ endpoint, which
    // resolves the segment's descendants server-side. Previously omitted
    // entirely, since Playground had no Segments panel to read a selection
    // from at all until it was added alongside Overview/Devices/Compliance/
    // Cases (AppShell.vue's SEGMENT_PANEL_VIEWS).
    const segmentId = String(segmentsStore.selectedSegment.id) !== "0" ? segmentsStore.selectedSegment.id : undefined;
    const data = await fetchWidgetData("mdm_devices", { segmentId });
    globeDevices.value = data.items ?? [];
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Failed to load devices.";
  } finally {
    isLoadingGlobe.value = false;
  }
}

async function loadCompliancePolicies() {
  try {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/policies");
    globeCompliancePolicies.value = res.data?.items ?? [];
  } catch {
    globeCompliancePolicies.value = [];
  }
}

watch(selectedGlobePolicyId, async (policyId) => {
  if (!policyId) {
    globePolicyViolatingIds.value = null;
    return;
  }
  isLoadingGlobePolicyFilter.value = true;
  try {
    const { api } = await import("../api/http");
    const res = await api.get(`/compliance/policies/${policyId}/violating-device-ids`);
    globePolicyViolatingIds.value = new Set((res.data?.deviceIds ?? []).map(String));
  } catch {
    globePolicyViolatingIds.value = new Set();
  } finally {
    isLoadingGlobePolicyFilter.value = false;
  }
});

async function syncLocations() {
  isSyncingLocations.value = true;
  error.value = null;
  try {
    const { api } = await import("../api/http");
    await api.post("/analytics/locations/sync");
    await loadDevices();
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Location sync failed (it's rate-limited to once every 5 minutes).";
  } finally {
    isSyncingLocations.value = false;
  }
}

// Port of handleGlobeZoom (App.jsx:3341-3346) — one-directional only, no
// reverse auto-switch back to the globe on zoom-out.
function handleZoom(pov: { lat: number; lng: number; altitude: number }) {
  if (pov && pov.altitude < GLOBE_TO_MAP_ALTITUDE_THRESHOLD) {
    playgroundMapCenter.value = { lat: pov.lat, lng: pov.lng };
    playgroundMode.value = "map";
  }
}

function openDevice(item: any) {
  selectedDevice.value = item;
}

onMounted(async () => {
  await Promise.all([loadDevices(), loadCompliancePolicies()]);
});

// Re-fetch the globe/map's device set when the Segments panel selection
// changes — same pattern as OverviewView.vue's own widget-reload watcher.
watch(
  () => segmentsStore.selectedSegment,
  () => loadDevices(),
);
</script>

<template>
  <main class="flex-1 relative flex flex-col overflow-hidden h-full" style="background-color: #020817">
    <div class="shrink-0 flex items-center justify-between px-6 py-3 border-b z-10 flex-wrap gap-3" style="border-color: rgba(255, 255, 255, 0.07); background-color: rgba(2, 8, 23, 0.8); backdrop-filter: blur(12px)">
      <div class="flex items-center gap-4 flex-wrap">
        <div>
          <div class="flex items-center gap-2">
            <component :is="ICONS.Global" :size="15" weight="Linear" class="text-blue-400" />
            <span class="text-base font-semibold text-white tracking-wide">Playground</span>
            <HelpIcon slug="playground" title="Playground admin guide" class="hover:bg-white/10" />
            <span
              v-if="String(segmentsStore.selectedSegment.id) !== '0'"
              class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style="background-color: rgba(56, 189, 248, 0.15); color: #38bdf8"
            >
              <component :is="ICONS.Layers" :size="10" weight="Linear" /> {{ segmentsStore.selectedSegment.name }}
            </span>
          </div>
          <p class="text-xs text-white/40 mt-0.5" style="font-family: 'Outfit', sans-serif; font-weight: 300">Live 3D visualization — {{ globeDevices.length }} devices tracked</p>
        </div>
        <div class="h-8 w-px bg-white/10" />
        <div class="flex items-center gap-3 flex-wrap">
          <div v-if="compliantCount > 0" class="flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span class="text-[11px] font-medium text-white/70">{{ compliantCount }} Compliant</span></div>
          <div v-if="nonCompliantCount > 0" class="flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full bg-red-400" /><span class="text-[11px] font-medium text-white/70">{{ nonCompliantCount }} Non-compliant</span></div>
          <div v-if="appleCount > 0" class="flex items-center gap-1.5"><OsIcon platform="apple" :size="11" color="#79C6E8" /><span class="text-[11px] text-white/50">{{ appleCount }}</span></div>
          <div v-if="androidCount > 0" class="flex items-center gap-1.5"><OsIcon platform="android" :size="11" color="#3DDC84" /><span class="text-[11px] text-white/50">{{ androidCount }}</span></div>
          <div v-if="winCount > 0" class="flex items-center gap-1.5"><OsIcon platform="windows" :size="11" color="#0078D4" /><span class="text-[11px] text-white/50">{{ winCount }}</span></div>
        </div>
      </div>

      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-1 p-1 rounded-xl" style="background-color: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12)">
          <RouterLink to="/devices" class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all text-white/60">
            <component :is="ICONS.Smartphone" :size="14" weight="Linear" /> Devices
          </RouterLink>
          <span class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap" style="background-color: rgba(255, 255, 255, 0.14); color: #fff">
            <component :is="ICONS.Global" :size="14" weight="Linear" /> Playground
          </span>
        </div>

        <select
          v-model="selectedGlobePolicyId"
          class="px-3 py-1.5 rounded-lg text-[11px] font-medium border outline-none"
          :style="{ color: selectedGlobePolicyId ? '#A855F7' : 'rgba(255,255,255,0.6)', borderColor: selectedGlobePolicyId ? '#A855F740' : 'rgba(255,255,255,0.1)', backgroundColor: selectedGlobePolicyId ? '#A855F715' : 'rgba(255,255,255,0.05)' }"
        >
          <option value="" style="color: #000">All policies</option>
          <option v-for="p in globeCompliancePolicies" :key="p.id" :value="p.id" style="color: #000">{{ p.name }}</option>
        </select>

        <label
          class="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border"
          :style="{ color: showOnlyNonCompliantGlobe ? '#EF4444' : 'rgba(255,255,255,0.6)', borderColor: showOnlyNonCompliantGlobe ? '#EF444440' : 'rgba(255,255,255,0.1)', backgroundColor: showOnlyNonCompliantGlobe ? '#EF444415' : 'rgba(255,255,255,0.05)' }"
        >
          <input type="checkbox" v-model="showOnlyNonCompliantGlobe" class="w-3 h-3 rounded border-gray-600 text-red-500 focus:ring-red-500" />
          Non-Compliant Only
        </label>

        <button
          :disabled="isSyncingLocations"
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border border-white/10 hover:bg-white/10"
          style="color: rgba(255, 255, 255, 0.7); background-color: rgba(255, 255, 255, 0.05)"
          @click="syncLocations"
        >
          <component :is="ICONS.MapPoint" :size="12" weight="Linear" :class="isSyncingLocations ? 'animate-spin' : ''" class="text-blue-400" />
          {{ isSyncingLocations ? "Syncing..." : "Sync Locations" }}
        </button>

        <button
          title="Pause globe rotation — easier to click devices in a busy region"
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border"
          :style="{ color: isGlobeRotationPaused ? '#FBBF24' : 'rgba(255,255,255,0.7)', borderColor: isGlobeRotationPaused ? '#FBBF2440' : 'rgba(255,255,255,0.1)', backgroundColor: isGlobeRotationPaused ? '#FBBF2415' : 'rgba(255,255,255,0.05)' }"
          @click="isGlobeRotationPaused = !isGlobeRotationPaused"
        >
          <svg v-if="isGlobeRotationPaused" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
          {{ isGlobeRotationPaused ? "Rotation Paused" : "Pause Rotation" }}
        </button>

        <button
          title="Switch to a flat, clustered map — easier to click devices packed into the same region"
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border"
          :style="{ color: playgroundMode === 'map' ? '#38BDF8' : 'rgba(255,255,255,0.7)', borderColor: playgroundMode === 'map' ? '#38BDF840' : 'rgba(255,255,255,0.1)', backgroundColor: playgroundMode === 'map' ? '#38BDF815' : 'rgba(255,255,255,0.05)' }"
          @click="playgroundMode = playgroundMode === 'map' ? 'globe' : 'map'"
        >
          <component :is="playgroundMode === 'map' ? ICONS.Global : ICONS.MapPoint" :size="12" weight="Linear" />
          {{ playgroundMode === "map" ? "Globe View" : "Map View" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="px-6 py-2 text-sm shrink-0" style="color: #ef4444; background-color: rgba(239, 68, 68, 0.1)">{{ error }}</div>

    <div class="flex-1 relative">
      <div v-if="isLoadingGlobe || isLoadingGlobePolicyFilter" class="absolute inset-0 flex flex-col items-center justify-center" style="background-color: #020817">
        <div class="w-10 h-10 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-4" />
        <span class="text-sm font-medium text-white/40 uppercase tracking-widest">Loading fleet data…</span>
      </div>
      <div v-else-if="globeDevices.length > 0" class="absolute inset-0">
        <PlaygroundMapView v-if="playgroundMode === 'map'" :items="filteredDevices" :center="playgroundMapCenter" @device-click="openDevice" @back-to-globe="playgroundMode = 'globe'" />
        <PlaygroundGlobe v-else :items="filteredDevices" :filter-active="filterActive" :total-devices="globeDevices.length" :paused="isGlobeRotationPaused" @device-click="openDevice" @zoom="handleZoom" />
      </div>
      <div v-else class="absolute inset-0 flex flex-col items-center justify-center gap-3" style="background-color: #020817">
        <component :is="ICONS.Global" :size="40" weight="Linear" class="text-white/10" />
        <span class="text-sm text-white/30 uppercase tracking-widest font-medium">No devices found</span>
        <button class="mt-2 px-4 py-2 rounded-lg text-blue-400 text-xs font-semibold transition-colors" style="background-color: rgba(37, 99, 235, 0.2); border: 1px solid rgba(59, 130, 246, 0.3)" @click="syncLocations">
          Sync device locations
        </button>
      </div>
    </div>

    <DeviceDetailDrawer :device="selectedDevice" @close="selectedDevice = null" />
  </main>
</template>
