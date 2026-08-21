<script setup lang="ts">
// Compliance view — port of CompliancePoliciesView.jsx: 2 sub-views reached
// via a ViewSwitcher pill (Policies, App Lists — NOT the 4 flat tabs this
// file used to have). The Violations review queue lives directly on the
// Policies sub-view (above/below the policy grid), and the Template
// Gallery is a modal opened via "New from Template", not a persistent tab.
//
// Segment scoping (docs/compliance.md: "Segment — administrative/visibility
// scope only. It does not filter which devices get checked") — each policy
// is assigned an owning Segment in PolicyBuilderDrawer.vue, and this list is
// scoped to whatever Segment is selected in the Segments panel, same
// collectSegmentIds pattern as DevicesView.vue/CasesView.vue
// (CompliancePoliciesView.jsx:245-253).
import { computed, onMounted, ref } from "vue";
import { ICONS } from "../lib/solarIcons";
import HelpIcon from "../components/shared/HelpIcon.vue";
import AppListsPanel from "../components/compliance/AppListsPanel.vue";
import PoliciesTable from "../components/compliance/PoliciesTable.vue";
import PolicyBuilderDrawer from "../components/compliance/PolicyBuilderDrawer.vue";
import TemplateGallery from "../components/compliance/TemplateGallery.vue";
import ViolationsQueue from "../components/compliance/ViolationsQueue.vue";
import { useComplianceStore, type CompliancePolicy, type ComplianceTemplate, type ConditionRule } from "../stores/compliance";
import { useSegmentsStore } from "../stores/segments";

const PRIMARY_BLUE = "#0241E3";
const DANGER = "#EF4444";

const store = useComplianceStore();
const segmentsStore = useSegmentsStore();

// Platform filter for the Policies list — separate from (and applied on top
// of) the Segment scoping above. "" (All platforms) is the default; "common"
// is its own option rather than folded into "All" since a policy with no
// targetPlatform (applies fleet-wide, regardless of OS) is a real, distinct
// category admins may specifically want to isolate, same distinction
// PoliciesTable.vue's own platform chip already draws ("Common" vs. a named
// platform).
const PLATFORM_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All platforms" },
  { value: "common", label: "Common (all platforms)" },
  { value: "apple", label: "iOS/iPadOS" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
];
const policyPlatformFilter = ref("");

const visiblePolicies = computed(() => {
  const ids = segmentsStore.collectSegmentIds(segmentsStore.selectedSegment.id);
  let list = ids === null ? store.policies : store.policies.filter((p) => ids.has(String(p.segmentId ?? "0")));
  if (policyPlatformFilter.value === "common") {
    list = list.filter((p) => !p.targetPlatform);
  } else if (policyPlatformFilter.value) {
    list = list.filter((p) => p.targetPlatform === policyPlatformFilter.value);
  }
  return list;
});

const subView = ref<"policies" | "app-lists">("policies");

const drawerOpen = ref(false);
const editingPolicy = ref<CompliancePolicy | null>(null);
const prefill = ref<{
  name: string;
  description: string;
  conditions: any[];
  conditionLogic: "any" | "all";
  framework: string;
  controlRef: string;
  severity: string;
  targetPlatform: string | null;
  targetDeploymentModel: string | null;
} | null>(null);

const isTemplateGalleryOpen = ref(false);
const evaluateScopePolicyId = ref("");
const isEvaluating = ref(false);
const evalSummary = ref<any>(null);

function openNewPolicy() {
  editingPolicy.value = null;
  prefill.value = null;
  drawerOpen.value = true;
}

function editPolicy(policy: CompliancePolicy) {
  editingPolicy.value = policy;
  prefill.value = null;
  drawerOpen.value = true;
}

const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const PLATFORM_LABELS_FOR_MERGE: Record<string, string> = { apple: "iOS", macos: "macOS", android: "Android", windows: "Windows" };

