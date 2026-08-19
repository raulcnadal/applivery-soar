import fs from "node:fs";
import path from "node:path";
import type { WidgetResponse } from "../analytics/widgets.service";

/**
 * HTML report template — Node re-architecture of main.py:15606-15779's
 * WeasyPrint + Jinja2 + Matplotlib PDF pipeline (see migration-plan.md §8
 * Phase 7: "Puppeteer PDF pipeline"). Charts are real Chart.js canvases
 * rendered live by Puppeteer's headless Chromium, then printed to PDF —
 * replacing the original's server-side Matplotlib PNGs with an equivalent
 * client-rendered chart, same visual intent (trend line/bar, donut/pie/
 * radar/bar distribution, standard table, or horizontal progress bars).
 * Chart.js is vendored as a static asset (assets/vendor/chart.umd.js) and
 * inlined directly into the page so PDF generation needs no network access
 * at runtime (the container may not have one, and shouldn't need one just
 * to render a report).
 *
 * Branding assets follow the same "vendor it, inline it, no network at
 * render time" rule: the wordmark (assets/vendor/applivery-logo.svg, the
 * same white-fill SVG LoginView.vue uses) is inlined as raw markup in the
 * top bar, and Outfit — the BlueSky design system's --font-sans, normally
 * pulled from Google Fonts via a <link> in frontend/index.html — is
 * vendored locally as three woff2 weights (400/600/700, via
 * @fontsource/outfit, OFL-1.1 licensed — see assets/vendor/fonts/) and
 * embedded as base64 data-URI @font-face rules. A <link> to Google Fonts
 * would work fine when Puppeteer's container does have egress, but silently
 * depending on that would quietly break this exact "no network needed"
 * property for anyone running it without one.
 */

export interface ReportDisplayOptions {
  trend?: boolean;
  trend_type?: string; // 'line' | 'bar'
  donut?: boolean;
  donut_type?: string; // 'donut' | 'pie' | 'bar' | 'radar'
  table?: boolean;
  table_type?: string; // 'standard' | 'progress'
}

const CHART_JS_SOURCE = fs.readFileSync(path.resolve(__dirname, "../../../assets/vendor/chart.umd.js"), "utf-8");
const APPLIVERY_LOGO_SVG = fs.readFileSync(path.resolve(__dirname, "../../../assets/vendor/applivery-logo.svg"), "utf-8");
const OUTFIT_400_B64 = fs.readFileSync(path.resolve(__dirname, "../../../assets/vendor/fonts/outfit-400.woff2")).toString("base64");
const OUTFIT_600_B64 = fs.readFileSync(path.resolve(__dirname, "../../../assets/vendor/fonts/outfit-600.woff2")).toString("base64");
const OUTFIT_700_B64 = fs.readFileSync(path.resolve(__dirname, "../../../assets/vendor/fonts/outfit-700.woff2")).toString("base64");

const PALETTE = ["#0E4FF5", "#A855F7", "#0078D4", "#EC4899", "#14B8A6", "#F59E0B", "#EF4444", "#3DDC84"];

