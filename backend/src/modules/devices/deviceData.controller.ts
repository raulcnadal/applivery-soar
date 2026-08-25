import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { deviceAppReportPayloadSchema, deviceReportPayloadSchema, eventNotifyPayloadSchema } from "./deviceData.schemas";
import { getAgentCompliancePolicyStatus, getAgentStatus, handleEventNotify, reportDeviceApps, reportDeviceData, verifyDeviceIdentity } from "./deviceData.service";
import { listEnabledChecksForAgent } from "../compliance/customChecks.service";
import { CHECK_PLATFORMS } from "../compliance/customChecks.schemas";
import { getEventDrivenSettings, listEnabledWatchesForAgent } from "../compliance/eventWatches.service";
import { WATCH_PLATFORMS } from "../compliance/eventWatches.schemas";
import { forceEvaluateNow } from "../compliance/compliance.service";
import { issueNonce } from "../playIntegrity/playIntegrity.service";

/** Port of main.py:7758-7804 / 9714-9804 — POST /api/device-data/report, POST /api/device-data/report-apps. */

export const deviceDataRouter = Router();

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}

deviceDataRouter.post(
  "/api/device-data/report",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceIdentity(req, workspaceSlug);
    const payload = deviceReportPayloadSchema.parse(req.body);
    res.json(await reportDeviceData(workspaceSlug, payload));
  }),
);

deviceDataRouter.post(
  "/api/device-data/report-apps",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceIdentity(req, workspaceSlug);
    const payload = deviceAppReportPayloadSchema.parse(req.body);
    res.json(await reportDeviceApps(workspaceSlug, payload));
  }),
);

/**
 * Agent poll endpoint — GET /api/device-data/custom-checks?platform=windows|macos
 * (customChecks.service.ts's module doc has the full design). Same auth as
 * the two report endpoints above: this is an unattended device caller, not
 * a logged-in admin. The agent calls this once per report cycle, runs every
 * check it gets back locally, and includes the results in its next
 * POST /api/device-data/report call (customCheckResults field).
 *
 * Windows/macOS only — CHECK_PLATFORMS (customChecks.schemas.ts) used to
 * also accept ios/android with only an "appInstalled" checkerType offered
 * for them, but the SOAR Mobile Agent never actually implements or reports
 * any custom check (no method channel, no customCheckResults field ever
 * sent) — that option could be created in the UI and would simply never
 * produce a result. Real installed-app data for iOS/Android already exists
 * via the separate, working App Lists feature (requiredAppList/
 * disallowedAppList conditions, sourced from Apple/Android MDM's own
 * installed-apps API), so mobile was removed here rather than left as a
 * dead, silently-never-matching option.
 */
deviceDataRouter.get(
  "/api/device-data/custom-checks",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceIdentity(req, workspaceSlug);
    const platform = typeof req.query.platform === "string" ? req.query.platform : "";
    if (!(CHECK_PLATFORMS as readonly string[]).includes(platform)) {
      res.status(400).json({ detail: `platform query param must be one of: ${CHECK_PLATFORMS.join(", ")}` });
      return;
    }
    res.json({ items: await listEnabledChecksForAgent(workspaceSlug, platform) });
  }),
);

/**
 * Agent poll endpoint — GET /api/device-data/agent-status?serialNumber=...&platform=windows.
 * Powers the Windows agent's tray icon right-click menu (and, going
 * forward, any other platform's equivalent): which Compliance Policies
 * apply to this device, whether it's currently compliant, and its risk
 * score/tier. Same device-caller auth as every other endpoint in this
 * router — see getAgentStatus's own doc comment (deviceData.service.ts) for
 * why this always returns 200 with `compliance.available: false` instead of
 * erroring when compliance can't be computed yet.
 */
/**
 * "Force evaluate compliance" — the SOAR Agent tray/menu action that lets an
 * end user (or the admin sitting at that machine) trigger a real compliance
 * pass right now instead of waiting for the 60s scheduler tick
 * (complianceJobs.ts) to notice a due policy. Same device-caller auth as
 * every other route in this file; the actual evaluation runs against the
 * workspace's Automation Credential, not anything device-supplied — see
 * forceEvaluateNow's own doc comment (compliance.service.ts) for the
 * cooldown/credential-missing behavior.
 */
deviceDataRouter.post(
  "/api/device-data/evaluate-now",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceIdentity(req, workspaceSlug);
    res.json(await forceEvaluateNow(workspaceSlug));
  }),
);

deviceDataRouter.get(
  "/api/device-data/agent-status",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceIdentity(req, workspaceSlug);
    const serialNumber = typeof req.query.serialNumber === "string" ? req.query.serialNumber.trim() : "";
    const platform = typeof req.query.platform === "string" ? req.query.platform : "";
    if (!serialNumber) {
      res.status(400).json({ detail: "serialNumber query param is required" });
      return;
    }
    res.json(await getAgentStatus(workspaceSlug, serialNumber, platform));
  }),
);

