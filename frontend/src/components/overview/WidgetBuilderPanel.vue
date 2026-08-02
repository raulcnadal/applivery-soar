<script setup lang="ts">
// 1:1 port of App.jsx's widget builder — a 400px panel that slides in from
// the left edge (not a centered modal), used for both Add Widget and Edit
// Widget (App.jsx ~5594-5800). Kept mounted while `widget` is non-null so
// the translateX transition can play on open/close, same as the original's
// always-rendered-but-translated panel.
import { computed, ref, watch } from "vue";
import { ICONS, resolveIcon } from "../../lib/solarIcons";
import {
  WIDGET_CATALOG,
  WIDGET_SIZES,
  CHART_TYPES,
  chartTypesFor,
  defaultChartTypeForSource,
  FILTER_SOURCES_WITH_OS,
  FILTER_SOURCES_WITH_COMPLIANCE,
  FILTER_SOURCES_WITH_ROLE,
  FILTER_SOURCES_WITH_AUTH_ORIGIN,
  hasAnyFilters,
  type ChartType,
  type DashboardWidget,
} from "../../lib/analyticsCatalog";

const PRIMARY_BLUE = "#0241E3";

const props = defineProps<{
  open: boolean;
  widget: DashboardWidget | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [widget: DashboardWidget];
}>();

// Local editable copy — mirrors editingWidget's setEditingWidget(prev => ...)
// pattern without mutating the parent's ref directly on every keystroke.
const local = ref<DashboardWidget | null>(null);
watch(
  () => props.widget,
  (w) => {
    if (w) local.value = { ...w, filters: { ...(w.filters ?? {}) } };
  },
  { immediate: true },
);

const isEdit = computed(() => !!props.widget?.id);

const isSourceDropdownOpen = ref(false);

const groupedCatalog = computed(() => {
  const groups = new Map<string, typeof WIDGET_CATALOG>();
  for (const item of WIDGET_CATALOG) {
    if (!groups.has(item.group)) groups.set(item.group, [] as any);
    (groups.get(item.group) as any).push(item);
  }
  return Array.from(groups.entries()).map(([group, items]) => ({ group, items }));
});

const selectedSourceLabel = computed(() => WIDGET_CATALOG.find((i) => i.id === local.value?.stat)?.label ?? "Select a metric…");

function selectSource(statId: string) {
  if (!local.value) return;
  const available = chartTypesFor(statId);
  const nextType = available.includes(local.value.type) ? local.value.type : defaultChartTypeForSource(statId);
  local.value = { ...local.value, stat: statId, type: nextType, filters: {} };
  isSourceDropdownOpen.value = false;
}

function updateFilter(key: string, value: any) {
  if (!local.value) return;
  local.value = { ...local.value, filters: { ...local.value.filters, [key]: value } };
}

const availableChartTypes = computed(() => (local.value ? chartTypesFor(local.value.stat).map((id) => CHART_TYPES.find((c) => c.id === id)!) : []));

function pickChartType(id: ChartType) {
  if (!local.value) return;
  local.value = { ...local.value, type: id };
}
function pickSize(id: "small" | "half" | "full") {
  if (!local.value) return;
  local.value = { ...local.value, size: id };
}

function save() {
  if (!local.value || !local.value.stat) return;
  emit("save", local.value);
}

const CHART_ICON_NAMES: Record<ChartType, string> = {
  scorecard: "Hashtag",
  gauge: "Pulse",
  donut: "PieChart",
  pie: "PieChart",
  bar: "ChartSquare",
  line: "GraphUp",
  radar: "Radar",
  list: "List",
  progress: "SliderHorizontal",
};

// Visual size-preview block dimensions — mirrors the original's proportional
// block sizing (App.jsx ~5752-5754).
function blockDims(id: "small" | "half" | "full") {
  const w = id === "small" ? 24 : id === "half" ? 44 : 80;
  const h = id === "small" ? 16 : 22;
  return { width: `${w}px`, height: `${h}px` };
}
</script>