// Handles both a single-template pick and a multi-template merge from
// TemplateGallery's checkbox selection — merging N is the same operation as
// "merging" 1, so there's one path instead of two. Flattening every
// selected template's conditions into one flat array with conditionLogic
// "any" is semantically exact here (not just a convenient simplification):
// every template in the catalog already uses "any" internally (OR across
// its own conditions = "this aspect is violated"), so OR-ing across
// multiple templates' conditions too means "violated if ANY selected aspect
// is violated" — precisely the intended meaning of a certification-wide
// policy. This wouldn't hold if any template used "all" logic, but none do
// (verified against the current catalog).
function useTemplates(templates: ComplianceTemplate[], frameworkLabel: string) {
  if (!templates.length) return;
  isTemplateGalleryOpen.value = false;
  editingPolicy.value = null;

  const seen = new Set<string>();
  const conditions: ConditionRule[] = [];
  for (const t of templates) {
    for (const c of t.conditions) {
      const key = JSON.stringify([c.field, c.operator, c.value]);
      if (seen.has(key)) continue;
      seen.add(key);
      conditions.push(c);
    }
  }

  const severity = templates.reduce((max, t) => ((SEVERITY_RANK[t.severity] ?? 0) > (SEVERITY_RANK[max] ?? 0) ? t.severity : max), templates[0].severity);
  const controlRefs = Array.from(new Set(templates.map((t) => t.controlRef)));
  const targetPlatform = templates[0].targetPlatform ?? null;
  const platformLabel = targetPlatform ? PLATFORM_LABELS_FOR_MERGE[targetPlatform] ?? targetPlatform : "Common";

  const isSingle = templates.length === 1;
  prefill.value = {
    name: isSingle ? templates[0].title : `${frameworkLabel} — ${platformLabel} baseline`,
    description: isSingle
      ? `${templates[0].description}\n\nFramework: ${frameworkLabel} — ${templates[0].controlRef}. Generated from a template — review conditions and thresholds before enabling autoRun.`
      : `Unified policy generated from ${templates.length} ${frameworkLabel} templates (${controlRefs.join(", ")}).\n\nCovers: ${templates.map((t) => t.title).join("; ")}.\n\nReview conditions and thresholds before enabling autoRun.`,
    conditions,
    conditionLogic: "any",
    framework: templates[0].framework,
    controlRef: controlRefs.join(", "),
    severity,
    targetPlatform,
    targetDeploymentModel: templates[0].targetDeploymentModel ?? null,
  };
  subView.value = "policies";
  drawerOpen.value = true;
}

function closeDrawer() {
  drawerOpen.value = false;
}

async function handleSaved() {
  await store.fetchPolicies();
  setTimeout(async () => {
    await store.fetchPolicies();
    await store.fetchViolations();
  }, 2500);
}

async function evaluateNow() {
  isEvaluating.value = true;
  evalSummary.value = null;
  try {
    const summary = await store.evaluateNow(evaluateScopePolicyId.value || undefined);
    const scopedName = evaluateScopePolicyId.value ? store.policies.find((p) => p.id === evaluateScopePolicyId.value)?.name ?? null : null;
    evalSummary.value = { ...summary, scopedPolicyName: scopedName };
    await store.fetchViolations();
  } catch (err: any) {
    store.policiesError = err?.response?.data?.detail || "Failed to evaluate policies.";
  } finally {
    isEvaluating.value = false;
  }
}

onMounted(async () => {
  await store.fetchPolicies();
  if (store.policies.length > 0) await store.refreshViolatorCounts(store.policies.map((p) => p.id));
});
</script>

