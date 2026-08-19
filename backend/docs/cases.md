# Cases — Admin Guide

A **Case** is the incident-tracking layer above raw detections: track investigation status, assign an owner, and keep notes across every detection of the same problem, instead of chasing individual violations one by one.

## How Cases get created

- **Compliance violation** — auto-opened the first time a device violates a [Compliance Policy](compliance.md) (if that policy has "Open a Case" turned on). If a case for that exact device+policy pair is already open, the new violation just links onto it instead of opening a duplicate. If a prior case for that pair was closed and the violation recurs, that old case **reopens** — history preserved, SLA clock restarted — rather than a fresh case being created.
- **Inbound Webhook Trigger** — a [trigger](settings.md#inbound-webhooks) with its "Open a Case" option on.
- **Applivery native event** — an [Applivery Events](settings.md#applivery-events) rule with its "Open a Case" option on.
- **Manual** — click **New Case**, fill in title, severity, and an optional first note.

A manually-created case can also fire a [Case Auto-Run Rule](settings.md#case-auto-run-rules) immediately after creation — an ordered, first-match list that auto-launches a workflow against the case's linked device.

## Case list

A table, not a kanban board — one row per case: source icon, title, source label + assignee + "updated X ago," MITRE tag pills, SLA badge, severity badge, status badge.

**Filters**: status tabs (Open, Resolved, Closed, False positive, All), free-text search (title, device, assignee, policy), severity dropdown, MITRE tactic/technique dropdowns, a "My cases" toggle, and implicit [segment](devices.md) scoping. A pill strip below the filters shows how many cases touch each MITRE tactic — click one to filter by it.

Header actions: **Export CSV** and **New Case**. Selecting rows reveals a bulk bar: **Assign to me** and **Close selected** (gated by the `canBulkTriage` permission — see [Settings → Roles](settings.md#roles)).

## Case detail drawer

1. **Header** — source, title, SLA badge.
2. **Status / Severity** — dropdowns, saved immediately.
3. **Assignee** — free text with suggestions from recent audit-log actors (there's no separate user directory; every admin authenticates with their own Applivery credential), plus an "Assign to me" shortcut.
4. **Context** — linked device, policy, violation count, workflow-run count, opened/closed timestamps.
5. **Run a workflow against this device** — only shown if a device is linked. See [Workflows](workflows.md).
6. **External ticket chips** — one per linked Jira/ServiceNow ticket, with a live remote-status pill if synced, plus **Retry integrations** and **Sync ticket status** buttons.
7. **MITRE ATT&CK tags** — pill display or an editable picker.
8. **Threat Intel** — an IOC lookup box and history of past results.
9. **Notes** — existing notes plus an add-note box.
10. **Timeline** — a reverse-chronological activity log: created, status changed, severity changed, note added, violation linked, workflow run, assignment, reopened, device recovered, SLA breached.

## Actions you can take

- Change status/severity, assign/reassign.
- Add a note — freeform text auto-scanned for IOC-looking strings (IPs, hashes, URLs, emails, domains), which get auto-enriched against your configured Threat Intel providers with no extra step.
- Edit MITRE ATT&CK tags, including a one-click **Sync from policy** if the source policy's own tags have since changed (a drift banner appears when they diverge).
- **Run a workflow** against the linked device directly from the case — blocked if the workflow has a destructive step and your role lacks `canRunDestructiveWorkflow`.
- **Retry integrations** — re-fires ticketing/chat dispatch, useful after fixing a broken webhook URL or expired token.
- **Sync ticket status** — pulls the live status of the linked Jira/ServiceNow ticket on demand.
- **Reopen** a closed/resolved case by moving its status back — restarts the SLA clock.
- Run a manual **threat-intel IOC enrichment** via the Enrich box (with a force-refresh option if it was already checked).
- **Export** the case list to CSV.
- **Bulk assign / bulk close** from the list (requires `canBulkTriage`).

## Case SLA

Every case carries two independent clocks, computed fresh on every read: **Acknowledge** (time to first assignee or move to "investigating") and **Resolve** (time to move out of open/investigating). Both anchor on the case's open (or reopen) time, so a recurring incident isn't born already breached from months ago.

The badge shows red "Resolve overdue" if the resolve clock is breached, amber "Ack overdue" if only the ack clock is, or a plain gray countdown otherwise. Breaching either fires a critical Audit Log entry, a timeline entry, and — if enabled — a one-time chat/webhook/paging notification plus an email alert. A case sitting breached for days won't repeatedly page; each clock only notifies once per case.

Thresholds are per-severity and workspace-configurable — see [Settings → Case SLA Settings](settings.md#case-sla).

## Ticketing integration (Jira / ServiceNow)

When configured with "notify on open" and the case's severity meets that integration's minimum, opening or reopening a case **automatically creates** a Jira issue or ServiceNow incident, linked back as a chip in the drawer.

**Outbound**: closing a case tries to transition the linked Jira issue to whatever looks like "done/resolve/close" (best-effort — Jira workflows are per-project custom), or moves the ServiceNow incident to Resolved.

**Inbound**: a background job checks every open case's linked ticket status every 15 minutes. If a ticket has resolved and that integration has "auto-close case on remote resolve" on, the case is automatically set to **resolved** (not "closed" — that final step is left to an analyst); otherwise it just adds a timeline note for you to act on. The same check is available on demand via **Sync ticket status**.

Configure this under [Settings → Ticketing & Chat Integrations](settings.md#integrations).

## MITRE ATT&CK tagging

Compliance-sourced cases inherit the source policy's technique tags when they first open. You can edit the tag set independently afterward; if the source policy's own tags later change, a drift banner offers a one-click sync. Tags drive the list's filter dropdowns and the "coverage by tactic" strip.

## Threat intel IOC lookups

Type an IP, domain, URL, file hash, or email into the Threat Intel box and click **Enrich**. The type is auto-detected and dispatched in parallel to every enabled provider that supports it:

- **VirusTotal** — IP, domain, file hashes, URL. The only remaining provider type — AbuseIPDB/HaveIBeenPwned/Generic REST were retired (see [Settings → Threat Intel](settings.md#threat-intel)).

Each result shows the verdict (Malicious/Suspicious/Clean/Unknown/Lookup failed), a link to the provider, how long ago it was checked, and a "Cached" pill if served from the 6-hour lookup cache (with a one-click force re-check). Configure providers under [Settings → Threat Intel](settings.md#threat-intel) — without at least one enabled, the Enrich box returns an error telling you to add one there.

## Settings this view depends on

- **[Case SLA Settings](settings.md#case-sla)** — per-severity thresholds, enable toggle, notify-on-breach.
- **[Case Auto-Run Rules](settings.md#case-auto-run-rules)** — auto-launch a workflow when a manually-created case matches a rule.
- **[Ticketing & Chat Integrations](settings.md#integrations)** — Jira/ServiceNow ticket creation and sync, Slack/Teams/Discord/webhook notifications, PagerDuty/Opsgenie paging.
- **[Threat Intel](settings.md#threat-intel)** — required before the Enrich box does anything.
- **[Roles](settings.md#roles)** — `canBulkTriage` (bulk assign/close) and `canRunDestructiveWorkflow` (running a destructive workflow from a case).

## Related guides

- [Compliance](compliance.md) — how a policy violation becomes a case.
- [Workflows](workflows.md) — running a workflow from a case.
- [Devices](devices.md) — a case's linked device and its Open Cases section.
