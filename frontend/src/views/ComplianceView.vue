<script setup lang="ts">
// Compliance view — Policies / Violations / Templates / App Lists tabs.
// Port of the original app's Compliance top-level view (migration-plan.md
// Phase 3 checkpoint: "Policy Builder, violation queue (approve/dismiss/
// bulk), App Lists, template gallery all functional").
import { Alert, Button, PageHeader, Tabs } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import HelpIcon from "../components/shared/HelpIcon.vue";
import AppListsPanel from "../components/compliance/AppListsPanel.vue";
import PoliciesTable from "../components/compliance/PoliciesTable.vue";
import PolicyBuilderDrawer from "../components/compliance/PolicyBuilderDrawer.vue";
import TemplateGallery from "../components/compliance/TemplateGallery.vue";
import ViolationsQueue from "../components/compliance/ViolationsQueue.vue";
import { useComplianceStore, type CompliancePolicy, type ComplianceTemplate } from "../stores/compliance";

const store = useComplianceStore();

const tabs = [
  { id: "policies", label: "Policies" },
  { id: "violations", label: "Violations" },
  { id: "templates", label: "Templates" },
  { id: "app-lists", label: "App Lists" },
];
const activeTab = ref("policies");
// Port of the original's HelpIcon placements (CompliancePoliciesView.jsx's
// anchor="policies-list", AppListsView.jsx's anchor="app-lists-sub-view") —
// merged into one tabbed view here, so the anchor tracks whichever of those
// two sub-views is active; Violations/Templates land at the doc's top.
const helpAnchor = computed<string | null>(() => {
  if (activeTab.value === "policies") return "policies-list";
  if (activeTab.value === "app-lists") return "app-lists-sub-view";
  return null;
});

const drawerOpen = ref(false);
const editingPolicy = ref<CompliancePolicy | null>(null);
const prefillFromTemplate = ref<ComplianceTemplate | null>(null);

function openNewPolicy() {
  editingPolicy.value = null;
  prefillFromTemplate.value = null;
  drawerOpen.value = true;
}

function editPolicy(policy: CompliancePolicy) {
  editingPolicy.value = policy;
  prefillFromTemplate.value = null;
  drawerOpen.value = true;
}

function useTemplate(template: ComplianceTemplate) {
  editingPolicy.value = null;
  prefillFromTemplate.value = template;
  activeTab.value = "policies";
  drawerOpen.value = true;
}

function closeDrawer() {
  drawerOpen.value = false;
}

onMounted(async () => {
  await store.fetchPolicies();
});
</script>

<template>
  <div class="p-8 space-y-6 animate-page-enter">
    <PageHeader title="Compliance" :description="`${store.policies.length} polic${store.policies.length === 1 ? 'y' : 'ies'} configured`">
      <template #title-suffix>
        <HelpIcon slug="compliance" :anchor="helpAnchor" title="Compliance admin guide" />
      </template>
      <template #action>
        <Button @click="openNewPolicy">New policy</Button>
      </template>
    </PageHeader>

    <Alert v-if="store.policiesError" type="danger">{{ store.policiesError }}</Alert>

    <Tabs :tabs="tabs" :model-value="activeTab" variant="pill" @update:model-value="activeTab = $event as string" />

    <PoliciesTable v-if="activeTab === 'policies'" :policies="store.policies" :is-loading="store.isLoadingPolicies" @edit="editPolicy" />
    <ViolationsQueue v-else-if="activeTab === 'violations'" />
    <TemplateGallery v-else-if="activeTab === 'templates'" @use="useTemplate" />
    <AppListsPanel v-else-if="activeTab === 'app-lists'" />

    <PolicyBuilderDrawer
      :open="drawerOpen"
      :policy="editingPolicy"
      :prefill-conditions="prefillFromTemplate?.conditions ?? null"
      :prefill-name="prefillFromTemplate?.title ?? null"
      :prefill-framework="prefillFromTemplate?.framework ?? null"
      :prefill-control-ref="prefillFromTemplate?.controlRef ?? null"
      :prefill-severity="prefillFromTemplate?.severity ?? null"
      :prefill-condition-logic="prefillFromTemplate?.conditionLogic ?? null"
      @close="closeDrawer"
      @saved="store.fetchPolicies()"
    />
  </div>
</template>
