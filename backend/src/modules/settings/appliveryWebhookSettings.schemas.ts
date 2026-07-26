import { z } from "zod";

/** Port of main.py:12939-12949, 13026-13038 (event catalog + payload shape). */

export const APPLIVERY_WEBHOOK_EVENT_LABELS: Record<string, string> = {
  device_enrolled: "Device enrolled",
  device_added_mdm_user: "Device MDM user changed",
  "enrollment-token_created": "Enrollment token created",
  build_created: "Build uploaded",
  build_processed: "Build processed",
  bug_created: "Bug report received",
  feedback_created: "Feedback report received",
  certificate_will_expire: "App certificate expiring",
  push_certification_renovation: "Apple push certificate expiring",
};

export function appliveryWebhookEventLabel(canonicalKey: string): string {
  if (APPLIVERY_WEBHOOK_EVENT_LABELS[canonicalKey]) return APPLIVERY_WEBHOOK_EVENT_LABELS[canonicalKey];
  const spaced = canonicalKey.replace(/_/g, " ").replace(/-/g, " ").trim();
  if (!spaced) return "Unknown event";
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const appliveryWebhookRulePayloadSchema = z.object({
  actionKey: z.string().min(1),
  label: z.string().nullish(),
  enabled: z.boolean().default(false),
  openCase: z.boolean().default(false),
  caseSeverity: z.string().default("medium"),
  runWorkflow: z.boolean().default(false),
  workflowId: z.string().nullish(),
  autoRunDestructiveAck: z.boolean().default(false),
});

export const appliveryWebhookConfigPayloadSchema = z.object({
  enabled: z.boolean().default(true),
  rules: z.array(appliveryWebhookRulePayloadSchema).default([]),
});
export type AppliveryWebhookConfigPayload = z.infer<typeof appliveryWebhookConfigPayloadSchema>;
