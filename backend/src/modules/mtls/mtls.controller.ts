import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { env } from "../../config/env";
import { agentSubdomainPayloadSchema, caGeneratePayloadSchema, caLeafValidityPayloadSchema, caUploadPayloadSchema, certPurgeNowPayloadSchema, certPurgeSettingsPayloadSchema, certificateRevokePayloadSchema, mtlsEnforcementPayloadSchema } from "./mtls.schemas";
import { generateCa, getCaStatus, setLeafValidityDays, uploadCa } from "./ca.service";
import { getCertPurgeSettings, getCertificateCounts, listCertificates, purgeRevokedCertificates, revokeCertificate, setCertPurgeSettings } from "./certificates.service";
import { getMtlsEnforcementEnabled, setMtlsEnforcementEnabled } from "./mtlsEnforcement.service";
import { clearGlobalBootstrapToken, getGlobalBootstrapTokenStatus, rotateGlobalBootstrapToken } from "./globalBootstrapToken.service";
import { getAgentSubdomain, setAgentSubdomain } from "./agentSubdomain.service";

/**
 * Admin-facing mTLS management — Settings > mTLS Agent Authentication.
 * Dashboard-token + RBAC gated, same shape as every other Settings
 * sub-resource (settings.controller.ts). The mutating routes additionally
 * require the `canManageMtlsCA` risky-action flag (rbac.middleware.ts) on
 * top of settings:manage — replacing the workspace's trust root, or
 * rotating/clearing the fleet's bootstrap token, is exactly the class of
 * consequential action that flag category exists for (mirrors
 * canExportOrImportConfig).
 *
 * See backend/docs/mtls-agent-auth-roadmap.md for the full route list and
 * rationale, including the Global Bootstrap Token addendum that replaced
 * the original per-device Bootstrap Tokens + Phase E self-service-mode
 * design with this single always-on mechanism.
 */

export const mtlsRouter = Router();

const readMtls = [verifyDashboardToken, requirePermission({ area: "settings", level: "read" })];
const manageMtls = [verifyDashboardToken, requirePermission({ area: "settings", level: "manage", action: "canManageMtlsCA" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

// ── CA ──

mtlsRouter.get("/api/mtls/ca", ...readMtls, asyncHandler(async (req, res) => {
  res.json(await getCaStatus(workspaceOf(req)));
}));

mtlsRouter.post("/api/mtls/ca/generate", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = caGeneratePayloadSchema.parse(req.body ?? {});
  res.json(await generateCa(workspaceOf(req), actorOf(req), payload.confirmReplace));
}));

mtlsRouter.post("/api/mtls/ca/upload", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = caUploadPayloadSchema.parse(req.body);
  res.json(await uploadCa(workspaceOf(req), actorOf(req), payload.certPem, payload.privateKeyPem, payload.confirmReplace));
}));

mtlsRouter.patch("/api/mtls/ca/leaf-validity", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = caLeafValidityPayloadSchema.parse(req.body);
  res.json(await setLeafValidityDays(workspaceOf(req), actorOf(req), payload.leafValidityDays));
}));

// ── Global Bootstrap Token — the single, workspace-wide enrollment credential ──

mtlsRouter.get("/api/mtls/bootstrap-token", ...readMtls, asyncHandler(async (req, res) => {
  res.json(await getGlobalBootstrapTokenStatus(workspaceOf(req)));
}));

mtlsRouter.post("/api/mtls/bootstrap-token", ...manageMtls, asyncHandler(async (req, res) => {
  res.json(await rotateGlobalBootstrapToken(workspaceOf(req), actorOf(req)));
}));

mtlsRouter.delete("/api/mtls/bootstrap-token", ...manageMtls, asyncHandler(async (req, res) => {
  await clearGlobalBootstrapToken(workspaceOf(req), actorOf(req));
  res.json({ status: "ok" });
}));

