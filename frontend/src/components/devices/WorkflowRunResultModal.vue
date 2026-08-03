<script setup lang="ts">
// Port of WorkflowRunResultModal (WorkflowRunModals.jsx:293-390) — polls
// GET /api/workflows/runs/{id} (via the workflows store's fetchRun) while
// the run is 'running' or 'waiting' (durable 'wait' steps can park a device
// for hours/days, surviving an API restart). Safe to close early; the run
// keeps going server-side and shows up under Workflows > Recent runs.
import { Modal } from "@applivery/bluesky-vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useWorkflowsStore, type WorkflowDeviceResult, type WorkflowRun } from "../../stores/workflows";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";

const props = defineProps<{ open: boolean; run: WorkflowRun | null }>();
const emit = defineEmits<{ close: []; complete: [run: WorkflowRun] }>();

const store = useWorkflowsStore();
const run = ref<WorkflowRun | null>(props.run);
const notified = ref(false);
let interval: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

function startPolling() {
  stopPolling();
  if (!run.value || (run.value.status !== "running" && run.value.status !== "waiting")) return;
  interval = setInterval(async () => {
    if (!run.value) return;
    try {
      const fresh = await store.fetchRun(run.value.id);
      run.value = fresh;
      if (fresh.status !== "running" && fresh.status !== "waiting" && !notified.value) {
        notified.value = true;
        emit("complete", fresh);
        stopPolling();
      }
    } catch {
      // transient poll failure — try again on the next tick
    }
  }, 1500);
}

watch(
  () => props.run,
  (next) => {
    run.value = next;
    notified.value = false;
    startPolling();
  },
  { immediate: true },
);

onBeforeUnmount(stopPolling);

function statusMeta(status: string) {
  if (status === "success") return { color: SUCCESS, icon: ICONS.CheckCircle, label: "Success" };
  if (status === "partial") return { color: WARNING, icon: ICONS.MinusCircle, label: "Partial" };
  return { color: DANGER, icon: ICONS.CloseCircle, label: "Failed" };
}

function deviceStatusMeta(result: WorkflowDeviceResult & { status?: string }) {
  if (result.status === "waiting") return { color: PRIMARY_BLUE, icon: ICONS.ClockCircle, label: "Waiting" };
  return statusMeta(result.finalStatus);
}

const isRunning = computed(() => run.value?.status === "running");
const isWaiting = computed(() => run.value?.status === "waiting");
const total = computed(() => run.value?.total ?? run.value?.results.length ?? 0);
const completed = computed(() => run.value?.completed ?? run.value?.results.length ?? 0);
const waitingCount = computed(() => (run.value?.results ?? []).filter((r: any) => r.status === "waiting").length);
const pct = computed(() => (total.value > 0 ? Math.round((completed.value / total.value) * 100) : 100));
</script>

<template>
  <Modal :open="open && !!run" :title="`Run result — ${run?.workflowName || 'Workflow'}`" size="lg" @close="emit('close')">
    <div v-if="run">
      <p v-if="run.targetDescription" class="text-xs mb-3 text-gray-400">
        Target: <span class="text-gray-700 dark:text-gray-200">{{ run.targetDescription }}</span>
      </p>

      <div v-if="isRunning || isWaiting" class="mb-4">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs font-medium" :style="{ color: PRIMARY_BLUE }">
            {{ isWaiting ? `Waiting on ${waitingCount} device${waitingCount === 1 ? "" : "s"}… ${completed} of ${total} done` : `Running… ${completed} of ${total} devices` }}
          </span>
          <span class="text-xs text-gray-400">{{ pct }}%</span>
        </div>
        <div class="h-1.5 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
          <div class="h-full rounded-full transition-all duration-300" :style="{ width: `${pct}%`, backgroundColor: PRIMARY_BLUE }" />
        </div>
        <p class="text-[11px] mt-1.5 text-gray-400">
          {{
            isWaiting
              ? "These devices are paused at a wait step and will resume automatically on schedule — even if this server restarts. Safe to close and check back later."
              : "Safe to close this and come back later — the run keeps going and will show up under Recent runs."
          }}
        </p>
      </div>

      <div class="space-y-3 max-h-[50vh] overflow-y-auto">
        <div v-for="r in run.results" :key="r.deviceId" class="rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ r.deviceName || r.deviceId }}</span>
            <span class="inline-flex items-center gap-1.5 text-xs font-medium" :style="{ color: deviceStatusMeta(r).color }">
              <component :is="deviceStatusMeta(r).icon" :size="13" weight="Linear" />
              {{ deviceStatusMeta(r).label }}
            </span>
          </div>
          <div class="space-y-1">
            <div v-for="(s, i) in r.steps" :key="i" class="flex items-center gap-2 text-xs">
              <component :is="s.ok ? ICONS.CheckCircle : ICONS.CloseCircle" :size="12" weight="Linear" :style="{ color: s.ok ? SUCCESS : DANGER }" />
              <span v-if="s.phase === 'recovery'" class="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">
                Recovery
              </span>
              <span class="text-gray-900 dark:text-white">{{ s.name || s.type }}</span>
              <span class="ml-auto truncate max-w-[220px] text-gray-400">{{ s.detail }}</span>
            </div>
            <p v-if="r.steps.length === 0" class="text-xs text-gray-400">Workflow has no steps.</p>
          </div>
        </div>
        <p v-if="run.results.length === 0 && !isRunning && !isWaiting" class="text-xs text-center py-6 text-gray-400">No results.</p>
      </div>
    </div>
  </Modal>
</template>
