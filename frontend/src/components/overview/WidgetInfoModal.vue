<script setup lang="ts">
// Widget "zoom" modal — 1:1 port of App.jsx's WidgetInfoModal (~lines
// 1227-1537): re-renders the clicked widget's chart full-size with its own
// bigger option-builders (mirroring the original's own architecture, which
// keeps a second, larger-scale set of chart builders separate from the live
// WidgetCard's), plus a "How is it calculated?" description pulled from
// WIDGET_DESCRIPTIONS. Replaces the metadata-only placeholder popover
// OverviewView.vue shipped earlier in the roadmap.
import "../../lib/echarts";
import VChart from "vue-echarts";
import { computed, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { getWidgetInfo } from "../../lib/widgetDescriptions";
import { colorFor, humanLabel, brighten, PRIMARY_BLUE } from "../../lib/widgetVisuals";
import type { DashboardWidget } from "../../lib/analyticsCatalog";
import type { WidgetResponse } from "../../lib/widgetData";
import type { DateRangeValue } from "./DateRangePicker.vue";

const props = defineProps<{
  widget: DashboardWidget;
  data: WidgetResponse | null;
  dateRange: DateRangeValue;
}>();

const emit = defineEmits<{ close: [] }>();

const CARD_BG = "#FFFFFF";
const BORDER = "#E5E7EB";
const TEXT = "#111827";
const TEXT_MUTED = "#6B7280";
const BG = "#F9FAFB";
const GRID_LINE = "#F3F4F6";

const info = computed(() => getWidgetInfo(props.widget?.stat, props.widget?.title));
const chartData = computed(() => props.data?.chartData ?? []);
const trendData = computed(() => props.data?.trendData);
const scorecardValue = computed(() => props.data?.scorecardValue ?? 0);

const type = computed(() => props.widget?.type ?? "");
const isDonut = computed(() => type.value === "donut");
const isPie = computed(() => type.value === "pie");
const isBar = computed(() => type.value === "bar");
const isLine = computed(() => type.value === "line");
const isGauge = computed(() => type.value === "gauge");
const isRadar = computed(() => type.value === "radar");
const isList = computed(() => type.value === "list");
const isProgress = computed(() => type.value === "progress");
const isScorecard = computed(() => type.value === "scorecard");

const hovIdx = ref(-1);
const total = computed(() => chartData.value.reduce((a, c) => a + (c.value || 0), 0));

function fmtDate(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

const tooltipBase = { backgroundColor: CARD_BG, borderColor: BORDER, textStyle: { color: TEXT, fontFamily: "Outfit, sans-serif", fontSize: 12 } };
const axisLabelStyle = { color: TEXT_MUTED, fontSize: 11, fontFamily: "Outfit, sans-serif" };

// ── Donut / Pie — identical ghost+solid two-series as the live widget ──
function buildDonutOption() {
  const outerR = "72%";
  const innerR = isDonut.value ? "54%" : "0%";
  const slices = chartData.value.map((d, i) => ({ name: humanLabel(d.name), value: d.value, color: colorFor(props.widget.stat, d.name, i) }));
  return {
    backgroundColor: "transparent",
    tooltip: { trigger: "item", formatter: "{b}: <b>{c}</b> ({d}%)", ...tooltipBase },
    legend: { show: false },
    series: [
      {
        type: "pie",
        z: 1,
        silent: false,
        radius: [innerR, outerR],
        center: ["50%", "50%"],
        label: { show: false },
        emphasis: { scale: hovIdx.value !== -1, scaleSize: 10, itemStyle: { borderWidth: 0 } },
        data: slices.map((d, i) => ({ name: d.name, value: d.value, itemStyle: { color: d.color, opacity: hovIdx.value === -1 ? 0.38 : hovIdx.value === i ? 0.38 : 0, borderWidth: 0 } })),
      },
      {
        type: "pie",
        z: 2,
        silent: true,
        radius: [innerR, outerR],
        center: ["50%", "50%"],
        label: { show: false },
        emphasis: { scale: false, itemStyle: { borderWidth: 0 } },
        data: slices.map((d, i) => ({ name: d.name, value: d.value, itemStyle: { color: d.color, opacity: hovIdx.value === -1 ? 1 : hovIdx.value === i ? 1 : 0.15, borderWidth: 0 } })),
      },
    ],
    graphic: isDonut.value
      ? [
          {
            type: "group",
            left: "center",
            top: "center",
            children: [
              { type: "text", style: { text: total.value.toLocaleString(), font: "700 32px Outfit,sans-serif", fill: TEXT, textAlign: "center", y: -16 } },
              { type: "text", style: { text: "Total", font: "400 13px Outfit,sans-serif", fill: TEXT_MUTED, textAlign: "center", y: 22 } },
            ],
          },
        ]
      : [],
  };
}

// ── Bar — identical single-series + focus/blur as the live widget ──
function buildBarOption() {
  return {
    backgroundColor: "transparent",
    tooltip: { trigger: "item", ...tooltipBase },
    legend: { show: false },
    grid: { top: 12, bottom: 40, left: 48, right: 16 },
    xAxis: { type: "category", data: chartData.value.map((d) => humanLabel(d.name)), axisLabel: axisLabelStyle, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "value", axisLabel: axisLabelStyle, splitLine: { lineStyle: { color: GRID_LINE } }, axisLine: { show: false }, axisTick: { show: false } },
    series: [
      {
        type: "bar",
        barMaxWidth: 40,
        emphasis: { focus: "self", blurScope: "global", scale: false },
        blur: { itemStyle: { opacity: 0.25 } },
        data: chartData.value.map((d, i) => {
          const color = colorFor(props.widget.stat, d.name, i);
          return {
            value: d.value,
            itemStyle: { color, borderRadius: [4, 4, 0, 0], borderWidth: 0 },
            emphasis: { itemStyle: { color: brighten(color), borderRadius: [4, 4, 0, 0], borderWidth: 0 } },
            blur: { itemStyle: { color, opacity: 0.25, borderWidth: 0 } },
          };
        }),
      },
    ],
  };
}

// ── Line / trend ──
function buildLineOption() {
  return {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", ...tooltipBase },
    legend: { show: false },
    grid: { top: 12, bottom: 40, left: 48, right: 16 },
    xAxis: { type: "category", data: trendData.value?.labels ?? [], axisLabel: axisLabelStyle, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "value", axisLabel: axisLabelStyle, splitLine: { lineStyle: { color: GRID_LINE } }, axisLine: { show: false }, axisTick: { show: false } },
    series: [
      {
        type: "line",
        smooth: true,
        data: trendData.value?.series ?? [],
        itemStyle: { color: PRIMARY_BLUE },
        lineStyle: { color: PRIMARY_BLUE, width: 2.5 },
        areaStyle: { color: `${PRIMARY_BLUE}18` },
        symbol: "circle",
        symbolSize: 6,
        emphasis: { itemStyle: { borderWidth: 2, borderColor: PRIMARY_BLUE, color: "#fff" } },
      },
    ],
  };
}

// ── Gauge — same as live gauge widget ──
function buildGaugeOption() {
  const primaryItem = chartData.value[0];
  const val = primaryItem && total.value > 0 ? Math.round((primaryItem.value / total.value) * 100) : 0;
  const color = primaryItem ? colorFor(props.widget.stat, primaryItem.name, 0) : PRIMARY_BLUE;
  return {
    backgroundColor: "transparent",
    series: [
      {
        type: "gauge",
        startAngle: 180,
        endAngle: 0,
        min: 0,
        max: 100,
        pointer: { show: false },
        progress: { show: true, overlap: false, roundCap: true, clip: false, itemStyle: { color, borderWidth: 0 } },
        axisLine: { lineStyle: { width: 18, color: [[1, BORDER]] } },
        splitLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        data: [{ value: val, name: primaryItem ? humanLabel(primaryItem.name) : "" }],
        title: { fontSize: 14, color: TEXT_MUTED, offsetCenter: [0, "30%"], fontFamily: "Outfit,sans-serif" },
        detail: { fontSize: 36, color: TEXT, fontWeight: "bold", offsetCenter: [0, "-5%"], formatter: "{value}%", fontFamily: "Outfit,sans-serif" },
      },
    ],
  };
}

// ── Radar ──
function buildRadarOption() {
  const maxVal = Math.max(...chartData.value.map((d) => d.value), 0) * 1.2 || 10;
  return {
    backgroundColor: "transparent",
    tooltip: { trigger: "item", ...tooltipBase },
    radar: {
      indicator: chartData.value.map((d) => ({ name: humanLabel(d.name), max: maxVal })),
      radius: "65%",
      axisName: { color: TEXT_MUTED, fontSize: 11, fontFamily: "Outfit,sans-serif" },
      splitLine: { lineStyle: { color: GRID_LINE } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: BORDER } },
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
            emphasis: { itemStyle: { color: PRIMARY_BLUE, borderWidth: 8 }, lineStyle: { width: 3 } },
          },
        ],
      },
    ],
  };
}