function colorFor(name: string, idx: number): string {
  const n = name.toUpperCase();
  if (n.includes("LESS THAN 20") || n.includes("NON") || n.includes("NOT")) return "#EF4444";
  if (n.includes("MORE THAN 70") || n.includes("ACTIVE") || n.includes("COMPLIAN")) return "#3DDC84";
  if (n.includes("BETWEEN") || n.includes("PENDING") || n.includes("MEDIUM")) return "#F59E0B";
  if (n.includes("APPLE") || n.includes("IOS") || n.includes("MAC")) return "#007AFF";
  if (n.includes("ANDROID")) return "#3DDC84";
  if (n.includes("WINDOWS") || n.includes("WIN")) return "#0078D4";
  return PALETTE[idx % PALETTE.length];
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tableHtml(chartData: Array<{ name: string; value: number }>, tableType: string | undefined): string {
  if (tableType === "progress") {
    const maxVal = Math.max(...chartData.map((d) => Number(d.value) || 0), 1);
    const rows = chartData.slice(0, 15).map((row) => {
      const nameStr = titleCase(String(row.name)).slice(0, 60);
      const val = Number(row.value) || 0;
      const pct = (val / maxVal) * 100;
      return `<div style="margin-bottom:12px;page-break-inside:avoid;break-inside:avoid;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;font-weight:600;color:#334155;">
          <span>${escapeHtml(nameStr)}</span><span>${Math.trunc(val)}</span>
        </div>
        <div style="width:100%;background:#E2E8F0;border-radius:6px;height:10px;">
          <div style="width:${pct}%;background:#0E4FF5;height:100%;border-radius:6px;"></div>
        </div>
      </div>`;
    });
    return `<div style="margin-top:10px;">${rows.join("")}</div>`;
  }
  const rows = chartData.slice(0, 20).map((row) => `<tr><td>${escapeHtml(titleCase(String(row.name)).slice(0, 60))}</td><td style="text-align:right;">${row.value}</td></tr>`).join("");
  return `<table><thead><tr><th>Metric</th><th style="text-align:right;">Value</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * Minimal Jinja2-subset renderer for the one custom-template grammar the
 * original ever supported (see template.html): `{{ Var }}` substitution and
 * exactly two `{% for x in list %}...{% endfor %}` loop shapes (`metadata`,
 * `report_sections`), each with `{% if section.field %}...{% endif %}`
 * conditionals inside. Not a general template engine — deliberately scoped
 * to the fixed variable/loop names main.py's Jinja2 `Template(...).render(...)`
 * call ever passed, since that's the only grammar an existing custom
 * template (saved from Settings) could possibly use.
 */
function renderCustomTemplate(template: string, vars: Record<string, any>): string {
  let out = template;
  // {% for X in metadata %}...{% endfor %} / {% for X in report_sections %}...{% endfor %}
  out = out.replace(/\{%\s*for\s+(\w+)\s+in\s+(metadata|report_sections)\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g, (_m, itemVar, listName, body) => {
    const list: any[] = vars[listName] ?? [];
    return list.map((item) => renderLoopBody(body, itemVar, item)).join("");
  });
  // Top-level {{ Var }} substitutions
  out = out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name) => (name in vars ? escapeHtml(String(vars[name])) : ""));
  return out;
}

function renderLoopBody(body: string, itemVar: string, item: Record<string, any>): string {
  let out = body;
  // {% if X.field %}...{% endif %}
  out = out.replace(new RegExp(`\\{%\\s*if\\s+${itemVar}\\.(\\w+)\\s*%\\}([\\s\\S]*?)\\{%\\s*endif\\s*%\\}`, "g"), (_m, field, inner) => (item[field] ? inner : ""));
  // {{ X.field }} and {{ X.field | safe }}
  out = out.replace(new RegExp(`\\{\\{\\s*${itemVar}\\.(\\w+)(\\s*\\|\\s*safe)?\\s*\\}\\}`, "g"), (_m, field, safe) => {
    const val = item[field] ?? "";
    return safe ? String(val) : escapeHtml(String(val));
  });
  return out;
}

// ── Sample data — shared by the Template preview endpoint (reports.controller.ts's
// GET /api/reports/template/preview) and validateCustomReportTemplate below,
// so both exercise the exact same representative shape a real report would
// produce, without needing a live Applivery credential or a real workspace's
// data. Two sources (one with a trend, one without) is enough to exercise
// every branch buildSections has (trend chart, donut/legend, plain table).
export const SAMPLE_REPORT_DATA: Record<string, WidgetResponse> = {
  device_compliance: {
    chartData: [
      { name: "Compliant", value: 42 },
      { name: "Non-compliant", value: 3 },
      { name: "Unknown", value: 5 },
    ],
    trendData: { labels: ["Jun", "Jul", "Aug"], series: [88, 91, 93], os_totals: { apple: 12, android: 8, windows: 30 } },
    scorecardValue: 93,
    items: [],
    orgProfile: {},
  },
  platform_distribution: {
    chartData: [
      { name: "Windows", value: 28 },
      { name: "macOS", value: 17 },
      { name: "Apple", value: 5 },
    ],
    trendData: { labels: [], series: [], os_totals: { apple: 5, android: 0, windows: 28 } },
    scorecardValue: 50,
    items: [],
    orgProfile: {},
  },
};

// Same field names buildReportHtml's custom-template branch actually passes
// to renderCustomTemplate (Workspace_Name/Report_Title/Generated_Date/
// Time_Lapse top-level, metadata[].label/.value, report_sections[].section_title/
// .image_source/.html_table/.is_full_width) — kept in sync with that call
// site by hand since renderCustomTemplate's grammar is fixed/closed rather
// than driven by a shared schema.
const SAMPLE_TEMPLATE_VARS: Record<string, any> = {
  Workspace_Name: "Sample Workspace",
  Report_Title: "Analytics Report",
  Generated_Date: "2026-01-01 09:00",
  Time_Lapse: "Last 30 days",
  metadata: [
    { label: "Workspace Slug", value: "sample-workspace" },
    { label: "Sources Analyzed", value: "2" },
    { label: "Applied Filters", value: "None" },
  ],
  report_sections: [
    {
      section_title: "Device Compliance",
      image_source: null,
      html_table: "<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody><tr><td>Compliant</td><td>42</td></tr><tr><td>Non-compliant</td><td>3</td></tr></tbody></table>",
      is_full_width: false,
    },
    {
      section_title: "Platform Distribution",
      image_source: null,
      html_table: "<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody><tr><td>Windows</td><td>28</td></tr><tr><td>macOS</td><td>17</td></tr></tbody></table>",
      is_full_width: true,
    },
  ],
};

export interface TemplateValidationResult {
  valid: boolean;
  error?: string;
}

// The only loop sources renderCustomTemplate's regex actually understands —
// see its own doc comment ("Not a general template engine"). Any other
// `{% for x in whatever %}` isn't an error to the renderer itself (the regex
// simply doesn't match it, so the tag is left as literal un-rendered text in
// the output — a scheduled report that "generates fine" but has raw
// `{% for ... %}` text baked into the PDF is a real, previously-reported-
// as-confusing failure mode this check exists to catch before save instead
// of after the next scheduled run).
const SUPPORTED_LOOP_SOURCES = new Set(["metadata", "report_sections"]);

/**
 * Validates a custom HTML report template BEFORE it's allowed to save
 * (dashboardState.controller.ts's POST /api/state) — the whole point being
 * that a broken template should fail loudly in Settings, not silently in a
 * scheduled report nobody's watching run. Checks, in order (cheapest/most
 * common mistake first):
 *
 *  1. Balanced {% for %}/{% endfor %} and {% if %}/{% endif %} tags — an
 *     unclosed block is the single most likely typo, and renderCustomTemplate's
 *     regex-based approach doesn't error on one; it just silently drops
 *     everything from the unclosed tag to the next matching tag (or renders
 *     nothing at all), a genuinely hard failure to notice by eyeballing a
 *     preview once and then not looking again for a month.
 *  2. Every {% for x in LIST %} uses a LIST this renderer actually supports
 *     (see SUPPORTED_LOOP_SOURCES above).
 *  3. Looks like an actual HTML document (has a <!DOCTYPE html> or <html>
 *     tag) rather than a bare fragment or plain text pasted by mistake —
 *     scheduled reports need a full standalone page, not a snippet.
 *  4. Actually renders without throwing, against SAMPLE_TEMPLATE_VARS above
 *     — the same renderCustomTemplate() call real report generation makes,
 *     just with representative sample data instead of a live pull. A typo'd
 *     variable name (`{{ Report_Titel }}`) can't be caught this way — it
 *     silently renders as an empty string in both this check and the real
 *     thing, same as Jinja2's own default undefined-variable behavior — but
 *     an actual renderer exception (a regex construction failure, etc.) is.
 *
 * Blank/whitespace-only input is always valid — it means "fall back to the
 * built-in default template" (buildReportHtml's own customTemplate.trim()
 * check), not "empty custom template".
 */
export function validateCustomReportTemplate(template: string): TemplateValidationResult {
  const trimmed = template.trim();
  if (!trimmed) return { valid: true };

  const forOpens = (trimmed.match(/\{%\s*for\s+\w+\s+in\s+\w+\s*%\}/g) ?? []).length;
  const forCloses = (trimmed.match(/\{%\s*endfor\s*%\}/g) ?? []).length;
  if (forOpens !== forCloses) {
    return { valid: false, error: `Unbalanced {% for %} / {% endfor %} tags — found ${forOpens} opening tag(s) and ${forCloses} closing tag(s).` };
  }
  const ifOpens = (trimmed.match(/\{%\s*if\s+[\w.]+\s*%\}/g) ?? []).length;
  const ifCloses = (trimmed.match(/\{%\s*endif\s*%\}/g) ?? []).length;
  if (ifOpens !== ifCloses) {
    return { valid: false, error: `Unbalanced {% if %} / {% endif %} tags — found ${ifOpens} opening tag(s) and ${ifCloses} closing tag(s).` };
  }

  const forTagRe = /\{%\s*for\s+\w+\s+in\s+(\w+)\s*%\}/g;
  let match: RegExpExecArray | null;
  while ((match = forTagRe.exec(trimmed))) {
    if (!SUPPORTED_LOOP_SOURCES.has(match[1])) {
      return {
        valid: false,
        error: `"{% for x in ${match[1]} %}" isn't a supported loop — this template engine only understands "{% for x in metadata %}" and "{% for x in report_sections %}".`,
      };
    }
  }

  if (!/<!doctype\s+html/i.test(trimmed) && !/<html[\s>]/i.test(trimmed)) {
    return { valid: false, error: "This doesn't look like a full HTML document (no <!DOCTYPE html> or <html> tag) — scheduled reports need a complete standalone page, not a fragment." };
  }

  try {
    renderCustomTemplate(trimmed, SAMPLE_TEMPLATE_VARS);
  } catch (e) {
    return { valid: false, error: `Template failed to render: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { valid: true };
}

// ── Downloadable starting point for "Custom HTML Template" (Reporting >
// Template) — deliberately NOT the literal markup buildReportHtml's default
// path below generates: that path inlines live Chart.js <canvas> rendering,
// base64-embedded fonts, and JS driving the charts, none of which a custom
// template can use (buildReportHtml's own doc comment: a custom template
// only ever gets report_sections[].html_table, never a chart image or
// canvas). This is instead a real, minimal, fully valid template written in
// the actual supported grammar (SUPPORTED_LOOP_SOURCES, {{ Var }}
// substitution) — something an admin can download, tweak, and re-upload as
// a genuine starting point rather than reverse-engineering the grammar from
// the docs paragraph alone.
export const DEFAULT_CUSTOM_TEMPLATE_SOURCE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Arial, Helvetica, sans-serif; background:#F4F7FB; margin:0; padding:0; color:#263238; }
  .top-bar { background:#0E4FF5; padding:24px 40px; }
  .top-bar .header-badge { color:#fff; font-size:15px; font-weight:600; }
  .report-container { padding:40px; box-sizing:border-box; }
  .report-title { color:#0E4FF5; font-size:32px; font-weight:700; margin:0 0 10px 0; }
  .report-date { color:#64748B; font-size:15px; }
  .metadata-bar { background:#fff; border-radius:10px; padding:24px 30px; display:flex; flex-wrap:wrap; gap:40px; border:1px solid #EAECEF; margin:24px 0 40px 0; }
  .meta-item { display:flex; flex-direction:column; }
  .meta-label { font-size:12px; text-transform:uppercase; color:#94A3B8; font-weight:600; margin-bottom:6px; }
  .meta-value { font-size:16px; color:#263238; font-weight:600; }
  .card { background:#fff; border-radius:10px; padding:32px; border:1px solid #EAECEF; margin-bottom:32px; break-inside:avoid; page-break-inside:avoid; }
  .card h2 { margin-top:0; font-size:18px; color:#0E4FF5; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th { text-align:left; padding:12px; background:#F8FAFC; border-bottom:2px solid #CBD5E1; }
  td { padding:12px; border-bottom:1px solid #F1F5F9; }
  .footer { background:#0E4FF5; color:#fff; padding:16px 40px; font-size:12px; }
</style>
</head>
<body>
  <div class="top-bar"><span class="header-badge">{{ Workspace_Name }} — Automated Report</span></div>
  <div class="report-container">
    <h1 class="report-title">{{ Report_Title }}</h1>
    <div class="report-date">Generated on: {{ Generated_Date }} | Time Lapse: {{ Time_Lapse }}</div>

    <div class="metadata-bar">
      {% for m in metadata %}
      <div class="meta-item"><span class="meta-label">{{ m.label }}</span><span class="meta-value">{{ m.value }}</span></div>
      {% endfor %}
    </div>

    {% for s in report_sections %}
    <div class="card">
      <h2>{{ s.section_title }}</h2>
      {% if s.html_table %}
      {{ s.html_table | safe }}
      {% endif %}
    </div>
    {% endfor %}
  </div>
  <div class="footer">&copy; Applivery S.L. — Applivery SOAR</div>
</body>
</html>
`;

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

interface ReportSection {
  title: string;
  chartConfig: Record<string, unknown> | null;
  tableHtml: string | null;
  fullWidth: boolean;
  // Set only for donut/pie charts — a hand-built HTML legend (colored
  // square swatch + label + value) that replaces Chart.js's own default
  // legend entirely, matching the app's own dashboard widget style (see
  // WidgetCard.vue's isDonutPie branch: chart left, legend list right)
  // rather than Chart.js's plain top-of-chart legend row.
  legendItems?: Array<{ name: string; value: number; color: string }>;
  // Set only for actual donut charts (not pie — pie's hollow-less radius
  // has no room for it, same rule WidgetCard.vue's graphic overlay uses):
  // the sum of all slice values, overlaid as centered "N / Total" text in
  // the donut's hole via CSS absolute positioning rather than a Chart.js
  // plugin (simpler, and doesn't depend on plugin-registration API shape
  // matching whatever Chart.js version happens to be vendored).
  donutTotal?: number | null;
}

let chartCanvasCounter = 0;

function buildSections(reportData: Record<string, WidgetResponse | { error: string }>, display: ReportDisplayOptions): { sections: ReportSection[]; canvasConfigs: Array<{ id: string; config: Record<string, unknown> }> } {
  const sections: ReportSection[] = [];
  const canvasConfigs: Array<{ id: string; config: Record<string, unknown> }> = [];

  for (const [sourceName, data] of Object.entries(reportData)) {
    const cleanTitle = titleCase(sourceName.replace(/_/g, " "));
    if ("error" in data) {
      sections.push({ title: cleanTitle, chartConfig: null, tableHtml: `<p style="color:#EF4444;">Error loading data: ${escapeHtml(data.error)}</p>`, fullWidth: false });
      continue;
    }
    const chartData = data.chartData ?? [];
    const trendData = data.trendData;
    let chartConfig: Record<string, unknown> | null = null;
    let html: string | null = null;
    let fullWidth = false;
    let canvasId: string | null = null;

    if ((display.trend ?? true) && trendData?.series?.length) {
      fullWidth = true;
      canvasId = `chart-${chartCanvasCounter++}`;
      const trendType = display.trend_type ?? "line";
      chartConfig = {
        type: trendType === "bar" ? "bar" : "line",
        data: {
          labels: trendData.labels,
          datasets: [{ label: cleanTitle, data: trendData.series, borderColor: "#0E4FF5", backgroundColor: trendType === "bar" ? "rgba(14,79,245,0.85)" : "rgba(14,79,245,0.15)", fill: trendType !== "bar", tension: 0.3, pointRadius: 3 }],
        },
        options: { animation: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } },
      };
    }

    let legendItems: Array<{ name: string; value: number; color: string }> | undefined;
    let donutTotal: number | null | undefined;

    if (!chartConfig && (display.donut ?? true) && chartData.length) {
      const filtered = chartData.slice(0, 8).filter((d) => Number(d.value) > 0);
      if (filtered.length > 1) {
        canvasId = `chart-${chartCanvasCounter++}`;
        const labels = filtered.map((d) => String(d.name).slice(0, 20));
        const values = filtered.map((d) => d.value);
        const colors = labels.map((l, i) => colorFor(l, i));
        const distType = display.donut_type ?? "donut";
        if (distType === "radar") {
          chartConfig = { type: "radar", data: { labels, datasets: [{ label: cleanTitle, data: values, borderColor: "#0E4FF5", backgroundColor: "rgba(14,79,245,0.25)" }] }, options: { animation: false, plugins: { legend: { display: false } } } };
        } else if (distType === "bar") {
          chartConfig = { type: "bar", data: { labels, datasets: [{ label: cleanTitle, data: values, backgroundColor: colors }] }, options: { animation: false, plugins: { legend: { display: false } } } };
        } else {
          // pie/donut: Chart.js's own default legend (a horizontal row of
          // swatches crammed above the chart) is what the report screenshot
          // showed as "a mess on top of the chart" -- plugins.legend.display
          // is now explicitly false on both, and legendItems/donutTotal
          // below drive a hand-built HTML legend + center-total overlay
          // instead, styled to match WidgetCard.vue's own donut/pie widget
          // (chart left, colored-swatch/label/value list right).
          legendItems = labels.map((name, i) => ({ name: titleCase(name), value: Number(values[i]) || 0, color: colors[i] }));
          if (distType === "pie") {
            chartConfig = { type: "pie", data: { labels, datasets: [{ data: values, backgroundColor: colors }] }, options: { animation: false, plugins: { legend: { display: false } } } };
          } else {
            donutTotal = values.reduce((sum, v) => sum + (Number(v) || 0), 0);
            chartConfig = { type: "doughnut", data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] }, options: { animation: false, cutout: "59%", plugins: { legend: { display: false } } } };
          }
        }
      }
    }

    if ((display.table ?? true) && chartData.length) {
      html = tableHtml(chartData, display.table_type);
    }

    if (chartConfig && canvasId) canvasConfigs.push({ id: canvasId, config: chartConfig });
    if (chartConfig || html) {
      sections.push({ title: cleanTitle, chartConfig: chartConfig ? { canvasId } : null, tableHtml: html, fullWidth, legendItems, donutTotal });
    }
  }

  return { sections, canvasConfigs };
}

