<script setup lang="ts">
// Audit Logs top-level view. Port of AuditLogsView.jsx (341 lines) — a
// chronological card-list feed (category icon badge + message + meta line),
// not a table. Category/severity filters use capitalized labels matching
// the original; the category set itself is a superset of the original's 5
// (policy/workflow/violation/settings/system) — this migrated backend logs
// audit events for several subsystems the original didn't have at all
// (Cases, Integrations, Threat Intel, Triggers, generic Device/Compliance
// entries), so the extra categories are real added functionality, not a
// mismatch to hide.
import { Alert } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ICONS } from "../lib/solarIcons";
import HelpIcon from "../components/shared/HelpIcon.vue";
import { useAuditLogsStore, type AuditLogEntry, type AuditLogFilters } from "../stores/auditLogs";
import { useUiStore } from "../stores/ui";

const ui = useUiStore();

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const DANGER = "#EF4444";
const WARNING = "#F59E0B";

const store = useAuditLogsStore();
const route = useRoute();
const router = useRouter();

// Port of CATEGORIES (AuditLogsView.jsx:11-18), extended with the extra
// categories this backend actually emits (see header comment).
const CATEGORIES = [
  { id: "", label: "All categories" },
  { id: "policy", label: "Policy" },
  { id: "workflow", label: "Workflow" },
  { id: "violation", label: "Violation" },
  { id: "settings", label: "Settings" },
  { id: "system", label: "System" },
  { id: "case", label: "Case" },
  { id: "compliance", label: "Compliance" },
  { id: "device", label: "Device" },
  { id: "integration", label: "Integration" },
  { id: "threat_intel", label: "Threat Intel" },
  { id: "trigger", label: "Trigger" },
  { id: "webhook", label: "Webhook" },
];
const SEVERITIES = [
  { id: "", label: "All severities" },
  { id: "info", label: "Info" },
  { id: "warning", label: "Warning" },
  { id: "critical", label: "Critical" },
];

const CATEGORY_META: Record<string, { icon: keyof typeof ICONS; color: string }> = {
  policy: { icon: "ShieldWarning", color: WARNING },
  workflow: { icon: "Structure", color: PRIMARY_BLUE },
  violation: { icon: "DangerTriangle", color: DANGER },
  settings: { icon: "Settings", color: PRIMARY_BLUE },
  system: { icon: "Pulse2", color: SUCCESS },
  case: { icon: "Case", color: "#8B5CF6" },
  compliance: { icon: "ShieldCheck", color: WARNING },
  device: { icon: "Smartphone", color: "#64748B" },
  integration: { icon: "LinkCircle", color: PRIMARY_BLUE },
  threat_intel: { icon: "Radar", color: DANGER },
  trigger: { icon: "Bolt", color: WARNING },
  webhook: { icon: "PlugCircle", color: PRIMARY_BLUE },
};
const SEVERITY_META: Record<string, { color: string; label: string }> = {
  info: { color: SUCCESS, label: "Info" },
  warning: { color: WARNING, label: "Warning" },
  critical: { color: DANGER, label: "Critical" },
};

const searchInput = ref("");
const q = ref("");
const category = ref("");
const severity = ref("");
const dateFrom = ref("");
const dateTo = ref("");
const actor = ref("");
const isExporting = ref(false);
// Arrived here from a "View in Audit Log" cross-link (e.g. a device's
// Active Violations) — an exact-match filter on targetId, not a free-text
// name search (two devices can share a display name; ids don't collide).
const targetIdFilter = ref<string | null>(null);
const targetLabelFilter = ref<string | null>(null);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { q.value = val; }, 300);
});

function buildFilters(): AuditLogFilters {
  const out: AuditLogFilters = {};
  if (q.value) out.q = q.value;
  if (category.value) out.category = category.value;
  if (severity.value) out.severity = severity.value;
  if (dateFrom.value) out.date_from = dateFrom.value;
  if (dateTo.value) out.date_to = dateTo.value;
  if (targetIdFilter.value) out.target_id = targetIdFilter.value;
  if (actor.value) out.actor = actor.value;
  return out;
}

