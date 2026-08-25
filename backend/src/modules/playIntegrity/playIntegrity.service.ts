import { createPublicKey, randomBytes } from "crypto";
import { compactDecrypt, compactVerify } from "jose";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";
import { HttpError } from "../../utils/httpError";
import type { PlayIntegrityConfigPayload } from "./playIntegrity.schemas";

/**
 * Google Play Integrity API — device-security-telemetry roadmap Phase 3.
 * Admin-provided per workspace (Settings > Google Play Integrity API,
 * playIntegrity.controller.ts) rather than a single hardcoded value: each
 * workspace's Android app is its own distinct GCP-linked Play Console
 * listing, with its own Cloud Project Number and its own downloaded
 * offline-decryption key pair (Play Console > App integrity > Response
 * encryption). This module implements Google's "Classic API request" +
 * "decrypt and verify locally" path
 * (developer.android.com/google/play/integrity/classic) — explicitly the
 * path the admin asked for over Google-hosted server verification, since it
 * requires no outbound per-token call to Google at request time.
 *
 * End-to-end flow:
 * 1. Android agent calls GET /api/device-data/play-integrity/nonce
 *    (deviceData.controller.ts, mTLS-gated) — issueNonce below.
 * 2. Agent calls the Play Integrity Classic API on-device with that nonce +
 *    cloudProjectNumber, gets back a signed/encrypted token (never decoded
 *    on-device — see verifyAndDecodeToken's own doc comment for why).
 * 3. Agent includes the raw token as `playIntegrityToken` on its next
 *    POST /api/device-data/report call.
 * 4. reportDeviceData (deviceData.service.ts) calls verifyAndDecodeToken
 *    and merges the derived, ALREADY-VERIFIED attributes
 *    (`playIntegrityVerdict`/`playIntegrityAppRecognized`) into the same
 *    self-reported attributes bag every other telemetry signal uses — no
 *    new condition type needed in the Policy Builder, just two more
 *    selfReportedAttribute names (complianceFields.ts).
 */

const NONCE_BYTES = 32;
// 10 minutes: generous against Play Integrity's own documented Classic-
// request latency ("a few seconds", plus normal network/queueing slack),
// tight enough that a captured nonce is useless shortly after issuance.
const NONCE_MAX_AGE_MS = 10 * 60 * 1000;

export interface PlayIntegrityStatus {
  configured: boolean;
  enabled: boolean;
  cloudProjectNumber: string | null;
  configuredBy: string | null;
  configuredAt: string | null;
}

export async function getPlayIntegrityStatus(workspaceSlug: string): Promise<PlayIntegrityStatus> {
  const entry = await prisma.playIntegrityConfig.findUnique({ where: { workspaceSlug } });
  if (!entry) return { configured: false, enabled: false, cloudProjectNumber: null, configuredBy: null, configuredAt: null };
  return {
    configured: true,
    enabled: entry.enabled,
    cloudProjectNumber: entry.cloudProjectNumber,
    configuredBy: entry.configuredBy,
    configuredAt: entry.configuredAt?.toISOString() ?? null,
  };
}

function decodeBase64KeyOrThrow(base64: string, label: string): Buffer {
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw new HttpError(400, `${label} isn't valid base64.`);
  return buf;
}

/**
 * Confirms the pasted key pair at least DECODES/PARSES correctly right at
 * save time — same "fail loudly here, not on the next real device report"
 * reasoning as automationCredential.service.ts's
 * assertServiceAccountTokenWorks. This can't confirm the pair is actually
 * the RIGHT one for this workspace's Play Console listing (there's no way
 * to test that without a real device-issued token to decrypt), only that
 * what was pasted is structurally a 32-byte AES key and a valid DER-encoded
 * EC public key.
 */
