<script setup lang="ts">
// Reporting — Builder / Schedules / Template. Port of App.jsx's Reporting
// view (App.jsx:2940-3100 state, 4890-5274 render, 6404-6430 Template
// modal) plus POST /api/reports/generate (main.py:892-901, 15608-15779,
// 16048-16159).
//
// Structural note (matches the same pattern already resolved for
// Workflows/Settings per the standing "navigation and UI MUST match the
// original" directive): "Builder" is NOT a form — it's a CTA card that
// opens the Report Builder Modal, which is the ONE unified form used for
// both "Generate Now" and "Save/Update Schedule". "Template" is not a real
// persistent tab at all — selecting it opens the Template modal and
// immediately snaps the active pill back to "builder" (App.jsx:3086-3094).
import { computed, onMounted, ref } from "vue";
import { ICONS } from "../lib/solarIcons";
import HelpIcon from "../components/shared/HelpIcon.vue";
import ReportBuilderModal from "../components/reporting/ReportBuilderModal.vue";
import ReportTemplateModal from "../components/reporting/ReportTemplateModal.vue";
import { useAuthStore } from "../stores/auth";
import { useDashboardStateStore, type ScheduledReport } from "../stores/dashboardState";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const DANGER = "#EF4444";

const store = useDashboardStateStore();
const auth = useAuthStore();

type Tab = "builder" | "scheduled";
const tab = ref<Tab>("scheduled");
const REPORTING_TAB_ANCHORS: Record<string, string> = { builder: "builder-tab", scheduled: "schedules-tab", template: "template-tab" };
const helpAnchor = computed(() => REPORTING_TAB_ANCHORS[templateOpen.value ? "template" : tab.value] ?? null);

function selectTab(id: Tab | "template") {
  if (id === "template") {
    templateOpen.value = true;
    tab.value = "builder";
    return;
  }
  tab.value = id;
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
  tab.value = "builder";
  builderOpen.value = true;
}

// ── Template modal ──
const templateOpen = ref(false);

