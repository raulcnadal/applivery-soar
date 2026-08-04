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
import { colorFor, humanLabel, brighten, getOsPlatform, PRIMARY_BLUE } from "../../lib/widgetVisuals";
import { ICONS } from "../../lib/solarIcons";
import OsIcon from "../shared/OsIcon.vue";

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
// "line" is split out into its own branch below (chart + OS-totals footer),
// so it's excluded here — this only covers the chart-types that just fill
// the card with no extra chrome.
const isChart = computed(() => ["bar", "radar", "gauge"].includes(chartType.value));

// Line widgets get an OS-totals footer row below the chart — 1:1 port of
// App.jsx's line-type branch in renderWidgetContent (~3899-3906): TOTAL /
// iOS / Android / Windows counts, only the ones with a value shown (same
// `.filter(Boolean)` the original applies). Bar/radar/gauge have no
// equivalent footer in the original either.
const isLine = computed(() => chartType.value === "line");
const osTotals = computed(() => trendData.value?.os_totals ?? {});
const lineTotalSum = computed(() => (osTotals.value.apple || 0) + (osTotals.value.android || 0) + (osTotals.value.windows || 0) || props.data?.scorecardValue || 0);
const lineFooterItems = computed(() => {
  const t = osTotals.value;
  const items: { key: string; val: number; color: string }[] = [{ key: "TOTAL", val: lineTotalSum.value, color: theme.value.text }];
  if (t.apple !== undefined) items.push({ key: "iOS", val: t.apple, color: uiStore.isDark ? "#E5E7EB" : "#1D1D1F" });
  if (t.android !== undefined) items.push({ key: "Android", val: t.android, color: "#3DDC84" });
  if (t.windows > 0) items.push({ key: "Windows", val: t.windows, color: "#0241E2" });
  return items;
});

