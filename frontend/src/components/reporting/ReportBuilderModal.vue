<script setup lang="ts">
// The Report Builder modal — the ONE unified form used for both "Generate Now"
// (a one-off PDF) and "Save/Update Schedule" (the same fields plus an optional
// Automation & Scheduling section). Port of App.jsx's Report Builder Modal
// (App.jsx:5005-5274) — reached from Reporting's Builder-tab "Create Report"
// CTA, the Schedules tab's "+Add Another Schedule" button, or a schedule
// card's Edit button. NOT the Builder tab itself, which is just a CTA card
// (see ReportingView.vue) — the original's real "Builder" is this modal.
import { computed, reactive, ref, watch } from "vue";
import { ICONS, resolveIcon } from "../../lib/solarIcons";
import { WIDGET_CATALOG, WIDGET_ICON_MAP, DEFAULT_WIDGET_ICON } from "../../lib/analyticsCatalog";
import { useAuthStore } from "../../stores/auth";
import { useDashboardStateStore, type ScheduledReport } from "../../stores/dashboardState";

const PRIMARY_BLUE = "#0241E3";
const DANGER = "#EF4444";

const props = defineProps<{ open: boolean; editingReport: ScheduledReport | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const auth = useAuthStore();
const store = useDashboardStateStore();

// 1:1 port of _blankReportConfig() (App.jsx:2964-2979).
function blankConfig() {
  return {
    name: "",
    timeLapse: "Last 30 Days",
    sources: [] as string[],
    delivery: { download: true, chat: false, email: false },
    emailRecipients: "",
    schedule: {
      enabled: false,
      frequency: "weekly" as "daily" | "weekly" | "monthly",
      time: "09:00",
      startDate: new Date(Date.now() + 86400000).toISOString().split("T")[0],
      timezone: (() => {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
          return "UTC";
        }
      })(),
    },
    filters: { type: "all", complianceStatus: "all", inactive24h: false, role: "all", authOrigin: "all" },
    display: { trend: true, trend_type: "line", donut: true, donut_type: "donut", table: true, table_type: "standard" },
  };
}

const form = reactive(blankConfig());
const isGenerating = ref(false);
const isSavingSchedule = ref(false);
const errorMsg = ref<string | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    errorMsg.value = null;
    if (props.editingReport) {
      const r = props.editingReport;
      Object.assign(form, JSON.parse(JSON.stringify({
        name: r.name, timeLapse: r.timeLapse, sources: r.sources,
        delivery: { download: r.delivery?.download ?? true, chat: r.delivery?.chat ?? false, email: r.delivery?.email ?? false },
        emailRecipients: r.emailRecipients ?? "",
        schedule: { ...blankConfig().schedule, ...r.schedule },
        filters: { ...blankConfig().filters, ...r.filters },
        display: { ...blankConfig().display, ...r.display },
      })));
    } else {
      Object.assign(form, blankConfig());
    }
  },
);

// Flat, ungrouped source list — 1:1 port of
// `CATALOG.flatMap(g=>g.items).filter(i => SOURCE_SHAPES[i.stat] !== 'orgProfile')` (App.jsx:5045).
const selectableSources = computed(() => WIDGET_CATALOG.filter((i) => i.id !== "org_profile"));

function toggleSource(id: string) {
  form.sources = form.sources.includes(id) ? form.sources.filter((s) => s !== id) : [...form.sources, id];
}
function sourceIcon(id: string) {
  return resolveIcon(WIDGET_ICON_MAP[id]?.icon ?? DEFAULT_WIDGET_ICON.icon);
}

const DISPLAY_ROWS: Array<{ key: "trend" | "donut" | "table"; label: string; icon: any; typeKey: "trend_type" | "donut_type" | "table_type"; types: Array<[string, string]> }> = [
  { key: "trend", label: "Trend Charts", icon: ICONS.GraphUp, typeKey: "trend_type", types: [["line", "Line Graph"], ["bar", "Bar Chart"]] },
  { key: "donut", label: "Distribution Charts", icon: ICONS.PieChart, typeKey: "donut_type", types: [["donut", "Donut"], ["pie", "Pie"], ["bar", "Bar"], ["radar", "Radar"]] },
  { key: "table", label: "Data Tables", icon: ICONS.List, typeKey: "table_type", types: [["standard", "Standard"], ["progress", "Progress Bars"]] },
];

