<script setup lang="ts">
// Compliance Policies list — restyled to match DeviceFleetTable.vue's list
// experience (Devices main view): a toolbar with a search box + status
// filter, a sortable-column table on desktop, and a stacked card list on
// narrow screens (<768px, via useBreakpoint) — same split DeviceFleetTable
// uses for its own mobile fallback. The per-policy toggle badges (Enabled/
// Disabled, Auto-run/Review first, autoRun tripped, Cases, Alerts) and the
// evaluate/edit/delete actions are unchanged; they're grouped into a single
// "Status" column same as Devices groups its own OS-update/vuln/lifecycle
// mini-badges into one "OS Version" column rather than one column each.
import { EmptyState } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ICONS } from "../../lib/solarIcons";
import { useBreakpoint } from "../../composables/useBreakpoint";
import { useComplianceStore, type CompliancePolicy } from "../../stores/compliance";
import { useWorkflowsStore } from "../../stores/workflows";

const SUCCESS = "#22C55E";
const DANGER = "#EF4444";
const WARNING = "#F59E0B";
const PRIMARY_BLUE = "#0241E3";

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS", macos: "macOS", android: "Android", windows: "Windows" };
const DEPLOYMENT_MODEL_LABELS: Record<string, string> = {
  supervised: "Supervised", unsupervised: "Unsupervised",
  work_profile: "Work Profile", cope: "COPE", device_owner: "Device Owner",
};

const props = defineProps<{
  policies: CompliancePolicy[];
  isLoading?: boolean;
  // Segment-scoping context (CompliancePoliciesView.jsx:452-457) — lets the
  // empty state tell "no policies exist at all" apart from "none in this
  // Segment", same distinction the original makes.
  totalPoliciesCount?: number;
  segmentName?: string | null;
}>();

const emit = defineEmits<{
  edit: [policy: CompliancePolicy];
  "open-violators": [policy: CompliancePolicy];
}>();

const store = useComplianceStore();
const workflowsStore = useWorkflowsStore();
const router = useRouter();
const { isMobile } = useBreakpoint();
const evaluatingPolicyId = ref<string | null>(null);

const workflowsById = computed(() => Object.fromEntries(workflowsStore.workflows.map((w) => [w.id, w])));

// Workflow column shows only an icon (see the desktop table below) — the
// policy name and the workflow name were fighting for space in the same
// row, and the workflow name reading as plain text made it look
// informational rather than a link. Clicking it opens that workflow
// straight into edit mode via WorkflowsView.vue's own ?editWorkflowId=
// query-param handling — the same cross-view-link pattern already used by
// openDeviceAudit/openCase/openApp in DeviceDetailDrawer.vue.
function openWorkflowEdit(p: CompliancePolicy) {
  if (!p.workflowId) return;
  router.push({ path: "/workflows", query: { editWorkflowId: p.workflowId } });
}

onMounted(async () => {
  if (workflowsStore.workflows.length === 0) await workflowsStore.fetchWorkflows();
  if (props.policies.length > 0) await store.refreshViolatorCounts(props.policies.map((p) => p.id));
});

function conditionSummary(p: CompliancePolicy): string {
  const n = p.conditions?.length || 0;
  if (n === 0) return "No conditions";
  const logic = p.conditionLogic === "all" ? "ALL" : "ANY";
  return `${n} condition${n === 1 ? "" : "s"} (match ${logic})`;
}

function timeAgo(isoString?: string | null): string | null {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

async function toggleField(p: CompliancePolicy, field: "enabled" | "autoRun" | "openCaseOnViolation") {
  await store.updatePolicy(p.id, { ...p, [field]: !p[field] });
}

async function evaluate(p: CompliancePolicy) {
  evaluatingPolicyId.value = p.id;
  try {
    await store.evaluateNow(p.id);
  } finally {
    evaluatingPolicyId.value = null;
  }
}

async function remove(p: CompliancePolicy) {
  if (!confirm(`Delete policy "${p.name}"? This cannot be undone.`)) return;
  await store.deletePolicy(p.id);
}

// ── Toolbar: search + status filter (platform stays a page-level control in
// ComplianceView.vue, since it also scopes the "Evaluate now" dropdown) ──
const search = ref("");
const statusFilter = ref<"all" | "enabled" | "disabled">("all");

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  return props.policies.filter((p) => {
    if (statusFilter.value === "enabled" && !p.enabled) return false;
    if (statusFilter.value === "disabled" && p.enabled) return false;
    if (!term) return true;
    return (
      p.name.toLowerCase().includes(term) ||
      (p.description || "").toLowerCase().includes(term) ||
      (p.framework || "").toLowerCase().includes(term) ||
      (p.controlRef || "").toLowerCase().includes(term) ||
      (workflowsById.value[p.workflowId ?? ""]?.name || "").toLowerCase().includes(term)
    );
  });
});