<template>
  <main class="p-4 md:p-8 pb-16">
    <header class="flex justify-between items-start mb-8 gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold leading-tight text-gray-900 dark:text-white">Compliance</h1>
          <HelpIcon slug="compliance" title="Compliance admin guide" />
          <span
            v-if="String(segmentsStore.selectedSegment.id) !== '0'"
            class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
            :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }"
          >
            <component :is="ICONS.Layers" :size="10" weight="Linear" /> {{ segmentsStore.selectedSegment.name }}
          </span>
        </div>
        <p class="text-sm mt-1 text-gray-400">Policies watch device conditions and fire a linked Workflow the moment a device falls out of compliance.</p>
      </div>
      <!-- w-full sm:w-auto matches the same fix already applied to
           DevicesView/WorkflowsView/ReportingView's header action row: this
           div's own flex-wrap only has room to wrap its buttons onto
           multiple lines once the div itself is allowed to take the full
           header width on mobile — shrink-0 alone left it hugging its
           unwrapped content width, which is wider than the viewport, so the
           whole header scrolled horizontally instead of stacking. -->
      <div class="flex items-center gap-2 shrink-0 ml-auto flex-wrap w-full sm:w-auto">
        <select
          v-model="policyPlatformFilter"
          title="Filter the Policies list (and the On-Demand Policy Evaluation dropdown) to one platform"
          class="px-2.5 py-2 rounded-lg text-sm font-medium outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
        >
          <option v-for="p in PLATFORM_FILTER_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
        <span class="text-xs font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap">On-Demand Policy Evaluation</span>
        <select
          v-model="evaluateScopePolicyId"
          :disabled="isEvaluating"
          title="Which polic(ies) 'Evaluate now' checks"
          class="px-2.5 py-2 rounded-lg text-sm font-medium outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 disabled:opacity-50 focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All policies</option>
          <option v-for="p in visiblePolicies" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button :disabled="isEvaluating" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50" @click="evaluateNow">
          <component :is="ICONS.Refresh" :size="14" weight="Linear" :class="isEvaluating ? 'animate-spin' : ''" /> {{ isEvaluating ? "Evaluating…" : "Evaluate now" }}
        </button>
        <button class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="isTemplateGalleryOpen = true">
          <component :is="ICONS.ShieldCheck" :size="14" weight="Linear" /> New from Template
        </button>
        <button class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200" @click="openNewPolicy">
          <component :is="ICONS.AddSquare" :size="15" weight="Linear" /> Create Compliance Policy
        </button>
        <div class="flex items-center gap-1 p-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 shrink-0">
          <button
            class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
            :class="subView === 'policies' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
            @click="subView = 'policies'"
          >
            <component :is="ICONS.ShieldWarning" :size="14" weight="Linear" /> Policies
          </button>
          <button
            class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
            :class="subView === 'app-lists' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
            @click="subView = 'app-lists'"
          >
            <component :is="ICONS.Checklist" :size="14" weight="Linear" /> App Lists
          </button>
        </div>
      </div>
    </header>

    <div v-if="evalSummary" class="mb-6 px-4 py-3 rounded-xl text-xs border text-gray-900 dark:text-white" :style="{ backgroundColor: `${PRIMARY_BLUE}08`, borderColor: `${PRIMARY_BLUE}30` }">
      <template v-if="evalSummary.scopedPolicyName">
        Checked {{ evalSummary.devicesChecked }} device{{ evalSummary.devicesChecked === 1 ? "" : "s" }} against <span class="font-semibold">"{{ evalSummary.scopedPolicyName }}"</span> —
      </template>
      <template v-else>
        Checked {{ evalSummary.devicesChecked }} device{{ evalSummary.devicesChecked === 1 ? "" : "s" }} against {{ evalSummary.evaluatedPolicies }} polic{{ evalSummary.evaluatedPolicies === 1 ? "y" : "ies" }} —
      </template>
      {{ evalSummary.violationsFound }} new violation{{ evalSummary.violationsFound === 1 ? "" : "s" }}
      {{ evalSummary.autoFired ? `, ${evalSummary.autoFired} auto-fired` : "" }}
      {{ evalSummary.queuedForReview ? `, ${evalSummary.queuedForReview} queued for review` : "" }}
      {{ evalSummary.recovered ? `, ${evalSummary.recovered} recovered` : "" }}
      {{ evalSummary.autoRunSafetyBlocked ? `, ${evalSummary.autoRunSafetyBlocked} blocked by autoRun safety limits` : "" }}.
    </div>

    <div v-if="store.policiesError" class="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl border" :style="{ backgroundColor: `${DANGER}10`, borderColor: `${DANGER}30` }">
      <component :is="ICONS.DangerTriangle" :size="18" weight="Linear" class="shrink-0 mt-0.5" :style="{ color: DANGER }" />
      <p class="text-sm" :style="{ color: DANGER }">{{ store.policiesError }}</p>
    </div>

    <template v-if="subView === 'policies'">
      <div class="mb-3">
        <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">Policies</p>
      </div>
      <div v-if="store.isLoadingPolicies" class="flex flex-col items-center justify-center min-h-[300px]">
        <div class="w-8 h-8 border-2 rounded-full animate-spin mb-4" :style="{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }" />
        <span class="text-xs uppercase tracking-widest font-bold text-gray-400">Loading policies…</span>
      </div>
      <div v-else class="mb-8">
        <PoliciesTable
          :policies="visiblePolicies"
          :is-loading="store.isLoadingPolicies"
          :total-policies-count="store.policies.length"
          :segment-name="segmentsStore.selectedSegment.name"
          @edit="editPolicy"
        />
      </div>
      <ViolationsQueue />
    </template>
    <AppListsPanel v-else />

    <PolicyBuilderDrawer
      :open="drawerOpen"
      :policy="editingPolicy"
      :prefill-conditions="prefill?.conditions ?? null"
      :prefill-name="prefill?.name ?? null"
      :prefill-description="prefill?.description ?? null"
      :prefill-framework="prefill?.framework ?? null"
      :prefill-control-ref="prefill?.controlRef ?? null"
      :prefill-severity="prefill?.severity ?? null"
      :prefill-condition-logic="prefill?.conditionLogic ?? null"
      :prefill-target-platform="prefill?.targetPlatform ?? null"
      :prefill-target-deployment-model="prefill?.targetDeploymentModel ?? null"
      @close="closeDrawer"
      @saved="handleSaved"
    />

    <TemplateGallery :open="isTemplateGalleryOpen" @close="isTemplateGalleryOpen = false" @use-templates="useTemplates" />
  </main>
</template>
