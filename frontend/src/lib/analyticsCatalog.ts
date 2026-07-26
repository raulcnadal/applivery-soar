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

export const CHART_TYPES: Array<{ id: ChartType; label: string }> = [
  { id: "scorecard", label: "Scorecard" },
  { id: "gauge", label: "Gauge" },
  { id: "donut", label: "Donut" },
  { id: "pie", label: "Pie" },
  { id: "bar", label: "Bar" },
  { id: "line", label: "Line" },
  { id: "radar", label: "Radar" },
  { id: "list", label: "List" },
  { id: "progress", label: "Bars" },
];

export interface WidgetSizeDef {
  id: "small" | "half" | "full";
  label: string;
  w: number;
  h: number;
}

export const WIDGET_SIZES: WidgetSizeDef[] = [
  { id: "small", label: "Small (3×2)", w: 3, h: 2 },
  { id: "half", label: "Wide (6×3)", w: 6, h: 3 },
  { id: "full", label: "Large (12×3)", w: 12, h: 3 },
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

export const DEFAULT_DASHBOARD: DashboardState = {
  widgets: [
    { id: "w0", title: "Workspace Profile", stat: "org_profile", type: "scorecard", size: "small", filters: {} },
    { id: "w1", title: "Devices by OS", stat: "stats_devices_os", type: "donut", size: "small", filters: {} },
    { id: "w2", title: "Compliance Status", stat: "stats_compliance", type: "donut", size: "small", filters: {} },
    { id: "w3", title: "Cases by Status", stat: "cases_summary", type: "bar", size: "half", filters: {} },
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
