import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { decryptSecret, encryptSecret } from "../../utils/secretCipher";
import { CASE_SEVERITIES, CASE_SEVERITY_RANK } from "../cases/cases.schemas";
import { INTEGRATION_TYPES, type ExternalRef, type IntegrationPayload } from "./integrations.schemas";

/**
 * Chat/Ticketing/Paging integrations — CRUD, secret-at-rest encryption, and
 * the dispatch functions Cases fire on open/reopen/close and on SLA breach.
 * Port of main.py:13270-13923 (Integrations CRUD + `_send_chat_notification`
 * / `_send_pagerduty_event` / `_send_opsgenie_event` / `_create_jira_issue` /
 * `_create_servicenow_incident` / `_transition_jira_issue` /
 * `_close_servicenow_incident` / `_fetch_jira_issue_status` /
 * `_fetch_servicenow_incident_status` / `_dispatch_case_integrations` /
 * `_dispatch_case_sla_breach` / `_attach_external_refs` / `test_integration`).
 */

// Shape any caller (Cases, background jobs) can hand to the dispatch
// functions below without importing the real Prisma Case type — decouples
// this module from cases.service.ts to avoid a circular import.
export interface DispatchableCase {
  id: string;
  title: string;
  severity: string;
  status: string;
  source: string;
  deviceName?: string | null;
  policyName?: string | null;
  externalRefs: ExternalRef[];
}

const INTEGRATION_SECRET_FIELDS: Record<string, readonly string[]> = {
  slack: ["webhookUrl"], teams: ["webhookUrl"], discord: ["webhookUrl"],
  generic_webhook: ["url"],
  jira: ["apiToken"],
  servicenow: ["password"],
  pagerduty: ["routingKey"],
  opsgenie: ["apiKey"],
};

function encryptIntegrationConfig(type: string, config: Record<string, any>): Record<string, any> {
  const out = { ...(config ?? {}) };
  for (const field of INTEGRATION_SECRET_FIELDS[type] ?? []) {
    if (out[field]) out[field] = encryptSecret(String(out[field]));
  }
  return out;
}

function decryptIntegrationConfig(type: string, config: Record<string, any>): Record<string, any> {
  const out = { ...(config ?? {}) };
  for (const field of INTEGRATION_SECRET_FIELDS[type] ?? []) {
    if (out[field]) {
      try {
        out[field] = decryptSecret(String(out[field]));
      } catch {
        // Malformed/foreign value — leave as-is rather than throwing, same
        // fail-open trade-off as _decrypt_secret_migrating.
      }
    }
  }
  return out;
}

