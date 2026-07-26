import { decryptSecret } from "../utils/secretCipher";

/**
 * Shared helper for reading `WorkspaceState.smtpConfig` back out of storage.
 * `.pass` is encrypted at rest (see dashboardState.controller.ts's POST
 * /api/state) — every reader (GET /api/state, alertEmail.ts, the Reporting
 * scheduler/generate-report pipeline) must decrypt it the same way. Falls
 * back to returning the raw value on decrypt failure so a pre-encryption
 * plaintext row (or an already-plaintext value from a form that never went
 * through this cipher) still reads back usable, matching the original's
 * `_decrypt_secret_migrating` tolerance.
 */
export function decryptSmtpConfig<T extends Record<string, any> | null | undefined>(raw: T): T {
  if (!raw || typeof raw !== "object" || !raw.pass) return raw;
  try {
    return { ...raw, pass: decryptSecret(raw.pass) };
  } catch {
    return raw;
  }
}
