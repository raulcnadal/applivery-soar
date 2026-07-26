import { z } from "zod";

/**
 * Case Management + SLA + Auto-Run Rules payload shapes. Port of
 * CaseCreatePayload/CaseUpdatePayload/CaseNotePayload/CaseBulkUpdatePayload
 * (main.py:11938-11959), CaseSlaThresholdPayload/CaseSlaSettingsPayload
 * (main.py:12431-12438), CaseAutoRunRulePayload (main.py:12490-12509), and
 * CaseEnrichPayload (main.py:14322).
 */

export const CASE_STATUSES = ["open", "investigating", "resolved", "closed", "false_positive"] as const;
export const CASE_OPEN_STATUSES = ["open", "investigating"] as const;
export const CASE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const CASE_SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function isOpenCaseStatus(status: string): boolean {
  return (CASE_OPEN_STATUSES as readonly string[]).includes(status);
}

export const caseCreateSchema = z.object({
  title: z.string(),
  severity: z.string().default("medium"),
  deviceId: z.string().nullable().optional(),
  deviceName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(), // optional first note, added at creation
  mitreTechniques: z.array(z.string()).default([]),
});
export type CaseCreatePayload = z.infer<typeof caseCreateSchema>;

export const caseUpdateSchema = z.object({
  title: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  severity: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  mitreTechniques: z.array(z.string()).nullable().optional(), // undefined/null = leave untouched; [] explicitly clears
});
export type CaseUpdatePayload = z.infer<typeof caseUpdateSchema>;

export const caseNoteSchema = z.object({ text: z.string() });
export type CaseNotePayload = z.infer<typeof caseNoteSchema>;

export const caseBulkUpdateSchema = z.object({
  caseIds: z.array(z.string()),
  status: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
});
export type CaseBulkUpdatePayload = z.infer<typeof caseBulkUpdateSchema>;

export const caseRunWorkflowSchema = z.object({ workflowId: z.string() });
export type CaseRunWorkflowPayload = z.infer<typeof caseRunWorkflowSchema>;

export const caseSlaThresholdSchema = z.object({
  acknowledgeMinutes: z.number().int().default(240),
  resolveMinutes: z.number().int().default(1440),
});
export type CaseSlaThresholdPayload = z.infer<typeof caseSlaThresholdSchema>;

export const caseSlaSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  notifyOnBreach: z.boolean().default(true),
  thresholds: z.record(z.string(), caseSlaThresholdSchema).default({}),
});
export type CaseSlaSettingsPayload = z.infer<typeof caseSlaSettingsSchema>;

export const caseAutoRunRuleSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  minSeverity: z.string().default("high"),
  mitreTechniques: z.array(z.string()).default([]),
  workflowId: z.string(),
  autoRunDestructiveAck: z.boolean().default(false),
  maxFiresPerHour: z.number().int().default(10),
});
export type CaseAutoRunRulePayload = z.infer<typeof caseAutoRunRuleSchema>;

export const caseEnrichSchema = z.object({
  value: z.string(),
  forceRefresh: z.boolean().default(false),
});
export type CaseEnrichPayload = z.infer<typeof caseEnrichSchema>;
