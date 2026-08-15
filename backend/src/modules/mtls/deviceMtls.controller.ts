import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { verifyMtlsIdentity } from "../../middleware/mtlsIdentity.middleware";
import { deviceMtlsRegisterPayloadSchema, deviceMtlsRenewPayloadSchema } from "./mtls.schemas";
import { registerDevice, renewDevice } from "./deviceMtls.service";

/**
 * Agent-facing mTLS endpoints — device callers, no dashboard token, same
 * class of route as deviceData.controller.ts. See
 * backend/docs/mtls-agent-auth-roadmap.md §4.1.
 *
 * POST /register is deliberately the ONE mTLS route that must always stay
 * reachable via bootstrap-token auth alone, regardless of what cutover
 * phase this deployment is in (roadmap §7) — a pre-registration device has
 * no certificate to present, so it can never be gated by verifyMtlsIdentity.
 *
 * POST /renew is the opposite: it must ALWAYS run behind verifyMtlsIdentity
 * — there's no bootstrap-token fallback for renewal by design (the whole
 * point of the self-sustaining renewal loop is that a bootstrap token is
 * never needed again after first enrollment).
 */

export const deviceMtlsRouter = Router();

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}

deviceMtlsRouter.post(
  "/api/device-mtls/register",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    const payload = deviceMtlsRegisterPayloadSchema.parse(req.body);
    const bootstrapToken = req.header("X-Bootstrap-Token");
    res.json(await registerDevice(workspaceSlug, payload, bootstrapToken));
  }),
);

deviceMtlsRouter.post(
  "/api/device-mtls/renew",
  verifyMtlsIdentity,
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    const payload = deviceMtlsRenewPayloadSchema.parse(req.body);
    res.json(await renewDevice(workspaceSlug, payload, req.mtlsSerialNumber!));
  }),
);
