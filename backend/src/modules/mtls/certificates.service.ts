import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";

/**
 * Issued device certificates — the fleet-migration/status dashboard an admin
 * uses to know when it's safe to flip the cutover (roadmap §7), and the
 * table verifyMtlsIdentity (middleware/mtlsIdentity.middleware.ts) consults
 * on every mTLS-gated request.
 */

export interface CertificateStatus {
  id: string;
  serialNumber: string;
  serialHex: string;
  status: "active" | "expiring-soon" | "expired" | "revoked" | "superseded";
  notBefore: string;
  notAfter: string;
  supersededAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  issuedAt: string;
}

const EXPIRING_SOON_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — a coarse dashboard signal, independent of any given CA's configured renewal-trigger fraction

function computeStatus(row: { notAfter: Date; supersededAt: Date | null; revokedAt: Date | null }): CertificateStatus["status"] {
  if (row.revokedAt) return "revoked";
  if (row.supersededAt) return "superseded";
  const now = Date.now();
  if (row.notAfter.getTime() < now) return "expired";
  if (row.notAfter.getTime() - now < EXPIRING_SOON_WINDOW_MS) return "expiring-soon";
  return "active";
}

export async function listCertificates(workspaceSlug: string): Promise<CertificateStatus[]> {
  const rows = await prisma.deviceCertificate.findMany({
    where: { workspaceSlug },
    orderBy: { issuedAt: "desc" },
  });
  return rows.map((row: (typeof rows)[number]) => ({
    id: row.id,
    serialNumber: row.serialNumber,
    serialHex: row.serialHex,
    status: computeStatus(row),
    notBefore: row.notBefore.toISOString(),
    notAfter: row.notAfter.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedReason: row.revokedReason,
    issuedAt: row.issuedAt.toISOString(),
  }));
}

export async function issueCertificateRecord(params: {
  workspaceSlug: string;
  serialNumber: string;
  serialHex: string;
  certPem: string;
  notBefore: Date;
  notAfter: Date;
}): Promise<void> {
  await prisma.deviceCertificate.create({
    data: {
      workspaceSlug: params.workspaceSlug,
      serialNumber: params.serialNumber,
      serialHex: params.serialHex,
      certPem: params.certPem,
      notBefore: params.notBefore,
      notAfter: params.notAfter,
    },
  });
}

/** Marks every currently-active (not already superseded/revoked) cert for a device as superseded — called right after a renewal successfully issues its replacement. */
export async function supersedeActiveCertificates(workspaceSlug: string, serialNumber: string): Promise<void> {
  await prisma.deviceCertificate.updateMany({
    where: { workspaceSlug, serialNumber, supersededAt: null, revokedAt: null },
    data: { supersededAt: new Date() },
  });
}

/**
 * The identity lookup verifyMtlsIdentity performs on every mTLS-gated
 * request: is there a currently valid (not revoked, not expired), currently
 * issued (not superseded — a renewed-away cert should stop authenticating
 * even if it technically hasn't expired yet) certificate for this CN?
 */
export async function findActiveCertificate(workspaceSlug: string, serialNumber: string): Promise<{ id: string } | null> {
  const row = await prisma.deviceCertificate.findFirst({
    where: {
      workspaceSlug,
      serialNumber,
      revokedAt: null,
      supersededAt: null,
      notAfter: { gt: new Date() },
    },
  });
  return row ? { id: row.id } : null;
}

/**
 * Like findActiveCertificate, but also returns the cert material itself —
 * used by mtlsEnrollment.service.ts's poll endpoint (Phase E) to hand a
 * device its own just-approved certificate. Deliberately a separate
 * function from findActiveCertificate (used by assertMtlsIdentity on every
 * mTLS-gated request) rather than widening that one's return shape, to keep
 * the security-critical identity-check path's surface area minimal.
 */
export async function getActiveCertificateMaterial(workspaceSlug: string, serialNumber: string): Promise<{ certPem: string; notAfter: string } | null> {
  const row = await prisma.deviceCertificate.findFirst({
    where: { workspaceSlug, serialNumber, revokedAt: null, supersededAt: null, notAfter: { gt: new Date() } },
    orderBy: { issuedAt: "desc" },
  });
  return row ? { certPem: row.certPem, notAfter: row.notAfter.toISOString() } : null;
}

export async function revokeCertificate(workspaceSlug: string, id: string, actor: string, reason: string): Promise<void> {
  const row = await prisma.deviceCertificate.findUnique({ where: { id } });
  if (!row || row.workspaceSlug !== workspaceSlug) {
    throw new HttpError(404, "Certificate not found.");
  }
  if (row.revokedAt) {
    throw new HttpError(400, "This certificate is already revoked.");
  }
  await prisma.deviceCertificate.update({
    where: { id },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_certificate_revoked",
    actor,
    severity: "warning",
    targetType: "device",
    targetId: row.serialNumber,
    message: `mTLS device certificate for '${row.serialNumber}' revoked by ${actor}: ${reason}`,
  });
}
