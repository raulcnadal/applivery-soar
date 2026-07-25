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
  workflowId: z.string().nullable().optional(),
  nonComplianceTag: z.string().nullable().optional(),
  nonComplianceSmartAttributeId: z.string().nullable().optional(),
  openCaseOnViolation: z.boolean().default(true),
  autoResolveCaseOnRecovery: z.boolean().default(false),
  mitreTechniques: z.array(z.string()).default([]),
  framework: z.string().nullable().optional(),
  controlRef: z.string().nullable().optional(),
  targetDeviceAudienceId: z.string().nullable().optional(),
  evaluationIntervalMinutes: z.number().int().nullable().optional(),
  autoRunBatchCap: z.number().int().nullable().optional().default(15),
  autoRunDestructiveAck: z.boolean().default(false),
  escalatedWorkflowId: z.string().nullable().optional(),
  escalatedWorkflowMinRiskTier: z.enum(["low", "medium", "high", "critical"]).default("high"),
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
