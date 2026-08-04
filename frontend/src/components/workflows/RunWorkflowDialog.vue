<script setup lang="ts">
// Manual "Run workflow" — device picker with 3 modes (Pick devices / By
// Device Audience / By Tag), then launches and hands off to RunResultModal.
// Port of DevicePickerModal (WorkflowRunModals.jsx:29-238).
import { computed, onMounted, ref, watch } from "vue";
import { Alert, Modal } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useDevicesStore } from "../../stores/devices";
import { useWorkflowsStore, type Workflow, type WorkflowRun } from "../../stores/workflows";
import RunResultModal from "./RunResultModal.vue";

const props = defineProps<{ open: boolean; workflow: Workflow | null }>();
const emit = defineEmits<{ close: [] }>();

const store = useWorkflowsStore();
const devicesStore = useDevicesStore();

const PICKER_MODES: Array<{ id: "manual" | "audience" | "tag"; label: string }> = [
  { id: "manual", label: "Pick devices" },
  { id: "audience", label: "By Device Audience" },
  { id: "tag", label: "By Tag" },
];

const mode = ref<"manual" | "audience" | "tag">("manual");
const search = ref("");
const selectedIds = ref<Set<string>>(new Set());
const audienceId = ref("");
const tag = ref("");
const isLaunching = ref(false);
const launchError = ref<string | null>(null);
const runResult = ref<WorkflowRun | null>(null);
const resultOpen = ref(false);

onMounted(async () => {
  if (devicesStore.devices.length === 0) await devicesStore.fetchDevices();
  if (devicesStore.deviceAudiences.length === 0) await devicesStore.fetchPickers();
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    mode.value = "manual";
    search.value = "";
    selectedIds.value = new Set();
    audienceId.value = "";
    tag.value = "";
    launchError.value = null;
  },
);

// Port of DevicePickerModal (WorkflowRunModals.jsx:29-238) — it takes no
// `workflow` prop at all, so there's no target-platform filtering here;
// every device in the fleet is selectable regardless of the workflow's
// target platform.
const filtered = computed(() => devicesStore.devices.filter((d) => d.displayName.toLowerCase().includes(search.value.toLowerCase())));

const availableTags = computed(() => {
  const set = new Set<string>();
  devicesStore.devices.forEach((d) => (d.tags || []).forEach((t) => set.add(t)));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
});

const audienceMatches = computed(() => {
  if (!audienceId.value) return [];
  return devicesStore.devices.filter((d) => (d.deviceAudiences || []).some((a) => String(a.id) === String(audienceId.value)));
});
const tagMatches = computed(() => {
  if (!tag.value) return [];
  return devicesStore.devices.filter((d) => (d.tags || []).includes(tag.value));
});

