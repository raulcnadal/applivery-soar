<script setup lang="ts">
// Policy Builder — full port of PolicyBuilder.jsx (1033 lines): condition
// list with per-field-type value editors (ConditionRow.vue), autoRun safety
// limits (batch cap / no-limit, destructive-action acknowledgment with
// workflow-driven pre-fill, escalation to a tougher workflow above a risk
// threshold), evaluation frequency, "Then run" workflow picker, non-
// compliance tag/Smart Attribute markers, Case management toggles, MITRE
// ATT&CK tagging with condition-derived suggestions, "Apply to devices"
// (Device Audience) scoping with a live "devices that will receive this
// policy" preview, and a read-only framework/control badge for
// template-originated policies. Also includes the "Segment" field
// (PolicyBuilder.jsx:688-706) — administrative/visibility scope only, no
// device-targeting effect (docs/compliance.md) — which Segment owns this
// policy, matching whatever was selected in the Segments panel when
// "Create" was clicked; defaults to the currently-selected segment for new
// policies, an existing policy keeps its own assigned segment untouched.
import { Modal } from "@applivery/bluesky-vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useComplianceStore, type CompliancePolicy, type ConditionRule, type MatchedDevice, type MatchedDevicesDiagnostics } from "../../stores/compliance";
import { useDevicesStore } from "../../stores/devices";
import { useSegmentsStore } from "../../stores/segments";
import { useWorkflowsStore } from "../../stores/workflows";
import AudiencePickerField from "./AudiencePickerField.vue";
import ConditionRow from "./ConditionRow.vue";

const PRIMARY_BLUE = "#0241E3";
const DANGER = "#EF4444";
const WARNING = "#F59E0B";

const FRAMEWORK_SHORT_LABELS: Record<string, string> = { iso27001: "ISO 27001", ens: "ENS", nis2: "NIS2" };

