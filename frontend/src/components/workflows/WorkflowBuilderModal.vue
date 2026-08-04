<script setup lang="ts">
// Workflow Builder — a 2-screen wizard (Details, then Steps & Recovery),
// centered modal. Port of WorkflowBuilder.jsx (1030 lines): was a side
// Drawer with everything on one screen; the original locks platform +
// deployment model in on screen 1 (screen 2 = 'steps', reached straight
// away when editing since the target is already set) specifically so an
// admin can't add step 1 under iOS Supervised then quietly switch to a
// different platform before adding step 2 — every mdm_action step (main
// chain AND recovery) gets its action cleared the moment the target
// changes and is no longer compatible (reconcileStepsForTarget).
import { computed, reactive, ref, watch } from "vue";
import { Alert, Button } from "@applivery/bluesky-vue";
import { ICONS } from "../../lib/solarIcons";
import { useActionLibraryStore } from "../../stores/actionLibrary";
import { useComplianceStore } from "../../stores/compliance";
import { useWorkflowsStore, type MdmActionDef, type Workflow, type WorkflowStep } from "../../stores/workflows";
import WorkflowStepEditor from "./WorkflowStepEditor.vue";

const PRIMARY_BLUE = "#0241E3";
const WARNING = "#F59E0B";

const props = defineProps<{ open: boolean; workflow: Workflow | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useWorkflowsStore();
const complianceStore = useComplianceStore();
const actionLibraryStore = useActionLibraryStore();
const actionLibraryEntries = computed(() => actionLibraryStore.entries);

const PLATFORM_OPTIONS = [
  { value: "apple", label: "iOS" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
  { value: "aosp", label: "AOSP" },
];
const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(PLATFORM_OPTIONS.map((p) => [p.value, p.label]));
const DEPLOYMENT_MODELS: Record<string, Array<{ value: string; label: string }>> = {
  apple: [{ value: "supervised", label: "Supervised" }, { value: "unsupervised", label: "Unsupervised" }],
  macos: [{ value: "supervised", label: "Supervised" }, { value: "unsupervised", label: "Unsupervised" }],
  android: [
    { value: "work_profile", label: "Work Profile" },
    { value: "cope", label: "COPE" },
    { value: "device_owner", label: "Device Owner" },
  ],
};

function newStepId(): string {
  return crypto.randomUUID();
}
// Port of emptyStepConfig (WorkflowBuilder.jsx:38-49).
function emptyStepConfig(type: string): Record<string, any> {
  if (type === "mdm_action") return { action: "" };
  if (type === "run_script_wait") return { libraryId: "", timeoutMinutes: 30 };
  if (type === "http_request") return { method: "POST", url: "", headers: {}, body: "" };
  if (type === "notification") return { channel: "webhook", target: "admin", webhookUrl: "", recipients: "", subject: "", title: "", message: "" };
  if (type === "policy_replace") return { policyId: "", policyName: "" };
  if (type === "policy_add") return { policyId: "", policyName: "", priority: "bottom" };
  if (type === "policy_restore") return {};
  if (type === "monitor") return { compliancePolicyId: "", restoreOnCompliant: true };
  if (type === "wait") return { amount: 30, unit: "minutes" };
  return {};
}
// Port of addStep/addRecoveryStep (WorkflowBuilder.jsx:680-682, 700-703) —
// defaults to mdm_action only once a target platform is locked in;
// otherwise defaults to http_request, since mdm_action isn't even offered
// in the type picker yet.
function newStep(): WorkflowStep {
  const type = form.targetPlatform ? "mdm_action" : "http_request";
  return { id: newStepId(), type, name: "", config: emptyStepConfig(type), onSuccess: null, onFailure: null };
}

const screen = ref<"details" | "steps">("details");
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
  name: "", description: "", targetPlatform: "", targetDeploymentModel: "",
  steps: [], recoveryEnabled: false, recoveryCompliancePolicyId: "", recoverySteps: [],
  allowUnattendedDestructive: false,
});

const isSaving = ref(false);
const error = ref<string | null>(null);

function resetForm() {
  const w = props.workflow;
  screen.value = w ? "steps" : "details";
  form.name = w?.name ?? "";
  form.description = w?.description ?? "";
  form.targetPlatform = w?.targetPlatform ?? "";
  form.targetDeploymentModel = w?.targetDeploymentModel ?? "";
  form.steps = JSON.parse(JSON.stringify(w?.steps ?? []));
  form.recoveryEnabled = w?.recovery?.enabled ?? false;
  form.recoveryCompliancePolicyId = w?.recovery?.compliancePolicyId ?? "";
  form.recoverySteps = JSON.parse(JSON.stringify(w?.recovery?.steps ?? []));
  form.allowUnattendedDestructive = w?.allowUnattendedDestructive ?? false;
  error.value = null;
}

