<script setup lang="ts">
// Compliance Policy template gallery — curated per-framework (ISO 27001,
// ENS, NIS2) starting-point condition sets. "Use template" opens the Policy
// Builder pre-filled with that template's conditions, so the admin can
// tweak before saving rather than creating a hidden/opaque policy.
import { Button, StatusPill } from "@applivery/bluesky-vue";
import { onMounted, ref } from "vue";
import { useComplianceStore, type ComplianceTemplate } from "../../stores/compliance";

const emit = defineEmits<{
  use: [template: ComplianceTemplate];
}>();

const store = useComplianceStore();
const frameworkFilter = ref<string>("");

onMounted(async () => {
  if (store.templates.length === 0) await store.fetchTemplates();
});

const SEVERITY_COLOR: Record<string, "green" | "yellow" | "orange" | "red"> = {
  low: "green", medium: "yellow", high: "orange", critical: "red",
};

function frameworkName(key: string): string {
  return store.frameworks.find((f) => f.key === key)?.name ?? key;
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap gap-2">
      <button
        v-for="fw in [{ key: '', name: 'All frameworks' }, ...store.frameworks]"
        :key="fw.key"
        type="button"
        class="text-xs px-3 py-1.5 rounded-full border"
        :class="frameworkFilter === fw.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200'"
        @click="frameworkFilter = fw.key"
      >
        {{ fw.name }}
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div
        v-for="t in store.templates.filter((tpl) => !frameworkFilter || tpl.framework === frameworkFilter)"
        :key="t.id"
        class="border border-gray-200 rounded-xl p-4 bg-white space-y-2"
      >
        <div class="flex items-center justify-between">
          <StatusPill :label="frameworkName(t.framework)" color="brand" />
          <StatusPill :label="t.severity" :color="SEVERITY_COLOR[t.severity] ?? 'gray'" />
        </div>
        <p class="font-medium text-gray-900">{{ t.title }}</p>
        <p class="text-xs text-gray-400">{{ t.controlRef }}</p>
        <p class="text-sm text-gray-600">{{ t.description }}</p>
        <p class="text-xs text-gray-400">{{ t.conditions.length }} condition(s), match {{ t.conditionLogic }}</p>
        <Button size="sm" @click="emit('use', t)">Use this template</Button>
      </div>
    </div>
  </div>
</template>
