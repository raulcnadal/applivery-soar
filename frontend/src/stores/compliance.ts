import { defineStore } from "pinia";
import { ref } from "vue";

export interface ConditionRule {
  field: string;
  operator: string;
  value: any;
}

export interface CompliancePolicy {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  autoRun: boolean;
  severity: "low" | "medium" | "high" | "critical";
  conditionLogic: "any" | "all";
  conditions: ConditionRule[];
  // See backend/prisma/schema.prisma's CompliancePolicy.targetPlatform doc
  // comment -- same fields/semantics as Workflow's targetPlatform/
  // targetDeploymentModel, nullable/optional for backward compatibility
  // with policies created before this existed ("Common — all platforms").
  targetPlatform?: string | null;
  targetDeploymentModel?: string | null;
  workflowId?: string | null;
  nonComplianceTag?: string | null;
  nonComplianceSmartAttributeId?: string | null;
  openCaseOnViolation: boolean;
  autoResolveCaseOnRecovery: boolean;
  caseAssignee: string | null;
  mitreTechniques: string[];
  framework?: string | null;
  controlRef?: string | null;
  targetDeviceAudienceId?: string | null;
  segmentId?: string | null;
  evaluationIntervalMinutes?: number | null;
  autoRunBatchCap?: number | null;
  autoRunDestructiveAck: boolean;
  escalatedWorkflowId?: string | null;
  escalatedWorkflowMinRiskTier: string;
  // Violation alerting — see backend/prisma/schema.prisma's
  // CompliancePolicy.alertOnViolation doc comment. A rolled-up (not
  // per-device) webhook/email alert per evaluation pass, independent of
  // autoRun/workflow.
  alertOnViolation: boolean;
  alertViaWebhook: boolean;
  alertViaEmail: boolean;
  alertWebhookUrl?: string | null;
  alertEmailRecipients?: string | null;
  // Optional per-channel daily send caps — see backend/prisma/schema.prisma's
  // CompliancePolicy.alertWebhookMaxPerDay doc comment. Null/unset = unlimited.
  alertWebhookMaxPerDay?: number | null;
  alertEmailMaxPerDay?: number | null;
  lastAlertSentAt?: string | null;
  lastAlertError?: string | null;
  lastEvaluatedAt?: string | null;
  autoRunTripped: boolean;
  autoRunTrippedReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceViolation {
  id: string;
  policyId: string;
  policyName?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
  workflowRunId?: string | null;
  escalated: boolean;
  deviceId: string;
  deviceName?: string | null;
  platform?: string | null;
  platformDeviceId?: string | null;
  matchedConditions?: ConditionRule[];
  caseId?: string | null;
  status: string;
  severity: string;
  detectedAt: string;
  resolvedAt?: string | null;
}

export interface ComplianceFieldDef {
  key: string;
  label: string;
  type: string;
  operators: string[];
  options?: string[];
  // Which policy targetPlatform(s) this field applies to — omitted means
  // universal. See backend's complianceFields.ts for the full rationale.
  platforms?: string[];
}

export interface SmartAttributeDef {
  id: string;
  name: string;
}

/**
 * Mirrors backend's SelfReportedAttributeCatalogEntry (complianceFields.ts)
 * — presentation metadata (friendly label, value type, enum options, which
 * platforms it applies to) for a known selfReportedAttribute name, so
 * ConditionRow.vue can render a proper Yes/No or enum <select> instead of a
 * generic free-text "Expected value…" input. Purely a UI/value-editor
 * concern — the underlying condition JSON shape never changes.
 */
export interface SelfReportedAttributeCatalogEntry {
  name: string;
  label: string;
  valueType: "boolean" | "enum" | "string";
  options?: string[];
  platforms?: string[];
  description?: string;
}

// Disclosed new feature — see backend's customChecks.service.ts module doc.
export const CHECKER_TYPES = ["processRunning", "serviceStatus", "registryOrFileValue", "appInstalled", "command"] as const;
export type CheckerType = (typeof CHECKER_TYPES)[number];

// iOS/Android are sandboxed — only "appInstalled" is a meaningful checker
// type there (no process/service/registry-or-file/command surface exists
// for a third-party app to check). See backend's customChecks.schemas.ts
// MOBILE_CHECK_PLATFORMS/validateCheckParams, which is where this is
// actually enforced; CustomDeviceChecksPanel.vue filters CHECKER_TYPES down
// to match so an admin never sees an option the API would reject.
export const MOBILE_CHECK_PLATFORMS = ["ios", "android"] as const;

export interface CustomCheckDefinition {
  id: string;
  workspaceSlug: string;
  platform: "windows" | "macos" | "ios" | "android";
  key: string;
  name: string;
  description?: string | null;
  checkerType: CheckerType;
  params: Record<string, any>;
  enabled: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedBy?: string | null;
  updatedAt: string;
}

// Disclosed new feature — event-driven detection watches. See backend's
// eventWatches.service.ts module doc and
// backend/docs/event-driven-agent-detection-roadmap.md for the full design.
// Deliberately mirrors CustomCheckDefinition's shape just above — same
// "admin authors in Settings, agent polls read-only" feature class.
// registryKey/etwProvider are Windows-only; fsEventsPath/launchdJobState
// (macOS parity roadmap Phase 5) are macOS-only — see backend's
// eventWatches.schemas.ts WATCH_TYPES doc comment for why these are
// disjoint per-platform values rather than shared ones.
export const WATCH_TYPES = ["registryKey", "etwProvider", "fsEventsPath", "launchdJobState"] as const;
export type WatchType = (typeof WATCH_TYPES)[number];
export const WATCH_PLATFORMS = ["windows", "macos"] as const;
export type WatchPlatform = (typeof WATCH_PLATFORMS)[number];
export const WATCH_ACTIONS = ["refreshInstalledApps", "evaluateComplianceNow"] as const;
export type WatchAction = (typeof WATCH_ACTIONS)[number];

export interface EventWatchDefinition {
  id: string;
  workspaceSlug: string;
  platform: WatchPlatform;
  key: string;
  name: string;
  description?: string | null;
  watchType: WatchType;
  params: Record<string, any>;
  debounceMs: number;
  action: WatchAction;
  enabled: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedBy?: string | null;
  updatedAt: string;
}

// Phase 4 rollout controls + metrics — see backend's eventWatches.service.ts
// getEventDrivenSettings/getEventWatchMetrics doc comments.
export interface EventDrivenSettings {
  enabled: boolean;
  remoteIntervalSec: number | null;
}
export interface EventWatchMetricsSummary {
  windowHours: number;
  webhookVolume: number;
  avgRawEventsPerNotify: number | null;
  avgLatencyMs: number | null;
  medianLatencyMs: number | null;
}

export interface CustomCheckName {
  key: string;
  name: string;
  platform: string;
}

export interface TriggerName {
  id: string;
  name: string;
}

export interface MatchedDevice {
  id: string;
  displayName?: string | null;
  platformLabel?: string | null;
  isCompliant?: boolean;
}

export interface MatchedDevicesDiagnostics {
  error?: string | null;
  httpStatus?: number | null;
  rawMemberCount?: number;
  rawMembers?: Array<{ id: string; displayName?: string | null; platformKey?: string }>;
}

export interface MitreTechnique {
  id: string;
  name: string;
  tactic: string;
  triggeredByFields?: string[];
  revoked?: boolean;
  deprecated?: boolean;
  liveDataAvailable?: boolean;
}

export interface MitreCatalogMeta {
  lastFetchedAt: string | null;
  lastError: string | null;
  techniqueCount: number;
}

export interface ComplianceTemplate {
  id: string;
  framework: string;
  controlRef: string;
  title: string;
  severity: string;
  conditionLogic: "any" | "all";
  description: string;
  conditions: ConditionRule[];
  // Which platform this template was authored for -- null/undefined means
  // "Common (all platforms)", same convention as CompliancePolicy.targetPlatform.
  targetPlatform?: string | null;
  targetDeploymentModel?: string | null;
}

export interface AppCatalogEntry {
  id: string;
  platform: string;
  identifier: string;
  name?: string | null;
  iconUrl?: string | null;
  source?: string | null;
}

export interface AppList {
  id: string;
  name: string;
  platform: string;
  appIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

// Port of the installed-app inventory sync status panel (AppListsView.jsx's
// InventoryStatusPanel, ~lines 358-420) — surfaces the background
// installed_apps_refresher's coverage/staleness/budget so admins aren't
// guessing whether requiredAppList/disallowedAppList conditions actually
// have data yet.
export interface InstalledAppsStatus {
  targetDeviceCount: number;
  syncedCount: number;
  neverSyncedCount: number;
  errorCount: number;
  selfReportedCount: number;
  oldestSyncAgeMinutes: number | null;
  medianSyncAgeMinutes: number | null;
  refreshBudgetPerHour: number;
  refreshBudgetMin: number;
  refreshBudgetMax: number;
  estimatedFullCycleHours: number;
}

// The Apps main-nav view's fleet-wide "what's actually installed, on which
// devices, at which version" table — GET /api/app-lists/reported-apps
// (installedApps.service.ts's getReportedAppsOverview). Independent of the
// App Catalog/App Lists (those are policy-authoring inputs); this is a
// read-only troubleshooting surface over the same underlying
// InstalledAppInventory data every device already reports into.
export interface ReportedAppDeviceRef {
  deviceId: string;
  deviceName: string;
  version: string | null;
  // Only set when self-reported and Applivery UEM genuinely disagree on the
  // installed version for this device (rare drift moment) — see
  // installedApps.service.ts's ReportedAppDeviceRef doc comment.
  versionsBySource?: Record<string, string>;
  // Every source that reported this app on this device — one row per
  // physical device (an app seen by both the SOAR Agent and Applivery UEM
  // has sources.length === 2, it no longer produces two separate rows).
  sources: string[];
  lastSyncAt: string | null;
  updateAvailable: boolean;
  lastFetchError: string | null;
  // Windows-only — see installedApps.service.ts's ReportedAppDeviceRef doc comment.
  productCode: string | null;
  enforcedByPolicy: boolean;
  // Windows-only. "winget" (self-reported only — a real package-manager
  // detection via `winget list`), "msi" (classic Win32 installer — either
  // Applivery UEM's own MSI CSP fetch, or the self-report agent's registry
  // Uninstall-key fallback when winget isn't invokable), "store" (AppX/UWP
  // packages, from either source). Undefined for non-Windows platforms and
  // older cached rows/agent builds that predate this field.
  origin?: "winget" | "msi" | "store";
  // Windows-only, purely informational on-disk install path — see
  // installedApps.service.ts's ReportedAppDeviceRef doc comment. Never used
  // for identifier/matching logic.
  installLocation: string | null;
}
// Per-version CVE detail — one entry per (app, version) combo with a fresh
// cached Vulnerability Service match. Mirrors backend/vulnService.ts's
// AppVersionVulnInfo.
export interface AppVersionVulnInfo {
  checked: boolean;
  mapped: boolean;
  counts: Record<string, number>;
  hasKev: boolean;
  maxEpss: number;
  cveList: Array<Record<string, any>>;
  cachedAt: string | null;
}
// Fleet-wide roll-up for one app across every version currently reported —
// mirrors backend/vulnService.ts's AppVulnSummary (computeReportedAppsVulnSummaries).
// Absent/null when the Vulnerability Service isn't enabled for this workspace.
export interface AppVulnSummary {
  riskScore: number;
  maxSeverity: string | null;
  hasKev: boolean;
  totalCveCount: number;
  byVersion: Record<string, AppVersionVulnInfo>;
}
export interface ReportedAppSummary {
  identifier: string;
  name: string;
  platform: string;
  deviceCount: number;
  versions: string[];
  sources: string[];
  devicesWithPendingUpdate: number;
  devicesEnforcedByPolicy: number;
  devices: ReportedAppDeviceRef[];
  vulnSummary?: AppVulnSummary | null;
}

export const useComplianceStore = defineStore("compliance", () => {
  const policies = ref<CompliancePolicy[]>([]);
  const isLoadingPolicies = ref(false);
  const policiesError = ref<string | null>(null);

  const violations = ref<ComplianceViolation[]>([]);
  const violationsTotal = ref(0);
  const violationsOffset = ref(0);
  const violationsLimit = ref(100);
  const violationsStatusFilter = ref<string>("pending");
  const isLoadingViolations = ref(false);
  const violationsError = ref<string | null>(null);

  const fields = ref<ComplianceFieldDef[]>([]);
  const mitreTechniques = ref<MitreTechnique[]>([]);
  const mitreTactics = ref<Array<{ key: string; name: string; order: number }>>([]);
  const mitreCatalogMeta = ref<MitreCatalogMeta>({ lastFetchedAt: null, lastError: null, techniqueCount: 0 });

  const templates = ref<ComplianceTemplate[]>([]);
  const frameworks = ref<Array<{ key: string; name: string; description?: string }>>([]);

  const appCatalog = ref<AppCatalogEntry[]>([]);
  const appLists = ref<AppList[]>([]);
  const installedAppsStatus = ref<InstalledAppsStatus | null>(null);
  const installedAppsStatusError = ref<string | null>(null);

  const reportedApps = ref<ReportedAppSummary[]>([]);
  const reportedAppsDevicesWithData = ref(0);
  const reportedAppsLastRefreshedAt = ref<string | null>(null);
  const isLoadingReportedApps = ref(false);
  const reportedAppsError = ref<string | null>(null);

  const smartAttributeNames = ref<string[]>([]);
  const selfReportedAttributeNames = ref<string[]>([]);
  const selfReportedAttributeCatalog = ref<SelfReportedAttributeCatalogEntry[]>([]);
  const smartAttributes = ref<SmartAttributeDef[]>([]);
  // policyId -> live violator device count, for the policy grid cards.
  const violatorCounts = ref<Record<string, number | null>>({});

  const customChecks = ref<CustomCheckDefinition[]>([]);
  const isLoadingCustomChecks = ref(false);
  const customChecksError = ref<string | null>(null);
  const customCheckNames = ref<CustomCheckName[]>([]);
  const triggerNames = ref<TriggerName[]>([]);

  const eventWatches = ref<EventWatchDefinition[]>([]);
  const isLoadingEventWatches = ref(false);
  const eventWatchesError = ref<string | null>(null);
  const eventDrivenSettings = ref<EventDrivenSettings>({ enabled: true, remoteIntervalSec: null });
  const eventDrivenSettingsError = ref<string | null>(null);
  const eventWatchMetrics = ref<EventWatchMetricsSummary | null>(null);
  const eventWatchMetricsError = ref<string | null>(null);

  async function fetchPolicies() {
    isLoadingPolicies.value = true;
    policiesError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/compliance/policies");
      policies.value = res.data.items ?? [];
    } catch (err: any) {
      policiesError.value = err?.response?.data?.detail || "Failed to load compliance policies.";
    } finally {
      isLoadingPolicies.value = false;
    }
  }

  async function createPolicy(payload: Partial<CompliancePolicy>) {
    const { api } = await import("../api/http");
    await api.post("/compliance/policies", payload);
    await fetchPolicies();
  }

  async function updatePolicy(policyId: string, payload: Partial<CompliancePolicy>) {
    const { api } = await import("../api/http");
    await api.put(`/compliance/policies/${policyId}`, payload);
    await fetchPolicies();
  }

  async function deletePolicy(policyId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/compliance/policies/${policyId}`);
    await fetchPolicies();
  }

  async function evaluateNow(policyId?: string) {
    const { api } = await import("../api/http");
    const res = await api.post("/compliance/evaluate", policyId ? { policyId } : {});
    return res.data as {
      evaluatedPolicies: number;
      devicesChecked: number;
      violationsFound: number;
      autoFired: number;
      queuedForReview: number;
      recovered: number;
      autoRunSafetyBlocked: number;
    };
  }

  async function fetchViolatingDeviceIds(policyId: string): Promise<string[]> {
    const { api } = await import("../api/http");
    const res = await api.get(`/compliance/policies/${policyId}/violating-device-ids`);
    return res.data.deviceIds ?? [];
  }

  async function fetchViolations() {
    isLoadingViolations.value = true;
    violationsError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/compliance/violations", {
        params: {
          status: violationsStatusFilter.value || undefined,
          limit: violationsLimit.value,
          offset: violationsOffset.value,
        },
      });
      violations.value = res.data.items ?? [];
      violationsTotal.value = res.data.total ?? 0;
    } catch (err: any) {
      violationsError.value = err?.response?.data?.detail || "Failed to load violations.";
    } finally {
      isLoadingViolations.value = false;
    }
  }

  // Port of handleExportViolations (CompliancePoliciesView.jsx:118-130) — the
  // export endpoint sits behind verifyDashboardToken, which only reads the
  // X-Dashboard-Token header (auth.middleware.ts:28), so a bare `window.open`
  // to this URL would 401 with no header attached. Must go through `api`
  // (whose request interceptor stamps that header on every call) and pull
  // the response down as an authenticated blob instead, same pattern as
  // auditLogs.ts's exportCsv.
  async function exportViolationsCsv() {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/violations/export", { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = "compliance-violations.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function approveViolation(violationId: string) {
    const { api } = await import("../api/http");
    await api.post(`/compliance/violations/${violationId}/approve`);
    await fetchViolations();
  }

  async function dismissViolation(violationId: string) {
    const { api } = await import("../api/http");
    await api.post(`/compliance/violations/${violationId}/dismiss`);
    await fetchViolations();
  }

  async function bulkApprove(violationIds: string[]) {
    const { api } = await import("../api/http");
    const res = await api.post("/compliance/violations/bulk-approve", { violationIds });
    await fetchViolations();
    return res.data as { approved: string[]; failed: Array<{ id: string; error: string }> };
  }

  async function bulkDismiss(violationIds: string[]) {
    const { api } = await import("../api/http");
    const res = await api.post("/compliance/violations/bulk-dismiss", { violationIds });
    await fetchViolations();
    return res.data as { dismissed: string[]; failed: Array<{ id: string; error: string }> };
  }

  async function fetchFields() {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/fields");
    fields.value = res.data.items ?? [];
  }

  async function fetchSmartAttributeNames(platform?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/smart-attribute-names", { params: platform ? { platform } : {} });
    smartAttributeNames.value = res.data.items ?? [];
  }

  async function fetchSelfReportedAttributeNames(platform?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/self-reported-attribute-names", { params: platform ? { platform } : {} });
    selfReportedAttributeNames.value = res.data.items ?? [];
    // `catalog` is new alongside `items` (compliance.controller.ts) — the
    // known mobile-telemetry-roadmap attributes' friendly label/value-type/
    // options metadata, so ConditionRow.vue can render a proper value editor
    // instead of generic free text. Backward compatible: an older backend
    // build without this field simply leaves the catalog empty, and the
    // value editor falls back to its previous free-text behavior.
    selfReportedAttributeCatalog.value = res.data.catalog ?? [];
  }

  async function fetchSmartAttributes() {
    const { api } = await import("../api/http");
    const res = await api.get("/smart-attributes");
    smartAttributes.value = res.data.items ?? [];
  }

  async function fetchMatchedDevices(deviceAudienceId: string): Promise<{ items: MatchedDevice[]; diagnostics: MatchedDevicesDiagnostics | null }> {
    const { api } = await import("../api/http");
    const res = await api.get(`/device-audiences/${deviceAudienceId}/matched-devices`);
    return { items: res.data.items ?? [], diagnostics: res.data.diagnostics ?? null };
  }

  async function refreshViolatorCounts(policyIds: string[]) {
    const { api } = await import("../api/http");
    const entries = await Promise.all(
      policyIds.map(async (id) => {
        try {
          const res = await api.get(`/compliance/policies/${id}/violating-device-ids`);
          return [id, (res.data?.deviceIds ?? []).length] as const;
        } catch {
          return [id, null] as const;
        }
      }),
    );
    violatorCounts.value = Object.fromEntries(entries);
  }

  async function suggestMitreTechniques(conditions: ConditionRule[]): Promise<MitreTechnique[]> {
    const { api } = await import("../api/http");
    const res = await api.post("/compliance/suggest-mitre-techniques", { conditions });
    return res.data.items ?? [];
  }

  async function fetchMitreTechniques() {
    const { api } = await import("../api/http");
    const res = await api.get("/mitre/techniques");
    mitreTechniques.value = res.data.items ?? [];
    mitreTactics.value = res.data.tactics ?? [];
    mitreCatalogMeta.value = {
      lastFetchedAt: res.data.catalogLastFetchedAt ?? null,
      lastError: res.data.catalogLastError ?? null,
      techniqueCount: res.data.catalogTechniqueCount ?? 0,
    };
  }

  // Cross-checks the curated technique list against MITRE's live STIX feed
  // (see backend/src/modules/catalogs/mitreCatalog.ts) — surfaces fresher
  // names/revoked/deprecated flags without replacing the curated id set.
  async function refreshMitreCatalogNow() {
    const { api } = await import("../api/http");
    await api.post("/mitre/refresh");
    await fetchMitreTechniques();
  }

  async function fetchTemplates(framework?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/templates", { params: framework ? { framework } : {} });
    templates.value = res.data.items ?? [];
    frameworks.value = res.data.frameworks ?? [];
  }

  async function fetchAppCatalog(platform?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/app-catalog", { params: platform ? { platform } : {} });
    appCatalog.value = res.data.items ?? [];
  }

  async function addAppCatalogEntry(payload: { platform: string; identifier: string; name?: string; iconUrl?: string; source?: string }) {
    const { api } = await import("../api/http");
    await api.post("/app-catalog", payload);
    await fetchAppCatalog();
  }

  async function deleteAppCatalogEntry(entryId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/app-catalog/${entryId}`);
    await fetchAppCatalog();
  }

