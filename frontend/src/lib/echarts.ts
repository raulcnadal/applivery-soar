// Central echarts registration for vue-echarts (tree-shaken core build) —
// import this once (side-effect only) before any component renders a
// <v-chart>. Only the chart/component types the widget engine's ALL_CHART_TYPES
// actually uses are registered (see analyticsCatalog.ts).
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart, GaugeChart, LineChart, PieChart, RadarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";

use([CanvasRenderer, BarChart, GaugeChart, LineChart, PieChart, RadarChart, GridComponent, LegendComponent, TooltipComponent]);
