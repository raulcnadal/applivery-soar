<script setup lang="ts">
// "Platform Settings" — a full-screen modal overlay (gear icon, top nav),
// not a routed page. Port of App.jsx:5798-6399: header (icon + title + help
// + close), a w-56 left-hand nav rail of icon+label buttons (one full-width
// content pane per section — the original's own comment at App.jsx:5811-5814
// notes this replaced an earlier fixed two-column grid that got unbalanced
// past ~5 sections), and a footer "Apply & Save Configuration" button that
// just closes the modal (every section already persists its own changes;
// nothing to batch-save). SETTINGS_TABS below mirrors App.jsx:254-278
// exactly — same order, same labels, same icons (mapped 1:1 to their
// solar-icons/vue equivalents) — with one intentional, disclosed addition:
// "Inbound Webhooks" was moved here from Workflows (Phase 4) rather than
// being genuinely missing as an earlier pass had believed.
import { Alert, Button } from "@applivery/bluesky-vue";
import { computed, onMounted, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import HelpIcon from "../shared/HelpIcon.vue";
import GeneralSettingsForm from "./GeneralSettingsForm.vue";
import SmtpSettingsForm from "./SmtpSettingsForm.vue";
import AccountPanel from "./AccountPanel.vue";
import BackupRestorePanel from "./BackupRestorePanel.vue";
import AuditLogRetentionPanel from "./AuditLogRetentionPanel.vue";
import WorkspaceAutomationPanel from "./WorkspaceAutomationPanel.vue";
import DeviceDataWebhookPanel from "./DeviceDataWebhookPanel.vue";
import LogExportDestinationsPanel from "./LogExportDestinationsPanel.vue";
import TriggersTable from "./TriggersTable.vue";
import TriggerDialog from "./TriggerDialog.vue";
import CaseAutoRunRulesTable from "./CaseAutoRunRulesTable.vue";
import CaseAutoRunRuleDialog from "./CaseAutoRunRuleDialog.vue";
import AppliveryEventsPanel from "./AppliveryEventsPanel.vue";
import CaseSlaSettingsForm from "./CaseSlaSettingsForm.vue";
import SystemHealthPanel from "./SystemHealthPanel.vue";
import OsUpdateCatalogPanel from "./OsUpdateCatalogPanel.vue";
import VulnerabilityCatalogPanel from "./VulnerabilityCatalogPanel.vue";
import VulnerabilityServicePanel from "./VulnerabilityServicePanel.vue";
import OsLifecyclePanel from "./OsLifecyclePanel.vue";
import AppleAppUpdatesPanel from "./AppleAppUpdatesPanel.vue";
import IntegrationsTable from "./IntegrationsTable.vue";
import IntegrationDialog from "./IntegrationDialog.vue";
import ThreatIntelProvidersTable from "./ThreatIntelProvidersTable.vue";
import ThreatIntelProviderDialog from "./ThreatIntelProviderDialog.vue";
import RolesSettingsPanel from "./RolesSettingsPanel.vue";
import { useIntegrationsStore, type Integration } from "../../stores/integrations";
import { useThreatIntelStore, type ThreatIntelProvider } from "../../stores/threatIntel";
import { useCasesStore, type CaseAutoRunRule } from "../../stores/cases";
import { useTriggersStore, type Trigger } from "../../stores/triggers";
import { useAuthStore } from "../../stores/auth";

const emit = defineEmits<{ close: [] }>();

const integrationsStore = useIntegrationsStore();
const threatIntelStore = useThreatIntelStore();
const casesStore = useCasesStore();
const triggersStore = useTriggersStore();
const auth = useAuthStore();

const isSuperAdmin = computed(() => Boolean(auth.access?.isSuperAdmin));

interface SettingsTab { id: string; label: string; icon: any; superAdminOnly?: boolean }
// Order + labels + icons match SETTINGS_TABS (App.jsx:254-278) exactly.
const SETTINGS_TABS: SettingsTab[] = [
  { id: "general", label: "General", icon: ICONS.Settings },
  { id: "smtp", label: "Email (SMTP)", icon: ICONS.Letter },
  { id: "account", label: "Account", icon: ICONS.UserCircle },
  { id: "backup", label: "Backup & Restore", icon: ICONS.Download },
  { id: "auditlog", label: "Audit Log", icon: ICONS.DocumentText },
  { id: "workspace-automation", label: "Workspace Automation", icon: ICONS.Refresh },
  { id: "device-webhook", label: "Device Data Webhook", icon: ICONS.PlugCircle },
  { id: "logexport", label: "Log Export", icon: ICONS.Database },
  { id: "triggers", label: "Inbound Webhooks", icon: ICONS.Bolt },
  { id: "case-autorun", label: "Case Auto-Run Rules", icon: ICONS.Target },
  { id: "applivery-events", label: "Applivery Events", icon: ICONS.Satellite },
  { id: "case-sla", label: "Case SLA", icon: ICONS.ClockCircle },
  { id: "systemhealth", label: "System Health", icon: ICONS.Pulse2 },
  { id: "os-updates", label: "OS Updates", icon: ICONS.Cpu },
  { id: "vuln-catalog", label: "Vulnerability Catalog", icon: ICONS.Bug },
  { id: "vuln-service", label: "Vulnerability Service", icon: ICONS.ShieldWarning },
  { id: "os-lifecycle", label: "OS Lifecycle", icon: ICONS.Hourglass },
  { id: "apple-app-updates", label: "App Updates (Apple)", icon: ICONS.Delivery },
  { id: "integrations", label: "Ticketing & Chat", icon: ICONS.ChatRound },
  { id: "threat-intel", label: "Threat Intel", icon: ICONS.Radar },
  { id: "roles", label: "Roles", icon: ICONS.ShieldCheck, superAdminOnly: true },
];
const visibleTabs = computed(() => SETTINGS_TABS.filter((t) => !t.superAdminOnly || isSuperAdmin.value));

const activeTab = ref("general");
// Port of SETTINGS_TAB_ANCHORS (App.jsx:288-309) — maps this modal's tab
// ids onto docs/settings.md's anchor slugs.
const SETTINGS_TAB_ANCHORS: Record<string, string> = {
  general: "general", smtp: "smtp", account: "account", backup: "backup--restore",
  auditlog: "audit-log", "workspace-automation": "workspace-automation",
  "device-webhook": "device-data-webhook", logexport: "log-export",
  triggers: "inbound-webhooks",
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

const triggerDialogOpen = ref(false);
const editingTrigger = ref<Trigger | null>(null);
function openNewTrigger() { editingTrigger.value = null; triggerDialogOpen.value = true; }
function editTrigger(t: Trigger) { editingTrigger.value = t; triggerDialogOpen.value = true; }

onMounted(async () => {
  await integrationsStore.fetchIntegrations();
});

async function selectTab(tabId: string) {
  activeTab.value = tabId;
  if (tabId === "threat-intel" && threatIntelStore.providers.length === 0) await threatIntelStore.fetchProviders();
  if (tabId === "case-autorun" && casesStore.autoRunRules.length === 0) await casesStore.fetchAutoRunRules();
  if (tabId === "triggers" && triggersStore.triggers.length === 0) await triggersStore.fetchTriggers();
}
</script>

<template>
  <div class="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" @click.self="emit('close')">
    <div class="w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700" style="max-height: 90vh">
      <!-- HEADER -->
      <div class="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div class="flex items-center gap-2">
          <h2 class="text-xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
            <component :is="ICONS.Settings" :size="20" weight="Linear" class="text-brand-600" /> Platform Settings
          </h2>
          <HelpIcon slug="settings" :anchor="helpAnchor" title="Settings admin guide" />
        </div>
        <button type="button" class="text-gray-400 hover:text-red-500 transition-colors" @click="emit('close')">
          <component :is="ICONS.CloseCircle" :size="20" weight="Linear" />
        </button>
      </div>

      <!-- BODY: left-nav categories + single content pane -->
      <div class="flex flex-1 overflow-hidden">
        <div class="w-56 shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-y-auto p-3 space-y-1 bg-gray-50/60">
          <button
            v-for="tab in visibleTabs"
            :key="tab.id"
            type="button"
            class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-[13px] transition-colors"
            :class="activeTab === tab.id ? 'bg-brand-50 text-brand-600 font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium hover:bg-gray-100 dark:hover:bg-white/10'"
            @click="selectTab(tab.id)"
          >
            <component :is="tab.icon" :size="15" weight="Linear" class="shrink-0" />
            <span class="truncate">{{ tab.label }}</span>
          </button>
        </div>

        <div class="flex-1 min-w-0 overflow-y-auto p-8 bg-gray-50/30">
          <template v-if="activeTab === 'integrations'">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-bold text-gray-900 dark:text-white">Ticketing &amp; Chat</h3>
              <Button size="sm" @click="openNewIntegration">New integration</Button>
            </div>
            <Alert v-if="integrationsStore.error" type="danger">{{ integrationsStore.error }}</Alert>
            <IntegrationsTable :integrations="integrationsStore.integrations" :is-loading="integrationsStore.isLoading" @edit="editIntegration" @delete="deleteIntegration" />
          </template>

          <template v-else-if="activeTab === 'threat-intel'">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-bold text-gray-900 dark:text-white">Threat Intel</h3>
              <Button size="sm" @click="openNewProvider">New provider</Button>
            </div>
            <Alert v-if="threatIntelStore.error" type="danger">{{ threatIntelStore.error }}</Alert>
            <ThreatIntelProvidersTable :providers="threatIntelStore.providers" :is-loading="threatIntelStore.isLoading" @edit="editProvider" @delete="deleteProvider" />
          </template>

          <template v-else-if="activeTab === 'case-autorun'">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-bold text-gray-900 dark:text-white">Case Auto-Run Rules</h3>
              <Button size="sm" @click="openNewRule">New rule</Button>
            </div>
            <CaseAutoRunRulesTable :rules="casesStore.autoRunRules" :is-loading="false" @edit="editRule" @delete="deleteRule" />
          </template>

          <template v-else-if="activeTab === 'triggers'">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-bold text-gray-900 dark:text-white">Inbound Webhooks</h3>
              <Button size="sm" @click="openNewTrigger">New trigger</Button>
            </div>
            <p class="text-xs leading-relaxed mb-4 max-w-2xl text-gray-400">
              Lets an external system (EDR, firewall, SIEM, IDS — anything that can POST JSON to a URL) fire a specific Workflow directly, no Compliance Policy required. Each trigger gets its own self-contained URL — id and secret both live in the path, the same pattern Slack/Teams/PagerDuty use for their own incoming webhooks — so pasting it into any of those tools is enough.
            </p>
            <Alert v-if="triggersStore.error" type="danger">{{ triggersStore.error }}</Alert>
            <TriggersTable :triggers="triggersStore.triggers" :is-loading="triggersStore.isLoading" @edit="editTrigger" />
          </template>

          <template v-else>
            <h3 class="text-sm font-bold mb-4 text-gray-900 dark:text-white">{{ visibleTabs.find((t) => t.id === activeTab)?.label }}</h3>
            <GeneralSettingsForm v-if="activeTab === 'general'" />
            <SmtpSettingsForm v-else-if="activeTab === 'smtp'" />
            <AccountPanel v-else-if="activeTab === 'account'" />
            <BackupRestorePanel v-else-if="activeTab === 'backup'" />
            <AuditLogRetentionPanel v-else-if="activeTab === 'auditlog'" />
            <WorkspaceAutomationPanel v-else-if="activeTab === 'workspace-automation'" />
            <DeviceDataWebhookPanel v-else-if="activeTab === 'device-webhook'" />
            <LogExportDestinationsPanel v-else-if="activeTab === 'logexport'" />
            <AppliveryEventsPanel v-else-if="activeTab === 'applivery-events'" />
            <CaseSlaSettingsForm v-else-if="activeTab === 'case-sla'" />
            <SystemHealthPanel v-else-if="activeTab === 'systemhealth'" />
            <OsUpdateCatalogPanel v-else-if="activeTab === 'os-updates'" />
            <VulnerabilityCatalogPanel v-else-if="activeTab === 'vuln-catalog'" />
            <VulnerabilityServicePanel v-else-if="activeTab === 'vuln-service'" />
            <OsLifecyclePanel v-else-if="activeTab === 'os-lifecycle'" />
            <AppleAppUpdatesPanel v-else-if="activeTab === 'apple-app-updates'" />
            <RolesSettingsPanel v-else-if="activeTab === 'roles' && isSuperAdmin" />
          </template>
        </div>
      </div>

      <!-- FOOTER -->
      <div class="p-6 border-t border-gray-200 dark:border-gray-700 shrink-0 flex justify-end">
        <Button @click="emit('close')">Apply &amp; Save Configuration</Button>
      </div>
    </div>

    <IntegrationDialog :open="integrationDialogOpen" :integration="editingIntegration" @close="integrationDialogOpen = false" @saved="integrationsStore.fetchIntegrations()" />
    <ThreatIntelProviderDialog :open="providerDialogOpen" :provider="editingProvider" @close="providerDialogOpen = false" @saved="threatIntelStore.fetchProviders()" />
    <CaseAutoRunRuleDialog :open="ruleDialogOpen" :rule="editingRule" @close="ruleDialogOpen = false" @saved="casesStore.fetchAutoRunRules()" />
    <TriggerDialog :open="triggerDialogOpen" :trigger="editingTrigger" @close="triggerDialogOpen = false" @saved="triggersStore.fetchTriggers()" />
  </div>
</template>
