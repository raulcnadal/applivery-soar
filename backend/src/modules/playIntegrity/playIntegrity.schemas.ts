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
 *
 * `privateKeyPem`/`privateKeyPassphrase`/`encryptedResponseFile` — an
 * earlier version of this schema had the admin paste/upload the decryption
 * and verification keys directly as base64 strings. That was wrong: Play
 * Console's "Manage and download my response encryption keys" flow (the
 * ONLY way to get an offline-decryptable key pair — the alternative,
 * Google-hosted decryption, doesn't apply here) never hands out those keys
 * directly. Instead the admin generates their own RSA-2048 key pair
 * locally, uploads the PUBLIC half to Play Console, and Play Console
 * encrypts the real decryption/verification keys with that RSA public key
 * (RSA-OAEP) before letting the admin download the ciphertext (commonly
 * named `api_keys.enc` — always exactly 256 bytes, the RSA-2048 block size,
 * regardless of key content). Google's own documented recovery command is:
 *
 *   openssl pkeyutl -decrypt -inkey private.pem \
 *       -pkeyopt rsa_padding_mode:oaep -in api_keys.enc > api_keys.txt
 *
 * — whose plaintext output is `DECRYPTION_KEY=...\nVERIFICATION_KEY=...\n`.
 * playIntegrity.service.ts's setPlayIntegrityConfig replicates that exact
 * openssl invocation server-side (Node's `crypto.privateDecrypt` with
 * RSA_PKCS1_OAEP_PADDING — OpenSSL's own default OAEP/MGF1 digest when
 * `rsa_padding_mode:oaep` is given with no explicit `rsa_oaep_md` is
 * SHA-1, so that's what's used here too) and extracts the two resulting
 * key values, storing THOSE — never the RSA private key or passphrase,
 * which are used once for this one-time decrypt and then discarded.
 * `privateKeyPassphrase` is optional because `openssl genrsa` only
 * passphrase-protects the private key when told to (e.g. `-aes128`); a
 * key generated without that flag has an empty passphrase.
 */
export const playIntegrityConfigPayloadSchema = z.object({
  cloudProjectNumber: z.string().trim().regex(/^\d+$/, "Cloud Project Number must be numeric — the GCP Project Number from console.cloud.google.com, not the Project ID."),
  privateKeyPem: z.string().trim().min(1, "The RSA private key (.pem) you generated locally is required."),
  privateKeyPassphrase: z.string().optional(),
  // Base64 of the raw .enc file's bytes (RSA-OAEP ciphertext) — encoded
  // client-side purely as a JSON transport convenience, not a meaningful
  // format choice; decrypted server-side as raw bytes.
  encryptedResponseFile: z.string().trim().min(1, "The encrypted response file (.enc) downloaded from Play Console is required."),
  enabled: z.boolean().default(true),
});
export type PlayIntegrityConfigPayload = z.infer<typeof playIntegrityConfigPayloadSchema>;
