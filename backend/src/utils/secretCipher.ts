import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { env } from "../config/env";

/**
 * AES-256-GCM encryption for secrets at rest — the Node equivalent of the
 * original app's Fernet-based encryption (ARCHITECTURE.md §2.6/§3 "Adding a
 * new feature" pattern), keyed off DASHBOARD_SECRET so no separate key
 * management is introduced. Used for: Integration.config secret fields,
 * ThreatIntelProvider.config apiKey, LogExportDestination.config secrets,
 * AutomationCredential tokens, DeviceReportSecret.secret, VulnServiceConfig.apiToken.
 *
 * Output format: "<ivHex>:<authTagHex>:<ciphertextHex>" — a single string so
 * it drops straight into a Prisma `String` column.
 */

const ALGORITHM = "aes-256-gcm";
const KEY = scryptSync(env.dashboardSecret, "applivery-soar-secret-cipher", 32);

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(encoded: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted secret payload");
  }
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
