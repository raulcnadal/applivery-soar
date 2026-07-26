import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

/**
 * Gate for the two external-cron-triggerable job endpoints (POST
 * /api/compliance/evaluate-due, POST /api/workflows/resume-due) — per
 * docs/README.md's TRIGGER_SECRET row, these exist purely as an optional
 * alternative for a deployer who'd rather have an external scheduler (e.g.
 * a Cloudflare Worker Cron Trigger) call in over HTTP instead of relying on
 * this container's own in-process background loops (jobs/backgroundJobs.ts)
 * — NOT required for normal operation, since the loops already run
 * unattended by default. Same trust model as the device-report-secret and
 * per-trigger-fire-secret receivers: a single shared header, constant-time
 * compared, never a dashboard token (there's no human session driving an
 * external cron call). Fails closed (503) if TRIGGER_SECRET was never set,
 * same as verifyDeviceReportSecret's fail-closed-if-unconfigured shape.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return cryptoTimingSafeEqual(bufA, bufB);
}

export function verifyTriggerSecret(req: Request, res: Response, next: NextFunction) {
  if (!env.triggerSecret) {
    return res.status(503).json({ detail: "TRIGGER_SECRET is not configured for this deployment." });
  }
  const provided = req.header("X-Trigger-Secret");
  if (!provided || !timingSafeEqual(provided, env.triggerSecret)) {
    return res.status(401).json({ detail: "Invalid trigger secret" });
  }
  return next();
}
