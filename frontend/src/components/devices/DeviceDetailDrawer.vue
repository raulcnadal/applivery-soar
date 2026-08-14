<script setup lang="ts">
// Device detail modal — merged component reached from BOTH the Devices
// view's fleet table AND the Playground globe/map pins + Dashboard widget
// chart-click drill-ins. Originally two separate components with different
// content and different device-object shapes: this file (full
// NormalizedDevice, straight from the Devices view's own /api/devices
// fetch) and playground/DeviceInsightModal.vue (a lighter raw Applivery
// item from the Playground/widget-data device feed — see
// lib/widgetVisuals.ts's insightKind — which fetched its own compliance/
// locations/network-status/agent-logs/assets separately). Merged into one
// component so every entry point shows identical content, per user
// request: "the device modal... should aim to [open] the same Device
// modal... use the style of the Device modal that opens from Devices view,
// but adding the missing details and tabs that the other Device modal type
// has."
//
// Base style/tabs are this file's own (Overview/Compliance/Location); the
// Agent tab, the richer per-device Location History block, and the Network
// Status section are ported over from DeviceInsightModal.vue. That source
// also had an Assets tab (segment-level file assets) — dropped per user
// request, this modal covers device state, not segment file assets.
// Whichever "lighter" shape a caller hands in gets resolved into the same
// full NormalizedDevice the Devices view already had, via
// GET /api/devices/{id}/compliance — widened server-side to return the
// whole record rather than a risk/compliance-only subset (see
// devices.service.ts's getDeviceCompliance doc comment) — so mutations
// (segment/policy/tag edits, "Run workflow") work identically regardless
// of entry point.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ICONS } from "../../lib/solarIcons";
import { useDevicesStore, type NormalizedDevice } from "../../stores/devices";
import { useComplianceStore } from "../../stores/compliance";
import type { Workflow } from "../../stores/workflows";
import { useWorkflowsStore } from "../../stores/workflows";
import { flattenSegments } from "../../lib/segments";
import { msrcUrl, vulnLink } from "../../utils/vulnLinks";
import HelpIcon from "../shared/HelpIcon.vue";
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

// Apps tab — entry.source values as written by installedApps.service.ts
// (fetchAndStoreInstalledApps = "server_fetch", reportDeviceApps/
// deviceData.service.ts = "self_reported"), same labels ReportedAppsPanel.vue
// uses. SEVERITY_COLOR mirrors AppDetailModal.vue's own per-CVE severity map.
const APP_SOURCE_LABELS: Record<string, string> = { self_reported: "Self-reported", server_fetch: "Applivery UEM" };
const SEVERITY_COLOR: Record<string, string> = { CRITICAL: "#EF4444", HIGH: "#F97316", MEDIUM: "#F59E0B", LOW: "#3B82F6" };
// Apps tab search — a device with a large AppX/Store inventory (see the
// Windows dual-source round: 142 apps isn't unusual once Store/system
// packages are included) is otherwise a long unfiltered scroll to find one
// app. Client-side only (device.installedAppsDetail is already fully
// loaded), same "name or identifier, case-insensitive" match as the Apps
// main-nav view's own ReportedAppsPanel.vue search.
const appsSearchQuery = ref("");
const filteredInstalledApps = computed(() => {
  const all = device.value?.installedAppsDetail || [];
  const q = appsSearchQuery.value.trim().toLowerCase();
  if (!q) return all;
  return all.filter((a: Record<string, any>) => (a.name || "").toLowerCase().includes(q) || (a.identifier || "").toLowerCase().includes(q));
});

const PLATFORM_PATH: Record<string, string> = { apple: "apple", macos: "apple", android: "android", windows: "windows" };

// Loosely typed — accepts either a full NormalizedDevice (Devices view,
// already has everything) or a lighter raw Applivery-shaped item
// (Playground pin click / Dashboard widget chart-click drill-in), resolved
// below into a full device either way.
const props = defineProps<{ device: Record<string, any> | null }>();
const emit = defineEmits<{ close: [] }>();

const store = useDevicesStore();
const complianceStore = useComplianceStore();
const workflowsStore = useWorkflowsStore();
const router = useRouter();

const tab = ref<"overview" | "compliance" | "apps" | "location" | "agent">("overview");
const activePicker = ref<null | "segment" | "policy" | "tags">(null);
const busy = ref(false);
const error = ref<string | null>(null);
const isSyncingLocation = ref(false);
const isPickingWorkflow = ref(false);
const runResult = ref<any>(null);
const firewallState = ref<{ active: any[] } | null>(null);

// ── Device resolution — the core of the merge. A Devices-view caller
// already hands us a full NormalizedDevice (recognizable by
// `platformDeviceId`, a field only that shape carries); anything else is
// the lighter shape and gets resolved via a fetch. Keeping this as its own
// ref, rather than reading straight off props.device everywhere the way
// this component previously did, is what lets the rest of it stay almost
// entirely unaware of which entry point it was opened from. ──
const resolvedDevice = ref<NormalizedDevice | null>(null);
const isResolvingDevice = ref(false);
const device = computed(() => resolvedDevice.value);

function rawDeviceId(d: Record<string, any>): string {
  return String(d.id ?? d._id ?? "");
}

const platform = computed(() => (device.value ? PLATFORM_PATH[device.value.platform] : ""));

// ── Extras (locations/network-status) — ported over from
// playground/DeviceInsightModal.vue's own loadExtras(), proxied through
// this app's own backend the same way (devices.service.ts). Fetched for
// every entry point now, not just Playground — the Devices view's drawer
// never had these tabs before. No Assets tab/fetch (removed per user
// request — this modal covers device state, not segment-level file
// assets).
//
// Agent Logs/Trace used to auto-load here too on every open — moved to an
// on-demand model per user request ("fetching this in a recurrent manner
// would be an intensive task... not really related to Compliance, but to
// Troubleshooting"): loadExtras now only reads back whatever was already
// stored from the LAST on-demand fetch (GET /agent-diagnostics, a plain DB
// read — see devices.service.ts's getStoredAgentDiagnostics), and
// fetchAgentDiagnostics below is the actual live Applivery call, wired to
// the Agent tab's own "Fetch Agent Logs & Traces" button.
const loadingExtras = ref(true);
const locations = ref<any[]>([]);
const network = ref<any | null>(null);
const showLocationHistory = ref(false);

interface AgentDiagnosticsSide {
  items: any[];
  fetchedAt: string;
}
const agentLogs = ref<AgentDiagnosticsSide | null>(null);
const agentTrace = ref<AgentDiagnosticsSide | null>(null);
const isFetchingAgentDiagnostics = ref(false);
const agentDiagnosticsError = ref<string | null>(null);

async function loadExtras(id: string, plat: string) {
  loadingExtras.value = true;
  const { api } = await import("../../api/http");
  const [locRes, netRes, diagRes] = await Promise.all([
    api.get(`/devices/${id}/locations`, { params: { platform: plat } }).catch(() => null),
    api.get(`/devices/${id}/network-status`, { params: { platform: plat } }).catch(() => null),
    api.get(`/devices/${id}/agent-diagnostics`).catch(() => null),
  ]);
  locations.value = locRes?.data?.items ?? [];
  network.value = netRes?.data?.items?.[0] ?? null;
  agentLogs.value = diagRes?.data?.agentLogs ?? null;
  agentTrace.value = diagRes?.data?.agentTrace ?? null;
  loadingExtras.value = false;
}

