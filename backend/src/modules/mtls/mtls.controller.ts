import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  caGeneratePayloadSchema,
  caLeafValidityPayloadSchema,
  caUploadPayloadSchema,
  bootstrapTokenBulkPayloadSchema,
  bootstrapTokenPayloadSchema,
  certificateRevokePayloadSchema,
  mtlsEnforcementPayloadSchema,
} from "./mtls.schemas";
import { generateCa, getCaStatus, setLeafValidityDays, uploadCa } from "./ca.service";
import { listBootstrapTokens, mintBootstrapToken, mintBootstrapTokensBulk, revokeBootstrapToken } from "./bootstrapTokens.service";
import { listCertificates, revokeCertificate } from "./certificates.service";
import { getMtlsEnforcementEnabled, setMtlsEnforcementEnabled } from "./mtlsEnforcement.service";

/**
 * Admin-facing mTLS management — Settings > (new) mTLS panel. Dashboard-
 * token + RBAC gated, same shape as every other Settings sub-resource
 * (settings.controller.ts). The mutating routes additionally require the
 * `canManageMtlsCA` risky-action flag (rbac.middleware.ts) on top of
 * settings:manage — replacing the workspace's trust root, or minting/
 * revoking device credentials, is exactly the class of consequential action
 * that flag category exists for (mirrors canExportOrImportConfig).
 *
 * See backend/docs/mtls-agent-auth-roadmap.md §4.2 for the full route list
 * and rationale.
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

// ── Bootstrap tokens ──

mtlsRouter.get("/api/mtls/bootstrap-tokens", ...readMtls, asyncHandler(async (req, res) => {
  res.json({ items: await listBootstrapTokens(workspaceOf(req)) });
}));

mtlsRouter.post("/api/mtls/bootstrap-tokens", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = bootstrapTokenPayloadSchema.parse(req.body);
  res.json(await mintBootstrapToken(workspaceOf(req), actorOf(req), payload.serialNumber, payload.expiresInDays));
}));

mtlsRouter.post("/api/mtls/bootstrap-tokens/bulk", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = bootstrapTokenBulkPayloadSchema.parse(req.body);
  res.json({ items: await mintBootstrapTokensBulk(workspaceOf(req), actorOf(req), payload.serialNumbers, payload.expiresInDays) });
}));

mtlsRouter.delete("/api/mtls/bootstrap-tokens/:id", ...manageMtls, asyncHandler(async (req, res) => {
  await revokeBootstrapToken(workspaceOf(req), req.params.id, actorOf(req));
  res.json({ status: "ok" });
}));

// ── Issued certificates ──

mtlsRouter.get("/api/mtls/certificates", ...readMtls, asyncHandler(async (req, res) => {
  res.json({ items: await listCertificates(workspaceOf(req)) });
}));

mtlsRouter.post("/api/mtls/certificates/:id/revoke", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = certificateRevokePayloadSchema.parse(req.body);
  await revokeCertificate(workspaceOf(req), req.params.id, actorOf(req), payload.reason);
  res.json({ status: "ok" });
}));

// ── Enforcement (Phase C cutover switch) ──

mtlsRouter.get("/api/mtls/enforcement", ...readMtls, asyncHandler(async (req, res) => {
  res.json({ enabled: await getMtlsEnforcementEnabled(workspaceOf(req)) });
}));

mtlsRouter.put("/api/mtls/enforcement", ...manageMtls, asyncHandler(async (req, res) => {
  const payload = mtlsEnforcementPayloadSchema.parse(req.body);
  res.json(await setMtlsEnforcementEnabled(workspaceOf(req), actorOf(req), payload.enabled));
}));
