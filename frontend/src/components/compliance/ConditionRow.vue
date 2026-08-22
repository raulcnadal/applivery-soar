<script setup lang="ts">
// Port of ConditionRow (PolicyBuilder.jsx:41-330) — Field → Operator →
// Value, where Value's editor UI depends entirely on the field's `type`
// (boolean/select/number/duration/device_audience/string/smart_attribute/
// self_reported_attribute/custom_field/policy/app_list). This per-type
// branching is the single richest piece of UI in the whole Compliance
// surface, so it's kept as its own component rather than inlined into the
// builder.
import { computed, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import type { AppList, ComplianceFieldDef, ConditionRule, CustomCheckName, TriggerName } from "../../stores/compliance";
import type { GeofenceZone } from "../../stores/geofencing";
import PolicyPickerModal from "../devices/PolicyPickerModal.vue";
import AudiencePickerField from "./AudiencePickerField.vue";
import TagConditionField from "./TagConditionField.vue";

const PRIMARY_BLUE = "#0241E3";
const PLATFORMS = ["apple", "macos", "android", "windows"];

const OPERATOR_LABEL: Record<string, string> = {
  equals: "is", notEquals: "is not", greaterThan: "is more than", lessThan: "is less than",
  includes: "has", excludes: "doesn't have", missing: "is missing", contains: "contains", exists: "exists",
  inside: "is inside", outside: "is outside",
};

const props = defineProps<{
  condition: ConditionRule;
  fieldsCatalog: ComplianceFieldDef[];
  smartAttributeNames: string[];
  selfReportedAttributeNames: string[];
  // Disclosed new feature — customChecks.service.ts's module doc. Already
  // pre-filtered by the caller (PolicyBuilderDrawer.vue) to the policy's
  // own targetPlatform, since these ARE a finite, admin-defined vocabulary
  // (unlike selfReportedAttributeNames' free-text observed strings) — a
  // real dropdown, not a datalist.
  customCheckNames: CustomCheckName[];
  // Disclosed new feature — compliance.service.ts's getTriggerNames doc
  // comment. Every enabled Inbound Webhook (Settings > Inbound Webhooks),
  // not filtered by platform (a Trigger isn't platform-scoped the way a
  // Custom Device Check is) — a real dropdown, same reasoning as
  // customCheckNames above.
  triggerNames: TriggerName[];
  appLists: AppList[];
  deviceAudiences: Array<{ id: string; name: string }>;
  deviceTags: string[];
  segments: Array<{ id: string | number; name: string }>;
  geofenceZones: GeofenceZone[];
}>();

const emit = defineEmits<{
  change: [condition: ConditionRule];
  remove: [];
  "audience-created": [audience: { id: string; name: string }];
}>();

const isPickingPolicy = ref(false);

const fieldDef = computed(() => props.fieldsCatalog.find((f) => f.key === props.condition.field) ?? props.fieldsCatalog[0]);
const needsCompareValue = computed(() => !["exists", "missing"].includes(props.condition.operator));

function defaultValueForType(type: string | undefined, options: string[] | undefined): any {
  if (type === "boolean") return true;
  if (type === "select") return options?.[0] || "";
  if (type === "number") return 0;
  if (type === "duration") return { amount: 1, unit: "days" };
  if (type === "device_audience") return "";
  if (type === "policy") return null;
  if (type === "smart_attribute") return { name: "", compareValue: "" };
  if (type === "self_reported_attribute") return { name: "", compareValue: "" };
  if (type === "custom_check_result") return { key: "", compareValue: "" };
  if (type === "trigger_fired") return { triggerId: "", withinMinutes: null };
  if (type === "custom_field") return { path: "", compareValue: "" };
  if (type === "app_list") return "";
  return "";
}

function setField(key: string) {
  const def = props.fieldsCatalog.find((f) => f.key === key);
  emit("change", { field: key, operator: def?.operators?.[0] || "equals", value: defaultValueForType(def?.type, def?.options) });
}

function setOperator(operator: string) {
  emit("change", { ...props.condition, operator });
}

function setValue(value: any) {
  emit("change", { ...props.condition, value });
}

function setValuePatch(patch: Record<string, any>) {
  emit("change", { ...props.condition, value: { ...(props.condition.value || {}), ...patch } });
}

function setPolicyPlatform(platform: string) {
  emit("change", { ...props.condition, value: { ...(props.condition.value || {}), platform, policyId: null, policyName: null } });
}
</script>

<template>
  <div class="rounded-xl p-3 mb-2 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
    <div class="flex items-start gap-2">
      <div class="flex-1 grid grid-cols-2 gap-2">
        <select :value="fieldDef?.key || ''" class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500" @change="setField(($event.target as HTMLSelectElement).value)">
          <option v-for="f in fieldsCatalog" :key="f.key" :value="f.key">{{ f.label }}</option>
        </select>
        <select :value="condition.operator" class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500" @change="setOperator(($event.target as HTMLSelectElement).value)">
          <option v-for="op in fieldDef?.operators || []" :key="op" :value="op">{{ OPERATOR_LABEL[op] || op }}</option>
        </select>
      </div>
      <button class="p-1.5 rounded shrink-0" style="color: #ef4444" @click="emit('remove')">
        <component :is="ICONS.TrashBinMinimalistic" :size="13" weight="Linear" />
      </button>
    </div>

    <div class="mt-2">
      <select v-if="fieldDef?.type === 'boolean'" :value="String(condition.value)" class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500" @change="setValue(($event.target as HTMLSelectElement).value === 'true')">
        <template v-if="fieldDef.key === 'isCompliant'">
          <option value="true">Compliant</option>
          <option value="false">Non-compliant</option>
        </template>
        <template v-else>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </template>
      </select>

      <select v-else-if="fieldDef?.type === 'select'" :value="condition.value || ''" class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500" @change="setValue(($event.target as HTMLSelectElement).value)">
        <option v-for="o in fieldDef.options || []" :key="o" :value="o">{{ o }}</option>
      </select>

      <input
        v-else-if="fieldDef?.type === 'number'"
        type="number"
        :value="condition.value ?? 0"
        class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
        @input="setValue(Number(($event.target as HTMLInputElement).value))"
      />

      <div v-else-if="fieldDef?.type === 'duration'" class="flex items-center gap-2">
        <input
          type="number"
          min="0"
          :value="condition.value?.amount ?? 1"
          class="w-24 px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          @input="setValuePatch({ amount: Number(($event.target as HTMLInputElement).value) })"
        />
        <select :value="condition.value?.unit || 'days'" class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500" @change="setValuePatch({ unit: ($event.target as HTMLSelectElement).value })">
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </div>

      <AudiencePickerField
        v-else-if="fieldDef?.type === 'device_audience'"
        :value="condition.value"
        :audiences="deviceAudiences"
        @select="setValue"
        @created="(a) => emit('audience-created', a)"
      />

      <select
        v-else-if="fieldDef?.type === 'string' && fieldDef.key === 'segmentId'"
        :value="condition.value || ''"
        class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
        @change="setValue(($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ segments.length ? "Select a Segment…" : "No Segments found" }}</option>
        <option v-for="s in segments" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>

      <TagConditionField v-else-if="fieldDef?.type === 'string' && fieldDef.key === 'tags'" :value="condition.value" :available-tags="deviceTags" @select="setValue" />

      <input
        v-else-if="fieldDef?.type === 'string'"
        :value="condition.value || ''"
        placeholder="Value…"
        class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
        @input="setValue(($event.target as HTMLInputElement).value)"
      />

      <div v-else-if="fieldDef?.type === 'smart_attribute'" class="flex items-center gap-2 flex-wrap">
        <input
          list="smart-attribute-names"
          :value="condition.value?.name || ''"
          placeholder="Attribute name, e.g. PatchLevel"
          class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          @input="setValuePatch({ name: ($event.target as HTMLInputElement).value })"
        />
        <datalist id="smart-attribute-names">
          <option v-for="n in smartAttributeNames" :key="n" :value="n" />
        </datalist>
        <input
          v-if="needsCompareValue"
          :value="condition.value?.compareValue ?? ''"
          placeholder="Expected value…"
          class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          @input="setValuePatch({ compareValue: ($event.target as HTMLInputElement).value })"
        />
      </div>

      <div v-else-if="fieldDef?.type === 'self_reported_attribute'" class="flex items-center gap-2 flex-wrap">
        <input
          list="self-reported-attribute-names"
          :value="condition.value?.name || ''"
          :placeholder="selfReportedAttributeNames.length ? 'Pick or type an attribute…' : 'Attribute name, e.g. diskEncryptionEnabled'"
          class="px-2 py-1.5 rounded-lg text-xs font-mono outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          @input="setValuePatch({ name: ($event.target as HTMLInputElement).value })"
        />
        <datalist id="self-reported-attribute-names">
          <option v-for="n in selfReportedAttributeNames" :key="n" :value="n" />
        </datalist>
        <input
          v-if="needsCompareValue"
          :value="condition.value?.compareValue ?? ''"
          placeholder="Expected value…"
          class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          @input="setValuePatch({ compareValue: ($event.target as HTMLInputElement).value })"
        />
        <p v-if="selfReportedAttributeNames.length === 0" class="text-[10px] w-full text-gray-400">No devices have reported yet — once one does, its field names appear here automatically.</p>
      </div>

      <div v-else-if="fieldDef?.type === 'custom_check_result'" class="flex items-center gap-2 flex-wrap">
        <select
          :value="condition.value?.key || ''"
          class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          @change="setValuePatch({ key: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">{{ customCheckNames.length ? "Select a check…" : "No custom checks for this platform yet" }}</option>
          <option v-for="c in customCheckNames" :key="c.key" :value="c.key">{{ c.name }}</option>
        </select>
        <input
          v-if="needsCompareValue"
          :value="condition.value?.compareValue ?? ''"
          placeholder="Expected value…"
          class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          @input="setValuePatch({ compareValue: ($event.target as HTMLInputElement).value })"
        />
        <p v-if="customCheckNames.length === 0" class="text-[10px] w-full text-gray-400">
          No custom checks defined for this platform yet — add one from Settings &gt; Custom Device Checks.
        </p>
      </div>

      <div v-else-if="fieldDef?.type === 'trigger_fired'" class="flex items-center gap-2 flex-wrap">
        <select
          :value="condition.value?.triggerId || ''"
          class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          @change="setValuePatch({ triggerId: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">{{ triggerNames.length ? "Select an inbound webhook…" : "No enabled Inbound Webhooks yet" }}</option>
          <option v-for="t in triggerNames" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
        <span class="text-xs text-gray-400">within last</span>
        <input
          type="number" min="1"
          :value="condition.value?.withinMinutes ?? ''"
          placeholder="any time"
          class="w-24 px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          @input="setValuePatch({ withinMinutes: ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null })"
        />
        <span class="text-xs text-gray-400">minutes (optional)</span>
        <p v-if="triggerNames.length === 0" class="text-[10px] w-full text-gray-400">
          No enabled Inbound Webhooks yet — add one from Settings &gt; Inbound Webhooks.
        </p>
      </div>

      <div v-else-if="fieldDef?.type === 'custom_field'" class="flex items-center gap-2 flex-wrap">
        <input
          :value="condition.value?.path || ''"
          placeholder="Field path, e.g. identifiers.udid"
          class="px-2 py-1.5 rounded-lg text-xs font-mono outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          @input="setValuePatch({ path: ($event.target as HTMLInputElement).value })"
        />
        <input
          v-if="needsCompareValue"
          :value="condition.value?.compareValue ?? ''"
          placeholder="Expected value…"
          class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500"
          @input="setValuePatch({ compareValue: ($event.target as HTMLInputElement).value })"
        />
      </div>

      <div v-else-if="fieldDef?.type === 'policy'" class="flex items-center gap-2 flex-wrap">
        <select :value="condition.value?.platform || ''" class="px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500" @change="setPolicyPlatform(($event.target as HTMLSelectElement).value)">
          <option value="">Platform…</option>
          <option v-for="p in PLATFORMS" :key="p" :value="p">{{ p }}</option>
        </select>
        <template v-if="condition.value?.platform">
          <span v-if="condition.value?.policyId" class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
            <component :is="ICONS.ShieldCheck" :size="12" weight="Linear" /> {{ condition.value.policyName }}
            <button class="hover:opacity-60" @click="setValuePatch({ policyId: null, policyName: null })"><component :is="ICONS.CloseCircle" :size="11" weight="Linear" /></button>
          </span>
          <button v-else class="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="isPickingPolicy = true">
            <component :is="ICONS.AddSquare" :size="12" weight="Linear" /> Choose policy
          </button>
        </template>
        <PolicyPickerModal
          v-if="isPickingPolicy"
          :open="true"
          :platform="condition.value?.platform"
          :exclude-ids="[]"
          @close="isPickingPolicy = false"
          @select="(p) => { isPickingPolicy = false; setValuePatch({ policyId: p.id, policyName: p.name }); }"
        />
      </div>

      <div v-else-if="fieldDef?.type === 'app_list'">
        <select :value="condition.value || ''" class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500" @change="setValue(($event.target as HTMLSelectElement).value)">
          <option value="">{{ appLists.length ? "Select an App List…" : "No App Lists yet — add one from the App Lists tab" }}</option>
          <option v-for="l in appLists" :key="l.id" :value="l.id">{{ l.name }} ({{ l.platform }})</option>
        </select>
        <p class="text-[10px] mt-1 text-gray-400">Only matches devices on the list's platform — pair with a "Platform" condition if this policy also covers other platforms.</p>
      </div>

      <div v-else-if="fieldDef?.type === 'geofence_zone'">
        <select :value="condition.value || ''" class="w-full px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-brand-500" @change="setValue(($event.target as HTMLSelectElement).value)">
          <option value="">{{ geofenceZones.length ? "Select a zone…" : "No geofence zones yet — draw one from Playground > Map View" }}</option>
          <option v-for="z in geofenceZones" :key="z.id" :value="z.id">{{ z.name }}</option>
        </select>
        <p class="text-[10px] mt-1 text-gray-400">
          Devices with no known location never match this condition (neither inside nor outside) — pair with "Has a known location on record" if you want a missing position itself to count as a violation.
        </p>
      </div>
    </div>
  </div>
</template>
