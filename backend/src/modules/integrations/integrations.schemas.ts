import { z } from "zod";

/**
 * Chat/Ticketing/Paging destinations a Case can notify. Port of
 * IntegrationPayload (main.py:13300-13340).
 *
 * Type-specific `config` shape (not enforced by this schema — validated at
 * dispatch/test time instead, same as the original):
 *   slack/teams/discord:  { webhookUrl }
 *   jira:                 { baseUrl, email, apiToken, projectKey, issueType }
 *   servicenow:            { instanceUrl, username, password, table }
 *   generic_webhook:       { url, headers }
 *   pagerduty:             { routingKey }
 *   opsgenie:              { apiKey, region: 'us' | 'eu' }
 */
export const INTEGRATION_TYPES = [
  "slack", "teams", "discord", "jira", "servicenow", "generic_webhook", "pagerduty", "opsgenie",
] as const;

export const integrationPayloadSchema = z.object({
  name: z.string(),
  type: z.string(),
  enabled: z.boolean().default(true),
  notifyOnOpen: z.boolean().default(true),
  // Ignored for type in ('jira', 'servicenow') — see module comment above;
  // kept rather than rejected so the UI can grey it out instead of needing
  // type-conditional validation on every save.
  notifyOnClose: z.boolean().default(false),
  minSeverity: z.string().default("low"),
  autoCloseCaseOnRemoteResolve: z.boolean().default(false),
  notifyOnSystemHealth: z.boolean().default(false),
  config: z.record(z.string(), z.any()).default({}),
});
export type IntegrationPayload = z.infer<typeof integrationPayloadSchema>;

export interface ExternalRef {
  type: string;
  id: string;
  url: string;
  sysId?: string | null;
  remoteStatus?: string | null;
  remoteResolved?: boolean;
  remoteStatusCheckedAt?: string | null;
  remoteStatusError?: string | null;
}