watch(() => props.open, async (open) => {
  if (!open) return;
  resetForm();
  if (store.mdmActions.length === 0) await store.fetchMdmActions();
  if (complianceStore.policies.length === 0) await complianceStore.fetchPolicies();
  if (actionLibraryStore.entries.length === 0) await actionLibraryStore.fetchEntries();
});

const needsDeploymentModel = computed(() => ["apple", "macos", "android"].includes(form.targetPlatform));
const modelOptions = computed(() => DEPLOYMENT_MODELS[form.targetPlatform] ?? []);
const modelLabel = computed(() => modelOptions.value.find((m) => m.value === form.targetDeploymentModel)?.label ?? form.targetDeploymentModel);

const mdmActionsByKey = computed(() => Object.fromEntries(store.mdmActions.map((a) => [a.key, a])));
function isActionCompatible(action: MdmActionDef, platform: string, deploymentModel: string): boolean {
  if (!platform) return false;
  if (!(action.platforms || []).includes(platform)) return false;
  const allowedModels = (action.deploymentModels || {})[platform];
  if (allowedModels && allowedModels.length) {
    if (!deploymentModel || !allowedModels.includes(deploymentModel)) return false;
  }
  return true;
}

function reconcileStep(s: WorkflowStep, platform: string, deploymentModel: string): WorkflowStep {
  if (s.type === "mdm_action" && s.config?.action) {
    const meta = mdmActionsByKey.value[s.config.action];
    if (!(meta && isActionCompatible(meta, platform, deploymentModel))) return { ...s, config: emptyStepConfig("mdm_action") };
  }
  if (s.type === "run_script_wait" && s.config?.libraryId) {
    const stillValid = actionLibraryEntries.value.some((entry) => entry.id === s.config.libraryId && entry.type === "script" && entry.platform === platform);
    if (!stillValid) return { ...s, config: emptyStepConfig("run_script_wait") };
  }
  return s;
}
function reconcileStepsForTarget(platform: string, deploymentModel: string) {
  form.steps = form.steps.map((s) => reconcileStep(s, platform, deploymentModel));
  form.recoverySteps = form.recoverySteps.map((s) => reconcileStep(s, platform, deploymentModel));
}

function pickPlatform(value: string) {
  form.targetPlatform = value;
  form.targetDeploymentModel = "";
  reconcileStepsForTarget(value, "");
}
function pickDeploymentModel(value: string) {
  form.targetDeploymentModel = value;
  reconcileStepsForTarget(form.targetPlatform, value);
}

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

const hasDestructiveStep = computed(() => form.steps.some((s) => s.type === "mdm_action" && mdmActionsByKey.value[s.config?.action]?.destructive));

function goToStepsScreen() {
  if (!form.name.trim()) {
    error.value = "Give this workflow a name.";
    return;
  }
  if (!form.targetPlatform) {
    error.value = "Choose a target platform before continuing — MDM Action steps need one to know which commands are valid.";
    return;
  }
  if (needsDeploymentModel.value && !form.targetDeploymentModel) {
    error.value = `Choose a deployment model for ${PLATFORM_LABELS[form.targetPlatform]} before continuing.`;
    return;
  }
  error.value = null;
  screen.value = "steps";
}

