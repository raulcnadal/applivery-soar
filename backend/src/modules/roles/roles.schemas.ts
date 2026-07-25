import { z } from "zod";

// Mirrors RolePayload (main.py:1094).
export const rolePayloadSchema = z.object({
  name: z.string(),
  description: z.string().optional().default(""),
  featureAccess: z.record(z.string(), z.string()).optional().default({}),
  riskyActions: z.record(z.string(), z.boolean()).optional().default({}),
  appliveryTagValues: z.array(z.string()).optional().default([]),
  segmentIds: z.array(z.string()).optional().default([]),
});
export type RolePayload = z.infer<typeof rolePayloadSchema>;

// Mirrors CollaboratorTagsPayload (main.py:1383).
export const collaboratorTagsSchema = z.object({
  role: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});
export type CollaboratorTagsPayload = z.infer<typeof collaboratorTagsSchema>;

// Mirrors TestAccessPayload (main.py:1424).
export const testAccessSchema = z.object({
  email: z.string(),
});
export type TestAccessPayload = z.infer<typeof testAccessSchema>;
