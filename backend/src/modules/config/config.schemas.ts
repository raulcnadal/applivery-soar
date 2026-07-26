import { z } from "zod";

/**
 * Port of `EXPORTABLE_CONFIG_STORES` (main.py:1763-1778) — every
 * "configuration" store a workspace's Backup & Restore bundle covers.
 * Deliberately excludes history/execution tables (WorkflowVersion,
 * WorkflowRun, ComplianceViolation, Cases, audit log, caches) — those are
 * operational history, not configuration to travel with a clone/import.
 */
export const CONFIG_STORE_KEYS = [
  "compliancePolicies",
  "workflows",
  "triggers",
  "integrations",
  "caseAutoRunRules",
  "caseSlaSettings",
  "threatIntelProviders",
  "appliveryWebhookConfig",
  "actionLibrary",
  "appLists",
  "scriptRepos",
  "dashboardState",
  "vulnServiceConfig",
  "firewallRuleSets",
] as const;
export type ConfigStoreKey = (typeof CONFIG_STORE_KEYS)[number];

export const CONFIG_EXPORT_SCHEMA_VERSION = 1;

export const configClonePayloadSchema = z.object({
  sourceWorkspaceSlug: z.string().min(1),
  stores: z.array(z.enum(CONFIG_STORE_KEYS)).default([]),
});
export type ConfigClonePayload = z.infer<typeof configClonePayloadSchema>;

export const configImportPayloadSchema = z.object({
  schemaVersion: z.number(),
  data: z.record(z.any()),
  stores: z.array(z.enum(CONFIG_STORE_KEYS)).default([]),
});
export type ConfigImportPayload = z.infer<typeof configImportPayloadSchema>;
