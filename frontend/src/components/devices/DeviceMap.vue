<script setup lang="ts">
// Thin hand-wrapped Leaflet + leaflet.markercluster binding — no official
// Vue Leaflet component ships in the BlueSky package, same situation as
// GlobeWidget.vue's globe.gl wrapper (migration-plan.md §6). Plots devices
// that carry a `location` (lat/lng) — TODO(Phase8): every device's
// `location` is null until the location-cache background job exists, so
// this renders its "no location data yet" empty state for a cold-start
// workspace, exactly matching the original app's Devices map before that
// job has ever run.
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";
import { EmptyState } from "@applivery/bluesky-vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { NormalizedDevice } from "../../stores/devices";

const props = defineProps<{
  devices: NormalizedDevice[];
}>();

const emit = defineEmits<{
  "open-device": [deviceId: string];
}>();

const mapEl = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clusterGroup: any = null;

const located = computed(() => props.devices.filter((d) => d.location && Number.isFinite(d.location.lat) && Number.isFinite(d.location.lng)));

function renderMarkers() {
  if (!map || !clusterGroup) return;
  clusterGroup.clearLayers();
  for (const device of located.value) {
    const marker = L.marker([device.location!.lat, device.location!.lng]);
    marker.bindPopup(`<strong>${device.displayName}</strong><br/>${device.platformLabel}`);
    marker.on("click", () => emit("open-device", device.id));
    clusterGroup.addLayer(marker);
  }
  map.addLayer(clusterGroup);
  if (located.value.length > 0) {
    const bounds = L.latLngBounds(located.value.map((d) => [d.location!.lat, d.location!.lng]));
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 10 });
  }
}

onMounted(() => {
  if (!mapEl.value) return;
  map = L.map(mapEl.value, { center: [20, 0], zoom: 2 });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clusterGroup = (L as any).markerClusterGroup();
  renderMarkers();
});

watch(() => props.devices, renderMarkers, { deep: false });

onBeforeUnmount(() => {
  map?.remove();
  map = null;
  clusterGroup = null;
});
</script>

<template>
  <div class="relative rounded-xl border border-gray-200 overflow-hidden" style="height: 420px">
    <div ref="mapEl" class="w-full h-full" />
    <div v-if="located.length === 0" class="absolute inset-0 flex items-center justify-center bg-white/80 pointer-events-none">
      <EmptyState title="No device location data yet" description="Location reporting isn't wired up yet — coming in a later phase." />
    </div>
  </div>
</template>
