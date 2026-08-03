<script setup lang="ts">
// Cases — port of CasesView.jsx (1065 lines): status-tab filter bar, free
// text search, severity/MITRE tactic/technique filters, "My cases" toggle,
// an ATT&CK coverage pill strip, bulk assign/close (gated by
// canBulkTriage), and Export CSV / New Case header actions.
//
// Segment scoping (roadmap Phase 9): implicit collectSegmentIds filtering
// against the Segments panel's selection, same as the original.
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { Alert } from "@applivery/bluesky-vue";
import HelpIcon from "../components/shared/HelpIcon.vue";
import CasesTable from "../components/cases/CasesTable.vue";
import CaseCreateDialog from "../components/cases/CaseCreateDialog.vue";
import CaseDetailDrawer from "../components/cases/CaseDetailDrawer.vue";
import { ICONS } from "../lib/solarIcons";
import { tacticColorMap, techniqueByIdMap } from "../lib/mitreCatalog";
import { useAuthStore } from "../stores/auth";
import { useCasesStore, type Case } from "../stores/cases";
import { useComplianceStore } from "../stores/compliance";
import { useSegmentsStore } from "../stores/segments";

const PRIMARY_BLUE = "#0241E3";
const WARNING = "#F59E0B";

const route = useRoute();
const store = useCasesStore();
const complianceStore = useComplianceStore();
const authStore = useAuthStore();
const segmentsStore = useSegmentsStore();

const STATUS_TABS = [
  { id: "open_investigating", label: "Open" },
  { id: "resolved", label: "Resolved" },
  { id: "closed", label: "Closed" },
  { id: "false_positive", label: "False positive" },
  { id: "all", label: "All" },
];

const statusFilter = ref("open_investigating");
const severityFilter = ref("all");
const tacticFilter = ref("all");
const techniqueFilter = ref("all");
const onlyMine = ref(false);
const searchQuery = ref("");

const createOpen = ref(false);
const detailOpen = ref(false);
const activeCaseId = ref<string | null>(null);

const canBulkTriage = computed(() => authStore.hasRiskyAction("canBulkTriage"));

const tacticColor = computed(() => tacticColorMap(complianceStore.mitreTactics));
const techniqueById = computed(() => techniqueByIdMap(complianceStore.mitreTechniques));

const openCount = computed(() => store.cases.filter((c) => c.status === "open" || c.status === "investigating").length);

const visibleCases = computed(() => {
  let list = store.cases;
  const segmentIds = segmentsStore.collectSegmentIds(segmentsStore.selectedSegment.id);
  if (segmentIds !== null) list = list.filter((c) => segmentIds.has(String(c.segmentId ?? "0")));
  if (statusFilter.value === "open_investigating") list = list.filter((c) => c.status === "open" || c.status === "investigating");
  else if (statusFilter.value !== "all") list = list.filter((c) => c.status === statusFilter.value);
  if (severityFilter.value !== "all") list = list.filter((c) => c.severity === severityFilter.value);
  if (onlyMine.value && authStore.email) list = list.filter((c) => c.assignee === authStore.email);
  if (tacticFilter.value !== "all") {
    list = list.filter((c) => (c.mitreTechniques || []).some((id) => techniqueById.value[id]?.tactic === tacticFilter.value));
  }
  if (techniqueFilter.value !== "all") {
    list = list.filter((c) => (c.mitreTechniques || []).includes(techniqueFilter.value));
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    list = list.filter(
      (c) =>
        (c.title || "").toLowerCase().includes(q) ||
        (c.deviceName || "").toLowerCase().includes(q) ||
        (c.assignee || "").toLowerCase().includes(q) ||
        (c.policyName || "").toLowerCase().includes(q),
    );
  }
  return list;
});

// Lifetime coverage (any status, not just currently-open) of how many cases
// touch each ATT&CK tactic — computed client-side from the already-loaded
// case list, same as the original (CasesView.jsx:245-262).
const tacticCoverage = computed(() => {
  const counts: Record<string, number> = {};
  store.cases.forEach((c) => {
    const seen = new Set((c.mitreTechniques || []).map((id) => techniqueById.value[id]?.tactic).filter(Boolean) as string[]);
    seen.forEach((t) => {
      counts[t] = (counts[t] || 0) + 1;
    });
  });
  return counts;
});
const hasCoverageData = computed(() => Object.keys(tacticCoverage.value).length > 0);

function openCase(c: Case) {
  activeCaseId.value = c.id;
  detailOpen.value = true;
}

async function bulkAssign(caseIds: string[]) {
  if (!authStore.email) return;
  await store.bulkUpdateCases(caseIds, { assignee: authStore.email });
}
async function bulkClose(caseIds: string[]) {
  if (!confirm(`Close ${caseIds.length} case(s)?`)) return;
  await store.bulkUpdateCases(caseIds, { status: "closed" });
}