// ── List / Progress — horizontal bar chart representation ──
function buildListOption() {
  return {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...tooltipBase },
    legend: { show: false },
    grid: { top: 8, bottom: 8, left: 8, right: 60, containLabel: true },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category",
      data: chartData.value.map((d) => humanLabel(d.name)).reverse(),
      axisLabel: { color: TEXT_MUTED, fontSize: 11, fontFamily: "Outfit,sans-serif" },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 16,
        emphasis: { focus: "self", blurScope: "global" },
        blur: { itemStyle: { opacity: 0.25 } },
        label: { show: true, position: "right", color: TEXT_MUTED, fontSize: 11, fontFamily: "Outfit,sans-serif", formatter: "{c}" },
        data: chartData.value
          .map((d, i) => {
            const color = colorFor(props.widget.stat, d.name, i);
            return {
              value: d.value,
              itemStyle: { color, borderRadius: [0, 4, 4, 0], borderWidth: 0 },
              emphasis: { itemStyle: { color: brighten(color), borderRadius: [0, 4, 4, 0] } },
              blur: { itemStyle: { color, opacity: 0.25 } },
            };
          })
          .reverse(),
      },
    ],
  };
}

// Decide what to show — same gating as the original (App.jsx:1394-1400).
const hasDonutPie = computed(() => (isDonut.value || isPie.value) && chartData.value.length > 0);
const hasBar = computed(() => isBar.value && chartData.value.length > 0);
const hasLine = computed(() => isLine.value && (trendData.value?.series?.length ?? 0) > 0);
const hasGauge = computed(() => isGauge.value && chartData.value.length > 0);
const hasRadar = computed(() => isRadar.value && chartData.value.length > 0);
const hasListBar = computed(() => (isList.value || isProgress.value) && chartData.value.length > 0);
const hasTrend = computed(() => !hasLine.value && (isGauge.value || isList.value || isProgress.value) && (trendData.value?.series?.length ?? 0) > 0);

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit("close");
}
function onDonutHover(p: any) {
  if (p.seriesIndex === 0) hovIdx.value = p.dataIndex;
}
function onDonutOut(p: any) {
  if (p.seriesIndex === 0) hovIdx.value = -1;
}
</script>

