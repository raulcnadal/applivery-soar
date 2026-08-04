<script setup lang="ts">
// Dry-run preview — safe, read-only walk of a workflow's step chain against
// either a sample device or a real one picked from the fleet. Port of
// DryRunModal (WorkflowRunModals.jsx) — always shows the "safe preview"
// disclaimer, requires an explicit "Run preview" click (never auto-runs),
// and once a preview exists shows "Preview for <device> / Change device"
// with numbered step badges and separate success/failure lines.
import { Alert, Button, Modal, Spinner } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useDevicesStore } from "../../stores/devices";
import { useWorkflowsStore, type DryRunResult, type Workflow } from "../../stores/workflows";

const props = defineProps<{ open: boolean; workflow: Workflow | null }>();
const emit = defineEmits<{ close: [] }>();

const store = useWorkflowsStore();
const devicesStore = useDevicesStore();

const selectedDeviceId = ref("");
const search = ref("");
const result = ref<DryRunResult | null>(null);
const isLoading = ref(false);
const loadError = ref<string | null>(null);

onMounted(async () => {
  if (devicesStore.devices.length === 0) await devicesStore.fetchDevices();
});

const filteredDevices = computed(() =>
  devicesStore.devices.filter((d) => d.displayName.toLowerCase().includes(search.value.toLowerCase())),
);

async function run() {
  if (!props.workflow) return;
  isLoading.value = true;
  loadError.value = null;
  try {
    const device = devicesStore.devices.find((d) => d.id === selectedDeviceId.value);
    result.value = await store.dryRun(
      props.workflow.id,
      device
        ? { id: device.id, displayName: device.displayName, platform: device.platform, platformDeviceId: device.platformDeviceId, serialNumber: device.serialNumber, osVersion: device.osVersion, manufacturer: device.manufacturer, model: device.model }
        : null,
    );
  } catch (err: any) {
    loadError.value = err?.response?.data?.detail || "Dry run failed.";
  } finally {
    isLoading.value = false;
  }
}

function changeDevice() {
  result.value = null;
  loadError.value = null;
}

watch(() => props.open, (open) => {
  if (open) {
    selectedDeviceId.value = "";
    search.value = "";
    result.value = null;
    loadError.value = null;
  }
});
</script>

<template>
  <Modal :open="open" :title="workflow ? `Dry run — ${workflow.name}` : 'Dry run'" size="lg" @close="emit('close')">
    <div class="space-y-4">
      <p class="text-xs flex items-start gap-1.5 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
        <component :is="ICONS.InfoCircle" :size="13" weight="Linear" class="shrink-0 mt-0.5" />
        This is a safe preview — no MDM commands, API calls, or notifications are actually sent. It only shows what a real run's step chain would do.
      </p>

      <Alert v-if="loadError" type="danger">{{ loadError }}</Alert>

      <template v-if="!result">
        <div class="relative">
          <component :is="ICONS.Magnifer" :size="14" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input v-model="search" placeholder="Search devices…" class="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500" />
        </div>
        <div class="space-y-1 max-h-56 overflow-y-auto">
          <label class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer" :class="selectedDeviceId === '' ? 'bg-gray-50 dark:bg-gray-900/50' : ''">
            <input type="radio" :checked="selectedDeviceId === ''" @change="selectedDeviceId = ''" />
            <span class="text-gray-900 dark:text-white">Sample device (no real device picked)</span>
          </label>
          <label v-for="d in filteredDevices" :key="d.id" class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer" :class="selectedDeviceId === d.id ? 'bg-gray-50 dark:bg-gray-900/50' : ''">
            <input type="radio" :checked="selectedDeviceId === d.id" @change="selectedDeviceId = d.id" />
            <component :is="ICONS.Smartphone" :size="13" weight="Linear" class="text-gray-400" />
            <span class="text-gray-900 dark:text-white">{{ d.displayName }}</span>
            <span class="ml-auto text-[10px] text-gray-400">{{ d.platformLabel }}</span>
          </label>
          <p v-if="filteredDevices.length === 0" class="text-xs text-center py-6 text-gray-400">No devices match "{{ search }}"</p>
        </div>

        <div class="flex justify-end">
          <Button :loading="isLoading" @click="run">Run preview</Button>
        </div>
      </template>

      <div v-if="isLoading" class="flex justify-center py-6"><Spinner /></div>

      <template v-else-if="result">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            Preview for {{ result.device?.displayName || "sample device" }}
          </p>
          <button class="text-xs font-medium text-brand-600 dark:text-brand-400" @click="changeDevice">Change device</button>
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">{{ result.note }}</p>

        <div class="space-y-2">
          <div v-for="(s, i) in result.steps" :key="s.stepId" class="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <div class="flex items-start gap-2.5">
              <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{{ i + 1 }}</span>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-gray-900 dark:text-white text-sm">{{ s.name }} <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">{{ s.type }}</span></p>
                <p class="text-sm text-gray-600 dark:text-gray-300 mt-1">{{ s.summary }}</p>
                <p class="text-xs mt-1.5 flex items-center gap-1" style="color: #22c55e">
                  <component :is="ICONS.AltArrowRight" :size="11" weight="Linear" /> On success → {{ s.onSuccessLabel }}
                </p>
                <p class="text-xs mt-0.5 flex items-center gap-1" style="color: #ef4444">
                  <component :is="ICONS.AltArrowRight" :size="11" weight="Linear" /> On failure → {{ s.onFailureLabel }}
                </p>
              </div>
            </div>
          </div>
          <p v-if="result.steps.length === 0" class="text-xs text-gray-400">This workflow has no steps.</p>
        </div>

        <template v-if="result.recoverySteps?.length">
          <p class="text-xs font-semibold text-gray-700 dark:text-gray-200 pt-2 border-t border-gray-200 dark:border-gray-700">Recovery steps (run once compliance is restored)</p>
          <div class="space-y-2">
            <div v-for="(s, i) in result.recoverySteps" :key="s.stepId" class="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <div class="flex items-start gap-2.5">
                <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{{ i + 1 }}</span>
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-gray-900 dark:text-white text-sm">{{ s.name }} <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">{{ s.type }}</span></p>
                  <p class="text-sm text-gray-600 dark:text-gray-300 mt-1">{{ s.summary }}</p>
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>
    </div>
  </Modal>
</template>
