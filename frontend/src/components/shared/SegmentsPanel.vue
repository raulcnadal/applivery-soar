<script setup lang="ts">
// The Segments panel — a hover-reveal 320px sidebar on the far-left edge,
// visible on Overview/Devices/Compliance/Cases. Port of App.jsx:4462-4515.
// A thin invisible hover strip (App.jsx:4462) opens the panel; the panel
// itself closes on mouse-leave or its own collapse button. Global is a
// hardcoded pseudo-node (never part of the fetched tree, App.jsx:4489-4492)
// rendered above the real, recursively-rendered segment tree.
import { computed } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { GLOBAL_SEGMENT, useSegmentsStore, type SegmentTreeNode } from "../../stores/segments";
import SegmentTreeRow from "./SegmentTreeRow.vue";

const PRIMARY_BLUE = "#0241E3";

const props = defineProps<{ views: string[]; currentView: string }>();
const store = useSegmentsStore();

const visible = computed(() => props.views.includes(props.currentView));

function onHoverEdge() {
  if (visible.value) store.isPanelOpen = true;
}

// Client-side, recursive substring filter over the already-fetched tree —
// no search API call (App.jsx:4497-4506/4306-4317). A parent stays visible
// if it matches OR any descendant matches, so matching children stay
// reachable even if their ancestor's own name doesn't match.
function filterTree(nodes: SegmentTreeNode[], term: string): SegmentTreeNode[] {
  if (!term) return nodes;
  const out: SegmentTreeNode[] = [];
  for (const n of nodes) {
    const matches = n.name?.toLowerCase().includes(term);
    const children = filterTree(n.children ?? [], term);
    if (matches || children.length > 0) out.push({ ...n, children });
  }
  return out;
}
const displayNodes = computed(() => filterTree(store.tree, store.search.toLowerCase()));
</script>

<template>
  <div class="fixed left-0 top-0 bottom-0 w-4 z-[140]" @mouseenter="onHoverEdge" />

  <div
    class="fixed left-0 top-0 bottom-0 w-80 shadow-2xl z-[150] transform transition-transform duration-300 flex flex-col border-r bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
    :class="store.isPanelOpen && visible ? 'translate-x-0' : '-translate-x-full'"
    @mouseleave="store.isPanelOpen = false"
  >
    <div class="p-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm font-semibold text-gray-900 dark:text-white">Segments</span>
        <button
          v-if="String(store.selectedSegment.id) !== '0'"
          class="text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors hover:opacity-80"
          :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }"
          @click="store.reset()"
        >
          Reset
        </button>
      </div>
      <div class="relative">
        <component :is="ICONS.Magnifer" :size="14" weight="Linear" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          v-model="store.search"
          type="text"
          placeholder="Search segments..."
          class="w-full pl-9 pr-4 py-2 rounded-lg text-sm border outline-none focus:border-blue-500 focus:ring-2 focus:ring-brand-500 transition-colors border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white"
        />
      </div>
      <div class="flex items-center justify-between mt-3">
        <span class="text-sm font-medium text-gray-900 dark:text-white">Show children elements</span>
        <button
          class="w-10 h-5 rounded-full relative transition-colors"
          :class="store.showChildren ? 'bg-blue-600' : 'bg-gray-300'"
          @click="store.showChildren = !store.showChildren"
        >
          <div class="absolute top-0.5 w-4 h-4 rounded-full bg-white dark:bg-gray-800 transition-transform" :style="{ transform: store.showChildren ? 'translateX(22px)' : 'translateX(2px)' }" />
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto py-2">
      <!-- Global — hardcoded, not part of the fetched tree (App.jsx:4489-4492) -->
      <div
        class="flex items-center py-2 cursor-pointer transition-colors mx-4 rounded-lg"
        :class="String(store.selectedSegment.id) === '0' ? 'font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'"
        :style="{ paddingLeft: '4px', paddingRight: '12px', backgroundColor: String(store.selectedSegment.id) === '0' ? `${PRIMARY_BLUE}15` : 'transparent' }"
        @click="store.select(GLOBAL_SEGMENT)"
      >
        <div class="w-5 h-5 flex items-center justify-center shrink-0 mr-1"><div class="w-3.5" /></div>
        <div class="flex items-center gap-2 overflow-hidden w-full">
          <component :is="ICONS.Global" :size="16" weight="Linear" :style="{ color: String(store.selectedSegment.id) === '0' ? PRIMARY_BLUE : '#9CA3AF' }" />
          <span class="text-sm truncate" :style="{ color: String(store.selectedSegment.id) === '0' ? PRIMARY_BLUE : 'var(--foreground)' }">Global</span>
        </div>
      </div>

      <SegmentTreeRow v-for="node in displayNodes" :key="node.id" :node="node" :level="0" />
    </div>

    <button
      class="absolute -right-4 bottom-10 w-8 h-8 border rounded-full shadow-md flex items-center justify-center z-50 hover:opacity-80 transition-opacity bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
      :style="{ color: PRIMARY_BLUE }"
      @click="store.isPanelOpen = false"
    >
      <component :is="ICONS.AltArrowLeft" :size="16" weight="Linear" />
    </button>
  </div>
</template>
