<script setup lang="ts">
// 2D dense-region fallback — port of App.jsx's PlaygroundMapView
// (App.jsx:2148-2224). Swapped in for the 3D globe once the admin zooms in
// past GLOBE_TO_MAP_ALTITUDE_THRESHOLD (or via the toolbar's manual Map
// View toggle) — a flat OpenStreetMap view with clustered markers, since a
// curved 3D globe makes devices packed into the same region nearly
// impossible to click individually. Only devices with a REAL resolved
// location are plotted here (no placeholder/hashed pins, unlike the globe —
// a flat map has no decorative use for a fake position).
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";

const props = defineProps<{ items: any[]; center: { lat: number; lng: number } }>();
const emit = defineEmits<{ "device-click": [item: any]; "back-to-globe": [] }>();

const containerEl = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let clusterGroup: L.MarkerClusterGroup | null = null;

// Port of resolveRealDeviceLatLng (shared with PlaygroundGlobe.vue).
function resolveRealDeviceLatLng(item: any): { lat: number; lng: number } | null {
  if (item.locationCache?.lat !== undefined) return { lat: parseFloat(item.locationCache.lat), lng: parseFloat(item.locationCache.lng) };
  if (item.lastLocation?.latitude !== undefined) return { lat: parseFloat(item.lastLocation.latitude), lng: parseFloat(item.lastLocation.longitude) };
  if (item.location?.lat !== undefined) return { lat: parseFloat(item.location.lat), lng: parseFloat(item.location.lng) };
  if (item.networkInfo?.latitude !== undefined) return { lat: parseFloat(item.networkInfo.latitude), lng: parseFloat(item.networkInfo.longitude) };
  if (item.summary?.latitude !== undefined) return { lat: parseFloat(item.summary.latitude), lng: parseFloat(item.summary.longitude) };
  return null;
}
function deviceMarkerColor(item: any): string {
  const os = String(item.platform_normalized || item.os || "").toLowerCase();
  let color = os.includes("apple") || os.includes("ios") || os.includes("mac") ? "#79C6E8" : os.includes("android") ? "#3DDC84" : os.includes("win") ? "#0078D4" : "#A855F7";
  if (item.is_compliant_normalized === false) color = "#EF4444";
  else if (item.is_compliant_normalized === true) color = "#22C55E";
  return color;
}

const geoItems = computed(() =>
  props.items
    .map((item) => {
      const real = resolveRealDeviceLatLng(item);
      if (!real || isNaN(real.lat) || isNaN(real.lng)) return null;
      return { ...item, _mapLat: real.lat, _mapLng: real.lng, _mapColor: deviceMarkerColor(item), _mapLabel: item.displayName || item.summary?.model || "Device" };
    })
    .filter((i): i is NonNullable<typeof i> => !!i),
);
const skippedCount = computed(() => props.items.length - geoItems.value.length);

// Port of PlaygroundDeviceMarkerIcon (App.jsx:2096-2103).
function markerIcon(color: string) {
  return L.divIcon({
    className: "playground-device-marker",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.9);box-shadow:0 0 8px ${color}aa;"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

const MAP_NEARBY_DEGREES = 8;

// Port of FitMapToDevices (App.jsx:2131-2146) — frames the map on entry into
// map mode, but deliberately does not re-run on every items change so it
// doesn't fight the admin's own subsequent pan/zoom.
function fitToDevices(center: { lat: number; lng: number }) {
  if (!map) return;
  const nearby = geoItems.value.filter((it) => Math.abs(it._mapLat - center.lat) <= MAP_NEARBY_DEGREES && Math.abs(it._mapLng - center.lng) <= MAP_NEARBY_DEGREES);
  if (nearby.length >= 2) {
    const bounds = L.latLngBounds(nearby.map((it) => [it._mapLat, it._mapLng] as [number, number]));
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
  } else if (nearby.length === 1) {
    map.setView([nearby[0]._mapLat, nearby[0]._mapLng], 10);
  } else {
    map.setView([center.lat, center.lng], 6);
  }
}

function renderMarkers() {
  if (!map || !clusterGroup) return;
  clusterGroup.clearLayers();
  for (const item of geoItems.value) {
    const marker = L.marker([item._mapLat, item._mapLng], { icon: markerIcon(item._mapColor) });
    marker.bindTooltip(
      `<div style="font-family:'Outfit', sans-serif"><div style="font-weight:700">${item._mapLabel}</div><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:${item._mapColor}">${item.is_compliant_normalized === true ? "✓ Compliant" : item.is_compliant_normalized === false ? "✗ Non-compliant" : "Click to view"}</div></div>`,
      { direction: "top", offset: [0, -8], opacity: 0.95 },
    );
    marker.on("click", () => emit("device-click", item));
    clusterGroup.addLayer(marker);
  }
}

watch(geoItems, renderMarkers);
watch(
  () => props.center,
  (center) => fitToDevices(center),
);

onMounted(() => {
  if (!containerEl.value) return;
  map = L.map(containerEl.value, { scrollWheelZoom: true }).setView([props.center.lat, props.center.lng], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  clusterGroup = (L as any).markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 55 });
  map.addLayer(clusterGroup!);
  renderMarkers();
  fitToDevices(props.center);
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
});
</script>

<template>
  <!-- `relative z-0` establishes its own stacking context so Leaflet's own
       panes/controls (z-index up to 1000) never render above an ancestor
       modal (App.jsx:2159-2168's comment on why this matters). -->
  <div class="w-full h-full relative z-0">
    <div ref="containerEl" class="w-full h-full" style="background: #0b1220" />

    <div class="absolute top-4 right-4 z-[1000]">
      <button
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border border-white/10 hover:bg-white/10 backdrop-blur"
        style="color: rgba(255, 255, 255, 0.85); background-color: rgba(2, 8, 23, 0.75)"
        @click="emit('back-to-globe')"
      >
        <component :is="ICONS.Global" :size="12" weight="Linear" class="text-blue-400" /> Back to Globe
      </button>
    </div>

    <div
      v-if="skippedCount > 0"
      class="absolute bottom-4 left-4 z-[1000] px-3 py-1.5 rounded-lg text-[10px] font-medium backdrop-blur"
      style="color: rgba(255, 255, 255, 0.6); background-color: rgba(2, 8, 23, 0.75); border: 1px solid rgba(255, 255, 255, 0.1)"
    >
      {{ skippedCount }} device{{ skippedCount === 1 ? "" : "s" }} without location data not shown here
    </div>
  </div>
</template>