  async function fetchAppLists(platform?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/app-lists", { params: platform ? { platform } : {} });
    appLists.value = res.data.items ?? [];
  }

  async function createAppList(payload: { name: string; platform: string; appIds: string[] }) {
    const { api } = await import("../api/http");
    await api.post("/app-lists", payload);
    await fetchAppLists();
  }

  async function updateAppList(listId: string, payload: { name: string; platform: string; appIds: string[] }) {
    const { api } = await import("../api/http");
    await api.put(`/app-lists/${listId}`, payload);
    await fetchAppLists();
  }

  async function deleteAppList(listId: string) {
    const { api } = await import("../api/http");
    await api.delete(`/app-lists/${listId}`);
    await fetchAppLists();
  }

  async function searchApps(platform: string, query: string, source?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/app-search", { params: { platform, text: query, source } });
    return { items: res.data.items ?? [], error: res.data.error ?? null };
  }

  // Lookup against Applivery's own Windows App Distribution/MDM application
  // library (a different thing from installedApps.service.ts's per-device
  // inventory) — GET /api/app-lists/windows-app-detail, backed by
  // windowsAppCatalog.service.ts. When productCode is available (server_fetch
  // apps carry the MSI product GUID from the device's own CSP data) it's
  // matched exactly first; otherwise falls back to a best-effort name match,
  // since there's no shared id between a self-reported app and Applivery's
  // catalog.
  async function fetchWindowsAppDetail(name: string, productCode?: string | null): Promise<{ matched: boolean; application: Record<string, any> | null }> {
    const { api } = await import("../api/http");
    const res = await api.get("/app-lists/windows-app-detail", { params: { name, productCode: productCode || undefined } });
    return res.data;
  }