onMounted(async () => {
  await store.fetchCases();
  await store.fetchAssigneeSuggestions();
  if (complianceStore.mitreTechniques.length === 0) await complianceStore.fetchMitreTechniques();

  // Arriving here from another view (a Case chip in the Devices Compliance
  // tab, e.g. router.push({ path: "/cases", query: { caseId } })) with a
  // specific case in mind — open it directly, closing the Phase 1 caveat
  // that this query param wasn't read yet.
  const qCaseId = route.query.caseId;
  if (typeof qCaseId === "string") {
    activeCaseId.value = qCaseId;
    detailOpen.value = true;
  }
});
</script>

<template>
  <main class="p-8 pb-16">
    <header class="flex justify-between items-start mb-8 gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2 flex-wrap">
          <h1 class="text-2xl font-semibold leading-tight text-gray-900 dark:text-white">Cases</h1>
          <HelpIcon slug="cases" title="Cases admin guide" />
          <span
            v-if="String(segmentsStore.selectedSegment.id) !== '0'"
            class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
            :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }"
          >
            <component :is="ICONS.Layers" :size="10" weight="Linear" /> {{ segmentsStore.selectedSegment.name }}
          </span>
          <span v-if="openCount > 0" class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" :style="{ backgroundColor: `${WARNING}15`, color: WARNING }">
            {{ openCount }} open
          </span>
        </div>
        <p class="text-sm mt-1 text-gray-400">The incident layer above raw violations — track investigation status, assign an owner, and keep notes across every detection of the same problem.</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <a :href="store.exportCasesUrl()" target="_blank" rel="noopener">
          <button class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">
            <component :is="ICONS.Download" :size="13" weight="Linear" /> Export CSV
          </button>
        </a>
        <button class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200" @click="createOpen = true">
          <component :is="ICONS.AddSquare" :size="15" weight="Linear" /> New Case
        </button>
      </div>
    </header>

    <Alert v-if="store.error" type="danger" class="mb-6">{{ store.error }}</Alert>

    <!-- Filter bar -->
    <div class="flex items-center justify-between mb-5 flex-wrap gap-3">
      <div class="flex items-center gap-1 p-1 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
        <button
          v-for="t in STATUS_TABS"
          :key="t.id"
          class="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
          :class="statusFilter === t.id ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
          @click="statusFilter = t.id"
        >
          {{ t.label }}
        </button>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <div class="relative">
          <component :is="ICONS.Magnifer" :size="13" weight="Linear" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input v-model="searchQuery" placeholder="Search title, device, assignee…" class="pl-8 pr-3 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white w-56 focus:ring-2 focus:ring-brand-500" />
        </div>
        <select v-model="severityFilter" class="px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500">
          <option value="all">All severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <select v-if="complianceStore.mitreTactics.length > 0" v-model="tacticFilter" class="px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500">
          <option value="all">All ATT&amp;CK tactics</option>
          <option v-for="t in complianceStore.mitreTactics" :key="t.key" :value="t.key">{{ t.name }}</option>
        </select>
        <select v-if="complianceStore.mitreTechniques.length > 0" v-model="techniqueFilter" class="px-2.5 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 max-w-[160px]">
          <option value="all">All techniques</option>
          <optgroup v-for="tac in complianceStore.mitreTactics" :key="tac.key" :label="tac.name">
            <option v-for="t in complianceStore.mitreTechniques.filter((x) => x.tactic === tac.key)" :key="t.id" :value="t.id">{{ t.id }} — {{ t.name }}</option>
          </optgroup>
        </select>
        <button
          v-if="authStore.email"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
          :class="onlyMine ? 'bg-brand-50 text-brand-700 border border-brand-300' : 'border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'"
          @click="onlyMine = !onlyMine"
        >
          <component :is="ICONS.UsersGroupRounded" :size="12" weight="Linear" /> My cases
        </button>
      </div>
    </div>

    <div v-if="hasCoverageData" class="flex items-center gap-1.5 flex-wrap mb-5 -mt-2">
      <span class="text-[10px] font-semibold uppercase tracking-wider mr-1 text-gray-400">ATT&amp;CK coverage:</span>
      <button
        v-for="t in complianceStore.mitreTactics.filter((x) => tacticCoverage[x.key])"
        :key="t.key"
        :title="`${tacticCoverage[t.key]} case(s) touch ${t.name}`"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
        :style="tacticFilter === t.key ? { backgroundColor: tacticColor[t.key], color: '#FFFFFF' } : { backgroundColor: `${tacticColor[t.key]}15`, color: tacticColor[t.key] }"
        @click="tacticFilter = tacticFilter === t.key ? 'all' : t.key"
      >
        {{ t.name }} · {{ tacticCoverage[t.key] }}
      </button>
    </div>

    <CasesTable
      :cases="visibleCases"
      :is-loading="store.isLoading"
      :total-cases="store.cases.length"
      :can-bulk-triage="canBulkTriage"
      :current-user-email="authStore.email"
      :technique-by-id="techniqueById"
      :tactic-color="tacticColor"
      @open="openCase"
      @bulk-assign="bulkAssign"
      @bulk-close="bulkClose"
    />

    <CaseCreateDialog :open="createOpen" @close="createOpen = false" @created="store.fetchCases()" />
    <CaseDetailDrawer :open="detailOpen" :case-id="activeCaseId" @close="detailOpen = false" @changed="store.fetchCases()" />
  </main>
</template>