/**
 * Agent poll endpoint — GET /api/device-data/compliance-policy?serialNumber=...&policyId=...
 * Device-facing per-condition detail for a single policy — the mobile app's
 * policy detail screen calls this when the user taps a policy in
 * ComplianceScreen, to render each condition with a red/green dot the same
 * way the dashboard's Device Modal does. Same device-caller auth as every
 * other route in this file. See getAgentCompliancePolicyStatus's own doc
 * comment (deviceData.service.ts) for why this reuses the dashboard's own
 * evaluatePolicyForDevice rather than a second implementation.
 */
deviceDataRouter.get(
  "/api/device-data/compliance-policy",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceIdentity(req, workspaceSlug);
    const serialNumber = typeof req.query.serialNumber === "string" ? req.query.serialNumber.trim() : "";
    const policyId = typeof req.query.policyId === "string" ? req.query.policyId.trim() : "";
    if (!serialNumber || !policyId) {
      res.status(400).json({ detail: "serialNumber and policyId query params are required" });
      return;
    }
    res.json(await getAgentCompliancePolicyStatus(workspaceSlug, serialNumber, policyId));
  }),
);

/**
 * Agent poll endpoint — GET /api/device-data/event-watches?platform=windows|macos.
 * See eventWatches.service.ts's module doc for the full design. Same auth
 * and same "poll once per report cycle" shape as GET /custom-checks above —
 * the agent diffs the returned watch list against whichever watchers it
 * currently has running and starts/stops/restarts to match, rather than
 * this being a separate polling loop of its own.
 *
 * remoteIntervalSec (Phase 4) rides along in this same response rather than
 * a separate endpoint — it's already polled every report cycle, so no new
 * request is needed. null means "no SOAR-side override, use whatever's in
 * this device's local Managed Configuration" — see
 * eventwatch_windows.go/telemetry_windows.go (Windows Agent repo) and
 * eventwatch_macos.go/telemetry_macos.go (macOS Agent repo) for how each
 * agent resets its report ticker when this value changes without needing a
 * restart.
 */
deviceDataRouter.get(
  "/api/device-data/event-watches",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceIdentity(req, workspaceSlug);
    const platform = typeof req.query.platform === "string" ? req.query.platform : "";
    if (!(WATCH_PLATFORMS as readonly string[]).includes(platform)) {
      res.status(400).json({ detail: `platform query param must be one of: ${WATCH_PLATFORMS.join(", ")}` });
      return;
    }
    const [items, settings] = await Promise.all([listEnabledWatchesForAgent(workspaceSlug, platform), getEventDrivenSettings(workspaceSlug)]);
    res.json({ items, remoteIntervalSec: settings.remoteIntervalSec });
  }),
);

/**
 * Agent-initiated webhook — POST /api/device-data/event-notify. Called by
 * the agent once its own local debounce goes quiet after a watched signal
 * fired (the "fast lane" the whole event-driven detection feature exists
 * for — see backend/docs/event-driven-agent-detection-roadmap.md). Same
 * device-caller auth as every other route in this file; see
 * deviceData.service.ts's handleEventNotify doc comment for the cooldown/
 * routing behavior.
 */
deviceDataRouter.post(
  "/api/device-data/event-notify",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceIdentity(req, workspaceSlug);
    const payload = eventNotifyPayloadSchema.parse(req.body);
    res.json(await handleEventNotify(workspaceSlug, payload));
  }),
);

/**
 * Agent poll endpoint — GET /api/device-data/play-integrity/nonce?serialNumber=...
 * Android-only, called by the agent immediately before it makes its
 * on-device Play Integrity Classic API requestIntegrityToken call
 * (playIntegrity.service.ts's module doc has the full end-to-end flow).
 * Same device-caller auth as every other route in this file. Returns 503 —
 * via issueNonce's own HttpError, surfaced by the shared asyncHandler/
 * errorHandler pipeline — when this workspace hasn't configured Settings >
 * Google Play Integrity API yet, which the agent treats as "skip Play
 * Integrity this cycle" rather than a hard failure.
 */
deviceDataRouter.get(
  "/api/device-data/play-integrity/nonce",
  asyncHandler(async (req, res) => {
    const workspaceSlug = workspaceOf(req);
    await verifyDeviceIdentity(req, workspaceSlug);
    const serialNumber = typeof req.query.serialNumber === "string" ? req.query.serialNumber.trim() : "";
    if (!serialNumber) {
      res.status(400).json({ detail: "serialNumber query param is required" });
      return;
    }
    res.json(await issueNonce(workspaceSlug, serialNumber));
  }),
);
