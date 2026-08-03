<script setup lang="ts">
// Fleet table for the Devices view — faithful port of DeviceFleetTable.jsx
// (936 lines): search/platform/compliance/risk filters, saved filters,
// risk-sortable column with a "what's driving this score" popover, five
// OS-version mini-badges, and the bulk action bar (run workflow, re-attest,
// add tag, move segment). Table-local filter/selection state mirrors the
// original's per-component ownership rather than living in the Pinia store.
import { EmptyState } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useDevicesStore, type NormalizedDevice } from "../../stores/devices";
import type { Workflow } from "../../stores/workflows";
import { useWorkflowsStore } from "../../stores/workflows";
import type { SegmentNode } from "../../lib/segments";
import DeviceMockup from "./DeviceMockup.vue";
import SegmentPickerModal from "./SegmentPickerModal.vue";
import WorkflowPickerModal from "./WorkflowPickerModal.vue";
import WorkflowRunResultModal from "./WorkflowRunResultModal.vue";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";

const props = defineProps<{
  devices: NormalizedDevice[];
  segments: SegmentNode[];
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  "open-device": [deviceId: string];
}>();

const store = useDevicesStore();
const workflowsStore = useWorkflowsStore();

// ── Filter/sort/selection state (all local — matches DeviceFleetTable.jsx) ──
const search = ref("");
const platformFilter = ref<"all" | "apple" | "android" | "windows" | "macos">("all");
const complianceFilter = ref<"all" | "non_compliant">("all");
const riskFilter = ref<"all" | "low" | "medium" | "high" | "critical">("all");
const minRiskScore = ref("");
const maxRiskScore = ref("");
const sortBy = ref<null | "risk">(null);
const sortDir = ref<"asc" | "desc">("desc");
const selectedIds = ref<Set<string>>(new Set());
const expandedRiskId = ref<string | null>(null);

const PLATFORM_FILTERS: Array<{ key: typeof platformFilter.value; label: string }> = [
  { key: "all", label: "All" },
  { key: "apple", label: "iOS/iPadOS/tvOS" },
  { key: "android", label: "Android" },
  { key: "windows", label: "Windows" },
  { key: "macos", label: "macOS" },
];

