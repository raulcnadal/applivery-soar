<script setup lang="ts">
// Devices view — fleet table + detail drawer, "Compliance shown" source
// toggle (Applivery flag vs Compliance Policies + policy scope), fleet risk
// trend sparkline, and a Devices/Playground ViewSwitcher pill. Faithful
// port of the original App.jsx Devices view (DevicesView.jsx, 325 lines).
import { RouterLink } from "vue-router";
import { computed, onMounted, ref } from "vue";
import { ICONS } from "../lib/solarIcons";
import HelpIcon from "../components/shared/HelpIcon.vue";
import DeviceDetailDrawer from "../components/devices/DeviceDetailDrawer.vue";
import DeviceFleetTable from "../components/devices/DeviceFleetTable.vue";
import { useDevicesStore } from "../stores/devices";

const PRIMARY_BLUE = "#0241E3";
const DANGER = "#EF4444";

const store = useDevicesStore();

const selectedDeviceId = ref<string | null>(null);
const selectedDevice = computed(() => store.devices.find((d) => d.id === selectedDeviceId.value) ?? null);

function openDevice(deviceId: string) {
  selectedDeviceId.value = deviceId;
}
function closeDrawer() {
  selectedDeviceId.value = null;
}

// Compliance-source override: 'applivery' passes isCompliant straight
// through; 'policy' overrides it with policyCompliant (SOAR's own live
// Compliance Policies violation state) — done once here so
// DeviceFleetTable/DeviceDetailDrawer keep reading d.isCompliant unchanged.
const effectiveDevices = computed(() => {
  if (store.complianceSource !== "policy") return store.devices;
  return store.devices.map((d) => ({
    ...d,
    isCompliant: d.policyCompliant !== false,
    complianceViolations: d.policyViolations || [],
  }));
});

const scopedDevices = computed(() => {
  if (!store.policyViolatingIds) return effectiveDevices.value;
  return effectiveDevices.value.filter((d) => store.policyViolatingIds!.has(String(d.id)));
});

const nonCompliant = computed(() => scopedDevices.value.filter((d) => !d.isCompliant).length);
const maxTrendScore = computed(() => Math.max(...store.riskTrend.map((p) => p.avgRiskScore), 1));

function handleComplianceSourceChange(source: "applivery" | "policy") {
  store.setComplianceSource(source);
}

onMounted(async () => {
  await Promise.all([store.fetchDevices(false), store.fetchPickers(), store.fetchPolicies(), store.fetchRiskTrend()]);
});
</script>

