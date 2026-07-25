import { z } from "zod";

/**
 * Port of WorkflowStep/WorkflowRecoveryConfig/WorkflowPayload/
 * WorkflowDeviceRef/WorkflowRunRequest (main.py:6193-6288). See each
 * Pydantic model's docstring in main.py for the full "why" — kept here as
 * terse operator notes only.
 */
export const workflowStepSchema = z.object({
  id: z.string(),
  // 'mdm_action' | 'http_request' | 'notification' | 'policy_replace' |
  // 'policy_add' | 'policy_restore' | 'monitor' | 'wait' | 'run_script_wait'
  type: z.string(),
  name: z.string(),
  config: z.record(z.string(), z.any()).default({}),
  onSuccess: z.string().nullable().optional(), // step id, 'end', or null => next step in the list
  onFailure: z.string().nullable().optional(), // step id, 'end', or null => stop the chain
});
export type WorkflowStepPayload = z.infer<typeof workflowStepSchema>;

export const workflowRecoveryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  compliancePolicyId: z.string().nullable().optional(),
  steps: z.array(workflowStepSchema).default([]),
});
export type WorkflowRecoveryConfigPayload = z.infer<typeof workflowRecoveryConfigSchema>;

export const workflowPayloadSchema = z.object({
  name: z.string(),
  description: z.string().optional().default(""),
  steps: z.array(workflowStepSchema).default([]),
  targetPlatform: z.string().nullable().optional(), // 'apple' | 'macos' | 'android' | 'windows' | null
  targetDeploymentModel: z.string().nullable().optional(),
  recovery: workflowRecoveryConfigSchema.default({ enabled: false, compliancePolicyId: null, steps: [] }),
  allowUnattendedDestructive: z.boolean().default(false),
});
export type WorkflowPayload = z.infer<typeof workflowPayloadSchema>;

export const workflowDeviceRefSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable().optional(),
  platform: z.string(),
  platformDeviceId: z.string(),
  serialNumber: z.string().nullable().optional(),
  osVersion: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  udid: z.string().nullable().optional(),
  mdmUser: z.record(z.string(), z.any()).nullable().optional(),
  osLifecycleStatus: z.record(z.string(), z.any()).nullable().optional(),
});
export type WorkflowDeviceRefPayload = z.infer<typeof workflowDeviceRefSchema>;

export const workflowRunRequestSchema = z.object({
  devices: z.array(workflowDeviceRefSchema),
  targetDescription: z.string().nullable().optional(),
});
export type WorkflowRunRequestPayload = z.infer<typeof workflowRunRequestSchema>;

export const workflowDryRunRequestSchema = z.object({
  device: workflowDeviceRefSchema.nullable().optional(),
});
export type WorkflowDryRunRequestPayload = z.infer<typeof workflowDryRunRequestSchema>;
