<script setup lang="ts">
// Reporting — Builder / Schedules / Template. Port of App.jsx's Reporting
// view (App.jsx:2940-3100 state, 4890-5274 render, 6404-6430 Template
// modal) plus POST /api/reports/generate (main.py:892-901, 15608-15779,
// 16048-16159).
//
// Structural note: "Builder" used to be its own CTA-card sub-view that just
// opened the Report Builder Modal — removed per user request as pure
// duplication of the "Create Report" header button, which opens the exact
// same modal with one click and no extra navigation. Schedules is now the
// only real view; "Template" is still not a real persistent tab — selecting
// it just opens the Template modal, same as before.
import { computed, onMounted, ref } from "vue";
import { ICONS } from "../lib/solarIcons";
import HelpIcon from "../components/shared/HelpIcon.vue";
import ReportBuilderModal from "../components/reporting/ReportBuilderModal.vue";
import ReportTemplateModal from "../components/reporting/ReportTemplateModal.vue";
import { useBreakpoint } from "../composables/useBreakpoint";
import { useAuthStore } from "../stores/auth";
import { useDashboardStateStore, type ScheduledReport } from "../stores/dashboardState";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const DANGER = "#EF4444";

const store = useDashboardStateStore();
const auth = useAuthStore();
const { isMobile } = useBreakpoint();

const REPORTING_TAB_ANCHORS: Record<string, string> = { scheduled: "schedules-tab", template: "template-tab" };
const helpAnchor = computed(() => REPORTING_TAB_ANCHORS[templateOpen.value ? "template" : "scheduled"] ?? null);

function openTemplate() {
  templateOpen.value = true;
}

onMounted(async () => {
  if (!store.isLoaded) await store.fetchState();
});

// ── Builder modal (new / edit) ──
const builderOpen = ref(false);
const editingReport = ref<ScheduledReport | null>(null);
function openNewReport() {
  editingReport.value = null;
  builderOpen.value = true;
}
function openEditReport(rep: ScheduledReport) {
  editingReport.value = rep;
  builderOpen.value = true;
}

// ── Template modal ──
const templateOpen = ref(false);

// ── Schedules — restyled to match DeviceFleetTable.vue's list experience
// (Devices main view): a toolbar with a search box + frequency filter, a
// sortable-column table on desktop, and a stacked card list on narrow
// screens (<768px, via useBreakpoint) — same split the Compliance/Workflows
// list tables now use. ──
const FREQUENCY_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly (Mon)", monthly: "Monthly (1st)" };
const runningId = ref<string | null>(null);
const scheduleError = ref<string | null>(null);

const scheduleSearch = ref("");
const frequencyFilter = ref<"all" | "daily" | "weekly" | "monthly">("all");

const filteredSchedules = computed(() => {
  const term = scheduleSearch.value.trim().toLowerCase();
  return store.scheduledReports.filter((r) => {
    if (frequencyFilter.value !== "all" && r.schedule.frequency !== frequencyFilter.value) return false;
    if (!term) return true;
    return (r.name || "").toLowerCase().includes(term) || (r.emailRecipients || "").toLowerCase().includes(term);
  });
});

type ScheduleSortKey = "name" | "frequency" | "sources";
const scheduleSortBy = ref<ScheduleSortKey | null>(null);
const scheduleSortDir = ref<"asc" | "desc">("asc");

const sortedSchedules = computed(() => {
  if (!scheduleSortBy.value) return filteredSchedules.value;
  const key = scheduleSortBy.value;
  const dir = scheduleSortDir.value === "asc" ? 1 : -1;
  const copy = [...filteredSchedules.value];
  copy.sort((a, b) => {
    switch (key) {
      case "name":
        return dir * (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase());
      case "frequency":
        return dir * (FREQUENCY_LABEL[a.schedule.frequency] || "").localeCompare(FREQUENCY_LABEL[b.schedule.frequency] || "");
      case "sources":
        return dir * ((a.sources?.length || 0) - (b.sources?.length || 0));
      default:
        return 0;
    }
  });
  return copy;
});