// 1:1 port of the hardcoded ~34-zone IANA timezone list (App.jsx:5193-5201).
const TIMEZONES = [
  "UTC",
  "Europe/Madrid", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Rome", "Europe/Amsterdam",
  "Europe/Lisbon", "Europe/Stockholm", "Europe/Zurich", "Europe/Warsaw", "Europe/Prague",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "America/Mexico_City", "America/Bogota",
  "Asia/Tokyo", "Asia/Shanghai", "Asia/Singapore", "Asia/Dubai", "Asia/Kolkata", "Asia/Seoul",
  "Asia/Jakarta", "Asia/Bangkok", "Asia/Hong_Kong",
  "Australia/Sydney", "Australia/Melbourne", "Pacific/Auckland",
  "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos",
];

const webhookMissing = computed(() => form.delivery.chat && !store.webhookUrl);
const smtpMissing = computed(() => form.delivery.email && (!store.smtpConfig?.host || !store.smtpConfig?.user));

async function buildReportBlob(payload: Record<string, any>) {
  const { api } = await import("../../api/http");
  return api.post("/reports/generate", payload, { responseType: "blob" });
}
function downloadBlob(data: BlobPart, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function generateNow() {
  if (!form.sources.length) return;
  isGenerating.value = true;
  errorMsg.value = null;
  try {
    const res = await buildReportBlob({
      workspace: auth.orgSlug,
      sources: form.sources,
      timeLapse: form.timeLapse,
      filters: form.filters,
      display: form.display,
      webhookUrl: form.delivery.chat ? store.webhookUrl : null,
      emailRecipients: form.delivery.email ? form.emailRecipients : null,
      smtp: form.delivery.email ? store.smtpConfig : null,
    });
    if (form.delivery.download) downloadBlob(res.data, `Applivery_Report_${auth.orgSlug}.pdf`);
    emit("close");
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.detail || "Failed to generate report.";
  } finally {
    isGenerating.value = false;
  }
}

async function saveSchedule() {
  if (!form.sources.length) return;
  isSavingSchedule.value = true;
  errorMsg.value = null;
  try {
    // workspaceSlug pins this schedule to whichever workspace it was built
    // in (App.jsx's Save Schedule handler) so the backend scheduler can
    // resolve the right per-workspace Applivery credential for it — not a
    // user-editable field.
    const saved: ScheduledReport = {
      id: props.editingReport?.id || `sched_${Date.now()}`,
      name: form.name || `Report ${store.scheduledReports.length + 1}`,
      workspaceSlug: auth.orgSlug ?? "",
      sources: form.sources,
      timeLapse: form.timeLapse,
      filters: form.filters,
      display: form.display,
      emailRecipients: form.emailRecipients,
      delivery: form.delivery,
      schedule: form.schedule,
    };
    const next = [...store.scheduledReports];
    const idx = props.editingReport ? next.findIndex((r) => r.id === props.editingReport!.id) : -1;
    if (idx >= 0) next[idx] = saved;
    else next.push(saved);
    await store.saveScheduledReports(next);
    emit("saved");
    emit("close");
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.detail || "Failed to save schedule.";
  } finally {
    isSavingSchedule.value = false;
  }
}

function cancelEdit() {
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 overflow-y-auto" @click.self="emit('close')">
      <div class="w-full max-w-2xl rounded-2xl shadow-2xl bg-white flex flex-col max-h-[90vh]">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-5 border-b border-gray-100 shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}12` }">
              <component :is="ICONS.DocumentText" :size="18" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
            </div>
            <div>
              <h2 class="text-base font-bold leading-tight text-gray-900">{{ editingReport ? "Edit Report" : "Build a Report" }}</h2>
              <p class="text-xs mt-0.5 text-gray-400">Configure your report and generate or schedule it</p>
            </div>
          </div>
          <button class="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close" @click="emit('close')">
            <component :is="ICONS.CloseCircle" :size="18" weight="Linear" />
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto">
          <div class="p-6 flex flex-col gap-6">
            <div v-if="errorMsg" class="px-3 py-2 rounded-lg text-sm" :style="{ backgroundColor: `${DANGER}10`, color: DANGER }">{{ errorMsg }}</div>

            <!-- Report Name -->
            <div>
              <label class="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-400">Report Name</label>
              <input v-model="form.name" placeholder="e.g. Monthly Compliance Summary" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200" />
            </div>

            <!-- 1. Select Data Sources -->
            <div>
              <label class="block text-xs font-semibold uppercase tracking-widest mb-3 text-gray-400">1. Select Data Sources</label>
              <div class="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                <label
                  v-for="item in selectableSources"
                  :key="item.id"
                  class="flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors hover:border-blue-500 bg-white"
                  :style="{ borderColor: form.sources.includes(item.id) ? PRIMARY_BLUE : '#E5E7EB' }"
                >
                  <input type="checkbox" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" :checked="form.sources.includes(item.id)" @change="toggleSource(item.id)" />
                  <component :is="sourceIcon(item.id)" :size="14" weight="Linear" :style="{ color: form.sources.includes(item.id) ? PRIMARY_BLUE : '#9CA3AF' }" />
                  <span class="text-xs font-medium text-gray-900">{{ item.label }}</span>
                </label>
              </div>
            </div>

            <!-- 2. Time Lapse -->
            <div>
              <label class="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-400">2. Time Lapse</label>
              <select v-model="form.timeLapse" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200">
                <option value="Last 7 Days">Last 7 Days</option>
                <option value="Last 30 Days">Last 30 Days</option>
                <option value="All Time">All Time</option>
              </select>
            </div>

            <!-- 3. Filters -->
            <div>
              <label class="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-400">3. Filters</label>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] font-medium mb-1 text-gray-500">Operating System</label>
                  <select v-model="form.filters.type" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200">
                    <option value="all">All OS</option>
                    <option value="apple">iOS / macOS</option>
                    <option value="android">Android</option>
                    <option value="windows">Windows</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-medium mb-1 text-gray-500">Compliance</label>
                  <select v-model="form.filters.complianceStatus" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200">
                    <option value="all">All devices</option>
                    <option value="compliant">Compliant only</option>
                    <option value="non_compliant">Non-compliant only</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-medium mb-1 text-gray-500">Role</label>
                  <select v-model="form.filters.role" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200">
                    <option value="all">All roles</option>
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-medium mb-1 text-gray-500">Auth Origin</label>
                  <select v-model="form.filters.authOrigin" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200">
                    <option value="all">All origins</option>
                    <option value="dashboard">Dashboard</option>
                    <option value="sso">SSO</option>
                  </select>
                </div>
              </div>
              <label class="flex items-center gap-2 text-sm mt-3 text-gray-700">
                <input type="checkbox" v-model="form.filters.inactive24h" /> Hide devices not reported in last 24h
              </label>
            </div>

            <!-- 4. Display Options -->
            <div>
              <label class="block text-xs font-semibold uppercase tracking-widest mb-3 text-gray-400">4. Display Options</label>
              <div class="flex flex-col gap-3">
                <div v-for="row in DISPLAY_ROWS" :key="row.key">
                  <label class="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" v-model="(form.display as any)[row.key]" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <component :is="row.icon" :size="14" weight="Linear" class="text-gray-400" />
                    <span class="text-sm font-medium text-gray-900">{{ row.label }}</span>
                    <select
                      v-if="(form.display as any)[row.key]"
                      v-model="(form.display as any)[row.typeKey]"
                      class="ml-auto rounded-lg px-2.5 py-1 outline-none text-xs border border-gray-200"
                    >
                      <option v-for="[v, l] in row.types" :key="v" :value="v">{{ l }}</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <!-- 5. Delivery -->
            <div>
              <label class="block text-xs font-semibold uppercase tracking-widest mb-3 text-gray-400">5. Delivery</label>
              <div class="flex flex-col gap-2.5">
                <label class="flex items-center gap-2.5 text-sm text-gray-700">
                  <input type="checkbox" v-model="form.delivery.download" />
                  <component :is="ICONS.Download" :size="14" weight="Linear" class="text-gray-400" />
                  Download PDF directly
                </label>
                <label class="flex items-center gap-2.5 text-sm text-gray-700">
                  <input type="checkbox" v-model="form.delivery.chat" />
                  <component :is="ICONS.ChatRound" :size="14" weight="Linear" class="text-gray-400" />
                  Send to Webhook
                </label>
                <p v-if="webhookMissing" class="text-xs text-red-500 pl-6">No Webhook URL configured in Settings.</p>
                <label class="flex items-center gap-2.5 text-sm text-gray-700">
                  <input type="checkbox" v-model="form.delivery.email" />
                  <component :is="ICONS.Letter" :size="14" weight="Linear" class="text-gray-400" />
                  Send via Email
                </label>
                <div v-if="form.delivery.email" class="pl-6">
                  <input v-model="form.emailRecipients" placeholder="alice@example.com, bob@example.com" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200" />
                  <p v-if="smtpMissing" class="text-xs text-red-500 mt-1">SMTP not configured in Settings.</p>
                </div>
              </div>
            </div>

            <!-- 6. Automation & Scheduling -->
            <div class="rounded-xl border p-4" :style="form.schedule.enabled ? { backgroundColor: `${PRIMARY_BLUE}06`, borderColor: PRIMARY_BLUE } : { borderColor: '#E5E7EB' }">
              <div class="flex items-center justify-between">
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-widest text-gray-400">6. Automation &amp; Scheduling</label>
                  <p class="text-xs mt-0.5 text-gray-400">Run automatically on a recurring schedule.</p>
                </div>
                <button
                  type="button"
                  class="px-3 py-1 rounded-full text-xs font-semibold shrink-0"
                  :style="form.schedule.enabled ? { backgroundColor: PRIMARY_BLUE, color: '#fff' } : { backgroundColor: '#E5E7EB', color: '#6B7280' }"
                  @click="form.schedule.enabled = !form.schedule.enabled"
                >
                  {{ form.schedule.enabled ? "ON" : "OFF" }}
                </button>
              </div>
              <div v-if="form.schedule.enabled" class="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label class="block text-[11px] font-medium mb-1 text-gray-500">Frequency</label>
                  <select v-model="form.schedule.frequency" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly (Mon)</option>
                    <option value="monthly">Monthly (1st)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-medium mb-1 text-gray-500">Execution Time</label>
                  <input v-model="form.schedule.time" type="time" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200" />
                </div>
                <div>
                  <label class="block text-[11px] font-medium mb-1 text-gray-500">Timezone</label>
                  <select v-model="form.schedule.timezone" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200">
                    <option v-for="tz in TIMEZONES" :key="tz" :value="tz">{{ tz.replace(/_/g, " ") }}</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-medium mb-1 text-gray-500">Start Date</label>
                  <input v-model="form.schedule.startDate" type="date" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 shrink-0">
          <div class="flex items-center gap-2">
            <button v-if="editingReport" class="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50" @click="cancelEdit">Cancel Edit</button>
            <button class="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50" @click="emit('close')">Cancel</button>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="form.schedule.enabled"
              :disabled="!form.sources.length || isSavingSchedule"
              class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border disabled:opacity-50"
              :style="{ borderColor: PRIMARY_BLUE, color: PRIMARY_BLUE }"
              @click="saveSchedule"
            >
              <component :is="ICONS.Calendar" :size="14" weight="Linear" />
              {{ editingReport ? "Update Schedule" : "Save Schedule" }}
            </button>
            <button
              :disabled="!form.sources.length || isGenerating"
              class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50"
              @click="generateNow"
            >
              <component :is="ICONS.Refresh" :size="14" weight="Linear" :class="isGenerating ? 'animate-spin' : ''" />
              {{ isGenerating ? "Generating…" : "Generate Now" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