<template>
  <main class="p-8 pb-16">
    <header class="flex justify-between items-start mb-8 flex-wrap gap-3">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold leading-tight text-gray-900">Devices</h1>
          <HelpIcon slug="devices" title="Devices admin guide" />
        </div>
        <p class="text-sm mt-1 text-gray-400">
          {{ store.isLoading ? "Loading device fleet…" : `${scopedDevices.length} device${scopedDevices.length !== 1 ? "s" : ""}${nonCompliant ? ` · ${nonCompliant} non-compliant` : ""}` }}
        </p>
      </div>
      <div class="flex items-center gap-3 shrink-0 ml-auto">
        <div class="flex items-center gap-1 p-1 rounded-xl border border-gray-200 bg-gray-50 shrink-0">
          <span class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap bg-white text-gray-900 shadow-sm">
            <component :is="ICONS.Smartphone" :size="14" weight="Linear" /> Devices
          </span>
          <RouterLink to="/playground" class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap text-gray-400 transition-all">
            <component :is="ICONS.Global" :size="14" weight="Linear" /> Playground
          </RouterLink>
        </div>
        <span class="text-xs text-gray-400" :class="{ invisible: !store.fetchedAt || store.isLoading }">
          Updated {{ store.fetchedAt ? new Date(store.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "00:00" }}
        </span>
        <button
          :disabled="store.isLoading || store.isRefreshing"
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700 disabled:opacity-50"
          @click="store.fetchDevices(true)"
        >
          <component :is="ICONS.Refresh" :size="15" weight="Linear" :class="store.isRefreshing ? 'animate-spin' : ''" />
          {{ store.isRefreshing ? "Refreshing…" : "Refresh" }}
        </button>
      </div>
    </header>

    <!-- Compliance source toggle -->
    <div class="flex items-center gap-2 mb-6 flex-wrap">
      <span class="text-xs font-medium text-gray-400">Compliance shown:</span>
      <div class="inline-flex rounded-lg overflow-hidden border border-gray-200">
        <button
          class="px-3 py-1.5 text-xs font-medium transition-colors border-r border-gray-200"
          :style="{ backgroundColor: store.complianceSource === 'applivery' ? PRIMARY_BLUE : '#fff', color: store.complianceSource === 'applivery' ? '#fff' : '#111827' }"
          @click="handleComplianceSourceChange('applivery')"
        >
          Applivery flag
        </button>
        <button
          class="px-3 py-1.5 text-xs font-medium transition-colors"
          :style="{ backgroundColor: store.complianceSource === 'policy' ? PRIMARY_BLUE : '#fff', color: store.complianceSource === 'policy' ? '#fff' : '#111827' }"
          @click="handleComplianceSourceChange('policy')"
        >
          Compliance Policies
        </button>
      </div>
      <select
        v-if="store.complianceSource === 'policy'"
        v-model="store.selectedPolicyId"
        title="Scope the table to devices violating one specific Compliance Policy"
        class="px-3 py-1.5 rounded-lg text-xs font-medium outline-none border border-gray-200 bg-white"
      >
        <option value="">All policies</option>
        <option v-for="p in store.policies" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <span v-if="store.isLoadingPolicyFilter" class="text-xs text-gray-400">Loading…</span>
      <HelpIcon slug="devices" title="What does this toggle mean?" />
    </div>

    <!-- Fleet risk trend sparkline -->
    <div v-if="store.riskTrend.length >= 2" class="flex items-center gap-3 mb-6 px-4 py-2.5 rounded-xl border border-gray-200 bg-white">
      <component :is="ICONS.GraphUp" :size="14" weight="Linear" class="shrink-0 text-gray-400" />
      <span class="text-xs font-semibold shrink-0 text-gray-400">Fleet risk trend</span>
      <div class="flex items-end gap-0.5 h-6 shrink-0">
        <div
          v-for="(p, i) in store.riskTrend"
          :key="p.date"
          :title="`${p.date}: avg ${p.avgRiskScore}`"
          class="w-1.5 rounded-sm"
          :style="{ height: `${Math.max(8, (p.avgRiskScore / maxTrendScore) * 100)}%`, backgroundColor: i === store.riskTrend.length - 1 ? PRIMARY_BLUE : `${PRIMARY_BLUE}40` }"
        />
      </div>
      <span class="text-xs text-gray-400">
        {{ store.riskTrend[0].avgRiskScore }} → {{ store.riskTrend[store.riskTrend.length - 1].avgRiskScore }} avg over {{ store.riskTrend.length }} day{{ store.riskTrend.length === 1 ? "" : "s" }}
      </span>
    </div>

    <div v-if="store.isLoading" class="flex flex-col items-center justify-center min-h-[400px]">
      <div class="w-8 h-8 border-2 rounded-full animate-spin mb-4" :style="{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }" />
      <span class="text-xs uppercase tracking-widest font-bold text-gray-400">Fetching device fleet…</span>
    </div>
    <div v-else-if="store.error" class="flex items-start gap-3 px-4 py-3 rounded-xl border" :style="{ backgroundColor: `${DANGER}10`, borderColor: `${DANGER}30` }">
      <component :is="ICONS.ShieldWarning" :size="18" weight="Linear" class="shrink-0 mt-0.5" :style="{ color: DANGER }" />
      <div>
        <p class="text-sm font-medium" :style="{ color: DANGER }">Couldn't load devices</p>
        <p class="text-xs mt-0.5 text-gray-400">{{ store.error }}</p>
      </div>
    </div>
    <DeviceFleetTable v-else :devices="scopedDevices" :segments="store.segments as any" :is-loading="store.isLoading" @open-device="openDevice" />

    <DeviceDetailDrawer :device="selectedDevice" :segments="store.segments as any" @close="closeDrawer" />
  </main>
</template>
