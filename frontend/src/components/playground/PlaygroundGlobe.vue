<script setup lang="ts">
// The 3D device globe — port of App.jsx's GlobeWidget (App.jsx:1835-2078).
// Pulsing ring + solid point per device (color-coded by compliance, falling
// back to a platform color), a HUD overlay (fleet/compliance/OS counts,
// satellite count, branding), decorative arcs between a handful of real
// devices, 3 orbiting satellite sprites, and a slowly-rotating cloud layer
// — all purely cosmetic except the rings/points, which are the real,
// clickable device markers. Devices with no resolvable location still
// render, at a stable pseudo-random position derived from the device's id
// (smaller, dimmer marker) so the fleet is never silently incomplete.
import Globe, { type GlobeInstance } from "globe.gl";
import * as THREE from "three";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";

const props = defineProps<{ items: any[]; filterActive: boolean; totalDevices: number; paused: boolean }>();
const emit = defineEmits<{ "device-click": [item: any]; zoom: [pov: { lat: number; lng: number; altitude: number }] }>();

const containerEl = ref<HTMLDivElement | null>(null);
let globe: GlobeInstance | null = null;
let resizeObserver: ResizeObserver | null = null;
let rafId: number | null = null;
let clouds: THREE.Mesh | null = null;
let tick = 0;

// Port of SATELLITE_ORBITS (App.jsx:1799-1803).
const SATELLITE_ORBITS = [
  { lat: 40.4, lngOffset: 0, alt: 0.38, speed: 0.12, label: "Melkor-1" },
  { lat: -23.5, lngOffset: 120, alt: 0.55, speed: 0.07, label: "Balthasar-2" },
  { lat: 60.0, lngOffset: 240, alt: 0.44, speed: 0.09, label: "Casper-3" },
];

// Port of resolveRealDeviceLatLng (App.jsx:1808-1815).
function resolveRealDeviceLatLng(item: any): { lat: number; lng: number } | null {
  if (item.locationCache?.lat !== undefined) return { lat: parseFloat(item.locationCache.lat), lng: parseFloat(item.locationCache.lng) };
  if (item.lastLocation?.latitude !== undefined) return { lat: parseFloat(item.lastLocation.latitude), lng: parseFloat(item.lastLocation.longitude) };
  if (item.location?.lat !== undefined) return { lat: parseFloat(item.location.lat), lng: parseFloat(item.location.lng) };
  if (item.networkInfo?.latitude !== undefined) return { lat: parseFloat(item.networkInfo.latitude), lng: parseFloat(item.networkInfo.longitude) };
  if (item.summary?.latitude !== undefined) return { lat: parseFloat(item.summary.latitude), lng: parseFloat(item.summary.longitude) };
  return null;
}

// Port of deviceMarkerColor (App.jsx:1817-1824).
function deviceMarkerColor(item: any): string {
  const os = String(item.platform_normalized || item.os || "").toLowerCase();
  let color = os.includes("apple") || os.includes("ios") || os.includes("mac") ? "#79C6E8" : os.includes("android") ? "#3DDC84" : os.includes("win") ? "#0078D4" : "#A855F7";
  if (item.is_compliant_normalized === false) color = "#EF4444";
  else if (item.is_compliant_normalized === true) color = "#22C55E";
  return color;
}

// Port of GlobeWidget's `gData` memo (App.jsx:1928-1939) — deterministic
// pseudo-random placeholder position derived from the device id when there's
// no real location on file, so unlocated devices are still plotted (smaller,
// no-pulse marker) rather than silently dropped.
const gData = computed(() =>
  props.items.map((item) => {
    const real = resolveRealDeviceLatLng(item);
    const str = String(item.id || item._id || Math.random());
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash << 5) - hash + str.charCodeAt(i);
    const hasReal = !!real && !isNaN(real.lat);
    const lat = (hasReal ? real!.lat : (Math.abs(hash) % 120) - 60) + (Math.random() - 0.5) * 0.4;
    const lng = (hasReal ? real!.lng : (Math.abs(hash >> 8) % 360) - 180) + (Math.random() - 0.5) * 0.4;
    const alt = 0.008 + Math.random() * 0.012;
    return { ...item, lat, lng, alt, size: hasReal ? 3.5 : 1.8, color: deviceMarkerColor(item), label: item.displayName || item.summary?.model || "Device" };
  }),
);

const arcData = computed(() => {
  const real = gData.value.filter((d) => d.size > 2);
  const arcs: any[] = [];
  for (let i = 0; i < Math.min(real.length, 4); i++) {
    for (let j = i + 1; j < Math.min(real.length, 5); j++) {
      arcs.push({ startLat: real[i].lat, startLng: real[i].lng, endLat: real[j].lat, endLng: real[j].lng, color: real[i].color });
    }
  }
  return arcs.slice(0, 8);
});

