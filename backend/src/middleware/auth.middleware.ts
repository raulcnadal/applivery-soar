import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface DashboardTokenClaims {
  sub: string; // email
  iat: number;
  exp: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      dashboardUser?: DashboardTokenClaims;
    }
  }
}

/**
 * The sole gate on every /api/* route (mirrors verify_dashboard_token in the
 * original app, ARCHITECTURE.md §2.3). Reads X-Dashboard-Token or
 * Authorization-Dashboard; proves only "a valid dashboard session exists" —
 * says nothing about what the user is allowed to do (that's RBAC, see
 * rbac.middleware.ts, implemented in Phase 1 along with /api/auth/*).
 */
export function verifyDashboardToken(req: Request, res: Response, next: NextFunction) {
  const token = req.header("X-Dashboard-Token") ?? req.header("Authorization-Dashboard");

  if (!token) {
    return res.status(401).json({ detail: "Missing X-Dashboard-Token header" });
  }

  // Original app strips a "Bearer " prefix defensively even though the
  // frontend never sends one on this specific header (verify_dashboard_token,
  // main.py:1017-1031) — kept for parity.
  const cleanToken = token.replace("Bearer ", "").trim();

  try {
    // 60s clock-skew tolerance, same as the original's {"leeway": 60}.
    // `algorithms` pinned to HS256 explicitly — this is the sole gate on
    // every /api/* route, so it shouldn't rely on jsonwebtoken's default
    // algorithm handling at all. signDashboardToken below always signs with
    // HS256, so this rejects nothing legitimate; it just closes off any
    // ambiguity about what a "valid" token's header is allowed to claim.
    const claims = jwt.verify(cleanToken, env.dashboardSecret, { clockTolerance: 60, algorithms: ["HS256"] }) as DashboardTokenClaims;
    req.dashboardUser = claims;
    return next();
  } catch (error: any) {
    return res.status(401).json({ detail: `Invalid session: ${error?.message ?? "unknown error"}` });
  }
}

export function signDashboardToken(email: string): string {
  // 30-day dashboard JWT, same lifetime as the original app.
  return jwt.sign({ sub: email }, env.dashboardSecret, { algorithm: "HS256", expiresIn: "30d" });
}
