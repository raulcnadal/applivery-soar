<script setup lang="ts">
// Device detail drawer — faithful port of DeviceDetailDrawer.jsx (735
// lines): 3 tabs (Overview/Compliance/Location), segment/policy/tag
// editors via modal pickers, "Run workflow" from the header, and a
// "Sync fleet locations" action on the Location tab.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ICONS } from "../../lib/solarIcons";
import { useDevicesStore, type NormalizedDevice } from "../../stores/devices";
import type { Workflow } from "../../stores/workflows";
import { useWorkflowsStore } from "../../stores/workflows";
import { flattenSegments, type SegmentNode } from "../../lib/segments";
import DeviceMockup from "./DeviceMockup.vue";
import PolicyPickerModal from "./PolicyPickerModal.vue";
import SegmentPickerModal from "./SegmentPickerModal.vue";
import TagEditorModal from "./TagEditorModal.vue";
import WorkflowPickerModal from "./WorkflowPickerModal.vue";
import WorkflowRunResultModal from "./WorkflowRunResultModal.vue";

const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";

const RISK_TIER_META: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: SUCCESS },
  medium: { label: "Medium", color: WARNING },
  high: { label: "High", color: "#F97316" },
  critical: { label: "Critical", color: DANGER },
};
function riskMeta(tier: string) {
  return RISK_TIER_META[tier] || RISK_TIER_META.low;
}

const PLATFORM_PATH: Record<string, string> = { apple: "apple", macos: "apple", android: "android", windows: "windows" };

const props = defineProps<{ device: NormalizedDevice | null; segments: SegmentNode[] }>();
const emit = defineEmits<{ close: [] }>();

const store = useDevicesStore();
const workflowsStore = useWorkflowsStore();
const router = useRouter();

const tab = ref<"overview" | "compliance" | "location">("overview");
const activePicker = ref<null | "segment" | "policy" | "tags">(null);
const busy = ref(false);
const error = ref<string | null>(null);
const isSyncingLocation = ref(false);
const isPickingWorkflow = ref(false);
const runResult = ref<any>(null);
const firewallState = ref<{ active: any[] } | null>(null);

const platform = computed(() => (props.device ? PLATFORM_PATH[props.device.platform] : ""));

watch(
  () => props.device,
  (d) => {
    tab.value = "overview";
    activePicker.value = null;
    error.value = null;
    firewallState.value = null;
    if (d && d.platform === "windows") {
      store
        .getFirewallState(d.id)
        .then((res) => (firewallState.value = res || { active: [] }))
        .catch(() => (firewallState.value = { active: [] }));
    }
  },
  { immediate: true },
);

const segmentName = computed(() => {
  if (!props.device) return "Global";
  const flat = flattenSegments(props.segments);
  const match = flat.find((s) => String(s.id) === String(props.device!.segmentId));
  return match?.name || "Global";
});

async function runMutation(fn: () => Promise<void>) {
  busy.value = true;
  error.value = null;
  try {
    await fn();
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "That change failed. Please try again.";
  } finally {
    busy.value = false;
  }
}

function handleSegmentSelect(segment: SegmentNode) {
  activePicker.value = null;
  const d = props.device!;
  runMutation(() => store.updateSegment(d.platformDeviceId, platform.value, Number(segment.id)));
}

function handleAddPolicy(policy: { id: string; name: string }) {
  activePicker.value = null;
  const d = props.device!;
  const updated = [...(d.activePolicies || []), { id: policy.id, name: policy.name, platform: d.platform }];
  runMutation(() => store.updatePolicies(d.platformDeviceId, platform.value, updated.map((p) => ({ id: p.id, name: p.name }))));
}

function handleRemovePolicy(policyToRemove: { id: string | null }) {
  const d = props.device!;
  const updated = (d.activePolicies || []).filter((p) => p.id !== policyToRemove.id);
  runMutation(() => store.updatePolicies(d.platformDeviceId, platform.value, updated.map((p) => ({ id: p.id, name: p.name }))));
}

