<script setup lang="ts">
// Settings top-level view — Integrations / Threat Intel / Case Auto-Run
// Rules / Case SLA tabs. New in Phase 5 (main.py's Integrations, Threat
// Intel Providers, Case Auto-Run Rules, and Case SLA settings didn't
// previously have a home in this app's nav).
import { Alert, Button, PageHeader, Tabs } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import HelpIcon from "../components/shared/HelpIcon.vue";
import IntegrationsTable from "../components/settings/IntegrationsTable.vue";
import IntegrationDialog from "../components/settings/IntegrationDialog.vue";
import ThreatIntelProvidersTable from "../components/settings/ThreatIntelProvidersTable.vue";
import ThreatIntelProviderDialog from "../components/settings/ThreatIntelProviderDialog.vue";
import CaseAutoRunRulesTable from "../components/settings/CaseAutoRunRulesTable.vue";
import CaseAutoRunRuleDialog from "../components/settings/CaseAutoRunRuleDialog.vue";
import CaseSlaSettingsForm from "../components/settings/CaseSlaSettingsForm.vue";
import LogExportDestinationsPanel from "../components/settings/LogExportDestinationsPanel.vue";
import DeviceDataWebhookPanel from "../components/settings/DeviceDataWebhookPanel.vue";
import SystemHealthPanel from "../components/settings/SystemHealthPanel.vue";
import BackupRestorePanel from "../components/settings/BackupRestorePanel.vue";
import AppliveryEventsPanel from "../components/settings/AppliveryEventsPanel.vue";
import { useIntegrationsStore, type Integration } from "../stores/integrations";
import { useThreatIntelStore, type ThreatIntelProvider } from "../stores/threatIntel";
import { useCasesStore, type CaseAutoRunRule } from "../stores/cases";

const integrationsStore = useIntegrationsStore();
const threatIntelStore = useThreatIntelStore();
const casesStore = useCasesStore();

const tabs = [
  { id: "integrations", label: "Integrations" },
  { id: "threat-intel", label: "Threat Intel" },
  { id: "case-autorun", label: "Case Auto-Run Rules" },
  { id: "case-sla", label: "Case SLA" },
  { id: "applivery-events", label: "Applivery Events" },
  { id: "device-webhook", label: "Device Data Webhook" },
  { id: "logexport", label: "Log Export" },
  { id: "systemhealth", label: "System Health" },
  { id: "backup", label: "Backup & Restore" },
];
const activeTab = ref("integrations");
// Port of SETTINGS_TAB_ANCHORS (App.jsx) — this view's tab ids don't
// exactly match the original's (e.g. "case-autorun" vs "caseautorun"), so
// mapped explicitly rather than reused verbatim.
const SETTINGS_TAB_ANCHORS: Record<string, string> = {
  integrations: "integrations", "threat-intel": "threat-intel", "case-autorun": "case-auto-run-rules",
  "case-sla": "case-sla", "applivery-events": "applivery-events", "device-webhook": "device-data-webhook",
  logexport: "log-export", systemhealth: "system-health", backup: "backup--restore",
};
const helpAnchor = computed(() => SETTINGS_TAB_ANCHORS[activeTab.value] ?? null);

const integrationDialogOpen = ref(false);
const editingIntegration = ref<Integration | null>(null);
function openNewIntegration() { editingIntegration.value = null; integrationDialogOpen.value = true; }
function editIntegration(i: Integration) { editingIntegration.value = i; integrationDialogOpen.value = true; }
async function deleteIntegration(i: Integration) { await integrationsStore.deleteIntegration(i.id); }

const providerDialogOpen = ref(false);
const editingProvider = ref<ThreatIntelProvider | null>(null);
function openNewProvider() { editingProvider.value = null; providerDialogOpen.value = true; }
function editProvider(p: ThreatIntelProvider) { editingProvider.value = p; providerDialogOpen.value = true; }
async function deleteProvider(p: ThreatIntelProvider) { await threatIntelStore.deleteProvider(p.id); }

const ruleDialogOpen = ref(false);
const editingRule = ref<CaseAutoRunRule | null>(null);
function openNewRule() { editingRule.value = null; ruleDialogOpen.value = true; }
function editRule(r: CaseAutoRunRule) { editingRule.value = r; ruleDialogOpen.value = true; }
async function deleteRule(r: CaseAutoRunRule) { await casesStore.deleteAutoRunRule(r.id); }

onMounted(async () => {
  await integrationsStore.fetchIntegrations();
});

async function onTabChange(tabId: string) {
  activeTab.value = tabId;
  if (tabId === "threat-intel" && threatIntelStore.providers.length === 0) await threatIntelStore.fetchProviders();
  if (tabId === "case-autorun" && casesStore.autoRunRules.length === 0) await casesStore.fetchAutoRunRules();
}
</script>

<template>
  <div class="p-8 space-y-6 animate-page-enter">
    <PageHeader title="Settings">
      <template #title-suffix>
        <HelpIcon slug="settings" :anchor="helpAnchor" title="Settings admin guide" />
      </template>
      <template #action>
        <Button v-if="activeTab === 'integrations'" @click="openNewIntegration">New integration</Button>
        <Button v-else-if="activeTab === 'threat-intel'" @click="openNewProvider">New provider</Button>
        <Button v-else-if="activeTab === 'case-autorun'" @click="openNewRule">New rule</Button>
      </template>
    </PageHeader>

    <Tabs :tabs="tabs" :model-value="activeTab" variant="pill" @update:model-value="onTabChange($event as string)" />

    <template v-if="activeTab === 'integrations'">
      <Alert v-if="integrationsStore.error" type="danger">{{ integrationsStore.error }}</Alert>
      <IntegrationsTable :integrations="integrationsStore.integrations" :is-loading="integrationsStore.isLoading" @edit="editIntegration" @delete="deleteIntegration" />
    </template>
    <template v-else-if="activeTab === 'threat-intel'">
      <Alert v-if="threatIntelStore.error" type="danger">{{ threatIntelStore.error }}</Alert>
      <ThreatIntelProvidersTable :providers="threatIntelStore.providers" :is-loading="threatIntelStore.isLoading" @edit="editProvider" @delete="deleteProvider" />
    </template>
    <template v-else-if="activeTab === 'case-autorun'">
      <CaseAutoRunRulesTable :rules="casesStore.autoRunRules" :is-loading="false" @edit="editRule" @delete="deleteRule" />
    </template>
    <CaseSlaSettingsForm v-else-if="activeTab === 'case-sla'" />
    <AppliveryEventsPanel v-else-if="activeTab === 'applivery-events'" />
    <DeviceDataWebhookPanel v-else-if="activeTab === 'device-webhook'" />
    <LogExportDestinationsPanel v-else-if="activeTab === 'logexport'" />
    <SystemHealthPanel v-else-if="activeTab === 'systemhealth'" />
    <BackupRestorePanel v-else-if="activeTab === 'backup'" />

    <IntegrationDialog :open="integrationDialogOpen" :integration="editingIntegration" @close="integrationDialogOpen = false" @saved="integrationsStore.fetchIntegrations()" />
    <ThreatIntelProviderDialog :open="providerDialogOpen" :provider="editingProvider" @close="providerDialogOpen = false" @saved="threatIntelStore.fetchProviders()" />
    <CaseAutoRunRuleDialog :open="ruleDialogOpen" :rule="editingRule" @close="ruleDialogOpen = false" @saved="casesStore.fetchAutoRunRules()" />
  </div>
</template>