// List/progress rows — 1:1 port of App.jsx's ListProgressRow (~618-647) and
// its call site (~3958-3979). Both chart types share the exact same row
// markup (colored dot/OsIcon + label + value, an optional fill-bar track
// for "progress"), which the migrated version previously split into two
// separate, much plainer templates: no colored dot at all, and the
// progress bar was a single flat brand-blue regardless of the row's own
// semantic color (device-status/OS/battery/etc. — whatever colorFor()
// would normally assign it, same as every other chart type).
const maxListValue = computed(() => Math.max(...chartData.value.map((d) => d.value)) || 1);
function rowOsPlatform(name: string): string | null {
  // Only stats_os_updates_all rows get the OsIcon treatment in the
  // original (getOsPlatform is called unconditionally there, but every
  // other stat's row names never match apple/android/windows, so it's a
  // no-op for them in practice — this mirrors that exactly).
  if (props.widget.stat !== "stats_os_updates_all") return null;
  return getOsPlatform(props.widget.stat, name);
}
function rowColor(name: string, i: number): string {
  const platform = rowOsPlatform(name);
  if (platform === "apple") return uiStore.isDark ? "#E5E7EB" : "#1D1D1F";
  if (platform === "android") return "#3DDC84";
  if (platform === "windows") return "#0241E2";
  return colorFor(props.widget.stat, name, i, uiStore.isDark);
}

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
  // fontSize 11 — matches App.jsx's line-widget axisLabel spec (~3899:
  // `{ color: activeTheme.textMuted, fontSize: 11 }`); bar has its own
  // barAxisLabel below (also 11, plus fontFamily) since BarWidget's spec
  // additionally sets Outfit as the font.
  const axisLabelStyle = { fontSize: 11, color: th.textMuted };
  if (t === "donut" || t === "pie") {
    const innerR = t === "donut" ? "59%" : "0%";
    const outerR = "78%";
    const slices = chartData.value.map((d, i) => ({ name: humanLabel(d.name), value: d.value, color: colorFor(props.widget.stat, d.name, i, uiStore.isDark) }));
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
    // 1:1 port of App.jsx's BarWidget (~977-1041): grid {16,36,44,12}, both
    // axes' own axisLine/axisTick hidden (no border line under the bars —
    // the migrated version previously drew one via `axisLine.lineStyle`),
    // fontSize 11 + Outfit font (was 10, no font family).
    const barAxisLabel = { color: th.textMuted, fontSize: 11, fontFamily: "Outfit, sans-serif" };
    return {
      tooltip: { trigger: "item", ...tooltipBase },
      grid: { top: 16, bottom: 36, left: 44, right: 12 },
      xAxis: { type: "category", data: chartData.value.map((d) => humanLabel(d.name)), axisLabel: { ...barAxisLabel, rotate: chartData.value.length > 5 ? 30 : 0 }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: barAxisLabel, splitLine: { lineStyle: { color: th.gridLine } }, axisLine: { show: false }, axisTick: { show: false } },
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
            const color = colorFor(props.widget.stat, d.name, i, uiStore.isDark);
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
    // 1:1 port of App.jsx's line-type branch (~3899-3906): grid {8,28,32,12},
    // PRIMARY_BLUE line/points with a top-to-bottom fading linear-gradient
    // fill (was a flat, differently-colored "#0E4FF5" hex — not even the
    // brand blue — with no gradient at all).
    return {
      tooltip: { trigger: "axis", ...tooltipBase },
      grid: { top: 8, bottom: 28, left: 32, right: 12 },
      xAxis: { type: "category", data: trendData.value?.labels ?? [], axisLabel: axisLabelStyle, axisLine: { lineStyle: { color: th.border } } },
      yAxis: { type: "value", axisLabel: axisLabelStyle, splitLine: { lineStyle: { color: th.gridLine } } },
      series: [
        {
          type: "line",
          smooth: true,
          data: trendData.value?.series ?? [],
          symbolSize: 5,
          itemStyle: { color: PRIMARY_BLUE },
          lineStyle: { width: 2.5, color: PRIMARY_BLUE },
          areaStyle: {
            color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${PRIMARY_BLUE}33` }, { offset: 1, color: `${PRIMARY_BLUE}00` }] },
            opacity: 1,
          },
        },
      ],
    };
  }
  if (t === "radar") {
    // 1:1 port of App.jsx's radar branch (~3943-3949): axis max is the
    // largest single value * 1.2 (falls back to 10 when everything's 0),
    // NOT the sum of all values — the migrated version's `total.value` fed
    // every axis the SUM as its max, which squashes/misrepresents the
    // shape whenever there's more than one non-zero slice. radius 65%,
    // PRIMARY_BLUE styling with the exact border-width hover states, and
    // fontSize 11 (was 10) to match.
    const maxVal = Math.max(...chartData.value.map((d) => d.value), 0) * 1.2 || 10;
    return {
      tooltip: { trigger: "item", ...tooltipBase },
      radar: {
        indicator: chartData.value.map((d) => ({ name: humanLabel(d.name), max: maxVal })),
        radius: "65%",
        axisName: { color: th.textMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: th.gridLine } },
        splitArea: { show: false },
        axisLine: { lineStyle: { color: th.border } },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              value: chartData.value.map((d) => d.value),
              name: props.widget.title,
              areaStyle: { color: `${PRIMARY_BLUE}40` },
              lineStyle: { color: PRIMARY_BLUE, width: 2 },
              itemStyle: { color: PRIMARY_BLUE, borderColor: `${PRIMARY_BLUE}40`, borderWidth: 5 },
              emphasis: { itemStyle: { color: PRIMARY_BLUE, borderColor: `${PRIMARY_BLUE}40`, borderWidth: 8 }, lineStyle: { width: 3 } },
            },
          ],
        },
      ],
    };
  }
  if (t === "gauge") {
    const primary = chartData.value[0];
    const val = primary && total.value > 0 ? Math.round((primary.value / total.value) * 100) : 0;
    return {
      tooltip: { trigger: "item", ...tooltipBase },
      series: [
        {
          type: "gauge",
          startAngle: 180,
          endAngle: 0,
          min: 0,
          max: 100,
          // overlap/clip: false — 1:1 port of App.jsx's gauge progress spec
          // (~3934); width 18 (was 12) to match the original's thicker arc.
          progress: { show: true, overlap: false, roundCap: true, clip: false, itemStyle: { color: colorFor(props.widget.stat, primary?.name ?? "", 0, uiStore.isDark) } },
          pointer: { show: false },
          axisLine: { lineStyle: { width: 18, color: [[1, th.border]] } },
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
              <div class="w-2.5 h-2.5 rounded-[3px] shrink-0" :style="{ backgroundColor: colorFor(widget.stat, row.name, i, uiStore.isDark) }" />
              <span class="text-[13px] font-normal truncate text-gray-500 dark:text-gray-400">{{ humanLabel(row.name) }}</span>
            </div>
            <span class="text-[13px] font-semibold tabular-nums shrink-0 text-gray-900 dark:text-white">{{ row.value.toLocaleString() }}</span>
          </div>
          <p v-if="!chartData.length" class="text-gray-400 text-xs py-2">No data.</p>
        </div>
      </div>

      <!-- 1:1 port of App.jsx's line-type branch (~3878-3906): chart on top,
           a TOTAL/iOS/Android/Windows footer row below it (only the OS
           entries that actually have a value are shown). -->
      <div v-else-if="isLine" class="flex-1 min-h-0 flex flex-col">
        <div class="flex-1 w-full" style="min-height: 100px" :style="{ cursor: isClickable ? 'pointer' : 'default' }">
          <VChart :option="chartOption" :init-options="{ renderer: 'svg' }" autoresize class="h-full w-full" @click="onChartClick(null)" />
        </div>
        <div class="flex items-center justify-around border-t pt-2.5 pb-1 px-2 shrink-0 border-gray-100 dark:border-gray-700">
          <div v-for="row in lineFooterItems" :key="row.key" class="flex flex-col items-center gap-0.5">
            <span class="text-[9px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{{ row.key }}</span>
            <span class="text-[14px] font-bold tabular-nums" :style="{ color: row.color }">{{ row.val }}</span>
          </div>
        </div>
      </div>

      <div v-else-if="isChart" class="flex-1 min-h-0" :style="{ cursor: isClickable ? 'pointer' : 'default' }">
        <!-- Bar/gauge fire per-slice clicks (e.name); radar has no sliced
             data, so any click drills into the widget's full item set with
             no slice filter — 1:1 port of App.jsx's BarWidget (~1040, no
             sliceName), gauge (~3931, primaryItem.name), and radar (~3947,
             no sliceName). -->
        <VChart :option="chartOption" :init-options="{ renderer: 'svg' }" autoresize class="h-full w-full" @click="onChartClick(chartType === 'gauge' ? (chartData[0]?.name ?? null) : null)" />
      </div>

      <!-- 1:1 port of ListProgressRow (App.jsx ~618-647), shared by both
           "list" and "progress" — a colored dot (or, for stats_os_updates_all
           rows only, the platform's OsIcon) using the exact same colorFor()/
           OS-color result every other chart type uses, "Most used · " bold
           prefix on stats_models' first row, and (progress only) a fill-bar
           track tinted `${color}20` with the fill itself in `color` — not
           the flat brand-blue this previously rendered every row as. -->
      <div v-else-if="chartType === 'list' || chartType === 'progress'" class="flex-1 overflow-y-auto flex flex-col gap-1">
        <div
          v-for="(row, i) in chartData"
          :key="row.name"
          class="flex flex-col gap-1.5 px-2 py-2 rounded-lg transition-colors"
          :class="isClickable ? 'cursor-pointer hover:opacity-75' : ''"
          @click="onChartClick(row.name)"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <div v-if="rowOsPlatform(row.name)" class="flex items-center justify-center shrink-0 w-5 h-5">
                <OsIcon :platform="rowOsPlatform(row.name)!" :size="14" :color="rowColor(row.name, i)" />
              </div>
              <div v-else class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: rowColor(row.name, i) }" />
              <span class="text-[14px] font-normal truncate text-gray-500 dark:text-gray-400">
                <span v-if="widget.stat === 'stats_models' && i === 0" class="font-medium">Most used · </span>{{ humanLabel(row.name) }}
              </span>
            </div>
            <span class="text-[14px] font-semibold tabular-nums shrink-0 text-gray-900 dark:text-white">{{ row.value }}</span>
          </div>
          <div v-if="chartType === 'progress'" class="w-full h-1.5 rounded-full overflow-hidden" :style="{ backgroundColor: rowColor(row.name, i) + '20' }">
            <div class="h-full rounded-full transition-all duration-700 ease-out" :style="{ width: (row.value / maxListValue) * 100 + '%', backgroundColor: rowColor(row.name, i) }" />
          </div>
        </div>
        <p v-if="!chartData.length" class="text-gray-400 text-xs py-2">No data.</p>
      </div>
    </template>
  </div>
</template>