function toggleScheduleSort(key: ScheduleSortKey) {
  if (scheduleSortBy.value !== key) {
    scheduleSortBy.value = key;
    scheduleSortDir.value = "asc";
  } else if (scheduleSortDir.value === "asc") {
    scheduleSortDir.value = "desc";
  } else {
    scheduleSortBy.value = null;
  }
}

const SCHEDULE_COLUMNS: Array<{ key: ScheduleSortKey; label: string }> = [
  { key: "name", label: "Report" },
  { key: "frequency", label: "Frequency" },
  { key: "sources", label: "Sources" },
];

async function deleteSchedule(id: string, name: string) {
  if (!window.confirm(`Delete "${name || "this schedule"}"?`)) return;
  await store.saveScheduledReports(store.scheduledReports.filter((r) => r.id !== id));
}

// Run now always downloads a PDF regardless of that schedule's own
// "Download PDF directly" delivery setting (docs/reporting.md, App.jsx
// Schedules tab Run-now handler) — chat/email delivery still follow the
// schedule's own settings.
async function runNow(rep: ScheduledReport) {
  runningId.value = rep.id;
  scheduleError.value = null;
  try {
    const { api } = await import("../api/http");
    const res = await api.post(
      "/reports/generate",
      {
        workspace: rep.workspaceSlug || auth.orgSlug,
        sources: rep.sources,
        timeLapse: rep.timeLapse,
        filters: rep.filters,
        display: rep.display,
        webhookUrl: rep.delivery.chat ? store.webhookUrl : null,
        emailRecipients: rep.delivery.email ? rep.emailRecipients : null,
        smtp: rep.delivery.email ? store.smtpConfig : null,
      },
      { responseType: "blob" },
    );
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Applivery_Report_${rep.workspaceSlug || auth.orgSlug}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err: any) {
    scheduleError.value = err?.response?.data?.detail || "Failed to run report.";
  } finally {
    runningId.value = null;
  }
}
</script>

