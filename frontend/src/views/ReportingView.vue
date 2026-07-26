<script setup lang="ts">
// Reporting — Builder / Schedules / Template. Port of App.jsx's Reporting
// view (report generation form, scheduledReports CRUD, customReportTemplate
// editor) plus POST /api/reports/generate (main.py:892-901, 15608-15779,
// 16048-16159). See migration-plan.md §8 Phase 7.
import { Alert, Button, Card, PageHeader, Tabs } from "@applivery/bluesky-vue";
import { computed, onMounted, reactive, ref } from "vue";
import HelpIcon from "../components/shared/HelpIcon.vue";
import { useAuthStore } from "../stores/auth";
import { useDashboardStateStore, type ScheduledReport } from "../stores/dashboardState";
import { WIDGET_CATALOG } from "../lib/analyticsCatalog";

const store = useDashboardStateStore();
const auth = useAuthStore();

const activeTab = ref("builder");
const tabs = [
  { id: "builder", label: "Builder" },
  { id: "scheduled", label: `Schedules` },
  { id: "template", label: "Template" },
];
// Port of the anchor object literal passed to HelpIcon in App.jsx's
// Reporting header ({ builder: 'builder-tab', scheduled: 'schedules-tab', template: 'template-tab' }).
const REPORTING_TAB_ANCHORS: Record<string, string> = { builder: "builder-tab", scheduled: "schedules-tab", template: "template-tab" };
const helpAnchor = computed(() => REPORTING_TAB_ANCHORS[activeTab.value] ?? null);

onMounted(async () => {
  if (!store.isLoaded) await store.fetchState();
});

const groupedCatalog = computed(() => {
  const groups: Record<string, typeof WIDGET_CATALOG> = {};
  for (const item of WIDGET_CATALOG) (groups[item.group] ??= []).push(item);
  return groups;
});

// ── Builder ──
const builderSources = ref<string[]>(["stats_devices_os", "stats_compliance"]);
const builderTimeLapse = ref("Last 30 Days");
const builderDisplay = reactive({ trend: true, trend_type: "line", donut: true, donut_type: "donut", table: true, table_type: "standard" });
const builderSendChat = ref(false);
const builderSendEmail = ref(false);
const builderEmailRecipients = ref("");
const isGenerating = ref(false);
const generateError = ref<string | null>(null);

function toggleSource(id: string) {
  builderSources.value = builderSources.value.includes(id) ? builderSources.value.filter((s) => s !== id) : [...builderSources.value, id];
}

async function generateNow() {
  if (!builderSources.value.length) return;
  isGenerating.value = true;
  generateError.value = null;
  try {
    const { api } = await import("../api/http");
    const res = await api.post(
      "/reports/generate",
      {
        workspace: auth.orgSlug,
        sources: builderSources.value,
        timeLapse: builderTimeLapse.value,
        filters: {},
        display: builderDisplay,
        webhookUrl: builderSendChat.value ? store.webhookUrl : null,
        emailRecipients: builderSendEmail.value ? builderEmailRecipients.value : null,
        smtp: builderSendEmail.value ? store.smtpConfig : null,
      },
      { responseType: "blob" },
    );
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Applivery_Report_${auth.orgSlug}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err: any) {
    generateError.value = err?.response?.data?.detail || "Failed to generate report.";
  } finally {
    isGenerating.value = false;
  }
}

// ── Schedules ──
const showScheduleModal = ref(false);
const editingId = ref<string | null>(null);
const scheduleForm = reactive<ScheduledReport>(emptySchedule());

function emptySchedule(): ScheduledReport {
  return {
    id: "",
    name: "",
    workspaceSlug: auth.orgSlug ?? "",
    sources: [],
    timeLapse: "Last 30 Days",
    filters: {},
    display: { trend: true, trend_type: "line", donut: true, donut_type: "donut", table: true, table_type: "standard" },
    emailRecipients: "",
    delivery: { chat: false, email: false },
    schedule: { enabled: true, frequency: "weekly", time: "09:00", timezone: store.timezone, startDate: null },
  };
}

function openNewSchedule() {
  editingId.value = null;
  Object.assign(scheduleForm, emptySchedule());
  showScheduleModal.value = true;
}

