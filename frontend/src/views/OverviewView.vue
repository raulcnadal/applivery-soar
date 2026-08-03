<script setup lang="ts">
// Real Overview dashboard — 1:1 port of App.jsx's Dashboard() 'overview'
// view (drag/resize widget grid persisted through /api/state's `dashboard`
// field). Rebuilt against a line-by-line read of the original plus a live
// side-by-side comparison against the running original app, after the first
// pass (icon-badge header only) was judged not close enough.
import { Alert, Button, EmptyState, PageHeader } from "@applivery/bluesky-vue";
import { GridLayout, GridItem } from "grid-layout-plus";
import { ICONS, resolveIcon } from "../lib/solarIcons";
import { onMounted, reactive, ref, watch } from "vue";
import HelpIcon from "../components/shared/HelpIcon.vue";
import WidgetCard from "../components/overview/WidgetCard.vue";
import WidgetBuilderPanel from "../components/overview/WidgetBuilderPanel.vue";
import DateRangePicker, { type DateRangeValue } from "../components/overview/DateRangePicker.vue";
import { useDashboardStateStore } from "../stores/dashboardState";
import { useSegmentsStore } from "../stores/segments";
import { WIDGET_ICON_MAP, DEFAULT_WIDGET_ICON, WIDGET_SIZES, type DashboardWidget, type GridLayoutItem } from "../lib/analyticsCatalog";
import { fetchWidgetData, type WidgetResponse } from "../lib/widgetData";

// App.jsx's PRIMARY_BLUE (~line 20) — the one consistent brand accent used
// throughout the Overview page's chrome (buttons, icon badges, menus).
const PRIMARY_BLUE = "#0241E3";

const store = useDashboardStateStore();
const segmentsStore = useSegmentsStore();

const widgets = ref<DashboardWidget[]>([]);
const layout = ref<GridLayoutItem[]>([]);
const isDirty = ref(false);

// 1:1 port of overviewDateRange's initial state (App.jsx:2947).
const dateRange = ref<DateRangeValue>({ label: "Last 30 Days", from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), to: new Date() });
const isDateRangeOpen = ref(false);

function fmtRangeDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function onApplyDateRange(v: DateRangeValue) {
  dateRange.value = v;
  isDateRangeOpen.value = false;
  loadAllWidgets();
}

interface WidgetSlot {
  data: WidgetResponse | null;
  isLoading: boolean;
  error: string | null;
}
const widgetSlots = reactive<Record<string, WidgetSlot>>({});

async function loadWidget(w: DashboardWidget) {
  widgetSlots[w.id] = widgetSlots[w.id] ?? { data: null, isLoading: true, error: null };
  widgetSlots[w.id].isLoading = true;
  widgetSlots[w.id].error = null;
  try {
    const dateIni = dateRange.value.from.toISOString().slice(0, 10);
    const dateEnd = dateRange.value.to.toISOString().slice(0, 10);
    // Segment scoping — merged into each widget's own filters, same shape
    // the backend already expects (App.jsx:3543-3573's filters.segmentId).
    const segmentId = String(segmentsStore.selectedSegment.id) !== "0" ? segmentsStore.selectedSegment.id : undefined;
    widgetSlots[w.id].data = await fetchWidgetData(w.stat, { ...w.filters, segmentId }, dateIni, dateEnd);
  } catch (err: any) {
    widgetSlots[w.id].error = err?.response?.data?.detail || "Failed to load.";
  } finally {
    widgetSlots[w.id].isLoading = false;
  }
}

async function loadAllWidgets() {
  await Promise.all(widgets.value.map((w) => loadWidget(w)));
}

onMounted(async () => {
  if (!store.isLoaded) await store.fetchState();
  widgets.value = store.dashboard.widgets.map((w) => ({ ...w }));
  layout.value = store.dashboard.layout.map((l) => ({ ...l }));
  await loadAllWidgets();
  // Same 60s auto-refresh as the original's setInterval(fetchWidgetData, 60000).
  window.setInterval(loadAllWidgets, 60_000);
});

// Re-fetch every widget when the Segments panel selection changes
// (App.jsx's own widget-fetch effect depends on selectedSegment too).
watch(
  () => segmentsStore.selectedSegment,
  () => loadAllWidgets(),
);

