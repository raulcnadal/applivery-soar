<script setup lang="ts">
// Workflows top-level view — Workflows / Run History / Action Library /
// Firewall Policies / Script Repos / Triggers tabs. Port of the original
// app's Workflows view (Phase 4a: builder/dry-run/run/versions; Phase 4b:
// Action Library, Firewall Rule Sets, Script Repos, Triggers).
import { Alert, Button, PageHeader, Tabs } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import DryRunDialog from "../components/workflows/DryRunDialog.vue";
import RunHistoryTable from "../components/workflows/RunHistoryTable.vue";
import RunWorkflowDialog from "../components/workflows/RunWorkflowDialog.vue";
import VersionHistoryDrawer from "../components/workflows/VersionHistoryDrawer.vue";
import WorkflowBuilderDrawer from "../components/workflows/WorkflowBuilderDrawer.vue";
import WorkflowsTable from "../components/workflows/WorkflowsTable.vue";
import ActionLibraryTable from "../components/workflows/ActionLibraryTable.vue";
import ActionLibraryEntryDialog from "../components/workflows/ActionLibraryEntryDialog.vue";
import ScriptBrowseImportDialog from "../components/workflows/ScriptBrowseImportDialog.vue";
import FirewallRuleSetsTable from "../components/workflows/FirewallRuleSetsTable.vue";
import FirewallRuleSetBuilderDrawer from "../components/workflows/FirewallRuleSetBuilderDrawer.vue";
import ScriptReposTable from "../components/workflows/ScriptReposTable.vue";
import ScriptRepoDialog from "../components/workflows/ScriptRepoDialog.vue";
import ScriptRepoBrowseDialog from "../components/workflows/ScriptRepoBrowseDialog.vue";
import TriggersTable from "../components/workflows/TriggersTable.vue";
import TriggerDialog from "../components/workflows/TriggerDialog.vue";
import { useWorkflowsStore, type Workflow } from "../stores/workflows";
import { useActionLibraryStore, type ActionLibraryEntry } from "../stores/actionLibrary";
import { useFirewallRuleSetsStore, type FirewallRuleSet } from "../stores/firewallRuleSets";
import { useScriptReposStore, type ScriptRepo } from "../stores/scriptRepos";
import { useTriggersStore, type Trigger } from "../stores/triggers";

const store = useWorkflowsStore();
const actionLibraryStore = useActionLibraryStore();
const firewallStore = useFirewallRuleSetsStore();
const scriptReposStore = useScriptReposStore();
const triggersStore = useTriggersStore();

const tabs = [
  { id: "workflows", label: "Workflows" },
  { id: "runs", label: "Run History" },
  { id: "action-library", label: "Action Library" },
  { id: "firewall", label: "Firewall Policies" },
  { id: "script-repos", label: "Script Repos" },
  { id: "triggers", label: "Triggers" },
];
const activeTab = ref("workflows");

const builderOpen = ref(false);
const editingWorkflow = ref<Workflow | null>(null);
const dryRunOpen = ref(false);
const runDialogOpen = ref(false);
const versionsOpen = ref(false);
const activeWorkflow = ref<Workflow | null>(null);

const libraryEntryOpen = ref(false);
const editingEntry = ref<ActionLibraryEntry | null>(null);
const browseImportOpen = ref(false);

const firewallBuilderOpen = ref(false);
const editingRuleSet = ref<FirewallRuleSet | null>(null);

const scriptRepoDialogOpen = ref(false);
const scriptRepoBrowseOpen = ref(false);
const activeRepo = ref<ScriptRepo | null>(null);

const triggerDialogOpen = ref(false);
const editingTrigger = ref<Trigger | null>(null);

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

function openNewLibraryEntry() {
  editingEntry.value = null;
  libraryEntryOpen.value = true;
}
function openEditLibraryEntry(e: ActionLibraryEntry) {
  editingEntry.value = e;
  libraryEntryOpen.value = true;
}

function openNewRuleSet() {
  editingRuleSet.value = null;
  firewallBuilderOpen.value = true;
}
function openEditRuleSet(r: FirewallRuleSet) {
  editingRuleSet.value = r;
  firewallBuilderOpen.value = true;
}

function openBrowseRepo(r: ScriptRepo) {
  activeRepo.value = r;
  scriptRepoBrowseOpen.value = true;
}

function openNewTrigger() {
  editingTrigger.value = null;
  triggerDialogOpen.value = true;
}
function openEditTrigger(t: Trigger) {
  editingTrigger.value = t;
  triggerDialogOpen.value = true;
}

onMounted(async () => {
  await store.fetchWorkflows();
});

