import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { verifyTriggerSecret } from "../../middleware/triggerSecret.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { runComplianceSchedulerTick } from "./complianceJobs";
import {
  compliancePolicySchema,
  evaluateNowSchema,
  bulkViolationIdsSchema,
  suggestMitreTechniquesSchema,
} from "./compliance.schemas";
import {
  listCompliancePolicies,
  createCompliancePolicy,
  updateCompliancePolicy,
  deleteCompliancePolicy,
  runComplianceEvaluation,
  getPolicyViolatingDeviceIds,
  listComplianceViolations,
  exportComplianceViolationsCsv,
  approveViolationCore,
  bulkApproveViolations,
  dismissViolationCore,
  bulkDismissViolations,
} from "./compliance.service";
import { COMPLIANCE_FIELDS, suggestMitreTechniquesForConditions, getComplianceTemplates } from "./complianceFields";
import { getMitreTechniques, refreshMitreCatalog } from "../catalogs/mitreCatalog";
import { getSelfReportedAttributeNames } from "../devices/deviceData.service";
import { createCustomCheck, deleteCustomCheck, getCustomCheckNames, listCustomChecks, updateCustomCheck } from "./customChecks.service";
import { createEventWatch, deleteEventWatch, getEventDrivenSettings, getEventWatchMetrics, listEventWatches, updateEventDrivenSettings, updateEventWatch } from "./eventWatches.service";

/**
 * CompliancePolicy CRUD + evaluation + violations review queue + MITRE/
 * template gallery wiring — port of main.py's compliance section
 * (9881-11599). See compliance.service.ts for the heavy lifting; this file
 * is routing + request/response shaping only.
 */

export const complianceRouter = Router();

