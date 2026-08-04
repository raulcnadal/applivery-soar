<script setup lang="ts">
// 1:1 port of RolesSettings.jsx's TagValuesEditor (~line 51) — a free-form
// tag/value picker for a Role's `appliveryTagValues`. Shows already-added
// values as removable pills, always lets the admin type an arbitrary value
// (there's no confirmed Applivery API to "create" a Collaborator tag), and
// surfaces already-known values from the live Collaborators directory as
// one-click suggestions.
import { computed, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";

const props = defineProps<{ modelValue: string[]; suggestions: string[] }>();
const emit = defineEmits<{ "update:modelValue": [string[]] }>();

const draft = ref("");

function addValue(v?: string) {
  const val = (v ?? draft.value).trim();
  if (!val || props.modelValue.includes(val)) return;
  emit("update:modelValue", [...props.modelValue, val]);
  draft.value = "";
}
function removeValue(v: string) {
  emit("update:modelValue", props.modelValue.filter((x) => x !== v));
}

const unusedSuggestions = computed(() => props.suggestions.filter((s) => !props.modelValue.includes(s)));
</script>

<template>
  <div>
    <div class="flex flex-wrap gap-1.5 mb-2">
      <span
        v-for="v in modelValue"
        :key="v"
        class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300"
      >
        <component :is="ICONS.Tag" :size="11" weight="Linear" /> {{ v }}
        <button type="button" class="ml-0.5 opacity-60 hover:opacity-100" @click="removeValue(v)">×</button>
      </span>
      <span v-if="!modelValue.length" class="text-[11px] text-gray-400">No tag values yet — add one below.</span>
    </div>
    <div class="flex gap-2">
      <input
        v-model="draft"
        placeholder="Type a tag/group value and press Enter…"
        class="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
        @keydown.enter.prevent="addValue()"
      />
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200"
        @click="addValue()"
      >
        Add
      </button>
    </div>
    <div v-if="unusedSuggestions.length" class="mt-2">
      <p class="text-[10px] mb-1 text-gray-400">Seen on live collaborators:</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="s in unusedSuggestions"
          :key="s"
          type="button"
          class="px-2 py-1 rounded-full text-[11px] font-medium border border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400"
          @click="addValue(s)"
        >
          + {{ s }}
        </button>
      </div>
    </div>
  </div>
</template>
