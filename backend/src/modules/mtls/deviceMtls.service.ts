import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { signDeviceCsr } from "../../utils/mtlsPki";
import { claimNextSerial, getCaForSigning } from "./ca.service";
import { getGlobalBootstrapTokenStatus } from "./globalBootstrapToken.service";
import { findActiveCertificate, issueCertificateRecord, supersedeActiveCertificates } from "./certificates.service";

/**
 * The two agent-facing endpoints of the mTLS system —
 * backend/docs/mtls-agent-auth-roadmap.md §4.1 + the Global Bootstrap Token
 * addendum. `register` is the only agent-facing mTLS route that ever runs
 * over plain HTTPS (no client cert exists yet); `renew` always runs behind
 * verifyMtlsIdentity, so by the time this module's `renewDevice` is called
 * the caller has already proven possession of a currently-valid certificate
 * for the serial number it's asking to renew.
 */

export interface IssuedCertificateResponse {
  certPem: string;
  caCertPem: string;
  notAfter: string;
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return cryptoTimingSafeEqual(bufA, bufB);
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
 * SECURITY MODEL — read this before touching registerDevice below. A device
 * proves it's allowed to register with TWO factors, neither of them a
 * per-device secret:
 *   1. The single, workspace-wide GlobalBootstrapToken (not per-device, not
 *      one-time — deployed identically to the whole fleet via one Managed
 *      Configuration push, same delivery mechanism as the legacy
 *      X-Device-Report-Secret).
 *   2. Its claimed serial number is CURRENTLY a known, enrolled device in
 *      this workspace's live Applivery UEM fleet (assertKnownApplivertyDevice
 *      below).
 * A serial number is not a secret (printed on the device, often in asset
 * spreadsheets) — anyone who obtains the token and a currently-enrolled
 * serial number could request a certificate for it. One hard backstop bounds
 * that exposure: a serial number that already has an ACTIVE certificate can
 * never be silently re-claimed (assertNotAlreadyActive) — only an admin
 * revoking it first opens the door again, so the worst a leaked token
 * enables is claiming a NOT-YET-enrolled device before its real owner does,
 * never stealing an already-enrolled device's identity. Unlike the retired
 * Phase E "self-service" addendum, there is no approval-queue mode here —
 * a bootstrap token is unattended by design; the two checks above are the
 * whole gate.
 */
async function verifyGlobalBootstrapToken(workspaceSlug: string, provided: string | undefined): Promise<void> {
  const status = await getGlobalBootstrapTokenStatus(workspaceSlug);
  if (!status.configured || !status.secret) {
    throw new HttpError(503, `No global bootstrap token is configured for workspace '${workspaceSlug}'. Generate one from Settings > mTLS Agent Authentication before devices can register.`);
  }
  if (!provided || !timingSafeEqual(provided, status.secret)) {
    throw new HttpError(401, "Invalid bootstrap token.");
  }
}

async function assertNotAlreadyActive(workspaceSlug: string, serialNumber: string): Promise<void> {
  const active = await findActiveCertificate(workspaceSlug, serialNumber);
  if (active) {
    throw new HttpError(409, `Device '${serialNumber}' already has an active mTLS certificate — an admin must revoke it first before this device can re-register.`);
  }
}

/**
 * The identity attestation this whole path relies on in place of a
 * cryptographic per-device secret — see the SECURITY MODEL doc above for
 * what this does and does NOT prove.
 */
async function assertKnownApplivertyDevice(workspaceSlug: string, serialNumber: string): Promise<{ displayName: string | null }> {
  const { getAutomationBearer } = await import("../settings/automationCredential.service");
  const bearer = await getAutomationBearer(workspaceSlug);
  if (!bearer) {
    throw new HttpError(503, "No Automation Credential configured for this workspace — device registration can't verify device identity against Applivery without one.");
  }
  const { getDevicesFull } = await import("../devices/devices.service");
  const devicesResp = await getDevicesFull(bearer, workspaceSlug, false);
  const match = devicesResp.items.find((d: any) => d.serialNumber === serialNumber);
  if (!match) {
    throw new HttpError(403, `Serial number '${serialNumber}' is not a currently-enrolled device in this workspace's Applivery fleet.`);
  }
  return { displayName: match.displayName || null };
}

/**
 * POST /api/device-mtls/register. Bootstrap-token auth only (no client cert
 * possible yet). The CSR's own claimed CN is never trusted — the issued
 * certificate's CN is always forced to `serialNumber`.
 */
export async function registerDevice(workspaceSlug: string, params: { csrPem: string; serialNumber: string }, bootstrapToken: string | undefined): Promise<IssuedCertificateResponse> {
  await verifyGlobalBootstrapToken(workspaceSlug, bootstrapToken);
  await assertNotAlreadyActive(workspaceSlug, params.serialNumber);
  const { displayName } = await assertKnownApplivertyDevice(workspaceSlug, params.serialNumber);
  const result = await issueLeaf(workspaceSlug, params.serialNumber, params.csrPem);

  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_device_registered",
    actor: "device-agent",
    targetType: "device",
    targetId: params.serialNumber,
    message: `Device '${params.serialNumber}'${displayName ? ` (${displayName})` : ""} completed mTLS registration via the global bootstrap token — client certificate issued, valid until ${result.notAfter}.`,
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
