<script setup lang="ts">
// Settings top-level view. Nav order mirrors docs/settings.md's own
// left-hand section order. "Inbound Webhooks" (Triggers) intentionally has
// no tab here — its UI lives under Workflows (Phase 4b), a deliberate
// reorg, not a gap. "Roles" is Super-Admin-only and hidden from the tab
// list entirely for everyone else, matching the original ("hidden from the
// nav entirely for everyone else").
import { Alert, Button, PageHeader, Tabs } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import HelpIcon from "../components/shared/HelpIcon.vue";
import GeneralSettingsForm from "../components/settings/GeneralSettingsForm.vue";
import SmtpSettingsForm from "../components/settings/SmtpSettingsForm.vue";
import AccountPanel from "../components/settings/AccountPanel.vue";
import BackupRestorePanel from "../components/settings/BackupRestorePanel.vue";
import AuditLogRetentionPanel from "../components/settings/AuditLogRetentionPanel.vue";
import WorkspaceAutomationPanel from "../components/settings/WorkspaceAutomationPanel.vue";
import DeviceDataWebhookPanel from "../components/settings/DeviceDataWebhookPanel.vue";
import LogExportDestinationsPanel from "../components/settings/LogExportDestinationsPanel.vue";
import CaseAutoRunRulesTable from "../components/settings/CaseAutoRunRulesTable.vue";
import CaseAutoRunRuleDialog from "../components/settings/CaseAutoRunRuleDialog.vue";
import AppliveryEventsPanel from "../components/settings/AppliveryEventsPanel.vue";
import CaseSlaSettingsForm from "../components/settings/CaseSlaSettingsForm.vue";
import SystemHealthPanel from "../components/settings/SystemHealthPanel.vue";
import OsUpdateCatalogPanel from "../components/settings/OsUpdateCatalogPanel.vue";
import VulnerabilityCatalogPanel from "../components/settings/VulnerabilityCatalogPanel.vue";
import VulnerabilityServicePanel from "../components/settings/VulnerabilityServicePanel.vue";
import OsLifecyclePanel from "../components/settings/OsLifecyclePanel.vue";
import AppleAppUpdatesPanel from "../components/settings/AppleAppUpdatesPanel.vue";
import IntegrationsTable from "../components/settings/IntegrationsTable.vue";
import IntegrationDialog from "../components/settings/IntegrationDialog.vue";
import ThreatIntelProvidersTable from "../components/settings/ThreatIntelProvidersTable.vue";
import ThreatIntelProviderDialog from "../components/settings/ThreatIntelProviderDialog.vue";
import RolesSettingsPanel from "../components/settings/RolesSettingsPanel.vue";
import { useIntegrationsStore, type Integration } from "../stores/integrations";
import { useThreatIntelStore, type ThreatIntelProvider } from "../stores/threatIntel";
import { useCasesStore, type CaseAutoRunRule } from "../stores/cases";
import { useAuthStore } from "../stores/auth";

const integrationsStore = useIntegrationsStore();
const threatIntelStore = useThreatIntelStore();
const casesStore = useCasesStore();
const auth = useAuthStore();

const isSuperAdmin = computed(() => Boolean(auth.access?.isSuperAdmin));