function handleSaveTags(tags: string[]) {
  activePicker.value = null;
  const d = props.device!;
  runMutation(() => store.updateTags(d.platformDeviceId, platform.value, tags));
}

function handleSyncLocation() {
  isSyncingLocation.value = true;
  error.value = null;
  store
    .syncLocations()
    .then(() => store.fetchDevices(true))
    .catch(() => (error.value = "Failed to sync device locations."))
    .finally(() => (isSyncingLocation.value = false));
}

async function handleRunWorkflow(workflow: Workflow) {
  isPickingWorkflow.value = false;
  const d = props.device!;
  try {
    const run = await workflowsStore.runWorkflow(workflow.id, [
      {
        id: d.id,
        displayName: d.displayName,
        platform: d.platform,
        platformDeviceId: d.platformDeviceId,
        serialNumber: d.serialNumber,
        osVersion: d.osVersion,
        manufacturer: d.manufacturer,
        model: d.model,
        udid: d.identifiers?.udid,
        mdmUser: d.mdmUser,
      },
    ]);
    runResult.value = run;
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Failed to run workflow.";
  }
}

function openDeviceAudit() {
  if (!props.device) return;
  router.push({ path: "/audit-logs", query: { deviceId: props.device.id, deviceName: props.device.displayName } });
}
function openCase(caseId: string) {
  router.push({ path: "/cases", query: { caseId } });
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}
</script>