function openEditSchedule(rep: ScheduledReport) {
  editingId.value = rep.id;
  Object.assign(scheduleForm, JSON.parse(JSON.stringify(rep)));
  showScheduleModal.value = true;
}

async function saveSchedule() {
  if (!scheduleForm.name || !scheduleForm.sources.length) return;
  const next = [...store.scheduledReports];
  if (editingId.value) {
    const idx = next.findIndex((r) => r.id === editingId.value);
    if (idx >= 0) next[idx] = { ...scheduleForm };
  } else {
    next.push({ ...scheduleForm, id: `sched_${Date.now()}` });
  }
  await store.saveScheduledReports(next);
  showScheduleModal.value = false;
}

async function deleteSchedule(id: string) {
  await store.saveScheduledReports(store.scheduledReports.filter((r) => r.id !== id));
}

async function toggleScheduleEnabled(rep: ScheduledReport) {
  const next = store.scheduledReports.map((r) => (r.id === rep.id ? { ...r, schedule: { ...r.schedule, enabled: !r.schedule.enabled } } : r));
  await store.saveScheduledReports(next);
}

function toggleScheduleSource(id: string) {
  scheduleForm.sources = scheduleForm.sources.includes(id) ? scheduleForm.sources.filter((s) => s !== id) : [...scheduleForm.sources, id];
}

// ── Template ──
const templateDraft = ref("");
const templateSaved = ref(false);
onMounted(() => {
  templateDraft.value = store.customReportTemplate;
});
async function saveTemplate() {
  await store.saveCustomReportTemplate(templateDraft.value);
  templateSaved.value = true;
  setTimeout(() => (templateSaved.value = false), 2000);
}
</script>

