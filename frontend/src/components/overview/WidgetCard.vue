<script setup lang="ts">
// Generic widget renderer — port of App.jsx's per-type chart-option builders
// (buildDonutOption/buildBarOption/buildLineOption/buildGaugeOption, etc.,
// wow-dashboard/src/App.jsx:1260+), condensed into one component covering
// every ALL_CHART_TYPES entry. Data fetching/caching is the parent's job
// (OverviewView.vue) — this only renders whatever WidgetResponse it's given.
import "../../lib/echarts";
import VChart from "vue-echarts";
import { computed, ref } from "vue";
import { Spinner } from "@applivery/bluesky-vue";
import type { ChartType, DashboardWidget } from "../../lib/analyticsCatalog";
import type { WidgetResponse } from "../../lib/widgetData";
import { useUiStore } from "../../stores/ui";
// Shared semantic color/label helpers — same ones WidgetInfoModal.vue uses
// (roadmap Phase 10/11 gap-closure: this component used to carry its own
// plain index-based palette while the zoom modal already used the real
// _colorFor/_humanLabel port, so a widget's colors/labels would visibly
// change between the live card and its zoomed-in modal. Ported from
// App.jsx:3757-3799 — see lib/widgetVisuals.ts.
import { colorFor, humanLabel, brighten } from "../../lib/widgetVisuals";
import { ICONS } from "../../lib/solarIcons";

const props = defineProps<{
  widget: DashboardWidget;
  data: WidgetResponse | null;
  isLoading: boolean;
  error: string | null;
}>();
const emit = defineEmits<{ openOrgProfile: []; chartClick: [sliceName: string | null] }>();

// isClickable / handleChartClick wiring — 1:1 port of App.jsx's
// renderWidgetContent's `isClickable = items && items.length > 0` (~3820)
// plus the per-type handleChartClick(widget, sliceName?) call sites
// (BarWidget ~1040, DonutPieWidget ~1130/1148, gauge ~3931, list/progress
// row ~3969, scorecard ~3858). The actual filter/results-list/detail-modal
// state (selectedWidgetItems/activeInsight) lives one level up in
// OverviewView.vue, same as the original lifts it to Dashboard(); this
// component only knows "was I clicked, and on which slice".
const isClickable = computed(() => (props.data?.items?.length ?? 0) > 0);
function onChartClick(sliceName: string | null = null) {
  if (isClickable.value) emit("chartClick", sliceName);
}

// The predefined "Workspace Profile" widget isn't a normal chart-typed
// widget — App.jsx's renderWidgetContent special-cases `widget.stat ===
// 'org_profile'` (~line 3823) ahead of the generic `widget.type` switch,
// rendering the raw Applivery org-profile API response (logo/name/slug)
// instead, and the whole card is clickable to open a dedicated modal
// (setSelectedOrgProfile) rather than the generic WidgetInfoModal every
// other widget's ⓘ button opens. This is that same special-case, ahead of
// the `chartType === 'scorecard'` branch below (org_profile is typed
// "scorecard" in DEFAULT_DASHBOARD/the catalog, same as the original, but
// never actually renders as one).
const isOrgProfile = computed(() => props.widget.stat === "org_profile");
const orgLogo = computed(() => props.data?.orgProfile?.branding?.logo || props.data?.orgProfile?.branding?.picture || "");

// Live widget cards render via ECharts (SVG canvas, not DOM), so Tailwind's
// `dark:` classes can't reach the chart itself — theme-aware colors here
// have to come from JS. Wired to the same useUiStore().activeTheme every
// other theme-aware surface reads from (roadmap Phase 11).
const uiStore = useUiStore();
const theme = computed(() => uiStore.activeTheme);

const chartType = computed<ChartType>(() => props.widget.type);
const chartData = computed(() => props.data?.chartData ?? []);
const trendData = computed(() => props.data?.trendData);
const total = computed(() => chartData.value.reduce((a, c) => a + (c.value || 0), 0));

// Donut/pie get their own layout (chart + side legend, below) — 1:1 port of
// App.jsx's DonutPieWidget (~line 1049): a shrink-0 chart on the left
// (flex: 0 0 52%) and a colored-dot/label/value legend list on the right
// (flex: 1 1 48%). Every other chart type just fills the card (no custom
// legend in the original either — BarWidget/line/radar/gauge rely on
// ECharts' own axis labels or, for gauge, WidgetInfoModal's zoom view).
const isDonutPie = computed(() => chartType.value === "donut" || chartType.value === "pie");
const isChart = computed(() => ["bar", "line", "radar", "gauge"].includes(chartType.value));