const hasFilters = computed(() => Boolean(q.value || category.value || severity.value || dateFrom.value || dateTo.value || targetIdFilter.value || actor.value));

function clearFilters() {
  searchInput.value = ""; q.value = ""; category.value = ""; severity.value = "";
  dateFrom.value = ""; dateTo.value = ""; targetIdFilter.value = null; targetLabelFilter.value = null; actor.value = "";
}

watch([q, category, severity, dateFrom, dateTo, actor, targetIdFilter], () => {
  store.fetchLogs(buildFilters());
});

function formatTimestamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function categoryMeta(cat: string) {
  return CATEGORY_META[cat] ?? { icon: "InfoCircle" as const, color: "#94A3B8" };
}
function severityMeta(sev: string) {
  return SEVERITY_META[sev] ?? SEVERITY_META.info;
}

function openDevice(entry: AuditLogEntry) {
  if (!entry.targetId) return;
  router.push({ path: "/devices", query: { deviceId: entry.targetId } });
}

async function handleExport() {
  isExporting.value = true;
  try {
    await store.exportCsv(buildFilters());
  } finally {
    isExporting.value = false;
  }
}

onMounted(async () => {
  const deviceId = route.query.deviceId;
  const deviceName = route.query.deviceName;
  if (typeof deviceId === "string" && deviceId) {
    targetIdFilter.value = deviceId;
    targetLabelFilter.value = typeof deviceName === "string" ? deviceName : null;
  }
  await Promise.all([store.fetchLogs(buildFilters()), store.fetchActors()]);
});
</script>

