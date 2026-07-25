<script setup lang="ts">
// Workflow Builder — name/target platform + deployment model, the
// escalation step chain (with onSuccess/onFailure branching), and the
// Recovery gate (linked Compliance Policy + a linear cleanup step list).
import { Alert, Button, Drawer, Input } from "@applivery/bluesky-vue";
import { reactive, ref, watch } from "vue";
import { useComplianceStore } from "../../stores/compliance";
import { useWorkflowsStore, type Workflow, type WorkflowStep } from "../../stores/workflows";
import WorkflowStepEditor from "./WorkflowStepEditor.vue";

const props = defineProps<{
  open: boolean;
  workflow: Workflow | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const store = useWorkflowsStore();
const complianceStore = useComplianceStore();

const PLATFORM_OPTIONS = [
  { value: "", label: "Any platform" },
  { value: "apple", label: "iOS/iPadOS (Apple)" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
];
const DEPLOYMENT_MODELS: Record<string, Array<{ value: string; label: string }>> = {
  apple: [{ value: "supervised", label: "Supervised" }, { value: "unsupervised", label: "Unsupervised" }],
  macos: [{ value: "supervised", label: "Supervised" }, { value: "unsupervised", label: "Unsupervised" }],
  android: [
    { value: "work_profile", label: "Work Profile (BYOD)" },
    { value: "cope", label: "Corporate-Owned, Personally Enabled (COPE)" },
    { value: "device_owner", label: "Device Owner (Fully Managed)" },
  ],
};

function newStep(): WorkflowStep {
  return { id: crypto.randomUUID(), type: "mdm_action", name: "New step", config: {}, onSuccess: null, onFailure: "end" };
}

const form = reactive<{
  name: string;
  description: string;
  targetPlatform: string;
  targetDeploymentModel: string;
  steps: WorkflowStep[];
  recoveryEnabled: boolean;
  recoveryCompliancePolicyId: string;
  recoverySteps: WorkflowStep[];
  allowUnattendedDestructive: boolean;
}>({
  name: "",
  description: "",
  targetPlatform: "",
  targetDeploymentModel: "",
  steps: [],
  recoveryEnabled: false,
  recoveryCompliancePolicyId: "",
  recoverySteps: [],
  allowUnattendedDestructive: false,
});

const isSaving = ref(false);
const saveError = ref<string | null>(null);

function resetForm() {
  const w = props.workflow;
  form.name = w?.name ?? "";
  form.description = w?.description ?? "";
  form.targetPlatform = w?.targetPlatform ?? "";
  form.targetDeploymentModel = w?.targetDeploymentModel ?? "";
  form.steps = JSON.parse(JSON.stringify(w?.steps ?? []));
  form.recoveryEnabled = w?.recovery?.enabled ?? false;
  form.recoveryCompliancePolicyId = w?.recovery?.compliancePolicyId ?? "";
  form.recoverySteps = JSON.parse(JSON.stringify(w?.recovery?.steps ?? []));
  form.allowUnattendedDestructive = w?.allowUnattendedDestructive ?? false;
  saveError.value = null;
}

watch(() => props.open, async (open) => {
  if (!open) return;
  resetForm();
  if (store.mdmActions.length === 0) await store.fetchMdmActions();
  if (complianceStore.policies.length === 0) await complianceStore.fetchPolicies();
});

function addStep() {
  form.steps.push(newStep());
}
function removeStep(idx: number) {
  form.steps.splice(idx, 1);
}
function moveStep(idx: number, dir: -1 | 1) {
  const target = idx + dir;
  if (target < 0 || target >= form.steps.length) return;
  const [s] = form.steps.splice(idx, 1);
  form.steps.splice(target, 0, s);
}

function addRecoveryStep() {
  form.recoverySteps.push(newStep());
}
function removeRecoveryStep(idx: number) {
  form.recoverySteps.splice(idx, 1);
}
function moveRecoveryStep(idx: number, dir: -1 | 1) {
  const target = idx + dir;
  if (target < 0 || target >= form.recoverySteps.length) return;
  const [s] = form.recoverySteps.splice(idx, 1);
  form.recoverySteps.splice(target, 0, s);
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    const payload = {
      name: form.name,
      description: form.description,
      targetPlatform: form.targetPlatform || null,
      targetDeploymentModel: form.targetDeploymentModel || null,
      steps: form.steps,
      recovery: {
        enabled: form.recoveryEnabled,
        compliancePolicyId: form.recoveryCompliancePolicyId || null,
        steps: form.recoverySteps,
      },
      allowUnattendedDestructive: form.allowUnattendedDestructive,
    };
    if (props.workflow) {
      await store.updateWorkflow(props.workflow.id, payload);
    } else {
      await store.createWorkflow(payload);
    }
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save workflow.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Drawer :open="open" :title="workflow ? `Edit “${workflow.name}”` : 'New Workflow'" width="w-[720px]" @close="emit('close')">
    <div class="space-y-6">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>

      <div class="space-y-3">
        <Input v-model="form.name" placeholder="Workflow name" label="Name" />
        <Input v-model="form.description" placeholder="What does this workflow do?" label="Description" />
        <div class="grid grid-cols-2 gap-3">
          <Input
            :model-value="form.targetPlatform"
            type="select"
            :options="PLATFORM_OPTIONS"
            label="Target platform"
            @update:model-value="form.targetPlatform = $event as string; form.targetDeploymentModel = ''"
          />
          <Input
            v-if="DEPLOYMENT_MODELS[form.targetPlatform]"
            v-model="form.targetDeploymentModel"
            type="select"
            :options="[{ value: '', label: 'Any deployment model' }, ...DEPLOYMENT_MODELS[form.targetPlatform]]"
            label="Deployment model"
          />
        </div>
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" v-model="form.allowUnattendedDestructive" /> Author intends this workflow to be safe for unattended (autoRun) use, even though it may contain a destructive step
        </label>
      </div>

      <section>
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm font-semibold text-gray-900">Steps</p>
          <Button size="sm" variant="secondary" @click="addStep">Add step</Button>
        </div>
        <div class="space-y-2">
          <WorkflowStepEditor
            v-for="(step, idx) in form.steps"
            :key="step.id"
            :step="step"
            :step-index="idx"
            :all-steps="form.steps"
            :target-platform="form.targetPlatform"
            show-branching
            @remove="removeStep(idx)"
            @move-up="moveStep(idx, -1)"
            @move-down="moveStep(idx, 1)"
          />
          <p v-if="form.steps.length === 0" class="text-xs text-gray-400">No steps yet — add at least one to make this workflow do something.</p>
        </div>
      </section>

      <section class="space-y-3 border-t border-gray-200 pt-4">
        <label class="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <input type="checkbox" v-model="form.recoveryEnabled" /> Recovery gate
        </label>
        <p class="text-xs text-gray-500">Checked before every escalation step. The moment the linked Compliance Policy is no longer violated, escalation stops and these cleanup steps run instead.</p>
        <template v-if="form.recoveryEnabled">
          <Input
            :model-value="form.recoveryCompliancePolicyId"
            type="select"
            :options="complianceStore.policies.map((p) => ({ value: p.id, label: p.name }))"
            label="Linked compliance policy"
            @update:model-value="form.recoveryCompliancePolicyId = $event as string"
          />
          <div class="flex items-center justify-between">
            <p class="text-xs font-semibold text-gray-700">Recovery steps (run linearly, no branching)</p>
            <Button size="sm" variant="ghost" @click="addRecoveryStep">Add step</Button>
          </div>
          <div class="space-y-2">
            <WorkflowStepEditor
              v-for="(step, idx) in form.recoverySteps"
              :key="step.id"
              :step="step"
              :step-index="idx"
              :all-steps="form.recoverySteps"
              :target-platform="form.targetPlatform"
              @remove="removeRecoveryStep(idx)"
              @move-up="moveRecoveryStep(idx, -1)"
              @move-down="moveRecoveryStep(idx, 1)"
            />
          </div>
        </template>
      </section>

      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" @click="save">{{ workflow ? "Save changes" : "Create workflow" }}</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Drawer>
</template>
