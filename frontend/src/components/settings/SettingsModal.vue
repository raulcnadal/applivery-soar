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
import { computed, ref } from "vue";
import { Drawer } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useBreakpoint } from "../../composables/useBreakpoint";
import HelpIcon from "../shared/HelpIcon.vue";
import GeneralSettingsForm from "./GeneralSettingsForm.vue";
import SmtpSettingsForm from "./SmtpSettingsForm.vue";
import AccountPanel from "./AccountPanel.vue";
import BackupRestorePanel from "./BackupRestorePanel.vue";
import AuditLogRetentionPanel from "./AuditLogRetentionPanel.vue";
import WorkspaceAutomationPanel from "./WorkspaceAutomationPanel.vue";
import PlayIntegrityPanel from "./PlayIntegrityPanel.vue";
import DeviceDataWebhookPanel from "./DeviceDataWebhookPanel.vue";
import CustomDeviceChecksPanel from "./CustomDeviceChecksPanel.vue";
import EventWatchesPanel from "./EventWatchesPanel.vue";
import MtlsPanel from "./MtlsPanel.vue";
import LogExportDestinationsPanel from "./LogExportDestinationsPanel.vue";
import TriggersPanel from "./TriggersPanel.vue";
import CaseAutoRunRulesPanel from "./CaseAutoRunRulesPanel.vue";
import AppliveryEventsPanel from "./AppliveryEventsPanel.vue";
import CaseSlaSettingsForm from "./CaseSlaSettingsForm.vue";
import SystemHealthPanel from "./SystemHealthPanel.vue";
import OsUpdateCatalogPanel from "./OsUpdateCatalogPanel.vue";
import VulnerabilityCatalogPanel from "./VulnerabilityCatalogPanel.vue";
import VulnerabilityServicePanel from "./VulnerabilityServicePanel.vue";
import MispPanel from "./MispPanel.vue";
import VulncheckPanel from "./VulncheckPanel.vue";
import BinaryIntegrityPanel from "./BinaryIntegrityPanel.vue";
import OsvAndroidPanel from "./OsvAndroidPanel.vue";
import SofaPanel from "./SofaPanel.vue";
import OsLifecyclePanel from "./OsLifecyclePanel.vue";
import AppleAppUpdatesPanel from "./AppleAppUpdatesPanel.vue";
import IntegrationsPanel from "./IntegrationsPanel.vue";
import ThreatIntelPanel from "./ThreatIntelPanel.vue";
import RolesSettingsPanel from "./RolesSettingsPanel.vue";
import { useAuthStore } from "../../stores/auth";

const emit = defineEmits<{ close: [] }>();

const auth = useAuthStore();
const { isMobile } = useBreakpoint();
const mobileNavOpen = ref(false);

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
  { id: "play-integrity", label: "Google Play Integrity API", icon: ICONS.ShieldCheck },
  { id: "device-webhook", label: "Applivery SOAR Agent", icon: ICONS.PlugCircle },
  { id: "custom-checks", label: "Custom Device Checks", icon: ICONS.Checklist },
  { id: "event-watches", label: "Event-Driven Detection", icon: ICONS.Radar },
  { id: "mtls", label: "mTLS Authentication", icon: ICONS.Lock },
  { id: "logexport", label: "Log Export", icon: ICONS.Database },
  { id: "triggers", label: "Inbound Webhooks", icon: ICONS.Bolt },
  { id: "case-autorun", label: "Case Auto-Run Rules", icon: ICONS.Target },
  { id: "applivery-events", label: "Applivery Events", icon: ICONS.Satellite },
  { id: "case-sla", label: "Case SLA", icon: ICONS.ClockCircle },
  { id: "systemhealth", label: "System Health", icon: ICONS.Pulse2 },
  { id: "os-updates", label: "OS Updates", icon: ICONS.Cpu },
  { id: "vuln-catalog", label: "Vulnerability Catalog", icon: ICONS.Bug },
  { id: "vuln-service", label: "Vulnerability Service", icon: ICONS.ShieldWarning },
  { id: "misp", label: "MISP", icon: ICONS.Radar },
  { id: "vulncheck", label: "VulnCheck", icon: ICONS.ShieldWarning },
  { id: "binary-integrity", label: "Binary Integrity", icon: ICONS.ShieldCheck },
  { id: "osv-android", label: "Android Security Bulletin", icon: ICONS.Smartphone },
  { id: "sofa", label: "Apple Security Releases", icon: ICONS.DangerTriangle },
  { id: "os-lifecycle", label: "OS Lifecycle", icon: ICONS.Hourglass },
  { id: "apple-app-updates", label: "App Updates (Apple)", icon: ICONS.Delivery },
  { id: "integrations", label: "Ticketing & Chat", icon: ICONS.ChatRound },
  { id: "threat-intel", label: "Threat Intel", icon: ICONS.Radar },
  { id: "roles", label: "Roles", icon: ICONS.ShieldCheck, superAdminOnly: true },
];
const visibleTabs = computed(() => SETTINGS_TABS.filter((t) => !t.superAdminOnly || isSuperAdmin.value));

