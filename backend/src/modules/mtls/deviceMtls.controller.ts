import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { verifyMtlsIdentity } from "../../middleware/mtlsIdentity.middleware";
import { deviceMtlsEnrollPayloadSchema, deviceMtlsRegisterPayloadSchema, deviceMtlsRenewPayloadSchema } from "./mtls.schemas";
import { registerDevice, renewDevice } from "./deviceMtls.service";
import { pollEnrollmentStatus, requestEnrollment } from "./mtlsEnrollment.service";

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

/**
 * Self-service enrollment (Phase E) — the alternative to bootstrap-token
 * registration for fleets with no per-device token delivery mechanism. Auth
 * is the shared X-Enrollment-Secret header, never a dashboard token (same
 * class of route as /register above) — see mtlsEnrollment.service.ts's
 * module doc for the full security model this trades off against
 * /register's per-device guarantee.
 */
deviceMtlsRouter.post(
  "/api/device-mtls/enroll",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    const payload = deviceMtlsEnrollPayloadSchema.parse(req.body);
    const secret = req.header("X-Enrollment-Secret");
    const result = await requestEnrollment(workspaceSlug, payload, secret);
    res.status(result.status === "pending" ? 202 : 200).json(result);
  }),
);

/**
 * Agent poll after a 202 from /enroll above (approval mode). Re-checks the
 * enrollment secret on every poll, not just the initial request.
 */
deviceMtlsRouter.get(
  "/api/device-mtls/enroll/status",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    const serialNumber = typeof req.query.serialNumber === "string" ? req.query.serialNumber.trim() : "";
    if (!serialNumber) {
      res.status(400).json({ detail: "serialNumber query param is required" });
      return;
    }
    const secret = req.header("X-Enrollment-Secret");
    res.json(await pollEnrollmentStatus(workspaceSlug, serialNumber, secret));
  }),
);