export async function setPlayIntegrityConfig(workspaceSlug: string, payload: PlayIntegrityConfigPayload, actorEmail: string): Promise<void> {
  const decryptionKeyBytes = decodeBase64KeyOrThrow(payload.decryptionKey, "Decryption key");
  if (decryptionKeyBytes.length !== 32) {
    throw new HttpError(400, `Decryption key must decode to 32 bytes (AES-256) — got ${decryptionKeyBytes.length}. Re-copy it from Play Console's App integrity > Response encryption section.`);
  }
  const verificationKeyBytes = decodeBase64KeyOrThrow(payload.verificationKey, "Verification key");
  try {
    createPublicKey({ key: verificationKeyBytes, format: "der", type: "spki" });
  } catch {
    throw new HttpError(400, "Verification key isn't a valid DER-encoded EC public key — re-copy it from Play Console's App integrity > Response encryption section.");
  }

  const now = new Date();
  await prisma.playIntegrityConfig.upsert({
    where: { workspaceSlug },
    create: {
      workspaceSlug,
      cloudProjectNumber: payload.cloudProjectNumber,
      decryptionKey: encryptSecret(payload.decryptionKey),
      verificationKey: payload.verificationKey,
      enabled: payload.enabled,
      configuredBy: actorEmail,
      configuredAt: now,
    },
    update: {
      cloudProjectNumber: payload.cloudProjectNumber,
      decryptionKey: encryptSecret(payload.decryptionKey),
      verificationKey: payload.verificationKey,
      enabled: payload.enabled,
      configuredBy: actorEmail,
      configuredAt: now,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "play_integrity_config_set", actor: actorEmail,
    message: `Google Play Integrity API configured for this workspace by ${actorEmail} (Cloud Project ${payload.cloudProjectNumber})`,
  });
}

export async function clearPlayIntegrityConfig(workspaceSlug: string, actorEmail: string): Promise<void> {
  const existing = await prisma.playIntegrityConfig.findUnique({ where: { workspaceSlug } });
  if (!existing) return;
  await prisma.playIntegrityConfig.delete({ where: { workspaceSlug } });
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "play_integrity_config_cleared", actor: actorEmail, severity: "warning",
    message: "Google Play Integrity API configuration removed for this workspace",
  });
}

export interface IssuedNonce {
  nonce: string;
  cloudProjectNumber: string;
}

/**
 * Issued right before the Android agent makes its on-device Classic API
 * requestIntegrityToken call. Google's own nonce guidance
 * (developer.android.com/google/play/integrity/classic#nonce) requires a
 * value that's unpredictable, URL-safe, base64, 16-500 characters, and
 * checked server-side for first-time use — all satisfied here: 32
 * cryptographically random bytes, base64url-encoded (~43 chars), stored
 * once, consumed exactly once by verifyAndDecodeToken below.
 */
export async function issueNonce(workspaceSlug: string, serialNumber: string): Promise<IssuedNonce> {
  const config = await prisma.playIntegrityConfig.findUnique({ where: { workspaceSlug } });
  if (!config || !config.enabled) {
    throw new HttpError(503, "Google Play Integrity API isn't configured for this workspace yet — ask your Applivery admin to set it up under Settings.");
  }
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  await prisma.playIntegrityNonce.create({ data: { workspaceSlug, serialNumber, nonce } });
  return { nonce, cloudProjectNumber: config.cloudProjectNumber };
}

export interface PlayIntegrityDerivedAttributes {
  playIntegrityVerdict: string;
  playIntegrityAppRecognized: boolean;
}

// Highest-to-lowest — MEETS_VIRTUAL_INTEGRITY (an emulator Google itself
// vouches for via Play Protect) is listed last since it's a distinct device
// class flag, not strictly a "better" security tier than MEETS_BASIC_INTEGRITY.
const DEVICE_VERDICT_PRIORITY = ["MEETS_STRONG_INTEGRITY", "MEETS_DEVICE_INTEGRITY", "MEETS_BASIC_INTEGRITY", "MEETS_VIRTUAL_INTEGRITY"];

/**
 * `deviceRecognitionVerdict` is an array (a device can meet multiple
 * thresholds at once — meeting STRONG implies meeting DEVICE and BASIC
 * too). Collapsed to the single highest tier reached, matching how the
 * reference guidance for this rollout put it: "Enforce Strict Thresholds:
 * require MEETS_DEVICE_INTEGRITY at minimum" — a single comparable string
 * is what a selfReportedAttribute equals/notEquals condition needs. An
 * empty array (Google's own docs: "high probability the device is rooted,
 * running Magisk/KernelSU, modified with Xposed, or spoofing system
 * properties") becomes "NONE".
 */
