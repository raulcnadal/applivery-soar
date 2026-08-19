import { z } from "zod";

/**
 * Port of ThreatIntelProviderPayload (main.py:14228-14235) — originally
 * ["virustotal", "abuseipdb", "hibp", "generic_rest"]. Narrowed to just
 * virustotal: an audit of how Cases actually get created in this product
 * found the automatic IOC-extraction-from-text layer these fed almost never
 * fires (it only ever scans analyst-typed note text, never the structured
 * titles the two automated case sources — compliance violations, workflow
 * triggers — generate), and AbuseIPDB (IP-only)/HIBP (email-only, requires
 * a paid tier)/Generic REST had no other use in this app. VirusTotal stays
 * because its file-hash lookup is the intended engine for a planned
 * separate feature: hashing installed binaries (Windows .exe, macOS .dmg,
 * Android .apk) to flag sideloaded/unverified/malicious software — once the
 * agents actually collect those hashes, which they don't yet.
 */
export const THREAT_INTEL_PROVIDER_TYPES = ["virustotal"] as const;

export const threatIntelProviderPayloadSchema = z.object({
  name: z.string(),
  type: z.string(),
  enabled: z.boolean().default(true),
  // { apiKey }
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
