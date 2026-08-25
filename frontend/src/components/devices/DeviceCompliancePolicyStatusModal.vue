<script setup lang="ts">
// New feature (not a parity port): the Device Detail Drawer's "Compliance
// Policies" pills only ever showed one bit of information — compliant or
// violating overall — which isn't enough to act on for a policy with many
// conditions (conditionLogic "any"/"all" across an arbitrary number of
// rules). Clicking a pill opens this modal instead, showing every
// individual condition inside that policy with its own red/green dot for
// whether it's currently true for THIS device, plus when the policy was
// last evaluated — so an admin can see exactly what's tripping the policy
// without having to reopen the Policy Builder and cross-reference it
// against the device's raw attributes by hand.
import { Modal } from "@applivery/bluesky-vue";
import { computed, ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useDevicesStore } from "../../stores/devices";
import { useComplianceStore } from "../../stores/compliance";

const SUCCESS = "#22C55E";
const DANGER = "#EF4444";
const WARNING = "#F59E0B";

const props = defineProps<{ open: boolean; deviceId: string | null; policyId: string | null; policyName?: string | null }>();
const emit = defineEmits<{ close: [] }>();

const devicesStore = useDevicesStore();
const complianceStore = useComplianceStore();

const isLoading = ref(true);
const error = ref<string | null>(null);
const status = ref<{
  policyId: string;
  policyName: string;
  conditionLogic: "any" | "all";
  lastEvaluatedAt: string | null;
  violated: boolean;
  conditions: Array<{ field: string; operator: string; value: any; met: boolean }>;
} | null>(null);

async function load() {
  if (!props.deviceId || !props.policyId) return;
  isLoading.value = true;
  error.value = null;
  status.value = null;
  try {
    if (complianceStore.fields.length === 0) await complianceStore.fetchFields();
    status.value = await devicesStore.getDeviceCompliancePolicyStatus(props.deviceId, props.policyId);
  } catch (err: any) {
    error.value = err?.response?.data?.detail || "Failed to load this policy's condition status for this device.";
  } finally {
    isLoading.value = false;
  }
}

watch(
  () => [props.open, props.deviceId, props.policyId],
  ([open]) => {
    if (open) load();
  },
  { immediate: true },
);

const OPERATOR_LABEL: Record<string, string> = {
  equals: "is", notEquals: "is not", greaterThan: "is more than", lessThan: "is less than",
  includes: "has", excludes: "doesn't have", missing: "is missing", contains: "contains", exists: "exists",
  inside: "is inside", outside: "is outside",
};

// Best-effort human-readable label for one condition — covers the common
// scalar field types plus every "named sub-attribute" special type
// (smart_attribute/self_reported_attribute/custom_field/custom_check_result),
// whose value shape is {name|key|path, compareValue} (see ConditionRow.vue's
// defaultValueForType). Falls back to a generic "field operator value"
// rendering for anything else (device_audience/app_list/policy ids) rather
// than trying to resolve every possible reference name here.
function conditionLabel(c: { field: string; operator: string; value: any; valueLabel?: string }): string {
  const def = complianceStore.fields.find((f) => f.key === c.field);
  const label = def?.label || c.field;
  const opLabel = OPERATOR_LABEL[c.operator] || c.operator;

  // Geofencing conditions (field: "geofenceZoneId") carry the zone's raw
  // GUID as `value` — the backend (evaluatePolicyForDevice, devices.service.ts)
  // resolves that against the workspace's geofence zones and attaches the
  // admin-assigned name as `valueLabel` when it can, so this shows "Office"
  // instead of a UUID. Falls through to the generic renderer below (which
  // would otherwise print the bare GUID) if resolution failed for any reason
  // (e.g. the zone was since deleted).
  if (c.valueLabel) return `${label} ${opLabel} "${c.valueLabel}"`;

  if (["exists", "missing"].includes(c.operator)) {
    const subName = c.value?.name || c.value?.key || c.value?.path;
    return subName ? `${label} "${subName}" ${opLabel}` : `${label} ${opLabel}`;
  }
  if (def?.type === "boolean") return c.value === false ? `${label} — false` : label;
  if (def?.type === "smart_attribute") return `Smart Attribute "${c.value?.name ?? "?"}" ${opLabel} "${c.value?.compareValue ?? ""}"`;
  if (def?.type === "self_reported_attribute") return `Self-Reported Attribute "${c.value?.name ?? "?"}" ${opLabel} "${c.value?.compareValue ?? ""}"`;
  if (def?.type === "custom_check_result") return `Custom Check "${c.value?.key ?? "?"}" ${opLabel} "${c.value?.compareValue ?? ""}"`;
  if (def?.type === "custom_field") return `Custom field "${c.value?.path ?? "?"}" ${opLabel} "${c.value?.compareValue ?? ""}"`;
  if (def?.type === "duration") return `${label} ${opLabel} ${c.value?.amount ?? ""} ${c.value?.unit ?? ""}`.trim();
  if (Array.isArray(c.value)) return `${label} ${opLabel} ${c.value.join(", ")}`;
  if (c.value != null && typeof c.value === "object") return `${label} ${opLabel} ${c.value.name ?? c.value.policyName ?? JSON.stringify(c.value)}`;
  return `${label} ${opLabel}${c.value != null && c.value !== "" ? ` ${c.value}` : ""}`;
}