  // Exact Google Play package lookup — NOT a search (Applivery's API has no
  // free-text Play Store search for EMMs, confirmed via docs). Resolves one
  // exact package name against Google Play directly so an admin adding a
  // known package to the App Catalog gets the real title back instead of
  // typing it blind, and finds out immediately if the package doesn't
  // exist. GET /api/app-lists/android-app-lookup, backed by
  // appSearch.service.ts's lookupAndroidAppByPackageName.
  async function lookupAndroidApp(packageName: string): Promise<{ found: boolean; name: string | null; error: string | null }> {
    const { api } = await import("../api/http");
    const res = await api.get("/app-lists/android-app-lookup", { params: { packageName } });
    return res.data;
  }

  async function fetchInstalledAppsStatus() {
    const { api } = await import("../api/http");
    try {
      const res = await api.get("/app-lists/installed-apps-status");
      installedAppsStatus.value = res.data;
      installedAppsStatusError.value = null;
    } catch (err: any) {
      installedAppsStatusError.value = err?.response?.data?.detail || "Could not load inventory sync status.";
    }
  }

  async function refreshInstalledAppsNow(): Promise<number> {
    const { api } = await import("../api/http");
    const res = await api.post("/app-lists/refresh-installed-apps", {});
    return res.data?.queued ?? 0;
  }