<template>
  <div class="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4" @click="onOverlayClick">
    <div class="w-full max-w-xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto" :style="{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}` }">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 pt-5 pb-4 border-b shrink-0" :style="{ borderColor: BORDER }">
        <div class="flex items-center gap-3 min-w-0">
          <span class="text-base font-semibold truncate" :style="{ color: TEXT }">{{ info.label }}</span>
          <span class="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" :style="{ backgroundColor: `${PRIMARY_BLUE}12`, color: PRIMARY_BLUE }">
            {{ fmtDate(dateRange?.from) }} – {{ fmtDate(dateRange?.to) }}
          </span>
        </div>
        <button type="button" class="w-8 h-8 flex items-center justify-center rounded-full hover:opacity-70 transition-opacity ml-3 shrink-0" :style="{ color: TEXT_MUTED, backgroundColor: `${TEXT_MUTED}12` }" @click="emit('close')">
          <component :is="ICONS.CloseCircle" :size="15" weight="Linear" />
        </button>
      </div>

      <div class="px-6 pt-6 pb-2 flex flex-col gap-6">
        <!-- Donut / Pie: centred chart + inline legend below -->
        <div v-if="hasDonutPie" class="flex flex-col items-center gap-2">
          <div class="relative" style="width: 260px; height: 260px">
            <VChart :option="buildDonutOption()" autoresize style="width: 100%; height: 100%" @mouseover="onDonutHover" @mouseout="onDonutOut" />
          </div>
          <div class="flex items-center justify-center gap-5 flex-wrap">
            <div
              v-for="(d, i) in chartData"
              :key="i"
              class="flex items-center gap-1.5 transition-opacity"
              :style="{ opacity: hovIdx === -1 ? 1 : hovIdx === i ? 1 : 0.35 }"
            >
              <div class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: colorFor(widget.stat, d.name, i) }" />
              <span class="text-sm" :style="{ color: TEXT_MUTED }">{{ humanLabel(d.name) }}</span>
              <span class="text-sm font-semibold tabular-nums" :style="{ color: TEXT }">{{ d.value.toLocaleString() }}</span>
            </div>
          </div>
        </div>

        <!-- Bar: full-width -->
        <div v-if="hasBar" :style="{ width: '100%', height: Math.max(200, chartData.length * 36 + 60) + 'px' }">
          <VChart :option="buildBarOption()" autoresize style="width: 100%; height: 100%" />
        </div>

        <!-- Line trend -->
        <div v-if="hasLine" class="flex flex-col gap-3">
          <div class="flex items-baseline gap-2 px-1">
            <span class="text-4xl font-bold tabular-nums" :style="{ color: TEXT }">{{ scorecardValue.toLocaleString() }}</span>
            <span class="text-sm" :style="{ color: TEXT_MUTED }">{{ info.summary }}</span>
          </div>
          <div style="width: 100%; height: 200px">
            <VChart :option="buildLineOption()" autoresize style="width: 100%; height: 100%" />
          </div>
        </div>

        <!-- Gauge: centred + breakdown -->
        <div v-if="hasGauge" class="flex flex-col items-center gap-1">
          <div style="width: 280px; height: 180px">
            <VChart :option="buildGaugeOption()" autoresize style="width: 100%; height: 100%" />
          </div>
          <div class="flex items-center justify-center gap-5 flex-wrap mt-1">
            <div v-for="(d, i) in chartData" :key="i" class="flex items-center gap-1.5">
              <div class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: colorFor(widget.stat, d.name, i) }" />
              <span class="text-sm" :style="{ color: TEXT_MUTED }">{{ humanLabel(d.name) }}</span>
              <span class="text-sm font-semibold tabular-nums" :style="{ color: TEXT }">{{ d.value.toLocaleString() }}</span>
            </div>
          </div>
        </div>

        <!-- Radar: centred -->
        <div v-if="hasRadar" style="width: 100%; height: 260px">
          <VChart :option="buildRadarOption()" autoresize style="width: 100%; height: 100%" />
        </div>

        <!-- List / Progress: horizontal bar chart -->
        <div v-if="hasListBar" :style="{ width: '100%', height: Math.max(160, chartData.length * 32 + 24) + 'px' }">
          <VChart :option="buildListOption()" autoresize style="width: 100%; height: 100%" />
        </div>

        <!-- Gauge/List with trendData fallback -->
        <div v-if="hasTrend" class="flex flex-col gap-3">
          <div class="flex items-baseline gap-2 px-1">
            <span class="text-4xl font-bold tabular-nums" :style="{ color: TEXT }">{{ scorecardValue.toLocaleString() }}</span>
            <span class="text-sm" :style="{ color: TEXT_MUTED }">{{ info.summary }}</span>
          </div>
          <div style="width: 100%; height: 200px">
            <VChart :option="buildLineOption()" autoresize style="width: 100%; height: 100%" />
          </div>
        </div>

        <!-- Scorecard: big centred number -->
        <div v-if="isScorecard" class="flex flex-col items-center py-6 gap-1">
          <span class="text-6xl font-bold tabular-nums" :style="{ color: TEXT }">{{ scorecardValue.toLocaleString() }}</span>
          <span class="text-base mt-1" :style="{ color: TEXT_MUTED }">{{ info.summary }}</span>
        </div>

        <!-- "How is it calculated" -->
        <div class="rounded-xl p-4 mb-6" :style="{ backgroundColor: BG, border: `1px solid ${BORDER}` }">
          <p class="text-sm font-semibold mb-2" :style="{ color: TEXT }">How is it calculated?</p>
          <p class="text-sm leading-relaxed" :style="{ color: TEXT_MUTED }">{{ info.desc }}</p>
          <a href="https://www.applivery.com/docs/" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 mt-3 text-sm font-medium hover:underline" :style="{ color: PRIMARY_BLUE }">
            Learn more about metrics definitions
            <component :is="ICONS.ArrowRightUp" :size="12" weight="Linear" />
          </a>
        </div>
      </div>
    </div>
  </div>
</template>
