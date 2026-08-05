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
      // Mirror the just-saved fields back onto this store's own refs. Every
      // *SettingsForm/*Panel component calling this generic saveState()
      // directly (General, SMTP, Audit Log Retention, and any future one)
      // was relying on `isLoaded` flipping back to false so its own
      // `onMounted`'s `if (!isLoaded) fetchState()` guard would re-fetch —
      // but isLoaded is Pinia store state, which outlives a Settings modal
      // close/reopen or a tab switch for the rest of the session, so that
      // guard never re-ran after the very first load. A save that genuinely
      // persisted server-side (POST /api/state above succeeded) was then
      // never reflected back into dashboard/themeMode/webhookUrl/
      // smtpConfig/etc., so reopening that same panel later re-populated
      // its form from stale pre-save data — indistinguishable, from the
      // admin's side, from "the Save button doesn't actually save
      // anything." saveDashboard/saveScheduledReports/saveCustomReportTemplate
      // below already did their own version of this per-field; this
      // generalizes it to every key any caller sends through here.
      if (Object.prototype.hasOwnProperty.call(partial, "dashboard") && partial.dashboard) dashboard.value = partial.dashboard;
      if (Object.prototype.hasOwnProperty.call(partial, "themeMode")) themeMode.value = partial.themeMode ?? null;
      if (Object.prototype.hasOwnProperty.call(partial, "webhookUrl")) webhookUrl.value = partial.webhookUrl ?? "";
      if (Object.prototype.hasOwnProperty.call(partial, "smtpConfig")) smtpConfig.value = partial.smtpConfig ?? {};
      if (Object.prototype.hasOwnProperty.call(partial, "scheduledReports")) scheduledReports.value = partial.scheduledReports ?? [];
      if (Object.prototype.hasOwnProperty.call(partial, "timezone")) timezone.value = partial.timezone ?? "UTC";
      if (Object.prototype.hasOwnProperty.call(partial, "customReportTemplate")) customReportTemplate.value = partial.customReportTemplate ?? "";
      if (Object.prototype.hasOwnProperty.call(partial, "auditLogRetentionDays")) auditLogRetentionDays.value = partial.auditLogRetentionDays ?? null;
      if (Object.prototype.hasOwnProperty.call(partial, "sessionTimeoutMinutes")) sessionTimeoutMinutes.value = partial.sessionTimeoutMinutes ?? null;
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