async function onTabChange(tabId: string) {
  activeTab.value = tabId;
  if (tabId === "action-library" && actionLibraryStore.entries.length === 0) await actionLibraryStore.fetchEntries();
  if (tabId === "firewall" && firewallStore.ruleSets.length === 0) await firewallStore.fetchRuleSets();
  if (tabId === "script-repos" && scriptReposStore.repos.length === 0) await scriptReposStore.fetchRepos();
  if (tabId === "triggers" && triggersStore.triggers.length === 0) await triggersStore.fetchTriggers();
}
</script>

<template>
  <div class="p-8 space-y-6 animate-page-enter">
    <PageHeader title="Workflows" :description="`${store.workflows.length} workflow${store.workflows.length === 1 ? '' : 's'} configured`">
      <template #action>
        <Button v-if="activeTab === 'workflows'" @click="openNew">New workflow</Button>
        <Button v-else-if="activeTab === 'action-library'" variant="secondary" class="mr-2" @click="browseImportOpen = true">Fetch from Applivery</Button>
        <Button v-if="activeTab === 'action-library'" @click="openNewLibraryEntry">New entry</Button>
        <Button v-if="activeTab === 'firewall'" @click="openNewRuleSet">New rule set</Button>
        <Button v-if="activeTab === 'script-repos'" @click="scriptRepoDialogOpen = true">Connect repo</Button>
        <Button v-if="activeTab === 'triggers'" @click="openNewTrigger">New trigger</Button>
      </template>
    </PageHeader>

    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <Tabs :tabs="tabs" :model-value="activeTab" variant="pill" @update:model-value="onTabChange($event as string)" />

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
    <template v-else-if="activeTab === 'action-library'">
      <Alert v-if="actionLibraryStore.error" type="danger">{{ actionLibraryStore.error }}</Alert>
      <ActionLibraryTable :entries="actionLibraryStore.entries" :is-loading="actionLibraryStore.isLoading" @edit="openEditLibraryEntry" />
    </template>
    <template v-else-if="activeTab === 'firewall'">
      <Alert v-if="firewallStore.error" type="danger">{{ firewallStore.error }}</Alert>
      <FirewallRuleSetsTable :rule-sets="firewallStore.ruleSets" :is-loading="firewallStore.isLoading" @edit="openEditRuleSet" />
    </template>
    <template v-else-if="activeTab === 'script-repos'">
      <Alert v-if="scriptReposStore.error" type="danger">{{ scriptReposStore.error }}</Alert>
      <ScriptReposTable :repos="scriptReposStore.repos" :is-loading="scriptReposStore.isLoading" @browse="openBrowseRepo" />
    </template>
    <template v-else-if="activeTab === 'triggers'">
      <Alert v-if="triggersStore.error" type="danger">{{ triggersStore.error }}</Alert>
      <TriggersTable :triggers="triggersStore.triggers" :is-loading="triggersStore.isLoading" @edit="openEditTrigger" />
    </template>

    <WorkflowBuilderDrawer :open="builderOpen" :workflow="editingWorkflow" @close="builderOpen = false" @saved="store.fetchWorkflows()" />
    <DryRunDialog :open="dryRunOpen" :workflow="activeWorkflow" @close="dryRunOpen = false" />
    <RunWorkflowDialog :open="runDialogOpen" :workflow="activeWorkflow" @close="runDialogOpen = false" />
    <VersionHistoryDrawer :open="versionsOpen" :workflow="activeWorkflow" @close="versionsOpen = false" @restored="store.fetchWorkflows()" />

    <ActionLibraryEntryDialog :open="libraryEntryOpen" :entry="editingEntry" @close="libraryEntryOpen = false" @saved="actionLibraryStore.fetchEntries()" />
    <ScriptBrowseImportDialog :open="browseImportOpen" @close="browseImportOpen = false" @imported="actionLibraryStore.fetchEntries()" />

    <FirewallRuleSetBuilderDrawer :open="firewallBuilderOpen" :rule-set="editingRuleSet" @close="firewallBuilderOpen = false" @saved="firewallStore.fetchRuleSets()" />

    <ScriptRepoDialog :open="scriptRepoDialogOpen" @close="scriptRepoDialogOpen = false" @saved="scriptReposStore.fetchRepos()" />
    <ScriptRepoBrowseDialog :open="scriptRepoBrowseOpen" :repo="activeRepo" @close="scriptRepoBrowseOpen = false" @imported="actionLibraryStore.fetchEntries()" />

    <TriggerDialog :open="triggerDialogOpen" :trigger="editingTrigger" @close="triggerDialogOpen = false" @saved="triggersStore.fetchTriggers()" />
  </div>
</template>
