/**
 * Port of `SYSTEM_HEALTH_JOBS` (main.py:17642-17660) — label + expected tick
 * interval for every job that calls recordJobHeartbeat, used to flag a job
 * "overdue" even when it's never logged an error (the silent-death case
 * this feature exists to catch). Jobs this migration hasn't reached yet
 * (compliance_scheduler, installed_apps_refresher — see
 * jobs/backgroundJobs.ts's module comment; snapshot_scheduler/
 * report_scheduler — Phase 7) are still listed here so System Health
 * accurately shows them as "never run" rather than silently omitting rows
 * the original always displayed.
 */
export interface SystemHealthJobMeta {
  key: string;
  label: string;
  intervalSeconds: number;
}

export const SYSTEM_HEALTH_JOBS: SystemHealthJobMeta[] = [
  { key: "compliance_scheduler", label: "Compliance Policy scheduler", intervalSeconds: 60 },
  { key: "installed_apps_refresher", label: "Installed apps refresher", intervalSeconds: 30 },
  { key: "workflow_wait_resumer", label: "Workflow wait-step resumer", intervalSeconds: 30 },
  { key: "script_log_reconciler", label: "Script run reconciler", intervalSeconds: 90 },
  { key: "ticket_status_sync", label: "Ticketing inbound sync", intervalSeconds: 900 },
  { key: "case_sla_monitor", label: "Case SLA breach monitor", intervalSeconds: 300 },
  { key: "catalog:os-update", label: "OS update catalog refresh (MSRC)", intervalSeconds: 86400 },
  { key: "catalog:vuln", label: "Vulnerability catalog refresh (EUVD)", intervalSeconds: 86400 },
  { key: "vuln_service_refresh", label: "Vulnerability Service refresh", intervalSeconds: 3600 },
  { key: "misp_refresh", label: "MISP threat intel refresh", intervalSeconds: 3600 },
  { key: "vulncheck_refresh", label: "VulnCheck threat intel refresh", intervalSeconds: 3600 },
  { key: "catalog:os-lifecycle", label: "OS lifecycle refresh (endoflife.date)", intervalSeconds: 604800 },
  { key: "catalog:gdmf", label: "Apple Software Lookup Service refresh (GDMF)", intervalSeconds: 86400 },
  { key: "catalog:mitre", label: "MITRE ATT&CK catalog refresh", intervalSeconds: 86400 },
  { key: "audit_log_rotation", label: "Audit log rotation", intervalSeconds: 86400 },
  { key: "log_export_scheduler", label: "Log export scheduler", intervalSeconds: 86400 },
  { key: "snapshot_scheduler", label: "Analytics snapshot capture", intervalSeconds: 86400 },
  { key: "report_scheduler", label: "Scheduled report delivery", intervalSeconds: 60 },
  { key: "system_health_monitor", label: "System health alert monitor", intervalSeconds: 300 },
];
