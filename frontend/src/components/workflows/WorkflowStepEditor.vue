<script setup lang="ts">
// One step's editor card — type/name + a per-step-type config form, plus
// (optionally) onSuccess/onFailure branch selects for escalation steps.
// Port of StepEditor (WorkflowBuilder.jsx:88-430). Recovery steps (see
// WorkflowBuilderModal) run linearly, no branching, so `showBranching` is
// off there.
import { Button, Input } from "@applivery/bluesky-vue";
import { computed, onMounted, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useComplianceStore } from "../../stores/compliance";
import { useDevicesStore, type PickerItem } from "../../stores/devices";
import { useWorkflowsStore, type MdmActionDef, type WorkflowStep } from "../../stores/workflows";
import { useActionLibraryStore } from "../../stores/actionLibrary";
import { useFirewallRuleSetsStore } from "../../stores/firewallRuleSets";

const WARNING = "#F59E0B";

const props = defineProps<{
  step: WorkflowStep;
  stepIndex: number;
  allSteps: WorkflowStep[];
  targetPlatform?: string | null;
  targetDeploymentModel?: string | null;
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

// Port of emptyStepConfig (WorkflowBuilder.jsx:38-49) — every step-type
// switch resets config to type-specific defaults, not a bare {}, so e.g. a
// fresh Wait step already has amount/unit and a fresh Monitor step already
// defaults restoreOnCompliant to true.
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
const policyOptions = computed(() => [
  { value: "", label: props.step.type === "policy_replace" ? "Select replacement policy…" : "Select policy to add…" },
  ...mdmPolicies.value.map((p) => ({ value: p.id, label: mdmPolicyLabel(p) })),
]);
const compliancePolicyOptions = computed(() => [
  { value: "", label: "Select compliance policy to re-check…" },
  ...complianceStore.policies.map((p) => ({ value: p.id, label: p.name })),
]);

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
const appOptions = computed(() => [
  { value: "", label: apps.value.length ? "Select an app…" : "No apps found in App Distribution" },
  ...apps.value.map((a) => ({ value: a.id, label: a.name })),
]);

// Port of STEP_TYPES (WorkflowBuilder.jsx:28-38) — exact order + labels.
const STEP_TYPES = [
  { value: "mdm_action", label: "MDM Action" },
  { value: "run_script_wait", label: "Run Script & Wait for Result" },
  { value: "http_request", label: "HTTP Request" },
  { value: "notification", label: "Notification" },
  { value: "policy_replace", label: "Quarantine (Replace Policies)" },
  { value: "policy_add", label: "Add Policy" },
  { value: "policy_restore", label: "Restore Policies" },
  { value: "monitor", label: "Monitor Compliance" },
  { value: "wait", label: "Wait" },
];

// Port of WorkflowBuilder.jsx:600 — without a target platform locked in,
// MDM Action and Run Script & Wait are hidden from the type picker (both
// need a platform-specific action/script catalog to mean anything).
const availableStepTypes = computed(() =>
  props.targetPlatform ? STEP_TYPES : STEP_TYPES.filter((t) => t.value !== "mdm_action" && t.value !== "run_script_wait"),
);

function changeType(type: string) {
  props.step.type = type;
  props.step.config = emptyStepConfig(type);
}

// Scripts in the Action Library are platform-tagged; only the ones matching
// this workflow's target are ever selectable (WorkflowBuilder.jsx:210-211,
// 340-341).
const platformLabel = computed(() => (props.targetPlatform ? PLATFORM_LABELS[props.targetPlatform] || props.targetPlatform : ""));
const matchingScripts = computed(() => actionLibraryStore.entries.filter((e) => e.type === "script" && e.platform === props.targetPlatform));
function scriptOptions(emptyLabel: string) {
  return [
    { value: "", label: matchingScripts.value.length ? emptyLabel : `No ${platformLabel.value} scripts in the Library yet` },
    ...matchingScripts.value.map((e) => ({ value: e.id, label: e.name })),
  ];
}
const omaUriEntries = computed(() => actionLibraryStore.entries.filter((e) => e.type === "oma_uri"));
const omaUriLoadId = ref("");
function loadOmaUriEntry(entryId: string) {
  const entry = omaUriEntries.value.find((o) => o.id === entryId);
  if (!entry) return;
  if (!props.step.config.params) props.step.config.params = {};
  props.step.config.params.path = entry.path ?? "";
  props.step.config.params.action = entry.action ?? "";
  props.step.config.params.format = entry.format ?? "";
  props.step.config.params.value = entry.value ?? "";
  omaUriLoadId.value = "";
}
const firewallOptions = computed(() => [
  { value: "", label: firewallStore.ruleSets.length ? "Select…" : "No Firewall Rule Sets in the Library yet" },
  ...firewallStore.ruleSets.map((r) => ({ value: r.id, label: r.name })),
]);

// Port of isActionCompatible (WorkflowBuilder.jsx:52-63) — platform AND (if
// the action is gated to specific deployment models on that platform) the
// deployment model must both match.
function isActionCompatible(action: MdmActionDef, platform?: string | null, deploymentModel?: string | null): boolean {
  if (!platform) return false;
  if (!(action.platforms || []).includes(platform)) return false;
  const allowedModels = (action.deploymentModels || {})[platform];
  if (allowedModels && allowedModels.length) {
    if (!deploymentModel || !allowedModels.includes(deploymentModel)) return false;
  }
  return true;
}
const compatibleActions = computed<MdmActionDef[]>(() => store.mdmActions.filter((a) => isActionCompatible(a, props.targetPlatform, props.targetDeploymentModel)));
const currentIncompatibleAction = computed<MdmActionDef | undefined>(() => {
  const key = props.step.config?.action;
  if (!key || compatibleActions.value.some((a) => a.key === key)) return undefined;
  return store.mdmActions.find((a) => a.key === key);
});
const actionOptions = computed(() => {
  const opts: Array<{ value: string; label: string }> = [{ value: "", label: "Select an action…" }];
  if (currentIncompatibleAction.value) {
    opts.push({ value: currentIncompatibleAction.value.key, label: `${currentIncompatibleAction.value.label} (incompatible with target — will fail)` });
  }
  opts.push(...compatibleActions.value.map((a) => ({ value: a.key, label: a.label + (a.destructive ? " ⚠" : "") + (a.unconfirmed ? " (not wired yet)" : "") })));
  return opts;
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

function setHeaders(value: string) {
  try {
    props.step.config.headers = JSON.parse(value);
  } catch {
    props.step.config.headers = value;
  }
}
const headersText = computed(() =>
  typeof props.step.config.headers === "string" ? props.step.config.headers : JSON.stringify(props.step.config.headers || {}, null, 2),
);

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
      <Input :model-value="step.type" type="select" :options="availableStepTypes" class="w-56" @update:model-value="changeType($event as string)" />
      <Button size="sm" variant="ghost" @click="emit('moveUp')">↑</Button>
      <Button size="sm" variant="ghost" @click="emit('moveDown')">↓</Button>
      <Button size="sm" variant="ghost" @click="emit('remove')">✕</Button>
    </div>

    <!-- mdm_action -->
    <div v-if="step.type === 'mdm_action'" class="space-y-2 pl-8">
      <Input :model-value="step.config.action || ''" type="select" :options="actionOptions" label="Action" @update:model-value="setActionKey($event as string)" />

      <p v-if="compatibleActions.length === 0 && !currentIncompatibleAction" class="text-xs text-gray-400">No MDM actions match the workflow's target platform/deployment model yet.</p>
      <p v-if="selectedAction?.destructive" class="inline-flex items-center gap-1.5 text-xs" :style="{ color: WARNING }">
        <component :is="ICONS.DangerTriangle" :size="12" weight="Linear" /> Destructive — cannot be undone on the device.
      </p>
      <p v-if="selectedAction?.unconfirmed" class="inline-flex items-start gap-1.5 text-xs" :style="{ color: WARNING }">
        <component :is="ICONS.InfoCircle" :size="12" weight="Linear" class="shrink-0 mt-0.5" /> Shown for planning, but not yet wired to a verified Applivery API call — running it will fail with an explanatory error. Use the Applivery Dashboard directly for now.
      </p>
      <p v-if="step.config.action === 'runScript'" class="inline-flex items-start gap-1.5 text-xs text-gray-400">
        <component :is="ICONS.InfoCircle" :size="12" weight="Linear" class="shrink-0 mt-0.5" /> Add script Policies to pick from under Workflows → Script & OMA-URI Library.
      </p>
      <p v-if="step.config.action === 'applyFirewallRuleSet' || step.config.action === 'restoreFirewallRuleSet'" class="inline-flex items-start gap-1.5 text-xs text-gray-400">
        <component :is="ICONS.InfoCircle" :size="12" weight="Linear" class="shrink-0 mt-0.5" /> Build rule sets to pick from under Workflows → Firewall Policy Library. Restore only removes this rule set's own tagged rules — the device's prior firewall state returns automatically.
      </p>
      <Input
        v-if="step.config.action === 'customOmaUri' && omaUriEntries.length > 0"
        :model-value="omaUriLoadId"
        type="select"
        :options="[{ value: '', label: 'Load from OMA-URI Library…' }, ...omaUriEntries.map((o) => ({ value: o.id, label: o.name }))]"
        @update:model-value="loadOmaUriEntry($event as string)"
      />

      <div v-if="selectedAction?.fields?.length" class="grid grid-cols-2 gap-2">
        <template v-for="f in selectedAction.fields" :key="f.key">
          <Input
            v-if="f.type === 'select'"
            :model-value="fieldValue(f.key)"
            type="select"
            :options="[{ value: '', label: 'Select…' }, ...(f.options ?? []).map((o) => ({ value: o, label: o }))]"
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
            :options="scriptOptions('Select…')"
            :label="f.label"
            @update:model-value="setFieldValue(f.key, $event)"
          />
          <Input
            v-else-if="f.type === 'firewall_ruleset_select'"
            :model-value="fieldValue(f.key)"
            type="select"
            :options="firewallOptions"
            :label="f.label"
            @update:model-value="setFieldValue(f.key, $event)"
          />
          <div v-else-if="f.type === 'app_select'">
            <Input :model-value="fieldValue(f.key)" type="select" :options="appOptions" :label="f.label" @update:model-value="setFieldValue(f.key, $event)" />
          </div>
          <div v-else>
            <Input :model-value="fieldValue(f.key)" :label="f.label" :placeholder="f.placeholder" @update:model-value="setFieldValue(f.key, $event)" />
            <template v-if="step.config.action === 'scheduleOsUpdate' && f.key === 'productVersion'">
              <button
                type="button"
                class="mt-1 text-[10px] font-semibold px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400"
                @click="setFieldValue('productVersion', '{{ device.osLifecycleStatus.latestKnownVersion }}')"
              >
                Use latest known version (auto, per device)
              </button>
              <p class="text-[10px] mt-1 text-gray-400">
                A hardcoded version applies the same target to every device. Use the template above to resolve each device's own target at run time from the OS Lifecycle catalog (Apple's GDMF data where available) instead of editing this workflow every time a new version ships — this only closes the loop for policies that already read osEol/appleAppUpdatesPending etc. as a trigger condition.
              </p>
            </template>
          </div>
        </template>
      </div>
    </div>

    <!-- run_script_wait -->
    <div v-else-if="step.type === 'run_script_wait'" class="space-y-2 pl-8">
      <Input :model-value="step.config.libraryId || ''" type="select" :options="scriptOptions('Select a script…')" label="Script" @update:model-value="step.config.libraryId = $event" />
      <div class="flex items-center gap-2">
        <Input v-model.number="step.config.timeoutMinutes" type="number" label="Timeout (minutes, default 30)" placeholder="30" />
      </div>
      <p class="inline-flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <component :is="ICONS.InfoCircle" :size="12" weight="Linear" class="shrink-0 mt-0.5" />
        Dispatches the script, then pauses this device's chain until the Applivery agent actually reports back a result (not just that the command was accepted). "On success" fires if the script exits clean; "On failure" fires if it errors, the timeout above elapses first, or no result ever comes back (e.g. device offline).
      </p>
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
      <Input type="textarea" :rows="2" :model-value="headersText" label="Headers (JSON, optional)" placeholder='{"Authorization": "Bearer ..."}' @update:model-value="setHeaders($event as string)" />
      <Input v-model="step.config.body" type="textarea" :rows="3" label="Body (optional — JSON or raw text)" placeholder='{"deviceId": "{{ device.id }}"}' />
    </div>

    <!-- notification -->
    <div v-else-if="step.type === 'notification'" class="space-y-2 pl-8">
      <div class="grid grid-cols-2 gap-2">
        <Input
          :model-value="step.config.channel || 'webhook'"
          type="select"
          :options="[
            { value: 'webhook', label: 'Google Chat webhook' },
            { value: 'email', label: 'Email' },
            { value: 'applivery_push', label: 'Applivery push (requires Agent)' },
          ]"
          label="Channel"
          @update:model-value="step.config.channel = $event"
        />
        <Input
          v-if="step.config.channel === 'email'"
          :model-value="step.config.target || 'admin'"
          type="select"
          :options="[
            { value: 'admin', label: 'Admin only' },
            { value: 'user', label: 'Device\'s assigned user only' },
            { value: 'admin_and_user', label: 'Admin + device\'s assigned user' },
          ]"
          label="Recipients"
          @update:model-value="step.config.target = $event"
        />
      </div>
      <Input v-if="step.config.channel === 'webhook'" v-model="step.config.webhookUrl" label="Webhook URL (leave blank to use the one configured in Settings)" />
      <template v-if="step.config.channel === 'email'">
        <Input v-if="step.config.target === 'admin' || step.config.target === 'admin_and_user'" v-model="step.config.recipients" label="Admin recipients (comma-separated)" />
        <p v-if="step.config.target === 'user' || step.config.target === 'admin_and_user'" class="text-xs text-gray-500 dark:text-gray-400">
          Sent to the device's assigned MDM user email — devices with no assigned user will fail this step.
        </p>
        <Input v-model="step.config.subject" label="Subject" />
      </template>
      <template v-if="step.config.channel === 'applivery_push'">
        <p class="inline-flex items-start gap-1.5 text-xs" :style="{ color: WARNING }">
          <component :is="ICONS.InfoCircle" :size="12" weight="Linear" class="shrink-0 mt-0.5" /> Requires the Applivery Agent (mdmAgent) installed and registered on the device — sent directly to that device, not to an admin inbox.
        </p>
        <Input v-model="step.config.title" label="Notification title" />
      </template>
      <Input v-model="step.config.message" type="textarea" :rows="2" label="Message — supports {{ device.x }}" placeholder="{{ device.displayName }} is out of compliance" />
    </div>

    <!-- policy_replace / policy_add -->
    <div v-else-if="step.type === 'policy_replace' || step.type === 'policy_add'" class="space-y-2 pl-8">
      <Input
        :model-value="step.config.policyId || ''"
        type="select"
        :options="policyOptions"
        :label="step.type === 'policy_replace' ? 'Replacement policy' : 'Policy to add'"
        @update:model-value="step.config.policyId = $event; step.config.policyName = mdmPolicies.find((p) => p.id === $event)?.name || ''"
      />
      <p v-if="step.type === 'policy_replace'" class="inline-flex items-start gap-1.5 text-xs" :style="{ color: WARNING }">
        <component :is="ICONS.DangerTriangle" :size="12" weight="Linear" class="shrink-0 mt-0.5" />
        Quarantine — replaces ALL of the device's current policies with this one. The original stack is snapshotted automatically and can be brought back later with a Restore Policies step, or a Monitor step with "Restore when compliant" checked.
      </p>
      <template v-if="step.type === 'policy_add'">
        <Input
          :model-value="step.config.priority || 'bottom'"
          type="select"
          :options="[
            { value: 'top', label: 'Primary (top priority)' },
            { value: 'bottom', label: 'Lowest priority (fallback)' },
          ]"
          label="Priority"
          @update:model-value="step.config.priority = $event"
        />
        <p class="text-xs text-gray-500 dark:text-gray-400">Adds alongside existing policies — doesn't replace them. The pre-change stack is snapshotted the same way, in case this needs undoing later.</p>
      </template>
    </div>

    <!-- policy_restore -->
    <p v-else-if="step.type === 'policy_restore'" class="pl-8 text-xs text-gray-500 dark:text-gray-400">
      Restores whatever policy stack was snapshotted the first time a Quarantine or Add Policy step touched this device, then clears the snapshot. Fails gracefully (no-op) if nothing is currently quarantined.
    </p>

    <!-- monitor -->
    <div v-else-if="step.type === 'monitor'" class="space-y-2 pl-8">
      <Input :model-value="step.config.compliancePolicyId || ''" type="select" :options="compliancePolicyOptions" label="Compliance policy to re-check" @update:model-value="step.config.compliancePolicyId = $event" />
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input type="checkbox" v-model="step.config.restoreOnCompliant" /> Restore quarantined policies once compliant again
      </label>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        "On success" below fires when the device is compliant again (default: stop — the loop is over). "On failure" fires when it's still violating — leave it as "Next step (default)" to escalate to the next tier, or jump back to an earlier Wait step to keep looping.
      </p>
    </div>

    <!-- wait -->
    <div v-else-if="step.type === 'wait'" class="space-y-2 pl-8">
      <div class="grid grid-cols-2 gap-2">
        <Input v-model.number="step.config.amount" type="number" label="Amount" />
        <Input
          :model-value="step.config.unit || 'minutes'"
          type="select"
          :options="[
            { value: 'minutes', label: 'Minutes' },
            { value: 'hours', label: 'Hours' },
            { value: 'days', label: 'Days' },
          ]"
          label="Unit"
          @update:model-value="step.config.unit = $event"
        />
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        Pauses this device's chain before continuing — pairs with Monitor to build a multi-tier escalation (act, wait, monitor, escalate). Long waits only survive as long as the dashboard's backend process does.
      </p>
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
