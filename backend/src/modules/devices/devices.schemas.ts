import { z } from "zod";

// Port of SegmentUpdatePayload (main.py:3645).
export const segmentUpdateSchema = z.object({
  platform: z.string(),
  segmentId: z.number(),
});
export type SegmentUpdatePayload = z.infer<typeof segmentUpdateSchema>;

// Port of TagsUpdatePayload (main.py:3649).
export const tagsUpdateSchema = z.object({
  platform: z.string(),
  tags: z.array(z.string()),
});
export type TagsUpdatePayload = z.infer<typeof tagsUpdateSchema>;

// Port of PolicyRef (main.py:3653).
export const policyRefSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
});
export type PolicyRef = z.infer<typeof policyRefSchema>;

// Port of PoliciesUpdatePayload (main.py:3657) — ordered: first is primary,
// rest are priority-ordered fallbacks.
export const policiesUpdateSchema = z.object({
  platform: z.string(),
  policies: z.array(policyRefSchema).default([]),
});
export type PoliciesUpdatePayload = z.infer<typeof policiesUpdateSchema>;

// Port of BulkReattestPayload (main.py:7939).
export const bulkReattestSchema = z.object({
  deviceIds: z.array(z.string()),
});
export type BulkReattestPayload = z.infer<typeof bulkReattestSchema>;

// Port of DeviceAudienceSelectors / DeviceAudienceCreatePayload (main.py:4038-4051).
export const deviceAudienceSelectorsSchema = z.object({
  deviceGroups: z.array(z.array(z.string())).default([]),
  mdmUserGroups: z.array(z.array(z.string())).default([]),
  emmDeviceIds: z.array(z.string()).default([]),
  admDeviceIds: z.array(z.string()).default([]),
  winDeviceIds: z.array(z.string()).default([]),
  aosDeviceIds: z.array(z.string()).default([]),
  mdmUserIds: z.array(z.string()).default([]),
  serialNumbers: z.array(z.string()).default([]),
});

export const deviceAudienceCreateSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  selectors: deviceAudienceSelectorsSchema,
});
export type DeviceAudienceCreatePayload = z.infer<typeof deviceAudienceCreateSchema>;