// The Agent tab's "Fetch Agent Logs & Traces" button — the only thing that
// ever triggers a live call to Applivery's agent-logs/agent-trace endpoints
// (devices.service.ts's fetchDeviceAgentDiagnostics). A side that errors
// (network hiccup, Applivery-side issue) doesn't wipe out whatever was
// already on screen from a previous successful fetch — the backend always
// returns the best-available payload for both sides, plus a non-blocking
// `errors` list surfaced here instead.
async function fetchAgentDiagnostics() {
  if (!device.value) return;
  isFetchingAgentDiagnostics.value = true;
  agentDiagnosticsError.value = null;
  try {
    const { api } = await import("../../api/http");
    const res = await api.post(`/devices/${device.value.id}/agent-diagnostics/fetch`, null, { params: { platform: platform.value } });
    agentLogs.value = res.data?.agentLogs ?? null;
    agentTrace.value = res.data?.agentTrace ?? null;
    if (res.data?.errors?.length) agentDiagnosticsError.value = res.data.errors.join(" · ");
  } catch (err: any) {
    agentDiagnosticsError.value = err?.response?.data?.detail || "Could not fetch agent logs/traces.";
  } finally {
    isFetchingAgentDiagnostics.value = false;
  }
}

// Port of App.jsx's DeviceInsightCard signal-strength normalizer
// (App.jsx:2334-2339) — Applivery's mdmNetworkStatus.strength isn't
// consistently 0-100 vs 0-4 bars across platforms, so anything above 4 is
// treated as already-a-percentage.
function signalPct(strength: number | null | undefined): number | null {
  if (strength === null || strength === undefined) return null;
  const pct = strength > 4 ? strength / 100 : strength / 4;
  return Math.min(Math.max(pct, 0), 1);
}

watch(
  () => props.device,
  async (d, prevD) => {
    // DevicesView's background poll (stores/devices.ts's fetchDevices) and
    // any post-mutation fetchDevices(true) replace store.devices with brand
    // new object references every time, even when nothing about THIS device
    // actually changed — since `selectedDevice` is a `.find()` over that
    // array, props.device gets a new reference on every such refresh while
    // the drawer is sitting open on the same device. Before this guard, that
    // reference change alone was enough to re-run the full reset below —
    // jumping the admin back to the Overview tab, closing whatever picker
    // was open, and re-firing the locations/network/logs/firewall fetches —
    // every ~20s while just looking at a device, which read as the whole
    // modal randomly reloading. Only run the full reset for an actual
    // identity change (a different device opened, or the drawer closing);
    // a same-device refresh just patches resolvedDevice in place so tabs
    // like Compliance still pick up fresh policy/violation data live.
    const newId = d ? rawDeviceId(d) : null;
    const prevId = prevD ? rawDeviceId(prevD) : null;
    if (d && newId && newId === prevId) {
      if (typeof d.platformDeviceId === "string") resolvedDevice.value = d as NormalizedDevice;
      return;
    }

    tab.value = "overview";
    activePicker.value = null;
    error.value = null;
    firewallState.value = null;
    resolvedDevice.value = null;
    appsSearchQuery.value = "";
    locations.value = [];
    network.value = null;
    agentLogs.value = null;
    agentTrace.value = null;
    agentDiagnosticsError.value = null;
    showLocationHistory.value = false;
    if (!d) return;

    // Segment picker needs store.segments regardless of entry point — the
    // Devices view already populates this on mount (fetchPickers), but
    // Playground/Overview never had a reason to before.
    if (store.segments.length === 0) store.fetchPickers().catch(() => undefined);
    // Same reasoning for the Compliance tab's "assigned policies" list below
    // — DevicesView never loads SOAR's own Compliance Policies (that's
    // ComplianceView's job), so Playground/Overview/Devices entry points
    // alike need it fetched here.
    if (complianceStore.policies.length === 0) complianceStore.fetchPolicies().catch(() => undefined);

    if (typeof d.platformDeviceId === "string") {
      // Already a full NormalizedDevice — the Devices view's own fast
      // path, no extra round trip, same behavior this component always had
      // when opened from there.
      resolvedDevice.value = d as NormalizedDevice;
    } else {
      isResolvingDevice.value = true;
      try {
        resolvedDevice.value = (await store.getDeviceCompliance(rawDeviceId(d))) as NormalizedDevice;
      } catch (err: any) {
        error.value = err?.response?.data?.detail || "Could not load full device detail.";
      } finally {
        isResolvingDevice.value = false;
      }
    }

    const resolved = resolvedDevice.value;
    if (!resolved) return;
    if (resolved.platform === "windows") {
      store
        .getFirewallState(resolved.id)
        .then((res) => (firewallState.value = res || { active: [] }))
        .catch(() => (firewallState.value = { active: [] }));
    }
    loadExtras(resolved.id, resolved.platform);
  },
  { immediate: true },
);

// Which of SOAR's own Compliance Policies (not Applivery's device policy
// assignments — that's the separate "activePolicies" picker below) actually
// apply to this device, each with a live green/red posture — not just the
// ones currently violated. Mirrors runComplianceEvaluation's own scoping
// exactly (compliance.service.ts: targetDeviceAudienceId membership if set,
// AND targetPlatform match if set — targetDeploymentModel is deliberately
// not used to filter, same as the backend), so this list is never wider or
// narrower than what's actually being evaluated against the device. Posture
// comes from device.policyViolations (the live, self-clearing
// complianceEvaluationState list) — a policy id NOT present there is
// compliant, matching how policyCompliant itself is derived
// (devices.service.ts: `policyViolations.length === 0`).
const assignedCompliancePolicies = computed(() => {
  const d = device.value;
  if (!d) return [];
  const violationByPolicyId = new Map((d.policyViolations || []).map((v) => [v.policyId, v]));
  return complianceStore.policies
    .filter((p) => p.enabled)
    .filter((p) => !p.targetDeviceAudienceId || (d.deviceAudiences || []).some((a) => String(a.id) === String(p.targetDeviceAudienceId)))
    .filter((p) => !p.targetPlatform || p.targetPlatform === d.platform)
    .map((p) => {
      const violation = violationByPolicyId.get(p.id);
      return { id: p.id, name: p.name, severity: p.severity, compliant: !violation, status: violation?.status ?? null };
    });
});

// "SOAR Agent" (our own Windows/macOS agent) vs. Applivery's separate
// "Applivery Agent" (their own MDM enrollment agent) — named explicitly in
// every label below so this never reads as a claim about Applivery's own
// agent status. Three states rather than a plain yes/no: a device that
// self-reported once and then went quiet reads as "stale", not lumped in
// with "never installed" (device.soarAgentReporting is only true within
// SOAR_AGENT_STALE_THRESHOLD_MS of the last report — devices.service.ts).
const soarAgentBadge = computed(() => {
  const d = device.value;
  if (!d) return { label: "No SOAR Agent", color: "#9CA3AF", detail: "" };
  if (d.soarAgentReporting) {
    return { label: "SOAR Agent reporting", color: SUCCESS, detail: d.soarAgentLastReportedAt ? `Last reported ${new Date(d.soarAgentLastReportedAt).toLocaleString()}` : "" };
  }
  if (d.soarAgentLastReportedAt) {
    return { label: "SOAR Agent stale", color: WARNING, detail: `Last reported ${new Date(d.soarAgentLastReportedAt).toLocaleString()} — hasn't reported recently` };
  }
  return { label: "No SOAR Agent", color: "#9CA3AF", detail: "This device has never self-reported to Applivery SOAR" };
});

