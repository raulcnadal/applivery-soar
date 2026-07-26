import { z } from "zod";

/** Port of ThreatIntelProviderPayload (main.py:14228-14235). */
export const THREAT_INTEL_PROVIDER_TYPES = ["virustotal", "abuseipdb", "hibp", "generic_rest"] as const;

export const threatIntelProviderPayloadSchema = z.object({
  name: z.string(),
  type: z.string(),
  enabled: z.boolean().default(true),
  // Type-specific shape:
  //   virustotal/abuseipdb/hibp: { apiKey }
  //   generic_rest: { urlTemplate: "https://api.example.com/lookup?q={{ ioc }}", headers: {...} }
  config: z.record(z.string(), z.any()).default({}),
});
export type ThreatIntelProviderPayload = z.infer<typeof threatIntelProviderPayloadSchema>;

export interface ThreatIntelResult {
  id: string;
  ioc: string;
  iocType: string;
  provider: string | null;
  providerType: string | null;
  verdict: string;
  score: number | null;
  detail: string;
  link: string | null;
  checkedAt: string;
  checkedBy: string | null;
  cached: boolean;
}
