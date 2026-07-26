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

const props = defineProps<{
  widget: DashboardWidget;
  data: WidgetResponse | null;
  isLoading: boolean;
  error: string | null;
}>();

const PALETTE = ["#0E4FF5", "#A855F7", "#0078D4", "#EC4899", "#14B8A6", "#F59E0B", "#EF4444", "#3DDC84", "#6366F1", "#84CC16"];
function colorFor(idx: number): string {
  return PALETTE[idx % PALETTE.length];
}

const chartType = computed<ChartType>(() => props.widget.type);
const chartData = computed(() => props.data?.chartData ?? []);
const trendData = computed(() => props.data?.trendData);
const total = computed(() => chartData.value.reduce((a, c) => a + (c.value || 0), 0));

const isChart = computed(() => ["donut", "pie", "bar", "line", "radar", "gauge"].includes(chartType.value));

const chartOption = computed(() => {
  const t = chartType.value;
  if (t === "donut" || t === "pie") {
    return {
      tooltip: { trigger: "item" },
      legend: { show: false },
      series: [
        {
          type: "pie",
          radius: t === "donut" ? ["55%", "80%"] : ["0%", "80%"],
          avoidLabelOverlap: true,
          label: { show: false },
          data: chartData.value.map((d, i) => ({ name: d.name, value: d.value, itemStyle: { color: colorFor(i) } })),
        },
      ],
      graphic: t === "donut" ? [{ type: "text", left: "center", top: "center", style: { text: total.value.toLocaleString(), fontSize: 22, fontWeight: 700, fill: "#111827" } }] : [],
    };
  }
  if (t === "bar") {
    return {
      tooltip: { trigger: "item" },
      grid: { top: 16, bottom: 32, left: 40, right: 16 },
      xAxis: { type: "category", data: chartData.value.map((d) => d.name), axisLabel: { fontSize: 10, rotate: chartData.value.length > 5 ? 30 : 0 } },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: chartData.value.map((d, i) => ({ value: d.value, itemStyle: { color: colorFor(i), borderRadius: [4, 4, 0, 0] } })) }],
    };
  }
  if (t === "line") {
    return {
      tooltip: { trigger: "axis" },
      grid: { top: 16, bottom: 32, left: 40, right: 16 },
      xAxis: { type: "category", data: trendData.value?.labels ?? [] },
      yAxis: { type: "value" },
      series: [{ type: "line", smooth: true, data: trendData.value?.series ?? [], areaStyle: { color: "#0E4FF518" }, itemStyle: { color: "#0E4FF5" }, symbol: "circle", symbolSize: 5 }],
    };
  }
  if (t === "radar") {
    return {
      tooltip: {},
      radar: { indicator: chartData.value.map((d) => ({ name: d.name, max: Math.max(total.value, 1) })) },
      series: [{ type: "radar", data: [{ value: chartData.value.map((d) => d.value), areaStyle: { color: "#0E4FF530" }, itemStyle: { color: "#0E4FF5" } }] }],
    };
  }
  if (t === "gauge") {
    const primary = chartData.value[0];
    const val = primary && total.value > 0 ? Math.round((primary.value / total.value) * 100) : 0;
    return {
      series: [{ type: "gauge", startAngle: 180, endAngle: 0, min: 0, max: 100, progress: { show: true, roundCap: true, itemStyle: { color: colorFor(0) } }, pointer: { show: false }, axisLine: { lineStyle: { width: 12 } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, detail: { valueAnimation: true, fontSize: 22, formatter: "{value}%", offsetCenter: [0, "20%"] }, data: [{ value: val }] }],
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
        <p class="text-4xl font-semibold text-gray-900">{{ (data?.scorecardValue ?? 0).toLocaleString() }}</p>
      </div>

      <div v-else-if="isChart" class="flex-1 min-h-0">
        <VChart :option="chartOption" autoresize class="h-full w-full" />
      </div>

      <div v-else-if="chartType === 'list'" class="flex-1 overflow-y-auto text-sm divide-y divide-gray-100">
        <div v-for="row in chartData" :key="row.name" class="flex justify-between py-1.5">
          <span class="text-gray-600 truncate pr-2">{{ row.name }}</span>
          <span class="font-medium text-gray-900">{{ row.value }}</span>
        </div>
        <p v-if="!chartData.length" class="text-gray-400 text-xs py-2">No data.</p>
      </div>

      <div v-else-if="chartType === 'progress'" class="flex-1 overflow-y-auto space-y-2">
        <div v-for="row in chartData" :key="row.name">
          <div class="flex justify-between text-xs font-medium text-gray-600 mb-1">
            <span class="truncate pr-2">{{ row.name }}</span><span>{{ row.value }}</span>
          </div>
          <div class="w-full h-2 bg-gray-100 rounded-full">
            <div class="h-2 bg-brand-600 rounded-full" :style="{ width: (total ? (row.value / Math.max(...chartData.map((d) => d.value), 1)) * 100 : 0) + '%' }" />
          </div>
        </div>
        <p v-if="!chartData.length" class="text-gray-400 text-xs py-2">No data.</p>
      </div>
    </template>
  </div>
</template>
