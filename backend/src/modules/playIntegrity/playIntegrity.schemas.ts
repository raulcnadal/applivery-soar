import { z } from "zod";

/**
 * Settings > Google Play Integrity API — admin-provided per workspace (see
 * playIntegrity.service.ts's module doc for why this can't be a single
 * hardcoded value the way an earlier draft of this feature assumed: each
 * workspace's Android app is its own distinct GCP-linked Play Console
 * listing, with its own Cloud Project Number and its own downloaded
 * offline-decryption key pair).
 *
 * `cloudProjectNumber` — digits only, matching Google's own GCP Project
 * Number format (e.g. "55887091184" — never the alphanumeric Project ID).
 * `decryptionKey`/`verificationKey` — base64, exactly as downloaded from
 * Play Console's App integrity > "Response encryption" section (a decrypt
 * + verify key PAIR issued together; Google's own docs note these are
 * base64-encoded using default flags, i.e. standard base64, not
 * base64url). Not re-validated as decodable base64 here — a garbled paste
 * fails loudly and specifically the first time a real token is decrypted
 * with it (playIntegrity.service.ts), which is a clearer error than a
 * generic "invalid base64" at save time.
 */
export const playIntegrityConfigPayloadSchema = z.object({
  cloudProjectNumber: z.string().trim().regex(/^\d+$/, "Cloud Project Number must be numeric — the GCP Project Number from console.cloud.google.com, not the Project ID."),
  decryptionKey: z.string().trim().min(1, "Decryption key is required."),
  verificationKey: z.string().trim().min(1, "Verification key is required."),
  enabled: z.boolean().default(true),
});
export type PlayIntegrityConfigPayload = z.infer<typeof playIntegrityConfigPayloadSchema>;
