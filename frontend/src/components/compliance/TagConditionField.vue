<script setup lang="ts">
// Port of TagConditionField (DevicePickers.jsx:574-620) — a tag <select>
// that switches to a free-text "create new tag" input when the current
// value isn't one of the known device tags yet.
import { ref } from "vue";
import { ICONS } from "../../lib/solarIcons";

const props = defineProps<{ value: string; availableTags: string[] }>();
const emit = defineEmits<{ select: [value: string] }>();

const isAdding = ref(false);
const draft = ref("");

function knownValue() {
  return !!props.value && props.availableTags.includes(props.value);
}

function onSelectChange(v: string) {
  if (v === "__new__") {
    isAdding.value = true;
    draft.value = "";
  } else {
    emit("select", v);
  }
}

function confirmDraft() {
  if (draft.value.trim()) {
    emit("select", draft.value.trim());
    isAdding.value = false;
    draft.value = "";
  }
}
</script>

<template>
  <div v-if="isAdding || (value && !knownValue())" class="flex items-center gap-2">
    <div class="relative flex-1">
      <component :is="ICONS.Tag" :size="13" weight="Linear" class="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
      <input
        autofocus
        :value="isAdding ? draft : value"
        placeholder="New tag name…"
        class="w-full pl-7 pr-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 focus:ring-2 focus:ring-brand-500"
        @input="isAdding ? (draft = ($event.target as HTMLInputElement).value) : emit('select', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <button v-if="isAdding" type="button" class="px-2 py-1.5 rounded-lg text-xs font-medium text-white shrink-0 bg-brand-600 hover:bg-brand-700" @click="confirmDraft">Use</button>
  </div>
  <div v-else class="flex items-center gap-2">
    <select :value="value || ''" class="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none border border-gray-200 bg-white focus:ring-2 focus:ring-brand-500" @change="onSelectChange(($event.target as HTMLSelectElement).value)">
      <option value="">{{ availableTags.length ? "Select a tag…" : "No tags found" }}</option>
      <option v-for="t in availableTags" :key="t" :value="t">{{ t }}</option>
      <option value="__new__">+ Create new tag…</option>
    </select>
  </div>
</template>
