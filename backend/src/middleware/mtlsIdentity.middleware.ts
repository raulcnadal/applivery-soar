import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { findActiveCertificate } from "../modules/mtls/certificates.service";

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
 * On success, attaches the verified serial number to the request as
 * `req.mtlsSerialNumber` for downstream handlers (see deviceMtls.controller.ts).
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

function workspaceOf(req: Request): string {
  return req.header("X-Workspace-Slug") || "global";
}

export async function verifyMtlsIdentity(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!env.mtlsInternalProxySecret) {
    res.status(503).json({ detail: "MTLS_INTERNAL_PROXY_SECRET is not configured for this deployment — mTLS enforcement is not active yet." });
    return;
  }
  const providedProxySecret = req.header(env.mtlsHeaderProxySecret);
  if (!providedProxySecret || !timingSafeEqual(providedProxySecret, env.mtlsInternalProxySecret)) {
    res.status(401).json({ detail: "Missing or invalid internal proxy secret." });
    return;
  }

  const verified = req.header(env.mtlsHeaderCertVerified);
  const cn = req.header(env.mtlsHeaderCertCn);
  if (verified !== "SUCCESS" || !cn) {
    res.status(401).json({ detail: "No verified client certificate identity was presented." });
    return;
  }

  const workspaceSlug = workspaceOf(req);
  const activeCert = await findActiveCertificate(workspaceSlug, cn);
  if (!activeCert) {
    res.status(401).json({ detail: "The presented client certificate is not a currently active certificate for this workspace (it may be revoked, superseded, or expired)." });
    return;
  }

  req.mtlsSerialNumber = cn;
  next();
}