export interface BuildReportHtmlParams {
  workspaceName: string;
  workspaceSlug: string;
  reportTitle: string;
  generatedDate: string;
  timeLapse: string;
  sourcesCount: number;
  activeFilters: string;
  reportData: Record<string, WidgetResponse | { error: string }>;
  display: ReportDisplayOptions;
  customTemplate?: string | null;
}

/**
 * Builds the full standalone HTML page Puppeteer will print to PDF. A
 * workspace-configured `customTemplate` (WorkspaceState.customReportTemplate)
 * is honored if present, exactly like the original — but since it's a
 * free-form HTML string an admin can save from Settings, we can't safely
 * inject live `<canvas>` elements into arbitrary custom markup; a custom
 * template gets the same `metadata`/`report_sections` values the default
 * template uses, with `section.html_table` (raw HTML) available but
 * chart images omitted (an admin authoring a fully custom template is
 * expected to bring their own visualization, same spirit as the original
 * only ever having Jinja2 variables/loops available to it).
 */
export function buildReportHtml(params: BuildReportHtmlParams): string {
  chartCanvasCounter = 0;
  const { sections, canvasConfigs } = buildSections(params.reportData, params.display);

  const metadata = [
    { label: "Workspace Slug", value: params.workspaceSlug },
    { label: "Sources Analyzed", value: String(params.sourcesCount) },
    { label: "Applied Filters", value: params.activeFilters || "None" },
  ];

  if (params.customTemplate && params.customTemplate.trim()) {
    return renderCustomTemplate(params.customTemplate, {
      Workspace_Name: params.workspaceName,
      Report_Title: params.reportTitle,
      Generated_Date: params.generatedDate,
      Time_Lapse: params.timeLapse,
      metadata,
      report_sections: sections.map((s) => ({ section_title: s.title, image_source: null, html_table: s.tableHtml, is_full_width: s.fullWidth })),
    });
  }

  const metadataHtml = metadata.map((m) => `<div class="meta-item"><span class="meta-label">${escapeHtml(m.label)}</span><span class="meta-value">${escapeHtml(m.value)}</span></div>`).join("");

  const cardsHtml = sections
    .map((s) => {
      let chartHtml = "";
      if (s.chartConfig) {
        const canvasId = (s.chartConfig as any).canvasId;
        const canvasEl = `<canvas id="${canvasId}"></canvas>`;
        if (s.legendItems?.length) {
          // Widget-style layout (WidgetCard.vue's isDonutPie branch): the
          // chart sits in a fixed, roughly-square box on the left with the
          // hand-built legend list filling the rest of the row on the
          // right, instead of Chart.js's own default legend squeezed above
          // a full-width chart.
          const centerHtml = s.donutTotal != null ? `<div class="donut-center"><div class="donut-center-value">${s.donutTotal.toLocaleString()}</div><div class="donut-center-label">Total</div></div>` : "";
          const legendHtml = s.legendItems
            .map(
              (li) =>
                `<div class="legend-row"><span class="legend-left"><span class="legend-swatch" style="background:${li.color}"></span><span class="legend-label">${escapeHtml(li.name)}</span></span><span class="legend-value">${li.value.toLocaleString()}</span></div>`,
            )
            .join("");
          chartHtml = `<div class="donut-row"><div class="donut-chart-wrap">${canvasEl}${centerHtml}</div><div class="chart-legend">${legendHtml}</div></div>`;
        } else {
          chartHtml = `<div class="chart-container">${canvasEl}</div>`;
        }
      }
      return `<div class="card${s.fullWidth ? " card-full" : ""}"><h2>${escapeHtml(s.title)}</h2>${chartHtml}${s.tableHtml ? `<div class="table-container">${s.tableHtml}</div>` : ""}</div>`;
    })
    .join("");

  const chartsScript = `<script>${CHART_JS_SOURCE}</script>
<script>
  window.addEventListener('load', function () {
    // Outfit everywhere, including whatever text Chart.js itself draws onto
    // the canvas (trend-chart axis ticks, tooltips) -- CSS @font-face alone
    // only covers real DOM text, not canvas-rendered glyphs.
    if (window.Chart && Chart.defaults && Chart.defaults.font) {
      Chart.defaults.font.family = "'Outfit', system-ui, sans-serif";
    }
    var configs = ${JSON.stringify(canvasConfigs)};
    configs.forEach(function (c) {
      var el = document.getElementById(c.id);
      if (el) new Chart(el.getContext('2d'), c.config);
    });
    document.body.setAttribute('data-charts-ready', 'true');
  });
</script>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Outfit'; font-style: normal; font-weight: 400; font-display: swap; src: url(data:font/woff2;base64,${OUTFIT_400_B64}) format('woff2'); }
  @font-face { font-family: 'Outfit'; font-style: normal; font-weight: 600; font-display: swap; src: url(data:font/woff2;base64,${OUTFIT_600_B64}) format('woff2'); }
  @font-face { font-family: 'Outfit'; font-style: normal; font-weight: 700; font-display: swap; src: url(data:font/woff2;base64,${OUTFIT_700_B64}) format('woff2'); }
  body { font-family: 'Outfit', 'Helvetica Neue', Arial, sans-serif; background:#F4F7FB; margin:0; padding:0; color:#263238; }
  .top-bar { background:#0E4FF5; padding:24px 40px; display:flex; align-items:center; justify-content:space-between; }
  .top-bar .tool-logo { line-height:0; }
  .top-bar .tool-logo svg { height:22px; width:auto; display:block; }
  .top-bar .header-badge { color:#fff; background:rgba(255,255,255,0.15); padding:8px 16px; border-radius:20px; font-size:13px; font-weight:600; text-transform:uppercase; }
  .report-container { padding:40px; box-sizing:border-box; }
  .report-title { color:#0E4FF5; font-size:32px; font-weight:700; margin:0 0 10px 0; }
  .report-date { color:#64748B; font-size:15px; font-weight:500; }
  .metadata-bar { background:#fff; border-radius:10px; padding:24px 30px; display:flex; flex-wrap:wrap; gap:40px; border:1px solid #EAECEF; margin:24px 0 40px 0; }
  .meta-item { display:flex; flex-direction:column; }
  .meta-label { font-size:12px; text-transform:uppercase; color:#94A3B8; font-weight:600; margin-bottom:6px; }
  .meta-value { font-size:16px; color:#263238; font-weight:600; }
  .card { background:#fff; border-radius:10px; padding:32px; border:1px solid #EAECEF; margin-bottom:32px; break-inside:avoid; page-break-inside:avoid; }
  .card h2 { margin-top:0; font-size:18px; color:#0E4FF5; border-bottom:2px solid #F4F7FB; padding-bottom:16px; margin-bottom:24px; text-transform:uppercase; letter-spacing:0.5px; }
  .chart-container { width:100%; height:280px; margin-bottom:24px; }
  /* Donut/pie layout — 1:1 port of the app's own WidgetCard.vue
     isDonutPie branch: a roughly-square chart on the left, a hand-built
     colored-swatch/label/value legend filling the rest of the row on the
     right, replacing Chart.js's own default legend entirely. */
  .donut-row { display:flex; align-items:center; gap:28px; margin-bottom:8px; }
  .donut-chart-wrap { position:relative; flex:0 0 220px; width:220px; height:220px; }
  .donut-chart-wrap canvas { width:100% !important; height:100% !important; }
  .donut-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none; }
  .donut-center-value { font-size:28px; font-weight:700; color:#263238; line-height:1; }
  .donut-center-label { font-size:11px; font-weight:400; color:#64748B; margin-top:6px; }
  .chart-legend { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:6px; }
  .legend-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:5px 8px; border-radius:8px; }
  .legend-left { display:flex; align-items:center; gap:8px; min-width:0; }
  .legend-swatch { width:11px; height:11px; border-radius:3px; flex-shrink:0; }
  .legend-label { font-size:13px; font-weight:400; color:#64748B; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .legend-value { font-size:13px; font-weight:600; color:#263238; flex-shrink:0; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th { text-align:left; padding:14px; background:#F8FAFC; border-bottom:2px solid #CBD5E1; color:#334155; font-weight:700; text-transform:uppercase; font-size:12px; }
  td { padding:14px; border-bottom:1px solid #F1F5F9; color:#334155; font-weight:500; }
  tbody tr:nth-child(even) { background:#F8FAFC; }
  tr { break-inside:avoid; page-break-inside:avoid; }
  .footer { background:#0E4FF5; color:#fff; padding:16px 40px; font-size:12px; }
</style>
</head>
<body>
  <div class="top-bar"><div class="tool-logo">${APPLIVERY_LOGO_SVG}</div><div class="header-badge">${escapeHtml(params.workspaceName)} — Automated Report</div></div>
  <div class="report-container">
    <h1 class="report-title">${escapeHtml(params.reportTitle)}</h1>
    <div class="report-date">Generated on: ${escapeHtml(params.generatedDate)} | Time Lapse: ${escapeHtml(params.timeLapse)}</div>
    <div class="metadata-bar">${metadataHtml}</div>
    ${cardsHtml}
  </div>
  <div class="footer">&copy; Applivery S.L. — Applivery SOAR</div>
  ${chartsScript}
</body>
</html>`;
}
