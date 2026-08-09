import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

/**
 * Gate for POST /api/internal/agent-builds/:platform — the two native agent
 * repos' own GitHub Actions CI is the only caller, POSTing a freshly-built
 * binary on every push to main (see agentBuilds.service.ts's module doc for
 * the full design). Same shape as verifyTriggerSecret
 * (triggerSecret.middleware.ts): a single operator-held shared secret in a
 * custom header, constant-time compared, fails closed (503) if the secret
 * was never configured for this deployment — deliberately NOT a GitHub PAT
 * or a per-workspace secret, since no customer/workspace is involved here at
 * all, only this app's own CI-to-backend ingest channel.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return cryptoTimingSafeEqual(bufA, bufB);
}

export function verifyAgentBuildSecret(req: Request, res: Response, next: NextFunction) {
  if (!env.agentBuildIngestSecret) {
    return res.status(503).json({ detail: "AGENT_BUILD_INGEST_SECRET is not configured for this deployment." });
  }
  const provided = req.header("X-Agent-Build-Secret");
  if (!provided || !timingSafeEqual(provided, env.agentBuildIngestSecret)) {
    return res.status(401).json({ detail: "Invalid agent build secret" });
  }
  return next();
}
