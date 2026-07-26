import { z } from "zod";

/** Port of `ReportPayload` (main.py:892-901). */
export const reportPayloadSchema = z.object({
  workspace: z.string(),
  sources: z.array(z.string()),
  timeLapse: z.string(),
  filters: z.record(z.any()).default({}),
  display: z
    .object({
      trend: z.boolean().optional(),
      trend_type: z.string().optional(),
      donut: z.boolean().optional(),
      donut_type: z.string().optional(),
      table: z.boolean().optional(),
      table_type: z.string().optional(),
    })
    .default({ trend: true, trend_type: "line", donut: true, donut_type: "donut", table: true, table_type: "standard" }),
  webhookUrl: z.string().nullable().optional(),
  emailRecipients: z.string().nullable().optional(),
  smtp: z.record(z.any()).nullable().optional(),
  schedule: z.record(z.any()).nullable().optional(),
});

export type ReportPayload = z.infer<typeof reportPayloadSchema>;

/** One entry of `WorkspaceState.scheduledReports` (main.py's `scheduledReports` state array — see report_scheduler_loop). */
export const scheduledReportSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceSlug: z.string(),
  sources: z.array(z.string()),
  timeLapse: z.string().default("Last 30 Days"),
  filters: z.record(z.any()).default({}),
  display: z.record(z.any()).default({}),
  emailRecipients: z.string().nullable().optional(),
  delivery: z.object({ chat: z.boolean().default(false), email: z.boolean().default(false) }).default({ chat: false, email: false }),
  schedule: z.object({
    enabled: z.boolean().default(true),
    frequency: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
    time: z.string(), // "HH:MM", local to `timezone`
    timezone: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
  }),
});
export type ScheduledReport = z.infer<typeof scheduledReportSchema>;
