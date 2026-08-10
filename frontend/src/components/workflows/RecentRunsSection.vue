<script setup lang="ts">
// "Recent runs" — lives inline below the workflow list on the Workflows
// tab in the original (WorkflowsView.jsx:250-330), not a separate tab.
// Date-range filter + Export CSV above the list; clicking a row opens
// RunResultModal; "Show more" grows the limit by 20.
import { onMounted, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useWorkflowsStore, type WorkflowRun } from "../../stores/workflows";
import RunResultModal from "./RunResultModal.vue";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const DANGER = "#EF4444";
const WARNING = "#F59E0B";

const store = useWorkflowsStore();

const runsLimit = ref(10);
const dateFrom = ref("");
const dateTo = ref("");
const openRun = ref<WorkflowRun | null>(null);
const resultOpen = ref(false);

async function refresh(limit?: number) {
  runsLimit.value = limit ?? runsLimit.value;
  await store.fetchRuns(runsLimit.value, dateFrom.value || undefined, dateTo.value || undefined);
}

onMounted(() => refresh());

function loadMore() {
  refresh(runsLimit.value + 20);
}

function runStatusMeta(run: WorkflowRun) {
  if (run.status === "running") return { color: PRIMARY_BLUE, icon: "Refresh" as const, label: `Running ${run.completed ?? 0}/${run.total ?? "?"}`, spin: true };
  if (run.status === "waiting") return { color: PRIMARY_BLUE, icon: "ClockCircle" as const, label: `Waiting ${run.completed ?? 0}/${run.total ?? "?"}`, spin: false };
  const statuses = (run.results || []).map((r) => r.finalStatus);
  if (statuses.length && statuses.every((s) => s === "success")) return { color: SUCCESS, icon: "CheckCircle" as const, label: "Completed", spin: false };
  if (statuses.some((s) => s === "success" || s === "partial")) return { color: WARNING, icon: "MinusCircle" as const, label: "Partial", spin: false };
  return { color: DANGER, icon: "CloseCircle" as const, label: "Failed", spin: false };
}

function openResult(run: WorkflowRun) {
  openRun.value = run;
  resultOpen.value = true;
}

async function exportCsv() {
  try {
    await store.exportRunsCsv(dateFrom.value || undefined, dateTo.value || undefined);
  } catch {
    alert("Failed to export workflow runs.");
  }
}
</script>

<template>
  <div class="mt-8">
    <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
      <div class="flex items-center gap-2">
        <component :is="ICONS.History" :size="14" weight="Linear" class="text-gray-400" />
        <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">Recent runs</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <input v-model="dateFrom" type="date" class="px-2 py-1 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500" @change="refresh()" />
        <span class="text-xs text-gray-400">to</span>
        <input v-model="dateTo" type="date" class="px-2 py-1 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500" @change="refresh()" />
        <button class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="exportCsv">
          <component :is="ICONS.Download" :size="12" weight="Linear" /> Export CSV
        </button>
      </div>
    </div>

    <p v-if="store.runs.length === 0" class="text-xs py-4 text-gray-400">No runs in this range yet.</p>
    <template v-else>
      <div class="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
        <button
          v-for="(run, i) in store.runs"
          :key="run.id"
          class="w-full flex items-center gap-3 px-4 py-3 text-left bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          :class="i > 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''"
          @click="openResult(run)"
        >
          <component :is="ICONS[runStatusMeta(run).icon]" :size="14" weight="Linear" :class="runStatusMeta(run).spin ? 'animate-spin' : ''" :style="{ color: runStatusMeta(run).color }" />
          <div class="min-w-0">
            <span class="text-sm font-medium truncate block text-gray-900 dark:text-white">{{ run.workflowName || "Workflow" }}</span>
            <span v-if="run.targetDescription" class="text-[11px] truncate block text-gray-400">{{ run.targetDescription }}</span>
          </div>
          <span class="text-xs shrink-0 ml-auto text-gray-400">{{ run.total ?? run.results?.length ?? 0 }} device{{ (run.total ?? run.results?.length) === 1 ? "" : "s" }}</span>
          <span class="text-xs shrink-0" :style="{ color: runStatusMeta(run).color }">{{ runStatusMeta(run).label }}</span>
        </button>
      </div>
      <button v-if="store.runs.length < store.runsTotal" class="mt-3 w-full py-2 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="loadMore">Show more</button>
    </template>

    <RunResultModal :open="resultOpen" :run="openRun" @close="resultOpen = false" @complete="refresh()" />
  </div>
</template>
