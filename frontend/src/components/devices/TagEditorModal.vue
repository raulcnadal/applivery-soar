<script setup lang="ts">
// Port of TagEditorModal (DevicePickers.jsx:174-222).
import { Modal } from "@applivery/bluesky-vue";
import { ref, watch } from "vue";
import { ICONS } from "../../lib/solarIcons";

const PRIMARY_BLUE = "#0241E3";

const props = defineProps<{ open: boolean; initialTags: string[] }>();
const emit = defineEmits<{ close: []; save: [tags: string[]] }>();

const tags = ref<string[]>([...props.initialTags]);
const draft = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) {
      tags.value = [...props.initialTags];
      draft.value = "";
    }
  },
);

function addTag() {
  const v = draft.value.trim();
  if (v && !tags.value.includes(v)) tags.value.push(v);
  draft.value = "";
}

function removeTag(t: string) {
  tags.value = tags.value.filter((x) => x !== t);
}
</script>

<template>
  <Modal :open="open" title="Edit tags" size="md" @close="emit('close')">
    <div class="flex flex-wrap gap-1.5 mb-3 min-h-[32px]">
      <span
        v-for="t in tags"
        :key="t"
        class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold uppercase"
        :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }"
      >
        {{ t }}
        <button class="hover:opacity-60" @click="removeTag(t)">
          <component :is="ICONS.CloseCircle" :size="11" weight="Linear" />
        </button>
      </span>
      <span v-if="tags.length === 0" class="text-xs text-gray-400">No tags yet</span>
    </div>
    <div class="flex items-center gap-2">
      <input
        v-model="draft"
        autofocus
        placeholder="Add a tag and press Enter…"
        class="flex-1 px-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
        @keydown.enter.prevent="addTag"
      />
      <button
        class="p-2 rounded-lg text-white shrink-0 bg-brand-600 hover:bg-brand-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
        @click="addTag"
      >
        <component :is="ICONS.AddSquare" :size="16" weight="Linear" />
      </button>
    </div>
    <div class="flex gap-3 justify-end pt-4">
      <button class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200" @click="emit('close')">Cancel</button>
      <button
        class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        @click="emit('save', tags)"
      >
        Save
      </button>
    </div>
  </Modal>
</template>
