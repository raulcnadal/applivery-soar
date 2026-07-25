import { z } from "zod";

// Port of AppCatalogAddPayload (main.py:8100).
export const appCatalogAddSchema = z.object({
  platform: z.string(),
  identifier: z.string(),
  name: z.string().nullish(),
  iconUrl: z.string().nullish(),
  source: z.string().default("manual"),
});
export type AppCatalogAddPayload = z.infer<typeof appCatalogAddSchema>;

// Port of AppListPayload (main.py:8134).
export const appListSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  platform: z.string(),
  appIds: z.array(z.string()).default([]),
});
export type AppListPayload = z.infer<typeof appListSchema>;

// Port of InstalledAppsBudgetPayload (main.py:9524).
export const installedAppsBudgetSchema = z.object({
  budgetPerHour: z.number(),
});