async function save() {
  if (!form.name.trim()) {
    error.value = "Give this workflow a name.";
    return;
  }
  const isBadStep = (s: WorkflowStep) => {
    if (s.type !== "mdm_action" || !s.config?.action) return false;
    const meta = mdmActionsByKey.value[s.config.action];
    return !meta || !isActionCompatible(meta, form.targetPlatform, form.targetDeploymentModel);
  };
  const badStep = form.steps.find(isBadStep) || form.recoverySteps.find(isBadStep);
  if (badStep) {
    error.value = `Step "${badStep.name || "Untitled step"}" uses an MDM action that doesn't match this workflow's target. Fix or remove that step before saving.`;
    return;
  }
  if (form.recoveryEnabled && !form.recoveryCompliancePolicyId) {
    error.value = "Recovery is enabled but no Compliance Policy is selected to watch — pick one or disable Recovery.";
    return;
  }
  isSaving.value = true;
  error.value = null;
  try {
    const payload = {
      name: form.name,
      description: form.description,
      targetPlatform: form.targetPlatform || null,
      targetDeploymentModel: form.targetDeploymentModel || null,
      steps: form.steps,
      recovery: { enabled: form.recoveryEnabled, compliancePolicyId: form.recoveryCompliancePolicyId || null, steps: form.recoverySteps },
      allowUnattendedDestructive: form.allowUnattendedDestructive,
    };
    if (props.workflow) await store.updateWorkflow(props.workflow.id, payload);
    else await store.createWorkflow(payload);
    emit("saved");
    emit("close");
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Failed to save workflow.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-[270] flex items-center justify-center bg-black/60 p-4" @click.self="emit('close')">
    <div class="w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden flex flex-col bg-white dark:bg-gray-800" style="max-height: 88vh">
      <div class="flex items-center justify-between px-5 py-4 shrink-0 border-b border-gray-200 dark:border-gray-700">
        <div>
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ workflow ? "Edit workflow" : "Create workflow" }}</h3>
          <p class="text-xs mt-0.5 text-gray-400">{{ screen === "details" ? "Step 1 of 2 — Details" : "Step 2 of 2 — Steps & Recovery" }}</p>
        </div>
        <button class="p-1 rounded-lg text-gray-400 hover:opacity-70" @click="emit('close')">
          <component :is="ICONS.CloseCircle" :size="16" weight="Linear" />
        </button>
      </div>

      <div class="overflow-y-auto flex-1 px-5 py-4">
        <Alert v-if="error" type="danger" class="mb-4">{{ error }}</Alert>

        <template v-if="screen === 'details'">
          <div class="space-y-2 mb-5">
            <input v-model="form.name" placeholder="Workflow name, e.g. Non-compliant device escalation" class="w-full px-3 py-2 rounded-lg text-sm font-medium outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500" />
            <textarea v-model="form.description" placeholder="Description (optional)" rows="2" class="w-full px-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-brand-500" />
          </div>

          <div class="rounded-xl p-4 mb-5 border border-gray-200 dark:border-gray-700">
            <p class="text-xs font-semibold uppercase tracking-wider mb-2 text-gray-400">1. Target platform</p>
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-1">
              <button
                v-for="p in PLATFORM_OPTIONS"
                :key="p.value"
                class="px-3 py-1.5 rounded-lg text-xs font-semibold"
                :class="form.targetPlatform !== p.value ? 'border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white' : ''"
                :style="form.targetPlatform === p.value ? { backgroundColor: PRIMARY_BLUE, color: '#fff' } : {}"
                @click="pickPlatform(p.value)"
              >
                {{ p.label }}
              </button>
            </div>
            <p class="text-xs mb-3 text-gray-400">
              {{
                form.targetPlatform === "aosp"
                  ? "AOSP (rugged/kiosk Android without Google services) runs Device Owner only — no Step 2 here."
                  : form.targetPlatform
                    ? "Once you continue, every MDM Action step (Steps and Recovery) is locked to this platform + deployment model — come back here to change it. "
                    : "Pick a platform to unlock MDM Action steps. "
              }}
              HTTP Request, Notification, Wait, Monitor Compliance, and the policy steps are common actions — always available on every platform, alongside that platform's MDM Actions.
            </p>

            <template v-if="needsDeploymentModel">
              <p class="text-xs font-semibold uppercase tracking-wider mb-2 text-gray-400">2. Deployment model</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="m in modelOptions"
                  :key="m.value"
                  class="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  :class="form.targetDeploymentModel !== m.value ? 'border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white' : ''"
                  :style="form.targetDeploymentModel === m.value ? { backgroundColor: PRIMARY_BLUE, color: '#fff' } : {}"
                  @click="pickDeploymentModel(m.value)"
                >
                  {{ m.label }}
                </button>
              </div>
              <p v-if="!form.targetDeploymentModel" class="text-xs mt-2 inline-flex items-start gap-1.5" :style="{ color: WARNING }">
                <component :is="ICONS.InfoCircle" :size="12" weight="Linear" class="shrink-0 mt-0.5" /> Required before continuing — this is what stops supervised-only and unsupervised-only actions from ending up mixed in the same workflow.
              </p>
            </template>
          </div>
        </template>

        <template v-else>
          <div class="flex items-center justify-between mb-5 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-2 text-xs font-semibold text-gray-900 dark:text-white">
              <component :is="ICONS.CheckCircle" :size="14" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
              Target: {{ form.targetPlatform ? PLATFORM_LABELS[form.targetPlatform] : "Common (no platform)" }}<template v-if="form.targetDeploymentModel"> · {{ modelLabel }}</template>
            </div>
            <button class="text-xs font-medium" :style="{ color: PRIMARY_BLUE }" @click="screen = 'details'">Change</button>
          </div>

          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">Steps</p>
            <button class="inline-flex items-center gap-1 text-xs font-medium" :style="{ color: PRIMARY_BLUE }" @click="addStep">
              <component :is="ICONS.AddSquare" :size="12" weight="Linear" /> Add step
            </button>
          </div>
          <p v-if="form.steps.length === 0" class="text-xs text-center py-8 text-gray-400">No steps yet — add one to get started.</p>
          <div class="space-y-2">
            <WorkflowStepEditor
              v-for="(step, idx) in form.steps"
              :key="step.id"
              :step="step"
              :step-index="idx"
              :all-steps="form.steps"
              :target-platform="form.targetPlatform"
              :target-deployment-model="form.targetDeploymentModel"
              show-branching
              @remove="removeStep(idx)"
              @move-up="moveStep(idx, -1)"
              @move-down="moveStep(idx, 1)"
            />
          </div>

          <div v-if="hasDestructiveStep" class="rounded-xl p-4 mt-6 border" :style="{ borderColor: `${WARNING}40`, backgroundColor: `${WARNING}0A` }">
            <div class="flex items-start gap-2.5">
              <component :is="ICONS.DangerTriangle" :size="15" weight="Linear" :style="{ color: WARNING }" class="shrink-0 mt-0.5" />
              <div class="flex-1">
                <p class="text-xs font-semibold text-gray-900 dark:text-white">This workflow includes a destructive action</p>
                <p class="text-[11px] mt-1 mb-2.5 leading-relaxed text-gray-400">
                  Anywhere this workflow is set to fire unattended — a Compliance Policy's autoRun, a Case Auto-Run Rule, or an Applivery Event rule — that specific policy/rule still requires its own explicit acknowledgment before it can actually run this workflow without human review. This toggle doesn't change that; it only sets the starting value of that acknowledgment checkbox the first time a policy/rule is pointed at this workflow.
                </p>
                <label class="flex items-center gap-2 text-xs font-medium cursor-pointer text-gray-900 dark:text-white">
                  <input v-model="form.allowUnattendedDestructive" type="checkbox" /> This workflow is approved to run unattended (pre-fills new acknowledgment checkboxes as checked)
                </label>
              </div>
            </div>
          </div>

          <div class="rounded-xl p-4 mt-6 border border-gray-200 dark:border-gray-700">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <component :is="ICONS.ShieldCheck" :size="15" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
                <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">Recovery — when compliance is restored</p>
              </div>
              <label class="flex items-center gap-2 text-xs font-medium text-gray-900 dark:text-white">
                <input v-model="form.recoveryEnabled" type="checkbox" /> Enabled
              </label>
            </div>
            <p class="text-xs mb-3 text-gray-400">
              The moment the Compliance Policy below is no longer violated for a device, the Steps above stop escalating right there — no further steps run — and the recovery steps below run once, in order, to put the device back the way it was (e.g. Restore Policies, Install App to bring back something removed, Re-enable device). Any "Run script" step above with a restore script configured fires that restore script automatically first.
            </p>
            <template v-if="form.recoveryEnabled">
              <select v-model="form.recoveryCompliancePolicyId" class="w-full px-2 py-1.5 rounded-lg text-sm outline-none mb-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500">
                <option value="">Select compliance policy to watch…</option>
                <option v-for="p in complianceStore.policies" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>

              <div class="flex items-center justify-between mb-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">Recovery steps</p>
                <button class="inline-flex items-center gap-1 text-xs font-medium" :style="{ color: PRIMARY_BLUE }" @click="addRecoveryStep">
                  <component :is="ICONS.AddSquare" :size="12" weight="Linear" /> Add recovery step
                </button>
              </div>
              <p v-if="form.recoverySteps.length === 0" class="text-xs text-center py-6 text-gray-400">No recovery steps yet — e.g. add a Restore Policies step.</p>
              <div class="space-y-2">
                <WorkflowStepEditor
                  v-for="(step, idx) in form.recoverySteps"
                  :key="step.id"
                  :step="step"
                  :step-index="idx"
                  :all-steps="form.recoverySteps"
                  :target-platform="form.targetPlatform"
                  :target-deployment-model="form.targetDeploymentModel"
                  @remove="removeRecoveryStep(idx)"
                  @move-up="moveRecoveryStep(idx, -1)"
                  @move-down="moveRecoveryStep(idx, 1)"
                />
              </div>
            </template>
          </div>
        </template>
      </div>

      <div class="flex items-center justify-between px-5 py-4 shrink-0 border-t border-gray-200 dark:border-gray-700">
        <button v-if="screen === 'steps'" class="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-gray-400" @click="screen = 'details'">
          <component :is="ICONS.AltArrowLeft" :size="15" weight="Linear" /> Back
        </button>
        <div v-else />
        <div class="flex gap-3">
          <Button variant="ghost" @click="emit('close')">Cancel</Button>
          <Button v-if="screen === 'details'" @click="goToStepsScreen">Next: Add steps →</Button>
          <Button v-else :loading="isSaving" @click="save">Save workflow</Button>
        </div>
      </div>
    </div>
  </div>
</template>