// ── Saved filters (localStorage, matches huginn.devices.savedFilters) ──
const SAVED_FILTERS_KEY = "huginn.devices.savedFilters";
interface SavedFilter {
  name: string;
  filters: { search: string; platformFilter: string; complianceFilter: string; riskFilter: string; minRiskScore: string; maxRiskScore: string };
}
function loadSavedFilters(): SavedFilter[] {
  try {
    const raw = window.localStorage.getItem(SAVED_FILTERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function persistSavedFilters(list: SavedFilter[]) {
  try {
    window.localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — saved filters just won't persist this session
  }
}
const savedFilters = ref<SavedFilter[]>(loadSavedFilters());

function handleSaveCurrentFilter() {
  const name = window.prompt("Name this filter set:");
  if (!name || !name.trim()) return;
  const next = [
    ...savedFilters.value.filter((f) => f.name !== name.trim()),
    {
      name: name.trim(),
      filters: {
        search: search.value,
        platformFilter: platformFilter.value,
        complianceFilter: complianceFilter.value,
        riskFilter: riskFilter.value,
        minRiskScore: minRiskScore.value,
        maxRiskScore: maxRiskScore.value,
      },
    },
  ];
  savedFilters.value = next;
  persistSavedFilters(next);
}
function applySavedFilter(f: SavedFilter) {
  const flt = f.filters || ({} as SavedFilter["filters"]);
  search.value = flt.search || "";
  platformFilter.value = (flt.platformFilter as typeof platformFilter.value) || "all";
  complianceFilter.value = (flt.complianceFilter as typeof complianceFilter.value) || "all";
  riskFilter.value = (flt.riskFilter as typeof riskFilter.value) || "all";
  minRiskScore.value = flt.minRiskScore ?? "";
  maxRiskScore.value = flt.maxRiskScore ?? "";
}
function deleteSavedFilter(name: string) {
  const next = savedFilters.value.filter((f) => f.name !== name);
  savedFilters.value = next;
  persistSavedFilters(next);
}

// ── Bulk actions ──
const isPickingWorkflow = ref(false);
const runResult = ref<any>(null);
const isReattesting = ref(false);
const reattestResult = ref<{ succeeded: number; total: number } | null>(null);
const isBulkTagging = ref(false);
const bulkTagDraft = ref("");
const isBulkMovingSegment = ref(false);
const isBulkActing = ref(false);
const bulkActionResult = ref<{ label: string; succeeded: number; total: number } | null>(null);

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

async function handleRunWorkflow(workflow: Workflow) {
  isPickingWorkflow.value = false;
  const targets = props.devices.filter((d) => selectedIds.value.has(d.id));
  try {
    const run = await workflowsStore.runWorkflow(
      workflow.id,
      targets.map((d) => ({
        id: d.id,
        displayName: d.displayName,
        platform: d.platform,
        platformDeviceId: d.platformDeviceId,
        serialNumber: d.serialNumber,
        osVersion: d.osVersion,
        manufacturer: d.manufacturer,
        model: d.model,
        udid: d.identifiers?.udid,
        mdmUser: d.mdmUser,
      })),
    );
    runResult.value = run;
    selectedIds.value = new Set();
  } catch (err: any) {
    window.alert(err?.response?.data?.detail || "Failed to run workflow.");
  }
}

async function handleBulkReattest() {
  const targetIds = [...selectedIds.value];
  if (targetIds.length === 0) return;
  if (!window.confirm(`Push the security-attestation reporter to ${targetIds.length} selected device(s) now? Devices without a reporter script (Android/iOS) will be skipped.`)) return;
  isReattesting.value = true;
  try {
    const res = await store.bulkReattest(targetIds);
    reattestResult.value = { succeeded: res.succeeded, total: res.total };
    selectedIds.value = new Set();
  } catch (err: any) {
    window.alert(err?.response?.data?.detail || "Failed to push re-attestation.");
  } finally {
    isReattesting.value = false;
  }
}

async function handleBulkAddTag() {
  const tag = bulkTagDraft.value.trim();
  if (!tag) return;
  const targets = props.devices.filter((d) => selectedIds.value.has(d.id));
  isBulkActing.value = true;
  isBulkTagging.value = false;
  bulkTagDraft.value = "";
  try {
    const results = await Promise.allSettled(
      targets.map((d) => {
        const nextTags = (d.tags || []).includes(tag) ? d.tags || [] : [...(d.tags || []), tag];
        return store.updateTags(d.platformDeviceId, d.platform, nextTags);
      }),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    bulkActionResult.value = { label: `Tag "${tag}" added`, succeeded, total: targets.length };
    selectedIds.value = new Set();
  } finally {
    isBulkActing.value = false;
  }
}

async function handleBulkMoveSegment(segment: SegmentNode) {
  isBulkMovingSegment.value = false;
  const targets = props.devices.filter((d) => selectedIds.value.has(d.id));
  isBulkActing.value = true;
  try {
    const results = await Promise.allSettled(targets.map((d) => store.updateSegment(d.platformDeviceId, d.platform, Number(segment.id))));
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    bulkActionResult.value = { label: `Moved to "${segment.name || "segment"}"`, succeeded, total: targets.length };
    selectedIds.value = new Set();
  } finally {
    isBulkActing.value = false;
  }
}

// ── Filtering/sorting ──
const nonCompliantCount = computed(() => props.devices.filter((d) => !d.isCompliant).length);

const filtered = computed(() => {
  const term = search.value.toLowerCase();
  return props.devices.filter((d) => {
    if (term) {
      const u = d.mdmUser as any;
      const userName = (u?.name || `${u?.firstName || ""} ${u?.lastName || ""}`).toLowerCase();
      const tags = (d.tags || []).join(" ").toLowerCase();
      if (
        !d.displayName.toLowerCase().includes(term) &&
        !userName.includes(term) &&
        !(u?.email || "").toLowerCase().includes(term) &&
        !tags.includes(term) &&
        !(d.serialNumber || "").toLowerCase().includes(term) &&
        !(d.imei || "").toLowerCase().includes(term) &&
        !(d.model || "").toLowerCase().includes(term)
      )
        return false;
    }
    if (platformFilter.value !== "all" && d.platform !== platformFilter.value) return false;
    if (complianceFilter.value === "non_compliant" && d.isCompliant) return false;
    if (riskFilter.value !== "all" && d.riskTier !== riskFilter.value) return false;
    if (minRiskScore.value !== "" && (d.riskScore ?? 0) < Number(minRiskScore.value)) return false;
    if (maxRiskScore.value !== "" && (d.riskScore ?? 0) > Number(maxRiskScore.value)) return false;
    return true;
  });
});

const sorted = computed(() => {
  if (sortBy.value !== "risk") return filtered.value;
  const copy = [...filtered.value];
  copy.sort((a, b) => {
    const diff = (a.riskScore ?? 0) - (b.riskScore ?? 0);
    return sortDir.value === "asc" ? diff : -diff;
  });
  return copy;
});

function toggleRiskSort() {
  if (sortBy.value !== "risk") {
    sortBy.value = "risk";
    sortDir.value = "desc";
  } else if (sortDir.value === "desc") {
    sortDir.value = "asc";
  } else {
    sortBy.value = null;
  }
}

// ── Cell helpers ──
function batteryColor(pct: number) {
  if (pct >= 50) return SUCCESS;
  if (pct >= 20) return WARNING;
  return DANGER;
}

function getUserInitials(user: any): string {
  if (!user) return "?";
  if (user.name) {
    const parts = user.name.trim().split(" ");
    return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
  }
  return (user.firstName?.[0] || "") + (user.lastName?.[0] || "");
}
function getUserDisplayName(user: any): string {
  if (!user) return "";
  if (user.name) return user.name;
  return `${user.firstName || ""} ${user.lastName || ""}`.trim();
}

function formatLastSeen(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const RISK_TIER_META: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: SUCCESS },
  medium: { label: "Medium", color: WARNING },
  high: { label: "High", color: "#F97316" },
  critical: { label: "Critical", color: DANGER },
};
function riskMeta(tier: string) {
  return RISK_TIER_META[tier] || RISK_TIER_META.low;
}

// OS-version mini-badges — each returns null (render nothing) or
// {text,color,title}. Fields are TODO(Phase3) on the backend today (always
// null), so these render nothing until that catalog-refresher work lands —
// see the NormalizedDevice comment in stores/devices.ts.
function osUpdateBadge(status: any) {
  if (!status) return null;
  if (status.confidence === "unknown") return { text: "Patch level unconfirmed", color: "#6B7280", title: "A newer Windows security update may exist for this build, but we couldn't confirm the exact patch level from Microsoft's catalog." };
  if (status.pendingCount > 0) {
    const worst = status.pendingKbs?.[0];
    return {
      text: `${status.pendingCount} update${status.pendingCount === 1 ? "" : "s"} behind`,
      color: WARNING,
      title: `${status.pendingCount} security update(s) behind — latest known KB${worst ? ` ${worst.kb} (${worst.maxSeverity || "unknown severity"})` : ""}`,
    };
  }
  return { text: "Up to date", color: SUCCESS, title: "" };
}
function vulnBadge(status: any) {
  if (!status) return null;
  if (status.confidence === "unknown") return { text: "Vuln status unconfirmed", color: "#6B7280", title: "No confirmed vulnerability comparison available for this OS version yet." };
  if (status.pendingCount > 0) {
    const worst = status.pendingCves?.[0];
    return {
      text: `${status.pendingCount} CVE${status.pendingCount === 1 ? "" : "s"} pending`,
      color: worst?.exploited ? DANGER : WARNING,
      title: `${status.pendingCount} known CVE(s) fixed in a newer version${worst ? ` — worst: ${worst.cveId} (${worst.baseSeverity || "unknown"}${worst.exploited ? ", exploited in the wild" : ""})` : ""}`,
    };
  }
  return { text: "No known pending CVEs", color: SUCCESS, title: "" };
}
function vulnServiceBadge(status: any) {
  if (!status) return null;
  if (!status.checked) {
    if (!status.lastCheckedAt) return { text: "Vuln Service: pending", color: "#6B7280", title: "Vulnerability Service: not checked yet — waiting on the next scheduled refresh." };
    return { text: "Vuln Service: check stale", color: "#6B7280", title: `Vulnerability Service: last checked ${new Date(status.lastCheckedAt).toLocaleString()} — nothing conclusive found then, and it hasn't been refreshed since.` };
  }
  const counts = status.counts || {};
  const criticalHigh = (counts.CRITICAL || 0) + (counts.HIGH || 0);
  const mediumLow = (counts.MEDIUM || 0) + (counts.LOW || 0);
  if (status.hasKev) return { text: "Known-exploited CVE (Vuln Service)", color: DANGER, title: "A known-exploited CVE (CISA KEV) is present (Vulnerability Service)." };
  if (criticalHigh > 0) return { text: `${criticalHigh} critical/high CVE${criticalHigh === 1 ? "" : "s"} (Vuln Service)`, color: DANGER, title: `${criticalHigh} critical/high CVE(s) found across the OS and installed apps (Vulnerability Service).` };
  if (mediumLow > 0) return { text: `${mediumLow} medium/low CVE${mediumLow === 1 ? "" : "s"} (Vuln Service)`, color: WARNING, title: "Only medium/low severity CVEs found (Vulnerability Service)." };
  return { text: "No known CVEs (Vuln Service)", color: SUCCESS, title: "" };
}
function lifecycleBadge(status: any) {
  if (!status) return null;
  const rsr = status.rapidSecurityResponse?.available ? { text: "Rapid Security Response available", color: WARNING, title: `A Rapid Security Response is available${status.rapidSecurityResponse.cveIds?.length ? `: ${status.rapidSecurityResponse.cveIds.join(", ")}` : ""}.` } : null;
  if (status.confidence === "unknown" || status.isEol === null || status.isEol === undefined) return rsr;
  if (status.isEol) {
    const esu = status.esuUntil ? ` (paid ESU available until ${status.esuUntil})` : "";
    return { text: "Unsupported OS", color: DANGER, title: `This OS version has reached end of life for security support${esu}.`, extra: rsr };
  }
  if (status.onLatestVersion === false) {
    const buildSuffix = status.latestKnownBuild ? ` (${status.latestKnownBuild})` : "";
    return { text: `Not on latest (${status.latestKnownVersion})`, color: "#6B7280", title: `A newer version is available: ${status.latestKnownVersion}${buildSuffix}.`, extra: rsr };
  }
  return rsr;
}
function appUpdateBadge(status: any) {
  if (!status) return null;
  if (status.pendingCount > 0) {
    const names = (status.pendingApps || []).slice(0, 3).map((a: any) => a.name).filter(Boolean).join(", ");
    return { text: `${status.pendingCount} app update${status.pendingCount === 1 ? "" : "s"} pending`, color: WARNING, title: `${status.pendingCount} app(s) with an update available${names ? `: ${names}` : ""}` };
  }
  return { text: "Apps up to date", color: SUCCESS, title: "" };
}

onMounted(() => {
  if (workflowsStore.workflows.length === 0) workflowsStore.fetchWorkflows();
});
</script>

<template>
  <div class="rounded-xl overflow-hidden bg-white border border-gray-200 shadow-sm">
    <!-- Toolbar -->
    <div class="p-4 flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3 border-b border-gray-200">
      <div class="relative flex-1 max-w-sm">
        <component :is="ICONS.Magnifer" :size="15" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
        <input
          v-model="search"
          type="text"
          placeholder="Search devices, users, serial, IMEI…"
          class="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 bg-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
        />
      </div>

      <div class="inline-flex rounded-lg overflow-hidden border border-gray-200">
        <button
          v-for="p in PLATFORM_FILTERS"
          :key="p.key"
          class="px-3 py-2 text-xs font-medium transition-colors border-r border-gray-200 last:border-r-0"
          :style="{ backgroundColor: platformFilter === p.key ? PRIMARY_BLUE : '#fff', color: platformFilter === p.key ? '#fff' : '#111827' }"
          @click="platformFilter = p.key"
        >
          {{ p.label }}
        </button>
      </div>

      <button
        class="px-3 py-2 text-xs font-semibold rounded-lg transition-all ml-1 border"
        :style="
          complianceFilter === 'non_compliant'
            ? { backgroundColor: DANGER, color: '#fff', borderColor: DANGER }
            : { backgroundColor: `${DANGER}12`, color: DANGER, borderColor: `${DANGER}30` }
        "
        @click="complianceFilter = complianceFilter === 'non_compliant' ? 'all' : 'non_compliant'"
      >
        Non-compliant{{ complianceFilter !== "non_compliant" ? ` (${nonCompliantCount})` : "" }}
      </button>

      <select v-model="riskFilter" class="px-2.5 py-2 text-xs font-medium rounded-lg outline-none border border-gray-200 bg-white">
        <option value="all">All risk tiers</option>
        <option value="low">Low risk</option>
        <option value="medium">Medium risk</option>
        <option value="high">High risk</option>
        <option value="critical">Critical risk</option>
      </select>

      <div class="flex items-center gap-1">
        <input v-model="minRiskScore" type="number" min="0" max="100" placeholder="Min" class="w-16 px-2 py-2 text-xs rounded-lg outline-none border border-gray-200" />
        <span class="text-xs text-gray-400">–</span>
        <input v-model="maxRiskScore" type="number" min="0" max="100" placeholder="Max" class="w-16 px-2 py-2 text-xs rounded-lg outline-none border border-gray-200" />
      </div>

      <select v-if="savedFilters.length > 0" class="px-2.5 py-2 text-xs font-medium rounded-lg outline-none border border-gray-200 bg-white max-w-[140px]" @change="(e) => { const f = savedFilters.find(x => x.name === (e.target as HTMLSelectElement).value); if (f) applySavedFilter(f); (e.target as HTMLSelectElement).value = ''; }">
        <option value="">Saved filters…</option>
        <option v-for="f in savedFilters" :key="f.name" :value="f.name">{{ f.name }}</option>
      </select>
      <button title="Save the current search/filter combination for reuse" class="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium border border-gray-200 text-gray-700" @click="handleSaveCurrentFilter">
        <component :is="ICONS.BookmarkSquare" :size="13" weight="Linear" />
      </button>

      <span class="text-xs ml-auto shrink-0 text-gray-400">{{ filtered.length }} of {{ devices.length }}</span>
    </div>

    <div v-if="savedFilters.length > 0" class="px-4 py-1.5 flex items-center gap-1.5 flex-wrap border-b border-gray-200">
      <span v-for="f in savedFilters" :key="f.name" class="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500">
        <button @click="applySavedFilter(f)">{{ f.name }}</button>
        <button style="color: #ef4444" @click="deleteSavedFilter(f.name)">
          <component :is="ICONS.TrashBinMinimalistic" :size="9" weight="Linear" />
        </button>
      </span>
    </div>

    <!-- Bulk action bar -->
    <div v-if="selectedIds.size > 0" class="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200" :style="{ backgroundColor: `${PRIMARY_BLUE}08` }">
      <span class="text-xs font-medium" :style="{ color: PRIMARY_BLUE }">{{ selectedIds.size }} selected</span>
      <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200" @click="isPickingWorkflow = true">
        <component :is="ICONS.Play" :size="12" weight="Linear" /> Run workflow…
      </button>
      <button
        :disabled="isReattesting"
        title="Push the Windows/macOS security-attestation reporter script now instead of waiting for its next scheduled run"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700 disabled:opacity-50"
        @click="handleBulkReattest"
      >
        <component :is="ICONS.RefreshCircle" :size="12" weight="Linear" :class="isReattesting ? 'animate-spin' : ''" /> {{ isReattesting ? "Pushing…" : "Re-attest now" }}
      </button>
      <button :disabled="isBulkActing" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700 disabled:opacity-50" @click="isBulkTagging = true">
        <component :is="ICONS.Tag" :size="12" weight="Linear" /> Add tag…
      </button>
      <button :disabled="isBulkActing" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700 disabled:opacity-50" @click="isBulkMovingSegment = true">
        <component :is="ICONS.Layers" :size="12" weight="Linear" /> Move segment…
      </button>
      <button class="text-xs text-gray-400" @click="selectedIds = new Set()">Clear</button>
    </div>

    <div v-if="isBulkTagging" class="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200" :style="{ backgroundColor: `${PRIMARY_BLUE}08` }">
      <input
        v-model="bulkTagDraft"
        autofocus
        placeholder="Tag to add to all selected devices…"
        class="flex-1 max-w-xs px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-200 focus:ring-2 focus:ring-brand-500"
        @keydown.enter="handleBulkAddTag"
        @keydown.escape="isBulkTagging = false"
      />
      <button :disabled="!bulkTagDraft.trim()" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 disabled:opacity-50" @click="handleBulkAddTag">Apply</button>
      <button class="text-xs text-gray-400" @click="isBulkTagging = false">Cancel</button>
    </div>

    <div v-if="reattestResult" class="flex items-center justify-between gap-3 px-4 py-2.5 text-xs border-b border-gray-200 text-gray-900" :style="{ backgroundColor: `${SUCCESS}08` }">
      <span>Re-attestation pushed to {{ reattestResult.succeeded }}/{{ reattestResult.total }} device(s){{ reattestResult.succeeded < reattestResult.total ? " — some were skipped (unsupported platform or push failure)" : "" }}.</span>
      <button class="font-semibold shrink-0 text-gray-400" @click="reattestResult = null">Dismiss</button>
    </div>

    <div v-if="bulkActionResult" class="flex items-center justify-between gap-3 px-4 py-2.5 text-xs border-b border-gray-200 text-gray-900" :style="{ backgroundColor: `${SUCCESS}08` }">
      <span>{{ bulkActionResult.label }} on {{ bulkActionResult.succeeded }}/{{ bulkActionResult.total }} device(s){{ bulkActionResult.succeeded < bulkActionResult.total ? " — some failed" : "" }}.</span>
      <button class="font-semibold shrink-0 text-gray-400" @click="bulkActionResult = null">Dismiss</button>
    </div>

    <!-- Table -->
    <EmptyState v-if="filtered.length === 0 && !isLoading" title="No devices match your filters" description="Try adjusting your search or filter criteria" />
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm text-left">
        <thead class="bg-gray-50">
          <tr>
            <th class="pl-4 pr-1 py-2.5 w-6">
              <input
                type="checkbox"
                :checked="filtered.length > 0 && filtered.every((d) => selectedIds.has(d.id))"
                @change="selectedIds = ($event.target as HTMLInputElement).checked ? new Set(filtered.map((d) => d.id)) : new Set()"
              />
            </th>
            <th v-for="h in ['Device', 'Employee', 'Hardware', 'OS Version', 'Compliance']" :key="h" class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              {{ h }}
            </th>
            <th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider">
              <button class="inline-flex items-center gap-1 uppercase tracking-wider" :style="{ color: sortBy === 'risk' ? PRIMARY_BLUE : '#9CA3AF' }" @click="toggleRiskSort">
                Risk <component :is="ICONS.SortVertical" :size="11" weight="Linear" />
              </button>
            </th>
            <th v-for="h in ['Last Seen', '']" :key="h" class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{{ h }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(d, idx) in sorted" :key="d.id" class="transition-colors cursor-pointer select-none hover:bg-gray-50" :class="idx > 0 ? 'border-t border-gray-100' : ''" @click="emit('open-device', d.id)">
            <td class="pl-4 pr-1 py-3 w-6" @click.stop>
              <input type="checkbox" :checked="selectedIds.has(d.id)" @change="toggleSelect(d.id)" />
            </td>
            <td class="px-3 py-3">
              <div class="flex items-center gap-2">
                <DeviceMockup :platform="d.platform" />
                <div class="min-w-0">
                  <p class="font-semibold truncate text-gray-900">{{ d.displayName }}</p>
                  <span class="text-[11px] text-gray-400">{{ d.platformLabel }}</span>
                </div>
              </div>
            </td>
            <td class="px-3 py-3">
              <div v-if="d.mdmUser" class="flex items-start gap-2.5 min-w-0">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5" :style="{ backgroundColor: `${PRIMARY_BLUE}18`, color: PRIMARY_BLUE }">
                  {{ getUserInitials(d.mdmUser).toUpperCase() }}
                </div>
                <div class="min-w-0 flex-1">
                  <p v-if="getUserDisplayName(d.mdmUser)" class="text-xs font-semibold truncate leading-tight text-gray-900">{{ getUserDisplayName(d.mdmUser) }}</p>
                  <p v-if="(d.mdmUser as any).email" class="text-[11px] truncate leading-tight mt-0.5 text-gray-400">{{ (d.mdmUser as any).email }}</p>
                </div>
              </div>
              <span v-else class="text-xs text-gray-400">Unassigned</span>
            </td>
            <td class="px-3 py-3">
              <div class="min-w-0">
                <p class="text-xs font-medium truncate max-w-[160px] text-gray-900">{{ d.manufacturer ? `${d.manufacturer} ${d.model}`.trim() : d.model || "—" }}</p>
                <div v-if="d.battery !== null && d.battery !== undefined" class="flex items-center gap-1 mt-1">
                  <component :is="ICONS.BatteryFull" :size="11" weight="Linear" :style="{ color: batteryColor(d.battery) }" />
                  <span class="text-[10px] font-semibold" :style="{ color: batteryColor(d.battery) }">{{ d.battery }}%</span>
                  <div class="w-12 h-1 rounded-full overflow-hidden bg-gray-200">
                    <div class="h-full rounded-full" :style="{ width: `${d.battery}%`, backgroundColor: batteryColor(d.battery) }" />
                  </div>
                </div>
              </div>
            </td>
            <td class="px-3 py-3">
              <div class="flex flex-col">
                <span class="text-xs text-gray-400">{{ d.osVersion || "—" }}</span>
                <span v-if="osUpdateBadge(d.osUpdateStatus)" :title="osUpdateBadge(d.osUpdateStatus)!.title" class="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" :style="{ color: osUpdateBadge(d.osUpdateStatus)!.color }">
                  {{ osUpdateBadge(d.osUpdateStatus)!.text }}
                </span>
                <span v-if="vulnBadge(d.vulnStatus)" :title="vulnBadge(d.vulnStatus)!.title" class="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" :style="{ color: vulnBadge(d.vulnStatus)!.color }">
                  {{ vulnBadge(d.vulnStatus)!.text }}
                </span>
                <span v-if="vulnServiceBadge(d.vulnServiceStatus)" :title="vulnServiceBadge(d.vulnServiceStatus)!.title" class="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" :style="{ color: vulnServiceBadge(d.vulnServiceStatus)!.color }">
                  {{ vulnServiceBadge(d.vulnServiceStatus)!.text }}
                </span>
                <template v-if="lifecycleBadge(d.osLifecycleStatus)">
                  <span :title="lifecycleBadge(d.osLifecycleStatus)!.title" class="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" :style="{ color: lifecycleBadge(d.osLifecycleStatus)!.color }">
                    {{ lifecycleBadge(d.osLifecycleStatus)!.text }}
                  </span>
                  <span v-if="(lifecycleBadge(d.osLifecycleStatus) as any).extra" :title="(lifecycleBadge(d.osLifecycleStatus) as any).extra.title" class="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" :style="{ color: (lifecycleBadge(d.osLifecycleStatus) as any).extra.color }">
                    {{ (lifecycleBadge(d.osLifecycleStatus) as any).extra.text }}
                  </span>
                </template>
                <span v-if="appUpdateBadge(d.appleAppUpdateStatus)" :title="appUpdateBadge(d.appleAppUpdateStatus)!.title" class="inline-flex items-center gap-1 mt-1 text-[10px] font-medium" :style="{ color: appUpdateBadge(d.appleAppUpdateStatus)!.color }">
                  {{ appUpdateBadge(d.appleAppUpdateStatus)!.text }}
                </span>
              </div>
            </td>
            <td class="px-3 py-3">
              <span
                :title="(d as any).complianceViolations?.length ? `Violates: ${(d as any).complianceViolations.map((v: any) => v.policyName || 'Unnamed policy').join(', ')}` : undefined"
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                :style="{ backgroundColor: d.isCompliant ? `${SUCCESS}15` : `${DANGER}15`, color: d.isCompliant ? SUCCESS : DANGER }"
              >
                <component :is="d.isCompliant ? ICONS.ShieldCheck : ICONS.ShieldWarning" :size="12" weight="Linear" />
                {{ d.isCompliant ? "Compliant" : "Non-compliant" }}
              </span>
            </td>
            <td class="px-3 py-3 relative">
              <div class="flex items-center gap-1.5 flex-wrap">
                <button @click.stop="expandedRiskId = expandedRiskId === d.id ? null : d.id">
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" :style="{ backgroundColor: `${riskMeta(d.riskTier).color}15`, color: riskMeta(d.riskTier).color }" :title="`Risk score: ${d.riskScore}/100`">
                    {{ riskMeta(d.riskTier).label }} · {{ d.riskScore }}
                  </span>
                </button>
                <div v-if="expandedRiskId === d.id" class="absolute z-20 top-full left-3 mt-1 w-64 rounded-lg shadow-xl p-3 bg-white border border-gray-200" @click.stop>
                  <p class="text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-gray-400">What's driving this score</p>
                  <p v-if="(d.riskFactors || []).length === 0" class="text-xs text-gray-400">No contributing factors — baseline score.</p>
                  <div v-else class="space-y-1">
                    <div v-for="(f, fi) in d.riskFactors" :key="fi" class="flex items-center justify-between gap-2 text-xs">
                      <span class="text-gray-900">{{ f.label }}</span>
                      <span class="font-semibold shrink-0" style="color: #ef4444">+{{ f.points }}</span>
                    </div>
                  </div>
                </div>
                <span v-if="d.activeViolations?.length > 0" :title="`${d.activeViolations.length} active violation(s) — open the device to view`" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold" :style="{ backgroundColor: `${DANGER}12`, color: DANGER }">
                  <component :is="ICONS.DangerTriangle" :size="9" weight="Linear" /> {{ d.activeViolations.length }}
                </span>
                <span v-if="d.openCases?.length > 0" :title="`${d.openCases.length} open case(s) — open the device to view`" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
                  <component :is="ICONS.Folder" :size="9" weight="Linear" /> {{ d.openCases.length }}
                </span>
              </div>
            </td>
            <td class="px-3 py-3">
              <span class="text-xs text-gray-400">{{ formatLastSeen(d.lastSeen) }}</span>
            </td>
            <td class="px-3 py-3 w-6">
              <component :is="ICONS.AltArrowRight" :size="14" weight="Linear" class="text-gray-400" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <WorkflowPickerModal :open="isPickingWorkflow" @close="isPickingWorkflow = false" @confirm="handleRunWorkflow" />
    <SegmentPickerModal v-if="isBulkMovingSegment" :open="isBulkMovingSegment" :segments="segments" :current-segment-id="null" @close="isBulkMovingSegment = false" @select="handleBulkMoveSegment" />
    <WorkflowRunResultModal :open="!!runResult" :run="runResult" @close="runResult = null" />
  </div>
</template>
