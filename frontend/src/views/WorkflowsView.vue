<script setup lang="ts">
// Workflows top-level view — Workflows / Run History tabs. Port of the
// original app's Workflows view (migration-plan.md Phase 4a checkpoint:
// "Workflow Builder, dry-run preview, manual run + live status, version
// history/restore all functional").
import { Alert, Button, PageHeader, Tabs } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import DryRunDialog from "../components/workflows/DryRunDialog.vue";
import RunHistoryTable from "../components/workflows/RunHistoryTable.vue";
import RunWorkflowDialog from "../components/workflows/RunWorkflowDialog.vue";
import VersionHistoryDrawer from "../components/workflows/VersionHistoryDrawer.vue";
import WorkflowBuilderDrawer from "../components/workflows/WorkflowBuilderDrawer.vue";
import WorkflowsTable from "../components/workflows/WorkflowsTable.vue";
import { useWorkflowsStore, type Workflow } from "../stores/workflows";

const store = useWorkflowsStore();

const tabs = [
  { id: "workflows", label: "Workflows" },
  { id: "runs", label: "Run History" },
];
const activeTab = ref("workflows");

const builderOpen = ref(false);
const editingWorkflow = ref<Workflow | null>(null);
const dryRunOpen = ref(false);
const runDialogOpen = ref(false);
const versionsOpen = ref(false);
const activeWorkflow = ref<Workflow | null>(null);

function openNew() {
  editingWorkflow.value = null;
  builderOpen.value = true;
}
function openEdit(w: Workflow) {
  editingWorkflow.value = w;
  builderOpen.value = true;
}
function openDryRun(w: Workflow) {
  activeWorkflow.value = w;
  dryRunOpen.value = true;
}
function openRun(w: Workflow) {
  activeWorkflow.value = w;
  runDialogOpen.value = true;
}
function openVersions(w: Workflow) {
  activeWorkflow.value = w;
  versionsOpen.value = true;
}

onMounted(async () => {
  await store.fetchWorkflows();
});
</script>

<template>
  <div class="p-8 space-y-6 animate-page-enter">
    <PageHeader title="Workflows" :description="`${store.workflows.length} workflow${store.workflows.length === 1 ? '' : 's'} configured`">
      <template #action>
        <Button @click="openNew">New workflow</Button>
      </template>
    </PageHeader>

    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <Tabs :tabs="tabs" :model-value="activeTab" variant="pill" @update:model-value="activeTab = $event as string" />

    <WorkflowsTable
      v-if="activeTab === 'workflows'"
      :workflows="store.workflows"
      :is-loading="store.isLoading"
      @edit="openEdit"
      @dry-run="openDryRun"
      @run="openRun"
      @versions="openVersions"
    />
    <RunHistoryTable v-else-if="activeTab === 'runs'" />

    <WorkflowBuilderDrawer :open="builderOpen" :workflow="editingWorkflow" @close="builderOpen = false" @saved="store.fetchWorkflows()" />
    <DryRunDialog :open="dryRunOpen" :workflow="activeWorkflow" @close="dryRunOpen = false" />
    <RunWorkflowDialog :open="runDialogOpen" :workflow="activeWorkflow" @close="runDialogOpen = false" />
    <VersionHistoryDrawer :open="versionsOpen" :workflow="activeWorkflow" @close="versionsOpen = false" @restored="store.fetchWorkflows()" />
  </div>
</template>
