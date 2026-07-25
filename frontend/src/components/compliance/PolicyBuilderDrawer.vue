<script setup lang="ts">
// Policy Builder — create/edit a Compliance Policy: name/severity/logic,
// a condition-row list built off GET /api/compliance/fields, MITRE
// technique suggestions/picker, and the autoRun/tag/workflow options.
// Port of the original app's PolicyBuilder modal (migration-plan.md Phase 3
// checkpoint: "Policy Builder ... functional").
import { Alert, Button, Drawer, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useComplianceStore, type CompliancePolicy, type ConditionRule } from "../../stores/compliance";

const props = defineProps<{
  open: boolean;
  policy: CompliancePolicy | null;
  prefillConditions?: ConditionRule[] | null;
  prefillName?: string | null;
  prefillFramework?: string | null;
  prefillControlRef?: string | null;
  prefillSeverity?: string | null;
  prefillConditionLogic?: "any" | "all" | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const store = useComplianceStore();

const severityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];
const logicOptions = [
  { value: "any", label: "Any condition matches" },
  { value: "all", label: "All conditions match" },
];
const operatorLabels: Record<string, string> = {
  equals: "equals", notEquals: "does not equal", contains: "contains",
  greaterThan: "greater than", lessThan: "less than", exists: "exists",
  missing: "is missing", includes: "includes",
};

const form = reactive({
  name: "",
  description: "",
  enabled: true,
  autoRun: false,
  severity: "medium" as "low" | "medium" | "high" | "critical",
  conditionLogic: "any" as "any" | "all",
  conditions: [] as ConditionRule[],
  workflowId: "",
  nonComplianceTag: "",
  nonComplianceSmartAttributeId: "",
  openCaseOnViolation: true,
  autoResolveCaseOnRecovery: false,
  mitreTechniques: [] as string[],
  framework: "",
  controlRef: "",
  autoRunBatchCap: 15 as number | undefined,
  autoRunDestructiveAck: false,
});

const isSaving = ref(false);
const saveError = ref<string | null>(null);
const suggestedTechniques = ref<Array<{ id: string; name: string; triggeredByFields?: string[] }>>([]);

const fieldOptions = computed(() => store.fields.map((f) => ({ value: f.key, label: f.label })));

function operatorsFor(fieldKey: string): string[] {
  return store.fields.find((f) => f.key === fieldKey)?.operators ?? ["equals"];
}

const KNOWN_SEVERITIES = ["low", "medium", "high", "critical"] as const;
function coerceSeverity(value: string | null | undefined): "low" | "medium" | "high" | "critical" {
  return (KNOWN_SEVERITIES as readonly string[]).includes(value ?? "") ? (value as any) : "medium";
}

function resetForm() {
  const p = props.policy;
  form.name = p?.name ?? props.prefillName ?? "";
  form.description = p?.description ?? "";
  form.enabled = p?.enabled ?? true;
  form.autoRun = p?.autoRun ?? false;
  form.severity = p?.severity ?? coerceSeverity(props.prefillSeverity);
  form.conditionLogic = p?.conditionLogic ?? props.prefillConditionLogic ?? "any";
  form.conditions = JSON.parse(JSON.stringify(p?.conditions ?? props.prefillConditions ?? []));
  form.workflowId = p?.workflowId ?? "";
  form.nonComplianceTag = p?.nonComplianceTag ?? "";
  form.nonComplianceSmartAttributeId = p?.nonComplianceSmartAttributeId ?? "";
  form.openCaseOnViolation = p?.openCaseOnViolation ?? true;
  form.autoResolveCaseOnRecovery = p?.autoResolveCaseOnRecovery ?? false;
  form.mitreTechniques = [...(p?.mitreTechniques ?? [])];
  form.framework = p?.framework ?? props.prefillFramework ?? "";
  form.controlRef = p?.controlRef ?? props.prefillControlRef ?? "";
  // `undefined` here is this form's own sentinel for "no limit" (the Input
  // component can't bind a bare `null`) — an existing policy's explicit
  // null (opted into "no limit") maps to it; a brand-new policy defaults to 15.
  form.autoRunBatchCap = p ? p.autoRunBatchCap ?? undefined : 15;
  form.autoRunDestructiveAck = p?.autoRunDestructiveAck ?? false;
  saveError.value = null;
}