<template>
  <div class="p-8 space-y-6 animate-page-enter">
    <PageHeader title="Reporting" description="Generate on-demand PDF reports, or schedule recurring ones.">
      <template #title-suffix>
        <HelpIcon slug="reporting" :anchor="helpAnchor" title="Reporting admin guide" />
      </template>
    </PageHeader>
    <Tabs :tabs="tabs" v-model="activeTab" variant="pill" />

    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <!-- Builder -->
    <Card v-if="activeTab === 'builder'" class="space-y-5">
      <div>
        <p class="text-sm font-medium text-gray-700 mb-2">Data sources ({{ builderSources.length }} selected)</p>
        <div class="max-h-80 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-3">
          <div v-for="(items, group) in groupedCatalog" :key="group">
            <p class="text-xs font-semibold text-gray-400 uppercase mb-1">{{ group }}</p>
            <label v-for="item in items" :key="item.id" class="flex items-center gap-2 text-sm py-0.5">
              <input type="checkbox" :checked="builderSources.includes(item.id)" @change="toggleSource(item.id)" />
              {{ item.label }}
            </label>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-medium mb-1.5 text-gray-500">Time lapse label</label>
          <input v-model="builderTimeLapse" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200" />
        </div>
        <div class="flex items-end gap-4">
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="builderSendChat" :disabled="!store.webhookUrl" /> Notify chat webhook</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="builderSendEmail" /> Email report</label>
        </div>
      </div>

      <div v-if="builderSendEmail">
        <label class="block text-xs font-medium mb-1.5 text-gray-500">Email recipients (comma-separated)</label>
        <input v-model="builderEmailRecipients" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200" placeholder="alice@example.com, bob@example.com" />
      </div>

      <div class="grid grid-cols-3 gap-4">
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="builderDisplay.trend" /> Trend chart</label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="builderDisplay.donut" /> Distribution chart</label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="builderDisplay.table" /> Data table</label>
      </div>

      <Alert v-if="generateError" type="danger">{{ generateError }}</Alert>
      <Button :disabled="!builderSources.length || isGenerating" @click="generateNow">{{ isGenerating ? "Generating…" : "Generate now" }}</Button>
    </Card>

    <!-- Schedules -->
    <div v-if="activeTab === 'scheduled'" class="space-y-4">
      <div class="flex justify-end"><Button size="sm" @click="openNewSchedule">New schedule</Button></div>
      <Card v-if="!store.scheduledReports.length"><p class="text-sm text-gray-500">No scheduled reports yet.</p></Card>
      <Card v-for="rep in store.scheduledReports" :key="rep.id" class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-gray-900">{{ rep.name }}</p>
          <p class="text-xs text-gray-500">{{ rep.schedule.frequency }} at {{ rep.schedule.time }} ({{ rep.schedule.timezone || "UTC" }}) — {{ rep.sources.length }} source(s) — {{ rep.workspaceSlug }}</p>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" @click="toggleScheduleEnabled(rep)">{{ rep.schedule.enabled ? "Disable" : "Enable" }}</Button>
          <Button variant="ghost" size="sm" @click="openEditSchedule(rep)">Edit</Button>
          <Button variant="ghost" size="sm" @click="deleteSchedule(rep.id)">Delete</Button>
        </div>
      </Card>
    </div>

    <!-- Template -->
    <Card v-if="activeTab === 'template'" class="space-y-3">
      <p class="text-sm text-gray-500" v-pre>
        Optional custom HTML template for generated reports (supports <code>{{ Workspace_Name }}</code>,
        <code>{{ Report_Title }}</code>, <code>{{ Generated_Date }}</code>, <code>{{ Time_Lapse }}</code>,
        a <code>metadata</code> loop, and a <code>report_sections</code> loop). Leave blank to use the default layout.
      </p>
      <textarea v-model="templateDraft" rows="16" class="w-full rounded-lg px-3 py-2 text-xs font-mono border border-gray-200" placeholder="<html>…</html>" />
      <div class="flex items-center gap-3">
        <Button @click="saveTemplate">Save template</Button>
        <span v-if="templateSaved" class="text-xs text-green-600">Saved.</span>
      </div>
    </Card>

    <!-- Schedule modal -->
    <div v-if="showScheduleModal" class="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="showScheduleModal = false" />
      <div class="relative bg-white rounded-2xl shadow-xl w-full max-w-xl z-10 p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <h3 class="text-base font-medium text-gray-900">{{ editingId ? "Edit schedule" : "New schedule" }}</h3>
        <div>
          <label class="block text-xs font-medium mb-1.5 text-gray-500">Name</label>
          <input v-model="scheduleForm.name" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200" />
        </div>
        <div>
          <label class="block text-xs font-medium mb-1.5 text-gray-500">Sources ({{ scheduleForm.sources.length }} selected)</label>
          <div class="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-3">
            <div v-for="(items, group) in groupedCatalog" :key="group">
              <p class="text-xs font-semibold text-gray-400 uppercase mb-1">{{ group }}</p>
              <label v-for="item in items" :key="item.id" class="flex items-center gap-2 text-sm py-0.5">
                <input type="checkbox" :checked="scheduleForm.sources.includes(item.id)" @change="toggleScheduleSource(item.id)" />
                {{ item.label }}
              </label>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium mb-1.5 text-gray-500">Frequency</label>
            <select v-model="scheduleForm.schedule.frequency" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Mondays)</option>
              <option value="monthly">Monthly (1st)</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium mb-1.5 text-gray-500">Time (local)</label>
            <input v-model="scheduleForm.schedule.time" type="time" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200" />
          </div>
          <div>
            <label class="block text-xs font-medium mb-1.5 text-gray-500">Timezone (IANA)</label>
            <input v-model="scheduleForm.schedule.timezone" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200" placeholder="Europe/Madrid" />
          </div>
          <div>
            <label class="block text-xs font-medium mb-1.5 text-gray-500">Workspace slug</label>
            <input v-model="scheduleForm.workspaceSlug" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200" />
          </div>
        </div>
        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="scheduleForm.delivery.chat" /> Notify chat webhook</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="scheduleForm.delivery.email" /> Email report</label>
        </div>
        <div v-if="scheduleForm.delivery.email">
          <label class="block text-xs font-medium mb-1.5 text-gray-500">Email recipients</label>
          <input v-model="scheduleForm.emailRecipients" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200" />
        </div>
        <div class="flex gap-3 justify-end pt-2">
          <Button variant="ghost" @click="showScheduleModal = false">Cancel</Button>
          <Button :disabled="!scheduleForm.name || !scheduleForm.sources.length" @click="saveSchedule">Save schedule</Button>
        </div>
      </div>
    </div>
  </div>
</template>