<template>
  <template v-if="device">
    <div class="fixed inset-0 z-[260] bg-black/40" @click="emit('close')" />
    <div class="fixed inset-y-0 right-0 z-[260] w-full sm:w-[440px] shadow-2xl flex flex-col bg-white dark:bg-gray-800">
      <!-- Header -->
      <div class="shrink-0 px-5 pt-5 pb-4 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-3 min-w-0">
            <DeviceMockup :platform="device.platform" :size="44" />
            <div class="min-w-0">
              <p class="font-semibold truncate text-gray-900 dark:text-white">{{ device.displayName }}</p>
              <p class="text-xs truncate text-gray-400">{{ device.platformLabel }} · {{ device.manufacturer ? `${device.manufacturer} ${device.model}`.trim() : device.model || "—" }}</p>
            </div>
          </div>
          <button class="p-1.5 rounded-lg hover:opacity-70 transition-opacity shrink-0 text-gray-400" @click="emit('close')">
            <component :is="ICONS.CloseCircle" :size="18" weight="Linear" />
          </button>
        </div>
        <div class="flex items-center gap-2 mt-3 flex-wrap">
          <span
            :title="(device as any).complianceViolations?.length ? `Violates: ${(device as any).complianceViolations.map((v: any) => v.policyName || 'Unnamed policy').join(', ')}` : undefined"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            :style="{ backgroundColor: device.isCompliant ? `${SUCCESS}15` : `${DANGER}15`, color: device.isCompliant ? SUCCESS : DANGER }"
          >
            <component :is="device.isCompliant ? ICONS.ShieldCheck : ICONS.ShieldWarning" :size="12" weight="Linear" />
            {{ device.isCompliant ? "Compliant" : "Non-compliant" }}
          </span>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" :style="{ backgroundColor: `${riskMeta(device.riskTier).color}15`, color: riskMeta(device.riskTier).color }">
            {{ riskMeta(device.riskTier).label }} risk · {{ device.riskScore }}
          </span>
          <span v-if="(device.mdmUser as any)?.email" class="text-xs truncate text-gray-400">{{ (device.mdmUser as any).email }}</span>
          <button
            :disabled="workflowsStore.workflows.length === 0"
            class="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white disabled:opacity-40 shrink-0"
            :style="{ backgroundColor: PRIMARY_BLUE }"
            :title="workflowsStore.workflows.length === 0 ? 'Create a workflow first, from the Workflows tab' : 'Run a workflow on this device'"
            @click="isPickingWorkflow = true"
          >
            <component :is="ICONS.Play" :size="11" weight="Linear" /> Run workflow
          </button>
        </div>
      </div>

      <!-- Tabs -->
      <div class="shrink-0 flex px-5 border-b border-gray-200 dark:border-gray-700">
        <button
          v-for="t in [{ key: 'overview', label: 'Overview' }, { key: 'compliance', label: 'Compliance' }, { key: 'location', label: 'Location' }]"
          :key="t.key"
          class="relative px-3 pb-2.5 pt-3 text-sm font-medium transition-colors"
          :style="{ color: tab === t.key ? PRIMARY_BLUE : '#9CA3AF' }"
          @click="tab = t.key as any"
        >
          {{ t.label }}
          <span class="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-sm" :style="{ backgroundColor: tab === t.key ? PRIMARY_BLUE : 'transparent' }" />
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto px-5 py-4">
        <div v-if="error" class="mb-4 px-3 py-2 rounded-lg text-xs font-medium border" :style="{ backgroundColor: `${DANGER}12`, color: DANGER, borderColor: `${DANGER}30` }">
          {{ error }}
        </div>

        <template v-if="tab === 'overview'">
          <div class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Identifiers</p>
            <div v-for="row in [
              ['Serial number', device.serialNumber],
              ['IMEI', device.imei],
              ['UDID', device.identifiers?.udid],
              ['EMM device ID', device.identifiers?.emmDeviceId],
              ['Windows ID', device.identifiers?.winId],
            ]" :key="row[0] as string">
              <div v-if="row[1]" class="flex items-center justify-between py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
                <span class="text-gray-400">{{ row[0] }}</span>
                <span class="font-mono text-xs text-gray-900 dark:text-white">{{ row[1] }}</span>
              </div>
            </div>
          </div>

          <div class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Hardware &amp; OS</p>
            <div v-for="row in [
              ['Model', device.manufacturer ? `${device.manufacturer} ${device.model}`.trim() : device.model],
              ['OS version', device.osVersion],
              ['Battery', device.battery != null ? `${device.battery}%` : null],
              ['Storage', device.totalStorageGb ? `${device.availableStorageGb ? device.availableStorageGb.toFixed(1) + ' GB free of ' : ''}${device.totalStorageGb.toFixed(1)} GB` : null],
              ['RAM', device.ramGb ? `${device.ramGb.toFixed(1)} GB` : null],
              ['State', device.state],
              ['Last seen', device.lastSeen ? formatDate(device.lastSeen) : null],
            ]" :key="row[0] as string">
              <div v-if="row[1]" class="flex items-center justify-between py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
                <span class="text-gray-400">{{ row[0] }}</span>
                <span class="text-gray-900 dark:text-white">{{ row[1] }}</span>
              </div>
            </div>
          </div>

          <!-- OS Updates (Windows) -->
          <div v-if="device.osUpdateStatus" class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">OS Updates</p>
            <p v-if="(device.osUpdateStatus as any).confidence === 'unknown'" class="text-xs text-gray-400">
              No confirmed patch-level comparison available yet for this Windows build.
            </p>
            <div v-else-if="(device.osUpdateStatus as any).pendingCount > 0" class="space-y-1.5">
              <p class="text-xs font-medium" :style="{ color: WARNING }">
                {{ (device.osUpdateStatus as any).pendingCount }} security update{{ (device.osUpdateStatus as any).pendingCount === 1 ? "" : "s" }} behind (latest known build .{{ (device.osUpdateStatus as any).latestKnownUbr }})
              </p>
              <div v-for="kb in (device.osUpdateStatus as any).pendingKbs" :key="kb.kb" class="px-3 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900/50">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-gray-900 dark:text-white">KB{{ kb.kb }} <span class="text-gray-400">· {{ kb.updateType || "Security" }} update · {{ kb.releaseMonth }}</span></span>
                  <span class="font-semibold shrink-0" :style="{ color: kb.maxSeverity?.toLowerCase() === 'critical' ? DANGER : WARNING }">
                    {{ kb.maxSeverity || "Unknown" }}{{ kb.cveCount ? ` · ${kb.cveCount} CVE${kb.cveCount === 1 ? "" : "s"}` : "" }}
                  </span>
                </div>
              </div>
            </div>
            <p v-else class="text-xs" :style="{ color: SUCCESS }">Up to date with the latest known security update for this build.</p>
          </div>

          <!-- OS Lifecycle -->
          <div v-if="device.osLifecycleStatus && (device.osLifecycleStatus as any).confidence !== 'unknown' && (device.osLifecycleStatus as any).isEol !== null && (device.osLifecycleStatus as any).isEol !== undefined" class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">OS Lifecycle</p>
            <p v-if="(device.osLifecycleStatus as any).isEol" class="text-xs font-medium" :style="{ color: DANGER }">
              This OS version has reached end of life for security support{{ (device.osLifecycleStatus as any).eolFrom ? ` (since ${(device.osLifecycleStatus as any).eolFrom})` : "" }}.
              {{ (device.osLifecycleStatus as any).esuUntil ? ` Paid Extended Security Updates are available until ${(device.osLifecycleStatus as any).esuUntil}.` : "" }}
            </p>
            <p v-else class="text-xs" :style="{ color: SUCCESS }">
              This OS version is still within its security support window.
              {{
                (device.osLifecycleStatus as any).onLatestVersion === false && (device.osLifecycleStatus as any).latestKnownVersion
                  ? ` A newer version is available: ${(device.osLifecycleStatus as any).latestKnownVersion}.`
                  : ""
              }}
            </p>
            <div v-if="(device.osLifecycleStatus as any).rapidSecurityResponse?.available" class="mt-2 px-3 py-2 rounded-lg text-xs border" :style="{ backgroundColor: `${WARNING}10`, borderColor: `${WARNING}30` }">
              <p class="font-semibold" :style="{ color: WARNING }">Rapid Security Response available</p>
            </div>
          </div>

          <!-- Vulnerabilities -->
          <div v-if="device.vulnStatus" class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Vulnerabilities</p>
            <p v-if="(device.vulnStatus as any).confidence === 'unknown'" class="text-xs text-gray-400">
              No confirmed vulnerability comparison available yet for this OS version.
            </p>
            <div v-else-if="(device.vulnStatus as any).pendingCount > 0" class="space-y-1.5">
              <p class="text-xs font-medium" :style="{ color: WARNING }">{{ (device.vulnStatus as any).pendingCount }} known CVE{{ (device.vulnStatus as any).pendingCount === 1 ? "" : "s" }} fixed in a newer version</p>
              <div v-for="c in (device.vulnStatus as any).pendingCves" :key="c.cveId" class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900/50">
                <span class="text-gray-900 dark:text-white">{{ c.cveId }} <span class="text-gray-400">· fixed in {{ c.fixedVersion || c.fixedInMajor }}</span></span>
                <span class="font-semibold shrink-0" :style="{ color: c.exploited || c.baseSeverity === 'Critical' ? DANGER : WARNING }">
                  {{ c.baseSeverity || "Unknown" }}{{ c.exploited ? " · exploited" : "" }}
                </span>
              </div>
            </div>
            <p v-else class="text-xs" :style="{ color: SUCCESS }">No known pending CVEs against this device's OS version.</p>
          </div>

          <!-- Vulnerability Service -->
          <div v-if="device.vulnServiceStatus" class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Vulnerability Service</p>
            <template v-if="!(device.vulnServiceStatus as any).checked">
              <p class="text-xs text-gray-400">
                {{
                  (device.vulnServiceStatus as any).lastCheckedAt
                    ? `Last checked ${new Date((device.vulnServiceStatus as any).lastCheckedAt).toLocaleString()} — nothing conclusive was found then.`
                    : "Not checked yet — waiting on the next scheduled refresh."
                }}
              </p>
            </template>
            <template v-else>
              <p
                v-if="((device.vulnServiceStatus as any).counts?.CRITICAL || 0) + ((device.vulnServiceStatus as any).counts?.HIGH || 0) + ((device.vulnServiceStatus as any).counts?.MEDIUM || 0) + ((device.vulnServiceStatus as any).counts?.LOW || 0) > 0"
                class="text-xs font-medium"
                :style="{ color: (device.vulnServiceStatus as any).hasKev ? DANGER : WARNING }"
              >
                Known CVEs across the OS and {{ (device.vulnServiceStatus as any).appsCheckedCount }} checked app(s){{ (device.vulnServiceStatus as any).hasKev ? " — includes a known-exploited (CISA KEV) CVE" : "" }}
              </p>
              <p v-else class="text-xs" :style="{ color: SUCCESS }">No known CVEs against this device's OS or checked apps.</p>
            </template>
            <p class="text-[10px] mt-2 text-gray-400">From your org's Vulnerability Service integration.</p>
          </div>

          <!-- Firewall Rule Sets (Windows only) -->
          <div v-if="device.platform === 'windows' && firewallState" class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Firewall Rule Sets</p>
            <p v-if="firewallState.active.length === 0" class="text-xs text-gray-400">No Applivery SOAR-managed firewall rule sets currently active on this device.</p>
            <div v-else class="space-y-1.5">
              <div v-for="a in firewallState.active" :key="a.ruleSetId" class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900/50">
                <span class="inline-flex items-center gap-1.5 text-gray-900 dark:text-white">
                  <component :is="ICONS.ShieldCheck" :size="12" weight="Linear" :style="{ color: WARNING }" />
                  {{ a.ruleSetName || a.ruleSetId }}
                </span>
                <span class="shrink-0 text-gray-400">Applied {{ a.appliedAt ? formatDate(a.appliedAt) : "—" }}</span>
              </div>
            </div>
          </div>

          <!-- App Updates -->
          <div v-if="device.appleAppUpdateStatus" class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">App Updates</p>
            <div v-if="(device.appleAppUpdateStatus as any).pendingCount > 0" class="space-y-1.5">
              <p class="text-xs font-medium" :style="{ color: WARNING }">
                {{ (device.appleAppUpdateStatus as any).pendingCount }} of {{ (device.appleAppUpdateStatus as any).totalApps }} app(s) have an update available
              </p>
            </div>
            <p v-else class="text-xs" :style="{ color: SUCCESS }">All {{ (device.appleAppUpdateStatus as any).totalApps }} tracked app(s) up to date.</p>
          </div>

          <div v-if="(device.smartAttributes || []).length > 0" class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Smart Attributes</p>
            <div v-for="a in device.smartAttributes" :key="a.name" class="flex items-center justify-between py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
              <span class="text-gray-400">{{ a.name }}</span>
              <span class="text-gray-900 dark:text-white">{{ a.value }}</span>
            </div>
          </div>

          <div class="mb-6">
            <div class="flex items-center justify-between mb-2">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Segment</p>
              <button :disabled="busy" class="text-xs font-medium disabled:opacity-50" :style="{ color: PRIMARY_BLUE }" @click="activePicker = 'segment'">Change</button>
            </div>
            <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
              <component :is="ICONS.Layers" :size="14" weight="Linear" class="text-gray-400" />
              <span class="text-sm text-gray-900 dark:text-white">{{ segmentName }}</span>
            </div>
          </div>

          <div class="mb-6">
            <div class="flex items-center justify-between mb-2">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Active Policies</p>
              <button :disabled="busy" class="inline-flex items-center gap-1 text-xs font-medium disabled:opacity-50" :style="{ color: PRIMARY_BLUE }" @click="activePicker = 'policy'">
                <component :is="ICONS.AddSquare" :size="12" weight="Linear" /> Add
              </button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="p in device.activePolicies || []" :key="p.id || p.name" class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
                {{ p.name }}
                <button :disabled="busy" class="hover:opacity-60" @click="handleRemovePolicy(p)">
                  <component :is="ICONS.CloseCircle" :size="11" weight="Linear" />
                </button>
              </span>
              <span v-if="(device.activePolicies || []).length === 0" class="text-xs text-gray-400">No policies assigned</span>
            </div>
          </div>

          <div class="mb-6">
            <div class="flex items-center justify-between mb-2">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Tags</p>
              <button :disabled="busy" class="inline-flex items-center gap-1 text-xs font-medium disabled:opacity-50" :style="{ color: PRIMARY_BLUE }" @click="activePicker = 'tags'">
                <component :is="ICONS.Pen" :size="11" weight="Linear" /> Edit
              </button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="t in device.tags || []" :key="t" class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">{{ t }}</span>
              <span v-if="(device.tags || []).length === 0" class="text-xs text-gray-400">No tags</span>
            </div>
          </div>
        </template>

        <template v-else-if="tab === 'compliance'">
          <div class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Compliance Status</p>
            <div class="flex items-center gap-2 mb-3">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" :style="{ backgroundColor: device.isCompliant ? `${SUCCESS}15` : `${DANGER}15`, color: device.isCompliant ? SUCCESS : DANGER }">
                <component :is="device.isCompliant ? ICONS.ShieldCheck : ICONS.ShieldWarning" :size="12" weight="Linear" />
                {{ device.isCompliant ? "Compliant" : "Non-compliant" }}
              </span>
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" :style="{ backgroundColor: `${riskMeta(device.riskTier).color}15`, color: riskMeta(device.riskTier).color }">
                {{ riskMeta(device.riskTier).label }} risk · {{ device.riskScore }}
              </span>
            </div>
            <div v-if="typeof device.riskScore === 'number'">
              <div class="h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
                <div class="h-full rounded-full transition-all" :style="{ width: `${Math.min(Math.max(device.riskScore, 0), 100)}%`, backgroundColor: riskMeta(device.riskTier).color }" />
              </div>
              <p class="text-[10px] mt-1 text-gray-400">Risk score {{ device.riskScore }}/100 — higher means more attention needed.</p>
            </div>
          </div>

          <div v-if="(device.riskFactors || []).length > 0" class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Risk Factors</p>
            <div class="space-y-1.5">
              <div v-for="(f, i) in device.riskFactors" :key="i" class="flex items-center justify-between py-1 text-sm">
                <span class="text-gray-900 dark:text-white">{{ f.label }}</span>
                <span class="text-xs font-semibold" :style="{ color: riskMeta(device.riskTier).color }">+{{ f.points }}</span>
              </div>
            </div>
          </div>

          <div class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">
              Compliance Policy Violations{{ (device.policyViolations || []).length ? ` (${device.policyViolations.length})` : "" }}
            </p>
            <div v-if="(device.policyViolations || []).length > 0" class="space-y-1.5">
              <div v-for="(v, i) in device.policyViolations" :key="v.policyId || i" class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-gray-900/50">
                <span class="truncate text-gray-900 dark:text-white">{{ v.policyName || "Unknown policy" }}</span>
                <span class="text-[10px] font-semibold shrink-0 uppercase" :style="{ color: v.status === 'pending' ? WARNING : v.status === 'auto_fired' ? PRIMARY_BLUE : '#9CA3AF' }">
                  {{ String(v.status || "").replace("_", " ") || "—" }}
                </span>
              </div>
            </div>
            <p v-else class="text-xs" :style="{ color: SUCCESS }">No open Compliance Policy violations for this device.</p>
          </div>

          <div v-if="(device.activeViolations || []).length > 0" class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Awaiting Review ({{ device.activeViolations.length }})</p>
            <div class="space-y-1.5">
              <button v-for="v in device.activeViolations" :key="v.id" title="View this device's history in the Audit Log" class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm bg-gray-50 dark:bg-gray-900/50" @click="openDeviceAudit">
                <span class="truncate text-gray-900 dark:text-white">{{ v.policyName || "Unknown policy" }}</span>
                <span class="text-[10px] font-semibold shrink-0" :style="{ color: DANGER }">Awaiting review →</span>
              </button>
            </div>
          </div>

          <div v-if="(device.openCases || []).length > 0" class="mb-6">
            <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Open Cases ({{ device.openCases.length }})</p>
            <div class="space-y-1.5">
              <button v-for="c in device.openCases" :key="c.id" title="Open this case" class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm bg-gray-50 dark:bg-gray-900/50" @click="openCase(c.id)">
                <span class="truncate text-gray-900 dark:text-white">{{ c.title }}</span>
                <span class="text-[10px] font-semibold shrink-0" :style="{ color: PRIMARY_BLUE }">{{ c.severity }} →</span>
              </button>
            </div>
          </div>
        </template>

        <template v-else-if="tab === 'location'">
          <template v-if="device.location">
            <div class="mb-4">
              <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Last known location</p>
              <div class="flex items-center justify-between py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
                <span class="text-gray-400">Latitude</span>
                <span class="font-mono text-xs text-gray-900 dark:text-white">{{ device.location.lat?.toFixed(6) }}</span>
              </div>
              <div class="flex items-center justify-between py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
                <span class="text-gray-400">Longitude</span>
                <span class="font-mono text-xs text-gray-900 dark:text-white">{{ device.location.lng?.toFixed(6) }}</span>
              </div>
            </div>
            <a
              :href="`https://www.google.com/maps/search/?api=1&query=${device.location.lat},${device.location.lng}`"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-sm font-medium mb-4"
              :style="{ color: PRIMARY_BLUE }"
            >
              <component :is="ICONS.MapPoint" :size="14" weight="Linear" /> Open in Google Maps <component :is="ICONS.ArrowRightUp" :size="12" weight="Linear" />
            </a>
          </template>
          <div v-else class="flex flex-col items-center justify-center py-10 text-center">
            <component :is="ICONS.MapPoint" :size="24" weight="Linear" class="mb-3 text-gray-400" />
            <p class="text-sm font-medium mb-1 text-gray-900 dark:text-white">No location on file</p>
            <p class="text-xs max-w-xs text-gray-400">Sync locations to fetch the latest known position for this fleet.</p>
          </div>
          <button
            :disabled="isSyncingLocation"
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 transition-all duration-200 hover:bg-brand-700 disabled:opacity-50"
            @click="handleSyncLocation"
          >
            <component :is="ICONS.Refresh" :size="14" weight="Linear" :class="isSyncingLocation ? 'animate-spin' : ''" />
            {{ isSyncingLocation ? "Syncing fleet locations…" : "Sync fleet locations" }}
          </button>
          <p class="text-[11px] mt-2 text-gray-400">This refreshes GPS data for the whole fleet (one Applivery API call per device), not just this one — it can take a moment.</p>
        </template>
      </div>
    </div>

    <SegmentPickerModal v-if="activePicker === 'segment'" :open="true" :segments="segments" :current-segment-id="device.segmentId" @close="activePicker = null" @select="handleSegmentSelect" />
    <PolicyPickerModal v-if="activePicker === 'policy'" :open="true" :platform="platform" :exclude-ids="(device.activePolicies || []).map((p) => p.id)" @close="activePicker = null" @select="handleAddPolicy" />
    <TagEditorModal v-if="activePicker === 'tags'" :open="true" :initial-tags="device.tags || []" @close="activePicker = null" @save="handleSaveTags" />

    <WorkflowPickerModal :open="isPickingWorkflow" @close="isPickingWorkflow = false" @confirm="handleRunWorkflow" />
    <WorkflowRunResultModal :open="!!runResult" :run="runResult" @close="runResult = null" @complete="() => store.fetchDevices(true)" />
  </template>
</template>
