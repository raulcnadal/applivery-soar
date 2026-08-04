// Central echarts registration for vue-echarts (tree-shaken core build) —
// import this once (side-effect only) before any component renders a
// <v-chart>. Only the chart/component types the widget engine's ALL_CHART_TYPES
// actually uses are registered (see analyticsCatalog.ts).
import { use } from "echarts/core";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import { BarChart, GaugeChart, LineChart, PieChart, RadarChart } from "echarts/charts";
import { GraphicComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";

// GraphicComponent was missing here — the tree-shaken echarts/core build
// silently drops any `graphic` entry in a chart option (no error, it's just
// ignored) unless this is registered, which is why the donut/pie center
// "Total" text (WidgetCard.vue's chartOption and WidgetInfoModal.vue's
// buildDonutOption, both 1:1 ports of DonutPieWidget's `graphic` group,
// App.jsx ~1112-1117) never rendered despite the option object itself being
// correct. SVGRenderer is also registered — the original renders every
// chart with `opts={{ renderer: 'svg' }}` (crisper text/lines at small
// widget-card sizes than canvas), which this build never opted into either.
use([CanvasRenderer, SVGRenderer, BarChart, GaugeChart, LineChart, PieChart, RadarChart, GraphicComponent, GridComponent, LegendComponent, TooltipComponent]);
