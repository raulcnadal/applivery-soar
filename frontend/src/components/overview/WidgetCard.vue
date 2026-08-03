<script setup lang="ts">
// Generic widget renderer — port of App.jsx's per-type chart-option builders
// (buildDonutOption/buildBarOption/buildLineOption/buildGaugeOption, etc.,
// wow-dashboard/src/App.jsx:1260+), condensed into one component covering
// every ALL_CHART_TYPES entry. Data fetching/caching is the parent's job
// (OverviewView.vue) — this only renders whatever WidgetResponse it's given.
import "../../lib/echarts";
import VChart from "vue-echarts";
import { computed } from "vue";
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
import { colorFor, humanLabel } from "../../lib/widgetVisuals";

const props = defineProps<{
  widget: DashboardWidget;
  data: WidgetResponse | null;
  isLoading: boolean;
  error: string | null;
}>();

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

const isChart = computed(() => ["donut", "pie", "bar", "line", "radar", "gauge"].includes(chartType.value));

const chartOption = computed(() => {
  const t = chartType.value;
  const th = theme.value;
  const tooltipBase = { backgroundColor: th.card, borderColor: th.border, textStyle: { color: th.text } };
  const axisLabelStyle = { fontSize: 10, color: th.textMuted };
  if (t === "donut" || t === "pie") {
    return {
      tooltip: { trigger: "item", ...tooltipBase },
      legend: { show: false },
      series: [
        {
          type: "pie",
          radius: t === "donut" ? ["55%", "80%"] : ["0%", "80%"],
          avoidLabelOverlap: true,
          label: { show: false },
          data: chartData.value.map((d, i) => ({ name: humanLabel(d.name), value: d.value, itemStyle: { color: colorFor(props.widget.stat, d.name, i) } })),
        },
      ],
      graphic: t === "donut" ? [{ type: "text", left: "center", top: "center", style: { text: total.value.toLocaleString(), fontSize: 22, fontWeight: 700, fill: th.text } }] : [],
    };
  }
  if (t === "bar") {
    return {
      tooltip: { trigger: "item", ...tooltipBase },
      grid: { top: 16, bottom: 32, left: 40, right: 16 },
      xAxis: { type: "category", data: chartData.value.map((d) => humanLabel(d.name)), axisLabel: { ...axisLabelStyle, rotate: chartData.value.length > 5 ? 30 : 0 }, axisLine: { lineStyle: { color: th.border } } },
      yAxis: { type: "value", axisLabel: axisLabelStyle, splitLine: { lineStyle: { color: th.gridLine } } },
      series: [{ type: "bar", data: chartData.value.map((d, i) => ({ value: d.value, itemStyle: { color: colorFor(props.widget.stat, d.name, i), borderRadius: [4, 4, 0, 0] } })) }],
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
          detail: { valueAnimation: true, fontSize: 22, formatter: "{value}%", offsetCenter: [0, "20%"], color: th.text },
          data: [{ value: val }],
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
      <div v-if="chartType === 'scorecard'" class="flex-1 flex flex-col items-center justify-center">
        <p class="text-4xl font-semibold text-gray-900 dark:text-white">{{ (data?.scorecardValue ?? 0).toLocaleString() }}</p>
      </div>

      <div v-else-if="isChart" class="flex-1 min-h-0">
        <VChart :option="chartOption" autoresize class="h-full w-full" />
      </div>

      <div v-else-if="chartType === 'list'" class="flex-1 overflow-y-auto text-sm divide-y divide-gray-100 dark:divide-gray-700">
        <div v-for="row in chartData" :key="row.name" class="flex justify-between py-1.5">
          <span class="text-gray-600 dark:text-gray-300 truncate pr-2">{{ humanLabel(row.name) }}</span>
          <span class="font-medium text-gray-900 dark:text-white">{{ row.value }}</span>
        </div>
        <p v-if="!chartData.length" class="text-gray-400 text-xs py-2">No data.</p>
      </div>

      <div v-else-if="chartType === 'progress'" class="flex-1 overflow-y-auto space-y-2">
        <div v-for="row in chartData" :key="row.name">
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