const readCompliance = [verifyDashboardToken, requirePermission({ area: "compliance", level: "read" })];
const manageCompliance = [verifyDashboardToken, requirePermission({ area: "compliance", level: "manage" })];
const deletePolicy = [verifyDashboardToken, requirePermission({ area: "compliance", level: "manage", action: "canDeletePolicyOrWorkflow" })];
const bulkTriage = [verifyDashboardToken, requirePermission({ area: "compliance", level: "manage", action: "canBulkTriage" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}

function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

// ── Static reference data (main.py:9881-10204) ──

complianceRouter.get("/api/compliance/fields", ...readCompliance, asyncHandler(async (_req, res) => {
  res.json({ items: COMPLIANCE_FIELDS });
}));

complianceRouter.post("/api/compliance/suggest-mitre-techniques", ...readCompliance, asyncHandler(async (req, res) => {
  const payload = suggestMitreTechniquesSchema.parse(req.body ?? {});
  res.json({ items: suggestMitreTechniquesForConditions(payload.conditions) });
}));

complianceRouter.get("/api/compliance/templates", ...readCompliance, asyncHandler(async (req, res) => {
  const framework = typeof req.query.framework === "string" ? req.query.framework : undefined;
  const result = getComplianceTemplates(framework);
  if (result === null) throw new HttpError(404, `Unknown framework '${framework}'`);
  res.json(result);
}));

complianceRouter.get("/api/mitre/techniques", ...readCompliance, asyncHandler(async (_req, res) => {
  res.json(await getMitreTechniques());
}));
complianceRouter.post("/api/mitre/refresh", ...manageCompliance, asyncHandler(async (_req, res) => {
  res.json(await refreshMitreCatalog());
}));

/** Port of `get_smart_attribute_names` (main.py:10165) — distinct Smart Attribute names seen across the live fleet, for the Policy Builder's autocomplete. */
complianceRouter.get("/api/compliance/smart-attribute-names", ...readCompliance, asyncHandler(async (req, res) => {
  const authorization = req.header("Authorization");
  const workspaceSlug = req.header("X-Workspace-Slug");
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
  const { getDevicesFull } = await import("../devices/devices.service");
  const devicesResp = await getDevicesFull(authorization, workspaceSlug, false);
  const names = new Set<string>();
  for (const d of devicesResp.items) {
    for (const attr of d.smartAttributes ?? []) if (attr.name) names.add(attr.name);
  }
  res.json({ items: Array.from(names).sort() });
}));

/**
 * Port of `get_self_reported_attribute_names` (main.py:10184) — distinct
 * attribute names ever pushed to the device-data webhook for this
 * workspace, read straight from the local DevicePushData store (Phase 8).
 * ?platform=windows|macos narrows to attribute names seen from that
 * platform; omitted returns the union across both.
 */
complianceRouter.get("/api/compliance/self-reported-attribute-names", ...readCompliance, asyncHandler(async (req, res) => {
  const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
  res.json({ items: await getSelfReportedAttributeNames(workspaceOf(req), platform) });
}));

// ── Custom Device Checks (Settings > Device Data Webhook) — disclosed new
// feature, no main.py equivalent. See customChecks.service.ts's module doc. ──

complianceRouter.get("/api/compliance/custom-checks", ...readCompliance, asyncHandler(async (req, res) => {
  const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
  res.json({ items: await listCustomChecks(workspaceOf(req), platform) });
}));

complianceRouter.post("/api/compliance/custom-checks", ...manageCompliance, asyncHandler(async (req, res) => {
  res.json(await createCustomCheck(workspaceOf(req), req.body, actorOf(req)));
}));

complianceRouter.put("/api/compliance/custom-checks/:id", ...manageCompliance, asyncHandler(async (req, res) => {
  res.json(await updateCustomCheck(workspaceOf(req), req.params.id, req.body, actorOf(req)));
}));

complianceRouter.delete("/api/compliance/custom-checks/:id", ...manageCompliance, asyncHandler(async (req, res) => {
  await deleteCustomCheck(workspaceOf(req), req.params.id, actorOf(req));
  res.json({ status: "ok" });
}));

/** Policy Builder's condition picker — see customChecks.service.ts's getCustomCheckNames doc comment for why this is sourced from the catalog, not observed report history. */
complianceRouter.get("/api/compliance/custom-check-names", ...readCompliance, asyncHandler(async (req, res) => {
  const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
  res.json({ items: await getCustomCheckNames(workspaceOf(req), platform) });
}));

// ── Event-Driven Detection watches (Settings > Device Data Webhook) —
// disclosed new feature, no main.py equivalent. See eventWatches.service.ts's
// module doc and backend/docs/event-driven-agent-detection-roadmap.md. ──

complianceRouter.get("/api/compliance/event-watches", ...readCompliance, asyncHandler(async (req, res) => {
  const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
  res.json({ items: await listEventWatches(workspaceOf(req), platform) });
}));

complianceRouter.post("/api/compliance/event-watches", ...manageCompliance, asyncHandler(async (req, res) => {
  res.json(await createEventWatch(workspaceOf(req), req.body, actorOf(req)));
}));

complianceRouter.put("/api/compliance/event-watches/:id", ...manageCompliance, asyncHandler(async (req, res) => {
  res.json(await updateEventWatch(workspaceOf(req), req.params.id, req.body, actorOf(req)));
}));

complianceRouter.delete("/api/compliance/event-watches/:id", ...manageCompliance, asyncHandler(async (req, res) => {
  await deleteEventWatch(workspaceOf(req), req.params.id, actorOf(req));
  res.json({ status: "ok" });
}));

// Phase 4 rollout controls — workspace-wide kill switch + IntervalSec
// remote-override lever. See eventWatches.service.ts's getEventDrivenSettings
// doc comment.
complianceRouter.get("/api/compliance/event-watches-settings", ...readCompliance, asyncHandler(async (req, res) => {
  res.json(await getEventDrivenSettings(workspaceOf(req)));
}));

complianceRouter.put("/api/compliance/event-watches-settings", ...manageCompliance, asyncHandler(async (req, res) => {
  res.json(await updateEventDrivenSettings(workspaceOf(req), req.body, actorOf(req)));
}));

// Phase 4 metrics — webhook volume, debounce-collapse ratio, event-to-
// reaction latency, last 24h. See eventWatches.service.ts's
// getEventWatchMetrics doc comment.
complianceRouter.get("/api/compliance/event-watches-metrics", ...readCompliance, asyncHandler(async (req, res) => {
  res.json(await getEventWatchMetrics(workspaceOf(req)));
}));

// ── Policy CRUD (main.py:10828-10957) ──

complianceRouter.get("/api/compliance/policies", ...readCompliance, asyncHandler(async (req, res) => {
  res.json({ items: await listCompliancePolicies(workspaceOf(req)) });
}));

complianceRouter.post("/api/compliance/policies", ...manageCompliance, asyncHandler(async (req, res) => {
  const workspaceSlug = workspaceOf(req);
  const payload = compliancePolicySchema.parse(req.body);
  const created = await createCompliancePolicy(workspaceSlug, payload, actorOf(req));

  // Check the new policy against the fleet right away, in the background,
  // instead of waiting on the (not-yet-built) scheduler's next tick — see
  // main.py:10873-10880. Uses the creating admin's own session token.
  const authorization = req.header("Authorization");
  if (created.enabled && authorization) {
    void runComplianceEvaluation(authorization, workspaceSlug, [created.id], actorOf(req)).catch((e) =>
      console.warn(`[Compliance] Immediate post-create evaluation failed for policy ${created.id}: ${e}`),
    );
  }
  res.json(created);
}));

complianceRouter.put("/api/compliance/policies/:policyId", ...manageCompliance, asyncHandler(async (req, res) => {
  const workspaceSlug = workspaceOf(req);
  const payload = compliancePolicySchema.parse(req.body);
  const { updated, justEnabled, scopeChanged } = await updateCompliancePolicy(workspaceSlug, req.params.policyId, payload, actorOf(req));

  // Same immediate-check logic as create — originally only on the
  // disabled->enabled transition (main.py:10936-10942), extended to also
  // cover scopeChanged (updateCompliancePolicy's doc comment): an
  // already-enabled policy whose Device Audience, platform, deployment
  // model, segment, or conditions just changed shouldn't have to wait out
  // its own evaluationIntervalMinutes for that new scope to actually take
  // effect. A routine edit that changes neither still follows its normal
  // schedule, unchanged.
  const authorization = req.header("Authorization");
  if ((justEnabled || scopeChanged) && authorization) {
    void runComplianceEvaluation(authorization, workspaceSlug, [updated.id], actorOf(req)).catch((e) =>
      console.warn(`[Compliance] Immediate ${justEnabled ? "on-enable" : "on-scope-change"} evaluation failed for policy ${updated.id}: ${e}`),
    );
  }
  res.json(updated);
}));

complianceRouter.delete("/api/compliance/policies/:policyId", ...deletePolicy, asyncHandler(async (req, res) => {
  res.json(await deleteCompliancePolicy(workspaceOf(req), req.params.policyId, actorOf(req)));
}));

// ── Evaluation (main.py:11376-11428) ──

complianceRouter.post("/api/compliance/evaluate", ...readCompliance, asyncHandler(async (req, res) => {
  const authorization = req.header("Authorization");
  const workspaceSlug = req.header("X-Workspace-Slug");
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
  const payload = evaluateNowSchema.parse(req.body ?? {});
  const policyIds = payload.policyId ? [payload.policyId] : null;
  const summary = await runComplianceEvaluation(authorization, workspaceSlug, policyIds, actorOf(req));

  // Only worth an Audit Log entry when something was actually found (main.py:11400-11414).
  if (summary.violationsFound > 0) {
    const { recordAuditEvent } = await import("../../services/auditLog");
    await recordAuditEvent(workspaceSlug, {
      category: "policy", action: "policy_evaluation_run", actor: actorOf(req),
      message: `Manually evaluated ${summary.evaluatedPolicies} polic${summary.evaluatedPolicies === 1 ? "y" : "ies"} against ${summary.devicesChecked} device${summary.devicesChecked !== 1 ? "s" : ""} — ${summary.violationsFound} new violation${summary.violationsFound !== 1 ? "s" : ""}`,
    });
  }
  res.json(summary);
}));

// POST /api/compliance/evaluate-due — external-cron-triggerable alternative
// to this container's own in-process Compliance scheduler loop
// (complianceJobs.ts's runComplianceSchedulerTick, already running every
// 60s unattended). Secret-gated (TRIGGER_SECRET), not dashboard-token
// gated — there's no human session behind an external cron call. See
// docs/README.md's TRIGGER_SECRET row: only needed if a deployer wants an
// external scheduler to drive this instead of relying on the built-in loop.
complianceRouter.post("/api/compliance/evaluate-due", verifyTriggerSecret, asyncHandler(async (_req, res) => {
  await runComplianceSchedulerTick();
  res.json({ status: "ok" });
}));

complianceRouter.get("/api/compliance/policies/:policyId/violating-device-ids", ...readCompliance, asyncHandler(async (req, res) => {
  res.json({ deviceIds: await getPolicyViolatingDeviceIds(workspaceOf(req), req.params.policyId) });
}));

// ── Violations review queue (main.py:11429-11599) ──

complianceRouter.get("/api/compliance/violations", ...readCompliance, asyncHandler(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const offset = req.query.offset ? Number(req.query.offset) : 0;
  res.json(await listComplianceViolations(workspaceOf(req), status, limit, offset));
}));

complianceRouter.get("/api/compliance/violations/export", ...readCompliance, asyncHandler(async (req, res) => {
  const workspaceSlug = workspaceOf(req);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const csv = await exportComplianceViolationsCsv(workspaceSlug, status);
  const filename = `compliance-violations-${workspaceSlug.replace(/[^a-zA-Z0-9_-]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.send(csv);
}));

complianceRouter.post("/api/compliance/violations/:violationId/approve", ...readCompliance, asyncHandler(async (req, res) => {
  const authorization = req.header("Authorization");
  const workspaceSlug = req.header("X-Workspace-Slug");
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
  res.json(await approveViolationCore(req.params.violationId, workspaceSlug, authorization, actorOf(req)));
}));

complianceRouter.post("/api/compliance/violations/bulk-approve", ...bulkTriage, asyncHandler(async (req, res) => {
  const authorization = req.header("Authorization");
  const workspaceSlug = req.header("X-Workspace-Slug");
  if (!authorization || !workspaceSlug) throw new HttpError(401, "Missing credentials");
  const payload = bulkViolationIdsSchema.parse(req.body);
  res.json(await bulkApproveViolations(payload.violationIds, workspaceSlug, authorization, actorOf(req)));
}));

complianceRouter.post("/api/compliance/violations/:violationId/dismiss", ...readCompliance, asyncHandler(async (req, res) => {
  res.json(await dismissViolationCore(req.params.violationId, workspaceOf(req), actorOf(req), req.header("Authorization")));
}));

complianceRouter.post("/api/compliance/violations/bulk-dismiss", ...bulkTriage, asyncHandler(async (req, res) => {
  const payload = bulkViolationIdsSchema.parse(req.body);
  res.json(await bulkDismissViolations(payload.violationIds, workspaceOf(req), actorOf(req), req.header("Authorization")));
}));