<template>
  <main class="p-4 md:p-8 pb-16">
    <header class="flex justify-between items-start mb-8 gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold leading-tight text-gray-900 dark:text-white">Reporting</h1>
          <HelpIcon slug="reporting" :anchor="helpAnchor" title="Reporting admin guide" />
        </div>
        <p class="text-sm mt-1 text-gray-400">Build, schedule, and manage automated reports.</p>
      </div>
      <!-- Create Report — same blue pill-button styling as Compliance's
           "Create Compliance Policy" and Workflows' "Create Workflow",
           placed to the left of the sub-view switcher, per user request.
           Replaces the old full-width "Add Another Schedule" button that
           used to sit below the schedules list. -->
      <div class="flex flex-wrap items-center gap-2 shrink-0 ml-auto w-full sm:w-auto">
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 shrink-0"
          @click="openNewReport"
        >
          <component :is="ICONS.AddSquare" :size="15" weight="Linear" /> Create Report
        </button>
        <div class="flex items-center gap-1 p-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 shrink-0 max-w-full overflow-x-auto">
          <span class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm">
            <component :is="ICONS.Calendar" :size="14" weight="Linear" /> Schedules ({{ store.scheduledReports.length }})
          </span>
          <button class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap text-gray-400 transition-all" @click="openTemplate">
            <component :is="ICONS.CodeFile" :size="14" weight="Linear" /> Template
          </button>
        </div>
      </div>
    </header>

    <div v-if="store.error || scheduleError" class="mb-4 px-3 py-2 rounded-lg text-sm" :style="{ backgroundColor: `${DANGER}10`, color: DANGER }">
      {{ store.error || scheduleError }}
    </div>

    <!-- Schedules — the only real sub-view now that Builder (a redundant CTA
         card for the same modal the header's Create Report button already
         opens) has been removed. -->
    <div v-if="!store.scheduledReports.length" class="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <div class="w-14 h-14 rounded-2xl flex items-center justify-center" :style="{ backgroundColor: `${PRIMARY_BLUE}12` }">
        <component :is="ICONS.Calendar" :size="24" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
      </div>
      <div>
        <p class="text-sm font-medium text-gray-900 dark:text-white">No scheduled reports yet</p>
        <p class="text-xs mt-1 text-gray-400">Build a report and turn on Automation &amp; Scheduling to get here.</p>
      </div>
      <button class="px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity" style="background-color: #0055ff" @click="openNewReport">Create Report</button>
    </div>

    <div v-else class="rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
      <!-- Toolbar — matches DeviceFleetTable.vue's search+filter+count row -->
      <div class="p-4 flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3 border-b border-gray-200 dark:border-gray-700">
        <div class="relative flex-1 max-w-sm">
          <component :is="ICONS.Magnifer" :size="15" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
          <input
            v-model="scheduleSearch"
            type="text"
            placeholder="Search reports, recipients…"
            class="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
          />
        </div>
        <div class="inline-flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
          <button
            v-for="f in [{ key: 'all', label: 'All' }, { key: 'daily', label: 'Daily' }, { key: 'weekly', label: 'Weekly' }, { key: 'monthly', label: 'Monthly' }] as const"
            :key="f.key"
            class="px-3 py-2 text-xs font-medium transition-colors border-r border-gray-200 dark:border-gray-700 last:border-r-0"
            :class="frequencyFilter !== f.key ? 'bg-white dark:bg-gray-800' : ''"
            :style="{ backgroundColor: frequencyFilter === f.key ? PRIMARY_BLUE : undefined, color: frequencyFilter === f.key ? '#fff' : 'var(--foreground)' }"
            @click="frequencyFilter = f.key"
          >
            {{ f.label }}
          </button>
        </div>
        <span class="text-xs ml-auto shrink-0 text-gray-400">{{ filteredSchedules.length }} of {{ store.scheduledReports.length }}</span>
      </div>

      <div v-if="filteredSchedules.length === 0" class="flex flex-col items-center justify-center py-10 text-center">
        <p class="text-sm font-medium text-gray-900 dark:text-white">No schedules match your filters</p>
        <p class="text-xs mt-1 text-gray-400">Try adjusting your search or frequency filter.</p>
      </div>

      <!-- Mobile — stacked cards -->
      <div v-else-if="isMobile" class="divide-y divide-gray-100 dark:divide-gray-800">
        <div v-for="rep in sortedSchedules" :key="rep.id" class="p-4 flex items-start gap-3">
          <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">
            <component :is="ICONS.Calendar" :size="16" weight="Linear" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-1 flex-wrap">
              <span class="font-semibold text-sm text-gray-900 dark:text-white">{{ rep.name || "Unnamed Report" }}</span>
              <span class="text-[10px] font-light px-2.5 py-0.5 rounded-full border border-current/25 shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">
                {{ FREQUENCY_LABEL[rep.schedule.frequency] || "Weekly (Mon)" }}
              </span>
            </div>
            <div class="text-xs space-y-0.5 text-gray-400">
              <div>at {{ rep.schedule.time || "09:00" }} ({{ rep.schedule.timezone || "UTC" }})</div>
              <div>{{ rep.sources.length }} data source{{ rep.sources.length !== 1 ? "s" : "" }} · {{ rep.timeLapse }}</div>
              <div v-if="rep.delivery.email && rep.emailRecipients" class="truncate">
                <component :is="ICONS.Letter" :size="11" weight="Linear" class="inline -mt-0.5" /> {{ rep.emailRecipients }}
              </div>
            </div>
            <div class="flex items-center gap-2 mt-3">
              <button :disabled="runningId === rep.id" title="Run now" class="p-2 rounded-lg hover:opacity-70 transition-opacity disabled:opacity-30" :style="{ backgroundColor: `${SUCCESS}15`, color: SUCCESS }" @click="runNow(rep)">
                <component :is="ICONS.Play" :size="15" weight="Linear" :class="runningId === rep.id ? 'animate-pulse' : ''" />
              </button>
              <button title="Edit" class="p-2 rounded-lg hover:opacity-70 transition-opacity" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }" @click="openEditReport(rep)">
                <component :is="ICONS.Pen2" :size="15" weight="Linear" />
              </button>
              <button title="Delete" class="p-2 rounded-lg hover:opacity-70 transition-opacity" :style="{ backgroundColor: `${DANGER}15`, color: DANGER }" @click="deleteSchedule(rep.id, rep.name)">
                <component :is="ICONS.TrashBinMinimalistic" :size="15" weight="Linear" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Desktop — sortable column table -->
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm text-left">
          <thead class="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th v-for="col in SCHEDULE_COLUMNS" :key="col.key" class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider">
                <button class="inline-flex items-center gap-1 uppercase tracking-wider" :style="{ color: scheduleSortBy === col.key ? PRIMARY_BLUE : '#9CA3AF' }" @click="toggleScheduleSort(col.key)">
                  {{ col.label }} <component :is="ICONS.SortVertical" :size="11" weight="Linear" />
                </button>
              </th>
              <th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Schedule</th>
              <th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Delivery</th>
              <th class="px-3 py-2.5 w-32"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(rep, idx) in sortedSchedules" :key="rep.id" class="align-top" :class="idx > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''">
              <td class="px-3 py-3 max-w-[240px]">
                <div class="flex items-start gap-2.5">
                  <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">
                    <component :is="ICONS.Calendar" :size="14" weight="Linear" />
                  </div>
                  <p class="font-semibold truncate text-gray-900 dark:text-white">{{ rep.name || "Unnamed Report" }}</p>
                </div>
              </td>
              <td class="px-3 py-3">
                <span class="text-[10px] font-light px-2.5 py-0.5 rounded-full border border-current/25 whitespace-nowrap" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">
                  {{ FREQUENCY_LABEL[rep.schedule.frequency] || "Weekly (Mon)" }}
                </span>
              </td>
              <td class="px-3 py-3 text-xs text-gray-400 whitespace-nowrap">{{ rep.sources.length }} source{{ rep.sources.length !== 1 ? "s" : "" }} · {{ rep.timeLapse }}</td>
              <td class="px-3 py-3 text-xs text-gray-400 whitespace-nowrap">at {{ rep.schedule.time || "09:00" }} ({{ rep.schedule.timezone || "UTC" }})</td>
              <td class="px-3 py-3">
                <span v-if="rep.delivery.email && rep.emailRecipients" class="text-xs text-gray-400 truncate max-w-[180px] inline-flex items-center gap-1">
                  <component :is="ICONS.Letter" :size="11" weight="Linear" /> {{ rep.emailRecipients }}
                </span>
                <span v-else class="text-xs text-gray-400">—</span>
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-2 justify-end">
                  <button :disabled="runningId === rep.id" title="Run now" class="p-2 rounded-lg hover:opacity-70 transition-opacity disabled:opacity-30" :style="{ backgroundColor: `${SUCCESS}15`, color: SUCCESS }" @click="runNow(rep)">
                    <component :is="ICONS.Play" :size="15" weight="Linear" :class="runningId === rep.id ? 'animate-pulse' : ''" />
                  </button>
                  <button title="Edit" class="p-2 rounded-lg hover:opacity-70 transition-opacity" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }" @click="openEditReport(rep)">
                    <component :is="ICONS.Pen2" :size="15" weight="Linear" />
                  </button>
                  <button title="Delete" class="p-2 rounded-lg hover:opacity-70 transition-opacity" :style="{ backgroundColor: `${DANGER}15`, color: DANGER }" @click="deleteSchedule(rep.id, rep.name)">
                    <component :is="ICONS.TrashBinMinimalistic" :size="15" weight="Linear" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ReportBuilderModal :open="builderOpen" :editing-report="editingReport" @close="builderOpen = false" @saved="builderOpen = false" />
    <ReportTemplateModal :open="templateOpen" @close="templateOpen = false" />
  </main>
</template>
