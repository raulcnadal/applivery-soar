<script setup lang="ts">
// Devices view — fleet table + map toggle, platform/compliance/segment
// filters, bulk re-attest, and the device detail drawer. Port of the
// original App.jsx Devices view (migration-plan.md Phase 2 checkpoint:
// "Devices view fully functional: fleet table, map, segment filter,
// tag/policy edit, bulk reattest").
import { Alert, Button, Input, PageHeader, Tabs } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import DeviceDetailDrawer from "../components/devices/DeviceDetailDrawer.vue";
import DeviceFleetTable from "../components/devices/DeviceFleetTable.vue";
import DeviceMap from "../components/devices/DeviceMap.vue";
import { useDevicesStore } from "../stores/devices";

const store = useDevicesStore();

const layout = ref<"table" | "map">("table");
const layoutTabs = [
  { id: "table", label: "Fleet table" },
  { id: "map", label: "Map" },
];

const selectedDeviceId = ref<string | null>(null);
const selectedDevice = computed(() => store.devices.find((d) => d.id === selectedDeviceId.value) ?? null);

const bulkResult = ref<{ succeeded: number; total: number } | null>(null);
const isBulkRunning = ref(false);

const platformOptions = [
  { value: "all", label: "All platforms" },
  { value: "apple", label: "Apple" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
];
const complianceOptions = [
  { value: "all", label: "All" },
  { value: "compliant", label: "Compliant" },
  { value: "noncompliant", label: "Non-compliant" },
];
const segmentOptions = computed(() => [{ value: "all", label: "All segments" }, ...store.segments.map((s) => ({ value: s.id, label: s.name }))]);

async function refresh() {
  await store.fetchDevices(true);
}

function openDevice(deviceId: string) {
  selectedDeviceId.value = deviceId;
}

function closeDrawer() {
  selectedDeviceId.value = null;
}

function toggleSelectAll() {
  const visible = store.filteredDevices;
  const allSelected = visible.length > 0 && visible.every((d) => store.selectedDeviceIds.has(d.id));
  if (allSelected) {
    for (const d of visible) store.toggleSelected(d.id);
  } else {
    for (const d of visible) {
      if (!store.selectedDeviceIds.has(d.id)) store.toggleSelected(d.id);
    }
  }
}

async function runBulkReattest() {
  const ids = Array.from(store.selectedDeviceIds);
  if (ids.length === 0) return;
  isBulkRunning.value = true;
  bulkResult.value = null;
  try {
    const res = await store.bulkReattest(ids);
    bulkResult.value = { succeeded: res.succeeded, total: res.total };
    store.clearSelection();
  } finally {
    isBulkRunning.value = false;
  }
}

onMounted(async () => {
  await Promise.all([store.fetchDevices(false), store.fetchPickers()]);
});
</script>

<template>
  <div class="p-8 space-y-6 animate-page-enter">
    <PageHeader title="Devices" :description="`${store.total} device(s) in the fleet`">
      <template #action>
        <Button variant="secondary" :loading="store.isLoading" @click="refresh">Refresh</Button>
      </template>
    </PageHeader>

    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
    <Alert v-if="bulkResult" type="info">
      Re-attestation pushed to {{ bulkResult.succeeded }}/{{ bulkResult.total }} selected device(s).
    </Alert>

    <div class="flex flex-wrap items-center gap-3">
      <Input v-model="store.searchQuery" type="search" placeholder="Search devices…" class="w-64" />
      <Input v-model="store.platformFilter" type="select" :options="platformOptions" class="w-44" />
      <Input v-model="store.complianceFilter" type="select" :options="complianceOptions" class="w-44" />
      <Input v-model="store.segmentFilter" type="select" :options="segmentOptions" class="w-48" />
      <Tabs :tabs="layoutTabs" :model-value="layout" variant="pill" @update:model-value="layout = $event as 'table' | 'map'" />
    </div>

    <div v-if="store.selectedDeviceIds.size > 0" class="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
      <p class="text-sm text-brand-800">{{ store.selectedDeviceIds.size }} device(s) selected</p>
      <Button size="sm" :loading="isBulkRunning" @click="runBulkReattest">Re-attest selected</Button>
      <Button size="sm" variant="ghost" @click="store.clearSelection()">Clear</Button>
    </div>

    <DeviceFleetTable
      v-if="layout === 'table'"
      :devices="store.filteredDevices"
      :selected-ids="store.selectedDeviceIds"
      :is-loading="store.isLoading"
      @toggle-select="store.toggleSelected"
      @toggle-select-all="toggleSelectAll"
      @open-device="openDevice"
    />
    <DeviceMap v-else :devices="store.filteredDevices" @open-device="openDevice" />

    <DeviceDetailDrawer :device="selectedDevice" @close="closeDrawer" />
  </div>
</template>