watch(() => props.open, (open) => {
  if (open) resetForm();
});

onMounted(async () => {
  if (store.fields.length === 0) await store.fetchFields();
  if (store.mitreTechniques.length === 0) await store.fetchMitreTechniques();
});

function addCondition() {
  const defaultField = store.fields[0]?.key ?? "";
  form.conditions.push({ field: defaultField, operator: operatorsFor(defaultField)[0] ?? "equals", value: "" });
}

function removeCondition(idx: number) {
  form.conditions.splice(idx, 1);
}

function onFieldChange(idx: number) {
  const ops = operatorsFor(form.conditions[idx].field);
  if (!ops.includes(form.conditions[idx].operator)) form.conditions[idx].operator = ops[0] ?? "equals";
}

async function refreshSuggestions() {
  try {
    suggestedTechniques.value = await store.suggestMitreTechniques(form.conditions);
  } catch {
    suggestedTechniques.value = [];
  }
}

function acceptSuggestion(id: string) {
  if (!form.mitreTechniques.includes(id)) form.mitreTechniques.push(id);
}

function toggleTechnique(id: string) {
  const idx = form.mitreTechniques.indexOf(id);
  if (idx >= 0) form.mitreTechniques.splice(idx, 1);
  else form.mitreTechniques.push(id);
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    const payload = {
      name: form.name,
      description: form.description,
      enabled: form.enabled,
      autoRun: form.autoRun,
      severity: form.severity,
      conditionLogic: form.conditionLogic,
      conditions: form.conditions,
      workflowId: form.workflowId || null,
      nonComplianceTag: form.nonComplianceTag || null,
      nonComplianceSmartAttributeId: form.nonComplianceSmartAttributeId || null,
      openCaseOnViolation: form.openCaseOnViolation,
      autoResolveCaseOnRecovery: form.autoResolveCaseOnRecovery,
      mitreTechniques: form.mitreTechniques,
      framework: form.framework || null,
      controlRef: form.controlRef || null,
      // `undefined` is this form's own "no limit" sentinel (see resetForm) —
      // must be sent as an explicit `null`, not omitted, or the backend's
      // zod default (15) would silently override the admin's choice.
      autoRunBatchCap: form.autoRunBatchCap === undefined ? null : form.autoRunBatchCap,
      autoRunDestructiveAck: form.autoRunDestructiveAck,
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
</script>

<template>
  <Drawer :open="open" :title="policy ? `Edit “${policy.name}”` : 'New Compliance Policy'" width="w-[560px]" @close="emit('close')">
    <div class="space-y-6">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>

      <div class="space-y-3">
        <Input v-model="form.name" placeholder="Policy name" label="Name" />
        <Input v-model="form.description" placeholder="What does this policy check for?" label="Description" />
        <div class="grid grid-cols-2 gap-3">
          <Input v-model="form.severity" type="select" :options="severityOptions" label="Severity" />
          <Input v-model="form.conditionLogic" type="select" :options="logicOptions" label="Match logic" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" v-model="form.enabled" /> Enabled
          </label>
          <label class="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" v-model="form.autoRun" /> Auto-run linked workflow
          </label>
        </div>
      </div>

      <section>
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm font-semibold text-gray-900">Conditions</p>
          <Button size="sm" variant="secondary" @click="addCondition">Add condition</Button>
        </div>
        <div class="space-y-2">
          <div v-for="(cond, idx) in form.conditions" :key="idx" class="flex items-center gap-2 border border-gray-200 rounded-lg p-2">
            <Input :model-value="cond.field" type="select" :options="fieldOptions" class="flex-1" @update:model-value="cond.field = $event as string; onFieldChange(idx)" />
            <Input :model-value="cond.operator" type="select" :options="operatorsFor(cond.field).map((o) => ({ value: o, label: operatorLabels[o] ?? o }))" class="w-40" @update:model-value="cond.operator = $event as string" />
            <Input v-model="cond.value" placeholder="Value" class="flex-1" />
            <Button size="sm" variant="ghost" @click="removeCondition(idx)">✕</Button>
          </div>
          <p v-if="form.conditions.length === 0" class="text-xs text-gray-400">No conditions yet — this policy will never match a device.</p>
        </div>
      </section>

      <section>
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm font-semibold text-gray-900">MITRE ATT&amp;CK techniques</p>
          <Button size="sm" variant="ghost" @click="refreshSuggestions">Suggest from conditions</Button>
        </div>
        <div v-if="suggestedTechniques.length" class="flex flex-wrap gap-2 mb-2">
          <button
            v-for="t in suggestedTechniques"
            :key="t.id"
            type="button"
            class="text-xs px-2 py-1 rounded-full border border-brand-200 bg-brand-50 text-brand-700"
            @click="acceptSuggestion(t.id)"
          >
            + {{ t.id }} {{ t.name }}
          </button>
        </div>
        <div class="flex flex-wrap gap-2 max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2">
          <label v-for="t in store.mitreTechniques" :key="t.id" class="flex items-center gap-1 text-xs px-2 py-1">
            <input type="checkbox" :checked="form.mitreTechniques.includes(t.id)" @change="toggleTechnique(t.id)" />
            {{ t.id }} — {{ t.name }}
          </label>
        </div>
      </section>

      <section class="space-y-3">
        <p class="text-sm font-semibold text-gray-900">Response &amp; markers</p>
        <Input v-model="form.workflowId" placeholder="Workflow id (optional)" label="Linked workflow" />
        <div class="grid grid-cols-2 gap-3">
          <Input v-model="form.nonComplianceTag" placeholder="e.g. non-compliant-disk-encryption" label="Non-compliance tag" />
          <Input v-model="form.nonComplianceSmartAttributeId" placeholder="Smart Attribute id (optional)" label="Non-compliance Smart Attribute" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" v-model="form.openCaseOnViolation" /> Open a Case on violation
          </label>
          <label class="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" v-model="form.autoResolveCaseOnRecovery" /> Auto-resolve Case on recovery
          </label>
        </div>
        <div v-if="form.autoRun" class="grid grid-cols-2 gap-3">
          <div>
            <Input v-if="form.autoRunBatchCap !== undefined" v-model.number="form.autoRunBatchCap" type="number" placeholder="15" label="autoRun batch cap" />
            <label class="flex items-center gap-2 text-xs text-gray-600 mt-1">
              <input
                type="checkbox"
                :checked="form.autoRunBatchCap === undefined"
                @change="form.autoRunBatchCap = form.autoRunBatchCap === undefined ? 15 : undefined"
              />
              No limit (fire against every violating device in one pass)
            </label>
          </div>
          <label class="flex items-center gap-2 text-sm text-gray-700 mt-6">
            <input type="checkbox" v-model="form.autoRunDestructiveAck" /> Acknowledge destructive workflow
          </label>
        </div>
      </section>

      <section class="space-y-3">
        <p class="text-sm font-semibold text-gray-900">Framework tagging</p>
        <div class="grid grid-cols-2 gap-3">
          <Input v-model="form.framework" placeholder="iso27001 / ens / nis2" label="Framework" />
          <Input v-model="form.controlRef" placeholder="e.g. A.8.24" label="Control reference" />
        </div>
      </section>

      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" @click="save">{{ policy ? "Save changes" : "Create policy" }}</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Drawer>
</template>