type SortKey = "name" | "platform" | "workflow" | "violators" | "lastEvaluated";
const sortBy = ref<SortKey | null>(null);
const sortDir = ref<"asc" | "desc">("asc");
const DEFAULT_SORT_DIR: Record<SortKey, "asc" | "desc"> = { name: "asc", platform: "asc", workflow: "asc", violators: "desc", lastEvaluated: "desc" };

function platformLabel(p: CompliancePolicy): string {
  return p.targetPlatform ? PLATFORM_LABELS[p.targetPlatform] ?? p.targetPlatform : "Common";
}

const sorted = computed(() => {
  if (!sortBy.value) return filtered.value;
  const key = sortBy.value;
  const dir = sortDir.value === "asc" ? 1 : -1;
  const copy = [...filtered.value];
  copy.sort((a, b) => {
    switch (key) {
      case "name":
        return dir * a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      case "platform":
        return dir * platformLabel(a).localeCompare(platformLabel(b));
      case "workflow":
        return dir * (workflowsById.value[a.workflowId ?? ""]?.name || "").localeCompare(workflowsById.value[b.workflowId ?? ""]?.name || "");
      case "violators":
        return dir * ((store.violatorCounts[a.id] ?? -1) - (store.violatorCounts[b.id] ?? -1));
      case "lastEvaluated": {
        const ta = a.lastEvaluatedAt ? new Date(a.lastEvaluatedAt).getTime() : -Infinity;
        const tb = b.lastEvaluatedAt ? new Date(b.lastEvaluatedAt).getTime() : -Infinity;
        return dir * (ta - tb);
      }
      default:
        return 0;
    }
  });
  return copy;
});

function toggleSort(key: SortKey) {
  if (sortBy.value !== key) {
    sortBy.value = key;
    sortDir.value = DEFAULT_SORT_DIR[key];
  } else if (sortDir.value === DEFAULT_SORT_DIR[key]) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortBy.value = null;
  }
}

// "Workflow" is deliberately not in this list — its column shows only an
// icon (see openWorkflowEdit above), so a sortable text header for it would
// be misleading (nothing in the column itself reflects sort order visually).
const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Policy" },
  { key: "platform", label: "Platform" },
  { key: "violators", label: "Violators" },
  { key: "lastEvaluated", label: "Last Evaluated" },
];
</script>