function serializeIntegration(row: {
  id: string; workspaceSlug: string; name: string; type: string; enabled: boolean;
  notifyOnOpen: boolean; notifyOnClose: boolean; minSeverity: string;
  autoCloseCaseOnRemoteResolve: boolean; notifyOnSystemHealth: boolean; config: unknown;
  createdBy: string | null; lastFiredAt: Date | null; fireCount: number; lastError: string | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: row.id, name: row.name, type: row.type, enabled: row.enabled,
    notifyOnOpen: row.notifyOnOpen, notifyOnClose: row.notifyOnClose, minSeverity: row.minSeverity,
    autoCloseCaseOnRemoteResolve: row.autoCloseCaseOnRemoteResolve, notifyOnSystemHealth: row.notifyOnSystemHealth,
    config: decryptIntegrationConfig(row.type, (row.config as Record<string, any>) ?? {}),
    createdBy: row.createdBy, lastFiredAt: row.lastFiredAt?.toISOString() ?? null,
    fireCount: row.fireCount, lastError: row.lastError,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

// Never echo secrets back in a way a screen-share might show is nice, but
// this list view is dashboard-token-gated exactly like every other settings
// list in this app (e.g. device-report-secret) — the edit form re-fetches
// via this same list. Documented trade-off, not an oversight; port of
// list_integrations' own comment (main.py:13343-13352).
export async function listIntegrations(workspaceSlug: string) {
  const rows = await prisma.integration.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
  return { items: rows.map(serializeIntegration) };
}

function validateIntegrationPayload(payload: IntegrationPayload) {
  if (!(INTEGRATION_TYPES as readonly string[]).includes(payload.type)) {
    throw new HttpError(400, `type must be one of ${JSON.stringify(INTEGRATION_TYPES)}`);
  }
  if (!(CASE_SEVERITIES as readonly string[]).includes(payload.minSeverity)) {
    throw new HttpError(400, `minSeverity must be one of ${JSON.stringify(CASE_SEVERITIES)}`);
  }
}

export async function createIntegration(workspaceSlug: string, payload: IntegrationPayload, actorEmail: string) {
  validateIntegrationPayload(payload);
  const created = await prisma.integration.create({
    data: {
      workspaceSlug, name: payload.name, type: payload.type, enabled: payload.enabled,
      notifyOnOpen: payload.notifyOnOpen, notifyOnClose: payload.notifyOnClose, minSeverity: payload.minSeverity,
      autoCloseCaseOnRemoteResolve: payload.autoCloseCaseOnRemoteResolve, notifyOnSystemHealth: payload.notifyOnSystemHealth,
      config: encryptIntegrationConfig(payload.type, payload.config),
      createdBy: actorEmail,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "integration", action: "integration_created", actor: actorEmail,
    targetType: "integration", targetId: created.id, targetName: created.name,
    message: `${created.type} integration "${created.name}" created by ${actorEmail}`,
  });
  return serializeIntegration(created);
}

export async function updateIntegration(workspaceSlug: string, integrationId: string, payload: IntegrationPayload, actorEmail: string) {
  validateIntegrationPayload(payload);
  const existing = await prisma.integration.findFirst({ where: { workspaceSlug, id: integrationId } });
  if (!existing) throw new HttpError(404, "Integration not found");
  const updated = await prisma.integration.update({
    where: { id: integrationId },
    data: {
      name: payload.name, type: payload.type, enabled: payload.enabled,
      notifyOnOpen: payload.notifyOnOpen, notifyOnClose: payload.notifyOnClose, minSeverity: payload.minSeverity,
      autoCloseCaseOnRemoteResolve: payload.autoCloseCaseOnRemoteResolve, notifyOnSystemHealth: payload.notifyOnSystemHealth,
      config: encryptIntegrationConfig(payload.type, payload.config),
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "integration", action: "integration_updated", actor: actorEmail,
    targetType: "integration", targetId: integrationId, targetName: updated.name,
    message: `Integration "${updated.name}" updated by ${actorEmail}`,
  });
  return serializeIntegration(updated);
}

export async function deleteIntegration(workspaceSlug: string, integrationId: string, actorEmail: string) {
  const existing = await prisma.integration.findFirst({ where: { workspaceSlug, id: integrationId } });
  if (!existing) throw new HttpError(404, "Integration not found");
  await prisma.integration.delete({ where: { id: integrationId } });
  await recordAuditEvent(workspaceSlug, {
    category: "integration", action: "integration_deleted", actor: actorEmail, severity: "warning",
    targetType: "integration", targetId: integrationId, targetName: existing.name,
    message: `Integration "${existing.name}" deleted by ${actorEmail}`,
  });
  return { status: "ok" };
}

const JIRA_REQUIRED_CFG = ["baseUrl", "email", "apiToken", "projectKey"] as const;
const SERVICENOW_REQUIRED_CFG = ["instanceUrl", "username", "password"] as const;

export async function testIntegration(workspaceSlug: string, integrationId: string, dryRun: boolean) {
  const row = await prisma.integration.findFirst({ where: { workspaceSlug, id: integrationId } });
  if (!row) throw new HttpError(404, "Integration not found");
  const cfg = decryptIntegrationConfig(row.type, (row.config as Record<string, any>) ?? {});

  if (dryRun) {
    const required: Record<string, readonly string[]> = {
      jira: JIRA_REQUIRED_CFG, servicenow: SERVICENOW_REQUIRED_CFG,
      slack: ["webhookUrl"], teams: ["webhookUrl"], discord: ["webhookUrl"],
      generic_webhook: ["url"], pagerduty: ["routingKey"], opsgenie: ["apiKey"],
    };
    const missing = (required[row.type] ?? []).filter((f) => !cfg[f]);
    if (missing.length) throw new HttpError(400, `Dry run: missing required config field(s): ${missing.join(", ")}`);
    return { status: "ok", dryRun: true, detail: "Required config fields are present. No request was sent." };
  }

  // A live test (non-dry-run) fires a harmless synthetic notification/lookup
  // — reuses the same senders the real dispatch path uses.
  const testCase: DispatchableCase = {
    id: "test", title: "Integration test", severity: "low", status: "open", source: "manual", externalRefs: [],
  };
  try {
    if (row.type === "slack" || row.type === "teams" || row.type === "discord") {
      await sendChatNotification(cfg.webhookUrl, testCase, "created", row.type);
    } else if (row.type === "generic_webhook") {
      await sendGenericWebhook(cfg, testCase, "created");
    } else if (row.type === "pagerduty" || row.type === "opsgenie") {
      await sendPagingEvent(row.type, cfg, "integration-test", "trigger", "Applivery SOAR integration test", "low");
      await sendPagingEvent(row.type, cfg, "integration-test", "resolve", "Applivery SOAR integration test", "low");
    } else {
      throw new HttpError(400, `Live test isn't supported for '${row.type}' (it would create a real ticket) — use dryRun instead.`);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, `Test failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { status: "ok", dryRun: false };
}

// ── Chat notifications (main.py:13415-13433) ──

// Exported (not just used internally) so systemHealth.service.ts's
// `fireSystemHealthAlert` can reuse the exact same senders for a
// system-health alert shaped as a minimal case-like object — same trick
// `testIntegration` uses for its fake_case, now shared with a second caller.
export async function sendChatNotification(webhookUrl: string | undefined, kase: DispatchableCase, eventType: string, kind: string): Promise<void> {
  if (!webhookUrl) throw new Error("No webhook URL configured");
  const verb: Record<string, string> = {
    created: "opened", reopened: "reopened", closed: "resolved/closed",
    sla_acknowledge_breached: "SLA BREACH — not yet acknowledged", sla_resolve_breached: "SLA BREACH — not yet resolved",
  };
  let text = `*Case ${verb[eventType] ?? eventType}:* ${kase.title}\nSeverity: *${kase.severity}*  ·  Status: *${kase.status}*  ·  Source: ${kase.source}`;
  if (kase.deviceName) text += `\nDevice: ${kase.deviceName}`;
  const body = kind === "discord" ? { content: text.replace(/\*/g, "**") } : { text };
  const res = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
}

// ── Paging: PagerDuty / Opsgenie (main.py:13435-13500) ──

const PD_SEVERITY_MAP: Record<string, string> = { low: "info", medium: "warning", high: "error", critical: "critical" };
const OG_PRIORITY_MAP: Record<string, string> = { low: "P5", medium: "P3", high: "P2", critical: "P1" };

async function sendPagerdutyEvent(cfg: Record<string, any>, dedupKey: string, action: "trigger" | "resolve", summary: string, severity = "high", details?: Record<string, unknown>): Promise<void> {
  const routingKey = cfg.routingKey;
  if (!routingKey) throw new Error("PagerDuty integration is missing its Events API v2 routing key");
  const body: Record<string, unknown> = { routing_key: routingKey, event_action: action, dedup_key: dedupKey };
  if (action === "trigger") {
    body.payload = { summary, source: "Applivery SOAR", severity: PD_SEVERITY_MAP[severity] ?? "error", custom_details: details ?? {} };
  }
  const res = await fetch("https://events.pagerduty.com/v2/enqueue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`PagerDuty returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function sendOpsgenieEvent(cfg: Record<string, any>, alias: string, action: "trigger" | "resolve", summary: string, severity = "high", details?: Record<string, unknown>): Promise<void> {
  const apiKey = cfg.apiKey;
  if (!apiKey) throw new Error("Opsgenie integration is missing its API key");
  const host = cfg.region === "eu" ? "api.eu.opsgenie.com" : "api.opsgenie.com";
  const headers = { Authorization: `GenieKey ${apiKey}`, "Content-Type": "application/json" };
  if (action === "trigger") {
    const body = {
      message: summary.slice(0, 130), alias, description: summary,
      priority: OG_PRIORITY_MAP[severity] ?? "P2",
      details: Object.fromEntries(Object.entries(details ?? {}).map(([k, v]) => [k, String(v)])),
      source: "Applivery SOAR",
    };
    const res = await fetch(`https://${host}/v2/alerts`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Opsgenie returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  } else {
    const res = await fetch(`https://${host}/v2/alerts/${encodeURIComponent(alias)}/close?identifierType=alias`, {
      method: "POST", headers, body: JSON.stringify({ source: "Applivery SOAR" }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Opsgenie returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

export async function sendPagingEvent(itype: string, cfg: Record<string, any>, dedupKey: string, action: "trigger" | "resolve", summary: string, severity = "high", details?: Record<string, unknown>): Promise<void> {
  if (itype === "pagerduty") await sendPagerdutyEvent(cfg, dedupKey, action, summary, severity, details);
  else if (itype === "opsgenie") await sendOpsgenieEvent(cfg, dedupKey, action, summary, severity, details);
  else throw new Error(`Unknown paging integration type '${itype}'`);
}

export async function sendGenericWebhook(cfg: Record<string, any>, kase: DispatchableCase, eventType: string): Promise<void> {
  const url = cfg.url;
  if (!url) throw new Error("No URL configured");
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(cfg.headers ?? {}) }, body: JSON.stringify({ event: eventType, case: kase }) });
  if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
}

// ── Ticketing: Jira / ServiceNow (main.py:13532-13661) ──

async function createJiraIssue(cfg: Record<string, any>, kase: DispatchableCase): Promise<ExternalRef> {
  const baseUrl = String(cfg.baseUrl ?? "").replace(/\/$/, "");
  if (!baseUrl || !cfg.email || !cfg.apiToken || !cfg.projectKey) throw new Error("Jira integration is missing baseUrl/email/apiToken/projectKey");
  const description = `Opened from Applivery SOAR.\n\nSeverity: ${kase.severity}\nStatus: ${kase.status}\nSource: ${kase.source}\nDevice: ${kase.deviceName ?? "—"}\nPolicy: ${kase.policyName ?? "—"}`;
  const body = { fields: { project: { key: cfg.projectKey }, summary: kase.title || "Untitled case", description, issuetype: { name: cfg.issueType || "Task" } } };
  const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
  const res = await fetch(`${baseUrl}/rest/api/2/issue`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Jira returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { key: string };
  return { type: "jira", id: data.key, url: `${baseUrl}/browse/${data.key}` };
}

async function createServicenowIncident(cfg: Record<string, any>, kase: DispatchableCase): Promise<ExternalRef> {
  const instanceUrl = String(cfg.instanceUrl ?? "").replace(/\/$/, "");
  if (!instanceUrl || !cfg.username || !cfg.password) throw new Error("ServiceNow integration is missing instanceUrl/username/password");
  const table = cfg.table || "incident";
  const urgency = ({ critical: "1", high: "1", medium: "2", low: "3" } as Record<string, string>)[kase.severity] ?? "2";
  const body = {
    short_description: kase.title || "Untitled case",
    description: `Opened from Applivery SOAR.\nSeverity: ${kase.severity}\nStatus: ${kase.status}\nSource: ${kase.source}\nDevice: ${kase.deviceName ?? "—"}`,
    urgency, impact: urgency,
  };
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  const res = await fetch(`${instanceUrl}/api/now/table/${table}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Basic ${auth}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ServiceNow returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { result?: { number?: string; sys_id?: string } };
  const result = data.result ?? {};
  return { type: "servicenow", id: result.number ?? "", sysId: result.sys_id ?? null, url: `${instanceUrl}/nav_to.do?uri=${table}.do%3Fsys_id%3D${result.sys_id}` };
}

async function transitionJiraIssue(cfg: Record<string, any>, issueKey: string): Promise<void> {
  const baseUrl = String(cfg.baseUrl ?? "").replace(/\/$/, "");
  const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}` };
  const res = await fetch(`${baseUrl}/rest/api/2/issue/${issueKey}/transitions`, { headers });
  if (!res.ok) throw new Error(`Jira transitions lookup for ${issueKey} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { transitions?: Array<{ id: string; name?: string }> };
  const transitions = data.transitions ?? [];
  const match = transitions.find((t) => ["done", "resolve", "close"].some((k) => (t.name ?? "").toLowerCase().includes(k)));
  if (!match) {
    const names = transitions.map((t) => t.name ?? "?").join(", ") || "none available";
    throw new Error(`No done/resolved/closed transition found on ${issueKey} (available: ${names})`);
  }
  const res2 = await fetch(`${baseUrl}/rest/api/2/issue/${issueKey}/transitions`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ transition: { id: match.id } }),
  });
  if (!res2.ok) throw new Error(`Jira transition on ${issueKey} returned ${res2.status}: ${(await res2.text()).slice(0, 200)}`);
}

async function closeServicenowIncident(cfg: Record<string, any>, sysId: string): Promise<void> {
  const instanceUrl = String(cfg.instanceUrl ?? "").replace(/\/$/, "");
  const table = cfg.table || "incident";
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  const res = await fetch(`${instanceUrl}/api/now/table/${table}/${sysId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({ state: "6", close_code: "Closed/Resolved by Caller", close_notes: "Closed automatically from Applivery SOAR — linked Case was closed." }),
  });
  if (!res.ok) throw new Error(`ServiceNow close for sys_id ${sysId} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export interface RemoteTicketStatus {
  name: string;
  resolved: boolean;
  missing?: boolean;
}

export async function fetchJiraIssueStatus(cfg: Record<string, any>, issueKey: string): Promise<RemoteTicketStatus> {
  const baseUrl = String(cfg.baseUrl ?? "").replace(/\/$/, "");
  const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
  const res = await fetch(`${baseUrl}/rest/api/2/issue/${issueKey}?fields=status`, { headers: { Authorization: `Basic ${auth}` } });
  if (res.status === 404) return { name: "Not found", resolved: false, missing: true };
  if (!res.ok) throw new Error(`Jira status lookup for ${issueKey} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { fields?: { status?: { name?: string; statusCategory?: { key?: string } } } };
  const status = data.fields?.status ?? {};
  const category = (status.statusCategory?.key ?? "").toLowerCase();
  return { name: status.name ?? "", resolved: category === "done" };
}

export async function fetchServicenowIncidentStatus(cfg: Record<string, any>, sysId: string): Promise<RemoteTicketStatus> {
  const instanceUrl = String(cfg.instanceUrl ?? "").replace(/\/$/, "");
  const table = cfg.table || "incident";
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  const res = await fetch(`${instanceUrl}/api/now/table/${table}/${sysId}?sysparm_fields=state`, { headers: { Accept: "application/json", Authorization: `Basic ${auth}` } });
  if (res.status === 404) return { name: "Not found", resolved: false, missing: true };
  if (!res.ok) throw new Error(`ServiceNow status lookup for ${sysId} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { result?: { state?: string } };
  const state = String(data.result?.state ?? "");
  return { name: state, resolved: state === "6" || state === "7" };
}

// ── Dispatch (main.py:13724-13877) ──

/**
 * event_type: 'created' | 'reopened' | 'closed'. Fires every enabled
 * integration configured for this workspace that's gated in for this event
 * (notifyOnOpen/notifyOnClose) and severity (minSeverity). Per-integration
 * failures are caught and recorded on that integration's own lastError.
 * Returns any externalRefs created (Jira/ServiceNow ticket links) — the
 * caller attaches them to the case and persists it; this function only
 * persists the integrations list (lastFiredAt/fireCount/lastError).
 */
export async function dispatchCaseIntegrations(workspaceSlug: string, kase: DispatchableCase, eventType: "created" | "reopened" | "closed"): Promise<ExternalRef[]> {
  const integrations = await prisma.integration.findMany({ where: { workspaceSlug } });
  if (!integrations.length) return [];
  const isOpenEvent = eventType === "created" || eventType === "reopened";
  const isCloseEvent = eventType === "closed";
  const caseRank = CASE_SEVERITY_RANK[kase.severity] ?? 1;
  const newRefs: ExternalRef[] = [];

  for (const integ of integrations) {
    if (!integ.enabled) continue;
    const itype = integ.type;
    const isTicketing = itype === "jira" || itype === "servicenow";
    const cfg = decryptIntegrationConfig(itype, (integ.config as Record<string, any>) ?? {});

    // Ticketing close-sync: transition/resolve the already-linked ticket if
    // one exists for this integration, rather than creating a new one.
    if (isCloseEvent && isTicketing) {
      const ref = (kase.externalRefs ?? []).find((r) => r.type === itype);
      if (!ref) continue;
      if (caseRank < (CASE_SEVERITY_RANK[integ.minSeverity] ?? 0)) continue;
      try {
        if (itype === "jira") await transitionJiraIssue(cfg, ref.id);
        else {
          if (!ref.sysId) throw new Error("No ServiceNow sys_id on record for this ticket (opened before close-sync was added) — close it manually");
          await closeServicenowIncident(cfg, ref.sysId);
        }
        await prisma.integration.update({ where: { id: integ.id }, data: { lastFiredAt: new Date(), fireCount: { increment: 1 }, lastError: null } });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await prisma.integration.update({ where: { id: integ.id }, data: { lastError: message.slice(0, 300) } });
        console.error(`[Integrations] '${integ.name}' (${itype}) close-sync failed for case ${kase.id}: ${message}`);
      }
      continue;
    }

    if (isOpenEvent) {
      if (!integ.notifyOnOpen) continue;
    } else if (isCloseEvent) {
      if (!integ.notifyOnClose) continue;
    } else {
      continue;
    }
    if (caseRank < (CASE_SEVERITY_RANK[integ.minSeverity] ?? 0)) continue;

    try {
      if (itype === "slack" || itype === "teams" || itype === "discord") {
        await sendChatNotification(cfg.webhookUrl, kase, eventType, itype);
      } else if (itype === "jira") {
        newRefs.push(await createJiraIssue(cfg, kase));
      } else if (itype === "servicenow") {
        newRefs.push(await createServicenowIncident(cfg, kase));
      } else if (itype === "generic_webhook") {
        await sendGenericWebhook(cfg, kase, eventType);
      } else if (itype === "pagerduty" || itype === "opsgenie") {
        const action = isOpenEvent ? "trigger" : "resolve";
        const summary = `Case ${eventType === "created" ? "opened" : eventType}: ${kase.title}`;
        await sendPagingEvent(itype, cfg, `case:${kase.id}`, action, summary, kase.severity, { status: kase.status, source: kase.source, device: kase.deviceName });
      }
      await prisma.integration.update({ where: { id: integ.id }, data: { lastFiredAt: new Date(), fireCount: { increment: 1 }, lastError: null } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.integration.update({ where: { id: integ.id }, data: { lastError: message.slice(0, 300) } });
      console.error(`[Integrations] '${integ.name}' (${itype}) failed for case ${kase.id}: ${message}`);
    }
  }
  return newRefs;
}

/**
 * Fired once per case per SLA clock the moment it's first crossed
 * (case_sla_monitor_loop). Chat/webhook/paging only — deliberately NOT
 * routed through dispatchCaseIntegrations, since that function's
 * jira/servicenow branches CREATE a new ticket for 'open' events; routing an
 * SLA breach through it would silently open a second ticket. `breachKind` is
 * 'acknowledge' | 'resolve'.
 */
export async function dispatchCaseSlaBreach(workspaceSlug: string, kase: DispatchableCase, breachKind: "acknowledge" | "resolve"): Promise<void> {
  const integrations = await prisma.integration.findMany({ where: { workspaceSlug } });
  const caseRank = CASE_SEVERITY_RANK[kase.severity] ?? 1;
  const eventType = `sla_${breachKind}_breached`;
  for (const integ of integrations) {
    if (!integ.enabled || !integ.notifyOnOpen) continue;
    const itype = integ.type;
    if (!["slack", "teams", "discord", "generic_webhook", "pagerduty", "opsgenie"].includes(itype)) continue;
    if (caseRank < (CASE_SEVERITY_RANK[integ.minSeverity] ?? 0)) continue;
    const cfg = decryptIntegrationConfig(itype, (integ.config as Record<string, any>) ?? {});
    try {
      if (itype === "slack" || itype === "teams" || itype === "discord") {
        await sendChatNotification(cfg.webhookUrl, kase, eventType, itype);
      } else if (itype === "generic_webhook") {
        await sendGenericWebhook(cfg, kase, eventType);
      } else {
        await sendPagingEvent(itype, cfg, `case_sla:${kase.id}:${breachKind}`, "trigger", `SLA breach (${breachKind}) on case: ${kase.title}`, kase.severity, { status: kase.status, device: kase.deviceName });
      }
      await prisma.integration.update({ where: { id: integ.id }, data: { lastFiredAt: new Date(), fireCount: { increment: 1 }, lastError: null } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.integration.update({ where: { id: integ.id }, data: { lastError: message.slice(0, 300) } });
      console.error(`[Integrations] '${integ.name}' (${itype}) SLA breach notify failed for case ${kase.id}: ${message}`);
    }
  }
  const { sendAlertEmail } = await import("../../services/alertEmail");
  await sendAlertEmail(
    workspaceSlug,
    `[SLA Breach] ${kase.title}`,
    `A Case has breached its ${breachKind} SLA and has not been ${breachKind === "acknowledge" ? "acknowledged" : "resolved"} in time.\n\n` +
      `Title: ${kase.title}\nSeverity: ${kase.severity}\nStatus: ${kase.status}\n` +
      `Device: ${kase.deviceName || "—"}\nCase ID: ${kase.id}\n`,
  );
}

/** Port of `_sync_case_ticket_refs` (main.py:13662-13696). Mutates each ref in place; returns refs that just transitioned to resolved on THIS call. */
export async function syncCaseTicketRefs(
  externalRefs: ExternalRef[],
  integrationsByType: Map<string, { type: string; config: Record<string, any> }>,
): Promise<{ refs: ExternalRef[]; newlyResolved: ExternalRef[] }> {
  const newlyResolved: ExternalRef[] = [];
  const refs = externalRefs.map((r) => ({ ...r }));
  for (const ref of refs) {
    if (ref.type !== "jira" && ref.type !== "servicenow") continue;
    const integ = integrationsByType.get(ref.type);
    if (!integ) continue;
    const wasResolved = ref.remoteResolved ?? false;
    try {
      let status: RemoteTicketStatus | null = null;
      if (ref.type === "jira") status = await fetchJiraIssueStatus(integ.config, ref.id);
      else if (ref.sysId) status = await fetchServicenowIncidentStatus(integ.config, ref.sysId);
      if (!status) continue;
      ref.remoteStatus = status.name;
      ref.remoteResolved = status.resolved;
      ref.remoteStatusCheckedAt = new Date().toISOString();
      delete ref.remoteStatusError;
      if (ref.remoteResolved && !wasResolved) newlyResolved.push(ref);
    } catch (e) {
      ref.remoteStatusError = String(e instanceof Error ? e.message : e).slice(0, 300);
    }
  }
  return { refs, newlyResolved };
}

export function decryptIntegrationConfigForDispatch(type: string, config: Record<string, any>): Record<string, any> {
  return decryptIntegrationConfig(type, config);
}