  async function setInstalledAppsBudget(budgetPerHour: number) {
    const { api } = await import("../api/http");
    await api.put("/app-lists/installed-apps-budget", { budgetPerHour });
    await fetchInstalledAppsStatus();
  }

  async function fetchReportedApps() {
    const { api } = await import("../api/http");
    isLoadingReportedApps.value = true;
    reportedAppsError.value = null;
    try {
      const res = await api.get("/app-lists/reported-apps");
      reportedApps.value = res.data.apps ?? [];
      reportedAppsDevicesWithData.value = res.data.devicesWithData ?? 0;
      reportedAppsLastRefreshedAt.value = res.data.lastRefreshedAt ?? null;
    } catch (err: any) {
      reportedAppsError.value = err?.response?.data?.detail || "Could not load reported apps.";
    } finally {
      isLoadingReportedApps.value = false;
    }
  }

  // ── Custom Device Checks — Settings > Device Data Webhook. See backend's
  // customChecks.service.ts module doc for the full design. ──

  async function fetchCustomChecks(platform?: string) {
    isLoadingCustomChecks.value = true;
    customChecksError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/compliance/custom-checks", { params: platform ? { platform } : {} });
      customChecks.value = res.data.items ?? [];
    } catch (err: any) {
      customChecksError.value = err?.response?.data?.detail || "Failed to load custom device checks.";
    } finally {
      isLoadingCustomChecks.value = false;
    }
  }