// ── Schedules ──
const FREQUENCY_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly (Mon)", monthly: "Monthly (1st)" };
const runningId = ref<string | null>(null);
const scheduleError = ref<string | null>(null);

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
  <main class="p-8 pb-16">
    <header class="flex justify-between items-start mb-8 gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold leading-tight text-gray-900">Reporting</h1>
          <HelpIcon slug="reporting" :anchor="helpAnchor" title="Reporting admin guide" />
        </div>
        <p class="text-sm mt-1 text-gray-400">Build, schedule, and manage automated reports.</p>
      </div>
      <div class="flex items-center gap-1 p-1 rounded-xl border border-gray-200 bg-gray-50 shrink-0">
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
          :class="tab === 'builder' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'"
          @click="selectTab('builder')"
        >
          <component :is="ICONS.DocumentText" :size="14" weight="Linear" /> Builder
        </button>
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
          :class="tab === 'scheduled' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'"
          @click="selectTab('scheduled')"
        >
          <component :is="ICONS.Calendar" :size="14" weight="Linear" /> Schedules ({{ store.scheduledReports.length }})
        </button>
        <button class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap text-gray-400 transition-all" @click="selectTab('template')">
          <component :is="ICONS.CodeFile" :size="14" weight="Linear" /> Template
        </button>
      </div>
    </header>

    <div v-if="store.error || scheduleError" class="mb-4 px-3 py-2 rounded-lg text-sm" :style="{ backgroundColor: `${DANGER}10`, color: DANGER }">
      {{ store.error || scheduleError }}
    </div>

    <!-- Builder — CTA card only; the real form lives in the modal -->
    <div v-if="tab === 'builder'" class="flex flex-col items-center justify-center py-16 gap-6">
      <div class="w-16 h-16 rounded-2xl flex items-center justify-center" :style="{ backgroundColor: `${PRIMARY_BLUE}12` }">
        <component :is="ICONS.DocumentText" :size="28" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
      </div>
      <div class="text-center">
        <h2 class="text-lg font-semibold mb-1 text-gray-900">Build a Report</h2>
        <p class="text-sm text-gray-400">Configure data sources, filters, and delivery to generate a PDF report.</p>
      </div>
      <button
        class="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700"
        @click="openNewReport"
      >
        <component :is="ICONS.AddCircle" :size="16" weight="Linear" /> Create Report
      </button>
      <button v-if="store.scheduledReports.length > 0" class="text-sm hover:opacity-70 transition-opacity" :style="{ color: PRIMARY_BLUE }" @click="tab = 'scheduled'">
        View {{ store.scheduledReports.length }} scheduled report{{ store.scheduledReports.length !== 1 ? "s" : "" }}
      </button>
    </div>

    <!-- Schedules -->
    <div v-if="tab === 'scheduled'" class="space-y-3">
      <div v-if="!store.scheduledReports.length" class="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div class="w-14 h-14 rounded-2xl flex items-center justify-center" :style="{ backgroundColor: `${PRIMARY_BLUE}12` }">
          <component :is="ICONS.Calendar" :size="24" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
        </div>
        <div>
          <p class="text-sm font-medium text-gray-900">No scheduled reports yet</p>
          <p class="text-xs mt-1 text-gray-400">Build a report and turn on Automation &amp; Scheduling to get here.</p>
        </div>
        <button class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700" @click="openNewReport">Open Builder</button>
      </div>

      <div v-for="rep in store.scheduledReports" :key="rep.id" class="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 bg-white">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-900 truncate">{{ rep.name || "Untitled report" }}</p>
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            <span class="text-[10px] font-medium px-2.5 py-0.5 rounded-full" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }">
              {{ FREQUENCY_LABEL[rep.schedule.frequency] || "Weekly (Mon)" }}
            </span>
            <span class="text-xs text-gray-400">at {{ rep.schedule.time || "09:00" }} ({{ rep.schedule.timezone || "UTC" }})</span>
            <span class="text-xs text-gray-400">· {{ rep.sources.length }} source{{ rep.sources.length !== 1 ? "s" : "" }} · {{ rep.timeLapse }}</span>
          </div>
          <p v-if="rep.delivery.email && rep.emailRecipients" class="text-xs mt-1 text-gray-400 truncate">
            <component :is="ICONS.Letter" :size="11" weight="Linear" class="inline -mt-0.5" /> {{ rep.emailRecipients }}
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0 ml-3">
          <button
            :disabled="runningId === rep.id"
            title="Run now"
            class="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-50"
            :style="{ backgroundColor: `${SUCCESS}15`, color: SUCCESS }"
            @click="runNow(rep)"
          >
            <component :is="ICONS.Play" :size="15" weight="Linear" :class="runningId === rep.id ? 'animate-pulse' : ''" />
          </button>
          <button title="Edit" class="w-8 h-8 rounded-lg flex items-center justify-center" :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }" @click="openEditReport(rep)">
            <component :is="ICONS.Pen2" :size="15" weight="Linear" />
          </button>
          <button title="Delete" class="w-8 h-8 rounded-lg flex items-center justify-center" :style="{ backgroundColor: `${DANGER}15`, color: DANGER }" @click="deleteSchedule(rep.id, rep.name)">
            <component :is="ICONS.TrashBinTrash" :size="15" weight="Linear" />
          </button>
        </div>
      </div>

      <button
        v-if="store.scheduledReports.length"
        class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50"
        @click="openNewReport"
      >
        <component :is="ICONS.AddCircle" :size="14" weight="Linear" /> Add Another Schedule
      </button>
    </div>

    <ReportBuilderModal :open="builderOpen" :editing-report="editingReport" @close="builderOpen = false" @saved="builderOpen = false" />
    <ReportTemplateModal :open="templateOpen" @close="templateOpen = false" />
  </main>
</template>
