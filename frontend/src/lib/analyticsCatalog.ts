// Port of App.jsx's `CATALOG` / `ALL_CHART_TYPES` / `SIZES` (wow-dashboard/src/App.jsx:1617-1727).

export interface CatalogItem {
  id: string;
  label: string;
  group: string;
}

export const WIDGET_CATALOG: CatalogItem[] = [
  { id: "mdm_devices", label: "Device list", group: "UEM · Devices" },
  { id: "stats_devices_os", label: "Devices by OS", group: "UEM · Devices" },
  { id: "stats_devices_status", label: "Devices by state", group: "UEM · Devices" },
  { id: "stats_compliance", label: "Compliance status", group: "UEM · Devices" },
  { id: "stats_battery", label: "Battery levels", group: "UEM · Devices" },
  { id: "stats_models", label: "Device models", group: "UEM · Devices" },
  { id: "stats_os_updates_all", label: "OS available updates", group: "UEM · Devices" },
  { id: "stats_os_versions", label: "OS version distribution", group: "UEM · Devices" },
  { id: "stats_sync_errors", label: "Sync failures", group: "UEM · Devices" },
  { id: "stats_devices_trend", label: "Devices enrollment trend", group: "UEM · Devices" },

  { id: "mdm_users", label: "Device employees (UEM)", group: "UEM · Users & Segments" },
  { id: "mdm_collaborators", label: "UEM collaborators", group: "UEM · Users & Segments" },
  { id: "mdm_segments", label: "Segments", group: "UEM · Users & Segments" },

  { id: "app_dist_apps", label: "Enterprise apps & builds", group: "App Distribution · Apps" },
  { id: "stats_builds_os", label: "Builds by OS", group: "App Distribution · Apps" },
  { id: "stats_downloads_trend", label: "Downloads trend", group: "App Distribution · Apps" },
  { id: "stats_builds_trend", label: "Builds trend", group: "App Distribution · Apps" },

  { id: "app_dist_store_users", label: "Store users (employees)", group: "App Distribution · Users" },
  { id: "app_dist_collaborators", label: "Store collaborators", group: "App Distribution · Users" },
  { id: "stats_collaborators", label: "Collaborator roles", group: "App Distribution · Users" },

  { id: "org_profile", label: "Organisation profile", group: "System" },

  { id: "compliance_policies_summary", label: "Compliance Policies", group: "Compliance (SOAR)" },
  { id: "compliance_devices_violating", label: "Devices in violation", group: "Compliance (SOAR)" },
  { id: "compliance_violations_by_policy", label: "Violations by policy", group: "Compliance (SOAR)" },
  { id: "compliance_violations_trend", label: "Violations trend", group: "Compliance (SOAR)" },
  { id: "compliance_review_queue", label: "Review queue status", group: "Compliance (SOAR)" },
  { id: "autorun_safety_summary", label: "autoRun safety interventions", group: "Compliance (SOAR)" },

  { id: "compliance_framework_coverage", label: "Framework coverage (ISO27001/ENS/NIS2)", group: "Compliance Frameworks (SOAR)" },
  { id: "iso27001_compliance_status", label: "ISO 27001 compliance status", group: "Compliance Frameworks (SOAR)" },
  { id: "ens_compliance_status", label: "ENS compliance status (mp.eq)", group: "Compliance Frameworks (SOAR)" },
  { id: "nis2_compliance_status", label: "NIS2 compliance status (Art. 21)", group: "Compliance Frameworks (SOAR)" },

  { id: "cases_summary", label: "Cases by status", group: "Cases (SOAR)" },
  { id: "cases_by_severity", label: "Open cases by severity", group: "Cases (SOAR)" },
  { id: "cases_by_source", label: "Cases by source", group: "Cases (SOAR)" },
  { id: "cases_trend", label: "Cases opened trend", group: "Cases (SOAR)" },
  { id: "cases_sla_summary", label: "Case SLA status", group: "Cases (SOAR)" },
  { id: "cases_mttr_trend", label: "Case MTTR trend", group: "Cases (SOAR)" },
  { id: "threat_intel_summary", label: "Threat intel verdicts", group: "Cases (SOAR)" },
  { id: "ticketing_summary", label: "Ticketing sync status", group: "Cases (SOAR)" },
  { id: "mitre_coverage", label: "MITRE ATT&CK coverage", group: "Cases (SOAR)" },

  { id: "workflow_runs_summary", label: "Workflow runs by outcome", group: "Workflows & Risk (SOAR)" },
  { id: "workflow_runs_trend", label: "Workflow runs trend", group: "Workflows & Risk (SOAR)" },
  { id: "device_risk_distribution", label: "Device risk distribution", group: "Workflows & Risk (SOAR)" },
  { id: "device_risk_trend", label: "Device risk trend", group: "Workflows & Risk (SOAR)" },

  { id: "system_health_summary", label: "System health", group: "Operations (SOAR)" },

  { id: "os_updates_catalog_summary", label: "OS update catalog", group: "OS Updates (SOAR)" },
  { id: "os_updates_device_status_summary", label: "OS update device status", group: "OS Updates (SOAR)" },

  { id: "vuln_catalog_summary", label: "Apple/Android vulnerability catalog", group: "Vulnerability Intel (SOAR)" },
  { id: "vuln_device_status_summary", label: "Apple/Android vulnerability device status", group: "Vulnerability Intel (SOAR)" },
  { id: "vuln_service_device_status_summary", label: "Vulnerability Service device status", group: "Vulnerability Intel (SOAR)" },

  { id: "os_lifecycle_summary", label: "OS lifecycle catalog", group: "OS Lifecycle (SOAR)" },
  { id: "os_lifecycle_device_status_summary", label: "OS lifecycle device status", group: "OS Lifecycle (SOAR)" },

  { id: "apple_app_updates_summary", label: "Apple app updates", group: "App Updates (SOAR)" },

  { id: "triggers_summary", label: "Inbound trigger fires", group: "3rd-Party Events (SOAR)" },
  { id: "triggers_fired_trend", label: "Inbound trigger fires trend", group: "3rd-Party Events (SOAR)" },

  { id: "applivery_events_by_type", label: "Events by type", group: "Applivery Events (SOAR)" },
  { id: "applivery_events_trend", label: "Events received trend", group: "Applivery Events (SOAR)" },
  { id: "applivery_automation_outcomes", label: "Automation outcomes", group: "Applivery Events (SOAR)" },
];

