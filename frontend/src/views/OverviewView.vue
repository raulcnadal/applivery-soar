<script setup lang="ts">
// Real Overview dashboard — port of App.jsx's Overview view (drag/resize
// widget grid persisted through /api/state's `dashboard` field). Phase 0's
// placeholder is fully replaced here (see migration-plan.md §8 Phase 7).
import { Alert, Button, Card, EmptyState, PageHeader, RichSelect } from "@applivery/bluesky-vue";
import { GridLayout, GridItem } from "grid-layout-plus";
import { AddCircle, Calendar, EyeClosed, Lock, LockUnlocked, MenuDots, Widget as WidgetIcon } from "@solar-icons/vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import HelpIcon from "../components/shared/HelpIcon.vue";
import WidgetCard from "../components/overview/WidgetCard.vue";
import { useDashboardStateStore } from "../stores/dashboardState";
import { CHART_TYPES, WIDGET_CATALOG, WIDGET_SIZES, defaultChartTypeFor, type ChartType, type DashboardWidget, type GridLayoutItem } from "../lib/analyticsCatalog";
import { fetchWidgetData, type WidgetResponse } from "../lib/widgetData";

// App.jsx's WidgetHeader (~470-533) — top blue #0241E3, used here for the
// icon badge tint and the text-only "Add widget" action to match the
// original's non-solid button treatment.
const PRIMARY_BLUE = "#0241E3";

const store = useDashboardStateStore();

const widgets = ref<DashboardWidget[]>([]);
const layout = ref<GridLayoutItem[]>([]);
const isDirty = ref(false);
const isEditMode = ref(false);

type Range = "today" | "7d" | "14d" | "30d";
const range = ref<Range>("14d");
const rangeOptions = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
];

function dateRangeFor(r: Range): { dateIni: string | null; dateEnd: string | null } {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  if (r === "today") return { dateIni: end, dateEnd: end };
  const days = r === "7d" ? 7 : r === "14d" ? 14 : 30;
  const start = new Date(today.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { dateIni: start, dateEnd: end };
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
    const { dateIni, dateEnd } = dateRangeFor(range.value);
    widgetSlots[w.id].data = await fetchWidgetData(w.stat, w.filters, dateIni, dateEnd);
  } catch (err: any) {
    widgetSlots[w.id].error = err?.response?.data?.detail || "Failed to load.";
  } finally {
    widgetSlots[w.id].isLoading = false;
  }
}

async function loadAllWidgets() {
  await Promise.all(widgets.value.map((w) => loadWidget(w)));
}

watch(range, () => loadAllWidgets());

onMounted(async () => {
  if (!store.isLoaded) await store.fetchState();
  widgets.value = store.dashboard.widgets.map((w) => ({ ...w }));
  layout.value = store.dashboard.layout.map((l) => ({ ...l }));
  await loadAllWidgets();
});

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

