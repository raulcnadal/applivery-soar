<script setup lang="ts">
// One step's editor card — type/name + a per-step-type config form, plus
// (optionally) onSuccess/onFailure branch selects for escalation steps.
// Recovery steps (see WorkflowBuilderDrawer) run linearly, no branching, so
// `showBranching` is off there.
import { Button, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { useComplianceStore } from "../../stores/compliance";
import { useDevicesStore, type PickerItem } from "../../stores/devices";
import { useWorkflowsStore, type MdmActionDef, type WorkflowStep } from "../../stores/workflows";
import { useActionLibraryStore } from "../../stores/actionLibrary";
import { useFirewallRuleSetsStore } from "../../stores/firewallRuleSets";

const props = defineProps<{
  step: WorkflowStep;
  stepIndex: number;
  allSteps: WorkflowStep[];
  targetPlatform?: string | null;
  showBranching?: boolean;
}>();

const emit = defineEmits<{
  remove: [];
  moveUp: [];
  moveDown: [];
}>();

const store = useWorkflowsStore();
const complianceStore = useComplianceStore();
const actionLibraryStore = useActionLibraryStore();
const firewallStore = useFirewallRuleSetsStore();
const devicesStore = useDevicesStore();

onMounted(async () => {
  if (store.mdmActions.length === 0) await store.fetchMdmActions();
  if (complianceStore.policies.length === 0) await complianceStore.fetchPolicies();
  if (actionLibraryStore.entries.length === 0) await actionLibraryStore.fetchEntries();
  if (firewallStore.ruleSets.length === 0) await firewallStore.fetchRuleSets();
  await loadMdmPolicies();
});

// Applivery MDM Policies (distinct from Compliance Policies above) for the
// policy_replace/policy_add step pickers — platform-specific if a target
// is locked in, otherwise fetched across every platform and tagged so the
// admin can still pick one (WorkflowBuilder.jsx:328-336). Real dropdown
// rather than a free-text policy-id input.
const mdmPolicies = ref<Array<PickerItem & { platform: string }>>([]);
const PLATFORM_VALUES = ["apple", "macos", "android", "windows", "aosp"];
async function loadMdmPolicies() {
  const platformsToFetch = props.targetPlatform ? [props.targetPlatform] : PLATFORM_VALUES;
  const results = await Promise.all(
    platformsToFetch.map((pf) => devicesStore.getPolicies(pf).then((items) => items.map((p) => ({ ...p, platform: pf }))).catch(() => [])),
  );
  mdmPolicies.value = results.flat();
}
watch(() => props.targetPlatform, loadMdmPolicies);

const PLATFORM_LABELS: Record<string, string> = { apple: "iOS", macos: "macOS", android: "Android", windows: "Windows", aosp: "AOSP" };
function mdmPolicyLabel(p: PickerItem & { platform: string }): string {
  return props.targetPlatform ? p.name : `[${PLATFORM_LABELS[p.platform] || p.platform}] ${p.name}`;
}

// Apps for the mdm_action step's app_select fields (Install/Uninstall App
// actions) — always platform-specific since mdm_action only exists once a
// target is chosen (WorkflowBuilder.jsx:338-346).
const apps = ref<PickerItem[]>([]);
watch(
  () => props.targetPlatform,
  async (platform) => {
    apps.value = platform ? await devicesStore.getApps(platform).catch(() => []) : [];
  },
  { immediate: true },
);

const STEP_TYPES = [
  { value: "mdm_action", label: "MDM action" },
  { value: "http_request", label: "HTTP request" },
  { value: "notification", label: "Notification" },
  { value: "policy_replace", label: "Quarantine — replace policies" },
  { value: "policy_add", label: "Quarantine — add policy" },
  { value: "policy_restore", label: "Restore previous policies" },
  { value: "monitor", label: "Monitor compliance" },
  { value: "wait", label: "Wait (durable — survives a restart)" },
  { value: "run_script_wait", label: "Run script & wait for its actual result" },
];

const scriptLibraryEntries = computed(() => actionLibraryStore.entries.filter((e) => e.type === "script"));

const availableActions = computed<MdmActionDef[]>(() => {
  if (!props.targetPlatform) return store.mdmActions;
  return store.mdmActions.filter((a) => a.platforms.includes(props.targetPlatform!));
});

const selectedAction = computed<MdmActionDef | undefined>(() => store.mdmActions.find((a) => a.key === props.step.config.action));

function setActionKey(key: string) {
  props.step.config.action = key;
  props.step.config.params = {};
}

function fieldValue(fieldKey: string) {
  return (props.step.config.params ?? {})[fieldKey] ?? "";
}
function setFieldValue(fieldKey: string, value: unknown) {
  if (!props.step.config.params) props.step.config.params = {};
  props.step.config.params[fieldKey] = value;
}

// Port of BranchSelect (WorkflowBuilder.jsx:65-80) — On Success's unset
// default falls through to the next step; On Failure's unset default is
// Stop (a failed step halts that device's run unless redirected). Both
// store the same empty/null value; only the option label differs.
const jumpTargets = computed(() => props.allSteps.filter((s) => s.id !== props.step.id).map((s) => ({ value: s.id, label: `Jump to: ${s.name || "Untitled step"}` })));
const branchOptions = computed(() => [{ value: "", label: "Next step (default)" }, { value: "end", label: "End workflow" }, ...jumpTargets.value]);
const failureBranchOptions = computed(() => [{ value: "", label: "Stop (default)" }, { value: "end", label: "End workflow" }, ...jumpTargets.value]);
</script>

<template>
  <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-3 bg-gray-50/50">
    <div class="flex items-center gap-2">
      <span class="text-xs font-semibold text-gray-400 w-6">#{{ stepIndex + 1 }}</span>
      <Input v-model="step.name" placeholder="Step name" class="flex-1" />
      <Input :model-value="step.type" type="select" :options="STEP_TYPES" class="w-56" @update:model-value="step.type = $event as string; step.config = {}" />
      <Button size="sm" variant="ghost" @click="emit('moveUp')">↑</Button>
      <Button size="sm" variant="ghost" @click="emit('moveDown')">↓</Button>
      <Button size="sm" variant="ghost" @click="emit('remove')">✕</Button>
    </div>

    <!-- mdm_action -->
    <div v-if="step.type === 'mdm_action'" class="space-y-2 pl-8">
      <Input
        :model-value="step.config.action || ''"
        type="select"
        :options="availableActions.map((a) => ({ value: a.key, label: a.label + (a.destructive ? ' (destructive)' : '') + (a.unconfirmed ? ' — unconfirmed' : '') }))"
        label="Action"
        @update:model-value="setActionKey($event as string)"
      />
      <div v-if="selectedAction?.fields?.length" class="grid grid-cols-2 gap-2">
        <template v-for="f in selectedAction.fields" :key="f.key">
          <Input
            v-if="f.type === 'select'"
            :model-value="fieldValue(f.key)"
            type="select"
            :options="(f.options ?? []).map((o) => ({ value: o, label: o }))"
            :label="f.label"
            @update:model-value="setFieldValue(f.key, $event)"
          />
          <Input
            v-else-if="f.type === 'password'"
            :model-value="fieldValue(f.key)"
            type="password"
            :label="f.label"
            :placeholder="f.placeholder"
            @update:model-value="setFieldValue(f.key, $event)"
          />
          <Input
            v-else-if="f.type === 'script_library_select'"
            :model-value="fieldValue(f.key)"
            type="select"
            :options="scriptLibraryEntries.map((e) => ({ value: e.id, label: `${e.name} (${e.platform})` }))"
            :label="f.label"
            @update:model-value="setFieldValue(f.key, $event)"
          />
          <Input
            v-else-if="f.type === 'firewall_ruleset_select'"
            :model-value="fieldValue(f.key)"
            type="select"
            :options="firewallStore.ruleSets.map((r) => ({ value: r.id, label: r.name }))"
            :label="f.label"
            @update:model-value="setFieldValue(f.key, $event)"
          />
          <Input
            v-else-if="f.type === 'app_select'"
            :model-value="fieldValue(f.key)"
            type="select"
            :options="apps.map((a) => ({ value: a.id, label: a.name }))"
            :label="f.label"
            :placeholder="apps.length ? undefined : 'No apps found in App Distribution'"
            @update:model-value="setFieldValue(f.key, $event)"
          />
          <Input v-else :model-value="fieldValue(f.key)" :label="f.label" :placeholder="f.placeholder" @update:model-value="setFieldValue(f.key, $event)" />
        </template>
      </div>
    </div>

    <!-- http_request -->
    <div v-else-if="step.type === 'http_request'" class="space-y-2 pl-8">
      <div class="grid grid-cols-4 gap-2">
        <Input
          :model-value="step.config.method || 'POST'"
          type="select"
          :options="['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))"
          label="Method"
          class="col-span-1"
          @update:model-value="step.config.method = $event"
        />
        <Input v-model="step.config.url" label="URL" placeholder="https://example.com/hook — supports {{ device.x }}" class="col-span-3" />
      </div>
      <Input v-model="step.config.body" label="Body (optional — JSON or raw text)" placeholder='{"deviceId": "{{ device.id }}"}' />
    </div>

    <!-- notification -->
    <div v-else-if="step.type === 'notification'" class="space-y-2 pl-8">
      <div class="grid grid-cols-2 gap-2">
        <Input
          :model-value="step.config.channel || 'webhook'"
          type="select"
          :options="[
            { value: 'webhook', label: 'Webhook (Google Chat)' },
            { value: 'email', label: 'Email' },
            { value: 'applivery_push', label: 'Applivery Agent push' },
          ]"
          label="Channel"
          @update:model-value="step.config.channel = $event"
        />
        <Input
          v-if="step.config.channel === 'email'"
          :model-value="step.config.target || 'admin'"
          type="select"
          :options="[
            { value: 'admin', label: 'Admin recipients' },
            { value: 'user', label: 'Device MDM user' },
            { value: 'admin_and_user', label: 'Both' },
          ]"
          label="Recipients"
          @update:model-value="step.config.target = $event"
        />
      </div>
      <Input v-if="step.config.channel === 'webhook'" v-model="step.config.webhookUrl" label="Webhook URL (optional — falls back to workspace default)" />
      <Input v-if="step.config.channel === 'email'" v-model="step.config.recipients" label="Admin recipients (comma-separated)" />
      <Input v-if="step.config.channel === 'email'" v-model="step.config.subject" label="Subject" />
      <Input v-if="step.config.channel === 'applivery_push'" v-model="step.config.title" label="Push title" />
      <Input v-model="step.config.message" label="Message — supports {{ device.x }}" placeholder="{{ device.displayName }} is out of compliance" />
    </div>

    <!-- policy_replace / policy_add -->
    <div v-else-if="step.type === 'policy_replace' || step.type === 'policy_add'" class="space-y-2 pl-8">
      <Input
        :model-value="step.config.policyId || ''"
        type="select"
        :options="mdmPolicies.map((p) => ({ value: p.id, label: mdmPolicyLabel(p) }))"
        :label="step.type === 'policy_replace' ? 'Replacement policy' : 'Policy to add'"
        @update:model-value="step.config.policyId = $event; step.config.policyName = mdmPolicies.find((p) => p.id === $event)?.name || ''"
      />
      <p v-if="step.type === 'policy_replace'" class="text-xs text-gray-500 dark:text-gray-400">Quarantine — replaces ALL of the device's current policies with this one. The original stack is snapshotted automatically.</p>
      <Input
        v-if="step.type === 'policy_add'"
        :model-value="step.config.priority || 'bottom'"
        type="select"
        :options="[
          { value: 'top', label: 'Top (becomes primary)' },
          { value: 'bottom', label: 'Bottom (lowest-priority fallback)' },
        ]"
        label="Priority"
        @update:model-value="step.config.priority = $event"
      />
    </div>

    <!-- policy_restore -->
    <p v-else-if="step.type === 'policy_restore'" class="pl-8 text-xs text-gray-500 dark:text-gray-400">Restores this device's policy stack from the snapshot taken by the first quarantine step. No configuration needed.</p>

    <!-- monitor -->
    <div v-else-if="step.type === 'monitor'" class="space-y-2 pl-8">
      <Input
        :model-value="step.config.compliancePolicyId || ''"
        type="select"
        :options="complianceStore.policies.map((p) => ({ value: p.id, label: p.name }))"
        label="Compliance policy to re-check"
        @update:model-value="step.config.compliancePolicyId = $event"
      />
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input type="checkbox" v-model="step.config.restoreOnCompliant" /> Restore quarantined policies once compliant again
      </label>
    </div>

    <!-- wait / run_script_wait -->
    <div v-else-if="step.type === 'wait'" class="space-y-2 pl-8">
      <p class="text-xs text-gray-500 dark:text-gray-400">Persists to durable storage and resumes on its own schedule — survives an API restart mid-wait.</p>
      <div class="grid grid-cols-2 gap-2">
        <Input v-model.number="step.config.amount" type="number" label="Amount" />
        <Input
          :model-value="step.config.unit || 'minutes'"
          type="select"
          :options="['minutes', 'hours', 'days'].map((u) => ({ value: u, label: u }))"
          label="Unit"
          @update:model-value="step.config.unit = $event"
        />
      </div>
    </div>
    <div v-else-if="step.type === 'run_script_wait'" class="space-y-2 pl-8">
      <p class="text-xs text-gray-500 dark:text-gray-400">Dispatches the script, then parks this device's chain until the agent's actual result is known (resolved early by the script log reconciler, or by the timeout below as a fallback).</p>
      <Input
        :model-value="step.config.libraryId || ''"
        type="select"
        :options="scriptLibraryEntries.map((e) => ({ value: e.id, label: `${e.name} (${e.platform})` }))"
        label="Script"
        @update:model-value="step.config.libraryId = $event"
      />
      <Input v-model.number="step.config.timeoutMinutes" type="number" label="Timeout (minutes, default 30)" placeholder="30" />
    </div>

    <div v-if="showBranching" class="grid grid-cols-2 gap-2 pl-8 pt-1 border-t border-gray-200 dark:border-gray-700">
      <Input
        :model-value="step.onSuccess || ''"
        type="select"
        :options="branchOptions"
        label="On success →"
        @update:model-value="step.onSuccess = ($event as string) || null"
      />
      <Input
        :model-value="step.onFailure || ''"
        type="select"
        :options="failureBranchOptions"
        label="On failure →"
        @update:model-value="step.onFailure = ($event as string) || null"
      />
    </div>
  </div>
</template>