<template>
  <div v-if="!isLoading && policies.length === 0">
    <EmptyState
      :title="(totalPoliciesCount ?? 0) === 0 ? 'No Compliance Policies yet' : `No policies in ${segmentName || 'this segment'}`"
      :description="
        (totalPoliciesCount ?? 0) === 0
          ? 'Define what &quot;out of compliance&quot; means and link it to a workflow to run automatically.'
          : 'Switch to Global or another segment to see more, or create one scoped to this segment.'
      "
    />
  </div>
  <div v-else class="rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
    <!-- Toolbar — matches DeviceFleetTable.vue's search+filter+count row -->
    <div class="p-4 flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3 border-b border-gray-200 dark:border-gray-700">
      <div class="relative flex-1 max-w-sm">
        <component :is="ICONS.Magnifer" :size="15" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
        <input
          v-model="search"
          type="text"
          placeholder="Search policies, description, framework…"
          class="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
        />
      </div>

      <div class="inline-flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
        <button
          v-for="s in [{ key: 'all', label: 'All' }, { key: 'enabled', label: 'Enabled' }, { key: 'disabled', label: 'Disabled' }] as const"
          :key="s.key"
          class="px-3 py-2 text-xs font-medium transition-colors border-r border-gray-200 dark:border-gray-700 last:border-r-0"
          :class="statusFilter !== s.key ? 'bg-white dark:bg-gray-800' : ''"
          :style="{ backgroundColor: statusFilter === s.key ? PRIMARY_BLUE : undefined, color: statusFilter === s.key ? '#fff' : 'var(--foreground)' }"
          @click="statusFilter = s.key"
        >
          {{ s.label }}
        </button>
      </div>

      <span class="text-xs ml-auto shrink-0 text-gray-400">{{ filtered.length }} of {{ policies.length }}</span>
    </div>

    <EmptyState v-if="filtered.length === 0" title="No policies match your filters" description="Try adjusting your search or status filter." />

    <!-- Mobile (<768px) — stacked cards, same content as before this pass -->
    <div v-else-if="isMobile" class="divide-y divide-gray-100 dark:divide-gray-800">
      <div v-for="p in sorted" :key="p.id" class="p-4">
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: `${WARNING}12` }">
            <component :is="ICONS.ShieldWarning" :size="16" weight="Linear" :style="{ color: WARNING }" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-2 flex-wrap">
              <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ p.name }}</p>
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" :style="{ backgroundColor: p.targetPlatform ? `${PRIMARY_BLUE}12` : '#9CA3AF15', color: p.targetPlatform ? PRIMARY_BLUE : '#9CA3AF' }">
                {{ platformLabel(p) }}{{ p.targetDeploymentModel ? ` · ${DEPLOYMENT_MODEL_LABELS[p.targetDeploymentModel] ?? p.targetDeploymentModel}` : "" }}
              </span>
            </div>
            <p class="text-xs mt-0.5 text-gray-400">{{ conditionSummary(p) }}</p>
            <div class="flex items-center gap-x-4 gap-y-1 mt-2 flex-wrap">
              <button
                v-if="p.workflowId"
                class="text-xs inline-flex items-center gap-1 text-gray-400 hover:underline"
                :title="`Edit workflow: ${workflowsById[p.workflowId]?.name || 'linked workflow'}`"
                @click="openWorkflowEdit(p)"
              >
                <component :is="ICONS.Routing" :size="11" weight="Linear" /> {{ workflowsById[p.workflowId]?.name || "Linked workflow" }}
              </button>
              <p v-else class="text-xs inline-flex items-center gap-1 text-gray-400">
                <component :is="ICONS.Routing" :size="11" weight="Linear" /> No workflow linked
              </p>
              <button
                class="text-xs inline-flex items-center gap-1 disabled:cursor-default"
                :class="store.violatorCounts[p.id] ? 'hover:underline' : ''"
                :style="{ color: (store.violatorCounts[p.id] ?? 0) > 0 ? DANGER : '#9CA3AF' }"
                :disabled="store.violatorCounts[p.id] == null"
                @click="store.violatorCounts[p.id] ? emit('open-violators', p) : undefined"
              >
                <component :is="ICONS.Smartphone" :size="11" weight="Linear" />
                {{ store.violatorCounts[p.id] == null ? "Violators unavailable" : `${store.violatorCounts[p.id]} violating` }}
              </button>
            </div>
            <div class="flex items-center gap-1.5 mt-2 flex-wrap">
              <button class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase" :style="{ backgroundColor: p.enabled ? `${SUCCESS}15` : '#9CA3AF15', color: p.enabled ? SUCCESS : '#9CA3AF' }" @click="toggleField(p, 'enabled')">
                <component :is="p.enabled ? ICONS.CheckCircle : ICONS.CloseCircle" :size="10" weight="Linear" /> {{ p.enabled ? "Enabled" : "Disabled" }}
              </button>
              <button class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase" :style="{ backgroundColor: p.autoRun ? `${DANGER}12` : '#9CA3AF15', color: p.autoRun ? DANGER : '#9CA3AF' }" @click="toggleField(p, 'autoRun')">
                <component :is="ICONS.Refresh" :size="10" weight="Linear" /> {{ p.autoRun ? "Auto-run" : "Review first" }}
              </button>
            </div>
            <div class="flex items-center gap-2 mt-3">
              <button title="Evaluate now" class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40" :disabled="evaluatingPolicyId !== null" @click="evaluate(p)">
                <component :is="ICONS.Refresh" :size="13" weight="Linear" :class="evaluatingPolicyId === p.id ? 'animate-spin' : ''" />
              </button>
              <button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="emit('edit', p)">
                <component :is="ICONS.Pen" :size="12" weight="Linear" /> Edit
              </button>
              <button class="p-1.5 rounded-lg" style="color: #ef4444" @click="remove(p)">
                <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Desktop — sortable column table. table-fixed + an explicit colgroup
         (rather than the previous auto-layout table) so every narrow column
         gets a sane, consistent width instead of the browser splitting
         leftover space unevenly across them — that's what was producing the
         huge gaps between Violators/Last Evaluated/Enabled/Auto-run/Cases/
         Alerts. Only the Policy column has no fixed width, so it's the one
         that absorbs whatever space is left. The Workflow column shows only
         an icon (see openWorkflowEdit above) rather than the linked
         workflow's name — that name was the other half of the overflow
         problem, colliding with the Violators column whenever it ran long. -->
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm text-left table-fixed">
        <colgroup>
          <col />
          <col style="width: 108px" />
          <col style="width: 40px" />
          <col style="width: 64px" />
          <col style="width: 92px" />
          <col style="width: 60px" />
          <col style="width: 76px" />
          <col style="width: 92px" />
          <col style="width: 56px" />
          <col style="width: 104px" />
        </colgroup>
        <thead class="bg-gray-50 dark:bg-gray-900/50">
          <tr>
            <th v-for="col in COLUMNS.slice(0, 2)" :key="col.key" class="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider">
              <button class="inline-flex items-center gap-1 uppercase tracking-wider whitespace-nowrap" :style="{ color: sortBy === col.key ? PRIMARY_BLUE : '#9CA3AF' }" @click="toggleSort(col.key)">
                {{ col.label }} <component :is="ICONS.SortVertical" :size="11" weight="Linear" />
              </button>
            </th>
            <th class="px-1 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-center" title="Linked workflow">Wf</th>
            <th v-for="col in COLUMNS.slice(2)" :key="col.key" class="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider">
              <button class="inline-flex items-center gap-1 uppercase tracking-wider whitespace-nowrap" :style="{ color: sortBy === col.key ? PRIMARY_BLUE : '#9CA3AF' }" @click="toggleSort(col.key)">
                {{ col.label }} <component :is="ICONS.SortVertical" :size="11" weight="Linear" />
              </button>
            </th>
            <th class="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap">Enabled</th>
            <th class="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap">Auto-run</th>
            <th class="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap">Cases</th>
            <th class="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap">Alerts</th>
            <th class="px-2 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, idx) in sorted" :key="p.id" class="align-top" :class="idx > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''">
            <td class="px-2 py-2.5">
              <div class="flex items-start gap-2 min-w-0">
                <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: `${WARNING}12` }">
                  <component :is="ICONS.ShieldWarning" :size="13" weight="Linear" :style="{ color: WARNING }" />
                </div>
                <div class="min-w-0">
                  <p class="font-semibold truncate text-gray-900 dark:text-white" :title="p.name">{{ p.name }}</p>
                  <p class="text-[11px] text-gray-400 mt-0.5 truncate">{{ conditionSummary(p) }}</p>
                  <p v-if="p.description" class="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{{ p.description }}</p>
                </div>
              </div>
            </td>
            <td class="px-2 py-2.5">
              <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-block max-w-full truncate align-middle" :title="platformLabel(p) + (p.targetDeploymentModel ? ` · ${DEPLOYMENT_MODEL_LABELS[p.targetDeploymentModel] ?? p.targetDeploymentModel}` : '')" :style="{ backgroundColor: p.targetPlatform ? `${PRIMARY_BLUE}12` : '#9CA3AF15', color: p.targetPlatform ? PRIMARY_BLUE : '#9CA3AF' }">
                {{ platformLabel(p) }}{{ p.targetDeploymentModel ? ` · ${DEPLOYMENT_MODEL_LABELS[p.targetDeploymentModel] ?? p.targetDeploymentModel}` : "" }}
              </span>
            </td>
            <td class="px-1 py-2.5 text-center">
              <button
                v-if="p.workflowId"
                :title="`Edit workflow: ${workflowsById[p.workflowId]?.name || 'linked workflow'}`"
                class="p-1 rounded-lg text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                @click="openWorkflowEdit(p)"
              >
                <component :is="ICONS.Routing" :size="15" weight="Linear" />
              </button>
              <span v-else title="No workflow linked" class="inline-flex text-gray-300 dark:text-gray-600">
                <component :is="ICONS.Routing" :size="15" weight="Linear" />
              </span>
            </td>
            <td class="px-2 py-2.5">
              <button
                class="text-xs inline-flex items-center gap-1 whitespace-nowrap disabled:cursor-default"
                :style="{ color: (store.violatorCounts[p.id] ?? 0) > 0 ? DANGER : '#9CA3AF' }"
                :disabled="store.violatorCounts[p.id] == null"
                :title="store.violatorCounts[p.id] ? 'View violating devices' : undefined"
                :class="store.violatorCounts[p.id] ? 'hover:underline' : ''"
                @click="store.violatorCounts[p.id] ? emit('open-violators', p) : undefined"
              >
                <component :is="ICONS.Smartphone" :size="11" weight="Linear" />
                {{ store.violatorCounts[p.id] == null ? "N/A" : store.violatorCounts[p.id] }}
              </button>
            </td>
            <td class="px-2 py-2.5">
              <p class="text-xs inline-flex items-center gap-1 text-gray-400 whitespace-nowrap" :title="p.lastEvaluatedAt ? new Date(p.lastEvaluatedAt).toLocaleString() : undefined">
                <component :is="ICONS.ClockCircle" :size="11" weight="Linear" /> {{ p.lastEvaluatedAt ? timeAgo(p.lastEvaluatedAt) : "Never" }}
              </p>
            </td>
            <td class="px-2 py-2.5">
              <button
                class="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold uppercase whitespace-nowrap"
                :style="{ backgroundColor: p.enabled ? `${SUCCESS}15` : '#9CA3AF15', color: p.enabled ? SUCCESS : '#9CA3AF' }"
                @click="toggleField(p, 'enabled')"
              >
                <component :is="p.enabled ? ICONS.CheckCircle : ICONS.CloseCircle" :size="10" weight="Linear" /> {{ p.enabled ? "On" : "Off" }}
              </button>
            </td>
            <td class="px-2 py-2.5">
              <div class="flex flex-col items-start gap-1">
                <button
                  class="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold uppercase whitespace-nowrap"
                  :style="{ backgroundColor: p.autoRun ? `${DANGER}12` : '#9CA3AF15', color: p.autoRun ? DANGER : '#9CA3AF' }"
                  @click="toggleField(p, 'autoRun')"
                >
                  <component :is="ICONS.Refresh" :size="10" weight="Linear" /> {{ p.autoRun ? "Auto" : "Review" }}
                </button>
                <span
                  v-if="p.autoRun && p.autoRunTripped"
                  :title="p.autoRunTrippedReason || 'autoRun tripped — edit and re-save this policy to re-arm it'"
                  class="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold uppercase whitespace-nowrap"
                  :style="{ backgroundColor: `${DANGER}15`, color: DANGER }"
                >
                  <component :is="ICONS.CloseCircle" :size="10" weight="Linear" /> Tripped
                </span>
              </div>
            </td>
            <td class="px-2 py-2.5">
              <button
                class="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold uppercase whitespace-nowrap"
                :style="{ backgroundColor: (p.openCaseOnViolation ?? true) ? `${PRIMARY_BLUE}12` : '#9CA3AF15', color: (p.openCaseOnViolation ?? true) ? PRIMARY_BLUE : '#9CA3AF' }"
                title="Whether violating this policy opens a Case — edit the policy to also control auto-resolve on recovery"
                @click="toggleField(p, 'openCaseOnViolation')"
              >
                <component :is="ICONS.Folder" :size="10" weight="Linear" /> {{ (p.openCaseOnViolation ?? true) ? (p.autoResolveCaseOnRecovery ? "Auto-resolve" : "On") : "Off" }}
              </button>
            </td>
            <td class="px-2 py-2.5">
              <span
                v-if="p.alertOnViolation"
                :title="p.lastAlertError ? `Last alert attempt had a problem: ${p.lastAlertError}` : 'Sends a rolled-up webhook/email alert when this policy is violated'"
                class="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold uppercase whitespace-nowrap"
                :style="{ backgroundColor: p.lastAlertError ? `${WARNING}15` : `${PRIMARY_BLUE}12`, color: p.lastAlertError ? WARNING : PRIMARY_BLUE }"
              >
                <component :is="p.lastAlertError ? ICONS.DangerTriangle : ICONS.Bell" :size="10" weight="Linear" /> {{ p.lastAlertError ? "Error" : "On" }}
              </span>
              <span v-else class="text-[10px] font-semibold px-1.5 py-1 uppercase whitespace-nowrap text-gray-400">Off</span>
            </td>
            <td class="px-2 py-2.5">
              <div class="flex items-center gap-1 justify-end flex-nowrap">
                <button title="Evaluate just this policy now" class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 shrink-0" :disabled="evaluatingPolicyId !== null" @click="evaluate(p)">
                  <component :is="ICONS.Refresh" :size="13" weight="Linear" :class="evaluatingPolicyId === p.id ? 'animate-spin' : ''" />
                </button>
                <button title="Edit" class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 shrink-0" @click="emit('edit', p)">
                  <component :is="ICONS.Pen" :size="13" weight="Linear" />
                </button>
                <button title="Delete" class="p-1.5 rounded-lg shrink-0" style="color: #ef4444" @click="remove(p)">
                  <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
