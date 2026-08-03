import { defineStore } from "pinia";
import { ref } from "vue";
import { DEFAULT_DASHBOARD, type DashboardState } from "../lib/analyticsCatalog";

/**
 * Port of GET/POST /api/state (main.py:1683-1719) — the shared, cross-user
 * dashboard/theme/webhook/SMTP/scheduled-reports/session-policy state. Every
 * call this store makes MUST pin `X-Workspace-Slug: global` explicitly
 * (never the currently-selected org), exactly like the original frontend's
 * own hardcoded header on this endpoint pair — see http.ts's interceptor
 * comment and dashboardState.controller.ts's module doc for why.
 */
export interface ScheduledReportDelivery {
  download: boolean;
  chat: boolean;
  email: boolean;
}
export interface ScheduledReportSchedule {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  time: string;
  timezone?: string | null;
  startDate?: string | null;
}
export interface ScheduledReport {
  id: string;
  name: string;
  workspaceSlug: string;
  sources: string[];
  timeLapse: string;
  filters: Record<string, any>;
  display: Record<string, any>;
  emailRecipients?: string | null;
  delivery: ScheduledReportDelivery;
  schedule: ScheduledReportSchedule;
}

const GLOBAL_HEADERS = { headers: { "X-Workspace-Slug": "global" } };

export const useDashboardStateStore = defineStore("dashboardState", () => {
  const dashboard = ref<DashboardState>(structuredClone(DEFAULT_DASHBOARD));
  const themeMode = ref<string | null>(null);
  const webhookUrl = ref<string>("");
  const smtpConfig = ref<Record<string, any>>({});
  const scheduledReports = ref<ScheduledReport[]>([]);
  const timezone = ref<string>("UTC");
  const customReportTemplate = ref<string>("");
  const auditLogRetentionDays = ref<number | null>(null);
  const sessionTimeoutMinutes = ref<number | null>(null);
  const isLoaded = ref(false);
  const isSaving = ref(false);
  const error = ref<string | null>(null);

  async function fetchState() {
    error.value = null;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/state", GLOBAL_HEADERS);
      const s = res.data ?? {};
      if (s.dashboard && Array.isArray(s.dashboard.widgets)) dashboard.value = s.dashboard;
      themeMode.value = s.themeMode ?? null;
      webhookUrl.value = s.webhookUrl ?? "";
      smtpConfig.value = s.smtpConfig ?? {};
      scheduledReports.value = Array.isArray(s.scheduledReports) ? s.scheduledReports : [];
      timezone.value = s.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      customReportTemplate.value = s.customReportTemplate ?? "";
      auditLogRetentionDays.value = s.auditLogRetentionDays ?? null;
      sessionTimeoutMinutes.value = s.sessionTimeoutMinutes ?? null;
      isLoaded.value = true;
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to load dashboard state.";
    }
  }

  async function saveState(partial: Record<string, any>) {
    isSaving.value = true;
    error.value = null;
    try {
      const { api } = await import("../api/http");
      await api.post("/state", partial, GLOBAL_HEADERS);
    } catch (err: any) {
      error.value = err?.response?.data?.detail || "Failed to save dashboard state.";
      throw err;
    } finally {
      isSaving.value = false;
    }
  }

  async function saveDashboard(next: DashboardState) {
    dashboard.value = next;
    await saveState({ dashboard: next });
  }

  async function saveScheduledReports(next: ScheduledReport[]) {
    scheduledReports.value = next;
    await saveState({ scheduledReports: next });
  }

  async function saveCustomReportTemplate(next: string) {
    customReportTemplate.value = next;
    await saveState({ customReportTemplate: next });
  }

  return {
    dashboard, themeMode, webhookUrl, smtpConfig, scheduledReports, timezone,
    customReportTemplate, auditLogRetentionDays, sessionTimeoutMinutes,
    isLoaded, isSaving, error,
    fetchState, saveState, saveDashboard, saveScheduledReports, saveCustomReportTemplate,
  };
});
