import type { NextFunction, Request, Response } from "express";

/**
 * In-process, single-instance fixed-window rate limiter keyed by
 * (path-prefix, client IP) — deliberately not Redis-backed, matching the
 * original FastAPI app's inbound rate limiter (ARCHITECTURE.md §2.1). Three
 * tiers, same thresholds as today:
 *   - /api/auth/login                                   → 10 req / 60s
 *   - /api/triggers/fire/*, /api/applivery-webhook/receive/* → 120 req / 60s
 *   - everything else under /api/*                      → 300 req / 60s
 */

interface Window {
  count: number;
  windowStartedAt: number;
}

const WINDOW_MS = 60_000;

function makeLimiter(limit: number) {
  const buckets = new Map<string, Window>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.windowStartedAt >= WINDOW_MS) {
      buckets.set(key, { count: 1, windowStartedAt: now });
      return next();
    }

    if (bucket.count >= limit) {
      const retryAfterSeconds = Math.ceil((bucket.windowStartedAt + WINDOW_MS - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ detail: "Rate limit exceeded" });
    }

    bucket.count += 1;
    return next();
  };
}

export const loginRateLimiter = makeLimiter(10);
export const secretPathRateLimiter = makeLimiter(120);
export const defaultApiRateLimiter = makeLimiter(300);

/**
 * Dispatches to the correct tier based on path prefix. Mount once, globally,
 * ahead of every /api/* route.
 */
export function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/api/auth/login") {
    return loginRateLimiter(req, res, next);
  }
  if (
    req.path.startsWith("/api/triggers/fire/") ||
    req.path.startsWith("/api/applivery-webhook/receive/")
  ) {
    return secretPathRateLimiter(req, res, next);
  }
  if (req.path.startsWith("/api/")) {
    return defaultApiRateLimiter(req, res, next);
  }
  return next();
}