const tabs = computed(() => {
  const base = [
    { id: "general", label: "General" },
    { id: "smtp", label: "SMTP" },
    { id: "account", label: "Account" },
    { id: "backup", label: "Backup & Restore" },
    { id: "auditlog", label: "Audit Log" },
    { id: "workspace-automation", label: "Workspace Automation" },
    { id: "device-webhook", label: "Device Data Webhook" },
    { id: "logexport", label: "Log Export" },
    { id: "case-autorun", label: "Case Auto-Run Rules" },
    { id: "applivery-events", label: "Applivery Events" },
    { id: "case-sla", label: "Case SLA" },
    { id: "systemhealth", label: "System Health" },
    { id: "os-updates", label: "OS Updates" },
    { id: "vuln-catalog", label: "Vulnerability Catalog" },
    { id: "vuln-service", label: "Vulnerability Service" },
    { id: "os-lifecycle", label: "OS Lifecycle" },
    { id: "apple-app-updates", label: "Apple App Updates" },
    { id: "integrations", label: "Integrations" },
    { id: "threat-intel", label: "Threat Intel" },
  ];
  if (isSuperAdmin.value) base.push({ id: "roles", label: "Roles" });
  return base;
});
const activeTab = ref("general");
// Port of SETTINGS_TAB_ANCHORS (App.jsx) — maps this view's tab ids onto
// docs/settings.md's anchor slugs.
const SETTINGS_TAB_ANCHORS: Record<string, string> = {
  general: "general", smtp: "smtp", account: "account", backup: "backup--restore",
  auditlog: "audit-log", "workspace-automation": "workspace-automation",
  "device-webhook": "device-data-webhook", logexport: "log-export",
  "case-autorun": "case-auto-run-rules", "applivery-events": "applivery-events",
  "case-sla": "case-sla", systemhealth: "system-health",
  "os-updates": "os-updates", "vuln-catalog": "vulnerability-catalog",
  "vuln-service": "vulnerability-service", "os-lifecycle": "os-lifecycle",
  "apple-app-updates": "apple-app-updates",
  integrations: "integrations", "threat-intel": "threat-intel", roles: "roles",
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

    <GeneralSettingsForm v-if="activeTab === 'general'" />
    <SmtpSettingsForm v-else-if="activeTab === 'smtp'" />
    <AccountPanel v-else-if="activeTab === 'account'" />
    <BackupRestorePanel v-else-if="activeTab === 'backup'" />
    <AuditLogRetentionPanel v-else-if="activeTab === 'auditlog'" />
    <WorkspaceAutomationPanel v-else-if="activeTab === 'workspace-automation'" />
    <DeviceDataWebhookPanel v-else-if="activeTab === 'device-webhook'" />
    <LogExportDestinationsPanel v-else-if="activeTab === 'logexport'" />
    <template v-else-if="activeTab === 'case-autorun'">
      <CaseAutoRunRulesTable :rules="casesStore.autoRunRules" :is-loading="false" @edit="editRule" @delete="deleteRule" />
    </template>
    <AppliveryEventsPanel v-else-if="activeTab === 'applivery-events'" />
    <CaseSlaSettingsForm v-else-if="activeTab === 'case-sla'" />
    <SystemHealthPanel v-else-if="activeTab === 'systemhealth'" />
    <OsUpdateCatalogPanel v-else-if="activeTab === 'os-updates'" />
    <VulnerabilityCatalogPanel v-else-if="activeTab === 'vuln-catalog'" />
    <VulnerabilityServicePanel v-else-if="activeTab === 'vuln-service'" />
    <OsLifecyclePanel v-else-if="activeTab === 'os-lifecycle'" />
    <AppleAppUpdatesPanel v-else-if="activeTab === 'apple-app-updates'" />
    <template v-else-if="activeTab === 'integrations'">
      <Alert v-if="integrationsStore.error" type="danger">{{ integrationsStore.error }}</Alert>
      <IntegrationsTable :integrations="integrationsStore.integrations" :is-loading="integrationsStore.isLoading" @edit="editIntegration" @delete="deleteIntegration" />
    </template>
    <template v-else-if="activeTab === 'threat-intel'">
      <Alert v-if="threatIntelStore.error" type="danger">{{ threatIntelStore.error }}</Alert>
      <ThreatIntelProvidersTable :providers="threatIntelStore.providers" :is-loading="threatIntelStore.isLoading" @edit="editProvider" @delete="deleteProvider" />
    </template>
    <RolesSettingsPanel v-else-if="activeTab === 'roles' && isSuperAdmin" />

    <IntegrationDialog :open="integrationDialogOpen" :integration="editingIntegration" @close="integrationDialogOpen = false" @saved="integrationsStore.fetchIntegrations()" />
    <ThreatIntelProviderDialog :open="providerDialogOpen" :provider="editingProvider" @close="providerDialogOpen = false" @saved="threatIntelStore.fetchProviders()" />
    <CaseAutoRunRuleDialog :open="ruleDialogOpen" :rule="editingRule" @close="ruleDialogOpen = false" @saved="casesStore.fetchAutoRunRules()" />
  </div>
</template>
