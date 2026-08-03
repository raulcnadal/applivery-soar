<script setup lang="ts">
// The device detail card opened by clicking a globe/map pin — port of
// App.jsx's DeviceInsightCard (App.jsx:2228-2699), rendered as a centered
// modal (ModalBackdrop/ModalShell/ModalHeader, App.jsx:5405-5412), NOT the
// Devices table's own drawer — a separate, 4-tab card (Overview / Compliance
// / Assets / Agent) reached only from Playground's globe/map clicks.
import { computed, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";

const props = defineProps<{ device: Record<string, any> | null }>();
const emit = defineEmits<{ close: [] }>();

const RISK_TIER_META: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: SUCCESS },
  medium: { label: "Medium", color: WARNING },
  high: { label: "High", color: "#F97316" },
  critical: { label: "Critical", color: DANGER },
};
function riskMeta(tier: string) {
  return RISK_TIER_META[tier] || RISK_TIER_META.low;
}

const tab = ref<"overview" | "compliance" | "assets" | "agent">("overview");
const showLocationHistory = ref(false);

const summary = computed(() => props.device?.summary ?? {});
const deviceId = computed(() => props.device?.id ?? props.device?._id ?? "");

// ── Extras (locations/network/agent-logs/assets) — proxied through this
// app's own backend (GET /api/devices/:id/locations|network-status|
// agent-logs|assets, devices.service.ts). The original frontend called
// api.applivery.io directly from the browser with the user's own Applivery
// token for these (App.jsx:2262-2300); this migration moved that
// server-side instead — same data, no client-side Applivery calls.
const loadingExtras = ref(true);
const locations = ref<any[]>([]);
const network = ref<any | null>(null);
const logs = ref<any[]>([]);
const assets = ref<any[]>([]);

async function loadExtras() {
  loadingExtras.value = true;
  const id = deviceId.value;
  if (!id) {
    loadingExtras.value = false;
    return;
  }
  const platform = props.device?.platform_normalized ?? "";
  const { api } = await import("../../api/http");
  const [locRes, netRes, logsRes, assetsRes] = await Promise.all([
    api.get(`/devices/${id}/locations`, { params: { platform } }).catch(() => null),
    api.get(`/devices/${id}/network-status`, { params: { platform } }).catch(() => null),
    api.get(`/devices/${id}/agent-logs`, { params: { platform } }).catch(() => null),
    api.get(`/devices/${id}/assets`, { params: { segmentId: props.device?.segmentId ?? "" } }).catch(() => null),
  ]);
  locations.value = locRes?.data?.items ?? [];
  network.value = netRes?.data?.items?.[0] ?? null;
  logs.value = logsRes?.data?.items ?? [];
  assets.value = assetsRes?.data?.items ?? [];
  loadingExtras.value = false;
}

// ── Compliance tab — our own backend (GET /api/devices/{id}/compliance),
// since this device's risk/violation data lives in getDevicesFull's
// computation, which the lighter Playground device list never carries
// (App.jsx:2262-2280's comment).
const compliance = ref<any | null>(null);
const loadingCompliance = ref(true);
const complianceError = ref<string | null>(null);
async function loadCompliance() {
  const id = deviceId.value;
  loadingCompliance.value = true;
  complianceError.value = null;
  if (!id) {
    loadingCompliance.value = false;
    return;
  }
  try {
    const { api } = await import("../../api/http");
    const res = await api.get(`/devices/${id}/compliance`);
    compliance.value = res.data;
  } catch (err: any) {
    complianceError.value = err?.response?.data?.detail || "Could not load compliance data for this device.";
  } finally {
    loadingCompliance.value = false;
  }
}

watch(
  () => props.device,
  (d) => {
    if (!d) return;
    tab.value = "overview";
    showLocationHistory.value = false;
    loadExtras();
    loadCompliance();
  },
  { immediate: true },
);