// The content-pane heading is its own hardcoded string per tab in the
// original (App.jsx:5838+), distinct from (and sometimes more descriptive
// than) the left-nav label above — e.g. nav "General" but content heading
// "General Configuration". Only listing the tabs where the two differ;
// everywhere else the nav label doubles as the content heading verbatim.
const CONTENT_HEADING: Record<string, string> = {
  general: "General Configuration",
  smtp: "SMTP Email Engine",
  auditlog: "Audit Log Retention",
  logexport: "Log Export Destinations",
};
// "backup" and "device-webhook" render more than one heading+card (Backup &
// Restore + Full Workspace Configuration; Applivery SOAR Agent + Device
// Report Secret + What This Agent Reports + Download Managed Configuration)
// — their panel components own every heading themselves, so the generic branch below
// must not also prepend one or it'd duplicate the first heading. The other
// four (integrations/threat-intel/case-autorun/triggers) are the sub-panels
// converted from Modal-based dialogs to the original's inline-form-above-
// card-list pattern (docs/settings.md) — each is now a single self-contained
// component that renders its own heading + intro paragraph + "New X" button,
// same reasoning as backup/device-webhook above.
const SELF_HEADED_TABS = new Set(["backup", "device-webhook", "custom-checks", "integrations", "threat-intel", "case-autorun", "triggers", "mtls"]);

const activeTab = ref("general");
// Port of SETTINGS_TAB_ANCHORS (App.jsx:288-309) — maps this modal's tab
// ids onto docs/settings.md's anchor slugs.
const SETTINGS_TAB_ANCHORS: Record<string, string> = {
  general: "general", smtp: "smtp", account: "account", backup: "backup--restore",
  auditlog: "audit-log", "workspace-automation": "workspace-automation",
  "device-webhook": "device-data-webhook", mtls: "mtls-agent-authentication", logexport: "log-export",
  triggers: "inbound-webhooks",
  "case-autorun": "case-auto-run-rules", "applivery-events": "applivery-events",
  "case-sla": "case-sla", systemhealth: "system-health",
  "os-updates": "os-updates", "vuln-catalog": "vulnerability-catalog",
  "vuln-service": "vulnerability-service", "os-lifecycle": "os-lifecycle",
  "apple-app-updates": "apple-app-updates",
  integrations: "integrations", "threat-intel": "threat-intel", roles: "roles",
};
const helpAnchor = computed(() => SETTINGS_TAB_ANCHORS[activeTab.value] ?? null);

// Integrations/Threat Intel/Case Auto-Run Rules/Triggers each now own their
// data-fetching, editing state, and CRUD wiring internally (see the
// "Deliberately NOT a Modal" comment atop each panel component) — this
// modal no longer needs to hold open/editing refs or prefetch-on-tab-select
// logic for them; each panel fetches its own data in its own onMounted,
// same as every other generic tab below.
function selectTab(tabId: string) {
  activeTab.value = tabId;
  mobileNavOpen.value = false;
}

const activeTabMeta = computed(() => visibleTabs.value.find((t) => t.id === activeTab.value));
</script>