const compliant = computed(() => gData.value.filter((d) => d.is_compliant_normalized === true).length);
const nonCompliant = computed(() => gData.value.filter((d) => d.is_compliant_normalized === false).length);
const appleCount = computed(() => gData.value.filter((d) => String(d.platform_normalized || "").toLowerCase().includes("apple") || String(d.platform_normalized || "").toLowerCase().includes("ios")).length);
const androidCount = computed(() => gData.value.filter((d) => String(d.platform_normalized || "").toLowerCase().includes("android")).length);
const winCount = computed(() => gData.value.filter((d) => String(d.platform_normalized || "").toLowerCase().includes("win")).length);

function tooltipStyle(color: string) {
  return `background: rgba(2,8,23,0.92); backdrop-filter: blur(8px); padding: 8px 12px; border-radius: 10px; color: white; font-family: 'Outfit', sans-serif; font-size: 13px; border: 1px solid ${color}60; box-shadow: 0 8px 24px rgba(0,0,0,0.5);`;
}

function applyData() {
  if (!globe) return;
  globe
    .ringsData(gData.value as any)
    .ringColor("color" as any)
    .ringMaxRadius("size" as any)
    .ringPropagationSpeed(2.5)
    .ringRepeatPeriod(900)
    // No dedicated ring-click/ring-label API in this globe.gl version's
    // typings — rings sit exactly on top of the points layer below, which
    // already handles clicks (onPointClick) and hover tooltips
    // (pointLabel), so a pulsing ring is still fully clickable/hoverable
    // via the co-located point marker (App.jsx's separate onRingClick/
    // ringLabel were react-globe.gl sugar over the same coordinate).
    .pointsData(gData.value as any)
    .pointLat("lat" as any)
    .pointLng("lng" as any)
    .pointColor("color" as any)
    .pointAltitude("alt" as any)
    .pointRadius(0.18)
    .pointResolution(16)
    .onPointClick((d: any) => emit("device-click", d))
    .pointLabel((d: any) => `<div style="${tooltipStyle(d.color)}"><div style="font-weight:700;margin-bottom:3px">${d.label}</div><div style="color:#94A3B8;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">${String(d.platform_normalized || d.os || "Unknown").toUpperCase()}</div></div>`)
    .arcsData(arcData.value as any)
    .arcStartLat("startLat" as any)
    .arcStartLng("startLng" as any)
    .arcEndLat("endLat" as any)
    .arcEndLng("endLng" as any)
    .arcColor((d: any) => [`${d.color}99`, `${d.color}22`])
    .arcAltitude(0.18)
    .arcStroke(0.4)
    .arcDashLength(0.4)
    .arcDashGap(0.15)
    .arcDashAnimateTime(2500);
}

function resizeGlobe() {
  if (!globe || !containerEl.value) return;
  globe.width(containerEl.value.clientWidth).height(containerEl.value.clientHeight);
}

watch(() => props.paused, (paused) => {
  const controls = globe?.controls?.();
  if (controls) (controls as any).autoRotate = !paused;
});
watch(gData, applyData);

onMounted(async () => {
  if (!containerEl.value) return;
  const width = containerEl.value.clientWidth;
  const height = containerEl.value.clientHeight;

  globe = new Globe(containerEl.value)
    .width(width)
    .height(height)
    .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
    .backgroundColor("rgba(0,0,0,0)")
    .atmosphereColor("#4488ff")
    .atmosphereAltitude(0.18)
    .onZoom((pov: any) => emit("zoom", pov));

  const controls = globe.controls?.();
  if (controls) {
    (controls as any).autoRotate = !props.paused;
    (controls as any).autoRotateSpeed = 0.2;
  }

  // Clouds sphere — injected once the globe is ready, rotated independently
  // in the RAF loop below (App.jsx's handleGlobeReady, App.jsx:1890-1908).
  const CLOUDS_IMG_URL = "https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/clouds/clouds.png";
  new THREE.TextureLoader().load(CLOUDS_IMG_URL, (cloudsTexture: THREE.Texture) => {
    if (!globe) return;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(globe.getGlobeRadius() * 1.005, 75, 75),
      new THREE.MeshPhongMaterial({ map: cloudsTexture, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    globe.scene().add(mesh);
    clouds = mesh;
  });

  // Satellite sprites (App.jsx:1852-1856, 1938-1946).
  const satTexture = new THREE.TextureLoader().load("/applivery-satellite.svg");
  const satMaterial = new THREE.SpriteMaterial({ map: satTexture, color: 0xffffff, transparent: true, opacity: 0.95 });
  const satObjects = SATELLITE_ORBITS.map((orb, idx) => ({ ...orb, idx, lng: orb.lngOffset - 180 }));
  globe
    .objectsData(satObjects as any)
    .objectLat("lat" as any)
    .objectLng("lng" as any)
    .objectAltitude("alt" as any)
    .objectLabel((d: any) => `<div style="${tooltipStyle("#0241E2")}"><div style="font-weight:700">${d.label}</div><div style="color:#3DDC84;font-size:9px;text-transform:uppercase;margin-top:2px;letter-spacing:1px">● Actively Scanning</div></div>`)
    .objectThreeObject(() => {
      const sprite = new THREE.Sprite(satMaterial);
      sprite.scale.set(5, 5, 1);
      return sprite;
    });

  applyData();

  // Single RAF loop — moves satellites + rotates clouds, skipped while paused
  // (App.jsx:1859-1877).
  const loop = () => {
    tick++;
    if (tick % 2 === 0) {
      satObjects.forEach((orb) => {
        orb.lng = ((orb.lngOffset + tick * orb.speed * 3) % 360) - 180;
      });
      globe?.objectsData([...satObjects] as any);
    }
    if (clouds && !props.paused) clouds.rotation.y += 0.0001;
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  resizeObserver = new ResizeObserver(() => resizeGlobe());
  resizeObserver.observe(containerEl.value);
});

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId);
  resizeObserver?.disconnect();
  (globe as any)?._destructor?.();
  globe = null;
});
</script>

