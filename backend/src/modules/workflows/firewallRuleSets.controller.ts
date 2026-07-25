import { Router } from "express";
import { verifyDashboardToken } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import {
  createFirewallRuleSet,
  deleteFirewallRuleSet,
  FIREWALL_RULESET_TEMPLATES,
  listFirewallRuleSets,
  updateFirewallRuleSet,
  type FirewallRuleSetPayload,
} from "./firewallRuleSets.service";

/** Port of main.py:5390-5486 — Firewall Rule Sets CRUD + starter templates. */

export const firewallRuleSetsRouter = Router();

const readGate = [verifyDashboardToken, requirePermission({ area: "workflows", level: "read" })];
const manageGate = [verifyDashboardToken, requirePermission({ area: "workflows", level: "manage" })];
const deleteGate = [verifyDashboardToken, requirePermission({ area: "workflows", level: "manage", action: "canDeletePolicyOrWorkflow" })];

function workspaceOf(req: { header(name: string): string | undefined }): string {
  return req.header("X-Workspace-Slug") || "global";
}
function actorOf(req: { dashboardUser?: { sub?: string } }): string {
  return req.dashboardUser?.sub ?? "unknown";
}

firewallRuleSetsRouter.get("/api/firewall-ruleset-templates", ...readGate, asyncHandler(async (_req, res) => {
  res.json({ items: FIREWALL_RULESET_TEMPLATES });
}));

firewallRuleSetsRouter.get("/api/firewall-rulesets", ...readGate, asyncHandler(async (req, res) => {
  res.json({ items: await listFirewallRuleSets(workspaceOf(req)) });
}));

firewallRuleSetsRouter.post("/api/firewall-rulesets", ...manageGate, asyncHandler(async (req, res) => {
  const authorization = req.header("Authorization");
  if (!authorization) throw new HttpError(401, "Missing credentials");
  const payload = req.body as FirewallRuleSetPayload;
  res.json(await createFirewallRuleSet(authorization, workspaceOf(req), payload, actorOf(req)));
}));

firewallRuleSetsRouter.put("/api/firewall-rulesets/:ruleSetId", ...manageGate, asyncHandler(async (req, res) => {
  const authorization = req.header("Authorization");
  if (!authorization) throw new HttpError(401, "Missing credentials");
  const payload = req.body as FirewallRuleSetPayload;
  res.json(await updateFirewallRuleSet(authorization, workspaceOf(req), req.params.ruleSetId, payload, actorOf(req)));
}));

firewallRuleSetsRouter.delete("/api/firewall-rulesets/:ruleSetId", ...deleteGate, asyncHandler(async (req, res) => {
  res.json(await deleteFirewallRuleSet(workspaceOf(req), req.params.ruleSetId, actorOf(req)));
}));
