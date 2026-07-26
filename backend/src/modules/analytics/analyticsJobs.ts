import { prisma } from "../../services/prisma";
import { getAutomationBearer, listAutomationWorkspaces } from "../settings/automationCredential.service";
import { decryptSmtpConfig } from "../../services/smtpConfig";
import { captureDailySnapshot } from "./snapshotCapture";
import { purgeOldSnapshots } from "./snapshotEngine";
import { generateReportPdf, sendEmailReport, sendGoogleChatWebhook } from "../reports/reports.service";
import { scheduledReportSchema, type ReportPayload } from "../reports/reports.schemas";

export const SNAPSHOT_SCHEDULER_TICK_MS = 86_400_000; // once daily — see backgroundJobs.ts's staggered-boot convention (no other job pins to a specific wall-clock hour either, unlike the original's "00:05 UTC")
export const REPORT_SCHEDULER_TICK_MS = 60_000; // once a minute, matching the original's per-minute HH:MM schedule check

const GLOBAL_STATE_SLUG = "global"; // scheduledReports always lives on the 'global' WorkspaceState row — see dashboardState.controller.ts's module doc

/** Port of `snapshot_scheduler_loop`'s body (main.py:16016-16046), one tick. */
export async function runSnapshotSchedulerTick(): Promise<void> {
  const workspaces = await listAutomationWorkspaces();
  if (!workspaces.length) return;
  const dateStr = new Date().toISOString().slice(0, 10);
  for (const orgSlug of workspaces) {
    const bearer = await getAutomationBearer(orgSlug);
    if (!bearer) continue;
    await captureDailySnapshot(bearer, orgSlug, dateStr);
  }
  await purgeOldSnapshots();
}

function localPartsInTimezone(timeZone: string, at: Date): { hhmm: string; weekday: number; dayOfMonth: number; dateStr: string } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return {
    hhmm: `${parts.hour}:${parts.minute}`,
    weekday: weekdayMap[parts.weekday] ?? 0,
    dayOfMonth: Number(parts.day),
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Port of `report_scheduler_loop`'s body (main.py:16048-16159), one tick. */
export async function runReportSchedulerTick(): Promise<void> {
  const stateRow = await prisma.workspaceState.findUnique({ where: { workspaceSlug: GLOBAL_STATE_SLUG } });
  const rawReports = (stateRow?.scheduledReports as any[]) ?? [];
  if (!rawReports.length) return;

  const now = new Date();
  for (const raw of rawReports) {
    const parsed = scheduledReportSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[Report Scheduler] Skipping malformed scheduled report '${raw?.name ?? raw?.id}': ${parsed.error.message}`);
      continue;
    }
    const rep = parsed.data;
    if (!rep.schedule.enabled) continue;

    const orgSlug = rep.workspaceSlug;
    if (!orgSlug) {
      console.log(`[Report Scheduler] Skipped '${rep.name}': no workspace associated with this schedule.`);
      continue;
    }
    const bearer = await getAutomationBearer(orgSlug);
    if (!bearer) {
      console.log(`[Report Scheduler] Skipped '${rep.name}': no automation credential configured for workspace '${orgSlug}'.`);
      continue;
    }

    const tz = rep.schedule.timezone || "UTC";
    let local: ReturnType<typeof localPartsInTimezone>;
    try {
      local = localPartsInTimezone(tz, now);
    } catch {
      local = localPartsInTimezone("UTC", now);
    }

    const startDate = rep.schedule.startDate || "2000-01-01";
    if (local.dateStr < startDate) continue;
    if (rep.schedule.time !== local.hhmm) continue;
    if (rep.schedule.frequency === "weekly" && local.weekday !== 0) continue; // Monday
    if (rep.schedule.frequency === "monthly" && local.dayOfMonth !== 1) continue;

    console.log(`[Report Scheduler] Triggering scheduled report '${rep.name}' (workspace: ${orgSlug}, tz: ${tz})`);
    try {
      const payload: ReportPayload = {
        workspace: orgSlug,
        sources: rep.sources,
        timeLapse: rep.timeLapse,
        filters: rep.filters,
        display: rep.display as any,
        webhookUrl: rep.delivery.chat ? stateRow?.webhookUrl ?? null : null,
        emailRecipients: rep.delivery.email ? rep.emailRecipients ?? null : null,
        smtp: rep.delivery.email ? decryptSmtpConfig(stateRow?.smtpConfig as any) ?? null : null,
      };
      if (payload.webhookUrl) void sendGoogleChatWebhook(payload.webhookUrl, payload.workspace, payload.timeLapse, payload.sources.length);
      const { pdfBuffer, orgName } = await generateReportPdf(payload, bearer, orgSlug);
      if (payload.emailRecipients && payload.smtp) void sendEmailReport(payload.smtp, payload.emailRecipients, pdfBuffer, orgName, payload.timeLapse);
    } catch (e) {
      console.warn(`[Report Scheduler] Failed to execute scheduled report '${rep.name}': ${e}`);
    }
  }
}