// Port of WidgetOptionsMenu's Hide/Lock actions (App.jsx ~534-560) — the
// original also has Move/Edit entries, but those duplicate functionality
// grid-layout-plus already exposes via drag/resize in edit mode, so only
// Hide and Lock are reimplemented here.
const openMenuFor = ref<string | null>(null);
function toggleMenu(id: string) {
  openMenuFor.value = openMenuFor.value === id ? null : id;
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

// ── Add widget modal ──
const showAddModal = ref(false);
const pickedSource = ref("");
const pickedType = ref<ChartType>("donut");
const pickedSize = ref<"small" | "half" | "full">("small");

const catalogOptions = computed(() => WIDGET_CATALOG.map((c) => ({ value: c.id, label: `${c.label} — ${c.group}` })));

function openAddModal() {
  pickedSource.value = "";
  pickedType.value = "donut";
  pickedSize.value = "small";
  showAddModal.value = true;
}

function nextGridY(): number {
  return layout.value.length ? Math.max(...layout.value.map((l) => l.y + l.h)) : 0;
}

async function confirmAddWidget() {
  if (!pickedSource.value) return;
  const catalogEntry = WIDGET_CATALOG.find((c) => c.id === pickedSource.value);
  const sizeDef = WIDGET_SIZES.find((s) => s.id === pickedSize.value)!;
  const id = `w${Date.now()}`;
  const widget: DashboardWidget = { id, title: catalogEntry?.label ?? pickedSource.value, stat: pickedSource.value, type: pickedType.value, size: pickedSize.value, filters: {} };
  widgets.value = [...widgets.value, widget];
  layout.value = [...layout.value, { i: id, x: 0, y: nextGridY(), w: sizeDef.w, h: sizeDef.h }];
  isDirty.value = true;
  showAddModal.value = false;
  await loadWidget(widget);
}

watch(pickedSource, (src) => {
  if (src) pickedType.value = defaultChartTypeFor(src);
});
</script>

<template>
  <div class="p-8 space-y-6 animate-page-enter">
    <PageHeader title="Overview" description="Your fleet, compliance, and automation posture at a glance.">
      <template #title-suffix>
        <HelpIcon slug="overview" title="Overview admin guide" />
      </template>
      <template #action>
        <div class="flex items-center gap-2">
          <!-- Date-range control: original's DateRangePickerDropdown trigger
               is a solid brand-600 pill with a calendar icon (App.jsx
               ~4520-4540) rather than a bare <select>. -->
          <div class="relative flex items-center gap-2 rounded-md pl-3 pr-2 h-9 text-white text-sm font-medium" style="background-color: #0241e3">
            <Calendar :size="15" weight="Linear" />
            <select v-model="range" class="bg-transparent border-none outline-none text-sm font-medium pr-1 [color-scheme:dark]">
              <option v-for="o in rangeOptions" :key="o.value" :value="o.value" class="text-gray-900">{{ o.label }}</option>
            </select>
          </div>
          <Button variant="ghost" size="sm" @click="loadAllWidgets">Refresh</Button>
          <Button variant="ghost" size="sm" @click="isEditMode = !isEditMode">{{ isEditMode ? "Done editing" : "Edit layout" }}</Button>
          <!-- Original's "Add widget" is a text-only PRIMARY_BLUE button with
               a plus icon, not a solid button (App.jsx WidgetHeader area). -->
          <button
            v-if="isEditMode"
            type="button"
            class="flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium transition-colors hover:bg-black/5"
            style="color: #0241e3"
            @click="openAddModal"
          >
            <AddCircle :size="17" weight="Linear" />
            Add widget
          </button>
          <Button v-if="isDirty" size="sm" @click="saveDashboard" :disabled="store.isSaving">{{ store.isSaving ? "Saving…" : "Save layout" }}</Button>
        </div>
      </template>
    </PageHeader>

    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>

    <EmptyState v-if="!widgets.length" title="No widgets yet" description="Switch to Edit layout and add your first widget.">
      <template #action><Button size="sm" @click="isEditMode = true; openAddModal()">Add widget</Button></template>
    </EmptyState>

    <GridLayout
      v-else
      v-model:layout="layout"
      :col-num="12"
      :row-height="60"
      :is-draggable="isEditMode"
      :is-resizable="isEditMode"
      :margin="[16, 16]"
      :vertical-compact="true"
      :use-css-transforms="true"
      @layout-updated="onLayoutUpdated"
    >
      <GridItem v-for="item in layout" :key="item.i" :i="item.i" :x="item.x" :y="item.y" :w="item.w" :h="item.h" :static="item.static">
        <Card class="h-full w-full !p-0 relative group overflow-visible flex flex-col">
          <!-- 1:1 port of WidgetHeader (App.jsx ~470-533): icon badge tinted
               with the widget's own accent color, 13px title, and an
               options-menu (kebab) button instead of a bare "Remove" link. -->
          <div class="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100 shrink-0">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: PRIMARY_BLUE + '18' }">
                <WidgetIcon :size="15" weight="Linear" :style="{ color: PRIMARY_BLUE }" />
              </div>
              <p class="text-[13px] font-medium text-gray-900 truncate">
                {{ widgets.find((w) => w.id === item.i)?.title }}
              </p>
            </div>
            <div v-if="isEditMode" class="relative shrink-0">
              <button
                type="button"
                class="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 transition-colors hover:bg-black/5"
                :class="{ 'bg-black/5 text-gray-600': openMenuFor === item.i }"
                @click="toggleMenu(item.i)"
              >
                <MenuDots :size="15" weight="Linear" />
              </button>
              <div v-if="openMenuFor === item.i" class="fixed inset-0 z-[199]" @click="openMenuFor = null" />
              <div v-if="openMenuFor === item.i" class="absolute right-0 top-full mt-1 w-44 rounded-lg shadow-xl border border-gray-100 bg-white z-[200] overflow-hidden">
                <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-[13px] text-gray-700 hover:bg-black/5" @click="toggleWidgetLock(item.i)">
                  <component :is="isWidgetLocked(item.i) ? LockUnlocked : Lock" :size="14" weight="Linear" class="text-gray-400" />
                  {{ isWidgetLocked(item.i) ? "Unlock position" : "Lock position" }}
                </button>
                <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-[13px] text-red-500 hover:bg-red-50" @click="removeWidget(item.i)">
                  <EyeClosed :size="14" weight="Linear" />
                  Hide widget
                </button>
              </div>
            </div>
          </div>
          <div class="flex-1 min-h-0 p-4">
            <WidgetCard
              v-if="widgets.find((w) => w.id === item.i)"
              :widget="widgets.find((w) => w.id === item.i)!"
              :data="widgetSlots[item.i]?.data ?? null"
              :is-loading="widgetSlots[item.i]?.isLoading ?? true"
              :error="widgetSlots[item.i]?.error ?? null"
            />
          </div>
        </Card>
      </GridItem>
    </GridLayout>

    <div v-if="showAddModal" class="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="showAddModal = false" />
      <div class="relative bg-white rounded-2xl shadow-xl w-full max-w-lg z-10 p-6 space-y-4">
        <h3 class="text-base font-medium text-gray-900">Add widget</h3>
        <div>
          <label class="block text-xs font-medium mb-1.5 text-gray-500">Data source</label>
          <RichSelect v-model="pickedSource" :options="catalogOptions" placeholder="Choose a widget source…" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium mb-1.5 text-gray-500">Chart type</label>
            <select v-model="pickedType" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200">
              <option v-for="t in CHART_TYPES" :key="t.id" :value="t.id">{{ t.label }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium mb-1.5 text-gray-500">Size</label>
            <select v-model="pickedSize" class="w-full rounded-lg px-3 py-2 text-sm border border-gray-200">
              <option v-for="s in WIDGET_SIZES" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </div>
        </div>
        <div class="flex gap-3 justify-end pt-2">
          <Button variant="ghost" @click="showAddModal = false">Cancel</Button>
          <Button :disabled="!pickedSource" @click="confirmAddWidget">Add widget</Button>
        </div>
      </div>
    </div>
  </div>
</template>
