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
    return res.status(401).json({ detail: "Missing dashboard session" });
  }

  try {
    const claims = jwt.verify(token, env.dashboardSecret) as DashboardTokenClaims;
    req.dashboardUser = claims;
    return next();
  } catch {
    return res.status(401).json({ detail: "Invalid or expired dashboard session" });
  }
}

export function signDashboardToken(email: string): string {
  // 30-day dashboard JWT, same lifetime as the original app.
  return jwt.sign({ sub: email }, env.dashboardSecret, { algorithm: "HS256", expiresIn: "30d" });
}
