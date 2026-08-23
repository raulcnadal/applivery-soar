<script setup lang="ts">
// Workflows top-level view — port of WorkflowsView.jsx: exactly 3 sub-views
// reached via a ViewSwitcher pill (Workflows / Script & OMA-URI Library /
// Firewall Policy Library — NOT the 6 flat tabs this file used to have).
// "Recent runs" lives inline below the workflow grid on the Workflows tab,
// not as a separate tab. Script Repos has no persistent tab in the
// original — it's a modal reached from the Library tab's "Import from Git
// repo" button. Triggers is not part of this view at all in the original —
// it's Settings' "Inbound Webhooks" tab; moved there in this same pass.
import { Alert } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ICONS } from "../lib/solarIcons";
import HelpIcon from "../components/shared/HelpIcon.vue";
import DryRunDialog from "../components/workflows/DryRunDialog.vue";
import RecentRunsSection from "../components/workflows/RecentRunsSection.vue";
import RunWorkflowDialog from "../components/workflows/RunWorkflowDialog.vue";
import VersionHistoryModal from "../components/workflows/VersionHistoryModal.vue";
import WorkflowBuilderModal from "../components/workflows/WorkflowBuilderModal.vue";
import WorkflowsTable from "../components/workflows/WorkflowsTable.vue";
import ActionLibraryTable from "../components/workflows/ActionLibraryTable.vue";
import ActionLibraryEntryDialog from "../components/workflows/ActionLibraryEntryDialog.vue";
import ScriptBrowseImportDialog from "../components/workflows/ScriptBrowseImportDialog.vue";
import ScriptRepoImportModal from "../components/workflows/ScriptRepoImportModal.vue";
import FirewallRuleSetsTable from "../components/workflows/FirewallRuleSetsTable.vue";
import FirewallRuleSetBuilderDrawer from "../components/workflows/FirewallRuleSetBuilderDrawer.vue";
import { useWorkflowsStore, type Workflow } from "../stores/workflows";
import { useActionLibraryStore, type ActionLibraryEntry } from "../stores/actionLibrary";
import { useFirewallRuleSetsStore, type FirewallRuleSet } from "../stores/firewallRuleSets";

const store = useWorkflowsStore();
const actionLibraryStore = useActionLibraryStore();
const firewallStore = useFirewallRuleSetsStore();
const route = useRoute();
const router = useRouter();

type Tab = "workflows" | "library" | "firewall";
const tab = ref<Tab>("workflows");
// Port of WORKFLOWS_TAB_ANCHORS (WorkflowsView.jsx:11).
const WORKFLOWS_TAB_ANCHORS: Record<Tab, string> = {
  workflows: "workflow-list", library: "script--oma-uri-library", firewall: "firewall-policy-library",
};
const helpAnchor = computed(() => WORKFLOWS_TAB_ANCHORS[tab.value]);

const builderOpen = ref(false);
const editingWorkflow = ref<Workflow | null>(null);
const dryRunOpen = ref(false);
const runDialogOpen = ref(false);
const versionsOpen = ref(false);
const activeWorkflow = ref<Workflow | null>(null);

const libraryEntryOpen = ref(false);
const editingEntry = ref<ActionLibraryEntry | null>(null);
const browseApplivertOpen = ref(false);
const scriptRepoImportOpen = ref(false);

const firewallBuilderOpen = ref(false);
const editingRuleSet = ref<FirewallRuleSet | null>(null);

// Platform filter for the Workflows list — mirrors ComplianceView.vue's own
// policyPlatformFilter (same option set/labels, same "common" = no
// targetPlatform distinction), added per user request for parity between
// the two views.
const WORKFLOW_PLATFORM_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All platforms" },
  { value: "common", label: "Common (all platforms)" },
  { value: "apple", label: "iOS/iPadOS" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
  { value: "aosp", label: "AOSP" },
];
const workflowPlatformFilter = ref("");
const visibleWorkflows = computed(() => {
  if (workflowPlatformFilter.value === "common") return store.workflows.filter((w) => !w.targetPlatform);
  if (workflowPlatformFilter.value) return store.workflows.filter((w) => w.targetPlatform === workflowPlatformFilter.value);
  return store.workflows;
});

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

async function selectTab(t: Tab) {
  tab.value = t;
  if (t === "library" && actionLibraryStore.entries.length === 0) await actionLibraryStore.fetchEntries();
  if (t === "firewall" && firewallStore.ruleSets.length === 0) await firewallStore.fetchRuleSets();
}

onMounted(async () => {
  await store.fetchWorkflows();
  // Arrived via a cross-link (Compliance's Workflow-column icon click) —
  // auto-open that workflow's builder in edit mode, same query-param
  // pattern as Devices' ?deviceId= and Cases' ?caseId=. Cleared from the
  // URL immediately after so a manual refresh doesn't keep re-opening it.
  const editWorkflowId = route.query.editWorkflowId;
  if (typeof editWorkflowId === "string" && editWorkflowId) {
    const target = store.workflows.find((w) => w.id === editWorkflowId);
    if (target) openEdit(target);
    router.replace({ path: "/workflows", query: {} });
  }
});
</script>

