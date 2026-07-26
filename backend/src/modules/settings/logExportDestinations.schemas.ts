import { z } from "zod";

/** Port of main.py:2036-2037, 2273-2287 (LogExportDestinationPayload). */

export const LOG_EXPORT_REALTIME_TYPES = ["syslog", "webhook"] as const;
export const LOG_EXPORT_BATCH_TYPES = ["s3", "nfs", "sftp"] as const;
export const LOG_EXPORT_VALID_TYPES = [...LOG_EXPORT_REALTIME_TYPES, ...LOG_EXPORT_BATCH_TYPES] as const;
export const LOG_EXPORT_FORMATS = ["json", "cef"] as const;

export type LogExportDestinationType = (typeof LOG_EXPORT_VALID_TYPES)[number];

export const logExportDestinationPayloadSchema = z.object({
  type: z.enum(LOG_EXPORT_VALID_TYPES),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  format: z.enum(LOG_EXPORT_FORMATS).default("json"),
  config: z.record(z.any()).default({}),
});
export type LogExportDestinationPayload = z.infer<typeof logExportDestinationPayloadSchema>;

// Secret sub-fields encrypted at rest per destination type — mirrors
// integrations.service.ts's INTEGRATION_SECRET_FIELDS pattern.
export const LOG_EXPORT_SECRET_FIELDS: Record<string, readonly string[]> = {
  s3: ["secretAccessKey"],
  sftp: ["password", "privateKeyPassphrase", "privateKey"],
  webhook: ["authHeaderValue"],
};
