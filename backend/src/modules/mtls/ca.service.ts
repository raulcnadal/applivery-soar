import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";
import {
  generateCertificateAuthority,
  validateUploadedCaPair,
  MTLS_KEY_ALGORITHM,
  MTLS_LEAF_VALIDITY_DAYS_DEFAULT,
  MTLS_LEAF_VALIDITY_DAYS_FLOOR,
} from "../../utils/mtlsPki";

/**
 * The workspace's mTLS Certificate Authority — see
 * backend/docs/mtls-agent-auth-roadmap.md §0/§2/§8. SOAR generates and holds
 * the CA by default; an admin may instead upload an external one. Either
 * way, the private key is encrypted at rest (secretCipher, same as every
 * other secret this app stores) and is NEVER returned by any status/list
 * endpoint — only issuance code paths (register/renew) ever decrypt it.
 */

export interface CaStatus {
  configured: boolean;
  source?: "generated" | "uploaded";
  keyAlgorithm?: string;
  leafValidityDays?: number;
  notBefore?: string;
  notAfter?: string;
  uploadedBy?: string | null;
  certPem?: string; // public cert only — safe to expose, agents/proxies need it
  updatedAt?: string;
}

export async function getCaStatus(workspaceSlug: string): Promise<CaStatus> {
  const row = await prisma.certificateAuthority.findUnique({ where: { workspaceSlug } });
  if (!row) return { configured: false };
  return {
    configured: true,
    source: row.source as "generated" | "uploaded",
    keyAlgorithm: row.keyAlgorithm,
    leafValidityDays: row.leafValidityDays,
    notBefore: row.notBefore.toISOString(),
    notAfter: row.notAfter.toISOString(),
    uploadedBy: row.uploadedBy,
    certPem: row.certPem,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertReplaceConfirmed(workspaceSlug: string, confirmReplace: boolean): Promise<void> {
  const existing = await prisma.certificateAuthority.findUnique({ where: { workspaceSlug } });
  if (existing && !confirmReplace) {
    throw new HttpError(409, "A CA is already configured for this workspace. Replacing it invalidates every currently-issued device certificate's chain of trust — pass confirmReplace: true to proceed anyway.");
  }
}

export async function generateCa(workspaceSlug: string, actor: string, confirmReplace: boolean): Promise<CaStatus> {
  await assertReplaceConfirmed(workspaceSlug, confirmReplace);

  const generated = await generateCertificateAuthority(workspaceSlug);
  await prisma.certificateAuthority.upsert({
    where: { workspaceSlug },
    create: {
      workspaceSlug,
      certPem: generated.certPem,
      privateKeyPem: encryptSecret(generated.privateKeyPem),
      keyAlgorithm: MTLS_KEY_ALGORITHM,
      source: "generated",
      serialCounter: 1,
      leafValidityDays: MTLS_LEAF_VALIDITY_DAYS_DEFAULT,
      notBefore: generated.notBefore,
      notAfter: generated.notAfter,
    },
    update: {
      certPem: generated.certPem,
      privateKeyPem: encryptSecret(generated.privateKeyPem),
      keyAlgorithm: MTLS_KEY_ALGORITHM,
      source: "generated",
      serialCounter: 1,
      leafValidityDays: MTLS_LEAF_VALIDITY_DAYS_DEFAULT,
      notBefore: generated.notBefore,
      notAfter: generated.notAfter,
      uploadedBy: null,
    },
  });

  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_ca_generated",
    actor,
    severity: "warning",
    message: `mTLS Certificate Authority generated for this workspace by ${actor}. Every previously-issued device certificate's chain of trust is now invalid.`,
  });

  return getCaStatus(workspaceSlug);
}

export async function uploadCa(workspaceSlug: string, actor: string, certPem: string, privateKeyPem: string, confirmReplace: boolean): Promise<CaStatus> {
  await assertReplaceConfirmed(workspaceSlug, confirmReplace);

  const validation = await validateUploadedCaPair(certPem, privateKeyPem);
  if (!validation.ok) {
    throw new HttpError(400, validation.error ?? "The uploaded CA certificate/private key pair is invalid.");
  }

  await prisma.certificateAuthority.upsert({
    where: { workspaceSlug },
    create: {
      workspaceSlug,
      certPem,
      privateKeyPem: encryptSecret(privateKeyPem),
      keyAlgorithm: MTLS_KEY_ALGORITHM,
      source: "uploaded",
      serialCounter: 1,
      leafValidityDays: MTLS_LEAF_VALIDITY_DAYS_DEFAULT,
      notBefore: validation.notBefore!,
      notAfter: validation.notAfter!,
      uploadedBy: actor,
    },
    update: {
      certPem,
      privateKeyPem: encryptSecret(privateKeyPem),
      keyAlgorithm: MTLS_KEY_ALGORITHM,
      source: "uploaded",
      serialCounter: 1,
      leafValidityDays: MTLS_LEAF_VALIDITY_DAYS_DEFAULT,
      notBefore: validation.notBefore!,
      notAfter: validation.notAfter!,
      uploadedBy: actor,
    },
  });

  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_ca_uploaded",
    actor,
    severity: "warning",
    message: `mTLS Certificate Authority replaced with an uploaded cert/key pair for this workspace by ${actor}. Every previously-issued device certificate's chain of trust is now invalid.`,
  });

  return getCaStatus(workspaceSlug);
}

export async function setLeafValidityDays(workspaceSlug: string, actor: string, days: number): Promise<CaStatus> {
  if (days < MTLS_LEAF_VALIDITY_DAYS_FLOOR) {
    throw new HttpError(400, `Leaf certificate validity can't be set below ${MTLS_LEAF_VALIDITY_DAYS_FLOOR} days.`);
  }
  const existing = await prisma.certificateAuthority.findUnique({ where: { workspaceSlug } });
  if (!existing) {
    throw new HttpError(503, "No CA is configured for this workspace yet — generate or upload one first.");
  }
  await prisma.certificateAuthority.update({ where: { workspaceSlug }, data: { leafValidityDays: days } });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_leaf_validity_updated",
    actor,
    message: `mTLS leaf certificate validity window set to ${days} days by ${actor}.`,
  });
  return getCaStatus(workspaceSlug);
}

/** Internal-only — decrypts the CA private key. Never call this from anything but the register/renew signing path. */
export async function getCaForSigning(workspaceSlug: string): Promise<{ certPem: string; privateKeyPem: string; leafValidityDays: number } | null> {
  const row = await prisma.certificateAuthority.findUnique({ where: { workspaceSlug } });
  if (!row) return null;
  return { certPem: row.certPem, privateKeyPem: decryptSecret(row.privateKeyPem), leafValidityDays: row.leafValidityDays };
}

/**
 * Atomically claims the next leaf-certificate serial number for this
 * workspace's CA — a single UPDATE...RETURNING under Postgres row-level
 * locking, so concurrent register/renew calls can never collide on the same
 * serial without needing an explicit transaction wrapper.
 */
export async function claimNextSerial(workspaceSlug: string): Promise<number> {
  const updated = await prisma.certificateAuthority.update({
    where: { workspaceSlug },
    data: { serialCounter: { increment: 1 } },
  });
  return updated.serialCounter - 1;
}