export const WIDGET_LABEL_BY_ID: Record<string, string> = Object.fromEntries(WIDGET_CATALOG.map((w) => [w.id, w.label]));

export type ChartType = "scorecard" | "gauge" | "donut" | "pie" | "bar" | "line" | "radar" | "list" | "progress";

export const CHART_TYPES: Array<{ id: ChartType; label: string; desc: string }> = [
  { id: "scorecard", label: "Scorecard", desc: "Total count" },
  { id: "gauge", label: "Gauge", desc: "Count vs total arc" },
  { id: "donut", label: "Donut", desc: "Grouped by category" },
  { id: "pie", label: "Pie", desc: "Proportions filled" },
  { id: "bar", label: "Bar", desc: "Compare categories" },
  { id: "line", label: "Line", desc: "Time-series" },
  { id: "radar", label: "Radar", desc: "Multi-axis" },
  { id: "list", label: "List", desc: "Breakdown rows" },
  { id: "progress", label: "Bars", desc: "Horizontal fill bars" },
];

// 1:1 port of SHAPES / SOURCE_SHAPES (App.jsx:1544-1616) — restricts which
// chart types are offered for a given data source in the widget builder, and
// drives the "prefer 1x1" default chart-type selection.
type Shape = "analyticsKeyed" | "analyticsTrend" | "analyticsDiscrete" | "analyticsManyKeys" | "listGrouped" | "listApps" | "listUsers" | "listCountOnly" | "orgProfile";