// ── Issued certificates ──
//
// Split into an Active section (revokedAt IS NULL — includes expiring-soon/
// expired/superseded sub-statuses, shown via each row's own status badge)
// and a Revoked one, each independently paginated + searchable (serial
// number, the cert's own X.509 serial, or its thumbprint) server-side —
// see certificates.service.ts's listCertificates doc comment for why this
// moved off the old "load every row, filter client-side" shape once fleets
// reach thousands of issued certificates.

function certStatusOf(req: { query: Record<string, unknown> }): "active" | "revoked" {
  return req.query.status === "revoked" ? "revoked" : "active";
}

mtlsRouter.get("/api/mtls/certificates", ...readMtls, asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const offset = req.query.offset ? Number(req.query.offset) : undefined;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  res.json(await listCertificates(workspaceOf(req), { status: certStatusOf(req), search, limit, offset }, req.header("Authorization")));
}));

mtlsRouter.get("/api/mtls/certificates/counts", ...readMtls, asyncHandler(async (req, res) => {
  res.json(await getCertificateCounts(workspaceOf(req)));
}));

mtlsRouter.post("/api/mtls/certificates/:id/revoke", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = certificateRevokePayloadSchema.parse(req.body);
  await revokeCertificate(workspaceOf(req), req.params.id, actorOf(req), payload.reason);
  res.json({ status: "ok" });
}));

// ── Purge old revoked certificates — hard delete, gated the same as any
// other mTLS-management mutation (canManageMtlsCA), same as revoking itself.

mtlsRouter.get("/api/mtls/certificates/purge-settings", ...readMtls, asyncHandler(async (req, res) => {
  res.json(await getCertPurgeSettings(workspaceOf(req)));
}));

mtlsRouter.put("/api/mtls/certificates/purge-settings", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = certPurgeSettingsPayloadSchema.parse(req.body);
  res.json(await setCertPurgeSettings(workspaceOf(req), actorOf(req), payload));
}));

mtlsRouter.post("/api/mtls/certificates/purge-now", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = certPurgeNowPayloadSchema.parse(req.body);
  res.json(await purgeRevokedCertificates(workspaceOf(req), payload.olderThanDays, actorOf(req)));
}));

// ── Enforcement (Phase C cutover switch) ──

mtlsRouter.get("/api/mtls/enforcement", ...readMtls, asyncHandler(async (req, res) => {
  res.json({ enabled: await getMtlsEnforcementEnabled(workspaceOf(req)) });
}));

mtlsRouter.put("/api/mtls/enforcement", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = mtlsEnforcementPayloadSchema.parse(req.body);
  res.json(await setMtlsEnforcementEnabled(workspaceOf(req), actorOf(req), payload.enabled));
}));

// ── Reverse-proxy config reference (roadmap §5.5) — read-only, env-derived.
// Never returns the internal proxy secret's actual value (the admin already
// set it themselves as a deployment-time env var; echoing it back over the
// admin API would just be unnecessary exposure of a bearer secret), only
// whether it's configured at all — that boolean is the operationally
// important thing to surface, since verifyMtlsIdentity fails closed (503)
// on every mTLS-gated request until it's set.

mtlsRouter.get("/api/mtls/proxy-config", ...readMtls, asyncHandler(async (_req, res) => {
  res.json({
    headerCertVerified: env.mtlsHeaderCertVerified,
    headerCertCn: env.mtlsHeaderCertCn,
    headerProxySecret: env.mtlsHeaderProxySecret,
    proxySecretConfigured: Boolean(env.mtlsInternalProxySecret),
  });
}));

// ── Agent subdomain — single source of truth, see agentSubdomain.service.ts.
// Device Data Webhook's Managed Configuration bundle reads this back
// read-only; this panel (Reverse Proxy Configuration) is the only place it's
// ever set.

mtlsRouter.get("/api/mtls/agent-subdomain", ...readMtls, asyncHandler(async (req, res) => {
  res.json(await getAgentSubdomain(workspaceOf(req)));
}));

mtlsRouter.put("/api/mtls/agent-subdomain", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = agentSubdomainPayloadSchema.parse(req.body);
  res.json(await setAgentSubdomain(workspaceOf(req), actorOf(req), payload.agentSubdomain));
}));
