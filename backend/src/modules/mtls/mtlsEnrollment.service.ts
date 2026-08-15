import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { getEnrollmentSecretStatus, getSelfServiceMode } from "./enrollmentSecret.service";
import { findActiveCertificate, getActiveCertificateMaterial } from "./certificates.service";
import { getCaStatus } from "./ca.service";
import { issueLeaf, type IssuedCertificateResponse } from "./deviceMtls.service";

/**
 * Self-service enrollment (Phase E addendum) — POST /api/device-mtls/enroll
 * and its poll counterpart. Requested directly by the admin as the practical
 * alternative to DeviceBootstrapToken once it became clear there's no way to
 * deliver a unique per-device secret through Applivery's own Managed
 * Configuration (its interpolation only exposes Applivery's own built-in
 * fields — see enrollmentSecret.service.ts's module doc).
 *
 * SECURITY MODEL — read this before touching anything below. A device here
 * proves it's allowed to enroll with TWO factors instead of one:
 *   1. The shared EnrollmentSecret (workspace-wide, not one-time, not
 *      device-bound — deployed identically to the whole fleet).
 *   2. Its claimed serial number is CURRENTLY a known, enrolled device in
 *      this workspace's live Applivery UEM fleet (assertKnownApplivertyDevice
 *      below).
 * This is a strictly weaker guarantee than DeviceBootstrapToken's, which
 * needs neither a live Applivery lookup nor a shared secret an attacker
 * might obtain — bootstrap tokens are one-time and cryptographically bound
 * to exactly one serial number at mint time. A serial number is not a
 * secret (printed on the device, often in asset spreadsheets); anyone who
 * ever obtains the shared EnrollmentSecret and a currently-enrolled serial
 * number can request a certificate for it. Two things bound that exposure:
 *   - mtlsSelfServiceMode defaults to "disabled" — this whole path is opt-in.
 *   - A serial number that already has an ACTIVE certificate can never be
 *     silently re-claimed (assertNotAlreadyActive below) — only an admin
 *     revoking it first opens the door again, so the worst a leaked secret
 *     can do is claim a NOT-YET-enrolled device before its real owner does,
 *     never steal an already-enrolled device's identity.
 *   - "approval" mode (the recommended default) puts a human in the loop
 *     for every single request; "silent" mode is available for admins who
 *     accept the trade-off in exchange for true zero-touch.
 */

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return cryptoTimingSafeEqual(bufA, bufB);
}

async function verifyEnrollmentSecret(workspaceSlug: string, provided: string | undefined): Promise<void> {
  const status = await getEnrollmentSecretStatus(workspaceSlug);
  if (!status.configured || !status.secret) {
    throw new HttpError(503, "Self-service enrollment has no secret configured for this workspace.");
  }
  if (!provided || !timingSafeEqual(provided, status.secret)) {
    throw new HttpError(401, "Invalid enrollment secret.");
  }
}

async function assertNotAlreadyActive(workspaceSlug: string, serialNumber: string): Promise<void> {
  const active = await findActiveCertificate(workspaceSlug, serialNumber);
  if (active) {
    throw new HttpError(409, `Device '${serialNumber}' already has an active mTLS certificate — an admin must revoke it first before this device can self-service re-enroll.`);
  }
}

/**
 * The identity attestation this whole path relies on in place of a
 * cryptographic per-device secret — see the module doc's SECURITY MODEL
 * section above for what this does and does NOT prove.
 */
async function assertKnownApplivertyDevice(workspaceSlug: string, serialNumber: string): Promise<{ displayName: string | null }> {
  const { getAutomationBearer } = await import("../settings/automationCredential.service");
  const bearer = await getAutomationBearer(workspaceSlug);
  if (!bearer) {
    throw new HttpError(503, "No Automation Credential configured for this workspace — self-service enrollment can't verify device identity against Applivery without one.");
  }
  const { getDevicesFull } = await import("../devices/devices.service");
  const devicesResp = await getDevicesFull(bearer, workspaceSlug, false);
  const match = devicesResp.items.find((d: any) => d.serialNumber === serialNumber);
  if (!match) {
    throw new HttpError(403, `Serial number '${serialNumber}' is not a currently-enrolled device in this workspace's Applivery fleet.`);
  }
  return { displayName: match.displayName || null };
}

export type EnrollResult = ({ status: "issued" } & IssuedCertificateResponse) | { status: "pending"; requestId: string };

export async function requestEnrollment(
  workspaceSlug: string,
  params: { csrPem: string; serialNumber: string; platform?: string },
  providedSecret: string | undefined,
): Promise<EnrollResult> {
  const mode = await getSelfServiceMode(workspaceSlug);
  if (mode === "disabled") {
    throw new HttpError(404, "Self-service enrollment is not enabled for this workspace.");
  }
  await verifyEnrollmentSecret(workspaceSlug, providedSecret);
  await assertNotAlreadyActive(workspaceSlug, params.serialNumber);
  const { displayName } = await assertKnownApplivertyDevice(workspaceSlug, params.serialNumber);

  if (mode === "silent") {
    const result = await issueLeaf(workspaceSlug, params.serialNumber, params.csrPem);
    await recordAuditEvent(workspaceSlug, {
      category: "settings",
      action: "mtls_self_service_enrolled",
      actor: "device-agent",
      severity: "warning",
      targetType: "device",
      targetId: params.serialNumber,
      message: `Device '${params.serialNumber}' self-service enrolled (silent mode, no admin approval) — client certificate issued, valid until ${result.notAfter}.`,
    });
    return { status: "issued", ...result };
  }

  // "approval" mode. Upserted on (workspaceSlug, serialNumber, "pending") so
  // a retrying/polling agent reuses the same row — the update branch also
  // refreshes csrPem/displayName in case the agent regenerated its keypair
  // between attempts.
  const row = await prisma.deviceEnrollmentRequest.upsert({
    where: { workspaceSlug_serialNumber_status: { workspaceSlug, serialNumber: params.serialNumber, status: "pending" } },
    create: { workspaceSlug, serialNumber: params.serialNumber, platform: params.platform ?? null, displayName, csrPem: params.csrPem },
    update: { csrPem: params.csrPem, displayName, platform: params.platform ?? null },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_enrollment_request_created",
    actor: "device-agent",
    targetType: "device",
    targetId: params.serialNumber,
    message: `Device '${params.serialNumber}' requested self-service mTLS enrollment — awaiting admin approval (Settings > mTLS).`,
  });
  return { status: "pending", requestId: row.id };
}

