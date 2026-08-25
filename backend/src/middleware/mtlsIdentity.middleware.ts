import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import type { Request } from "express";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";
import { asyncHandler } from "../utils/asyncHandler";
import { findActiveCertificate, touchCertificateLastSeen } from "../modules/mtls/certificates.service";

/**
 * Trusts a verified client-certificate identity forwarded by the edge
 * reverse proxy (NPM today, but this middleware makes no NPM-specific
 * assumption — see backend/docs/mtls-agent-auth-roadmap.md §5/§5.5). The
 * proxy terminates the actual mTLS handshake; this middleware never touches
 * raw TLS itself, it only trusts a header contract.
 *
 * Order of checks matters:
 *  1. Internal proxy secret — closes the "attacker reaches the backend port
 *     directly and just sets the verified header themselves" gap (§5.4).
 *     Runs FIRST and fails closed (503) if unconfigured, so this middleware
 *     can never be silently protecting nothing.
 *  2. The verified/CN headers themselves.
 *  3. A live, non-revoked, non-superseded, unexpired DeviceCertificate row
 *     for that CN — covers revocation and "the proxy verified the chain but
 *     this specific cert was revoked/superseded after issuance", which the
 *     proxy's own CRL checking may not catch depending on how it's set up.
 *
 * `assertMtlsIdentity` is the reusable core (throws HttpError, matching this
 * codebase's usual auth-check shape — see verifyDeviceReportSecret in
 * deviceData.service.ts) — used two ways:
 *  - directly, by deviceData.service.ts's Phase C enforcement-aware
 *    verifyDeviceIdentity, alongside the legacy secret check;
 *  - wrapped as `verifyMtlsIdentity` Express middleware (asyncHandler-based,
 *    same as every other route in this app) for POST /api/device-mtls/renew,
 *    which is unconditionally mTLS-only regardless of the enforcement flag —
 *    there's no bootstrap-token fallback for renewal by design.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      mtlsSerialNumber?: string;
    }
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return cryptoTimingSafeEqual(bufA, bufB);
}

/**
 * nginx has no built-in "just the CN" variable — `$ssl_client_s_dn_cn` does
 * not exist in open-source nginx (found the hard way against a live NPM
 * deployment: referencing it silently breaks the proxy host's config
 * application entirely, with no error surfaced anywhere in NPM's own logs —
 * see roadmap §5.5's incident writeup). The only real variable is
 * `$ssl_client_s_dn`, the full RFC 2253 subject DN string (e.g.
 * "CN=fe5db86528ae", or "CN=fe5db86528ae,O=Example" if a subject ever grows
 * more RDNs), so the CN header may carry either a bare CN (older deployments,
 * or a non-nginx proxy that already extracts it) or a full DN string.
 * findActiveCertificate expects a bare CN (it's stored as the device's plain
 * serial number — see certificates.service.ts), so this always normalizes
 * before that lookup.
 */
function extractCommonName(headerValue: string): string {
  const match = headerValue.match(/(?:^|,)\s*CN=([^,]+)/i);
  return (match ? match[1] : headerValue).trim();
}

function workspaceOf(req: Request): string {
  return req.header("X-Workspace-Slug") || "global";
}

// Every rejection here is logged (console.warn, not .error — this is
// expected traffic from a misconfigured/unregistered device, not an
// application bug) with enough context to actually diagnose it, since
// errorHandler.middleware.ts deliberately does NOT log HttpError instances
// (see its own comment) — an mTLS auth rejection used to be completely
// invisible server-side, which cost real debugging time on a live incident
// (a device's every request 401ing, "backend logs clean, no errors", the
// actual reason sitting unlogged in the response body the whole time).
// req.path/method identify which route rejected it; workspaceSlug + a
// masked CN (never the full raw header — it's PII-adjacent device identity)
// identify which device without needing to correlate against the agent's
// own logs.
function logRejection(req: Request, reason: string, extra?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.warn(`[mTLS] ${req.method} ${req.path} rejected: ${reason}`, extra ?? {});
}

export async function assertMtlsIdentity(req: Request): Promise<string> {
  const workspaceSlug = workspaceOf(req);
  if (!env.mtlsInternalProxySecret) {
    // Deliberately NOT run through logRejection — this is a deployment
    // misconfiguration (fails closed at 503), not per-request device
    // traffic, and every single request would otherwise log the identical
    // line forever until an admin sets the env var.
    throw new HttpError(503, "MTLS_INTERNAL_PROXY_SECRET is not configured for this deployment — mTLS enforcement is not active yet.");
  }
  const providedProxySecret = req.header(env.mtlsHeaderProxySecret);
  if (!providedProxySecret || !timingSafeEqual(providedProxySecret, env.mtlsInternalProxySecret)) {
    logRejection(req, "missing or invalid internal proxy secret", { workspaceSlug, hadHeader: Boolean(providedProxySecret) });
    throw new HttpError(401, "Missing or invalid internal proxy secret.");
  }

  const verified = req.header(env.mtlsHeaderCertVerified);
  const rawCn = req.header(env.mtlsHeaderCertCn);
  if (verified !== "SUCCESS" || !rawCn) {
    logRejection(req, "no verified client certificate identity presented", { workspaceSlug, verifiedHeaderValue: verified ?? null, hadCnHeader: Boolean(rawCn) });
    throw new HttpError(401, "No verified client certificate identity was presented.");
  }
  const cn = extractCommonName(rawCn);

  const activeCert = await findActiveCertificate(workspaceSlug, cn);
  if (!activeCert) {
    logRejection(req, "no active DeviceCertificate row for this CN/workspace (revoked, superseded, expired, or never registered)", { workspaceSlug, cn });
    throw new HttpError(401, "The presented client certificate is not a currently active certificate for this workspace (it may be revoked, superseded, or expired).");
  }
  // Fire-and-forget — see touchCertificateLastSeen's own doc comment for why
  // this is never awaited and never allowed to affect the auth decision.
  touchCertificateLastSeen(activeCert.id);

  return cn;
}

export const verifyMtlsIdentity = asyncHandler(async (req, _res, next) => {
  req.mtlsSerialNumber = await assertMtlsIdentity(req);
  next();
});
