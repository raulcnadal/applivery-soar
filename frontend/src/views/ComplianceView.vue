<script setup lang="ts">
// Compliance view — port of CompliancePoliciesView.jsx: 2 sub-views reached
// via a ViewSwitcher pill (Policies, App Lists — NOT the 4 flat tabs this
// file used to have). The Violations review queue lives directly on the
// Policies sub-view (above/below the policy grid), and the Template
// Gallery is a modal opened via "New from Template", not a persistent tab.
//
// Segment scoping (roadmap Phase 9) — KNOWN, DISCLOSED GAP: the original
// assigns each Compliance Policy an administrative/visibility Segment
// (docs/compliance.md: "Segment — administrative/visibility scope only. It
// does not filter which devices get checked") and scopes the policy list to
// the Segments panel's selection. Our migrated `CompliancePolicy` Prisma
// model has no segmentId field yet, so this policy list is NOT segment-
// filtered — the Segments panel is still reachable from this page (it's
// visible/hoverable, matching the original's currentView check) but has no
// effect here. Closing this requires a schema migration adding
// CompliancePolicy.segmentId plus a PolicyBuilder UI field — deferred as its
// own follow-up rather than faked.
import { onMounted, ref } from "vue";
import { ICONS } from "../lib/solarIcons";
import HelpIcon from "../components/shared/HelpIcon.vue";
import AppListsPanel from "../components/compliance/AppListsPanel.vue";
import PoliciesTable from "../components/compliance/PoliciesTable.vue";
import PolicyBuilderDrawer from "../components/compliance/PolicyBuilderDrawer.vue";
import TemplateGallery from "../components/compliance/TemplateGallery.vue";
import ViolationsQueue from "../components/compliance/ViolationsQueue.vue";
import { useComplianceStore, type CompliancePolicy, type ComplianceTemplate } from "../stores/compliance";

const PRIMARY_BLUE = "#0241E3";
const DANGER = "#EF4444";

const store = useComplianceStore();

const subView = ref<"policies" | "app-lists">("policies");

const drawerOpen = ref(false);
const editingPolicy = ref<CompliancePolicy | null>(null);
const prefill = ref<{ name: string; description: string; conditions: any[]; conditionLogic: "any" | "all"; framework: string; controlRef: string; severity: string } | null>(null);

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

function useTemplate(template: ComplianceTemplate, frameworkLabel: string) {
  isTemplateGalleryOpen.value = false;
  editingPolicy.value = null;
  prefill.value = {
    name: template.title,
    description: `${template.description}\n\nFramework: ${frameworkLabel} — ${template.controlRef}. Generated from a template — review conditions and thresholds before enabling autoRun.`,
    conditions: template.conditions,
    conditionLogic: template.conditionLogic,
    framework: template.framework,
    controlRef: template.controlRef,
    severity: template.severity,
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
  <main class="p-8 pb-16">
    <header class="flex justify-between items-start mb-8 gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold leading-tight text-gray-900">Compliance</h1>
          <HelpIcon slug="compliance" title="Compliance admin guide" />
        </div>
        <p class="text-sm mt-1 text-gray-400">Policies watch device conditions and fire a linked Workflow the moment a device falls out of compliance.</p>
      </div>
      <div class="flex items-center gap-2 shrink-0 ml-auto flex-wrap">
        <select
          v-model="evaluateScopePolicyId"
          :disabled="isEvaluating"
          title="Which polic(ies) 'Evaluate now' checks"
          class="px-2.5 py-2 rounded-lg text-sm font-medium outline-none border border-gray-200 bg-white disabled:opacity-50 focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All policies</option>
          <option v-for="p in store.policies" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button :disabled="isEvaluating" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 disabled:opacity-50" @click="evaluateNow">
          <component :is="ICONS.Refresh" :size="14" weight="Linear" :class="isEvaluating ? 'animate-spin' : ''" /> {{ isEvaluating ? "Evaluating…" : "Evaluate now" }}
        </button>
        <button class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700" @click="isTemplateGalleryOpen = true">
          <component :is="ICONS.ShieldCheck" :size="14" weight="Linear" /> New from Template
        </button>
        <button class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200" @click="openNewPolicy">
          <component :is="ICONS.AddSquare" :size="15" weight="Linear" /> Create Compliance Policy
        </button>
        <div class="flex items-center gap-1 p-1 rounded-xl border border-gray-200 bg-gray-50 shrink-0">
          <button
            class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
            :class="subView === 'policies' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'"
            @click="subView = 'policies'"
          >
            <component :is="ICONS.ShieldWarning" :size="14" weight="Linear" /> Policies
          </button>
          <button
            class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
            :class="subView === 'app-lists' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'"
            @click="subView = 'app-lists'"
          >
            <component :is="ICONS.Checklist" :size="14" weight="Linear" /> App Lists
          </button>
        </div>
      </div>
    </header>

    <div v-if="evalSummary" class="mb-6 px-4 py-3 rounded-xl text-xs border text-gray-900" :style="{ backgroundColor: `${PRIMARY_BLUE}08`, borderColor: `${PRIMARY_BLUE}30` }">
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
      <ViolationsQueue />
      <div v-if="store.isLoadingPolicies" class="flex flex-col items-center justify-center min-h-[300px]">
        <div class="w-8 h-8 border-2 rounded-full animate-spin mb-4" :style="{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }" />
        <span class="text-xs uppercase tracking-widest font-bold text-gray-400">Loading policies…</span>
      </div>
      <PoliciesTable v-else :policies="store.policies" :is-loading="store.isLoadingPolicies" @edit="editPolicy" />
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
      @close="closeDrawer"
      @saved="handleSaved"
    />

    <TemplateGallery :open="isTemplateGalleryOpen" @close="isTemplateGalleryOpen = false" @use="useTemplate" />
  </main>
</template>