<template>
  <div class="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" @click.self="emit('close')">
    <div class="w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700" style="max-height: 90vh">
      <!-- HEADER -->
      <div class="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div class="flex items-center gap-2">
          <h2 class="text-xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
            <component :is="ICONS.Settings" :size="20" weight="Linear" style="color: #0055ff" /> Platform Settings
          </h2>
          <HelpIcon slug="settings" :anchor="helpAnchor" title="Settings admin guide" />
        </div>
        <button type="button" class="text-gray-400 hover:text-red-500 transition-colors" @click="emit('close')">
          <component :is="ICONS.CloseCircle" :size="20" weight="Linear" />
        </button>
      </div>

      <!-- BODY: left-nav categories + single content pane. Both panel
           backgrounds are a translucent darkening overlay on top of the
           modal shell (bg-white dark:bg-gray-800 above) — matches the
           original's rgba(0,0,0,alpha) overlay pattern (App.jsx's Settings
           modal, ~5817/5836: rgba(0,0,0,0.03) light / rgba(0,0,0,0.25)
           dark), which was previously ported as a light-only Tailwind
           bg-gray-50/NN with no dark: variant — in dark mode that stayed a
           light gray sitting on the dark card, with the already-correct
           dark:text-gray-400 nav-item text rendering unreadable gray-on-
           light-gray. -->
      <div class="flex flex-1 min-h-0 overflow-hidden" :class="isMobile ? 'flex-col' : ''">
        <div v-if="!isMobile" class="w-56 shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-y-auto p-3 space-y-1 bg-gray-50/60 dark:bg-black/20">
          <button
            v-for="tab in visibleTabs"
            :key="tab.id"
            type="button"
            class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-[13px] transition-colors"
            :class="activeTab === tab.id ? 'font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium hover:bg-gray-100 dark:hover:bg-white/10'"
            :style="activeTab === tab.id ? { backgroundColor: '#0055FF18', color: '#0055FF' } : {}"
            @click="selectTab(tab.id)"
          >
            <component :is="tab.icon" :size="15" weight="Linear" class="shrink-0" />
            <span class="truncate">{{ tab.label }}</span>
          </button>
        </div>

        <!-- Mobile (<768px): no room for the 224px nav rail alongside real
             content — a compact bar shows the current section and opens a
             slide-in Drawer listing all sections instead, same pattern as
             AppShell's mobile menu. -->
        <div v-else class="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-black/20">
          <div class="flex items-center gap-2 min-w-0">
            <component :is="activeTabMeta?.icon" :size="15" weight="Linear" class="shrink-0" style="color: #0055ff" />
            <span class="text-[13px] font-semibold truncate text-gray-900 dark:text-white">{{ activeTabMeta?.label }}</span>
          </div>
          <button
            type="button"
            class="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
            @click="mobileNavOpen = true"
          >
            <component :is="ICONS.List" :size="14" weight="Linear" /> Sections
          </button>
        </div>

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto p-4 md:p-8 bg-gray-50/30 dark:bg-black/10">
          <h3 v-if="!SELF_HEADED_TABS.has(activeTab)" class="text-sm font-bold mb-4 text-gray-900 dark:text-white">
            {{ CONTENT_HEADING[activeTab] ?? visibleTabs.find((t) => t.id === activeTab)?.label }}
          </h3>
          <GeneralSettingsForm v-if="activeTab === 'general'" />
          <SmtpSettingsForm v-else-if="activeTab === 'smtp'" />
          <AccountPanel v-else-if="activeTab === 'account'" />
          <BackupRestorePanel v-else-if="activeTab === 'backup'" />
          <AuditLogRetentionPanel v-else-if="activeTab === 'auditlog'" />
          <WorkspaceAutomationPanel v-else-if="activeTab === 'workspace-automation'" />
          <PlayIntegrityPanel v-else-if="activeTab === 'play-integrity'" />
          <DeviceDataWebhookPanel v-else-if="activeTab === 'device-webhook'" @go-to-tab="selectTab" />
          <CustomDeviceChecksPanel v-else-if="activeTab === 'custom-checks'" />
          <EventWatchesPanel v-else-if="activeTab === 'event-watches'" />
          <MtlsPanel v-else-if="activeTab === 'mtls'" @go-to-tab="selectTab" />
          <LogExportDestinationsPanel v-else-if="activeTab === 'logexport'" />
          <TriggersPanel v-else-if="activeTab === 'triggers'" />
          <CaseAutoRunRulesPanel v-else-if="activeTab === 'case-autorun'" />
          <AppliveryEventsPanel v-else-if="activeTab === 'applivery-events'" />
          <CaseSlaSettingsForm v-else-if="activeTab === 'case-sla'" />
          <SystemHealthPanel v-else-if="activeTab === 'systemhealth'" />
          <OsUpdateCatalogPanel v-else-if="activeTab === 'os-updates'" />
          <VulnerabilityCatalogPanel v-else-if="activeTab === 'vuln-catalog'" />
          <VulnerabilityServicePanel v-else-if="activeTab === 'vuln-service'" />
          <MispPanel v-else-if="activeTab === 'misp'" />
          <VulncheckPanel v-else-if="activeTab === 'vulncheck'" />
          <BinaryIntegrityPanel v-else-if="activeTab === 'binary-integrity'" />
          <OsvAndroidPanel v-else-if="activeTab === 'osv-android'" />
          <SofaPanel v-else-if="activeTab === 'sofa'" />
          <OsLifecyclePanel v-else-if="activeTab === 'os-lifecycle'" />
          <AppleAppUpdatesPanel v-else-if="activeTab === 'apple-app-updates'" />
          <IntegrationsPanel v-else-if="activeTab === 'integrations'" />
          <ThreatIntelPanel v-else-if="activeTab === 'threat-intel'" />
          <RolesSettingsPanel v-else-if="activeTab === 'roles' && isSuperAdmin" />
        </div>
      </div>

      <!-- FOOTER -->
      <div class="p-6 border-t border-gray-200 dark:border-gray-700 shrink-0 flex justify-end">
        <button type="button" class="px-8 py-3 rounded-xl font-bold text-sm text-white shadow-lg transition-colors hover:opacity-90" style="background-color: #0055ff" @click="emit('close')">
          Apply &amp; Save Configuration
        </button>
      </div>
    </div>

    <Drawer v-if="isMobile" :open="mobileNavOpen" side="left" width="w-72 max-w-[85vw]" title="Settings sections" @close="mobileNavOpen = false">
      <div class="-m-6 py-2">
        <button
          v-for="tab in visibleTabs"
          :key="tab.id"
          type="button"
          class="w-full flex items-center gap-3 px-6 py-3 text-left text-[14px] transition-colors"
          :class="activeTab === tab.id ? 'font-semibold' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5'"
          :style="activeTab === tab.id ? { backgroundColor: '#0055FF18', color: '#0055FF' } : {}"
          @click="selectTab(tab.id)"
        >
          <component :is="tab.icon" :size="16" weight="Linear" class="shrink-0" />
          <span class="truncate">{{ tab.label }}</span>
        </button>
      </div>
    </Drawer>
  </div>
</template>