const segmentName = computed(() => {
  if (!device.value) return "Global";
  const flat = flattenSegments(store.segments as any);
  const match = flat.find((s) => String(s.id) === String(device.value!.segmentId));
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

function handleSegmentSelect(segment: { id: string | number; name: string }) {
  activePicker.value = null;
  const d = device.value!;
  runMutation(async () => {
    await store.updateSegment(d.platformDeviceId, platform.value, Number(segment.id));
    // Optimistic local patch — Devices-view entries get overwritten a
    // moment later by the store's own post-mutation fetchDevices(true)
    // (re-triggering this component's props.device watcher); Playground/
    // Overview entries have no such store-driven refresh, since their
    // `device` prop isn't derived from store.devices, so this is the only
    // update they get.
    resolvedDevice.value = { ...d, segmentId: segment.id };
  });
}

// Applivery Policy Composition priority is a real per-assignment number
// (lower wins conflicts against other assigned policies), not array order —
// see stores/devices.ts's ActivePolicy comment. This picker has no priority
// selector, so a manually-added policy defaults to "yields to whatever's
// already on the device" (a number higher than every existing numbered
// assignment) rather than accidentally outranking policies the admin didn't
// touch. 100 mirrors Applivery's own default foundation-policy priority,
// used only when the device has no numbered assignments yet to react to.
const DEFAULT_PRIORITY_BASELINE = 100;
const PRIORITY_STEP = 10;

function handleAddPolicy(policy: { id: string; name: string }) {
  activePicker.value = null;
  const d = device.value!;
  const existing = d.activePolicies || [];
  const numberedPriorities = existing.map((p) => p.priority).filter((n): n is number => typeof n === "number");
  const newPriority = (numberedPriorities.length ? Math.max(...numberedPriorities) : DEFAULT_PRIORITY_BASELINE) + PRIORITY_STEP;
  const updated = [...existing, { id: policy.id, name: policy.name, platform: d.platform, priority: newPriority, isPrimary: false }];
  runMutation(async () => {
    await store.updatePolicies(
      d.platformDeviceId,
      platform.value,
      updated.map((p) => ({ id: p.id, name: p.name, priority: p.priority, isPrimary: p.isPrimary })),
    );
    resolvedDevice.value = { ...d, activePolicies: updated };
  });
}

function handleRemovePolicy(policyToRemove: { id: string | null }) {
  const d = device.value!;
  // Every remaining policy keeps its own real priority/isPrimary untouched —
  // removing one policy shouldn't renumber or reorder any of the others.
  const updated = (d.activePolicies || []).filter((p) => p.id !== policyToRemove.id);
  runMutation(async () => {
    await store.updatePolicies(
      d.platformDeviceId,
      platform.value,
      updated.map((p) => ({ id: p.id, name: p.name, priority: p.priority, isPrimary: p.isPrimary })),
    );
    resolvedDevice.value = { ...d, activePolicies: updated };
  });
}

function handleSaveTags(tags: string[]) {
  activePicker.value = null;
  const d = device.value!;
  runMutation(async () => {
    await store.updateTags(d.platformDeviceId, platform.value, tags);
    resolvedDevice.value = { ...d, tags };
  });
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
  const d = device.value!;
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
  if (!device.value) return;
  router.push({ path: "/audit-logs", query: { deviceId: device.value.id, deviceName: device.value.displayName } });
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

// Agent-log field fallbacks — content/contentError/file/createdAt are the
// fields confirmed on Applivery's official agent-logs schema, but a
// reference third-party app consuming the same API (device_profile_sheet.dart
// :4514-4519) defensively also reads type/eventType, status/result,
// message/output/description/detail, and scriptName/name — implying
// Applivery's real production payloads carry more than the documented
// minimum. These helpers read the same fallback chains so the tab still
// shows something useful if a given org's logs use those fields instead of
// (or alongside) content.
function logTitle(l: Record<string, any>): string {
  return l.scriptName || l.name || l.type || l.eventType || "Agent event";
}
function logStatus(l: Record<string, any>): string {
  return (l.status || l.result || "").toString();
}
function logBody(l: Record<string, any>): string {
  return l.content || l.message || l.output || l.description || l.detail || "";
}

// Agent Trace items — per Applivery's official schema (GET /mdm/agent-trace)
// every item is `{ resource: { type: "script"|"smartAttribute", id }, event:
// { type: "error", content }, fingerprint, createdAt, ... }`, always an
// error against a specific script or smart attribute the agent tried to
// run/evaluate on this device — hence the fixed "<Resource> error" title
// rather than a fallback chain like logTitle's (agent-trace has no
// alternate field naming to guard against, unlike agent-logs).
function traceTitle(t: Record<string, any>): string {
  const resType = t.resource?.type;
  if (!resType) return "Agent trace event";
  return `${resType.charAt(0).toUpperCase()}${resType.slice(1)} error`;
}
</script>

<template>
  <template v-if="props.device">
    <div class="fixed inset-0 z-[260] bg-black/40" @click="emit('close')" />
    <div class="fixed inset-y-0 right-0 z-[260] w-full sm:w-[440px] shadow-2xl flex flex-col bg-white dark:bg-gray-800">
      <!-- Loading skeleton — shown only while resolving a lighter-shape
           device (Playground/Overview entry) into the full record. Devices
           view callers skip this entirely (device resolves synchronously). -->
      <template v-if="!device">
        <div class="shrink-0 px-5 pt-5 pb-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <p class="font-semibold text-gray-900 dark:text-white">Device details</p>
          <button class="p-1.5 rounded-lg hover:opacity-70 transition-opacity shrink-0 text-gray-400" @click="emit('close')">
            <component :is="ICONS.CloseCircle" :size="18" weight="Linear" />
          </button>
        </div>
        <div class="flex-1 flex flex-col items-center justify-center gap-3 p-8">
          <div v-if="isResolvingDevice" class="w-8 h-8 border-2 rounded-full animate-spin" :style="{ borderColor: `${PRIMARY_BLUE}30`, borderTopColor: PRIMARY_BLUE }" />
          <span v-if="isResolvingDevice" class="text-xs uppercase tracking-widest font-bold text-gray-400">Loading device…</span>
          <p v-if="error" class="text-xs text-center" :style="{ color: DANGER }">{{ error }}</p>
        </div>
      </template>

      <template v-else>
        <!-- Header -->
        <div class="shrink-0 px-5 pt-5 pb-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-gray-100 dark:bg-gray-700">
                <component :is="ICONS.Smartphone" :size="20" weight="Linear" class="text-gray-400" />
              </div>
              <div class="min-w-0">
                <p class="font-semibold truncate text-gray-900 dark:text-white flex items-center gap-1">
                  {{ device.displayName }}
                  <HelpIcon slug="devices" anchor="apps-tab" title="Device details admin guide" />
                </p>
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
        <div class="shrink-0 flex px-5 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          <button
            v-for="t in [
              { key: 'overview', label: 'Overview' },
              { key: 'compliance', label: 'Compliance' },
              { key: 'apps', label: 'Apps' },
              { key: 'location', label: 'Location' },
              { key: 'agent', label: 'Agent' },
            ]"
            :key="t.key"
            class="relative px-3 pb-2.5 pt-3 text-sm font-medium transition-colors whitespace-nowrap"
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
              <!-- "Windows version" cross-references the raw osVersion build
                   number above (Applivery's inventory only ever reports e.g.
                   "10.0.28000.2704", never a marketing name) against
                   windowsVersionLabel, the backend's build-to-feature-name
                   lookup (osUpdateCatalog.ts). Edition (Pro/Enterprise/
                   Enterprise LTSC/...) has no Applivery equivalent at all —
                   it only appears once the SOAR Agent has reported it
                   (selfReported.attributes.osEdition), so this row degrades
                   gracefully to just the version name until then. -->
              <div v-for="row in [
                ['Model', device.manufacturer ? `${device.manufacturer} ${device.model}`.trim() : device.model],
                ['OS version', device.osVersion],
                ['Windows version', (device as any).windowsVersionLabel
                  ? `${(device as any).windowsVersionLabel}${(device.selfReported as any)?.attributes?.osEdition ? ` · ${(device.selfReported as any).attributes.osEdition}` : ''}`
                  : null],
                ['MAC address', (device as any).macAddress],
                ['IP address', (device as any).ipAddress],
                ['Management mode', (device as any).managementMode],
                ['Battery', device.battery != null ? `${device.battery}%` : null],
                ['Storage', device.totalStorageGb ? `${device.availableStorageGb ? device.availableStorageGb.toFixed(1) + ' GB free of ' : ''}${device.totalStorageGb.toFixed(1)} GB` : null],
                ['RAM', device.ramGb ? `${device.ramGb.toFixed(1)} GB` : null],
                ['State', device.state],
                ['Enrolled', device.enrolledAt ? formatDate(device.enrolledAt) : null],
                ['Last seen', device.lastSeen ? formatDate(device.lastSeen) : null],
              ]" :key="row[0] as string">
                <div v-if="row[1]" class="flex items-center justify-between py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
                  <span class="text-gray-400">{{ row[0] }}</span>
                  <span class="text-gray-900 dark:text-white">{{ row[1] }}</span>
                </div>
              </div>
            </div>

            <!-- Network Status — moved over from the Playground modal's
                 own Overview tab (DeviceInsightModal.vue), same
                 /devices/:id/network-status extras fetch. Field names
                 (networkType/strength/carrierInfo.*/point.address.*/date)
                 match Applivery's official mdmNetworkStatus schema and the
                 original App.jsx's DeviceInsightCard (App.jsx:2324-2346) —
                 the earlier Vue port had drifted to made-up field names
                 (type/signalStrength/carrier/simState/city) that don't
                 exist on the real API response, so Network Status silently
                 rendered as empty/"Unknown" for every device. -->
            <div v-if="!loadingExtras && network" class="mb-6">
              <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Network Status</p>
              <div class="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-sm space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="inline-flex items-center gap-1.5 font-semibold" :style="{ color: String(network.networkType || '').toLowerCase().includes('wifi') ? PRIMARY_BLUE : SUCCESS }">
                    <component :is="String(network.networkType || '').toLowerCase().includes('wifi') ? ICONS.WiFiRouter : ICONS.Radio" :size="13" weight="Linear" />
                    {{ network.networkType || "Unknown" }}
                  </span>
                  <span v-if="signalPct(network.strength) !== null" class="text-xs text-gray-400">{{ Math.round(signalPct(network.strength)! * 100) }}%</span>
                </div>
                <p v-if="network.carrierInfo?.carrierName || network.carrierInfo?.simState" class="text-xs text-gray-400">
                  {{ [network.carrierInfo?.carrierName, network.carrierInfo?.simState].filter(Boolean).join(" · ") }}
                </p>
                <p v-if="network.point?.address?.city || network.point?.address?.country" class="text-xs text-gray-400">
                  {{ [network.point?.address?.city, network.point?.address?.country].filter(Boolean).join(", ") }}
                </p>
                <p v-if="network.date" class="text-xs text-gray-400">Updated {{ formatDate(network.date) }}</p>
              </div>
            </div>

            <!-- OS Updates (Windows) -->
            <div v-if="device.osUpdateStatus" class="mb-6">
              <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">OS Updates</p>
              <p v-if="(device.osUpdateStatus as any).confidence === 'unknown'" class="text-xs text-gray-400">
                No confirmed patch-level comparison available yet for this Windows build — Microsoft's catalog hasn't published a build number we could match against this feature version.
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
                  <p v-if="(kb.cveIds || []).length > 0" class="text-[10px] mt-0.5 text-gray-400" :title="kb.cveIds.join(', ')">
                    <template v-for="(cve, idx) in kb.cveIds.slice(0, 4)" :key="cve">
                      <a v-if="msrcUrl(cve)" :href="msrcUrl(cve)!" target="_blank" rel="noopener noreferrer" class="hover:underline" :style="{ color: PRIMARY_BLUE }">{{ cve }}</a>
                      <template v-else>{{ cve }}</template>
                      <template v-if="(idx as number) < Math.min(kb.cveIds.length, 4) - 1">, </template>
                    </template>
                    {{ kb.cveIds.length > 4 ? ` +${kb.cveIds.length - 4} more` : "" }}
                  </p>
                </div>
                <p class="text-[10px] text-gray-400">
                  Security updates only — MSRC doesn't track Driver, Feature, or Quality-only updates, and Applivery reports no per-device driver inventory to compare against.
                </p>
              </div>
              <p v-else class="text-xs" :style="{ color: SUCCESS }">Up to date with the latest known security update for this build.</p>
            </div>

            <!-- OS Updates (Apple / macOS) — mirrors the Windows section
                 above but sourced differently: Apple's GDMF feed (already
                 behind osLifecycleStatus.onLatestVersion/latestKnownVersion)
                 tells us whether the device is on the newest signed release;
                 it never carries a CVE list itself (confirmed against live
                 GDMF data — every release entry's cveIds came back empty),
                 so the CVE detail here is the same EUVD-derived vulnStatus
                 already computed for the Compliance tab's Vulnerabilities
                 section, just reframed around "how far behind is this
                 device" rather than general risk. Per user request, this is
                 additive — the Compliance tab's own Vulnerabilities section
                 stays exactly as-is. -->
            <div v-if="(device.platform === 'apple' || device.platform === 'macos') && (device.osLifecycleStatus || device.vulnStatus)" class="mb-6">
              <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">OS Updates</p>
              <p v-if="!device.osLifecycleStatus || (device.osLifecycleStatus as any).confidence === 'unknown' || (device.osLifecycleStatus as any).latestKnownVersion == null" class="text-xs text-gray-400">
                No confirmed patch-level comparison available yet for this OS version — Apple's software lookup service (GDMF) hasn't published a signed release we could match against it.
              </p>
              <div v-else-if="(device.osLifecycleStatus as any).onLatestVersion === false" class="space-y-1.5">
                <p class="text-xs font-medium" :style="{ color: WARNING }">
                  Not on the latest signed release — latest known: {{ (device.osLifecycleStatus as any).latestKnownVersion }}{{ (device.osLifecycleStatus as any).latestKnownBuild ? ` (build ${(device.osLifecycleStatus as any).latestKnownBuild})` : "" }}
                </p>
                <template v-if="(device.vulnStatus as any)?.pendingCount > 0">
                  <div v-for="c in (device.vulnStatus as any).pendingCves" :key="c.cveId" class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900/50">
                    <span class="text-gray-900 dark:text-white">
                      <a v-if="vulnLink(c.cveId)" :href="vulnLink(c.cveId)!" target="_blank" rel="noopener noreferrer" class="hover:underline" :style="{ color: PRIMARY_BLUE }">{{ c.cveId }}</a>
                      <template v-else>{{ c.cveId }}</template>
                      <span class="text-gray-400"> · fixed in {{ c.fixedVersion }}</span>
                    </span>
                    <span class="font-semibold shrink-0" :style="{ color: c.exploited || c.baseSeverity === 'Critical' ? DANGER : WARNING }">
                      {{ c.baseSeverity || "Unknown" }}{{ c.exploited ? " · exploited" : "" }}{{ typeof c.epss === "number" ? ` · EPSS ${(c.epss * 100).toFixed(0)}%` : "" }}
                    </span>
                  </div>
                  <p class="text-[10px] text-gray-400">
                    Showing the top {{ Math.min((device.vulnStatus as any).pendingCves.length, 10) }} of {{ (device.vulnStatus as any).pendingCount }} known CVEs fixed in a newer version, by severity.
                  </p>
                </template>
                <p v-else class="text-[10px] text-gray-400">A newer signed release is available, but there's no confirmed CVE data for this specific version gap yet.</p>
              </div>
              <p v-else class="text-xs" :style="{ color: SUCCESS }">Up to date with the latest known signed release for this device.</p>
            </div>

            <!-- OS Lifecycle -->
            <div v-if="device.osLifecycleStatus && (device.osLifecycleStatus as any).confidence !== 'unknown' && (device.osLifecycleStatus as any).isEol !== null && (device.osLifecycleStatus as any).isEol !== undefined" class="mb-6">
              <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">OS Lifecycle</p>
              <div v-if="(device.osLifecycleStatus as any).trainLabel" class="flex items-center justify-between py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
                <span class="text-gray-400">Train</span>
                <span class="text-gray-900 dark:text-white">{{ (device.osLifecycleStatus as any).trainLabel }}</span>
              </div>
              <p v-if="(device.osLifecycleStatus as any).isEol" class="text-xs font-medium mt-2" :style="{ color: DANGER }">
                This OS version has reached end of life for security support{{ (device.osLifecycleStatus as any).eolFrom ? ` (since ${(device.osLifecycleStatus as any).eolFrom})` : "" }}.
                {{ (device.osLifecycleStatus as any).esuUntil ? ` Paid Extended Security Updates are available until ${(device.osLifecycleStatus as any).esuUntil}.` : "" }}
              </p>
              <p v-else class="text-xs mt-2" :style="{ color: SUCCESS }">
                This OS version is still within its security support window.
                {{
                  (device.osLifecycleStatus as any).onLatestVersion === false && (device.osLifecycleStatus as any).latestKnownVersion
                    ? ` A newer version is available: ${(device.osLifecycleStatus as any).latestKnownVersion}${(device.osLifecycleStatus as any).latestKnownBuild ? ` (build ${(device.osLifecycleStatus as any).latestKnownBuild})` : ""}.`
                    : ""
                }}
              </p>
              <template v-if="(device.osLifecycleStatus as any).latestKnownBuild">
                <div class="flex items-center justify-between py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
                  <span class="text-gray-400">Latest signed build</span>
                  <span class="font-mono text-xs text-gray-900 dark:text-white">{{ (device.osLifecycleStatus as any).latestKnownBuild }}</span>
                </div>
                <div v-if="(device.osLifecycleStatus as any).updateExpirationDate" class="flex items-center justify-between py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
                  <span class="text-gray-400">Signed until</span>
                  <span class="text-gray-900 dark:text-white">{{ (device.osLifecycleStatus as any).updateExpirationDate }}</span>
                </div>
                <div v-if="(device.osLifecycleStatus as any).hardwareMatched === true || (device.osLifecycleStatus as any).hardwareMatched === false" class="flex items-center justify-between py-1.5 text-sm border-b border-gray-100 dark:border-gray-800">
                  <span class="text-gray-400">Hardware match</span>
                  <span class="text-gray-900 dark:text-white">{{ (device.osLifecycleStatus as any).hardwareMatched === true ? "Confirmed for this model" : "Unconfirmed — fleet-wide result" }}</span>
                </div>
              </template>
              <div v-if="(device.osLifecycleStatus as any).rapidSecurityResponse?.available" class="mt-2 px-3 py-2 rounded-lg text-xs border" :style="{ backgroundColor: `${WARNING}10`, borderColor: `${WARNING}30` }">
                <p class="font-semibold" :style="{ color: WARNING }">
                  Rapid Security Response available{{ (device.osLifecycleStatus as any).rapidSecurityResponse.supplementalBuildVersion ? ` (${(device.osLifecycleStatus as any).rapidSecurityResponse.supplementalBuildVersion})` : "" }}
                </p>
                <p v-if="((device.osLifecycleStatus as any).rapidSecurityResponse.cveIds || []).length > 0" class="mt-0.5 text-gray-400">
                  <template v-for="(cve, idx) in (device.osLifecycleStatus as any).rapidSecurityResponse.cveIds" :key="cve">
                    <a v-if="vulnLink(cve)" :href="vulnLink(cve)!" target="_blank" rel="noopener noreferrer" class="hover:underline" :style="{ color: WARNING }">{{ cve }}</a>
                    <template v-else>{{ cve }}</template>
                    <template v-if="(idx as number) < (device.osLifecycleStatus as any).rapidSecurityResponse.cveIds.length - 1">, </template>
                  </template>
                </p>
              </div>
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
              <p class="text-[10px] mt-2 text-gray-400">
                Reflects the last Apply/Restore action dispatched from a workflow (Workflows → Firewall Policy Library) — confirms the command was sent, not a live read of the device's actual rule state. Run the matching "Restore Firewall" action to remove a rule set.
              </p>
            </div>

            <!-- App Updates -->
            <div v-if="device.appleAppUpdateStatus" class="mb-6">
              <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">App Updates</p>
              <div v-if="(device.appleAppUpdateStatus as any).pendingCount > 0" class="space-y-1.5">
                <p class="text-xs font-medium" :style="{ color: WARNING }">
                  {{ (device.appleAppUpdateStatus as any).pendingCount }} of {{ (device.appleAppUpdateStatus as any).totalApps }} app{{ (device.appleAppUpdateStatus as any).totalApps === 1 ? "" : "s" }} have an update available
                </p>
                <div v-for="a in (device.appleAppUpdateStatus as any).pendingApps" :key="a.identifier" class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900/50">
                  <span class="truncate text-gray-900 dark:text-white">
                    {{ a.name || a.identifier }} <span v-if="a.isBetaApp" class="text-gray-400">(beta)</span>
                  </span>
                  <span class="font-mono shrink-0 text-gray-400">{{ a.installedVersion || "—" }}</span>
                </div>
                <p class="text-[10px] text-gray-400">
                  Straight from Apple's own App Store/VPP metadata via Applivery — "update available" here means Apple itself has published a newer version, not a version comparison we computed.
                </p>
              </div>
              <p v-else class="text-xs" :style="{ color: SUCCESS }">All {{ (device.appleAppUpdateStatus as any).totalApps }} tracked app{{ (device.appleAppUpdateStatus as any).totalApps === 1 ? "" : "s" }} up to date.</p>
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
                <span
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                  :style="{ backgroundColor: `${soarAgentBadge.color}15`, color: soarAgentBadge.color }"
                  :title="soarAgentBadge.detail"
                >
                  <component :is="ICONS.Cpu" :size="12" weight="Linear" />
                  {{ soarAgentBadge.label }}
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

            <!-- Vulnerabilities — moved here from the Overview tab per user
                 request: the original Devices-view modal (DeviceDetailDrawer
                 .jsx) placed this under Overview, but grouping it with the
                 other risk signals in Compliance reads better and is what
                 the user asked for after seeing it live. -->
            <div v-if="device.vulnStatus" class="mb-6">
              <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Vulnerabilities</p>
              <p v-if="(device.vulnStatus as any).confidence === 'unknown'" class="text-xs text-gray-400">
                No confirmed vulnerability comparison available yet for this OS version — the EUVD catalog hasn't published a parseable fixed-version match for it.
              </p>
              <div v-else-if="(device.vulnStatus as any).pendingCount > 0" class="space-y-1.5">
                <p class="text-xs font-medium" :style="{ color: WARNING }">{{ (device.vulnStatus as any).pendingCount }} known CVE{{ (device.vulnStatus as any).pendingCount === 1 ? "" : "s" }} fixed in a newer version</p>
                <div v-for="c in (device.vulnStatus as any).pendingCves" :key="c.cveId" class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900/50">
                  <span class="text-gray-900 dark:text-white">
                    <a v-if="vulnLink(c.cveId)" :href="vulnLink(c.cveId)!" target="_blank" rel="noopener noreferrer" class="hover:underline" :style="{ color: PRIMARY_BLUE }">{{ c.cveId }}</a>
                    <template v-else>{{ c.cveId }}</template>
                    <span class="text-gray-400">· fixed in {{ c.fixedVersion || c.fixedInMajor }}</span>
                  </span>
                  <span class="font-semibold shrink-0" :style="{ color: c.exploited || c.baseSeverity === 'Critical' ? DANGER : WARNING }">
                    {{ c.baseSeverity || "Unknown" }}{{ c.exploited ? " · exploited" : "" }}{{ typeof c.epss === "number" ? ` · EPSS ${(c.epss * 100).toFixed(0)}%` : "" }}
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
                      ? `Last checked ${new Date((device.vulnServiceStatus as any).lastCheckedAt).toLocaleString()} — nothing conclusive was found then, and it hasn't been refreshed since. If this device is still active, check Settings > Vulnerability Service for refresh errors.`
                      : "Not checked yet — waiting on the next scheduled refresh (Settings > Vulnerability Service)."
                  }}
                </p>
              </template>
              <template v-else>
                <div
                  v-if="((device.vulnServiceStatus as any).counts?.CRITICAL || 0) + ((device.vulnServiceStatus as any).counts?.HIGH || 0) + ((device.vulnServiceStatus as any).counts?.MEDIUM || 0) + ((device.vulnServiceStatus as any).counts?.LOW || 0) > 0"
                  class="space-y-1.5"
                >
                  <p class="text-xs font-medium" :style="{ color: (device.vulnServiceStatus as any).hasKev ? DANGER : WARNING }">
                    {{ ((device.vulnServiceStatus as any).counts?.CRITICAL || 0) + ((device.vulnServiceStatus as any).counts?.HIGH || 0) + ((device.vulnServiceStatus as any).counts?.MEDIUM || 0) + ((device.vulnServiceStatus as any).counts?.LOW || 0) }}
                    known CVE{{ (((device.vulnServiceStatus as any).counts?.CRITICAL || 0) + ((device.vulnServiceStatus as any).counts?.HIGH || 0) + ((device.vulnServiceStatus as any).counts?.MEDIUM || 0) + ((device.vulnServiceStatus as any).counts?.LOW || 0)) === 1 ? "" : "s" }}
                    across the OS and {{ (device.vulnServiceStatus as any).appsCheckedCount }} checked app{{ (device.vulnServiceStatus as any).appsCheckedCount === 1 ? "" : "s" }}
                    {{ (device.vulnServiceStatus as any).hasKev ? " — includes a known-exploited (CISA KEV) CVE" : "" }}
                  </p>
                  <div v-for="c in (device.vulnServiceStatus as any).topCves" :key="c.id" class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900/50">
                    <span class="text-gray-900 dark:text-white">
                      <a v-if="vulnLink(c.id)" :href="vulnLink(c.id)!" target="_blank" rel="noopener noreferrer" class="hover:underline" :style="{ color: PRIMARY_BLUE }">{{ c.id }}</a>
                      <template v-else>{{ c.id }}</template>
                      <span v-if="c.fixed_in" class="text-gray-400">· fixed in {{ c.fixed_in }}</span>
                    </span>
                    <span class="font-semibold shrink-0" :style="{ color: c.is_kev || c.severity === 'CRITICAL' ? DANGER : WARNING }">
                      {{ c.severity || "Unknown" }}{{ c.is_kev ? " · known-exploited" : "" }}{{ typeof c.epss_score === "number" ? ` · EPSS ${(c.epss_score * 100).toFixed(0)}%` : "" }}
                    </span>
                  </div>
                  <p v-if="(device.vulnServiceStatus as any).uncertain > 0" class="text-[10px] text-gray-400">
                    {{ (device.vulnServiceStatus as any).uncertain }} additional match{{ (device.vulnServiceStatus as any).uncertain === 1 ? "" : "es" }} couldn't be confirmed against a fixed version.
                  </p>
                </div>
                <p v-else class="text-xs" :style="{ color: SUCCESS }">
                  No known CVEs against this device's OS or {{ (device.vulnServiceStatus as any).appsCheckedCount }} checked app{{ (device.vulnServiceStatus as any).appsCheckedCount === 1 ? "" : "s" }}.
                </p>
              </template>
              <p class="text-[10px] mt-2 text-gray-400">
                From your org's Vulnerability Service integration — an independent signal alongside the Vulnerability Catalog above, covering all platforms and both the OS and individual apps.
              </p>
            </div>

            <div class="mb-6">
              <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">
                Compliance Policies{{ assignedCompliancePolicies.length ? ` (${assignedCompliancePolicies.length})` : "" }}
              </p>
              <!-- Every SOAR Compliance Policy in scope for this device (platform +
                   audience match), not just the ones currently violated — a policy
                   this device is passing previously had no presence here at all,
                   so "is this device even covered by a policy" wasn't answerable
                   from this tab. Green/red posture per row instead of only
                   surfacing red ones. -->
              <div v-if="assignedCompliancePolicies.length > 0" class="space-y-1.5">
                <div v-for="p in assignedCompliancePolicies" :key="p.id" class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-gray-900/50">
                  <span class="flex items-center gap-2 min-w-0">
                    <span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: p.compliant ? SUCCESS : DANGER }" />
                    <span class="truncate text-gray-900 dark:text-white">{{ p.name }}</span>
                  </span>
                  <span class="text-[10px] font-semibold shrink-0 uppercase" :style="{ color: p.compliant ? SUCCESS : (p.status === 'pending' ? WARNING : p.status === 'auto_fired' ? PRIMARY_BLUE : DANGER) }">
                    {{ p.compliant ? "Compliant" : (String(p.status || "").replace("_", " ") || "Violating") }}
                  </span>
                </div>
              </div>
              <p v-else class="text-xs text-gray-400">No Compliance Policies are currently scoped to this device (platform/device audience).</p>
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

          <template v-else-if="tab === 'apps'">
            <!-- Every app this device reports as installed — same underlying
                 data as the Apps main-nav view's Reported Apps table
                 (installedApps.service.ts), scoped to just this device, with
                 each app's own CVE data (when the Vulnerability Service is
                 enabled and has a fresh cached match) via devices.service.ts's
                 computeDeviceAppsDetail. See docs/apps.md#vulnerability-service-risk-scoring. -->
            <div v-if="(device.installedAppsDetail || []).length === 0" class="text-xs text-gray-400 px-3 py-3 rounded-lg bg-gray-50 dark:bg-gray-900/50">
              No app inventory reported yet for this device — via the SOAR Agent's App Inventory Reporting, or the background refresher once a Compliance Policy references an App List.
            </div>
            <template v-else>
              <div class="relative mb-2.5">
                <component :is="ICONS.Magnifer" :size="14" weight="Linear" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  v-model="appsSearchQuery"
                  type="text"
                  placeholder="Search app name or identifier…"
                  class="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1"
                  :style="{ '--tw-ring-color': PRIMARY_BLUE } as any"
                />
              </div>
              <p v-if="filteredInstalledApps.length === 0" class="text-xs text-gray-400 px-3 py-3 rounded-lg bg-gray-50 dark:bg-gray-900/50">No apps match "{{ appsSearchQuery }}".</p>
              <div v-else class="space-y-2.5">
              <div v-for="a in filteredInstalledApps" :key="`${a.identifier}-${a.version}-${a.source}`" class="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <p class="text-sm text-gray-900 dark:text-white truncate flex items-center gap-1.5">
                      {{ a.name || a.identifier }}
                      <component v-if="a.enforcedByPolicy" :is="ICONS.ShieldCheck" :size="11" weight="Linear" class="text-emerald-500 shrink-0" title="Enforced by Applivery's Windows App Distribution policy" />
                      <component v-if="a.updateAvailable" :is="ICONS.CloudDownload" :size="11" weight="Linear" class="text-blue-500 shrink-0" title="Update available" />
                    </p>
                    <p class="text-[11px] text-gray-400 truncate">
                      {{ a.identifier }} · v{{ a.version }}
                      <span v-if="a.origin === 'store'" class="ml-1 px-1 py-0.5 rounded text-[9px] font-semibold bg-violet-500/10 text-violet-500 align-middle">Store</span>
                      <span v-else-if="a.origin === 'msi'" class="ml-1 px-1 py-0.5 rounded text-[9px] font-semibold bg-sky-500/10 text-sky-500 align-middle">MSI</span>
                    </p>
                  </div>
                  <span
                    class="px-1.5 py-0.5 rounded-full text-[9px] font-semibold shrink-0"
                    :class="a.source === 'self_reported' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-gray-500/10 text-gray-500 dark:text-gray-400'"
                  >
                    {{ APP_SOURCE_LABELS[a.source] || a.source }}
                  </span>
                </div>
                <div v-if="a.vuln && a.vuln.cveList.length > 0" class="mt-1.5 space-y-1">
                  <div v-for="c in a.vuln.cveList" :key="c.id" class="flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg text-[11px] bg-white dark:bg-gray-800">
                    <span class="text-gray-900 dark:text-white">
                      <a v-if="vulnLink(c.id)" :href="vulnLink(c.id)!" target="_blank" rel="noopener noreferrer" class="hover:underline" :style="{ color: PRIMARY_BLUE }">{{ c.id }}</a>
                      <template v-else>{{ c.id }}</template>
                      <span v-if="c.fixed_in" class="text-gray-400"> · fixed in {{ c.fixed_in }}</span>
                    </span>
                    <span class="font-semibold shrink-0" :style="{ color: SEVERITY_COLOR[c.severity] || '#9CA3AF' }">
                      {{ c.severity || "Unknown" }}{{ c.is_kev ? " · known-exploited" : "" }}
                    </span>
                  </div>
                </div>
                <p v-else-if="a.vuln" class="mt-1 text-[10px]" :style="{ color: SUCCESS }">No known CVEs for this version.</p>
              </div>
              </div>
            </template>
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
            <p class="text-[11px] mt-2 mb-6 text-gray-400">This refreshes GPS data for the whole fleet (one Applivery API call per device), not just this one — it can take a moment.</p>

            <!--
              Location History — moved over from the Playground modal
              (DeviceInsightModal.vue). A different data source than the
              bulk lat/lng cache above (Applivery's own mdm/locations
              history API, real street/city/country addresses), kept
              alongside it rather than replacing it: the block above is
              instant (bulk-cached, fleet-wide) and answers "where is the
              whole fleet right now"; this one is per-device history with
              real addresses and an embedded map.

              `address` is a nested object ({ address, number, postalCode,
              city, country }), not a flat string, and a location ping's
              timestamp field is `date` — confirmed against Applivery's own
              OpenAPI schema for GET /mdm/locations/:type/:identifier.
            -->
            <div class="pt-4 border-t border-gray-100 dark:border-gray-800">
              <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Location History</p>
              <div v-if="loadingExtras" class="h-16 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
              <template v-else-if="locations.length">
                <div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 space-y-2 text-sm mb-2">
                  <div class="flex items-start gap-2 text-gray-900 dark:text-white">
                    <component :is="ICONS.MapPoint" :size="14" weight="Linear" class="text-gray-400 mt-0.5 shrink-0" />
                    <div class="min-w-0">
                      <p class="font-semibold">
                        {{ locations[0].address?.address || `${locations[0].city || ""} ${locations[0].country || ""}`.trim() || "Unknown address" }}
                        {{ locations[0].address?.number || "" }}
                      </p>
                      <p v-if="[locations[0].address?.postalCode, locations[0].address?.city, locations[0].address?.country].filter(Boolean).length" class="text-xs text-gray-400">
                        {{ [locations[0].address?.postalCode, locations[0].address?.city, locations[0].address?.country].filter(Boolean).join(", ") }}
                      </p>
                    </div>
                  </div>
                  <p v-if="locations[0].date" class="text-xs text-gray-400 flex items-center gap-1.5">
                    <component :is="ICONS.ClockCircle" :size="12" weight="Linear" /> {{ new Date(locations[0].date).toLocaleString() }}
                  </p>
                  <a
                    v-if="locations[0].latitude || locations[0].lat"
                    :href="`https://www.google.com/maps/search/?api=1&query=${locations[0].latitude ?? locations[0].lat},${locations[0].longitude ?? locations[0].lng}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1.5 text-xs font-medium"
                    :style="{ color: PRIMARY_BLUE }"
                  >
                    <component :is="ICONS.ArrowRightUp" :size="12" weight="Linear" /> Open in Google Maps
                  </a>
                </div>
                <iframe
                  v-if="locations[0].latitude || locations[0].lat"
                  class="w-full h-56 rounded-lg border border-gray-100 dark:border-gray-800"
                  :src="`https://www.openstreetmap.org/export/embed.html?bbox=${(locations[0].longitude ?? locations[0].lng) - 0.005}%2C${(locations[0].latitude ?? locations[0].lat) - 0.005}%2C${(locations[0].longitude ?? locations[0].lng) + 0.005}%2C${(locations[0].latitude ?? locations[0].lat) + 0.005}&marker=${locations[0].latitude ?? locations[0].lat}%2C${locations[0].longitude ?? locations[0].lng}`"
                />
                <button v-if="locations.length > 1" class="mt-2 flex items-center gap-1.5 text-xs font-medium" :style="{ color: PRIMARY_BLUE }" @click="showLocationHistory = !showLocationHistory">
                  <component :is="ICONS.ClockCircle" :size="12" weight="Linear" /> {{ showLocationHistory ? "Hide history" : `View earlier locations (${locations.length - 1})` }}
                </button>
                <div v-if="showLocationHistory" class="mt-2 space-y-1.5">
                  <div v-for="(loc, i) in locations.slice(1)" :key="i" class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-xs">
                    <span class="text-gray-700 dark:text-gray-200">{{ loc.address?.address || `${loc.city || ""} ${loc.country || ""}`.trim() || "Unknown address" }}</span>
                    <span class="text-gray-400 shrink-0 ml-2">{{ loc.date ? new Date(loc.date).toLocaleString() : "" }}</span>
                  </div>
                </div>
              </template>
              <p v-else class="text-xs text-gray-400">No location history available from Applivery for this device.</p>
            </div>
          </template>

          <template v-else-if="tab === 'agent'">
            <!-- On-demand only — Agent Logs/Trace are Applivery's per-device
                 diagnostic feed (GET /mdm/agent-logs, GET /mdm/agent-trace),
                 troubleshooting data rather than fleet/compliance state, so
                 this tab never fetches them live on its own. This button is
                 the only trigger; whatever it last retrieved stays visible
                 for reference (stored server-side, re-read on every modal
                 open) until fetched again. See devices.service.ts's
                 fetchDeviceAgentDiagnostics doc comment. -->
            <div class="flex items-center justify-between gap-2 mb-3">
              <div class="min-w-0">
                <p class="text-[10px] text-gray-400 truncate">
                  <template v-if="agentLogs?.fetchedAt || agentTrace?.fetchedAt">Last fetched {{ formatDate(agentLogs?.fetchedAt || agentTrace?.fetchedAt || null) }}</template>
                  <template v-else>Never fetched for this device.</template>
                </p>
              </div>
              <button
                :disabled="isFetchingAgentDiagnostics"
                class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 shrink-0"
                :style="{ backgroundColor: PRIMARY_BLUE }"
                title="Fetch this device's latest Agent Logs and Agent Trace from Applivery"
                @click="fetchAgentDiagnostics"
              >
                <component :is="ICONS.Refresh" :size="12" weight="Linear" :class="{ 'animate-spin': isFetchingAgentDiagnostics }" />
                {{ isFetchingAgentDiagnostics ? "Fetching…" : "Fetch Agent Logs & Trace" }}
              </button>
            </div>
            <p v-if="agentDiagnosticsError" class="text-xs px-3 py-2 rounded-lg mb-3" :style="{ backgroundColor: `${DANGER}10`, color: DANGER }">{{ agentDiagnosticsError }}</p>

            <template v-if="loadingExtras">
              <div class="h-16 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse mb-2" />
              <div class="h-16 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
            </template>
            <template v-else>
              <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Agent Logs</p>
              <div v-if="agentLogs?.items?.length" class="space-y-1.5 mb-5">
                <div v-for="(l, i) in agentLogs.items" :key="i" class="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                  <div class="flex items-center justify-between mb-1 gap-2">
                    <span class="text-xs font-semibold truncate text-gray-700 dark:text-gray-200">{{ logTitle(l) }}</span>
                    <span
                      v-if="logStatus(l)"
                      class="text-[10px] font-bold uppercase shrink-0 px-1.5 py-0.5 rounded"
                      :style="{
                        backgroundColor: `${/ERROR|FAIL|CRITICAL/i.test(logStatus(l)) ? DANGER : /WARN/i.test(logStatus(l)) ? WARNING : SUCCESS}15`,
                        color: /ERROR|FAIL|CRITICAL/i.test(logStatus(l)) ? DANGER : /WARN/i.test(logStatus(l)) ? WARNING : SUCCESS,
                      }"
                    >
                      {{ logStatus(l) }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-[10px] font-medium px-2 py-0.5 rounded-full" :style="{ backgroundColor: `${PRIMARY_BLUE}10`, color: PRIMARY_BLUE }">{{ device.platformLabel }} Agent</span>
                    <span class="text-[10px] font-mono text-gray-400">{{ l.createdAt ? formatDate(l.createdAt) : "" }}</span>
                  </div>
                  <!-- content/contentError/file are per the official Applivery
                       agent-logs schema (GET /mdm/agent-logs); logBody() also
                       falls back to message/output/description/detail, seen
                       in a reference third-party app's handling of the same
                       API (device_profile_sheet.dart) — some orgs' log
                       payloads apparently carry those instead of/alongside
                       content. contentError surfaces a parse/agent-side
                       failure distinct from the log itself; file is an
                       optional attached log blob (e.g. a full crash dump)
                       stored in Applivery's file store. -->
                  <p v-if="logBody(l)" class="text-xs font-mono break-all whitespace-pre-wrap text-gray-700 dark:text-gray-200">{{ logBody(l) }}</p>
                  <p v-if="l.contentError" class="text-xs font-mono break-all whitespace-pre-wrap mt-1.5" :style="{ color: DANGER }">{{ l.contentError }}</p>
                  <a
                    v-if="l.file?.location"
                    :href="l.file.location"
                    target="_blank"
                    rel="noopener"
                    class="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium"
                    :style="{ color: PRIMARY_BLUE }"
                  >
                    <component :is="ICONS.Case" :size="11" weight="Linear" />
                    {{ l.file.originalName || "Attachment" }}{{ l.file.size ? ` · ${(l.file.size / 1024).toFixed(0)} KB` : "" }}
                  </a>
                </div>
              </div>
              <p v-else class="text-xs text-gray-400 mb-5">{{ agentLogs ? "No agent logs for this device." : "Not fetched yet — click \"Fetch Agent Logs & Trace\" above." }}</p>

              <p class="text-[10px] font-semibold uppercase tracking-wider mb-2 text-gray-400">Agent Trace</p>
              <div v-if="agentTrace?.items?.length" class="space-y-1.5">
                <div v-for="(t, i) in agentTrace.items" :key="i" class="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                  <div class="flex items-center justify-between mb-1 gap-2">
                    <span class="text-xs font-semibold truncate text-gray-700 dark:text-gray-200">{{ traceTitle(t) }}</span>
                    <span v-if="t.event?.type" class="text-[10px] font-bold uppercase shrink-0 px-1.5 py-0.5 rounded" :style="{ backgroundColor: `${DANGER}15`, color: DANGER }">{{ t.event.type }}</span>
                  </div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-[10px] font-medium px-2 py-0.5 rounded-full" :style="{ backgroundColor: `${PRIMARY_BLUE}10`, color: PRIMARY_BLUE }">{{ device.platformLabel }} Agent</span>
                    <span class="text-[10px] font-mono text-gray-400">{{ t.createdAt ? formatDate(t.createdAt) : "" }}</span>
                  </div>
                  <p v-if="t.event?.content" class="text-xs font-mono break-all whitespace-pre-wrap text-gray-700 dark:text-gray-200">{{ t.event.content }}</p>
                </div>
              </div>
              <p v-else class="text-xs text-gray-400">{{ agentTrace ? "No agent trace events for this device." : "Not fetched yet — click \"Fetch Agent Logs & Trace\" above." }}</p>
            </template>
          </template>
        </div>
      </template>
    </div>

    <template v-if="device">
      <SegmentPickerModal v-if="activePicker === 'segment'" :open="true" :segments="store.segments as any" :current-segment-id="device.segmentId" @close="activePicker = null" @select="handleSegmentSelect" />
      <PolicyPickerModal v-if="activePicker === 'policy'" :open="true" :platform="platform" :exclude-ids="(device.activePolicies || []).map((p) => p.id)" @close="activePicker = null" @select="handleAddPolicy" />
      <TagEditorModal v-if="activePicker === 'tags'" :open="true" :initial-tags="device.tags || []" @close="activePicker = null" @save="handleSaveTags" />
    </template>

    <WorkflowPickerModal :open="isPickingWorkflow" @close="isPickingWorkflow = false" @confirm="handleRunWorkflow" />
    <WorkflowRunResultModal :open="!!runResult" :run="runResult" @close="runResult = null" @complete="() => store.fetchDevices(true)" />
  </template>
</template>