// grid-layout-plus emits "layout-updated" after every internal compact
// pass — including the automatic one that runs right after mount, not just
// genuine user drag/resize edits. Reassigning `layout.value` unconditionally
// here created an infinite reactive loop: the new array reference feeds
// back into GridLayout's `v-model:layout` prop, which the library's own
// `watch(() => [layout, layout.length], ...)` picks up (array reference
// always differs, even when content is identical), triggering another
// internal compact + "layout-updated" emit, which reassigns `layout.value`
// again, forever — a genuine unyielding freeze (confirmed by reproducing
// this exact watch/emit cycle in isolation with Vue's reactivity system
// directly; grid-layout-plus's compact()/correctBounds() themselves return
// instantly and were not the culprit despite superficially looking like
// one). Only reassigning when the content actually changed lets the loop
// settle after its first (mount-time) cycle, same as any normal v-model
// consumer should.
function onLayoutUpdated(next: GridLayoutItem[]) {
  const normalized = next.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h, static: !!l.static }));
  const current = layout.value;
  const unchanged =
    normalized.length === current.length &&
    normalized.every((l, idx) => {
      const c = current[idx];
      return c && c.i === l.i && c.x === l.x && c.y === l.y && c.w === l.w && c.h === l.h && !!c.static === l.static;
    });
  if (unchanged) return;
  layout.value = normalized;
  isDirty.value = true;
}

async function saveDashboard() {
  await store.saveDashboard({ widgets: widgets.value, layout: layout.value });
  isDirty.value = false;
}

function removeWidget(id: string) {
  widgets.value = widgets.value.filter((w) => w.id !== id);
  layout.value = layout.value.filter((l) => l.i !== id);
  delete widgetSlots[id];
  isDirty.value = true;
  openMenuFor.value = null;
}

// 1:1 port of WidgetOptionsMenu's five actions (App.jsx ~539-570): Hide and
// Remove both call the same handler in the original (removeWidget) — kept
// as two entries here too, for visual/behavioral parity, not because they
// differ. Move is a genuine no-op in the original as well (dragging the
// card body is how you actually move it); kept as a no-op here too.
const openMenuFor = ref<string | null>(null);
function toggleMenu(id: string) {
  openMenuFor.value = openMenuFor.value === id ? null : id;
}
function closeMenu() {
  openMenuFor.value = null;
}
function toggleWidgetLock(id: string) {
  const item = layout.value.find((l) => l.i === id);
  if (item) item.static = !item.static;
  isDirty.value = true;
  openMenuFor.value = null;
}
function isWidgetLocked(id: string): boolean {
  return !!layout.value.find((l) => l.i === id)?.static;
}
function iconFor(stat: string) {
  const def = WIDGET_ICON_MAP[stat] ?? DEFAULT_WIDGET_ICON;
  return { component: resolveIcon(def.icon), color: def.color, bg: def.bg };
}

// ── Widget info popover — a simplified stand-in for the original's
// full zoomed-chart WidgetInfoModal (App.jsx's WidgetInfoModal re-renders
// the chart full-size with a description). Not yet ported 1:1; this shows
// the same underlying metadata (source, chart type, date range, filters)
// without the full chart replay, until that follow-up pass happens. ──
const infoFor = ref<string | null>(null);
function toggleInfo(id: string) {
  infoFor.value = infoFor.value === id ? null : id;
}

// ── Add / Edit widget builder panel ──
const editingWidget = ref<DashboardWidget | null>(null);
const isBuilderOpen = ref(false);

function nextGridY(): number {
  return layout.value.length ? Math.max(...layout.value.map((l) => l.y + l.h)) : 0;
}

function openBuilder(widget?: DashboardWidget) {
  closeMenu();
  editingWidget.value = widget ? { ...widget, filters: { ...widget.filters } } : { id: "", title: "New metric", stat: "mdm_devices", type: "scorecard", size: "small", filters: {} };
  isBuilderOpen.value = true;
}
function closeBuilder() {
  isBuilderOpen.value = false;
}

async function saveWidgetForm(w: DashboardWidget) {
  const sizeDef = WIDGET_SIZES.find((s) => s.id === w.size)!;
  if (w.id) {
    widgets.value = widgets.value.map((x) => (x.id === w.id ? { ...w } : x));
    layout.value = layout.value.map((l) => (l.i === w.id ? { ...l, w: sizeDef.w, h: sizeDef.h } : l));
    isDirty.value = true;
    isBuilderOpen.value = false;
    await loadWidget(w);
  } else {
    const id = `w-${Date.now()}`;
    const widget: DashboardWidget = { ...w, id };
    widgets.value = [...widgets.value, widget];
    layout.value = [...layout.value, { i: id, x: 0, y: nextGridY(), w: sizeDef.w, h: sizeDef.h }];
    isDirty.value = true;
    isBuilderOpen.value = false;
    await loadWidget(widget);
  }
}
</script>