<template>
  <div v-if="widget">
    <!-- Transparent click-off layer -->
    <div v-if="open" class="fixed inset-0 z-[108]" @click="emit('close')" />

    <!-- Sliding panel from the left, full height -->
    <div
      class="fixed top-0 bottom-0 left-0 z-[109] flex flex-col shadow-2xl border-r bg-white transition-transform duration-300"
      style="width: 400px; border-color: #e9eaec"
      :style="{ transform: open ? 'translateX(0)' : 'translateX(-100%)' }"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-5 border-b shrink-0" style="border-color: #e9eaec">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center" :style="{ backgroundColor: PRIMARY_BLUE + '15', color: PRIMARY_BLUE }">
            <component :is="isEdit ? ICONS.Pen : ICONS.AddCircle" :size="16" weight="Linear" />
          </div>
          <h2 class="text-base font-bold text-gray-900">{{ isEdit ? "Edit Widget" : "Add Widget" }}</h2>
        </div>
        <button type="button" class="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:opacity-70 transition-colors" style="background-color: rgba(107,114,128,0.12)" @click="emit('close')">
          <component :is="ICONS.CloseCircle" :size="15" weight="Linear" />
        </button>
      </div>

      <!-- Body -->
      <div v-if="local" class="flex-1 overflow-y-auto">
        <div class="p-6 flex flex-col gap-7">
          <!-- Widget Title -->
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest mb-2.5 block text-gray-500">Widget Title</label>
            <input
              v-model="local.title"
              type="text"
              placeholder="e.g. Current Fleet Status"
              class="w-full rounded-xl px-4 py-3 outline-none text-sm border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500 bg-gray-50 text-gray-900"
              style="border-color: #e9eaec"
            />
          </div>

          <!-- Data Source -->
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest mb-2.5 block text-gray-500">Data Source</label>
            <div class="relative">
              <div
                class="w-full rounded-xl px-4 py-3 flex justify-between items-center border cursor-pointer transition-colors bg-gray-50"
                style="border-color: #e9eaec"
                @click="isSourceDropdownOpen = !isSourceDropdownOpen"
              >
                <span class="text-sm font-medium text-gray-900">{{ selectedSourceLabel }}</span>
                <component :is="ICONS.AltArrowDown" :size="16" weight="Linear" class="text-gray-400" />
              </div>
              <div v-if="isSourceDropdownOpen" class="fixed inset-0 z-[110]" @click="isSourceDropdownOpen = false" />
              <div v-if="isSourceDropdownOpen" class="absolute top-full left-0 w-full mt-2 rounded-xl shadow-xl border z-[111] overflow-y-auto max-h-64 bg-white" style="border-color: #e9eaec">
                <div v-for="group in groupedCatalog" :key="group.group">
                  <div class="px-4 py-2 mt-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">{{ group.group }}</div>
                  <button
                    v-for="item in group.items"
                    :key="item.id"
                    type="button"
                    class="w-full text-left px-5 py-2.5 text-sm hover:bg-black/5 transition-colors flex items-center gap-3"
                    :style="{ color: local.stat === item.id ? PRIMARY_BLUE : '#111827' }"
                    @click="selectSource(item.id)"
                  >
                    {{ item.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Filters -->
          <div v-if="hasAnyFilters(local.stat)">
            <label class="text-[10px] font-bold uppercase tracking-widest mb-2.5 block text-gray-500">Filters</label>
            <div class="p-4 rounded-xl border flex flex-col gap-4 bg-gray-50" style="border-color: #e9eaec">
              <div v-if="FILTER_SOURCES_WITH_OS.has(local.stat)">
                <label class="block text-xs font-medium mb-2 text-gray-500">{{ local.stat === "mdm_devices" ? "Operating System" : "Target OS" }}</label>
                <select :value="local.filters.type || 'all'" class="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500 bg-white text-gray-900" style="border-color: #e9eaec" @change="updateFilter('type', ($event.target as HTMLSelectElement).value)">
                  <option value="all">All OS</option>
                  <option value="apple">iOS / iPadOS</option>
                  <option value="macos">macOS</option>
                  <option value="android">Android</option>
                  <option value="windows">Windows</option>
                </select>
              </div>
              <template v-if="FILTER_SOURCES_WITH_COMPLIANCE.has(local.stat)">
                <div>
                  <label class="block text-xs font-medium mb-2 text-gray-500">Compliance Status</label>
                  <select :value="local.filters.complianceStatus || 'all'" class="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500 bg-white text-gray-900" style="border-color: #e9eaec" @change="updateFilter('complianceStatus', ($event.target as HTMLSelectElement).value)">
                    <option value="all">All devices</option>
                    <option value="compliant">Compliant only</option>
                    <option value="non_compliant">Non-compliant only</option>
                  </select>
                </div>
                <label class="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" :checked="!!local.filters.inactive24h" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" @change="updateFilter('inactive24h', ($event.target as HTMLInputElement).checked)" />
                  <span class="text-sm font-medium text-gray-900">Not reported in last 24h</span>
                </label>
              </template>
              <div v-if="FILTER_SOURCES_WITH_ROLE.has(local.stat)">
                <label class="block text-xs font-medium mb-2 text-gray-500">Role</label>
                <select :value="local.filters.role || 'all'" class="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500 bg-white text-gray-900" style="border-color: #e9eaec" @change="updateFilter('role', ($event.target as HTMLSelectElement).value)">
                  <option value="all">All roles</option>
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div v-if="FILTER_SOURCES_WITH_AUTH_ORIGIN.has(local.stat)">
                <label class="block text-xs font-medium mb-2 text-gray-500">Authentication Origin</label>
                <select :value="local.filters.authOrigin || 'all'" class="w-full rounded-lg px-3 py-2.5 text-sm outline-none border focus:border-blue-500 transition-colors focus:ring-2 focus:ring-brand-500 bg-white text-gray-900" style="border-color: #e9eaec" @change="updateFilter('authOrigin', ($event.target as HTMLSelectElement).value)">
                  <option value="all">All origins</option>
                  <option value="dashboard">Dashboard</option>
                  <option value="sso">SSO</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Visual Style -->
          <div v-if="local.stat">
            <label class="text-[10px] font-bold uppercase tracking-widest mb-2.5 block text-gray-500">Visual Style</label>
            <div class="grid grid-cols-2 gap-2.5">
              <button
                v-for="type in availableChartTypes"
                :key="type.id"
                type="button"
                class="flex flex-col items-center justify-center p-3.5 rounded-xl border text-left transition-all"
                :style="{ backgroundColor: local.type === type.id ? PRIMARY_BLUE + '12' : '#F3F7FE', borderColor: local.type === type.id ? PRIMARY_BLUE : '#e9eaec' }"
                @click="pickChartType(type.id)"
              >
                <component :is="resolveIcon(CHART_ICON_NAMES[type.id])" :size="18" weight="Linear" :style="{ color: local.type === type.id ? PRIMARY_BLUE : '#6B7280' }" />
                <div class="font-semibold text-[12px] mt-2" :style="{ color: local.type === type.id ? PRIMARY_BLUE : '#111827' }">{{ type.label }}</div>
                <div class="text-[10px] leading-tight mt-0.5 text-center text-gray-500">{{ type.desc }}</div>
              </button>
            </div>
          </div>

          <!-- Card Size -->
          <div v-if="local.stat">
            <label class="text-[10px] font-bold uppercase tracking-widest mb-2.5 block text-gray-500">Card Size</label>
            <div class="flex gap-2.5">
              <button
                v-for="size in WIDGET_SIZES"
                :key="size.id"
                type="button"
                class="flex-1 py-3 rounded-xl border transition-all flex flex-col items-center justify-center gap-1.5"
                :style="{ backgroundColor: local.size === size.id ? PRIMARY_BLUE + '12' : '#F3F7FE', borderColor: local.size === size.id ? PRIMARY_BLUE : '#e9eaec' }"
                @click="pickSize(size.id)"
              >
                <div class="rounded-[3px]" :style="{ ...blockDims(size.id), backgroundColor: local.size === size.id ? PRIMARY_BLUE : '#6B7280', opacity: local.size === size.id ? 0.7 : 0.25 }" />
                <span class="font-semibold text-[12px]" :style="{ color: local.size === size.id ? PRIMARY_BLUE : '#111827' }">{{ size.label }}</span>
                <span class="text-[10px] text-gray-500">{{ size.desc }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t flex justify-between gap-3 shrink-0 bg-white" style="border-color: #e9eaec">
        <button type="button" class="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors hover:opacity-70 text-gray-500 border" style="border-color: #e9eaec" @click="emit('close')">Cancel</button>
        <button
          type="button"
          class="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white transition-colors disabled:opacity-40"
          :style="{ backgroundColor: PRIMARY_BLUE }"
          :disabled="!local?.stat"
          @click="save"
        >
          {{ isEdit ? "Save Changes" : "Add Widget" }}
        </button>
      </div>
    </div>
  </div>
</template>
