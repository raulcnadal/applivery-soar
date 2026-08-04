<script setup lang="ts">
// Chart-click results list — 1:1 port of App.jsx's `selectedWidgetItems`
// modal (~lines 5351-5395): the list of items a donut/pie/bar/gauge/list/
// progress/scorecard slice-click filters down to (see
// lib/widgetVisuals.ts's filterWidgetItemsForClick, the ported
// handleChartClick), each row clickable to drill into that one item's own
// detail modal (App.jsx's openInsight -> activeInsight, wired by the parent
// via @select-item).
import { ICONS } from "../../lib/solarIcons";
import { widgetResultRowLabel } from "../../lib/widgetVisuals";
import { useUiStore } from "../../stores/ui";
import { computed } from "vue";

const props = defineProps<{ results: { title: string; items: any[] } | null }>();
const emit = defineEmits<{ close: []; selectItem: [item: any] }>();

const uiStore = useUiStore();
const theme = computed(() => uiStore.activeTheme);

const KIND_ICON: Record<string, keyof typeof ICONS> = {
  build: "Box",
  download: "CloudDownload",
  segment: "Widget2",
  device: "Smartphone",
  app: "Box",
  user: "UserCircle",
};

function iconFor(kind: string) {
  return ICONS[KIND_ICON[kind] ?? "List"];
}

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit("close");
}
</script>

<template>
  <div v-if="results" class="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4" @click="onOverlayClick">
    <div class="w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[80vh]" :style="{ backgroundColor: theme.card, border: `1px solid ${theme.border}` }">
      <div class="flex items-center justify-between px-6 pt-5 pb-4 border-b shrink-0" :style="{ borderColor: theme.border }">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style="background-color: #0241e315">
            <component :is="ICONS.List" :size="16" weight="Linear" style="color: #0241e3" />
          </div>
          <div class="min-w-0">
            <p class="text-base font-semibold truncate" :style="{ color: theme.text }">{{ results.title }}</p>
            <p class="text-xs" :style="{ color: theme.textMuted }">{{ results.items.length }} items found</p>
          </div>
        </div>
        <button type="button" class="w-8 h-8 flex items-center justify-center rounded-full hover:opacity-70 transition-opacity ml-3 shrink-0" :style="{ color: theme.textMuted, backgroundColor: `${theme.textMuted}12` }" @click="emit('close')">
          <component :is="ICONS.CloseCircle" :size="15" weight="Linear" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
        <button
          v-for="(item, idx) in results.items"
          :key="item.id || item._id || idx"
          type="button"
          class="flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors hover:opacity-80"
          :style="{ borderColor: theme.border, backgroundColor: theme.bg }"
          @click="emit('selectItem', item)"
        >
          <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background-color: #0241e312">
            <component :is="iconFor(widgetResultRowLabel(item).kind)" :size="14" weight="Linear" style="color: #0241e3" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate" :style="{ color: theme.text }">{{ widgetResultRowLabel(item).label }}</p>
            <p v-if="widgetResultRowLabel(item).subLabel" class="text-xs truncate" :style="{ color: theme.textMuted }">{{ widgetResultRowLabel(item).subLabel }}</p>
          </div>
        </button>
        <p v-if="!results.items.length" class="text-sm text-center py-8" :style="{ color: theme.textMuted }">No items match this selection.</p>
      </div>
    </div>
  </div>
</template>