export const SHAPES: Record<Shape, ChartType[]> = {
  analyticsKeyed: ["scorecard", "donut", "pie", "bar", "radar", "list", "progress", "gauge"],
  analyticsTrend: ["line"],
  analyticsDiscrete: ["scorecard", "donut", "pie", "bar", "list", "progress", "gauge"],
  analyticsManyKeys: ["scorecard", "bar", "list", "progress"],
  listGrouped: ["scorecard", "gauge", "donut", "list", "progress"],
  listApps: ["scorecard", "donut", "list", "progress"],
  listUsers: ["scorecard", "donut", "list", "progress"],
  listCountOnly: ["scorecard"],
  orgProfile: ["scorecard"],
};

export const SOURCE_SHAPES: Record<string, Shape> = {
  stats_devices_os: "analyticsKeyed",
  stats_devices_status: "analyticsKeyed",
  stats_builds_os: "analyticsKeyed",
  stats_collaborators: "analyticsKeyed",
  stats_downloads_trend: "analyticsTrend",
  stats_builds_trend: "analyticsTrend",
  stats_devices_trend: "analyticsTrend",
  stats_compliance: "analyticsDiscrete",
  stats_battery: "analyticsDiscrete",
  stats_models: "analyticsManyKeys",
  stats_os_updates_all: "analyticsManyKeys",
  stats_os_versions: "analyticsManyKeys",
  stats_sync_errors: "listGrouped",
  mdm_devices: "listGrouped",
  mdm_users: "listGrouped",
  mdm_collaborators: "listGrouped",
  app_dist_collaborators: "listGrouped",
  app_dist_store_users: "listUsers",
  app_dist_apps: "listApps",
  org_profile: "orgProfile",
  mdm_segments: "listGrouped",
  compliance_policies_summary: "analyticsDiscrete",
  compliance_devices_violating: "analyticsDiscrete",
  compliance_violations_by_policy: "analyticsKeyed",
  compliance_violations_trend: "analyticsTrend",
  compliance_review_queue: "analyticsDiscrete",
  autorun_safety_summary: "analyticsDiscrete",
  compliance_framework_coverage: "analyticsKeyed",
  iso27001_compliance_status: "analyticsKeyed",
  ens_compliance_status: "analyticsKeyed",
  nis2_compliance_status: "analyticsKeyed",
  cases_summary: "analyticsDiscrete",
  cases_by_severity: "analyticsKeyed",
  cases_by_source: "analyticsKeyed",
  cases_trend: "analyticsTrend",
  cases_sla_summary: "analyticsKeyed",
  cases_mttr_trend: "analyticsTrend",
  applivery_events_by_type: "analyticsKeyed",
  applivery_events_trend: "analyticsTrend",
  applivery_automation_outcomes: "analyticsKeyed",
  system_health_summary: "analyticsKeyed",
  os_updates_catalog_summary: "analyticsKeyed",
  os_updates_device_status_summary: "analyticsKeyed",
  vuln_catalog_summary: "analyticsKeyed",
  vuln_device_status_summary: "analyticsKeyed",
  vuln_service_device_status_summary: "analyticsKeyed",
  os_lifecycle_summary: "analyticsKeyed",
  os_lifecycle_device_status_summary: "analyticsKeyed",
  apple_app_updates_summary: "analyticsKeyed",
  triggers_summary: "analyticsKeyed",
  triggers_fired_trend: "analyticsTrend",
  workflow_runs_summary: "analyticsDiscrete",
  workflow_runs_trend: "analyticsTrend",
  device_risk_distribution: "analyticsKeyed",
  device_risk_trend: "analyticsTrend",
  mitre_coverage: "analyticsDiscrete",
  threat_intel_summary: "analyticsKeyed",
  ticketing_summary: "analyticsDiscrete",
};