  async function createCustomCheck(payload: Partial<CustomCheckDefinition>) {
    const { api } = await import("../api/http");
    await api.post("/compliance/custom-checks", payload);
    await fetchCustomChecks();
    await fetchCustomCheckNames();
  }

  async function updateCustomCheck(id: string, payload: Partial<CustomCheckDefinition>) {
    const { api } = await import("../api/http");
    await api.put(`/compliance/custom-checks/${id}`, payload);
    await fetchCustomChecks();
    await fetchCustomCheckNames();
  }

  async function deleteCustomCheck(id: string) {
    const { api } = await import("../api/http");
    await api.delete(`/compliance/custom-checks/${id}`);
    await fetchCustomChecks();
    await fetchCustomCheckNames();
  }

  /** Policy Builder's condition picker — available immediately at check creation, see backend's getCustomCheckNames doc comment. */
  async function fetchCustomCheckNames(platform?: string) {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/custom-check-names", { params: platform ? { platform } : {} });
    customCheckNames.value = res.data.items ?? [];
  }

  /** Policy Builder's "Inbound Webhook Fired" condition picker — see backend's getTriggerNames doc comment. */
  async function fetchTriggerNames() {
    const { api } = await import("../api/http");
    const res = await api.get("/compliance/trigger-names");
    triggerNames.value = res.data.items ?? [];
  }