function bestDeviceVerdict(verdicts: unknown): string {
  if (!Array.isArray(verdicts) || verdicts.length === 0) return "NONE";
  for (const candidate of DEVICE_VERDICT_PRIORITY) {
    if (verdicts.includes(candidate)) return candidate;
  }
  return "UNKNOWN";
}

/**
 * Decrypts + verifies a Classic API integrity token entirely within this
 * backend — Google's "decrypt and verify locally" path, and specifically
 * never on the device: Google's own guidance is explicit that a rooted
 * device (Magisk/Xposed) can hook the app binary and fake a passing
 * verdict, so decoding must happen somewhere the device itself can't
 * influence. The token is a nested JWT — JWE (A256KW key-wrap + A256GCM
 * content encryption) of JWS (ES256); `jose` (already an audited, widely
 * used JOSE implementation) handles both compact-serialization steps.
 *
 * Best-effort by design: called from inside reportDeviceData's attribute
 * merge (deviceData.service.ts), which also carries other legitimate
 * self-reported attributes in the same call — a Play Integrity failure
 * (misconfigured keys, expired/reused nonce, malformed token) must never
 * throw and lose the rest of that report. Returns null on any failure,
 * each logged via console.warn for operability, never surfaced to the
 * reporting device (which only ever sees whether the overall report call
 * itself succeeded).
 */
export async function verifyAndDecodeToken(workspaceSlug: string, serialNumber: string, rawToken: string): Promise<PlayIntegrityDerivedAttributes | null> {
  const config = await prisma.playIntegrityConfig.findUnique({ where: { workspaceSlug } });
  if (!config || !config.enabled) return null;

  let payload: any;
  try {
    const decryptionKey = Buffer.from(decryptSecret(config.decryptionKey), "base64");
    const { plaintext } = await compactDecrypt(rawToken, decryptionKey);
    const compactJws = new TextDecoder().decode(plaintext);

    const verificationKey = createPublicKey({ key: Buffer.from(config.verificationKey, "base64"), format: "der", type: "spki" });
    const { payload: jwsPayload } = await compactVerify(compactJws, verificationKey);
    payload = JSON.parse(new TextDecoder().decode(jwsPayload));
  } catch (e) {
    console.warn(`[PlayIntegrity] Token decrypt/verify failed for workspace '${workspaceSlug}', serial '${serialNumber}': ${e}`);
    return null;
  }

  const tokenNonce = payload?.requestDetails?.nonce;
  if (typeof tokenNonce !== "string" || !tokenNonce) {
    console.warn(`[PlayIntegrity] Verified token for '${serialNumber}' (workspace '${workspaceSlug}') had no requestDetails.nonce — discarding.`);
    return null;
  }

  const nonceRow = await prisma.playIntegrityNonce.findUnique({ where: { nonce: tokenNonce } });
  const nonceOk = Boolean(
    nonceRow &&
      nonceRow.workspaceSlug === workspaceSlug &&
      nonceRow.serialNumber === serialNumber &&
      !nonceRow.consumedAt &&
      Date.now() - nonceRow.issuedAt.getTime() <= NONCE_MAX_AGE_MS,
  );

  // Consumed regardless of the outcome above — a nonce that fails a
  // replay/binding check here must never become usable on a later, better-
  // crafted attempt either.
  if (nonceRow && !nonceRow.consumedAt) {
    await prisma.playIntegrityNonce.update({ where: { id: nonceRow.id }, data: { consumedAt: new Date() } });
  }

  if (!nonceOk) {
    console.warn(`[PlayIntegrity] Nonce check failed for '${serialNumber}' (workspace '${workspaceSlug}') — rejecting a verified-but-unbound, expired, or replayed token.`);
    return null;
  }

  return {
    playIntegrityVerdict: bestDeviceVerdict(payload?.deviceIntegrity?.deviceRecognitionVerdict),
    playIntegrityAppRecognized: payload?.appIntegrity?.appRecognitionVerdict === "PLAY_RECOGNIZED",
  };
}