export function chartTypesFor(stat: string): ChartType[] {
  const shape = SOURCE_SHAPES[stat] ?? "listCountOnly";
  return SHAPES[shape] ?? ["scorecard"];
}

// 1:1 port of selectSource's default-chart heuristic (App.jsx:3666-3676):
// prefer 'list' for grouped/app/user sources, otherwise the shape's first
// chart type — but keep the widget's current type if it's still valid for
// the newly picked source.
export function defaultChartTypeForSource(stat: string, currentType?: ChartType): ChartType {
  const shape = SOURCE_SHAPES[stat] ?? "listCountOnly";
  const available = SHAPES[shape] ?? ["scorecard"];
  if (currentType && available.includes(currentType)) return currentType;
  const preferList = available.includes("list") && shape !== "analyticsKeyed" && shape !== "analyticsDiscrete";
  return preferList ? "list" : available[0];
}

// 1:1 port of App.jsx's `isTrend` check (~4602): `['stats_downloads_trend',
// 'stats_builds_trend', 'stats_devices_trend', 'compliance_violations_trend']
// .includes(w.stat)`. These are the only stats whose widget renders as a
// line/trend chart with a "last 30 days" header label and an OS-totals
// (iOS/Android/Windows) row in both the header badges and (for line-type
// widgets specifically) the card content footer.
export const TREND_STATS: string[] = ["stats_downloads_trend", "stats_builds_trend", "stats_devices_trend", "compliance_violations_trend"];

// 1:1 port of the per-source icon/color badge map used by WidgetHeader
// (App.jsx:4610-4669). Icon names reference @solar-icons/vue exports (the
// migrated stack's icon set — original used lucide-react, which isn't
// available here, so each entry below is the closest semantic equivalent).
export interface WidgetIconDef {
  icon: string;
  color: string;
  bg: string;
}
const PRIMARY_BLUE = "#0241E3";
const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";

