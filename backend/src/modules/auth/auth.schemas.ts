import { z } from "zod";

// Mirrors AppliveryLoginPayload (main.py:880).
export const loginSchema = z.object({
  email: z.string(),
  password: z.string(),
  twoFactorCode: z.string().optional(),
});
export type LoginBody = z.infer<typeof loginSchema>;

// Mirrors RefreshPayload (main.py:885).
export const refreshSchema = z.object({
  lastAccessToken: z.string(),
  refreshToken: z.string(),
});
export type RefreshBody = z.infer<typeof refreshSchema>;