  // ── Event-Driven Detection watches — Settings > Device Data Webhook. See
  // backend's eventWatches.service.ts module doc for the full design. ──

  async function fetchEventWatches(platform?: string) {
    isLoadingEventWatches.value = true;
    eventWatchesError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/compliance/event-watches", { params: platform ? { platform } : {} });
      eventWatches.value = res.data.items ?? [];
    } catch (err: any) {
      eventWatchesError.value = err?.response?.data?.detail || "Failed to load event-driven detection watches.";
    } finally {
      isLoadingEventWatches.value = false;
    }
  }

  async function createEventWatch(payload: Partial<EventWatchDefinition>) {
    const { api } = await import("../api/http");
    await api.post("/compliance/event-watches", payload);
    await fetchEventWatches();
  }

  async function updateEventWatch(id: string, payload: Partial<EventWatchDefinition>) {
    const { api } = await import("../api/http");
    await api.put(`/compliance/event-watches/${id}`, payload);
    await fetchEventWatches();
  }

  async function deleteEventWatch(id: string) {
    const { api } = await import("../api/http");
    await api.delete(`/compliance/event-watches/${id}`);
    await fetchEventWatches();
  }

  async function fetchEventDrivenSettings() {
    eventDrivenSettingsError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/compliance/event-watches-settings");
      eventDrivenSettings.value = res.data;
    } catch (err: any) {
      eventDrivenSettingsError.value = err?.response?.data?.detail || "Failed to load event-driven detection settings.";
    }
  }

  async function updateEventDrivenSettings(payload: EventDrivenSettings) {
    const { api } = await import("../api/http");
    const res = await api.put("/compliance/event-watches-settings", payload);
    eventDrivenSettings.value = res.data;
  }

  async function fetchEventWatchMetrics() {
    eventWatchMetricsError.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/compliance/event-watches-metrics");
      eventWatchMetrics.value = res.data;
    } catch (err: any) {
      eventWatchMetricsError.value = err?.response?.data?.detail || "Failed to load event-driven detection metrics.";
    }
  }

  return {
    policies,
    isLoadingPolicies,
    policiesError,
    violations,
    violationsTotal,
    violationsOffset,
    violationsLimit,
    violationsStatusFilter,
    isLoadingViolations,
    violationsError,
    fields,
    mitreTechniques,
    mitreTactics,
    mitreCatalogMeta,
    templates,
    frameworks,
    appCatalog,
    appLists,
    installedAppsStatus,
    installedAppsStatusError,
    reportedApps,
    reportedAppsDevicesWithData,
    reportedAppsLastRefreshedAt,
    isLoadingReportedApps,
    reportedAppsError,
    smartAttributeNames,
    selfReportedAttributeNames,
    selfReportedAttributeCatalog,
    smartAttributes,
    violatorCounts,
    fetchSmartAttributeNames,
    fetchSelfReportedAttributeNames,
    fetchSmartAttributes,
    fetchMatchedDevices,
    refreshViolatorCounts,
    fetchPolicies,
    createPolicy,
    updatePolicy,
    deletePolicy,
    evaluateNow,
    fetchViolatingDeviceIds,
    fetchViolations,
    exportViolationsCsv,
    approveViolation,
    dismissViolation,
    bulkApprove,
    bulkDismiss,
    fetchFields,
    suggestMitreTechniques,
    fetchMitreTechniques,
    refreshMitreCatalogNow,
    fetchTemplates,
    fetchAppCatalog,
    addAppCatalogEntry,
    deleteAppCatalogEntry,
    fetchAppLists,
    createAppList,
    updateAppList,
    deleteAppList,
    searchApps,
    fetchInstalledAppsStatus,
    refreshInstalledAppsNow,
    setInstalledAppsBudget,
    fetchReportedApps,
    fetchWindowsAppDetail,
    lookupAndroidApp,
    customChecks,
    isLoadingCustomChecks,
    customChecksError,
    customCheckNames,
    triggerNames,
    fetchTriggerNames,
    fetchCustomChecks,
    createCustomCheck,
    updateCustomCheck,
    deleteCustomCheck,
    fetchCustomCheckNames,
    eventWatches,
    isLoadingEventWatches,
    eventWatchesError,
    fetchEventWatches,
    createEventWatch,
    updateEventWatch,
    deleteEventWatch,
    eventDrivenSettings,
    eventDrivenSettingsError,
    fetchEventDrivenSettings,
    updateEventDrivenSettings,
    eventWatchMetrics,
    eventWatchMetricsError,
    fetchEventWatchMetrics,
  };
});
