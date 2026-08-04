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
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useGeofencingStore } from "../../stores/geofencing";
import GeofenceZonesPanel from "./GeofenceZonesPanel.vue";
import HelpIcon from "../shared/HelpIcon.vue";

const props = defineProps<{ items: any[]; center: { lat: number; lng: number } }>();
const emit = defineEmits<{ "device-click": [item: any]; "back-to-globe": [] }>();

const geoStore = useGeofencingStore();

const containerEl = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let clusterGroup: L.MarkerClusterGroup | null = null;
let zonesLayer: L.LayerGroup | null = null;
let activeDrawHandler: any = null;
// A ref (not a plain module variable) specifically so the template's
// v-if="pendingLayer" toggles reactively when a shape is drawn/discarded.
// shallowRef, not ref — a deep-reactive proxy around a Leaflet class
// instance strips its private fields (e.g. `_map`), which both breaks
// Leaflet's own internal checks and makes TS structurally reject passing
// `.value` back into Leaflet APIs typed against the real `L.Layer` class.
const pendingLayer = shallowRef<L.Layer | null>(null);

// Geofencing UI state — a drawn-but-not-yet-saved shape sits in
// `pendingLayer`/`pendingDraft` until the admin names it (or cancels),
// mirroring the Compliance Policy Builder's own "draft before save" pattern
// rather than persisting a half-finished zone.
const isDrawing = ref<"circle" | "polygon" | null>(null);
const isZonesPanelOpen = ref(false);
const pendingDraft = reactive({ name: "", description: "", color: "#0241E3" });
const isSavingZone = ref(false);
const zoneSaveError = ref<string | null>(null);

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

// ── Geofence zone overlays + drawing ──
// Port of nothing (a disclosed new feature, see docs/geofencing.md) — draws
// existing GeofenceZone rows as circle/polygon overlays, and lets the admin
// draw a new one via leaflet-draw's programmatic handlers (not its default
// toolbar widget, so the buttons match this app's own chrome instead of
// leaflet-draw's stock icon set).
function renderZones() {
  if (!map || !zonesLayer) return;
  zonesLayer.clearLayers();
  for (const zone of geoStore.zones) {
    const color = zone.color || "#0241E3";
    let layer: L.Layer | null = null;
    if (zone.shape === "circle" && zone.geometry.center && typeof zone.geometry.radiusMeters === "number") {
      layer = L.circle([zone.geometry.center.lat, zone.geometry.center.lng], { radius: zone.geometry.radiusMeters, color, weight: 2, fillOpacity: 0.12 });
    } else if (zone.shape === "polygon" && zone.geometry.points?.length) {
      layer = L.polygon(zone.geometry.points.map((p) => [p.lat, p.lng] as [number, number]), { color, weight: 2, fillOpacity: 0.12 });
    }
    if (layer) {
      layer.bindTooltip(`<div style="font-family:'Outfit', sans-serif"><div style="font-weight:700">${zone.name}</div></div>`, { direction: "center", opacity: 0.95 });
      zonesLayer.addLayer(layer);
    }
  }
}
watch(() => geoStore.zones, renderZones, { deep: true });

function stopDrawing() {
  activeDrawHandler?.disable();
  activeDrawHandler = null;
  isDrawing.value = null;
}

function startDrawing(shape: "circle" | "polygon") {
  if (!map) return;
  stopDrawing();
  isDrawing.value = shape;
  const Handler = shape === "circle" ? (L as any).Draw.Circle : (L as any).Draw.Polygon;
  activeDrawHandler = new Handler(map, shape === "circle" ? { shapeOptions: { color: "#0241E3" } } : { allowIntersection: false, shapeOptions: { color: "#0241E3" } });
  activeDrawHandler.enable();
}

function cancelPendingZone() {
  if (pendingLayer.value && map) map.removeLayer(pendingLayer.value);
  pendingLayer.value = null;
  zoneSaveError.value = null;
  pendingDraft.name = "";
  pendingDraft.description = "";
}

async function savePendingZone() {
  if (!pendingLayer.value) return;
  if (!pendingDraft.name.trim()) {
    zoneSaveError.value = "Give this zone a name.";
    return;
  }
  isSavingZone.value = true;
  zoneSaveError.value = null;
  try {
    const anyLayer = pendingLayer.value as any;
    if (typeof anyLayer.getRadius === "function") {
      const center = anyLayer.getLatLng();
      await geoStore.createZone({
        name: pendingDraft.name.trim(), description: pendingDraft.description.trim() || null,
        shape: "circle", geometry: { center: { lat: center.lat, lng: center.lng }, radiusMeters: anyLayer.getRadius() }, color: pendingDraft.color,
      });
    } else {
      const latlngs: L.LatLng[] = anyLayer.getLatLngs()[0];
      await geoStore.createZone({
        name: pendingDraft.name.trim(), description: pendingDraft.description.trim() || null,
        shape: "polygon", geometry: { points: latlngs.map((p) => ({ lat: p.lat, lng: p.lng })) }, color: pendingDraft.color,
      });
    }
    if (map && pendingLayer.value) map.removeLayer(pendingLayer.value); // the zones watcher redraws it from the fetched list
    pendingLayer.value = null;
    pendingDraft.name = "";
    pendingDraft.description = "";
  } catch (err: any) {
    zoneSaveError.value = err?.response?.data?.detail || "Failed to save zone.";
  } finally {
    isSavingZone.value = false;
  }
}

