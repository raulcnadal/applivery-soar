# Settings — Admin Guide

The Settings modal (gear icon, top nav) has a left-hand list of sections. Some sections are configuration you actively maintain (Integrations, Roles); many of the intelligence-catalog sections are pure status/monitoring — nothing to configure beyond viewing status and clicking Refresh. This guide covers every section, in the order they appear in the nav.

## General

Workspace-wide defaults not tied to any one feature:

- **Notifications Webhook URL** — feeds the app's own outbound chat notifications (a Google Chat space webhook). Used by [Reporting](reporting.md)'s "Send to Webhook" delivery option.
- **System Timezone (for Scheduled Reports)** — used by [Reporting](reporting.md) schedules.
- **Idle Session Timeout** — 30/60/90 min, 2h/4h/8h. Signs everyone out automatically after this much inactivity.

No permission gate — any signed-in admin can edit it.

## SMTP

- **Host**, **Port**, **Username**, **Password**, **From Address**.
- **Alert Email Recipients** — a *separate* list from report delivery, used specifically for [Case SLA](#case-sla) breach and [System Health](#system-health) failure/recovery emails.
- **Send Test Email** — sends a real test message to your own signed-in email; requires host and username to be filled in first.

No permission gate beyond being signed in.

## Account

- Read-only profile (avatar, name, email).
- **Workspace** switcher, if you belong to more than one Applivery organization.
- **Sign out**.

## Backup & Restore

Two independent systems on this page:

**Dashboard-only backup** — Export/Import JSON covering only widget layout, webhook URL, and SMTP settings. Not the full configuration.

**Full Workspace Configuration** — everything you've configured: Compliance Policies, Workflows, Triggers, Integrations, Case Auto-Run Rules, Case SLA thresholds, Threat Intel providers, the Applivery inbound webhook config, the Action Library (Script/OMA-URI), App Lists, Script repos, dashboard settings, Vulnerability Service config, and the Firewall Rule Set library.

- **Export Configuration** downloads a JSON bundle. It contains every credential configured for this workspace — Jira/ServiceNow tokens, PagerDuty/Opsgenie keys, chat webhook URLs, Threat Intel API keys, and the SMTP password are encrypted at rest and stay encrypted in the export; the Applivery webhook secret is not — handle the exported file accordingly regardless.
- **Choose Import File** parses the JSON and shows a checkbox per store type found inside, with item counts. Confirming is a **destructive overwrite per selected store, not a merge** — cross-references (like a Trigger's linked workflow ID) are preserved by never regenerating IDs, but existing data in that store is fully replaced.
- **Copy from another workspace instead** opens the same picker against a sibling workspace, with items containing secrets flagged. This only works into a **completely empty** target workspace — if the target already has any data, it's rejected and you're pointed back to Export/Import instead.

**Permission gate**: requires the `canExportOrImportConfig` role permission (see [Roles](#roles)). Without it, every control here is disabled and dimmed, with an explanation banner.

## Audit Log

One dropdown: **Keep audit log events for** — 30 / 90 / 180 / 365 days, or Forever. Older events are rotated out once a day. Applies to the [Audit Logs](audit-logs.md) view and the alert history behind policy evaluations. No permission gate.

## Workspace Automation

Background jobs (the compliance evaluator, snapshot capture, [scheduled report sender](reporting.md#schedules-tab)) run with no human logged in, but Applivery API tokens are scoped per-session and expire — so the app needs a standing credential per workspace to keep calling Applivery's API unattended.

- **"Use this session for automation"** — captures your *own currently signed-in* session's tokens and stores them for background jobs to use; the stored credential self-refreshes afterward without further action.
- **Remove** — clears it (confirm-gated: background jobs for this workspace stop until reconfigured).
- Status shows configured/not-configured, and who set it if it's a stored credential (vs. a legacy environment-variable fallback).

No permission gate — any signed-in admin can set the automation credential to be their own session.

## Device Data Webhook

The single place to get the native Windows/macOS agent onto a device — agent binary download/publish, what it reports, and one combined Managed
Configuration bundle, instead of assembling everything by hand.

- **Applivery SOAR Agent** — download or publish the native agent binary for each platform/arch (no token required; an "Advanced" GitHub-token
  path exists as an alternative source for the same binaries).
- **Device Report Secret** — **Generate** / **Rotate** (confirm-gated — rotating immediately breaks any device still using the old secret) /
  **Remove**. The baseline credential every device needs, included in the Managed Configuration bundle below.
- **What This Agent Reports** — checkboxes for **App Inventory Reporting** (feeds [App List](compliance.md#app-lists-sub-view) conditions and
  [Vulnerability Service](#vulnerability-service) per-app CVE matching) and **Security Attestation Reporting** (BitLocker/FileVault + firewall —
  feeds Self-Reported Attribute compliance conditions), plus the report interval. If a [Global Bootstrap Token](#mtls-agent-authentication) is
  configured, it's included in the Windows bundle automatically — no separate opt-in, since a device with an already-active certificate can never
  be silently re-registered by it. Also shows a **read-only Agent Base URL** — defaults to this dashboard's own address, or the dedicated agents
  subdomain automatically once one is saved in [Reverse Proxy Configuration](#mtls-agent-authentication)'s **Agent subdomain** field below. That
  field is the only place this value is ever set, so every downloaded Managed Configuration always matches it — nothing to keep in sync by hand.
  When an agent subdomain is configured, the Windows bundle also sets a separate `RegisterURL` pointing back at this dashboard's own address —
  one-time registration never presents a client certificate, so it doesn't need the agent subdomain's health at all, only renewal and reporting
  do. Confirmed necessary in practice: a temporarily-broken agent subdomain (e.g. reverse-proxy cert issue) otherwise blocks brand-new device
  enrollment for no real reason, even though `/register` never touches that vhost's client-cert machinery.
- **Download Managed Configuration** — Windows Script (`.ps1`) / macOS Script (`.sh`) (recommended: paste into an Applivery Script resource and
  assign to a Policy for zero-touch fleet push), or a manually-imported Windows `.reg` / macOS `.json`.

Stays disabled until the device report secret exists. No permission gate on this page itself (publishing to Applivery requires
`canEditIntegrationSecrets`).

## mTLS Agent Authentication

Replaces the shared `X-Device-Report-Secret` with per-device client certificates — each device gets its own keypair and a short-lived cert that
renews itself automatically. Fully additive/opt-in until enforcement is turned on. Every mutating control requires the `canManageMtlsCA`
permission. Windows only today — the macOS Agent has no mTLS support yet.

- **Certificate Authority** — generate one (choice of key algorithm, leaf validity) or upload an external CA cert + key. **Download CA
  certificate** grabs the public cert (no private key) as `soar-ca.pem`, ready to paste into a reverse proxy's `ssl_client_certificate`
  directive — no separate export step needed.
- **Global Bootstrap Token** — one value, the SAME on every device in the fleet (not per-device, not one-time). A device proves it's allowed to
  register with this token PLUS a live check that its own serial number is currently a known, enrolled device in this workspace's Applivery UEM
  fleet — only devices Applivery already knows about can ever register. Issued immediately on success, no admin approval step. A device that
  already has an active certificate can never be silently re-registered by it. Deployed automatically as part of
  [Device Data Webhook](#device-data-webhook)'s combined download once generated here.
- **Reverse Proxy Configuration** — the exact nginx/NPM config reference (with your workspace's actual header names) plus a live status check for
  whether the internal proxy secret is configured on this backend. Required before enforcement below will work — without it, every mTLS-gated
  request fails closed (503). **Requires a separate subdomain dedicated to agent traffic** — the **Agent subdomain** field here (e.g.
  `agents.yourdomain.com`, saved via its own **Save** button, `canManageMtlsCA`-gated) is the single source of truth: TLS client-certificate
  verification is a whole-domain setting in nginx (and most reverse proxies), never scoped to a URL path, so it cannot be added to the same proxy
  host serving the dashboard without breaking normal browser access to it. This was tried and confirmed broken in practice before this
  two-domain design was adopted — see `backend/docs/mtls-agent-auth-roadmap.md` §5.5 for the full incident writeup and the corrected config.
  Device Data Webhook's **Agent Base URL** reads this value back read-only, so there's exactly one place to change it.
- **Certificates** — issued fleet, with per-device status (active/expiring-soon/expired/revoked/superseded) and a **Revoke** action.
- **Enforcement** — the cutover switch: once enabled, every device-caller route requires a valid client certificate and the legacy secret stops
  being accepted for that workspace. Cuts off any macOS device on the workspace entirely (no mTLS support), not just unregistered Windows ones.
  Roll out the fleet first, then flip this — see `backend/docs/mtls-agent-auth-roadmap.md` for the full runbook.

## Log Export

Ships the [Audit Log](audit-logs.md) to external SIEM/storage systems.

**Real-time destinations**: `syslog` (host, port — RFC 5424) and `webhook` (URL, optional Authorization header) — both support a **Format** of JSON or **CEF** (Common Event Format, for ArcSight/Splunk/QRadar/Sentinel).

**Batch destinations** (once daily): `S3` (bucket, region, key prefix, access key, secret key, optional custom endpoint for S3-compatible stores like MinIO/R2), `NFS` (mounted directory path), `SFTP` (host, port, username, password or a PEM private key, remote path).

Every destination has Name, Enabled, and per-row **Test**, an inline enable/disable power toggle, Edit, and Delete.

**Deployment note**: S3 and SFTP destinations require the optional `boto3`/`paramiko` Python packages to be installed on the server (see the [deployment guide](../README.md#deployment)) — if they're missing, this page doesn't warn you proactively; it only surfaces as a failed Test or export. No permission gate on this page itself.

## Inbound Webhooks

Lets any third-party tool that can POST JSON (EDR, firewall, SIEM, IDS) fire a specific [Workflow](workflows.md) directly, bypassing Compliance Policies entirely.

Each trigger gets a URL of the form `.../api/triggers/fire/{id}/{secret}` — both the ID and a secret are embedded in the path, so pasting that one URL into a third-party tool is sufficient; no separate auth header is needed.

Fields: **Name**, **Workflow to run** (disabled until at least one workflow exists), **Description**, **Device lookup field** (optional — which JSON key in the inbound body identifies the device, matched against serial number/id/MDM user email; leave blank if the workflow doesn't need a specific device target), **Enabled**, and an optional **Open a Case on fire** + severity.

There's no rule-builder for matching on payload content beyond the device-lookup field — it's unconditional: any valid POST to the URL fires the workflow. Per-row **Rotate secret** (confirm-gated, breaks the existing integration immediately), Edit, Delete. No permission gate.

## Case Auto-Run Rules

Closes a gap: Compliance Policy violations and Inbound Triggers can auto-run a workflow, but a manually-created [Case](cases.md) had no unattended path. These rules run a workflow against a manually-opened case's linked device automatically, once, at creation — **evaluated in order, first matching enabled rule fires.**

Fields: **Name**, **Workflow to run**, **Min severity** (only cases at or above this severity match), **Max fires per hour** (default 10 — a safety cap; a burst beyond this is queued for manual review instead of firing unattended), **MITRE ATT&CK filter** (optional — leave empty to match any case, or require at least one of the selected techniques), **Enabled**.

**Destructive-action acknowledgment**: if the chosen workflow contains a destructive MDM step, you must check "I understand and want this rule to fire it unattended" before you can enable it. No permission gate beyond being signed in. Picking a workflow that its own author has marked [approved to run unattended](workflows.md#unattended-auto-run-approval) pre-fills this checkbox as checked (still overridable, and never applied retroactively to a rule that's already saved).

## Applivery Events

Applivery has its own native outbound webhook system, configured entirely inside **Applivery's own console** (Workspace or App → Integrations); this page is where you receive and act on it.

- **Receiver URL** — `.../api/applivery-webhook/receive/{secret}`, with a link to Applivery's own docs on adding a webhook.
- **Webhook receiver enabled** toggle, **Rotate URL** (confirm-gated).
- **Per-event-type rules** — one row per Applivery event type (device enrollment, MDM user changes, builds, bug/feedback reports, certificate expiry — new types appear automatically the first time Applivery sends one, nothing to pre-configure). Each expands to: Enabled, **Open a Case** + severity, **Run a Workflow** + workflow picker, with the same destructive-action acknowledgment (and same author-set pre-fill) as Case Auto-Run Rules if the chosen workflow has a destructive step.
- **Recent events** feed — last 15, with outcome pills (fired / case opened / blocked / no automation credential / etc.).

No permission gate on the settings themselves; the receive endpoint is unauthenticated by design (the secret in the URL *is* the auth).

## Case SLA

- **SLA tracking enabled** and **Notify chat integrations on breach** master toggles.
- Per-severity (low/medium/high/critical) **Acknowledge within** and **Resolve within** minute thresholds, each with a live friendly-duration hint (e.g. "≈ 4h").

Breach notifications go only to configured chat integrations under [Integrations](#integrations) — never a duplicate Jira/ServiceNow ticket. No permission gate.

## System Health

**Read-only monitor — nothing to configure here.** Every background job (compliance evaluation, ticketing sync, installed-apps refresher, workflow wait-resumer, Case SLA monitor, scheduled reports, snapshots, audit log rotation, log export, script-run reconciliation, and the intelligence catalog refreshers below) records a heartbeat at the end of each run. This view is global across every workspace on the deployment, since each job iterates all workspaces internally.

Each job card shows: status (Healthy / Errored last tick / Overdue / No data yet), label, expected interval, last-run time, consecutive-error count, and the last error detail if it failed. **Overdue** specifically means the job crashed unhandled and hasn't reported in well past its own interval — that's your signal something needs attention beyond a normal transient error. Configurable *alerting* for these failures lives on the [SMTP](#smtp) page's Alert Email Recipients field, not here.

## OS Updates

**Status/monitoring only.** A rolling catalog of Microsoft's monthly Windows security updates (from MSRC's public feed, refreshed daily), matched against each Windows device's reported build to show a patch-gap count. Security Updates only — driver/feature/quality-only updates aren't covered (no structured Microsoft feed for them, and Applivery reports no per-device driver inventory).

Shows entry/month counts, last-fetched time, and a **Refresh now** button. Because Microsoft doesn't always publish a clean "this update produced build X.Y" mapping, some updates show without a confirmed build number — they're still listed for visibility but aren't counted against any specific device until extraction succeeds.

## Vulnerability Catalog

**Status/monitoring only.** A rolling Apple (iOS/iPadOS, macOS) and Android CVE catalog sourced from ENISA's EU Vulnerability Database — free, no key required, refreshed daily. Apple entries get a confirmed fixed-version comparison; Android's is coarser (major-version granularity only). Not yet factored into risk scoring.

Platform filter tabs, entry count, last-fetched time, **Refresh now**.

## Vulnerability Service

**Opt-in, per-workspace.** Connects to an Applivery-hosted Vulnerability Service (a self-hosted CloudFlare Worker) for richer CVE matching than the built-in catalog above — covers all four platforms including Windows, both OS and installed apps, with confirmed fix versions and CISA KEV/FIRST EPSS prioritization. Runs alongside, not instead of, the Vulnerability Catalog.

- **Enabled** toggle.
- **Service base URL** — e.g. `https://vuln.yourorg.workers.dev`, no trailing slash.
- **API token** — once saved, the field never shows the real value again, only a masked hint with the last 4 characters; leave it blank on future edits to keep the existing token, or type a new one to replace it. The token is encrypted at rest server-side.
- **Refresh interval (hours)** — 1–72, default 6.
- **Test connection** and **Save**.
- Once enabled, a status panel shows last-refreshed time, a **Refresh now** button, and — after a refresh — stats: OS/app checks queried vs. failed, how many are still queued for the next tick, and how many stale cache entries were evicted (apps uninstalled, or OS versions changed).

**Permission gate**: requires `canEditIntegrationSecrets` (see [Roles](#roles)) to edit or test; without it, every field and button here is disabled with an explanatory tooltip.

## OS Lifecycle

**Status/monitoring only.** Covers two independent data sources, each with its own Refresh now:

- **Lifecycle catalog** — end-of-life/active-support status for Windows, iOS/iPadOS, macOS, and Android versions (from endoflife.date, refreshed weekly). Windows editions with different support windows (Enterprise/IoT vs. consumer) are conservatively flagged end-of-life only once every edition sharing that build has lapsed.
- **Apple GDMF (Software Lookup Service)** — the source Apple's own Declarative Device Management now expects UEMs to use for exact build numbers and signing-expiration dates, refreshed daily. Shown only when the platform filter is All/Apple/macOS. When a device's exact hardware model can be confirmed against a release's supported list, "latest available" reflects that specific hardware; otherwise it falls back to the newest still-signed release fleet-wide, labeled "unconfirmed." Also lists active Rapid Security Responses separately, since they can't be compared like a normal version bump.

## Apple App Updates

**Status/monitoring only.** Tracks pending app updates for Apple/macOS devices, sourced directly from Applivery's own per-device `HasUpdateAvailable` field — exact, not a version comparison this app computes itself. Apple-only: Windows/Android report installed app versions but Applivery doesn't compute "is this outdated" for them.

**Refresh now** here **queues** a background refresh rather than running synchronously ("re-check in a minute"), since this is a per-device Applivery API call, rate-limited and shared with the App List inventory refresher. Shows a stats grid (devices with pending updates, pending instances, synced/never-synced counts, estimated full-cycle time) plus a "most common apps with an update available" breakdown.

## Integrations

Ticketing and chat integrations — notifies chat channels and/or opens a ticket whenever a [Case](cases.md) opens — scoped to Cases, not raw violations, so a device that's been broken for a week doesn't repeatedly page.

**Types**: Slack, Teams, Discord (chat — Webhook URL only), Jira (Site URL, Project key, Account email, API token, Issue type), ServiceNow (Instance URL, Table, Username, Password), Generic Webhook (URL), PagerDuty (Events API v2 routing key), Opsgenie (API key + US/EU region).

**Common fields**: Name, Type (locked once created), Enabled, Notify-on-open, Min severity. Chat types also get a "notify on close" checkbox; Jira/ServiceNow instead show "auto-syncs ticket status on close" plus an **Auto-resolve Case when ticket is done** toggle (off by default — the ticket's remote status is always recorded on the case timeline regardless of this toggle; it only controls whether the case's own status flips automatically). A separate **Notify on System Health issues** toggle (off by default) routes background-job failure/recovery alerts to this same destination.

**Test** has a **Dry run** checkbox next to it (on by default for Jira/ServiceNow) — checked, it only validates required fields are present; unchecked, it performs a real send (for Jira/ServiceNow, that means creating a real test ticket — check the target system afterward).

**Permission gate**: `canEditIntegrationSecrets` — New/Edit/Delete/Test are disabled without it.

## Threat Intel

Lets an analyst working a [Case](cases.md) manually look up an IOC (IP, domain, URL, file hash, email) — an on-demand lookup, not an automatic scan (this app has no network-flow/process telemetry to scan against).

**Types**: VirusTotal (API key; IPs/domains/URLs/hashes), AbuseIPDB (API key; IPs only), Have I Been Pwned (API key — requires HIBP's paid tier, no free option; emails only), Generic REST (a URL template with a `{{ ioc }}` placeholder, plus one optional header).

Common fields: Name, Type (locked once created), Enabled. **Test** runs a known-safe lookup (`8.8.8.8` for VT/AbuseIPDB/Generic, HIBP's official test account for HIBP).

**Permission gate**: `canEditIntegrationSecrets`.

## Roles

**Super Admin only** — hidden from the nav entirely for everyone else.

The access model, stated plainly: the Applivery workspace **Owner** is always Super Admin with full access, unconditionally — that's the only automatic bypass. Every other collaborator needs a Role whose tag values match one of their live Applivery collaborator tags, or they're **denied outright** — there is no default/fallback access level.

Two sub-views:

### Roles

Each role card shows name, description, and its mapped tag values (a role with none mapped shows a warning — it's currently unreachable). Create/Edit fields:

- **Role name**, **Description**.
- **Feature access** — a 3-way toggle (No access / View only / Manage) per area: Devices, Compliance Policies, Workflows, Cases, Integrations & Threat Intel, Reporting & Widgets, Settings, Audit Log. Note: as of this writing, the **Reporting & Widgets** and **Audit Log** toggles are not yet enforced anywhere server-side — every other area's toggle is. Don't rely on restricting either of those two to actually hide that data from a role; the other six areas behave as expected.
- **High-risk actions** — 5 independent checkboxes, orthogonal to the feature-area levels above:
  - `canDeletePolicyOrWorkflow` — delete Compliance Policies or Workflows.
  - `canRunDestructiveWorkflow` — run a workflow containing a destructive MDM step (wipe, unenroll, etc.).
  - `canEditIntegrationSecrets` — create/edit/delete/test Integrations and Threat Intel providers (also gates Vulnerability Service edits).
  - `canExportOrImportConfig` — export, import, or clone workspace configuration.
  - `canBulkTriage` — bulk-approve/dismiss violations, or bulk-update Cases.
- **Applivery collaborator tag/group values** — the tag values that earn this role; suggestions are pulled from tags actually observed on live collaborators, but you can type any value in advance of it existing.
- **Segments (optional)** — scope which segment-tagged Compliance Policies this role's holders can manage.

### Collaborators & Tags

Lists live Applivery collaborators with their current Applivery role and detected tags. **Edit** lets you change a collaborator's Applivery role or tags directly (writes straight to Applivery — the same effect as setting it in Applivery's own console).

**Test access** — a dry-run tool: pick a collaborator and it runs the exact same access-resolution logic used at real login, on demand, showing either "Would allow — Super Admin" / "Would allow — matched Role 'X' via tag 'Y'", or "Would deny" with the reason, the collaborator's actual tag candidates, and every tag value mapped across your saved roles — so a typo or casing mismatch is obvious immediately instead of surfacing later as a locked-out user.

## Settings dependency map

Quick reference for which Settings section unblocks which feature elsewhere:

| Feature | Depends on |
|---|---|
| [Compliance](compliance.md) Vulnerability Service conditions | Vulnerability Service |
| [Compliance](compliance.md) Self-Reported Attribute conditions | Device Data Webhook + a deployed self-report script |
| [Compliance](compliance.md) App List conditions | App List inventory sync (Device Data Webhook script, or the paced background refresher) |
| [Devices](devices.md) Vulnerability Service badge/section | Vulnerability Service |
| [Devices](devices.md) Firewall Rule Sets section | A [Firewall Policy Library](workflows.md#firewall-policy-library) rule set actually applied via a workflow |
| [Cases](cases.md) ticketing chips/sync | Integrations (Jira/ServiceNow) |
| [Cases](cases.md) SLA badges | Case SLA |
| [Cases](cases.md) IOC enrichment | Threat Intel |
| [Reporting](reporting.md) email delivery | SMTP |
| [Reporting](reporting.md) webhook delivery | General → Notifications Webhook URL |
| [Reporting](reporting.md) schedules actually firing | Workspace Automation |
| Log Export S3/SFTP destinations | `boto3`/`paramiko` installed server-side — see the [deployment guide](../README.md#deployment) |

## Related guides

- [Compliance](compliance.md), [Cases](cases.md), [Workflows](workflows.md), [Devices](devices.md), [Reporting](reporting.md) — where each setting's effect actually shows up.
- [Architecture guide](../ARCHITECTURE.md) — how RBAC, background jobs, and integrations are implemented server-side.