const props = defineProps<{
  open: boolean;
  policy: CompliancePolicy | null;
  prefillConditions?: ConditionRule[] | null;
  prefillName?: string | null;
  prefillDescription?: string | null;
  prefillFramework?: string | null;
  prefillControlRef?: string | null;
  prefillSeverity?: string | null;
  prefillConditionLogic?: "any" | "all" | null;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const store = useComplianceStore();
const devicesStore = useDevicesStore();
const segmentsStore = useSegmentsStore();
const workflowsStore = useWorkflowsStore();

const form = reactive({
  name: "",
  description: "",
  enabled: true,
  autoRun: false,
  conditionLogic: "any" as "any" | "all",
  conditions: [] as ConditionRule[],
  workflowId: "",
  autoRunBatchCap: 15 as number | null,
  noBatchCap: false,
  autoRunDestructiveAck: false,
  escalatedWorkflowId: "",
  escalatedWorkflowMinRiskTier: "high",
  nonComplianceTag: "",
  nonComplianceSmartAttributeId: "",
  openCaseOnViolation: true,
  autoResolveCaseOnRecovery: false,
  mitreTechniques: [] as string[],
  targetDeviceAudienceId: "",
  segmentId: "0",
  evalUnit: "hours" as "minutes" | "hours",
  evalAmount: "" as string | number,
});

const templateFramework = ref<string | null>(null);
const templateControlRef = ref<string | null>(null);
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const suggestedTechniques = ref<Array<{ id: string; name: string; tactic?: string; triggeredByFields?: string[] }>>([]);
const matchedDevices = ref<MatchedDevice[] | null>(null);
const matchedDevicesLoading = ref(false);
const matchedDevicesError = ref<string | null>(null);
const matchedDevicesDiagnostics = ref<MatchedDevicesDiagnostics | null>(null);

function newConditionId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `cond-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultValueForType(type: string | undefined, options: string[] | undefined): any {
  if (type === "boolean") return true;
  if (type === "select") return options?.[0] || "";
  if (type === "number") return 0;
  if (type === "duration") return { amount: 1, unit: "days" };
  if (type === "smart_attribute" || type === "self_reported_attribute") return { name: "", compareValue: "" };
  if (type === "custom_field") return { path: "", compareValue: "" };
  return "";
}

function resetForm() {
  const p = props.policy;
  form.name = p?.name ?? props.prefillName ?? "";
  form.description = p?.description ?? props.prefillDescription ?? "";
  form.enabled = p?.enabled ?? true;
  form.autoRun = p?.autoRun ?? false;
  form.conditionLogic = (p?.conditionLogic ?? props.prefillConditionLogic ?? "any") as "any" | "all";
  form.conditions = JSON.parse(JSON.stringify((p?.conditions ?? props.prefillConditions ?? []).map((c) => ({ ...c, id: (c as any).id ?? newConditionId() }))));
  form.workflowId = p?.workflowId ?? "";
  form.autoRunBatchCap = p ? p.autoRunBatchCap ?? null : 15;
  form.noBatchCap = p ? p.autoRunBatchCap === null : false;
  form.autoRunDestructiveAck = p?.autoRunDestructiveAck ?? false;
  form.escalatedWorkflowId = p?.escalatedWorkflowId ?? "";
  form.escalatedWorkflowMinRiskTier = p?.escalatedWorkflowMinRiskTier ?? "high";
  form.nonComplianceTag = p?.nonComplianceTag ?? "";
  form.nonComplianceSmartAttributeId = p?.nonComplianceSmartAttributeId ?? "";
  form.openCaseOnViolation = p?.openCaseOnViolation ?? true;
  form.autoResolveCaseOnRecovery = p?.autoResolveCaseOnRecovery ?? false;
  form.mitreTechniques = [...(p?.mitreTechniques ?? [])];
  form.targetDeviceAudienceId = p?.targetDeviceAudienceId ?? "";
  // New policies are internally assigned to whichever Segment is selected in
  // the left-hand Segments panel at creation time (PolicyBuilder.jsx:336-345)
  // — editing an existing policy keeps its already-assigned segment untouched
  // unless explicitly changed below.
  form.segmentId = p?.segmentId != null ? String(p.segmentId) : String(segmentsStore.selectedSegment.id ?? 0);
  const initialMinutes = p?.evaluationIntervalMinutes ?? null;
  form.evalUnit = initialMinutes && initialMinutes % 60 === 0 ? "hours" : "minutes";
  form.evalAmount = initialMinutes == null ? "" : initialMinutes % 60 === 0 ? initialMinutes / 60 : initialMinutes;
  templateFramework.value = p?.framework ?? props.prefillFramework ?? null;
  templateControlRef.value = p?.controlRef ?? props.prefillControlRef ?? null;
  matchedDevices.value = null;
  matchedDevicesError.value = null;
  matchedDevicesDiagnostics.value = null;
  saveError.value = null;
}

watch(
  () => props.open,
  (open) => {
    if (open) resetForm();
  },
);

onMounted(async () => {
  await Promise.all([
    store.fields.length === 0 ? store.fetchFields() : Promise.resolve(),
    store.mitreTechniques.length === 0 ? store.fetchMitreTechniques() : Promise.resolve(),
    store.smartAttributeNames.length === 0 ? store.fetchSmartAttributeNames() : Promise.resolve(),
    store.selfReportedAttributeNames.length === 0 ? store.fetchSelfReportedAttributeNames() : Promise.resolve(),
    store.smartAttributes.length === 0 ? store.fetchSmartAttributes() : Promise.resolve(),
    store.appLists.length === 0 ? store.fetchAppLists() : Promise.resolve(),
    devicesStore.deviceTags.length === 0 ? devicesStore.fetchPickers() : Promise.resolve(),
    workflowsStore.workflows.length === 0 ? workflowsStore.fetchWorkflows() : Promise.resolve(),
    workflowsStore.mdmActions.length === 0 ? workflowsStore.fetchMdmActions() : Promise.resolve(),
  ]);
});

function addCondition() {
  const def = store.fields[0];
  if (!def) return;
  form.conditions.push({ field: def.key, operator: def.operators[0], value: defaultValueForType(def.type, def.options), id: newConditionId() } as any);
}
function updateCondition(idx: number, updated: ConditionRule) {
  form.conditions[idx] = { ...updated, id: (form.conditions[idx] as any).id } as any;
}
function removeCondition(idx: number) {
  form.conditions.splice(idx, 1);
}
function onAudienceCreated(a: { id: string; name: string }) {
  devicesStore.deviceAudiences.push(a as any);
}

let suggestTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => form.conditions,
  () => {
    if (suggestTimer) clearTimeout(suggestTimer);
    if (form.conditions.length === 0) {
      suggestedTechniques.value = [];
      return;
    }
    suggestTimer = setTimeout(async () => {
      try {
        suggestedTechniques.value = await store.suggestMitreTechniques(form.conditions);
      } catch {
        suggestedTechniques.value = [];
      }
    }, 400);
  },
  { deep: true },
);

watch(
  () => form.targetDeviceAudienceId,
  async (audienceId) => {
    if (!audienceId) {
      matchedDevices.value = null;
      matchedDevicesError.value = null;
      matchedDevicesDiagnostics.value = null;
      return;
    }
    matchedDevicesLoading.value = true;
    matchedDevicesError.value = null;
    try {
      const res = await store.fetchMatchedDevices(audienceId);
      matchedDevices.value = res.items;
      matchedDevicesDiagnostics.value = res.diagnostics;
    } catch {
      matchedDevicesError.value = "Could not load matched devices.";
    } finally {
      matchedDevicesLoading.value = false;
    }
  },
);

function acceptSuggestion(id: string) {
  if (!form.mitreTechniques.includes(id)) form.mitreTechniques.push(id);
}
function toggleTechnique(id: string) {
  const idx = form.mitreTechniques.indexOf(id);
  if (idx >= 0) form.mitreTechniques.splice(idx, 1);
  else form.mitreTechniques.push(id);
}

const mdmActionsByKey = computed(() => Object.fromEntries(workflowsStore.mdmActions.map((a) => [a.key, a])));
function workflowIsDestructive(wf: any): boolean {
  return !!wf && (wf.steps || []).some((s: any) => s.type === "mdm_action" && mdmActionsByKey.value[s.config?.action]?.destructive);
}
const selectedWorkflow = computed(() => workflowsStore.workflows.find((w) => w.id === form.workflowId));
const selectedEscalatedWorkflow = computed(() => workflowsStore.workflows.find((w) => w.id === form.escalatedWorkflowId));
const isDestructiveWorkflow = computed(() => workflowIsDestructive(selectedWorkflow.value));
const isDestructiveEscalatedWorkflow = computed(() => workflowIsDestructive(selectedEscalatedWorkflow.value));
const destructiveWorkflowName = computed(() => (isDestructiveWorkflow.value ? selectedWorkflow.value?.name : isDestructiveEscalatedWorkflow.value ? selectedEscalatedWorkflow.value?.name : null));

function onWorkflowChange(id: string) {
  const picked = workflowsStore.workflows.find((w) => w.id === id);
  form.workflowId = id;
  form.autoRunDestructiveAck = !!(picked as any)?.allowUnattendedDestructive;
}

async function save() {
  saveError.value = null;
  if (!form.name.trim()) {
    saveError.value = "Give this policy a name.";
    return;
  }
  if (form.conditions.length === 0) {
    saveError.value = "Add at least one condition to watch.";
    return;
  }
  if (!form.workflowId) {
    saveError.value = "Link a workflow to run when this policy is violated.";
    return;
  }
  if (form.autoRun && (isDestructiveWorkflow.value || isDestructiveEscalatedWorkflow.value) && !form.autoRunDestructiveAck) {
    saveError.value = `"${destructiveWorkflowName.value}" includes a destructive action — check the acknowledgment below to enable autoRun with it.`;
    return;
  }

  let evaluationIntervalMinutes: number | null = null;
  if (form.evalAmount !== "") {
    const minutes = Math.round(Number(form.evalAmount) * (form.evalUnit === "hours" ? 60 : 1));
    if (!Number.isFinite(minutes) || minutes < 60 || minutes > 1440) {
      saveError.value = "Evaluation frequency must be between 1 hour and 24 hours.";
      return;
    }
    evaluationIntervalMinutes = minutes;
  }

  isSaving.value = true;
  try {
    const payload = {
      name: form.name,
      description: form.description,
      enabled: form.enabled,
      autoRun: form.autoRun,
      conditionLogic: form.conditionLogic,
      conditions: form.conditions.map(({ field, operator, value }) => ({ field, operator, value })),
      workflowId: form.workflowId,
      autoRunBatchCap: form.noBatchCap ? null : Number.isFinite(Number(form.autoRunBatchCap)) && Number(form.autoRunBatchCap) > 0 ? Number(form.autoRunBatchCap) : 15,
      autoRunDestructiveAck: form.autoRunDestructiveAck,
      escalatedWorkflowId: form.escalatedWorkflowId || null,
      escalatedWorkflowMinRiskTier: form.escalatedWorkflowMinRiskTier,
      nonComplianceTag: form.nonComplianceTag.trim() || null,
      nonComplianceSmartAttributeId: form.nonComplianceSmartAttributeId || null,
      openCaseOnViolation: form.openCaseOnViolation,
      autoResolveCaseOnRecovery: form.autoResolveCaseOnRecovery,
      mitreTechniques: form.mitreTechniques,
      targetDeviceAudienceId: form.targetDeviceAudienceId || null,
      segmentId: form.segmentId,
      evaluationIntervalMinutes,
      framework: templateFramework.value,
      controlRef: templateControlRef.value,
      severity: (props.policy?.severity ?? props.prefillSeverity ?? "medium") as any,
    };
    if (props.policy) {
      await store.updatePolicy(props.policy.id, payload);
    } else {
      await store.createPolicy(payload);
    }
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save policy.";
  } finally {
    isSaving.value = false;
  }
}

const unsuggested = computed(() => suggestedTechniques.value.filter((t) => !form.mitreTechniques.includes(t.id)));
</script>

<template>
  <Modal :open="open" size="lg" class="max-w-2xl" @close="emit('close')">
    <div class="flex items-center justify-between gap-2 mb-4 -mt-1">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ policy ? "Edit Compliance Policy" : "Create Compliance Policy" }}</span>
        <span v-if="templateFramework" class="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
          {{ FRAMEWORK_SHORT_LABELS[templateFramework] || templateFramework }}{{ templateControlRef ? ` — ${templateControlRef}` : "" }}
        </span>
      </div>
      <button class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 shrink-0" @click="emit('close')">
        <component :is="ICONS.CloseCircle" :size="18" weight="Linear" />
      </button>
    </div>

    <div class="max-h-[65vh] overflow-y-auto pr-1">
      <div v-if="saveError" class="mb-4 px-3 py-2 rounded-lg text-xs font-medium border" :style="{ backgroundColor: `${DANGER}12`, color: DANGER, borderColor: `${DANGER}30` }">{{ saveError }}</div>

      <div class="space-y-2 mb-5">
        <input v-model="form.name" placeholder="Policy name, e.g. Stale or non-compliant devices" class="w-full px-3 py-2 rounded-lg text-sm font-medium outline-none border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500" />
        <textarea v-model="form.description" placeholder="Description (optional)" rows="2" class="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500" />
      </div>

      <div v-if="policy?.autoRunTripped" class="flex items-start gap-2.5 px-3 py-2.5 rounded-lg mb-4 border" :style="{ backgroundColor: `${DANGER}10`, borderColor: `${DANGER}30` }">
        <component :is="ICONS.DangerTriangle" :size="15" weight="Linear" class="shrink-0 mt-0.5" :style="{ color: DANGER }" />
        <div>
          <p class="text-xs font-semibold" :style="{ color: DANGER }">autoRun is currently tripped</p>
          <p class="text-[11px] mt-0.5 leading-relaxed text-gray-400">{{ policy.autoRunTrippedReason || "Repeated failures paused autoRun for this policy." }} Saving this policy will re-arm autoRun.</p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 mb-5">
        <label class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer border border-gray-200 dark:border-gray-700">
          <input v-model="form.enabled" type="checkbox" /> <span class="text-gray-900 dark:text-white">Enabled</span>
        </label>
        <label class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer border border-gray-200 dark:border-gray-700">
          <input v-model="form.autoRun" type="checkbox" /> <span class="text-gray-900 dark:text-white">Auto-run workflow (skip review queue)</span>
        </label>
      </div>

      <div v-if="form.autoRun" class="mb-5 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 text-gray-400">autoRun safety limits</p>
        <label class="block text-xs mb-1 text-gray-900 dark:text-white">Max devices auto-fired per evaluation pass</label>
        <div class="flex items-center gap-3 flex-wrap">
          <input v-model.number="form.autoRunBatchCap" type="number" min="1" max="1000" :disabled="form.noBatchCap" class="w-28 px-3 py-1.5 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 disabled:opacity-40 focus:ring-2 focus:ring-brand-500" />
          <label class="flex items-center gap-2 text-xs font-medium cursor-pointer text-gray-900 dark:text-white">
            <input v-model="form.noBatchCap" type="checkbox" /> No limit
          </label>
        </div>
        <p class="text-[11px] mt-1.5 leading-relaxed text-gray-400">
          {{
            form.noBatchCap
              ? "Every violating device in a pass fires unattended, with no cap and nothing queued for review — only turn this on for a workflow you'd be comfortable running against the whole fleet at once."
              : "If more than this many devices violate in a single pass, the rest are queued for manual review instead of firing unattended."
          }}
        </p>
        <div v-if="form.noBatchCap" class="flex items-start gap-2 px-2.5 py-2 rounded-lg mt-2 border" :style="{ backgroundColor: `${WARNING}12`, borderColor: `${WARNING}30` }">
          <component :is="ICONS.DangerTriangle" :size="13" weight="Linear" class="shrink-0 mt-0.5" :style="{ color: WARNING }" />
          <p class="text-[11px] leading-relaxed text-gray-400">A bad condition, a stale sync, or an entire Device Audience flipping non-compliant at once will now fire this policy's workflow against every one of them in the same pass, unattended.</p>
        </div>

        <div v-if="isDestructiveWorkflow || isDestructiveEscalatedWorkflow" class="flex items-start gap-2.5 px-3 py-2.5 rounded-lg mt-3 border" :style="{ backgroundColor: `${DANGER}10`, borderColor: `${DANGER}30` }">
          <component :is="ICONS.DangerTriangle" :size="15" weight="Linear" class="shrink-0 mt-0.5" :style="{ color: DANGER }" />
          <div class="flex-1">
            <p class="text-xs font-semibold" :style="{ color: DANGER }">"{{ destructiveWorkflowName }}" includes a destructive action</p>
            <p class="text-[11px] mt-0.5 mb-2 leading-relaxed text-gray-400">Enabling autoRun means this fires unattended against every violating device (or every escalated one), with no human review, the moment they're detected.</p>
            <label class="flex items-center gap-2 text-xs font-medium cursor-pointer text-gray-900 dark:text-white">
              <input v-model="form.autoRunDestructiveAck" type="checkbox" /> I understand and want autoRun to fire this unattended
            </label>
          </div>
        </div>

        <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <p class="text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-gray-400">Escalate on high-risk devices (optional)</p>
          <p class="text-[11px] mb-2 leading-relaxed text-gray-400">Run a different, tougher workflow instead of the one above when the violating device's own risk tier is already at or above the threshold.</p>
          <div class="grid grid-cols-2 gap-2">
            <select v-model="form.escalatedWorkflowId" class="w-full px-3 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500">
              <option value="">No escalation — always run the default workflow</option>
              <option v-for="w in workflowsStore.workflows.filter((w) => w.id !== form.workflowId)" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
            <select v-if="form.escalatedWorkflowId" v-model="form.escalatedWorkflowMinRiskTier" class="w-full px-3 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500">
              <option value="medium">At risk tier: Medium or above</option>
              <option value="high">At risk tier: High or above</option>
              <option value="critical">At risk tier: Critical only</option>
            </select>
          </div>
        </div>
      </div>

      <div class="mb-5">
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 text-gray-400">
          <component :is="ICONS.Layers" :size="12" weight="Linear" /> Segment
        </p>
        <select v-model="form.segmentId" class="w-full px-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500">
          <option value="0">Global</option>
          <option v-for="s in devicesStore.segments" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
        </select>
        <p class="text-[11px] mt-1.5 leading-relaxed text-gray-400">
          Which Segment owns this policy administratively — matches whatever was selected in the segment panel when you clicked "Create". This doesn't by itself limit which devices are checked; use "Apply to devices" further down for that.
        </p>
      </div>

      <div class="mb-5">
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 text-gray-400">
          <component :is="ICONS.ClockCircle" :size="12" weight="Linear" /> Evaluation frequency
        </p>
        <div class="flex items-center gap-2">
          <input v-model="form.evalAmount" type="number" min="1" placeholder="Default" class="w-28 px-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500" />
          <select v-model="form.evalUnit" class="px-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500">
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
          </select>
          <button v-if="form.evalAmount !== ''" class="text-xs font-medium text-gray-400" @click="form.evalAmount = ''">Reset to default</button>
        </div>
        <p class="text-[11px] mt-1.5 leading-relaxed text-gray-400">
          How often the background scheduler automatically re-checks this policy. Leave blank to use the org default (60 minutes). Must be between 1 hour and 24 hours. "Evaluate now" always runs immediately regardless of this setting.
        </p>
      </div>

      <div class="flex items-center justify-between mb-2">
        <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">Watch for</p>
        <div class="flex items-center gap-2">
          <select v-model="form.conditionLogic" class="px-2 py-1 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500">
            <option value="any">Match ANY condition</option>
            <option value="all">Match ALL conditions</option>
          </select>
          <button class="inline-flex items-center gap-1 text-xs font-medium" :style="{ color: PRIMARY_BLUE }" @click="addCondition">
            <component :is="ICONS.AddSquare" :size="12" weight="Linear" /> Add condition
          </button>
        </div>
      </div>

      <p v-if="form.conditions.length === 0" class="text-xs text-center py-8 text-gray-400">No conditions yet — add one to define what "out of compliance" means.</p>

      <ConditionRow
        v-for="(c, i) in form.conditions"
        :key="(c as any).id ?? i"
        :condition="c"
        :fields-catalog="store.fields"
        :smart-attribute-names="store.smartAttributeNames"
        :self-reported-attribute-names="store.selfReportedAttributeNames"
        :app-lists="store.appLists"
        :device-audiences="devicesStore.deviceAudiences as any"
        :device-tags="devicesStore.deviceTags"
        :segments="devicesStore.segments as any"
        @change="(updated) => updateCondition(i, updated)"
        @remove="removeCondition(i)"
        @audience-created="onAudienceCreated"
      />

      <div class="mt-5">
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 text-gray-400">Then run</p>
        <select :value="form.workflowId" class="w-full px-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500" @change="onWorkflowChange(($event.target as HTMLSelectElement).value)">
          <option value="">Select a workflow…</option>
          <option v-for="w in workflowsStore.workflows" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
        <p v-if="workflowsStore.workflows.length === 0" class="text-xs mt-1 text-gray-400">No workflows yet — create one from the Workflows tab first.</p>
      </div>

      <div class="mt-5">
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 text-gray-400">Mark on Applivery console</p>
        <div class="relative">
          <component :is="ICONS.Tag" :size="13" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
          <input v-model="form.nonComplianceTag" placeholder="Tag applied while violated, e.g. non-compliant:stale-os (optional)" class="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500" />
        </div>
        <p class="text-[11px] mt-1.5 mb-3 leading-relaxed text-gray-400">Tag applied to a device the moment this policy is newly violated, removed automatically once it recovers.</p>

        <select v-model="form.nonComplianceSmartAttributeId" class="w-full px-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500">
          <option value="">{{ store.smartAttributes.length ? "No Smart Attribute (optional)" : "No Smart Attributes found" }}</option>
          <option v-for="a in store.smartAttributes" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <p class="text-[11px] mt-1.5 leading-relaxed text-gray-400">
          Create the Smart Attribute once in Applivery, then pick it here. We attach it to the device while this policy is violated and detach it on recovery. Tag and Smart Attribute are independent — use either, both, or neither.
        </p>
      </div>

      <div class="mt-5">
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 text-gray-400">
          <component :is="ICONS.Folder" :size="12" weight="Linear" /> Case Management
        </p>
        <div class="space-y-2">
          <label class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer border border-gray-200 dark:border-gray-700">
            <input v-model="form.openCaseOnViolation" type="checkbox" /> <span class="text-gray-900 dark:text-white">Open a Case when this policy is violated</span>
          </label>
          <label class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer border border-gray-200 dark:border-gray-700" :class="!form.openCaseOnViolation ? 'opacity-50' : ''">
            <input v-model="form.autoResolveCaseOnRecovery" type="checkbox" :disabled="!form.openCaseOnViolation" /> <span class="text-gray-900 dark:text-white">Auto-resolve the Case once the device recovers</span>
          </label>
        </div>
      </div>

      <div class="mt-5">
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 text-gray-400">MITRE ATT&amp;CK Tagging</p>
        <div v-if="unsuggested.length > 0" class="mb-2 p-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <p class="text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-gray-400">Suggested from your conditions</p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="t in unsuggested"
              :key="t.id"
              type="button"
              :title="`Suggested because of: ${t.triggeredByFields?.join(', ')}`"
              class="inline-flex items-center gap-1 rounded-full font-semibold text-[10px] px-2 py-1 transition-colors"
              :style="{ backgroundColor: `${PRIMARY_BLUE}15`, color: PRIMARY_BLUE }"
              @click="acceptSuggestion(t.id)"
            >
              <component :is="ICONS.AddSquare" :size="10" weight="Linear" /> {{ t.id }} · {{ t.name }}
            </button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 max-h-32 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2">
          <label v-for="t in store.mitreTechniques" :key="t.id" class="flex items-center gap-1 text-xs px-2 py-1">
            <input type="checkbox" :checked="form.mitreTechniques.includes(t.id)" @change="toggleTechnique(t.id)" />
            {{ t.id }} — {{ t.name }}
          </label>
        </div>
        <p class="text-[11px] mt-1.5 leading-relaxed text-gray-400">Classify what this policy detects against the ATT&amp;CK Enterprise matrix — carried onto every Case this policy opens, purely for triage/reporting.</p>
      </div>

      <div class="mt-5">
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 text-gray-400">
          <component :is="ICONS.UsersGroupRounded" :size="12" weight="Linear" /> Apply to devices
        </p>
        <AudiencePickerField :value="form.targetDeviceAudienceId" :audiences="devicesStore.deviceAudiences as any" @select="(id) => (form.targetDeviceAudienceId = id)" @created="onAudienceCreated" />
        <p class="text-[11px] mt-1.5 leading-relaxed text-gray-400">Leave blank to evaluate this policy against every device in the fleet. Pick a Device Audience to scope it — membership is re-resolved every run.</p>
      </div>

      <div class="mt-5">
        <p class="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 text-gray-400">
          <component :is="ICONS.Layers" :size="12" weight="Linear" /> Devices that will receive this policy
        </p>
        <div v-if="!form.targetDeviceAudienceId" class="rounded-lg px-3 py-2.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-400">
          No Device Audience selected above — this policy applies to every device in the fleet.
        </div>
        <div v-else-if="matchedDevicesLoading" class="rounded-lg px-3 py-2.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-400">Checking which devices currently belong to this audience…</div>
        <div v-else-if="matchedDevicesError" class="rounded-lg px-3 py-2.5 text-xs border" :style="{ borderColor: `${DANGER}40`, backgroundColor: `${DANGER}10`, color: DANGER }">{{ matchedDevicesError }}</div>
        <div v-else-if="matchedDevices" class="rounded-lg border" :style="{ borderColor: matchedDevices.length === 0 ? `${WARNING}60` : '#E5E7EB' }">
          <div class="px-3 py-2 flex items-center justify-between" :class="matchedDevices.length ? 'border-b border-gray-200 dark:border-gray-700' : ''">
            <span class="text-xs font-semibold" :style="{ color: matchedDevices.length === 0 ? WARNING : 'var(--foreground)' }">
              {{ matchedDevices.length === 0 ? "No devices currently match this audience" : `${matchedDevices.length} device${matchedDevices.length === 1 ? "" : "s"} match this audience right now` }}
            </span>
          </div>
          <div v-if="matchedDevices.length === 0" class="px-3 pb-2.5">
            <p class="text-[11px] leading-relaxed text-gray-400">This policy will have nothing to evaluate until a device matches. Double-check the audience's selectors in Applivery, or pick a different audience above.</p>
            <div v-if="matchedDevicesDiagnostics" class="mt-2 rounded-md px-2.5 py-2 text-[11px] leading-relaxed bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
              <p class="font-semibold mb-1 text-gray-900 dark:text-white">What Applivery's API returned just now</p>
              <p v-if="matchedDevicesDiagnostics.error" style="color: #ef4444">
                HTTP {{ matchedDevicesDiagnostics.httpStatus ?? "error" }} — {{ matchedDevicesDiagnostics.error }}
                {{ matchedDevicesDiagnostics.httpStatus === 401 || matchedDevicesDiagnostics.httpStatus === 403 ? " — likely a permissions issue on the API token." : "" }}
              </p>
              <template v-else-if="(matchedDevicesDiagnostics.rawMemberCount ?? 0) > 0">
                <p :style="{ color: WARNING }">
                  Applivery returned {{ matchedDevicesDiagnostics.rawMemberCount }} raw member(s) for this audience, but none matched a known device — this points at an id-resolution bug, not a misconfigured audience.
                </p>
                <ul class="mt-1 space-y-0.5">
                  <li v-for="m in (matchedDevicesDiagnostics.rawMembers || []).slice(0, 5)" :key="m.id" class="text-gray-400">
                    {{ m.displayName || m.id }} <span class="font-mono">({{ m.platformKey }}: {{ m.id }})</span>
                  </li>
                </ul>
              </template>
              <p v-else class="text-gray-400">Applivery returned zero members for this audience right now — the audience itself currently matches nothing on Applivery's side.</p>
            </div>
          </div>
          <div v-else class="max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            <div v-for="d in matchedDevices" :key="d.id" class="px-3 py-1.5 flex items-center justify-between gap-2 text-xs">
              <span class="truncate text-gray-900 dark:text-white">{{ d.displayName || d.id }}</span>
              <span class="flex items-center gap-1.5 shrink-0">
                <span class="text-[10px] text-gray-400">{{ d.platformLabel }}</span>
                <span class="w-1.5 h-1.5 rounded-full shrink-0" :title="d.isCompliant ? 'Compliant' : 'Not compliant'" :style="{ backgroundColor: d.isCompliant ? '#22C55E' : DANGER }" />
              </span>
            </div>
          </div>
        </div>
        <p class="text-[11px] mt-1.5 leading-relaxed text-gray-400">Confirms the "Apply to devices" audience above actually resolves to real devices, refreshed live each time you change the audience.</p>
      </div>
    </div>

    <div class="flex gap-3 justify-end pt-4 border-t border-gray-100 dark:border-gray-800 mt-4">
      <button class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="emit('close')">Cancel</button>
      <button :disabled="isSaving" class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50" @click="save">
        {{ isSaving ? "Saving…" : "Save policy" }}
      </button>
    </div>
  </Modal>
</template>