<template>
  <div class="w-full h-full relative cursor-pointer rounded-xl overflow-hidden" style="background: #020817 url(https://unpkg.com/three-globe/example/img/night-sky.png) center/cover">
    <div ref="containerEl" class="w-full h-full" />

    <!-- HUD: fleet / compliance counts (top-left) -->
    <div class="absolute top-4 left-4 pointer-events-none">
      <div class="text-[9px] font-bold uppercase tracking-widest mb-2 text-white/40">{{ filterActive ? "Non-Compliant Filter" : "Device Fleet" }}</div>
      <div class="flex flex-col gap-1.5">
        <div v-if="!filterActive" class="flex items-center gap-2 bg-black/40 backdrop-blur px-2.5 py-1.5 rounded-lg border border-blue-400/30">
          <div class="w-2 h-2 rounded-full bg-blue-400" style="box-shadow: 0 0 6px #60a5fa" />
          <span class="text-[11px] font-semibold text-blue-200">{{ totalDevices }} Total</span>
        </div>
        <div v-if="!filterActive && compliant > 0" class="flex items-center gap-2 bg-black/40 backdrop-blur px-2.5 py-1.5 rounded-lg border border-green-500/25">
          <div class="w-2 h-2 rounded-full bg-green-400" />
          <span class="text-[10px] text-green-300">{{ compliant }} Compliant</span>
        </div>
        <div v-if="nonCompliant > 0" class="flex items-center gap-2 bg-black/40 backdrop-blur px-2.5 py-1.5 rounded-lg border border-red-500/30">
          <div class="w-2 h-2 rounded-full bg-red-400" style="box-shadow: 0 0 6px #f87171" />
          <span class="text-[10px] text-red-300">{{ filterActive ? `${nonCompliant} Out of Compliance` : `${nonCompliant} Non-compliant` }}</span>
        </div>
      </div>
    </div>

    <!-- HUD: per-platform counts (bottom-left) -->
    <div class="absolute bottom-4 left-4 pointer-events-none">
      <div class="flex gap-2">
        <div v-if="appleCount > 0" class="flex items-center gap-1.5 bg-black/40 backdrop-blur px-2 py-1 rounded-lg border border-[#79C6E8]/20">
          <component :is="ICONS.Smartphone" :size="10" weight="Linear" style="color: #79c6e8" /><span class="text-[10px] font-semibold text-[#79C6E8]">{{ appleCount }}</span>
        </div>
        <div v-if="androidCount > 0" class="flex items-center gap-1.5 bg-black/40 backdrop-blur px-2 py-1 rounded-lg border border-[#3DDC84]/20">
          <component :is="ICONS.Smartphone" :size="10" weight="Linear" style="color: #3ddc84" /><span class="text-[10px] font-semibold text-[#3DDC84]">{{ androidCount }}</span>
        </div>
        <div v-if="winCount > 0" class="flex items-center gap-1.5 bg-black/40 backdrop-blur px-2 py-1 rounded-lg border border-[#0078D4]/20">
          <component :is="ICONS.Smartphone" :size="10" weight="Linear" style="color: #0078d4" /><span class="text-[10px] font-semibold text-[#0078D4]">{{ winCount }}</span>
        </div>
      </div>
    </div>

    <!-- HUD: branding (bottom-right) -->
    <div class="absolute bottom-3 right-4 pointer-events-none flex items-center gap-2">
      <span class="text-[9px] font-bold uppercase tracking-widest text-white/30">Applivery SOAR</span>
    </div>

    <!-- HUD: satellite count (top-right) -->
    <div class="absolute top-4 right-4 pointer-events-none">
      <div class="flex items-center gap-1.5 bg-black/40 backdrop-blur px-2.5 py-1.5 rounded-lg border border-green-500/20">
        <div class="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span class="text-[10px] font-semibold text-green-300">{{ SATELLITE_ORBITS.length }} Satellites</span>
      </div>
    </div>
  </div>
</template>
