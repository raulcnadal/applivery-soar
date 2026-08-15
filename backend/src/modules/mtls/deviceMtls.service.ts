import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { signDeviceCsr } from "../../utils/mtlsPki";
import { claimNextSerial, getCaForSigning } from "./ca.service";
import { consumeBootstrapToken } from "./bootstrapTokens.service";
import { issueCertificateRecord, supersedeActiveCertificates } from "./certificates.service";

/**
 * The two agent-facing endpoints of the mTLS system —
 * backend/docs/mtls-agent-auth-roadmap.md §4.1. `register` is the only
 * agent-facing mTLS route that ever runs over plain HTTPS (no client cert
 * exists yet); `renew` always runs behind verifyMtlsIdentity, so by the time
 * this module's `renewDevice` is called the caller has already proven
 * possession of a currently-valid certificate for the serial number it's
 * asking to renew.
 */

export interface IssuedCertificateResponse {
  certPem: string;
  caCertPem: string;
  notAfter: string;
}

async function issueLeaf(workspaceSlug: string, serialNumber: string, csrPem: string): Promise<IssuedCertificateResponse> {
  const ca = await getCaForSigning(workspaceSlug);
  if (!ca) {
    throw new HttpError(503, `No mTLS Certificate Authority is configured for workspace '${workspaceSlug}'. An admin must generate or upload one from Settings before devices can register.`);
  }

  const serialCounter = await claimNextSerial(workspaceSlug);
  const leaf = await signDeviceCsr({
    csrPem,
    forcedCn: serialNumber,
    caCertPem: ca.certPem,
    caPrivateKeyPem: ca.privateKeyPem,
    serialCounter,
    validityDays: ca.leafValidityDays,
  });

  await issueCertificateRecord({
    workspaceSlug,
    serialNumber,
    serialHex: leaf.serialHex,
    certPem: leaf.certPem,
    notBefore: leaf.notBefore,
    notAfter: leaf.notAfter,
  });

  return { certPem: leaf.certPem, caCertPem: ca.certPem, notAfter: leaf.notAfter.toISOString() };
}

/**
 * POST /api/device-mtls/register. Bootstrap-token auth only (no client cert
 * possible yet). The CSR's own claimed CN is never trusted — the issued
 * certificate's CN is always forced to `serialNumber`, and
 * consumeBootstrapToken itself already refused to consume a token that
 * wasn't minted for this exact serialNumber, so a token bound to device A
 * can never result in a certificate for device B.
 */
export async function registerDevice(workspaceSlug: string, params: { csrPem: string; serialNumber: string }, bootstrapToken: string | undefined): Promise<IssuedCertificateResponse> {
  await consumeBootstrapToken(workspaceSlug, params.serialNumber, bootstrapToken);
  const result = await issueLeaf(workspaceSlug, params.serialNumber, params.csrPem);

  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_device_registered",
    actor: "device-agent",
    targetType: "device",
    targetId: params.serialNumber,
    message: `Device '${params.serialNumber}' completed mTLS registration — bootstrap token consumed, client certificate issued (valid until ${result.notAfter}).`,
  });

  return result;
}

/**
 * POST /api/device-mtls/renew. Must only ever be reached behind
 * verifyMtlsIdentity — `verifiedSerialNumber` is the CN the middleware
 * already proved the caller's CURRENT certificate authenticates as. Rejects
 * outright if the request body claims a different device than the one that
 * authenticated the mTLS handshake — a device can only ever renew its own
 * identity, never mint a certificate for a different serial by presenting
 * its own valid cert.
 */
export async function renewDevice(workspaceSlug: string, params: { csrPem: string; serialNumber: string }, verifiedSerialNumber: string): Promise<IssuedCertificateResponse> {
  if (params.serialNumber !== verifiedSerialNumber) {
    throw new HttpError(403, `mTLS identity (${verifiedSerialNumber}) does not match the serialNumber in the renewal request (${params.serialNumber}).`);
  }

  // Order matters here: supersede the OLD cert(s) first, then issue the new
  // one. supersedeActiveCertificates matches on `supersededAt: null` — doing
  // this the other way around would also catch (and immediately supersede)
  // the brand-new row issueLeaf just created.
  await supersedeActiveCertificates(workspaceSlug, params.serialNumber);
  const result = await issueLeaf(workspaceSlug, params.serialNumber, params.csrPem);

  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_device_renewed",
    actor: "device-agent",
    targetType: "device",
    targetId: params.serialNumber,
    message: `Device '${params.serialNumber}' renewed its mTLS client certificate (valid until ${result.notAfter}).`,
  });

  return result;
}
