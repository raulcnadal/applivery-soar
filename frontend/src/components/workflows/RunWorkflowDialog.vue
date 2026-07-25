<script setup lang="ts">
// Manual "Run workflow" — pick target devices, launch, then poll the run
// until it completes (mirrors the frontend polling GET /workflows/runs/{id}
// described in main.py's execution-engine comment).
import { Alert, Button, Input, Modal, Spinner, StatusPill } from "@applivery/bluesky-vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useDevicesStore } from "../../stores/devices";
import { useWorkflowsStore, type Workflow, type WorkflowRun } from "../../stores/workflows";

const props = defineProps<{ open: boolean; workflow: Workflow | null }>();
const emit = defineEmits<{ close: [] }>();

const store = useWorkflowsStore();
const devicesStore = useDevicesStore();

const selectedIds = ref<Set<string>>(new Set());
const targetDescription = ref("");
const isLaunching = ref(false);
const launchError = ref<string | null>(null);
const run = ref<WorkflowRun | null>(null);
let pollHandle: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  if (devicesStore.devices.length === 0) await devicesStore.fetchDevices();
});

const eligibleDevices = computed(() => {
  if (!props.workflow?.targetPlatform) return devicesStore.devices;
  return devicesStore.devices.filter((d) => d.platform === props.workflow!.targetPlatform);
});

function toggleDevice(id: string) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id);
  else selectedIds.value.add(id);
}

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

async function launch() {
  if (!props.workflow || selectedIds.value.size === 0) return;
  isLaunching.value = true;
  launchError.value = null;
  try {
    const devices = Array.from(selectedIds.value)
      .map((id) => devicesStore.devices.find((d) => d.id === id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
      .map((d) => ({ id: d.id, displayName: d.displayName, platform: d.platform, platformDeviceId: d.platformDeviceId, serialNumber: d.serialNumber, osVersion: d.osVersion, manufacturer: d.manufacturer, model: d.model }));
    run.value = await store.runWorkflow(props.workflow.id, devices, targetDescription.value || null);
    pollHandle = setInterval(async () => {
      if (!run.value) return;
      const updated = await store.fetchRun(run.value.id);
      run.value = updated;
      if (updated.status === "completed") stopPolling();
    }, 2000);
  } catch (err: any) {
    launchError.value = err?.response?.data?.detail || "Failed to launch workflow run.";
  } finally {
    isLaunching.value = false;
  }
}

function reset() {
  stopPolling();
  selectedIds.value = new Set();
  targetDescription.value = "";
  run.value = null;
  launchError.value = null;
}

watch(() => props.open, (open) => {
  if (open) reset();
  else stopPolling();
});

onBeforeUnmount(stopPolling);

const finalStatusColor: Record<string, "green" | "yellow" | "red"> = { success: "green", partial: "yellow", failed: "red" };
</script>

<template>
  <Modal :open="open" :title="workflow ? `Run — ${workflow.name}` : 'Run workflow'" size="lg" @close="emit('close')">
    <div class="space-y-4">
      <Alert v-if="launchError" type="danger">{{ launchError }}</Alert>

      <template v-if="!run">
        <Input v-model="targetDescription" label="Target description (optional — shown in the run history)" placeholder="e.g. Device Audience: EU Finance Laptops" />
        <div>
          <p class="text-sm font-medium text-gray-700 mb-2">Target devices ({{ selectedIds.size }} selected)</p>
          <div class="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
            <label v-for="d in eligibleDevices" :key="d.id" class="flex items-center gap-2 px-3 py-2 text-sm">
              <input type="checkbox" :checked="selectedIds.has(d.id)" @change="toggleDevice(d.id)" />
              {{ d.displayName }} <span class="text-xs text-gray-400">({{ d.platformLabel }})</span>
            </label>
            <p v-if="eligibleDevices.length === 0" class="px-3 py-4 text-xs text-gray-400">No devices match this workflow's target platform.</p>
          </div>
        </div>
        <Button :loading="isLaunching" :disabled="selectedIds.size === 0" @click="launch">Run on {{ selectedIds.size }} device{{ selectedIds.size === 1 ? "" : "s" }}</Button>
      </template>

      <template v-else>
        <div class="flex items-center justify-between">
          <StatusPill :label="run.status" :color="run.status === 'completed' ? 'green' : 'yellow'" />
          <p class="text-sm text-gray-500">{{ run.completed }} / {{ run.total }} devices done</p>
        </div>
        <div v-if="run.status !== 'completed'" class="flex items-center gap-2 text-sm text-gray-500"><Spinner size="sm" /> Running…</div>
        <div class="space-y-2">
          <div v-for="r in run.results" :key="r.deviceId" class="border border-gray-200 rounded-lg p-3">
            <div class="flex items-center justify-between">
              <p class="font-medium text-gray-900 text-sm">{{ r.deviceName || r.deviceId }}</p>
              <StatusPill :label="r.finalStatus" :color="finalStatusColor[r.finalStatus] ?? 'gray'" />
            </div>
            <div class="mt-2 space-y-1">
              <p v-for="(s, i) in r.steps" :key="i" class="text-xs" :class="s.ok ? 'text-gray-600' : 'text-red-600'">
                {{ s.ok ? "✓" : "✗" }} {{ s.name }} <span class="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-500">{{ s.type }}</span> — {{ s.detail }}
              </p>
            </div>
          </div>
        </div>
      </template>
    </div>
  </Modal>
</template>