<template>
  <main class="p-4 md:p-8 pb-16">
    <header class="flex justify-between items-start mb-8 flex-wrap gap-4">
      <div>
        <h1 class="text-2xl font-semibold leading-tight flex items-center gap-2 text-gray-900 dark:text-white">
          <component :is="ICONS.DocumentText" :size="22" weight="Linear" :style="{ color: PRIMARY_BLUE }" /> Audit Logs
          <HelpIcon slug="audit-logs" title="Audit Logs admin guide" />
        </h1>
        <p class="text-sm mt-1 text-gray-400">
          Every policy evaluation alert and admin action in this workspace{{ store.retentionDays !== null ? ` — kept for ${store.retentionDays > 0 ? `${store.retentionDays} days` : "forever"}` : "" }}.
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          :disabled="store.isLoading"
          class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
          @click="store.fetchLogs(buildFilters())"
        >
          <component :is="ICONS.Refresh" :size="14" weight="Linear" :class="store.isLoading ? 'animate-spin' : ''" /> Refresh
        </button>
        <button
          :disabled="isExporting || store.total === 0"
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          @click="handleExport"
        >
          <component :is="ICONS.Download" :size="14" weight="Linear" /> {{ isExporting ? "Exporting…" : "Export CSV" }}
        </button>
      </div>
    </header>

    <!-- Filter bar -->
    <div class="flex items-center gap-2 mb-4 flex-wrap">
      <span v-if="targetIdFilter" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
        Device: {{ targetLabelFilter || targetIdFilter }}
        <button class="hover:opacity-70" @click="targetIdFilter = null; targetLabelFilter = null">
          <component :is="ICONS.CloseCircle" :size="12" weight="Linear" />
        </button>
      </span>
      <div class="relative flex-1 min-w-[220px]">
        <component :is="ICONS.Magnifer" :size="14" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
        <input
          v-model="searchInput"
          placeholder="Search by device, policy, workflow, actor…"
          class="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
        />
      </div>
      <select v-model="category" class="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500">
        <option v-for="c in CATEGORIES" :key="c.id" :value="c.id">{{ c.label }}</option>
      </select>
      <select v-model="severity" class="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500">
        <option v-for="s in SEVERITIES" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
      <select v-if="store.actors.length > 0" v-model="actor" class="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white max-w-[160px] focus:ring-2 focus:ring-brand-500">
        <option value="">All actors</option>
        <option v-for="a in store.actors" :key="a" :value="a">{{ a === "system" ? "System" : a }}</option>
      </select>
      <div class="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <component :is="ICONS.Calendar" :size="13" weight="Linear" class="text-gray-400" />
        <input v-model="dateFrom" type="date" class="text-sm outline-none bg-transparent text-gray-900 dark:text-white" :style="{ colorScheme: ui.isDark ? 'dark' : 'light' }" />
        <span class="text-xs text-gray-400">to</span>
        <input v-model="dateTo" type="date" class="text-sm outline-none bg-transparent text-gray-900 dark:text-white" :style="{ colorScheme: ui.isDark ? 'dark' : 'light' }" />
      </div>
      <button v-if="hasFilters" class="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium text-gray-400" @click="clearFilters">
        <component :is="ICONS.CloseCircle" :size="13" weight="Linear" /> Clear filters
      </button>
    </div>

    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <div v-if="store.isLoading" class="flex flex-col items-center justify-center min-h-[300px]">
      <div class="w-8 h-8 border-2 rounded-full animate-spin mb-4" :style="{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }" />
      <span class="text-xs uppercase tracking-widest font-bold text-gray-400">Loading audit log…</span>
    </div>
    <div v-else-if="store.items.length === 0" class="flex flex-col items-center justify-center py-16 px-6 text-center rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
      <div class="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 bg-gray-50 dark:bg-gray-900/50">
        <component :is="ICONS.DocumentText" :size="22" weight="Linear" class="text-gray-400" />
      </div>
      <p class="text-sm font-semibold mb-1 text-gray-900 dark:text-white">{{ hasFilters ? "No events match these filters" : "No audit events yet" }}</p>
      <p class="text-sm max-w-xs text-gray-400">
        {{ hasFilters ? "Try widening the date range or clearing a filter." : "Policy evaluations and admin actions will show up here as they happen." }}
      </p>
    </div>
    <template v-else>
      <p class="text-xs mb-3 text-gray-400">Showing {{ store.items.length }} of {{ store.total }} event{{ store.total === 1 ? "" : "s" }}</p>
      <div class="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
        <div v-for="(e, i) in store.items" :key="e.id" class="flex items-start gap-3 px-4 py-3 bg-white dark:bg-gray-800" :class="i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" :style="{ backgroundColor: `${categoryMeta(e.category).color}15`, color: categoryMeta(e.category).color }">
            <component :is="ICONS[categoryMeta(e.category).icon]" :size="14" weight="Linear" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm text-gray-900 dark:text-white">{{ e.message }}</p>
            <div class="flex items-center gap-2 mt-1 flex-wrap">
              <span class="text-[11px] text-gray-400">{{ formatTimestamp(e.timestamp) }}</span>
              <span class="text-[11px] text-gray-400">·</span>
              <span class="text-[11px] text-gray-400">{{ e.actor === "system" ? "System" : e.actor }}</span>
              <span class="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider" :style="{ backgroundColor: `${severityMeta(e.severity).color}15`, color: severityMeta(e.severity).color }">
                {{ severityMeta(e.severity).label }}
              </span>
              <template v-if="e.targetType === 'device' && e.targetId">
                <span class="text-[11px] text-gray-400">·</span>
                <button class="text-[11px] font-semibold underline" :style="{ color: PRIMARY_BLUE }" @click="openDevice(e)">
                  Open {{ e.targetName || "device" }}
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
      <div v-if="store.items.length < store.total" class="flex justify-center mt-4">
        <button
          :disabled="store.isLoadingMore"
          class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
          @click="store.loadMore(buildFilters())"
        >
          {{ store.isLoadingMore ? "Loading…" : `Load more (${store.total - store.items.length} remaining)` }}
        </button>
      </div>
    </template>
  </main>
</template>
