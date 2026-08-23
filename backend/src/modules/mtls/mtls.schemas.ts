import { z } from "zod";
import { MTLS_LEAF_VALIDITY_DAYS_FLOOR } from "../../utils/mtlsPki";

export const caGeneratePayloadSchema = z.object({
  confirmReplace: z.boolean().optional().default(false),
});

export const caUploadPayloadSchema = z.object({
  certPem: z.string().min(1),
  privateKeyPem: z.string().min(1),
  confirmReplace: z.boolean().optional().default(false),
});

export const caLeafValidityPayloadSchema = z.object({
  leafValidityDays: z.number().int().min(MTLS_LEAF_VALIDITY_DAYS_FLOOR),
});

export const certificateRevokePayloadSchema = z.object({
  reason: z.string().min(1),
});

export const certPurgeSettingsPayloadSchema = z.object({
  enabled: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650),
});

export const certPurgeNowPayloadSchema = z.object({
  olderThanDays: z.number().int().min(1).max(3650),
});

export const mtlsEnforcementPayloadSchema = z.object({
  enabled: z.boolean(),
});

// Hostname only — no scheme, no path, no trailing slash. Loosely validated
// (DNS hostname shape) rather than strictly, since this is admin-entered
// infrastructure config, not user-facing input; the service layer strips a
// stray scheme/path/trailing-slash defensively too, in case someone pastes
// a full URL by habit.
export const agentSubdomainPayloadSchema = z.object({
  agentSubdomain: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/, "Enter a bare hostname (e.g. agents.example.com) — no scheme, path, or port.")
    .nullable(),
});

export const deviceMtlsRegisterPayloadSchema = z.object({
  csrPem: z.string().min(1),
  serialNumber: z.string().min(1),
});

export const deviceMtlsRenewPayloadSchema = z.object({
  csrPem: z.string().min(1),
  serialNumber: z.string().min(1),
});