export type EnrollmentPollResult = ({ status: "issued" } & IssuedCertificateResponse) | { status: "pending" } | { status: "rejected"; reason: string | null };

/**
 * GET /api/device-mtls/enroll/status — the agent's poll after a 202 from
 * requestEnrollment. Re-validates the secret on every single poll (not just
 * the initial request), so a stale poller stops working the moment the
 * workspace rotates/clears its secret, exactly like every other check here.
 */
export async function pollEnrollmentStatus(workspaceSlug: string, serialNumber: string, providedSecret: string | undefined): Promise<EnrollmentPollResult> {
  await verifyEnrollmentSecret(workspaceSlug, providedSecret);

  const material = await getActiveCertificateMaterial(workspaceSlug, serialNumber);
  if (material) {
    const ca = await getCaStatus(workspaceSlug);
    return { status: "issued", certPem: material.certPem, caCertPem: ca.certPem ?? "", notAfter: material.notAfter };
  }

  const pending = await prisma.deviceEnrollmentRequest.findUnique({
    where: { workspaceSlug_serialNumber_status: { workspaceSlug, serialNumber, status: "pending" } },
  });
  if (pending) return { status: "pending" };

  const rejected = await prisma.deviceEnrollmentRequest.findFirst({
    where: { workspaceSlug, serialNumber, status: "rejected" },
    orderBy: { decidedAt: "desc" },
  });
  if (rejected) return { status: "rejected", reason: rejected.rejectionReason };

  // No record at all — either the initial POST hasn't landed yet (race) or
  // this is a stale/unknown poll. Treat as "still pending" rather than
  // erroring; the agent will simply keep polling.
  return { status: "pending" };
}

// ── Admin-facing approval queue ──

export interface EnrollmentRequestSummary {
  id: string;
  serialNumber: string;
  platform: string | null;
  displayName: string | null;
  status: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
}

export async function listEnrollmentRequests(workspaceSlug: string, status?: string): Promise<EnrollmentRequestSummary[]> {
  const rows = await prisma.deviceEnrollmentRequest.findMany({
    where: { workspaceSlug, ...(status ? { status } : {}) },
    orderBy: { requestedAt: "desc" },
  });
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    serialNumber: r.serialNumber,
    platform: r.platform,
    displayName: r.displayName,
    status: r.status,
    requestedAt: r.requestedAt.toISOString(),
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    rejectionReason: r.rejectionReason,
  }));
}

export async function approveEnrollmentRequest(workspaceSlug: string, id: string, actor: string): Promise<IssuedCertificateResponse> {
  const row = await prisma.deviceEnrollmentRequest.findUnique({ where: { id } });
  if (!row || row.workspaceSlug !== workspaceSlug) {
    throw new HttpError(404, "Enrollment request not found.");
  }
  if (row.status !== "pending") {
    throw new HttpError(400, `This request is already ${row.status}.`);
  }
  // Re-check at decision time too — time has passed since the request was
  // filed, and the device may have since been enrolled some other way (a
  // bootstrap token an admin minted in the meantime, for instance).
  await assertNotAlreadyActive(workspaceSlug, row.serialNumber);

  const result = await issueLeaf(workspaceSlug, row.serialNumber, row.csrPem);
  await prisma.deviceEnrollmentRequest.update({ where: { id }, data: { status: "approved", decidedBy: actor, decidedAt: new Date() } });

  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_enrollment_request_approved",
    actor,
    severity: "warning",
    targetType: "device",
    targetId: row.serialNumber,
    message: `mTLS self-service enrollment for device '${row.serialNumber}' approved by ${actor} — client certificate issued, valid until ${result.notAfter}.`,
  });
  return result;
}

export async function rejectEnrollmentRequest(workspaceSlug: string, id: string, actor: string, reason: string): Promise<void> {
  const row = await prisma.deviceEnrollmentRequest.findUnique({ where: { id } });
  if (!row || row.workspaceSlug !== workspaceSlug) {
    throw new HttpError(404, "Enrollment request not found.");
  }
  if (row.status !== "pending") {
    throw new HttpError(400, `This request is already ${row.status}.`);
  }
  await prisma.deviceEnrollmentRequest.update({ where: { id }, data: { status: "rejected", decidedBy: actor, decidedAt: new Date(), rejectionReason: reason } });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "mtls_enrollment_request_rejected",
    actor,
    targetType: "device",
    targetId: row.serialNumber,
    message: `mTLS self-service enrollment for device '${row.serialNumber}' rejected by ${actor}: ${reason}`,
  });
}