onMounted(() => {
  if (!containerEl.value) return;
  map = L.map(containerEl.value, { scrollWheelZoom: true }).setView([props.center.lat, props.center.lng], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  clusterGroup = (L as any).markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 55 });
  map.addLayer(clusterGroup!);
  zonesLayer = L.layerGroup().addTo(map);
  renderMarkers();
  fitToDevices(props.center);

  map.on((L as any).Draw.Event.CREATED, (e: any) => {
    isDrawing.value = null;
    activeDrawHandler = null;
    pendingLayer.value = e.layer;
    pendingLayer.value!.addTo(map!);
  });

  if (geoStore.zones.length === 0) geoStore.fetchZones();
  else renderZones();
});

onBeforeUnmount(() => {
  stopDrawing();
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

    <div class="absolute top-4 right-4 z-[1000] flex items-center gap-2">
      <button
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border border-white/10 hover:bg-white/10 backdrop-blur"
        style="color: rgba(255, 255, 255, 0.85); background-color: rgba(2, 8, 23, 0.75)"
        @click="emit('back-to-globe')"
      >
        <component :is="ICONS.Global" :size="12" weight="Linear" class="text-blue-400" /> Back to Globe
      </button>
    </div>

    <!-- Geofencing toolbar — top-left, mirrors the top-right chrome's pill
         style. Only meaningful in Map mode (drawing on the 3D globe isn't
         practical), which is why this whole toolbar lives in
         PlaygroundMapView.vue rather than the shared PlaygroundView.vue
         header. -->
    <div class="absolute top-4 left-4 z-[1000] flex items-center gap-2 flex-wrap">
      <template v-if="!isDrawing && !pendingLayer">
        <button
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border border-white/10 hover:bg-white/10 backdrop-blur"
          style="color: rgba(255, 255, 255, 0.85); background-color: rgba(2, 8, 23, 0.75)"
          title="Draw a circular geofence zone"
          @click="startDrawing('circle')"
        >
          <component :is="ICONS.AddSquare" :size="12" weight="Linear" class="text-blue-400" /> Draw Circle Zone
        </button>
        <button
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border border-white/10 hover:bg-white/10 backdrop-blur"
          style="color: rgba(255, 255, 255, 0.85); background-color: rgba(2, 8, 23, 0.75)"
          title="Draw a polygon geofence zone"
          @click="startDrawing('polygon')"
        >
          <component :is="ICONS.AddSquare" :size="12" weight="Linear" class="text-blue-400" /> Draw Polygon Zone
        </button>
        <button
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] transition-all border border-white/10 hover:bg-white/10 backdrop-blur"
          style="color: rgba(255, 255, 255, 0.85); background-color: rgba(2, 8, 23, 0.75)"
          title="View, rename, or delete saved zones"
          @click="isZonesPanelOpen = true"
        >
          <component :is="ICONS.Layers" :size="12" weight="Linear" class="text-blue-400" />
          Manage Zones{{ geoStore.zones.length ? ` (${geoStore.zones.length})` : "" }}
        </button>
        <HelpIcon slug="geofencing" title="Geofencing admin guide" class="hover:bg-white/10" />
      </template>
      <div
        v-else-if="isDrawing"
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-[11px] backdrop-blur"
        style="color: #fbbf24; background-color: rgba(2, 8, 23, 0.85); border: 1px solid rgba(251, 191, 36, 0.3)"
      >
        Click the map to draw a {{ isDrawing }}…
        <button class="underline hover:opacity-80" @click="stopDrawing">Cancel</button>
      </div>
    </div>

    <!-- Save-the-just-drawn-zone form -->
    <div v-if="pendingLayer" class="absolute top-16 left-4 z-[1000] w-64 p-3 rounded-xl backdrop-blur" style="background-color: rgba(2, 8, 23, 0.9); border: 1px solid rgba(255, 255, 255, 0.12)">
      <p class="text-[11px] font-semibold mb-2" style="color: rgba(255,255,255,0.85)">Save this zone</p>
      <input
        v-model="pendingDraft.name"
        placeholder="Zone name…"
        class="w-full px-2 py-1.5 mb-2 rounded-lg text-xs outline-none"
        style="background-color: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15)"
      />
      <textarea
        v-model="pendingDraft.description"
        placeholder="Description (optional)…"
        rows="2"
        class="w-full px-2 py-1.5 mb-2 rounded-lg text-xs outline-none resize-none"
        style="background-color: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15)"
      />
      <div class="flex items-center gap-2 mb-2">
        <input v-model="pendingDraft.color" type="color" class="w-7 h-7 rounded cursor-pointer" />
        <span class="text-[10px]" style="color: rgba(255,255,255,0.5)">Overlay color</span>
      </div>
      <p v-if="zoneSaveError" class="text-[10px] mb-2" style="color: #ef4444">{{ zoneSaveError }}</p>
      <div class="flex items-center gap-2 justify-end">
        <button class="px-3 py-1.5 rounded-lg text-xs font-medium" style="color: rgba(255,255,255,0.7)" @click="cancelPendingZone">Discard</button>
        <button class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style="background-color: #0241E3" :disabled="isSavingZone" @click="savePendingZone">
          {{ isSavingZone ? "Saving…" : "Save Zone" }}
        </button>
      </div>
    </div>

    <div
      v-if="skippedCount > 0"
      class="absolute bottom-4 left-4 z-[1000] px-3 py-1.5 rounded-lg text-[10px] font-medium backdrop-blur"
      style="color: rgba(255, 255, 255, 0.6); background-color: rgba(2, 8, 23, 0.75); border: 1px solid rgba(255, 255, 255, 0.1)"
    >
      {{ skippedCount }} device{{ skippedCount === 1 ? "" : "s" }} without location data not shown here
    </div>

    <GeofenceZonesPanel :open="isZonesPanelOpen" @close="isZonesPanelOpen = false" />
  </div>
</template>
