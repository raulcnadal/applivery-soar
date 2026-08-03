<script setup lang="ts">
// Run result — shared by "Recent runs" row clicks and by RunWorkflowDialog
// right after launch. Polls GET /api/workflows/runs/:id every 1.5s while
// still running/waiting (durable engine — a run parked on a Wait step can
// stay "waiting" for hours/days and survives an API restart). Port of
// WorkflowRunResultModal (WorkflowRunModals.jsx:243-380).
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Modal } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useWorkflowsStore, type WorkflowRun } from "../../stores/workflows";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";

const props = defineProps<{ open: boolean; run: WorkflowRun | null }>();
const emit = defineEmits<{ close: []; complete: [] }>();

const store = useWorkflowsStore();
const localRun = ref<WorkflowRun | null>(null);
let pollHandle: ReturnType<typeof setInterval> | null = null;
let notified = false;

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

function startPolling() {
  stopPolling();
  pollHandle = setInterval(async () => {
    if (!localRun.value) return;
    const updated = await store.fetchRun(localRun.value.id);
    localRun.value = updated;
    if (updated.status !== "running" && updated.status !== "waiting" && !notified) {
      notified = true;
      stopPolling();
      emit("complete");
    }
  }, 1500);
}

watch(
  () => [props.open, props.run],
  ([open]) => {
    stopPolling();
    notified = false;
    if (open && props.run) {
      localRun.value = props.run;
      if (localRun.value.status === "running" || localRun.value.status === "waiting") startPolling();
    }
  },
  { immediate: true },
);

onBeforeUnmount(stopPolling);

const isRunning = computed(() => localRun.value?.status === "running");
const isWaiting = computed(() => localRun.value?.status === "waiting");
const total = computed(() => localRun.value?.total ?? localRun.value?.results.length ?? 0);
const completed = computed(() => localRun.value?.completed ?? localRun.value?.results.length ?? 0);
const waitingCount = computed(() => localRun.value?.results.filter((r) => (r as any).status === "waiting").length ?? 0);
const pct = computed(() => (total.value > 0 ? Math.round((completed.value / total.value) * 100) : 100));

function deviceStatusMeta(r: any) {
  if (r.status === "waiting") return { color: PRIMARY_BLUE, icon: "ClockCircle" as const, label: "Waiting" };
  if (r.finalStatus === "success") return { color: SUCCESS, icon: "CheckCircle" as const, label: "Success" };
  if (r.finalStatus === "partial") return { color: WARNING, icon: "MinusCircle" as const, label: "Partial" };
  return { color: DANGER, icon: "CloseCircle" as const, label: "Failed" };
}
</script>

<template>
  <Modal :open="open" :title="`Run result — ${localRun?.workflowName ?? 'Workflow'}`" size="lg" @close="emit('close')">
    <div v-if="localRun" class="space-y-4">
      <p v-if="localRun.targetDescription" class="text-xs text-gray-400">Target: <span class="text-gray-900">{{ localRun.targetDescription }}</span></p>

      <div v-if="isRunning || isWaiting">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs font-medium" :style="{ color: PRIMARY_BLUE }">
            {{ isWaiting ? `Waiting on ${waitingCount} device${waitingCount === 1 ? "" : "s"} — ${completed} of ${total} done` : `Running… ${completed} of ${total} devices` }}
          </span>
          <span class="text-xs text-gray-400">{{ pct }}%</span>
        </div>
        <div class="h-1.5 rounded-full overflow-hidden bg-gray-100">
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

      <div class="space-y-3">
        <div v-for="r in localRun.results" :key="r.deviceId" class="rounded-lg p-3 border border-gray-200">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-semibold text-gray-900">{{ r.deviceName || r.deviceId }}</span>
            <span class="inline-flex items-center gap-1.5 text-xs font-medium" :style="{ color: deviceStatusMeta(r).color }">
              <component :is="ICONS[deviceStatusMeta(r).icon]" :size="13" weight="Linear" /> {{ deviceStatusMeta(r).label }}
            </span>
          </div>
          <div class="space-y-1">
            <div v-for="(s, i) in r.steps" :key="i" class="flex items-center gap-2 text-xs">
              <component :is="s.ok ? ICONS.CheckCircle : ICONS.CloseCircle" :size="12" weight="Linear" :style="{ color: s.ok ? SUCCESS : DANGER }" />
              <span v-if="s.phase === 'recovery'" class="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">Recovery</span>
              <span class="text-gray-900">{{ s.name || s.type }}</span>
              <span class="ml-auto truncate max-w-[220px] text-gray-400">{{ s.detail }}</span>
            </div>
            <p v-if="r.steps.length === 0" class="text-xs text-gray-400">Workflow has no steps.</p>
          </div>
        </div>
        <p v-if="localRun.results.length === 0 && !isRunning && !isWaiting" class="text-xs text-center py-6 text-gray-400">No results.</p>
      </div>
    </div>
  </Modal>
</template>