function toggleDevice(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

function changeMode(next: "manual" | "audience" | "tag") {
  mode.value = next;
  selectedIds.value = new Set();
  audienceId.value = "";
  tag.value = "";
}

const bulkMatches = computed(() => (mode.value === "audience" ? audienceMatches.value : mode.value === "tag" ? tagMatches.value : null));
const confirmCount = computed(() => (mode.value === "manual" ? selectedIds.value.size : bulkMatches.value?.length ?? 0));
const confirmDisabled = computed(() => {
  if (mode.value === "manual") return selectedIds.value.size === 0;
  const pickedScope = mode.value === "audience" ? !!audienceId.value : !!tag.value;
  return !pickedScope || confirmCount.value === 0;
});

async function launch() {
  if (!props.workflow) return;
  let targets: typeof devicesStore.devices = [];
  let targetDescription: string | null = null;
  if (mode.value === "audience") {
    targets = audienceMatches.value;
    const name = devicesStore.deviceAudiences.find((a) => String(a.id) === String(audienceId.value))?.name || audienceId.value;
    targetDescription = `Device Audience: ${name}`;
  } else if (mode.value === "tag") {
    targets = tagMatches.value;
    targetDescription = `Tag: ${tag.value}`;
  } else {
    targets = devicesStore.devices.filter((d) => selectedIds.value.has(d.id));
  }
  if (targets.length === 0) return;
  isLaunching.value = true;
  launchError.value = null;
  try {
    const devices = targets.map((d) => ({
      id: d.id, displayName: d.displayName, platform: d.platform, platformDeviceId: d.platformDeviceId,
      serialNumber: d.serialNumber, osVersion: d.osVersion, manufacturer: d.manufacturer, model: d.model,
    }));
    runResult.value = await store.runWorkflow(props.workflow.id, devices, targetDescription);
    resultOpen.value = true;
    emit("close");
  } catch (err: any) {
    launchError.value = err?.response?.data?.detail || "Failed to run workflow.";
  } finally {
    isLaunching.value = false;
  }
}
</script>

<template>
  <Modal :open="open" title="Select target devices" size="lg" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="launchError" type="danger">{{ launchError }}</Alert>

      <div class="flex items-center gap-1 p-1 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
        <button
          v-for="m in PICKER_MODES"
          :key="m.id"
          class="flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors"
          :class="mode === m.id ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
          @click="changeMode(m.id)"
        >
          {{ m.label }}
        </button>
      </div>

      <div v-if="mode === 'manual'">
        <div class="relative mb-2">
          <component :is="ICONS.Magnifer" :size="14" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input v-model="search" placeholder="Search devices…" class="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500" />
        </div>
        <div class="space-y-1 max-h-64 overflow-y-auto">
          <label v-for="d in filtered" :key="d.id" class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer" :class="selectedIds.has(d.id) ? 'bg-gray-50 dark:bg-gray-900/50' : ''">
            <input type="checkbox" :checked="selectedIds.has(d.id)" @change="toggleDevice(d.id)" />
            <component :is="ICONS.Smartphone" :size="13" weight="Linear" class="text-gray-400" />
            <span class="text-gray-900 dark:text-white">{{ d.displayName }}</span>
            <span class="ml-auto text-[10px] text-gray-400">{{ d.platformLabel }}</span>
          </label>
          <p v-if="filtered.length === 0" class="text-xs text-center py-6 text-gray-400">No devices match "{{ search }}"</p>
        </div>
      </div>

      <div v-else-if="mode === 'audience'">
        <select v-model="audienceId" class="w-full px-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white mb-3 focus:ring-2 focus:ring-brand-500">
          <option value="">Choose a Device Audience…</option>
          <option v-for="a in devicesStore.deviceAudiences" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <p v-if="devicesStore.deviceAudiences.length === 0" class="text-xs mb-3 text-gray-400">No Device Audiences found for this workspace.</p>
        <div v-if="audienceId" class="max-h-64 overflow-y-auto space-y-1">
          <div v-for="d in audienceMatches" :key="d.id" class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-gray-400">
            <component :is="ICONS.Smartphone" :size="13" weight="Linear" />
            <span class="text-gray-900 dark:text-white">{{ d.displayName }}</span>
            <span class="ml-auto text-[10px]">{{ d.platformLabel }}</span>
          </div>
          <p v-if="audienceMatches.length === 0" class="text-xs text-center py-6 text-gray-400">No devices currently belong to this audience.</p>
        </div>
      </div>

      <div v-else>
        <select v-model="tag" class="w-full px-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white mb-3 focus:ring-2 focus:ring-brand-500">
          <option value="">Choose a tag…</option>
          <option v-for="t in availableTags" :key="t" :value="t">{{ t }}</option>
        </select>
        <p v-if="availableTags.length === 0" class="text-xs mb-3 text-gray-400">No tags found on any device in the fleet.</p>
        <div v-if="tag" class="max-h-64 overflow-y-auto space-y-1">
          <div v-for="d in tagMatches" :key="d.id" class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-gray-400">
            <component :is="ICONS.Smartphone" :size="13" weight="Linear" />
            <span class="text-gray-900 dark:text-white">{{ d.displayName }}</span>
            <span class="ml-auto text-[10px]">{{ d.platformLabel }}</span>
          </div>
          <p v-if="tagMatches.length === 0" class="text-xs text-center py-6 text-gray-400">No devices currently carry this tag.</p>
        </div>
      </div>

      <div class="flex items-center gap-3 justify-end pt-2">
        <span class="text-xs mr-auto text-gray-400">{{ confirmCount }} selected</span>
        <button class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="emit('close')">Cancel</button>
        <button
          :disabled="confirmDisabled || isLaunching"
          class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50"
          @click="launch"
        >
          {{ isLaunching ? "Starting…" : `Run on ${confirmCount || ""} device${confirmCount === 1 ? "" : "s"}` }}
        </button>
      </div>
    </div>
  </Modal>

  <RunResultModal :open="resultOpen" :run="runResult" @close="resultOpen = false" />
</template>