export const WIDGET_ICON_MAP: Record<string, WidgetIconDef> = {
  stats_devices_os: { icon: "Smartphone", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  stats_devices_status: { icon: "Pulse", color: SUCCESS, bg: `${SUCCESS}15` },
  stats_builds_os: { icon: "Smartphone", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  stats_collaborators: { icon: "UsersGroupRounded", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  stats_downloads_trend: { icon: "GraphUp", color: "#8B5CF6", bg: "#8B5CF615" },
  stats_builds_trend: { icon: "GraphUp", color: "#06B6D4", bg: "#06B6D415" },
  stats_devices_trend: { icon: "GraphUp", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  stats_compliance: { icon: "ShieldWarning", color: SUCCESS, bg: `${SUCCESS}15` },
  stats_battery: { icon: "BatteryCharge", color: WARNING, bg: `${WARNING}15` },
  // color/bg here are the light-theme fallback only — App.jsx's iconMap
  // (~4610) uses `activeTheme.textMuted` for this one entry (every other
  // entry is a fixed brand/semantic hex), so OverviewView.vue's iconFor()
  // overrides these two fields with the live theme's textMuted at render
  // time. Kept here as the static default for any other/future consumer.
  stats_models: { icon: "Smartphone", color: "#6B7280", bg: "#6B728015" },
  stats_os_updates_all: { icon: "Refresh", color: WARNING, bg: `${WARNING}15` },
  stats_os_versions: { icon: "Widget2", color: "#06B6D4", bg: "#06B6D415" },
  stats_sync_errors: { icon: "DangerTriangle", color: DANGER, bg: `${DANGER}15` },
  mdm_devices: { icon: "Smartphone", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  mdm_users: { icon: "UsersGroupRounded", color: "#8B5CF6", bg: "#8B5CF615" },
  mdm_collaborators: { icon: "Case", color: "#06B6D4", bg: "#06B6D415" },
  app_dist_store_users: { icon: "UsersGroupRounded", color: SUCCESS, bg: `${SUCCESS}15` },
  app_dist_apps: { icon: "Box", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  app_dist_collaborators: { icon: "Case", color: "#F59E0B", bg: "#F59E0B15" },
  org_profile: { icon: "Buildings2", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  mdm_segments: { icon: "Layers", color: "#8B5CF6", bg: "#8B5CF615" },
  compliance_policies_summary: { icon: "ShieldCheck", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  compliance_devices_violating: { icon: "ShieldWarning", color: DANGER, bg: `${DANGER}15` },
  compliance_violations_by_policy: { icon: "Chart2", color: WARNING, bg: `${WARNING}15` },
  compliance_violations_trend: { icon: "GraphUp", color: DANGER, bg: `${DANGER}15` },
  compliance_review_queue: { icon: "Checklist", color: "#8B5CF6", bg: "#8B5CF615" },
  autorun_safety_summary: { icon: "ShieldCheck", color: WARNING, bg: `${WARNING}15` },
  compliance_framework_coverage: { icon: "ShieldCheck", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  iso27001_compliance_status: { icon: "History", color: "#14B8A6", bg: "#14B8A615" },
  ens_compliance_status: { icon: "Flag", color: "#DC2626", bg: "#DC262615" },
  nis2_compliance_status: { icon: "Global", color: "#3B82F6", bg: "#3B82F615" },
  cases_summary: { icon: "Folder", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  cases_by_severity: { icon: "DangerTriangle", color: DANGER, bg: `${DANGER}15` },
  cases_by_source: { icon: "Chart2", color: "#8B5CF6", bg: "#8B5CF615" },
  cases_trend: { icon: "GraphUp", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  cases_sla_summary: { icon: "ClockCircle", color: WARNING, bg: `${WARNING}15` },
  cases_mttr_trend: { icon: "GraphUp", color: "#8B5CF6", bg: "#8B5CF615" },
  applivery_events_by_type: { icon: "Satellite", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  applivery_events_trend: { icon: "GraphUp", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  applivery_automation_outcomes: { icon: "Checklist", color: "#8B5CF6", bg: "#8B5CF615" },
  system_health_summary: { icon: "Pulse", color: SUCCESS, bg: `${SUCCESS}15` },
  os_updates_catalog_summary: { icon: "Cpu", color: "#0078D4", bg: "#0078D415" },
  os_updates_device_status_summary: { icon: "ShieldWarning", color: "#0078D4", bg: "#0078D415" },
  vuln_catalog_summary: { icon: "Bug", color: "#8B5CF6", bg: "#8B5CF615" },
  vuln_device_status_summary: { icon: "ShieldWarning", color: "#8B5CF6", bg: "#8B5CF615" },
  vuln_service_device_status_summary: { icon: "ShieldWarning", color: "#DC2626", bg: "#DC262615" },
  os_lifecycle_summary: { icon: "Hourglass", color: "#EC4899", bg: "#EC489915" },
  os_lifecycle_device_status_summary: { icon: "Hourglass", color: "#EC4899", bg: "#EC489915" },
  apple_app_updates_summary: { icon: "Box", color: "#22C55E", bg: "#22C55E15" },
  triggers_summary: { icon: "PlugCircle", color: "#F97316", bg: "#F9731615" },
  triggers_fired_trend: { icon: "GraphUp", color: "#F97316", bg: "#F9731615" },
  workflow_runs_summary: { icon: "Routing", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  workflow_runs_trend: { icon: "GraphUp", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
  device_risk_distribution: { icon: "ShieldWarning", color: DANGER, bg: `${DANGER}15` },
  device_risk_trend: { icon: "GraphUp", color: DANGER, bg: `${DANGER}15` },
  mitre_coverage: { icon: "Target", color: "#8B5CF6", bg: "#8B5CF615" },
  threat_intel_summary: { icon: "Radar", color: "#8B5CF6", bg: "#8B5CF615" },
  ticketing_summary: { icon: "ChatRound", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` },
};
export const DEFAULT_WIDGET_ICON: WidgetIconDef = { icon: "Chart2", color: PRIMARY_BLUE, bg: `${PRIMARY_BLUE}15` };

// Filter field defs per source — 1:1 port of the Builder panel's Filters
// section (App.jsx:5681-5726). Rendered dynamically by WidgetBuilderPanel.
export const FILTER_SOURCES_WITH_OS = new Set(["mdm_devices", "app_dist_apps"]);
export const FILTER_SOURCES_WITH_COMPLIANCE = new Set(["mdm_devices"]);
export const FILTER_SOURCES_WITH_ROLE = new Set(["app_dist_collaborators"]);
export const FILTER_SOURCES_WITH_AUTH_ORIGIN = new Set(["app_dist_collaborators", "mdm_collaborators", "app_dist_store_users"]);
export function hasAnyFilters(stat: string): boolean {
  return FILTER_SOURCES_WITH_OS.has(stat) || FILTER_SOURCES_WITH_COMPLIANCE.has(stat) || FILTER_SOURCES_WITH_ROLE.has(stat) || FILTER_SOURCES_WITH_AUTH_ORIGIN.has(stat);
}

export interface WidgetSizeDef {
  id: "small" | "half" | "full";
  label: string;
  desc: string;
  w: number;
  h: number;
}

// 1:1 port of SIZES (App.jsx:1722-1726).
export const WIDGET_SIZES: WidgetSizeDef[] = [
  { id: "small", label: "Small", desc: "1×1", w: 3, h: 2 },
  { id: "half", label: "Wide", desc: "2×1", w: 6, h: 3 },
  { id: "full", label: "Large", desc: "4×1", w: 12, h: 3 },
];

export interface DashboardWidget {
  id: string;
  title: string;
  stat: string;
  type: ChartType;
  size: "small" | "half" | "full";
  filters: Record<string, any>;
}

export interface GridLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  static?: boolean;
}

export interface DashboardState {
  widgets: DashboardWidget[];
  layout: GridLayoutItem[];
}

// 1:1 port of App.jsx's DEFAULT_DASHBOARD (~line 1728) — the starter layout
// seeded for a brand-new workspace. w3 had drifted to a bar/cases_summary
// widget during migration; the original ships a line/stats_downloads_trend
// widget here, and the migrated backend's widgets.service.ts (~line 852)
// already fully supports that stat, so there was no reason for the
// substitution.
export const DEFAULT_DASHBOARD: DashboardState = {
  widgets: [
    { id: "w0", title: "Workspace Profile", stat: "org_profile", type: "scorecard", size: "small", filters: {} },
    { id: "w1", title: "Devices by OS", stat: "stats_devices_os", type: "donut", size: "small", filters: {} },
    { id: "w2", title: "Compliance Status", stat: "stats_compliance", type: "donut", size: "small", filters: {} },
    { id: "w3", title: "Download Trends", stat: "stats_downloads_trend", type: "line", size: "half", filters: {} },
  ],
  layout: [
    { i: "w0", x: 0, y: 0, w: 4, h: 3 },
    { i: "w1", x: 4, y: 0, w: 4, h: 3 },
    { i: "w2", x: 8, y: 0, w: 4, h: 3 },
    { i: "w3", x: 0, y: 3, w: 6, h: 3 },
  ],
};

/** Best default chart type for a given widget source, mirroring the intent behind the original's hand-picked DEFAULT_DASHBOARD entries. */
export function defaultChartTypeFor(source: string): ChartType {
  if (source.includes("trend")) return "line";
  if (source === "mdm_devices" || source === "app_dist_apps" || source === "compliance_devices_violating" || source === "vuln_device_status_summary" || source === "os_updates_device_status_summary" || source === "os_lifecycle_device_status_summary" || source === "vuln_service_device_status_summary") return "list";
  return "donut";
}