const lastEvaluatedLabel = computed(() => {
  if (!status.value?.lastEvaluatedAt) return "Not evaluated yet";
  return new Date(status.value.lastEvaluatedAt).toLocaleString();
});
</script>

<template>
  <Modal :open="open" :title="policyName || status?.policyName || 'Policy status'" size="lg" @close="emit('close')">
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <div class="w-5 h-5 border-2 rounded-full animate-spin" style="border-color: #0241e330; border-top-color: #0241e3" />
    </div>
    <p v-else-if="error" class="text-xs text-center py-6" :style="{ color: DANGER }">{{ error }}</p>
    <div v-else-if="status">
      <div class="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" :style="{ backgroundColor: status.violated ? `${DANGER}15` : `${SUCCESS}15`, color: status.violated ? DANGER : SUCCESS }">
          {{ status.violated ? "Violating" : "Compliant" }}
        </span>
        <span class="text-[11px] text-gray-400">
          Matches {{ status.conditionLogic === "all" ? "ALL" : "ANY" }} condition{{ status.conditions.length === 1 ? "" : "s" }} below · Last evaluated {{ lastEvaluatedLabel }}
        </span>
      </div>

      <div v-if="status.conditions.length === 0" class="text-xs text-gray-400 px-3 py-3 rounded-lg bg-gray-50 dark:bg-gray-900/50">
        This policy has no conditions configured.
      </div>
      <div v-else class="space-y-1.5 max-h-[55vh] overflow-y-auto">
        <div
          v-for="(c, i) in status.conditions"
          :key="i"
          class="flex items-start gap-2 px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-gray-900/50"
        >
          <span class="w-2 h-2 rounded-full shrink-0 mt-1.5" :style="{ backgroundColor: c.met ? DANGER : SUCCESS }" />
          <span class="text-gray-900 dark:text-white leading-snug">{{ conditionLabel(c) }}</span>
        </div>
      </div>
      <p class="text-[11px] mt-3 leading-relaxed text-gray-400">
        <span :style="{ color: DANGER }">Red</span> means this specific condition currently matches on this device (it's contributing to the policy's violation); <span :style="{ color: SUCCESS }">green</span> means it doesn't. With "ANY" logic, one red condition is enough to violate the policy; with "ALL" logic, every condition needs to be red for the policy to be violated.
      </p>
      <p v-if="status.conditionLogic === 'all' && status.conditions.some((c) => c.met) && !status.violated" class="text-[11px] mt-1.5 flex items-start gap-1.5" :style="{ color: WARNING }">
        <component :is="ICONS.DangerTriangle" :size="12" weight="Linear" class="shrink-0 mt-0.5" />
        This policy needs every condition to match before it's considered violated — some are already true for this device, but not all of them yet.
      </p>
    </div>
  </Modal>
</template>