// Donut/pie hover state — 1:1 port of DonutPieWidget's `hovIdx` React state
// (App.jsx:1050) driving a ghost (grows on hover, `emphasis.scaleSize: 10`)
// + solid (opacity-only, stays the same size) two-series ECharts option,
// instead of ECharts' own single-series `emphasis.scale`, which scales the
// slice itself rather than growing a translucent halo behind it. Same
// pattern WidgetInfoModal.vue's buildDonutOption() already uses for the
// zoomed-in view — this brings the live grid card in line with it.
const hovIdx = ref(-1);
function onDonutHover(p: any) {
  if (p.seriesIndex === 0) hovIdx.value = p.dataIndex;
}
function onDonutOut(p: any) {
  if (p.seriesIndex === 0) hovIdx.value = -1;
}

const chartOption = computed(() => {
  const t = chartType.value;
  const th = theme.value;
  const tooltipBase = { backgroundColor: th.card, borderColor: th.border, textStyle: { color: th.text } };
  const axisLabelStyle = { fontSize: 10, color: th.textMuted };
  if (t === "donut" || t === "pie") {
    const innerR = t === "donut" ? "59%" : "0%";
    const outerR = "78%";
    const slices = chartData.value.map((d, i) => ({ name: humanLabel(d.name), value: d.value, color: colorFor(props.widget.stat, d.name, i) }));
    const h = hovIdx.value;
    return {
      tooltip: { trigger: "item", ...tooltipBase },
      legend: { show: false },
      series: [
        {
          // Ghost series (z:1) — the hover event source; grows via
          // emphasis.scaleSize when hovered, otherwise sits behind the
          // solid series at low opacity.
          type: "pie",
          z: 1,
          silent: false,
          radius: [innerR, outerR],
          center: ["50%", "50%"],
          itemStyle: { borderWidth: 0, borderColor: "transparent" },
          label: { show: false },
          emphasis: { scale: h !== -1, scaleSize: 10, itemStyle: { borderWidth: 0 } },
          data: slices.map((d, i) => ({ name: d.name, value: d.value, itemStyle: { color: d.color, opacity: h === -1 ? 0.38 : h === i ? 0.38 : 0, borderWidth: 0 } })),
        },
        {
          // Solid series (z:2) — silent (doesn't fire hover/click events),
          // stays the same size; only its opacity changes on hover.
          type: "pie",
          z: 2,
          silent: true,
          radius: [innerR, outerR],
          center: ["50%", "50%"],
          itemStyle: { borderWidth: 0, borderColor: "transparent" },
          label: { show: false },
          emphasis: { scale: false, itemStyle: { borderWidth: 0 } },
          data: slices.map((d, i) => ({ name: d.name, value: d.value, itemStyle: { color: d.color, opacity: h === -1 ? 1 : h === i ? 1 : 0.15, borderWidth: 0 } })),
        },
      ],
      // Center total — 1:1 port of DonutPieWidget's graphic group (App.jsx
      // ~1112-1117): 700-weight 28px value, 400-weight 11px "Total" label
      // below it. Donut only (pie's hollow-less radius has no room for it,
      // same as the original).
      graphic:
        t === "donut"
          ? [
              {
                type: "group",
                left: "center",
                top: "center",
                children: [
                  { type: "text", style: { text: total.value.toString(), font: "700 28px Outfit, sans-serif", fill: th.text, textAlign: "center", y: -14 } },
                  { type: "text", style: { text: "Total", font: "400 11px Outfit, sans-serif", fill: th.textMuted, textAlign: "center", y: 22 } },
                ],
              },
            ]
          : [],
    };
  }
  if (t === "bar") {
    return {
      tooltip: { trigger: "item", ...tooltipBase },
      grid: { top: 16, bottom: 32, left: 40, right: 16 },
      xAxis: { type: "category", data: chartData.value.map((d) => humanLabel(d.name)), axisLabel: { ...axisLabelStyle, rotate: chartData.value.length > 5 ? 30 : 0 }, axisLine: { lineStyle: { color: th.border } } },
      yAxis: { type: "value", axisLabel: axisLabelStyle, splitLine: { lineStyle: { color: th.gridLine } } },
      series: [
        {
          type: "bar",
          barMaxWidth: 40,
          // Native ECharts focus/blur — hovered bar brightens, others fade
          // to 0.25 (App.jsx's BarWidget ~1013-1015: no ghost series here,
          // unlike donut/pie — bars use ECharts' own emphasis/blur).
          emphasis: { focus: "self", blurScope: "global", scale: false },
          blur: { itemStyle: { opacity: 0.25 } },
          data: chartData.value.map((d, i) => {
            const color = colorFor(props.widget.stat, d.name, i);
            return {
              value: d.value,
              itemStyle: { color, borderRadius: [4, 4, 0, 0], borderWidth: 0 },
              emphasis: { itemStyle: { color: brighten(color, 0.18), borderRadius: [4, 4, 0, 0], borderWidth: 0 } },
              blur: { itemStyle: { color, opacity: 0.25, borderWidth: 0 } },
            };
          }),
        },
      ],
    };
  }
  if (t === "line") {
    return {
      tooltip: { trigger: "axis", ...tooltipBase },
      grid: { top: 16, bottom: 32, left: 40, right: 16 },
      xAxis: { type: "category", data: trendData.value?.labels ?? [], axisLabel: axisLabelStyle, axisLine: { lineStyle: { color: th.border } } },
      yAxis: { type: "value", axisLabel: axisLabelStyle, splitLine: { lineStyle: { color: th.gridLine } } },
      series: [{ type: "line", smooth: true, data: trendData.value?.series ?? [], areaStyle: { color: "#0E4FF518" }, itemStyle: { color: "#0E4FF5" }, symbol: "circle", symbolSize: 5 }],
    };
  }
  if (t === "radar") {
    return {
      tooltip: { ...tooltipBase },
      radar: {
        indicator: chartData.value.map((d) => ({ name: humanLabel(d.name), max: Math.max(total.value, 1) })),
        axisName: { color: th.textMuted, fontSize: 10 },
        splitLine: { lineStyle: { color: th.gridLine } },
        axisLine: { lineStyle: { color: th.border } },
      },
      series: [{ type: "radar", data: [{ value: chartData.value.map((d) => d.value), areaStyle: { color: "#0E4FF530" }, itemStyle: { color: "#0E4FF5" } }] }],
    };
  }
  if (t === "gauge") {
    const primary = chartData.value[0];
    const val = primary && total.value > 0 ? Math.round((primary.value / total.value) * 100) : 0;
    return {
      series: [
        {
          type: "gauge",
          startAngle: 180,
          endAngle: 0,
          min: 0,
          max: 100,
          progress: { show: true, roundCap: true, itemStyle: { color: colorFor(props.widget.stat, primary?.name ?? "", 0) } },
          pointer: { show: false },
          axisLine: { lineStyle: { width: 12, color: [[1, th.border]] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          // 1:1 port of the original gauge's title+detail pair (App.jsx
          // ~3939-3940): `title` is the slice's own name (e.g. "iOS"),
          // shown small above center; `detail` is the big bold percentage
          // below it. This component was previously missing `title`
          // entirely (no name label in the middle of the gauge) and had
          // `detail` at 22px instead of the original's 34px/bold.
          title: { fontSize: 13, color: th.textMuted, offsetCenter: [0, "30%"], fontFamily: "Outfit, sans-serif" },
          detail: { fontSize: 34, fontWeight: "bold", formatter: "{value}%", offsetCenter: [0, "-5%"], color: th.text, fontFamily: "Outfit, sans-serif" },
          data: [{ value: val, name: primary ? humanLabel(primary.name) : "" }],
        },
      ],
    };
  }
  return {};
});
</script>

<template>
  <div class="h-full w-full flex flex-col">
    <div v-if="isLoading" class="flex-1 flex items-center justify-center"><Spinner size="sm" /></div>
    <div v-else-if="error" class="flex-1 flex items-center justify-center text-xs text-red-500 text-center px-2">{{ error }}</div>
    <template v-else>
      <div
        v-if="isOrgProfile"
        class="flex-1 flex flex-col items-center justify-center p-4 cursor-pointer hover:opacity-80 transition-opacity gap-2"
        @click="emit('openOrgProfile')"
      >
        <div class="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden">
          <img v-if="orgLogo" :src="orgLogo" :alt="data?.orgProfile?.name" class="max-w-full max-h-full object-contain" style="max-height: 80px" @error="($event.target as HTMLImageElement).style.display = 'none'" />
          <div v-else class="flex items-center justify-center w-20 h-20 rounded-2xl bg-brand-600/15">
            <component :is="ICONS.Buildings2" :size="44" weight="Linear" class="text-brand-600 opacity-70" />
          </div>
        </div>
        <div class="text-center shrink-0 mt-1">
          <div class="text-sm font-bold leading-tight truncate max-w-full text-gray-900 dark:text-white">{{ data?.orgProfile?.name }}</div>
          <div class="text-[11px] mt-0.5 text-gray-500 dark:text-gray-400">{{ data?.orgProfile?.slug }}</div>
        </div>
        <div class="flex items-center gap-1 shrink-0 text-gray-500 dark:text-gray-400">
          <component :is="ICONS.InfoCircle" :size="9" weight="Linear" /><span class="text-[9px]">Tap for details</span>
        </div>
      </div>

      <!-- 1:1 port of ScorecardContent (App.jsx ~579-599): 68px/700-weight/
           -3px-tracking value, plus the "Tap to view list" pill when
           clickable. Previously rendered at Tailwind's text-4xl (36px,
           semibold) — barely half the original's size. -->
      <div
        v-else-if="chartType === 'scorecard'"
        class="flex-1 flex flex-col items-center justify-center gap-2"
        :class="isClickable ? 'cursor-pointer' : ''"
        @click="onChartClick()"
      >
        <span class="text-gray-900 dark:text-white" style="font-family: 'Outfit', sans-serif; font-size: 68px; font-weight: 700; letter-spacing: -3px; line-height: 1">{{ data?.scorecardValue ?? 0 }}</span>
        <div v-if="isClickable" class="flex items-center gap-1 mt-1 px-2.5 py-1 rounded-full bg-brand-600/12">
          <component :is="ICONS.InfoCircle" :size="10" weight="Linear" class="text-brand-600" />
          <span class="text-[10px] font-medium text-brand-600">Tap to view list</span>
        </div>
      </div>

      <div v-else-if="isDonutPie" class="flex-1 min-h-0 flex items-center gap-2 overflow-hidden">
        <div class="relative flex items-center justify-center shrink-0 h-full" :style="{ minHeight: '80px', flex: '0 0 52%', cursor: isClickable ? 'pointer' : 'default' }">
          <VChart :option="chartOption" :init-options="{ renderer: 'svg' }" autoresize class="h-full w-full" @click="onChartClick($event.name)" @mouseover="onDonutHover" @mouseout="onDonutOut" />
        </div>
        <div class="flex flex-col justify-center gap-1 overflow-hidden" style="flex: 1 1 48%; min-width: 0">
          <div
            v-for="(row, i) in chartData"
            :key="row.name"
            class="flex items-center justify-between w-full gap-1.5 rounded-lg px-1 py-0.5 transition-opacity"
            :class="isClickable ? 'cursor-pointer' : ''"
            :style="{ opacity: hovIdx === -1 ? 1 : hovIdx === i ? 1 : 0.25 }"
            @click="onChartClick(humanLabel(row.name))"
          >
            <div class="flex items-center gap-1.5 min-w-0 overflow-hidden">
              <div class="w-2.5 h-2.5 rounded-[3px] shrink-0" :style="{ backgroundColor: colorFor(widget.stat, row.name, i) }" />
              <span class="text-[13px] font-normal truncate text-gray-500 dark:text-gray-400">{{ humanLabel(row.name) }}</span>
            </div>
            <span class="text-[13px] font-semibold tabular-nums shrink-0 text-gray-900 dark:text-white">{{ row.value.toLocaleString() }}</span>
          </div>
          <p v-if="!chartData.length" class="text-gray-400 text-xs py-2">No data.</p>
        </div>
      </div>

      <div v-else-if="isChart" class="flex-1 min-h-0" :style="{ cursor: isClickable ? 'pointer' : 'default' }">
        <!-- Bar/gauge fire per-slice clicks (e.name); line/radar have no
             sliced data, so any click drills into the widget's full item
             set with no slice filter — 1:1 port of App.jsx's BarWidget
             (~1040, no sliceName), gauge (~3931, primaryItem.name), and
             line/radar (~3889/3947, no sliceName). -->
        <VChart :option="chartOption" :init-options="{ renderer: 'svg' }" autoresize class="h-full w-full" @click="onChartClick(chartType === 'gauge' ? (chartData[0]?.name ?? null) : null)" />
      </div>

      <div v-else-if="chartType === 'list'" class="flex-1 overflow-y-auto text-sm divide-y divide-gray-100 dark:divide-gray-700">
        <div
          v-for="row in chartData"
          :key="row.name"
          class="flex justify-between py-1.5"
          :class="isClickable ? 'cursor-pointer hover:opacity-70' : ''"
          @click="onChartClick(row.name)"
        >
          <span class="text-gray-600 dark:text-gray-300 truncate pr-2">{{ humanLabel(row.name) }}</span>
          <span class="font-medium text-gray-900 dark:text-white">{{ row.value }}</span>
        </div>
        <p v-if="!chartData.length" class="text-gray-400 text-xs py-2">No data.</p>
      </div>

      <div v-else-if="chartType === 'progress'" class="flex-1 overflow-y-auto space-y-2">
        <div v-for="row in chartData" :key="row.name" :class="isClickable ? 'cursor-pointer hover:opacity-70' : ''" @click="onChartClick(row.name)">
          <div class="flex justify-between text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
            <span class="truncate pr-2">{{ humanLabel(row.name) }}</span><span>{{ row.value }}</span>
          </div>
          <div class="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full">
            <div class="h-2 bg-brand-600 rounded-full" :style="{ width: (total ? (row.value / Math.max(...chartData.map((d) => d.value), 1)) * 100 : 0) + '%' }" />
          </div>
        </div>
        <p v-if="!chartData.length" class="text-gray-400 text-xs py-2">No data.</p>
      </div>
    </template>
  </div>
</template>