<template>
  <div class="p-8 pb-16 space-y-6 animate-page-enter">
    <!-- 1:1 port of the Overview header (App.jsx ~4514-4562): title + help
         icon + subtitle on the left, Add Widget (text-only) + date-range
         (solid brand-600) + conditional Save Changes on the right. No
         Edit-layout toggle in the original — drag/resize is always on,
         gated per-card only by that card's own lock state. -->
    <PageHeader
      title="Dashboard Overview"
      :description="String(segmentsStore.selectedSegment.id) !== '0' ? `Filtered to segment: ${segmentsStore.selectedSegment.name}` : `Welcome back! Here's what's happening today.`"
    >
      <template #title-suffix>
        <HelpIcon slug="overview" title="Overview admin guide" />
        <span
          v-if="String(segmentsStore.selectedSegment.id) !== '0'"
          class="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
          :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }"
        >
          <component :is="ICONS.Layers" :size="10" weight="Linear" /> {{ segmentsStore.selectedSegment.name }}
        </span>
      </template>
      <template #action>
        <div class="flex items-center gap-3">
          <button type="button" class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80" :style="{ color: PRIMARY_BLUE }" @click="openBuilder()">
            <component :is="ICONS.AddCircle" :size="15" weight="Linear" />
            Add Widget
          </button>
          <div class="relative">
            <button type="button" class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors" :style="{ backgroundColor: PRIMARY_BLUE }" @click="isDateRangeOpen = !isDateRangeOpen">
              <component :is="ICONS.Calendar" :size="15" weight="Linear" />
              <span>{{ fmtRangeDate(dateRange.from) }} – {{ fmtRangeDate(dateRange.to) }}</span>
            </button>
            <div v-if="isDateRangeOpen" class="fixed inset-0 z-[299]" @click="isDateRangeOpen = false" />
            <DateRangePicker v-if="isDateRangeOpen" :value="dateRange" :primary-blue="PRIMARY_BLUE" @apply="onApplyDateRange" @cancel="isDateRangeOpen = false" />
          </div>
          <button v-if="isDirty" type="button" class="flex items-center gap-2 px-5 py-2 rounded-lg font-medium text-sm text-white transition-colors" :style="{ backgroundColor: PRIMARY_BLUE }" :disabled="store.isSaving" @click="saveDashboard">
            {{ store.isSaving ? "Saving…" : "Save Changes" }}
          </button>
        </div>
      </template>
    </PageHeader>

    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <EmptyState v-if="!widgets.length" title="No widgets yet" description="Add your first widget to get started.">
      <template #action><Button size="sm" @click="openBuilder()">Add Widget</Button></template>
    </EmptyState>

    <GridLayout
      v-else
      v-model:layout="layout"
      :col-num="12"
      :row-height="60"
      :is-draggable="true"
      :is-resizable="true"
      :margin="[16, 16]"
      :vertical-compact="true"
      :use-css-transforms="true"
      @layout-updated="onLayoutUpdated"
    >
      <GridItem v-for="item in layout" :key="item.i" :i="item.i" :x="item.x" :y="item.y" :w="item.w" :h="item.h" :static="item.static" drag-allow-from=".drag-handle">
        <!-- 1:1 port of WidgetCardShell + WidgetHeader (App.jsx ~449-533):
             rounded-2xl card, icon badge tinted per data source, info +
             options-menu buttons. The grid drag handle is the card body
             (App.jsx's draggableHandle=".drag-handle" on the content div),
             not the header — so header buttons stay clickable while
             dragging is active. -->
        <div class="h-full w-full rounded-2xl border border-gray-200 shadow-sm bg-white flex flex-col overflow-visible relative">
          <div class="px-5 pt-4 pb-3 flex justify-between items-center shrink-0 border-b" style="border-color: #e9eaec4d">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: iconFor(widgets.find((w) => w.id === item.i)?.stat ?? '').bg, color: iconFor(widgets.find((w) => w.id === item.i)?.stat ?? '').color }">
                <component :is="iconFor(widgets.find((w) => w.id === item.i)?.stat ?? '').component" :size="15" weight="Linear" />
              </div>
              <span class="text-[13px] font-medium text-gray-900 truncate">{{ widgets.find((w) => w.id === item.i)?.title }}</span>
            </div>
            <div class="flex items-center gap-1 shrink-0 ml-2">
              <div class="relative">
                <button type="button" class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 transition-colors text-gray-500" @click="toggleInfo(item.i)">
                  <component :is="ICONS.InfoCircle" :size="13" weight="Linear" />
                </button>
                <div v-if="infoFor === item.i" class="fixed inset-0 z-[199]" @click="infoFor = null" />
                <div v-if="infoFor === item.i" class="absolute right-0 top-full mt-1 w-64 rounded-xl shadow-xl border border-gray-100 bg-white z-[200] p-4 text-[12px] text-gray-600 space-y-1.5">
                  <p class="font-semibold text-gray-900 text-[13px]">{{ widgets.find((w) => w.id === item.i)?.title }}</p>
                  <p>Source: <span class="text-gray-900 font-medium">{{ widgets.find((w) => w.id === item.i)?.stat }}</span></p>
                  <p>Chart: <span class="text-gray-900 font-medium capitalize">{{ widgets.find((w) => w.id === item.i)?.type }}</span></p>
                  <p>Range: <span class="text-gray-900 font-medium">{{ fmtRangeDate(dateRange.from) }} – {{ fmtRangeDate(dateRange.to) }}</span></p>
                </div>
              </div>
              <div class="relative">
                <button
                  type="button"
                  class="w-6 h-6 flex items-center justify-center rounded-md transition-colors"
                  :style="{ color: '#6B7280', backgroundColor: openMenuFor === item.i ? PRIMARY_BLUE + '12' : 'transparent' }"
                  @click="toggleMenu(item.i)"
                >
                  <component :is="ICONS.MenuDots" :size="14" weight="Linear" />
                </button>
                <div v-if="openMenuFor === item.i" class="fixed inset-0 z-[199]" @click="closeMenu" />
                <div v-if="openMenuFor === item.i" class="absolute right-0 top-full mt-1 rounded-xl z-[200] min-w-[168px] flex flex-col py-1.5 overflow-hidden bg-white border border-gray-100 shadow-xl">
                  <button type="button" class="flex items-center gap-2.5 px-3 py-2 w-full text-left transition-colors hover:opacity-80 text-gray-900" @click="removeWidget(item.i)">
                    <component :is="ICONS.EyeClosed" :size="13" weight="Linear" class="text-gray-400" />
                    <span class="text-[13px] font-normal">Hide widget</span>
                  </button>
                  <button type="button" class="flex items-center gap-2.5 px-3 py-2 w-full text-left transition-colors hover:opacity-80 text-gray-900" @click="closeMenu">
                    <component :is="ICONS.TransferHorizontal" :size="13" weight="Linear" class="text-gray-400" />
                    <span class="text-[13px] font-normal">Move widget</span>
                  </button>
                  <button type="button" class="flex items-center gap-2.5 px-3 py-2 w-full text-left transition-colors hover:opacity-80 text-gray-900" @click="openBuilder(widgets.find((w) => w.id === item.i)!)">
                    <component :is="ICONS.Pen" :size="13" weight="Linear" class="text-gray-400" />
                    <span class="text-[13px] font-normal">Edit widget</span>
                  </button>
                  <button type="button" class="flex items-center gap-2.5 px-3 py-2 w-full text-left transition-colors hover:opacity-80 text-gray-900" @click="toggleWidgetLock(item.i)">
                    <component :is="isWidgetLocked(item.i) ? ICONS.LockUnlocked : ICONS.Lock" :size="13" weight="Linear" class="text-gray-400" />
                    <span class="text-[13px] font-normal">{{ isWidgetLocked(item.i) ? "Unlock position" : "Lock position" }}</span>
                  </button>
                  <div class="h-px mx-3 my-1 bg-gray-100" />
                  <button type="button" class="flex items-center gap-2.5 px-3 py-2 w-full text-left transition-colors hover:opacity-80" style="color: #ef4444" @click="removeWidget(item.i)">
                    <component :is="ICONS.TrashBinTrash" :size="13" weight="Linear" style="color: #ef4444" />
                    <span class="text-[13px] font-normal">Remove widget</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="flex-1 px-4 pb-4 pt-3 relative min-h-0" :class="!isWidgetLocked(item.i) ? 'drag-handle cursor-move' : ''">
            <WidgetCard
              v-if="widgets.find((w) => w.id === item.i)"
              :widget="widgets.find((w) => w.id === item.i)!"
              :data="widgetSlots[item.i]?.data ?? null"
              :is-loading="widgetSlots[item.i]?.isLoading ?? true"
              :error="widgetSlots[item.i]?.error ?? null"
            />
          </div>
        </div>
      </GridItem>
    </GridLayout>

    <WidgetBuilderPanel :open="isBuilderOpen" :widget="editingWidget" @close="closeBuilder" @save="saveWidgetForm" />
  </div>
</template>
