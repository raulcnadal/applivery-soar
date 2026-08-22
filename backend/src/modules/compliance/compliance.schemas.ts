import { z } from "zod";

/** Port of `ConditionRule` (main.py:10639). */
export const conditionRuleSchema = z.object({
  field: z.string(),
  operator: z.string(),
  value: z.any().optional().nullable(),
});
export type ConditionRulePayload = z.infer<typeof conditionRuleSchema>;

/**
 * Port of `CompliancePolicyPayload` (main.py:10674-10804) — see that class's
 * extensive field-by-field comments for the "why" behind each of these;
 * kept here only as terse operator notes, not duplicated at length.
 */
export const compliancePolicySchema = z.object({
  name: z.string(),
  description: z.string().optional().default(""),
  enabled: z.boolean().default(true),
  autoRun: z.boolean().default(false),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  conditionLogic: z.enum(["any", "all"]).default("any"),
  conditions: z.array(conditionRuleSchema).default([]),
  // See CompliancePolicy.targetPlatform/targetDeploymentModel in
  // schema.prisma for the full rationale -- same fields/semantics as
  // Workflow's own targetPlatform/targetDeploymentModel, not present in
  // the original main.py (a disclosed addition, not a parity port).
  targetPlatform: z.string().nullable().optional(),
  targetDeploymentModel: z.string().nullable().optional(),
  workflowId: z.string().nullable().optional(),
  nonComplianceTag: z.string().nullable().optional(),
  nonComplianceSmartAttributeId: z.string().nullable().optional(),
  openCaseOnViolation: z.boolean().default(true),
  autoResolveCaseOnRecovery: z.boolean().default(false),
  mitreTechniques: z.array(z.string()).default([]),
  framework: z.string().nullable().optional(),
  controlRef: z.string().nullable().optional(),
  targetDeviceAudienceId: z.string().nullable().optional(),
  segmentId: z.string().nullable().optional(),
  evaluationIntervalMinutes: z.number().int().nullable().optional(),
  autoRunBatchCap: z.number().int().nullable().optional().default(15),
  autoRunDestructiveAck: z.boolean().default(false),
  escalatedWorkflowId: z.string().nullable().optional(),
  escalatedWorkflowMinRiskTier: z.enum(["low", "medium", "high", "critical"]).default("high"),
  // See CompliancePolicy.alertOnViolation in schema.prisma for the full
  // rationale — a rolled-up per-pass webhook/email alert, independent of
  // autoRun/workflow config.
  alertOnViolation: z.boolean().default(false),
  alertViaWebhook: z.boolean().default(false),
  alertViaEmail: z.boolean().default(false),
  alertWebhookUrl: z.string().nullable().optional(),
  alertEmailRecipients: z.string().nullable().optional(),
  // Optional per-channel daily send caps — see
  // CompliancePolicy.alertWebhookMaxPerDay in schema.prisma. Null/unset is
  // unlimited; a positive int caps that channel independently of the other.
  alertWebhookMaxPerDay: z.number().int().positive().nullable().optional(),
  alertEmailMaxPerDay: z.number().int().positive().nullable().optional(),
});
export type CompliancePolicyPayload = z.infer<typeof compliancePolicySchema>;

/** Port of `EvaluateNowPayload` (main.py:11376). */
export const evaluateNowSchema = z.object({
  policyId: z.string().nullable().optional(),
});
export type EvaluateNowPayload = z.infer<typeof evaluateNowSchema>;

/** Port of `BulkViolationIdsPayload` (main.py:11529). */
export const bulkViolationIdsSchema = z.object({
  violationIds: z.array(z.string()),
});
export type BulkViolationIdsPayload = z.infer<typeof bulkViolationIdsSchema>;

/** Port of `SuggestMitreTechniquesPayload` (main.py:9948). */
export const suggestMitreTechniquesSchema = z.object({
  conditions: z.array(z.record(z.string(), z.any())).default([]),
});
export type SuggestMitreTechniquesPayload = z.infer<typeof suggestMitreTechniquesSchema>;