function batteryColor(pct: number | null | undefined) {
  if (pct == null) return "#9CA3AF";
  if (pct < 20) return DANGER;
  if (pct < 40) return WARNING;
  return SUCCESS;
}
function freeStorageGb() {
  const avail = summary.value.availableStorage ?? summary.value.availableCapacity;
  if (avail == null) return null;
  return (Number(avail) / 1024 / 1024 / 1024).toFixed(1);
}
function activePolicyNames(): string[] {
  const d = props.device ?? {};
  const names = new Set<string>();
  for (const key of ["appliedEmmPolicy", "appliedAdmPolicy", "appliedWinPolicy"]) {
    const v = d[key];
    if (v && typeof v === "object" && v.name) names.add(String(v.name));
    else if (typeof v === "string" && v) names.add(v);
  }
  if (d.devicePolicyStatus?.policyName) names.add(String(d.devicePolicyStatus.policyName));
  if (summary.value.appliedPolicy) names.add(String(summary.value.appliedPolicy));
  return [...names];
}
</script>

<template>
  <Teleport to="body">
    <div v-if="device" class="fixed inset-0 z-[120] flex items-center justify-center p-4" style="background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(6px)" @click.self="emit('close')">
      <div class="w-full max-w-xl rounded-2xl shadow-2xl bg-white dark:bg-gray-800 flex flex-col max-h-[85vh]">
        <div class="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl flex items-center justify-center" :style="{ backgroundColor: `${PRIMARY_BLUE}15` }">
              <component :is="ICONS.InfoCircle" :size="18" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
            </div>
            <h2 class="text-base font-bold text-gray-900 dark:text-white">Details</h2>
          </div>
          <button class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 hover:text-gray-600 transition-colors" @click="emit('close')">
            <component :is="ICONS.CloseCircle" :size="18" weight="Linear" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-6">
          <!-- Device header -->
          <div class="flex items-center gap-4 mb-4">
            <div class="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}15` }">
              <component :is="ICONS.Smartphone" :size="26" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
            </div>
            <div class="min-w-0">
              <h3 class="text-xl font-bold text-gray-900 dark:text-white truncate">{{ device.displayName || "Unknown device" }}</h3>
              <p v-if="device.email" class="text-sm text-gray-400 truncate">{{ device.email }}</p>
              <div class="flex items-center gap-2 mt-1.5">
                <span class="text-[10px] font-medium px-2 py-0.5 rounded-full" :style="{ backgroundColor: device.state_normalized === 'active' ? `${SUCCESS}15` : `${WARNING}15`, color: device.state_normalized === 'active' ? SUCCESS : WARNING }">
                  {{ device.state_normalized || "unknown" }}
                </span>
                <span class="text-[10px] font-medium px-2 py-0.5 rounded-full" :style="{ backgroundColor: device.is_compliant_normalized ? `${SUCCESS}15` : `${DANGER}15`, color: device.is_compliant_normalized ? SUCCESS : DANGER }">
                  {{ device.is_compliant_normalized ? "Compliant" : "Non-compliant" }}
                </span>
              </div>
            </div>
          </div>

          <!-- Quick stats -->
          <div class="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-700 border border-gray-100 dark:border-gray-800 rounded-xl mb-5">
            <div class="flex flex-col items-center justify-center py-3">
              <span class="text-sm font-semibold" :style="{ color: batteryColor(summary.battery) }">{{ summary.battery != null ? `${summary.battery}%` : "—" }}</span>
              <span class="text-[10px] text-gray-400 mt-0.5">Battery</span>
            </div>
            <div class="flex flex-col items-center justify-center py-3">
              <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ summary.osVersion || device.osVersion || "—" }}</span>
              <span class="text-[10px] text-gray-400 mt-0.5">OS version</span>
            </div>
            <div class="flex flex-col items-center justify-center py-3">
              <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ freeStorageGb() != null ? `${freeStorageGb()} GB` : "—" }}</span>
              <span class="text-[10px] text-gray-400 mt-0.5">Free storage</span>
            </div>
          </div>

          <!-- Tabs -->
          <div class="flex items-center gap-6 border-b border-gray-100 dark:border-gray-800 mb-5">
            <button
              v-for="t in ['overview', 'compliance', 'assets', 'agent']"
              :key="t"
              class="pb-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors"
              :style="{ color: tab === t ? PRIMARY_BLUE : '#9CA3AF', borderColor: tab === t ? PRIMARY_BLUE : 'transparent' }"
              @click="tab = t as any"
            >
              {{ t }}
            </button>
          </div>

          <!-- Overview -->
          <div v-if="tab === 'overview'" class="space-y-5">
            <div>
              <p class="text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-400">Hardware &amp; Connectivity</p>
              <div class="p-4 rounded-xl border border-gray-100 dark:border-gray-800 space-y-1.5 text-sm">
                <div class="flex justify-between"><span class="text-gray-400">Manufacturer</span><span class="text-gray-900 dark:text-white">{{ summary.manufacturer || "—" }}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">Model</span><span class="text-gray-900 dark:text-white">{{ summary.model || "—" }}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">Serial number</span><span class="font-mono text-xs text-gray-900 dark:text-white">{{ summary.serialNumber || "—" }}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">IMEI</span><span class="font-mono text-xs text-gray-900 dark:text-white">{{ summary.imei || "—" }}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">MAC address</span><span class="font-mono text-xs text-gray-900 dark:text-white">{{ summary.macAddress || device.macAddress || "—" }}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">UDID</span><span class="font-mono text-xs text-gray-900 dark:text-white break-all select-all">{{ summary.udid || device.udid || "—" }}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">IP address</span><span class="font-mono text-xs text-gray-900 dark:text-white">{{ summary.ipAddress || device.ipAddress || "—" }}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">Management mode</span><span class="text-gray-900 dark:text-white">{{ device.managementMode || summary.managementMode || "—" }}</span></div>
              </div>
            </div>

            <div>
              <p class="text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-400">Management Lifecycle</p>
              <div class="p-4 rounded-xl border border-gray-100 dark:border-gray-800 space-y-1.5 text-sm">
                <div class="flex justify-between"><span class="text-gray-400">Enrolled date</span><span class="text-gray-900 dark:text-white">{{ device.enrolledDate ? new Date(device.enrolledDate).toLocaleDateString() : "—" }}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">Last reported</span><span class="text-gray-900 dark:text-white">{{ device.lastStatusReportTime ? new Date(device.lastStatusReportTime).toLocaleString() : "—" }}</span></div>
              </div>
            </div>

            <div v-if="activePolicyNames().length">
              <p class="text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-400">Active Policies</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="name in activePolicyNames()" :key="name" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium" :style="{ backgroundColor: `${PRIMARY_BLUE}10`, color: PRIMARY_BLUE }">
                  <component :is="ICONS.ShieldWarning" :size="11" weight="Linear" /> {{ name }}
                </span>
              </div>
            </div>

            <div v-if="(device.tags || []).length">
              <p class="text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-400">Tags</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="t in device.tags" :key="t" class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">#{{ t }}</span>
              </div>
            </div>

            <div>
              <p class="text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-400">Last Location</p>
              <div v-if="loadingExtras" class="p-4 rounded-xl border border-gray-100 dark:border-gray-800 animate-pulse h-16" />
              <template v-else-if="locations.length">
                <div class="p-4 rounded-xl border border-gray-100 dark:border-gray-800 space-y-2 text-sm mb-2">
                  <div class="flex items-center gap-2 text-gray-900 dark:text-white">
                    <component :is="ICONS.MapPoint" :size="14" weight="Linear" class="text-gray-400" />
                    {{ locations[0].address || `${locations[0].city || ""} ${locations[0].country || ""}`.trim() || "Unknown address" }}
                  </div>
                  <a
                    v-if="locations[0].lat || locations[0].latitude"
                    :href="`https://www.google.com/maps/search/?api=1&query=${locations[0].lat ?? locations[0].latitude},${locations[0].lng ?? locations[0].longitude}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1.5 text-xs font-medium"
                    :style="{ color: PRIMARY_BLUE }"
                  >
                    <component :is="ICONS.Target" :size="12" weight="Linear" /> Open in Google Maps
                  </a>
                </div>
                <iframe
                  v-if="locations[0].lat || locations[0].latitude"
                  class="w-full h-72 rounded-xl border border-gray-100 dark:border-gray-800"
                  :src="`https://www.openstreetmap.org/export/embed.html?bbox=${(locations[0].lng ?? locations[0].longitude) - 0.005}%2C${(locations[0].lat ?? locations[0].latitude) - 0.005}%2C${(locations[0].lng ?? locations[0].longitude) + 0.005}%2C${(locations[0].lat ?? locations[0].latitude) + 0.005}&marker=${locations[0].lat ?? locations[0].latitude}%2C${locations[0].lng ?? locations[0].longitude}`"
                />
                <button v-if="locations.length > 1" class="mt-2 flex items-center gap-1.5 text-xs font-medium" :style="{ color: PRIMARY_BLUE }" @click="showLocationHistory = !showLocationHistory">
                  <component :is="ICONS.ClockCircle" :size="12" weight="Linear" /> {{ showLocationHistory ? "Hide history" : `View location history (${locations.length - 1})` }}
                </button>
                <div v-if="showLocationHistory" class="mt-2 space-y-1.5">
                  <div v-for="(loc, i) in locations.slice(1)" :key="i" class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-xs">
                    <span class="text-gray-700 dark:text-gray-200">{{ loc.address || `${loc.city || ""} ${loc.country || ""}`.trim() || "Unknown address" }}</span>
                    <span class="text-gray-400 shrink-0 ml-2">{{ loc.createdAt ? new Date(loc.createdAt).toLocaleString() : "" }}</span>
                  </div>
                </div>
              </template>
              <div v-else class="flex flex-col items-center justify-center py-8 text-center border border-gray-100 dark:border-gray-800 rounded-xl">
                <component :is="ICONS.MapPoint" :size="20" weight="Linear" class="mb-2 text-gray-300" />
                <p class="text-xs text-gray-400">No location data available</p>
              </div>
            </div>

            <div>
              <p class="text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-400">Network Status</p>
              <div v-if="loadingExtras" class="p-4 rounded-xl border border-gray-100 dark:border-gray-800 animate-pulse h-12" />
              <div v-else-if="network" class="p-4 rounded-xl border border-gray-100 dark:border-gray-800 space-y-1.5 text-sm">
                <div class="flex items-center gap-2">
                  <component :is="String(network.type || '').toLowerCase().includes('wifi') ? ICONS.WiFiRouter : ICONS.Radio" :size="14" weight="Linear" :style="{ color: String(network.type || '').toLowerCase().includes('wifi') ? PRIMARY_BLUE : SUCCESS }" />
                  <span class="text-gray-900 dark:text-white">{{ network.type || "Unknown" }}</span>
                  <span v-if="network.signalStrength" class="text-xs text-gray-400">· signal {{ network.signalStrength }}</span>
                </div>
                <div v-if="network.carrier" class="flex justify-between"><span class="text-gray-400">Carrier</span><span class="text-gray-900 dark:text-white">{{ network.carrier }}</span></div>
                <div v-if="network.city" class="flex justify-between"><span class="text-gray-400">City</span><span class="text-gray-900 dark:text-white">{{ network.city }}</span></div>
                <div v-if="network.createdAt" class="flex justify-between"><span class="text-gray-400">Last updated</span><span class="text-gray-900 dark:text-white">{{ new Date(network.createdAt).toLocaleString() }}</span></div>
              </div>
              <div v-else class="flex flex-col items-center justify-center py-8 text-center border border-gray-100 dark:border-gray-800 rounded-xl">
                <component :is="ICONS.WiFiRouter" :size="20" weight="Linear" class="mb-2 text-gray-300" />
                <p class="text-xs text-gray-400">No network data available</p>
              </div>
            </div>
          </div>

          <!-- Compliance -->
          <div v-else-if="tab === 'compliance'" class="space-y-5">
            <div v-if="loadingCompliance" class="space-y-2">
              <div class="h-16 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
              <div class="h-16 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
            </div>
            <div v-else-if="complianceError" class="flex items-start gap-2 px-4 py-3 rounded-xl border" :style="{ backgroundColor: `${DANGER}10`, borderColor: `${DANGER}30` }">
              <component :is="ICONS.ShieldWarning" :size="16" weight="Linear" :style="{ color: DANGER }" class="mt-0.5 shrink-0" />
              <p class="text-sm" :style="{ color: DANGER }">{{ complianceError }}</p>
            </div>
            <template v-else-if="compliance">
              <div>
                <p class="text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-400">Risk Score</p>
                <div class="flex items-baseline gap-2 mb-2">
                  <span class="text-3xl font-bold" :style="{ color: riskMeta(compliance.riskTier).color }">{{ compliance.riskScore ?? 0 }}</span>
                  <span class="text-sm text-gray-400">/100 · {{ riskMeta(compliance.riskTier).label }}</span>
                </div>
                <div class="h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
                  <div class="h-full rounded-full" :style="{ width: `${Math.min(Math.max(compliance.riskScore ?? 0, 0), 100)}%`, backgroundColor: riskMeta(compliance.riskTier).color }" />
                </div>
              </div>

              <div v-if="(compliance.riskFactors || []).length">
                <p class="text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-400">Risk Factors</p>
                <div class="space-y-1.5">
                  <div v-for="(f, i) in compliance.riskFactors" :key="i" class="flex items-center justify-between text-sm">
                    <span class="text-gray-900 dark:text-white">{{ f.label }}</span>
                    <span class="text-xs font-semibold" :style="{ color: riskMeta(compliance.riskTier).color }">+{{ f.points }}</span>
                  </div>
                </div>
              </div>

              <div>
                <p class="text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-400">
                  Compliance Policy Violations{{ (compliance.policyViolations || []).length ? ` (${compliance.policyViolations.length})` : "" }}
                </p>
                <div v-if="(compliance.policyViolations || []).length" class="space-y-1.5">
                  <div v-for="(v, i) in compliance.policyViolations" :key="i" class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-sm">
                    <span class="text-gray-900 dark:text-white truncate">{{ v.policyName || "Unknown policy" }}</span>
                    <span class="text-[10px] font-semibold shrink-0 uppercase" :style="{ color: v.status === 'pending' ? WARNING : v.status === 'auto_fired' ? PRIMARY_BLUE : '#9CA3AF' }">{{ String(v.status || "").replace("_", " ") || "—" }}</span>
                  </div>
                </div>
                <p v-else class="text-xs flex items-center gap-1.5" :style="{ color: SUCCESS }"><component :is="ICONS.ShieldCheck" :size="13" weight="Linear" /> No open Compliance Policy violations for this device.</p>
              </div>

              <div v-if="(compliance.openCases || []).length">
                <p class="text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-400">Open Cases ({{ compliance.openCases.length }})</p>
                <div class="space-y-1.5">
                  <div v-for="c in compliance.openCases" :key="c.id" class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-sm">
                    <span class="text-gray-900 dark:text-white truncate">{{ c.title }}</span>
                    <span class="text-[10px] font-semibold shrink-0" :style="{ color: PRIMARY_BLUE }">{{ c.severity }}</span>
                  </div>
                </div>
              </div>
            </template>
            <p v-else class="text-sm text-center text-gray-400 py-8">No compliance data available</p>
          </div>

          <!-- Assets -->
          <div v-else-if="tab === 'assets'" class="space-y-2">
            <div v-if="loadingExtras" class="space-y-2">
              <div class="h-12 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
              <div class="h-12 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
            </div>
            <template v-else-if="assets.length">
              <div v-for="a in assets" :key="a.id" class="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100 dark:border-gray-800">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}10` }">
                  <component :is="ICONS.Case" :size="14" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-sm text-gray-900 dark:text-white truncate">{{ a.name }}</p>
                  <p class="text-xs text-gray-400">{{ a.type || "—" }} · {{ a.extension || "" }}</p>
                </div>
                <span class="text-xs text-gray-400 shrink-0">{{ a.size ? `${(a.size / 1024 / 1024).toFixed(1)} MB` : "" }}</span>
              </div>
            </template>
            <p v-else class="text-sm text-center text-gray-400 py-8">No assets found</p>
          </div>

          <!-- Agent -->
          <div v-else-if="tab === 'agent'" class="space-y-2">
            <div v-if="loadingExtras" class="space-y-2">
              <div class="h-12 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
              <div class="h-12 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
            </div>
            <template v-else-if="logs.length">
              <div v-for="(l, i) in logs" :key="i" class="px-3 py-2.5 rounded-xl border border-gray-100 dark:border-gray-800">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-[10px] font-medium px-2 py-0.5 rounded-full" :style="{ backgroundColor: `${PRIMARY_BLUE}10`, color: PRIMARY_BLUE }">{{ device.platform_normalized || "device" }} Agent</span>
                  <span class="text-[10px] font-mono text-gray-400">{{ l.createdAt ? new Date(l.createdAt).toLocaleString() : "" }}</span>
                </div>
                <p class="text-xs font-mono break-all whitespace-pre-wrap text-gray-700 dark:text-gray-200">{{ l.content || l.message || JSON.stringify(l) }}</p>
              </div>
            </template>
            <p v-else class="text-sm text-center text-gray-400 py-8">No agent logs available for this device</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
