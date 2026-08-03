<script setup lang="ts">
// One recursive row of the Segments panel's tree — port of App.jsx's
// renderSegmentNode (App.jsx:4279-4320). Vue SFCs auto-register themselves
// under their own filename for recursive use, so this component can
// reference itself in its own template without an explicit import.
import { ICONS } from "../../lib/solarIcons";
import { getSegmentColor, getSegmentIcon } from "../../lib/segmentVisuals";
import { useSegmentsStore, type SegmentTreeNode } from "../../stores/segments";

const PRIMARY_BLUE = "#0241E3";

const props = defineProps<{ node: SegmentTreeNode; level: number }>();
const store = useSegmentsStore();

function isSelected() {
  return String(store.selectedSegment.id) === props.node.id;
}
function hasChildren() {
  return (props.node.children ?? []).length > 0;
}
function isExpanded() {
  return store.expanded[props.node.id] !== false;
}
function onToggleExpand(e: Event) {
  e.stopPropagation();
  store.toggleExpanded(props.node.id);
}
</script>

<template>
  <div>
    <div
      class="flex items-center py-2 cursor-pointer transition-colors mx-4 rounded-lg"
      :class="isSelected() ? 'font-medium' : 'hover:bg-black/5'"
      :style="{ paddingLeft: `${4 + level * 24}px`, paddingRight: '12px', backgroundColor: isSelected() ? `${PRIMARY_BLUE}15` : 'transparent' }"
      @click="store.select({ id: node.id, name: node.name })"
    >
      <div class="w-5 h-5 flex items-center justify-center shrink-0 mr-1" @click="hasChildren() ? onToggleExpand($event) : undefined">
        <template v-if="hasChildren()">
          <component :is="isExpanded() ? ICONS.AltArrowDown : ICONS.AltArrowRight" :size="14" weight="Linear" />
        </template>
        <div v-else class="w-3.5" />
      </div>
      <div class="flex items-center gap-2 overflow-hidden w-full">
        <component :is="getSegmentIcon(node.icon)" :size="16" weight="Linear" :style="{ color: isSelected() ? PRIMARY_BLUE : getSegmentColor(node.color) }" />
        <span class="text-sm truncate" :style="{ color: isSelected() ? PRIMARY_BLUE : '#111827' }">{{ node.name }}</span>
      </div>
    </div>

    <div v-if="store.showChildren && hasChildren() && isExpanded()" class="flex flex-col">
      <SegmentTreeRow v-for="child in node.children" :key="child.id" :node="child" :level="level + 1" />
    </div>
  </div>
</template>
