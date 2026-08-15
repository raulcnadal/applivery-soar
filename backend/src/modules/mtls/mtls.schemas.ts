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

export const bootstrapTokenPayloadSchema = z.object({
  serialNumber: z.string().min(1),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
});

export const bootstrapTokenBulkPayloadSchema = z.object({
  serialNumbers: z.array(z.string().min(1)).min(1).max(500),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
});

export const certificateRevokePayloadSchema = z.object({
  reason: z.string().min(1),
});

export const deviceMtlsRegisterPayloadSchema = z.object({
  csrPem: z.string().min(1),
  serialNumber: z.string().min(1),
});

export const deviceMtlsRenewPayloadSchema = z.object({
  csrPem: z.string().min(1),
  serialNumber: z.string().min(1),
});