<template>
  <main class="p-4 md:p-8 pb-16">
    <header class="flex justify-between items-start mb-8 gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold leading-tight text-gray-900 dark:text-white">Workflows</h1>
          <HelpIcon slug="workflows" :anchor="helpAnchor" title="Workflows admin guide" />
        </div>
        <p class="text-sm mt-1 text-gray-400">
          Chained actions — MDM commands, API calls, and notifications. Run manually, auto-fired by Compliance Policies on violation, or launched directly from a Case.
        </p>
      </div>
    </header>

    <!-- Full-width toolbar row (matches ComplianceView.vue's layout): the
         platform filter sits flush left, Create Workflow + the sub-view pill
         switcher stay grouped on the right, in that order — per user
         request to match the left/right split used elsewhere. -->
    <div class="flex items-center justify-between gap-3 flex-wrap mb-8">
      <!-- Same invisible/reserved-space trick as the Create Workflow button
           to the right — only meaningful on the Workflows tab, but kept in
           the layout (rather than v-if'd out) on the other two tabs so the
           toolbar row's width doesn't jump when switching tabs. -->
      <select
        v-model="workflowPlatformFilter"
        title="Filter the Workflows list to one platform"
        class="px-2.5 py-2 rounded-lg text-sm font-medium outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500 shrink-0"
        :class="tab === 'workflows' ? '' : 'invisible pointer-events-none'"
        :aria-hidden="tab !== 'workflows'"
        :tabindex="tab === 'workflows' ? 0 : -1"
      >
        <option v-for="p in WORKFLOW_PLATFORM_FILTER_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
      </select>
      <div class="flex flex-wrap items-center gap-2 shrink-0">
        <!-- Always rendered (rather than conditionally mounted) so its layout
             space stays reserved on non-Workflows tabs — otherwise the pill
             switcher next to it visibly shifts position, since removing this
             button changes the row's total width. Port of the original's
             identical `invisible pointer-events-none` trick. -->
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 shrink-0"
          :class="tab === 'workflows' ? '' : 'invisible pointer-events-none'"
          :aria-hidden="tab !== 'workflows'"
          :tabindex="tab === 'workflows' ? 0 : -1"
          @click="openNew"
        >
          <component :is="ICONS.AddSquare" :size="15" weight="Linear" /> Create Workflow
        </button>
        <div class="flex items-center gap-1 p-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 shrink-0 max-w-full overflow-x-auto">
          <button
            class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
            :class="tab === 'workflows' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
            @click="selectTab('workflows')"
          >
            <component :is="ICONS.Structure" :size="14" weight="Linear" /> Workflows
          </button>
          <button
            class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
            :class="tab === 'library' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
            @click="selectTab('library')"
          >
            <component :is="ICONS.Library" :size="14" weight="Linear" /> Script &amp; OMA-URI Library
          </button>
          <button
            class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
            :class="tab === 'firewall' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
            @click="selectTab('firewall')"
          >
            <component :is="ICONS.ShieldCheck" :size="14" weight="Linear" /> Firewall Policy Library
          </button>
        </div>
      </div>
    </div>

    <template v-if="tab === 'library'">
      <Alert v-if="actionLibraryStore.error" type="danger">{{ actionLibraryStore.error }}</Alert>
      <ActionLibraryTable
        :entries="actionLibraryStore.entries"
        :is-loading="actionLibraryStore.isLoading"
        @edit="openEditLibraryEntry"
        @new="openNewLibraryEntry"
        @fetch-applivery="browseApplivertOpen = true"
        @import-git-repo="scriptRepoImportOpen = true"
      />
    </template>
    <template v-else-if="tab === 'firewall'">
      <Alert v-if="firewallStore.error" type="danger">{{ firewallStore.error }}</Alert>
      <FirewallRuleSetsTable :rule-sets="firewallStore.ruleSets" :is-loading="firewallStore.isLoading" @edit="openEditRuleSet" @new="openNewRuleSet" />
    </template>
    <template v-else>
      <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
      <WorkflowsTable :workflows="visibleWorkflows" :is-loading="store.isLoading" @edit="openEdit" @dry-run="openDryRun" @run="openRun" @versions="openVersions" />
      <RecentRunsSection />
    </template>

    <WorkflowBuilderModal :open="builderOpen" :workflow="editingWorkflow" @close="builderOpen = false" @saved="store.fetchWorkflows()" />
    <DryRunDialog :open="dryRunOpen" :workflow="activeWorkflow" @close="dryRunOpen = false" />
    <RunWorkflowDialog :open="runDialogOpen" :workflow="activeWorkflow" @close="runDialogOpen = false" />
    <VersionHistoryModal :open="versionsOpen" :workflow="activeWorkflow" @close="versionsOpen = false" @restored="store.fetchWorkflows()" />

    <ActionLibraryEntryDialog :open="libraryEntryOpen" :entry="editingEntry" @close="libraryEntryOpen = false" @saved="actionLibraryStore.fetchEntries()" />
    <ScriptBrowseImportDialog :open="browseApplivertOpen" @close="browseApplivertOpen = false" @imported="actionLibraryStore.fetchEntries()" />
    <ScriptRepoImportModal :open="scriptRepoImportOpen" @close="scriptRepoImportOpen = false" @imported="actionLibraryStore.fetchEntries()" />

    <FirewallRuleSetBuilderDrawer :open="firewallBuilderOpen" :rule-set="editingRuleSet" @close="firewallBuilderOpen = false" @saved="firewallStore.fetchRuleSets()" />
  </main>
</template>
