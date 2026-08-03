<script setup lang="ts">
// Port of SegmentPickerModal + flattenSegments (DevicePickers.jsx:32-79).
// Used by the device drawer's "Segment" section and the fleet table's bulk
// "Move segment…" action.
import { Modal } from "@applivery/bluesky-vue";
import { computed, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { flattenSegments, type SegmentNode } from "../../lib/segments";

const PRIMARY_BLUE = "#0241E3";

const props = defineProps<{ open: boolean; segments: SegmentNode[]; currentSegmentId: string | number | null }>();
const emit = defineEmits<{ close: []; select: [segment: SegmentNode] }>();

const search = ref("");

const flat = computed(() => [{ id: 0, name: "Global", depth: 0 } as SegmentNode & { depth: number }, ...flattenSegments(props.segments)]);
const filtered = computed(() => flat.value.filter((s) => (s.name || "").toLowerCase().includes(search.value.toLowerCase())));

function isCurrent(s: SegmentNode) {
  return String(s.id) === String(props.currentSegmentId ?? 0);
}
</script>

<template>
  <Modal :open="open" title="Move to segment" size="md" @close="emit('close')">
    <div class="relative mb-3">
      <component :is="ICONS.Magnifer" :size="14" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
      <input
        v-model="search"
        autofocus
        placeholder="Search segments…"
        class="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
      />
    </div>
    <div class="space-y-1 max-h-[50vh] overflow-y-auto">
      <button
        v-for="s in filtered"
        :key="`${s.id}-${s.depth}`"
        :disabled="isCurrent(s)"
        class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors disabled:opacity-40"
        :class="isCurrent(s) ? 'bg-gray-50 dark:bg-gray-900/50' : 'hover:bg-gray-50 dark:hover:bg-white/5'"
        :style="{ paddingLeft: `${12 + s.depth * 16}px` }"
        @click="emit('select', s)"
      >
        <component :is="ICONS.Layers" :size="13" weight="Linear" class="text-gray-400" />
        <span class="text-gray-900 dark:text-white">{{ s.name || "Unnamed" }}</span>
        <span v-if="isCurrent(s)" class="ml-auto text-[10px] font-semibold" :style="{ color: PRIMARY_BLUE }">Current</span>
      </button>
      <p v-if="filtered.length === 0" class="text-xs text-center py-6 text-gray-400">No segments match "{{ search }}"</p>
    </div>
  </Modal>
</template>
