<script setup lang="ts">
// Dry-run preview — safe, read-only walk of a workflow's step chain against
// either a sample device or a real one picked from the fleet. Mirrors the
// backend's own "always assume success" simplification (main.py:6374).
import { Alert, Input, Modal, Spinner } from "@applivery/bluesky-vue";
import { onMounted, ref, watch } from "vue";
import { useDevicesStore } from "../../stores/devices";
import { useWorkflowsStore, type DryRunResult, type Workflow } from "../../stores/workflows";

const props = defineProps<{ open: boolean; workflow: Workflow | null }>();
const emit = defineEmits<{ close: [] }>();

const store = useWorkflowsStore();
const devicesStore = useDevicesStore();

const selectedDeviceId = ref("");
const result = ref<DryRunResult | null>(null);
const isLoading = ref(false);
const loadError = ref<string | null>(null);

onMounted(async () => {
  if (devicesStore.devices.length === 0) await devicesStore.fetchDevices();
});

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

watch(() => props.open, (open) => {
  if (open) {
    selectedDeviceId.value = "";
    result.value = null;
    loadError.value = null;
    void run();
  }
});
</script>

<template>
  <Modal :open="open" :title="workflow ? `Dry run — ${workflow.name}` : 'Dry run'" size="lg" @close="emit('close')">
    <div class="space-y-4">
      <Input
        v-model="selectedDeviceId"
        type="select"
        :options="[{ value: '', label: 'Sample device (no real device picked)' }, ...devicesStore.devices.map((d) => ({ value: d.id, label: d.displayName }))]"
        label="Preview against"
        @update:model-value="run"
      />

      <Alert v-if="loadError" type="danger">{{ loadError }}</Alert>
      <div v-if="isLoading" class="flex justify-center py-6"><Spinner /></div>

      <template v-else-if="result">
        <p class="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{{ result.note }}</p>
        <div class="space-y-2">
          <div v-for="s in result.steps" :key="s.stepId" class="border border-gray-200 rounded-lg p-3">
            <div class="flex items-center justify-between">
              <p class="font-medium text-gray-900 text-sm">{{ s.name }} <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{{ s.type }}</span></p>
            </div>
            <p class="text-sm text-gray-600 mt-1">{{ s.summary }}</p>
            <p class="text-xs text-gray-400 mt-1">On success → {{ s.onSuccessLabel }} · On failure → {{ s.onFailureLabel }}</p>
          </div>
          <p v-if="result.steps.length === 0" class="text-xs text-gray-400">This workflow has no steps.</p>
        </div>

        <template v-if="result.recoverySteps?.length">
          <p class="text-xs font-semibold text-gray-700 pt-2 border-t border-gray-200">Recovery steps</p>
          <div class="space-y-2">
            <div v-for="s in result.recoverySteps" :key="s.stepId" class="border border-gray-200 rounded-lg p-3">
              <p class="font-medium text-gray-900 text-sm">{{ s.name }} <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{{ s.type }}</span></p>
              <p class="text-sm text-gray-600 mt-1">{{ s.summary }}</p>
            </div>
          </div>
        </template>
      </template>
    </div>
  </Modal>
</template>
