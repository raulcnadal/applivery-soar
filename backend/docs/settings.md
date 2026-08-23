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

Background jobs (the compliance evaluator, snapshot capture, [scheduled report sender](reporting.md#schedules-tab)) run with no human logged in, so the app needs a standing credential per workspace to keep calling Applivery's API unattended. This uses an **Applivery Service Account** Bearer token ([docs.applivery.com](https://docs.applivery.com/en/platform/api/service-accounts/)) — a static, workspace-scoped credential with no expiry or refresh cycle, purpose-built for exactly this ("Workspace-level automation scripts" is one of the use cases Applivery's own docs list). Create one from the Applivery Dashboard → Workspace Settings → Service Accounts (Admin role recommended — background jobs read and act across devices, compliance, and cases), then paste the Bearer token shown right after creation.

- **Service Account Bearer token** — pasted per workspace; validated against Applivery before it's saved, so a bad paste is caught immediately rather than failing silently on the next background job run.
- **Remove** — clears it (confirm-gated: background jobs for this workspace stop until reconfigured).

**Why not just use a signed-in admin's own session?** An earlier design ("Use this session for automation") snapshotted the signed-in admin's own Applivery access/refresh token pair and self-refreshed it in the background. That broke in production: Applivery's refresh endpoint rotates the refresh token on every call, and the admin's own browser tab was *also* independently refreshing its own copy of the same token pair every ~60 seconds while open — two consumers racing to rotate one shared token, each silently invalidating the other's copy within one refresh cycle. Re-clicking "Use this session" only ever fixed it until the next refresh on either side. A Service Account token has no refresh flow at all, so there's nothing left to race — each workspace just needs its own Service Account created once during onboarding.
- Status shows configured/not-configured, and who set it if it's a stored credential (vs. a legacy environment-variable fallback).

No permission gate — any signed-in admin can set the automation credential to be their own session.

### OS Patch Level

If your Applivery workspace already populates a **Smart Attribute** with each device's OS patch/build level (Android's Security Patch Level date, Apple's dotted version + build, Windows's full build), map it here once: a dropdown lists every Smart Attribute defined on your Applivery workspace (the same catalog the Compliance Policy Builder's own Smart Attribute picker uses), and picking one tells this app which attribute NAME to read on every device fetch.

Once mapped, every device's `osPatchLevel` field is populated automatically (`deviceNormalize.ts`) from that Smart Attribute's own per-device value — no separate API call, no per-connector configuration. Two things read it:

- **[Android Security Bulletin](#android-security-bulletin-osvdev) / [Apple Security Releases](#apple-security-releases-sofa)** — CVE lists narrow from "every CVE ever disclosed for this major version" (Android) or exact-ProductVersion-only (Apple) down to "CVEs THIS device specifically hasn't patched yet," compared against the Smart Attribute's own SPL date (Android) or version+build (Apple). Unmapped devices, or workspaces that haven't configured this mapping at all, keep the previous, coarser behavior — nothing breaks, it's purely additive precision.
- **Compliance Policy conditions** — a new **OS Patch Level** field is available in the Policy Builder, so a policy can require devices to be on/above a specific patch level directly, the same way an **OS version** condition works today.

Expected value formats (populated by your Applivery workspace, not by this app): Android `"2026-05-05"` (SPL date), Apple `"26.6.2 (25G82)"` (dotted version + build in parentheses), Windows `"10.0.28000.2704"` (full build — likely already identical to what `osVersion` reports for Windows, so mapping this mainly matters for Android/Apple).

No permission gate beyond Settings' own read/manage requirement.

## Applivery SOAR Agent

The single place to get the native Windows/macOS agent onto a device — agent binary download/publish, what it reports, and one combined Managed
Configuration bundle, instead of assembling everything by hand.

- **Applivery SOAR Agent** — download or publish the native agent binary for each platform/arch (no token required; an "Advanced" GitHub-token
  path exists as an alternative source for the same binaries).
- **Device Report Secret** — **Generate** / **Rotate** (confirm-gated — rotating immediately breaks any device still using the old secret) /
  **Remove**. The baseline credential every device needs, included in the Managed Configuration bundle below.
- **What This Agent Reports** — checkboxes for **App Inventory Reporting** (feeds [App List](apps.md#app-lists-tab) conditions and
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

### Custom Device Checks

Extends the fixed self-report attributes above into an open-ended, admin-defined catalog: rather than being limited to what the agent already
knows how to report, you define WHAT to check and the agent runs it locally on its normal report cycle. Each check has a **Platform** (Windows or
macOS), a **Key** (used to reference it from a policy), a **Name**/**Description**, and a **Checker type**:

- **Process running** — a process name is currently running.
- **Service/Launchd running** — a Windows service or macOS launchd job is loaded and running.
- **Registry value / plist key / file contents** — a specific value at a platform-specific location matches (or exists/doesn't).
- **App installed** — a specific app identifier is present.
- **Raw command** — the agent runs an arbitrary shell/PowerShell command and reports its output.

**Raw command checks execute arbitrary code on every managed endpoint the check is enabled for** — this checker type isn't gated any more
tightly than the others (RBAC's `canManage` Compliance permission covers all of them equally), so only grant Compliance-manage access to admins
you'd trust with that.

A check appears as a **Custom Check Result** condition option in the [Policy Builder](compliance.md#conditions--the-full-field-catalog) the
instant it's created — unlike Self-Reported Attributes (which only appear once a device has actually reported one), the catalog itself is the
source of truth, so you can wire a check into a policy before a single device has reported back yet. The Policy Builder only offers check keys
whose platform matches the policy's own target platform.

Results come back inside the agent's normal report payload — no separate check-in.

## mTLS Agent Authentication

Replaces the shared `X-Device-Report-Secret` with per-device client certificates — each device gets its own keypair and a short-lived cert that
renews itself automatically. Fully additive/opt-in until enforcement is turned on. Every mutating control requires the `canManageMtlsCA`
permission. Supported on both Windows and macOS agents.

- **Certificate Authority** — generate one (choice of key algorithm, leaf validity) or upload an external CA cert + key. **Download CA
  certificate** grabs the public cert (no private key) as `soar-ca.pem`, ready to paste into a reverse proxy's `ssl_client_certificate`
  directive — no separate export step needed.
- **Global Bootstrap Token** — one value, the SAME on every device in the fleet (not per-device, not one-time). A device proves it's allowed to
  register with this token PLUS a live check that its own serial number is currently a known, enrolled device in this workspace's Applivery UEM
  fleet — only devices Applivery already knows about can ever register. Issued immediately on success, no admin approval step. A device that
  already has an active certificate can never be silently re-registered by it. Deployed automatically as part of
  [Applivery SOAR Agent](#applivery-soar-agent)'s combined download once generated here.
- **Reverse Proxy Configuration** — a status card plus a **View configuration** button opening the exact nginx/NPM config reference (with your
  workspace's actual header names) and a live status check for whether the internal proxy secret is configured on this backend. Required before
  enforcement below will work — without it, every mTLS-gated request fails closed (503). **Requires a separate subdomain dedicated to agent
  traffic** — the **Agent subdomain** field inside that modal (e.g. `agents.yourdomain.com`, saved via its own **Save** button,
  `canManageMtlsCA`-gated) is the single source of truth: TLS client-certificate verification is a whole-domain setting in nginx (and most
  reverse proxies), never scoped to a URL path, so it cannot be added to the same proxy host serving the dashboard without breaking normal
  browser access to it. Applivery SOAR Agent's **Agent Base URL** reads this value back read-only, so there's exactly one place to change it.
- **Issued Device Certificates** — a status-count summary (active/expiring-soon/expired/revoked/superseded) plus a **View all** button opening a
  scrollable list of the full issued fleet, each row showing the matched device name, its serial number, the certificate's SHA-256 thumbprint,
  the assigned employee (from Applivery's own device record, when known), and a **Revoke** action — kept out of a plain inline list so this
  section stays readable as the fleet grows.
- **Enforcement** — the cutover switch: once enabled, every device-caller route requires a valid client certificate and the legacy secret stops
  being accepted for that workspace. Roll out the fleet first, then flip this.

## Log Export

Ships the [Audit Log](audit-logs.md) to external SIEM/storage systems.

**Real-time destinations**: `syslog` (host, port — RFC 5424) and `webhook` (URL, optional Authorization header) — both support a **Format** of JSON or **CEF** (Common Event Format, for ArcSight/Splunk/QRadar/Sentinel).

**Batch destinations** (once daily): `S3` (bucket, region, key prefix, access key, secret key, optional custom endpoint for S3-compatible stores like MinIO/R2), `NFS` (mounted directory path), `SFTP` (host, port, username, password or a PEM private key, remote path).

Every destination has Name, Enabled, and per-row **Test**, an inline enable/disable power toggle, Edit, and Delete.

**Deployment note**: S3 and SFTP destinations require the optional `boto3`/`paramiko` Python packages to be installed on the server (see the [deployment guide](../README.md#deployment)) — if they're missing, this page doesn't warn you proactively; it only surfaces as a failed Test or export. No permission gate on this page itself.

## Inbound Webhooks

Lets any third-party tool that can POST JSON (EDR, firewall, SIEM, IDS) fire a specific [Workflow](workflows.md) directly, bypassing Compliance Policies entirely.

**Integrating an EDR, XDR, MTD, or DEX tool specifically?** See the [Applivery SOAR Integration Guide](edr-xdr-mtd-dex-integration-guide.md) — also linked directly from this page in the app, with a PDF download — for the full notify → contain → escalate → wipe/unenroll response ladder, identity-mapping guidance, and worked payload examples.

Each trigger gets a URL of the form `.../api/triggers/fire/{id}/{secret}` — both the ID and a secret are embedded in the path, so pasting that one URL into a third-party tool is sufficient; no separate auth header is needed.

Fields: **Name**, **Workflow to run** (disabled until at least one workflow exists), **Description**, **Device lookup field** (which JSON key in the inbound body identifies the device, matched against serial number/id/MDM user email; leave blank if the workflow doesn't need a specific device target — **required** for the Resolved URL below to have anything to act on), **Enabled**, and an optional **Open a Case on fire** + severity.

There's no rule-builder for matching on payload content beyond the device-lookup field — it's unconditional: any valid POST to the URL fires the workflow. Per-row **Rotate secret** (confirm-gated, breaks the existing integration immediately, rotates BOTH the Fire and Resolve URLs since they share one secret), Edit, Delete. Gated by the same Workflows feature-area permission as the [Workflows](workflows.md) list itself (read to view, manage to create/edit/delete/rotate).

**Visibility**: each fire is recorded per device (not just as a workspace-wide total) — this is what backs the [Policy Builder](compliance.md#conditions--the-full-field-catalog)'s **Inbound Webhook Fired** condition, so a Compliance Policy can react to (or simply surface) "did this device's EDR/MTD/DEX tool actually call this webhook, and when" instead of the firing being visible only as a one-line audit-log entry.

**Fired / Resolved lifecycle**: a trigger with a Device lookup field configured gets a *second* URL, `.../api/triggers/resolve/{id}/{secret}`, shown right below the Fire URL in the trigger's row. This closes a real gap the Fire-only design had: SOAR could move a device out of compliance off an inbound Trigger firing (via the Policy Builder condition above), but had no way to hear back from the same external system that the underlying condition — the actual EDR/MTD/DEX alert — was no longer happening, so the device stayed flagged out of compliance forever even after the real problem was fixed. Point the SAME external system's "alert cleared"/"alert resolved" callback at the Resolve URL (most EDR/SIEM/alerting tools that support Fire have an equivalent), and the device recovers automatically the next time its policies are evaluated — same tag/Case cleanup as any other condition clearing. The Resolve URL never re-runs the linked Workflow or opens another Case; it only clears this trigger's own state for that one device. If the external tool genuinely can't call back on resolution, the Policy Builder condition's optional "auto-expire after N minutes" is a safety net so a device isn't stuck flagged indefinitely on a resolve that will never arrive.

## Case Auto-Run Rules

Closes a gap: Compliance Policy violations and Inbound Triggers can auto-run a workflow, but a manually-created [Case](cases.md) had no unattended path. These rules run a workflow against a manually-opened case's linked device automatically, once, at creation — **evaluated in order, first matching enabled rule fires.**

Fields: **Name**, **Workflow to run**, **Min severity** (only cases at or above this severity match), **Max fires per hour** (default 10 — a safety cap; a burst beyond this is queued for manual review instead of firing unattended), **MITRE ATT&CK filter** (optional — leave empty to match any case, or require at least one of the selected techniques), **Enabled**.

**Destructive-action acknowledgment**: if the chosen workflow contains a destructive MDM step, you must check "I understand and want this rule to fire it unattended" before you can enable it. No permission gate beyond being signed in. Picking a workflow that its own author has marked [approved to run unattended](workflows.md#unattended-auto-run-approval) pre-fills this checkbox as checked (still overridable, and never applied retroactively to a rule that's already saved).

## Applivery Events

Applivery has its own native outbound webhook system, configured entirely inside **Applivery's own console** (Workspace or App → Integrations); this page is where you receive and act on it.

- **Receiver URL** — `.../api/applivery-webhook/receive/{secret}`, shown with a **Copy** button and a link to [Applivery's own webhook docs](https://www.applivery.com/docs/platform/integrations/platform/integrations/webhooks/). Applivery's own "Create integration → Webhook" form only takes a single URL (no separate secret field on their side), so this URL — secret embedded in the path — is the one thing to paste there.
- **Webhook enabled** toggle, **Rotate secret** (confirm-gated — changes the Receiver URL immediately; update Applivery's integration afterward).
- **Per-event-type rules** — one row per Applivery event type (device enrollment, MDM user changes, builds, bug/feedback reports, certificate expiry — new types appear automatically the first time Applivery sends one, nothing to pre-configure). Each expands to: Enabled, **Open a Case** + severity, **Run a Workflow** + workflow picker, with the same destructive-action acknowledgment (and same author-set pre-fill) as Case Auto-Run Rules if the chosen workflow has a destructive step.
- **Recent events** feed — last 15, with outcome pills (fired / case opened / blocked / no automation credential / device fleet resync / etc.).

No permission gate on the settings themselves; the receive endpoint is unauthenticated by design (the secret in the URL *is* the auth).

**Per workspace**: the secret (and therefore the Receiver URL), enabled toggle, and per-event rules are all scoped to whichever workspace is currently active in SOAR — an admin with access to several workspaces needs to repeat this setup (create the integration in Applivery, paste this workspace's URL) once per workspace, the same way [Inbound Webhooks](#inbound-webhooks) triggers are per-workspace.

### Subscribing to Device Enrolled is required for smooth Agent registration

**Subscribe to the `{os}_device_enrolled` event in Applivery's own webhook configuration — this is a required step, not an optional automation, for any workspace deploying the [Applivery SOAR Agent](#applivery-soar-agent).** Independent of whether you enable a Case/Workflow rule for this event here (that toggle only controls the optional automation above), receiving a Device Enrolled event with the webhook receiver itself turned on always triggers an immediate, forced refresh of SOAR's own device fleet cache (normally refreshed lazily, on demand, with a 15-minute TTL).

This closes a real race condition: a newly enrolled device gets Applivery's Managed Configuration profile pushed to it (including this agent's `WorkspaceSlug`/`ReportSecret`/`BootstrapToken`) essentially immediately, and the agent typically attempts its first self-report or mTLS registration within seconds of installing — but that registration is validated server-side against SOAR's own device cache (an mTLS bootstrap registration specifically cross-checks the reported serial number against SOAR's current view of Applivery's fleet). If that cache is still serving a pre-enrollment snapshot when the agent's very first registration attempt lands, registration fails with no obvious cause, and previously required a manual **Refresh** on the Devices view (or waiting out the cache TTL) before retrying. Subscribing to Device Enrolled means the device is already in SOAR's own fleet view by the time the agent's registration call arrives, so first-attempt registration succeeds silently, with no admin intervention.

Without this event subscribed, agent registration on a freshly enrolled device is a race that usually — but not always — resolves itself once the 15-minute cache TTL naturally expires; subscribing removes the race entirely.

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
- Once enabled, a status panel shows last-refreshed time, a **Refresh now** button, and — after a refresh — stats: OS/app checks queried vs. failed, how many are still queued for the next tick, and how many stale cache entries were evicted (apps uninstalled, or OS versions changed). Results are cached for 24h per app/OS combo, so the automatic hourly background check normally has nothing new to query — **Refresh now** always bypasses that cache and re-checks every combo currently in the fleet, which is the button to use when troubleshooting why a device or app isn't showing risk. The stats also break `appsTotal`/`appsMapped`/`appsUnmapped` down by platform, so a gap specific to one platform (e.g. every macOS app maps but iOS/Android/Windows don't) is visible directly in the JSON rather than only in the aggregate counts.

**Permission gate**: requires `canEditIntegrationSecrets` (see [Roles](#roles)) to edit or test; without it, every field and button here is disabled with an explanatory tooltip.

## MISP

**Opt-in, per-workspace.** Connects to a customer-deployed [MISP](https://www.misp-project.org) instance and cross-references CVEs shared there against every app and OS version reported across the fleet (macOS, iOS, Android, Windows). Results **merge directly into the same risk score and CVE list** the Vulnerability Catalog and Vulnerability Service populate in the Apps view and Device modal — there's no separate "MISP findings" section anywhere in the product. When the same CVE is found by both MISP and the Vulnerability Service, the Vulnerability Service's entry wins (it carries real CVSS/EPSS/KEV data a raw MISP CPE match can't supply); a MISP-only CVE is kept with a severity derived from its MISP event's own threat level (High/Medium/Low; Undefined is treated as Medium rather than silently dropped or downgraded).

MISP has no built-in concept of "this app, this version" the way the Vulnerability Service does, so app/OS names are translated into a CPE vendor:product pair first via [cpe-guesser](https://github.com/cve-search/cpe-guesser) before querying MISP's `/attributes/restSearch` for a wildcard-matching `cpe`-typed attribute, then a second lookup pulls any `vulnerability`-typed (CVE-ID) attributes from the same MISP event(s) that CPE attribute belongs to.

- **Enabled** toggle.
- **MISP base URL** — e.g. `https://misp.yourorg.com`, no trailing slash.
- **MISP API key** — an Automation API key from your MISP instance (My Profile → Auth Keys), not a user login password. Same masked-on-save/blank-to-keep behavior as the Vulnerability Service's token, encrypted at rest.
- **Verify TLS certificate** — on by default; only turn off for an on-prem MISP instance using a self-signed certificate.
- **CPE guesser base URL** (optional) — blank defaults to the public `cpe-guesser.cve-search.org` instance (run by CIRCL, the CVE-Search project). Only app/OS names are ever sent there, never device/user/network data, but it is a third-party network call — point this at a self-hosted cpe-guesser instance instead if that isn't acceptable for your environment.
- **Refresh interval (hours)** — 1–72, default 12.
- **Test connection** and **Save**. Test hits MISP's own lightweight `/servers/getVersion` endpoint to confirm reachability and that the API key is valid, without touching any event/attribute data.
- Once enabled, a status panel shows last-refreshed time, a **Refresh now** button, and — after a refresh — stats: OS/app checks queried vs. failed, how many are still queued for the next tick, broken down by platform. Results are cached for 24h per app/OS combo, same as the Vulnerability Service; **Refresh now** always bypasses that cache. Unlike the Vulnerability Service's Worker, MISP has no bulk lookup endpoint — each combo costs a CPE guess plus up to two MISP calls, so a large fleet's first refresh queues up to 200 combos per tick rather than checking everything at once.

**Permission gate**: requires `canEditIntegrationSecrets` (see [Roles](#roles)) to edit or test.

## VulnCheck

**Opt-in, per-workspace.** Connects to [VulnCheck](https://vulncheck.com)'s hosted CVE intelligence API (free community tier — no self-hosting, unlike MISP) and cross-references CVEs against every app and OS version reported across the fleet, using the same CPE-translation approach as MISP (see [MISP](#misp) above for how that works). Also pulls VulnCheck's own KEV (Known Exploited Vulnerabilities) feed once per refresh to flag `is_kev` on matched CVEs — a second, independent KEV source alongside the Vulnerability Service's own KEV data. Results **merge into the same risk score and CVE list** the Vulnerability Catalog, Vulnerability Service, and MISP populate — no separate VulnCheck section, same "merge into the same aggregate" design as MISP.

- **Enabled** toggle.
- **VulnCheck API key** — free signup at [console.vulncheck.com](https://console.vulncheck.com). Same masked-on-save/blank-to-keep behavior as the other connectors' secrets, encrypted at rest.
- **CPE guesser base URL** (optional) — same shared translation step and same public-instance-by-default/self-hosted-override tradeoff as MISP's own field.
- **Refresh interval (hours)** — 1–72, default 12.
- **Test connection** and **Save**. Test runs a minimal, cheap KEV index query to confirm reachability and that the API key is valid.
- Once enabled, a status panel shows last-refreshed time, a **Refresh now** button, and refresh stats (OS/app checks queried vs. failed, distinct CVEs enriched this run, by platform). Results are cached for 24h per app/OS combo, same as the Vulnerability Service and MISP; **Refresh now** always bypasses that cache. Cheaper per combo than MISP (one CPE search call instead of up to three), and CVE enrichment/KEV lookups are deduplicated across the whole refresh batch rather than repeated per combo.

**Permission gate**: requires `canEditIntegrationSecrets` (see [Roles](#roles)) to edit or test.

## Binary Integrity

**Opt-in, per-workspace — but no separate credential.** A different question from the CVE-matching connectors above: instead of "is this app version known-vulnerable," it hashes each self-reported app's installed binary (Windows `.exe`, macOS app bundle's main executable) with SHA256 and looks the hash up against [VirusTotal](https://www.virustotal.com)'s file-reputation database to flag sideloaded, unverified, or tampered/malicious software — something a CVE feed can never catch, since a malicious binary usually isn't a known-CVE version of anything. This reuses the same VirusTotal connector already configured under [Threat Intel](#threat-intel); there is nothing to enable or key in here beyond the refresh interval, so this panel is disabled with a prompt to configure VirusTotal first if that connector isn't enabled yet.

The SHA256 itself is computed on-device by the Windows and macOS agents (self-reported only — Applivery's own server-fetched app inventory has no hash) and included in the existing app-report payload; nothing is hashed or uploaded from a device the agent doesn't already have installed-app visibility into. Findings are **not** merged into the CVE-based vulnerability score — a clean-hash app can still be a vulnerable outdated version, and a "no verdict" hash doesn't mean an app is CVE-free. Instead, results show as a sibling **integrity** badge next to each app in the Device detail drawer (clean, suspicious/malicious per VirusTotal's detection ratio, or unknown/error), separate from that app's vuln badge.

- **Refresh interval (hours)** — default 24. Only field here; there's no Enabled toggle or API key, since VirusTotal being enabled under Threat Intel is itself the on/off switch.
- **Save**.
- Once VirusTotal is configured, a status panel shows last-refreshed time, a **Refresh now** button, and refresh stats (hashes checked vs. failed, still queued for the next tick). Results are cached for 24h per SHA256 (hashes are identical across every device that has the same binary, so this cache is fleet-wide per hash, not per-device); **Refresh now** always bypasses that cache. Unlike the CVE connectors, this refresher never needs a live Applivery API session — it reads hashes already stored from prior app reports, so it runs even without an Automation Credential configured.

**Permission gate**: requires `canEditIntegrationSecrets` (see [Roles](#roles)) to edit or save.

## Android Security Bulletin (OSV.dev)

**Opt-in, per-workspace — but no credential at all.** Google's own Android Security Bulletin (ASB), in structured, machine-readable form via [OSV.dev](https://osv.dev)'s public "Android" ecosystem mirror — confirmed live to genuinely be the ASB (not a lookalike): each entry carries the real CVE ID, the affected AOSP component, Google's own severity rating, and the exact Security Patch Level date a device needs to have applied to be patched. Free and public — no API key, no self-hosting, no rate limit to manage. Fourth CVE source (after the Vulnerability Service, MISP, and VulnCheck), merged into the same risk score and CVE list those populate — no separate "Android Security Bulletin" section anywhere in the product.

Unlike the other three CVE connectors, this one makes no per-device or per-app query at all: the whole bulletin (~3,400 entries) is fetched as one bulk ZIP dump per refresh (`osv-vulnerabilities.storage.googleapis.com/Android/all.zip` — OSV's own documented bulk-consumption mechanism for full-ecosystem reads) and re-indexed by Android major version, so refreshing needs no Automation Credential and touches Applivery's own API zero times.

**Precision depends on [OS Patch Level](#os-patch-level) being mapped.** Out of the box, this app only knows a device's reported Android major version (e.g. "15"), so every CVE ever disclosed against that major version is surfaced regardless of whether the device has since patched — a deliberate "assume unpatched unless proven otherwise" bias, but visibly noisier than MISP/VulnCheck's per-exact-version CPE matches. If your Applivery workspace populates a Smart Attribute with each Android device's real Security Patch Level date and you map it under Settings > Workspace Automation > [OS Patch Level](#os-patch-level), results narrow automatically to only the CVEs that specific device's own SPL hasn't reached yet — no separate configuration here, this connector and Compliance conditions both just start reading the mapped value the moment it's set.

- **Enabled** toggle.
- **Refresh interval (hours)** — default 24. The bulletin itself is published monthly, so there's little value refreshing more often than daily.
- **Test connection** and **Save**. Test issues a `HEAD` request against the bulk-dump URL — there's no credential to validate, just confirms this server can actually reach it (useful for firewalled/on-prem deployments).
- Once enabled, a status panel shows last-refreshed time, a **Refresh now** button, and refresh stats (entries parsed, distinct Android major versions indexed, total CVEs indexed, stale cache entries evicted). The whole bulletin is refreshed as one unit (not per-combo like the other connectors), so a fresh refresh always re-fetches and re-parses the full dump; **Refresh now** always does this regardless of the cache TTL.

**Permission gate**: requires `canEditIntegrationSecrets` (see [Roles](#roles)) to edit or test.

## Apple Security Releases (SOFA)

**Opt-in, per-workspace — no credential.** Apple's own per-release security-content disclosures for macOS and iOS/iPadOS, republished in structured JSON by the macadmins community's [SOFA](https://sofa.macadmins.io) feed (`v2/macos_data_feed.json` and `v2/ios_data_feed.json`). Free, public, no API key. Fifth CVE source (after the Vulnerability Service, MISP, VulnCheck, and Android Security Bulletin), merged into the same risk score and CVE list those populate — no separate section.

Unlike Android Security Bulletin's major-version-only matching, this connector does **precise point-release matching**: Applivery reports a bare `osVersion` string for Apple devices with no separate build field, and that's exactly the shape SOFA's own release history uses (`"26.6.1"`, `"18.5"`, etc.), so a device's exact reported version is looked up directly against SOFA's per-track release history. For a device sitting on release R, the cached result is the union of every CVE fixed by a chronologically *later* release in the same OS track — i.e. CVEs that specific device genuinely hasn't received a fix for, not a coarse bucket. A device whose exact point release isn't (yet) in SOFA's own history falls back to the nearest older indexed version on the same platform, so a device one point release ahead of the feed's own freshness still gets a materially useful (if very slightly conservative) answer rather than nothing.

If [OS Patch Level](#os-patch-level) is mapped, the version portion of that Smart Attribute's value (e.g. `"26.6.2 (25G82)"` → `"26.6.2"`) is used for this lookup INSTEAD of Applivery's own synced `osVersion`, since it's a value the customer has deliberately populated for exactly this purpose and may be fresher. This also sharpens MISP/VulnCheck's own CPE version matching for the same device, since they read the same, now-more-precise version.

Also flags actively-exploited CVEs (SOFA's own `InKEV`/`ActivelyExploited` per-CVE signals, where present) as `is_kev`, and carries a real `Severity` rating for the subset of CVEs SOFA enriches with one — most CVE entries in the feed are bare placeholders with no severity, so expect `severity: null` on a meaningful share of results, same as MISP's raw CPE matches.

- **Enabled** toggle.
- **Refresh interval (hours)** — default 24. SOFA itself updates roughly daily; an Apple out-of-band emergency patch shows up on the next scheduled refresh.
- **Test connection** and **Save**. Test issues a `HEAD` request against both feed URLs — no credential to validate, just confirms this server can reach them (useful for firewalled/on-prem deployments).
- Once enabled, a status panel shows last-refreshed time, a **Refresh now** button, and refresh stats (OS tracks processed, exact point-release versions indexed, total CVEs indexed, stale cache entries evicted). Both feeds are refreshed as one unit per tick; **Refresh now** always re-fetches and re-parses both regardless of the cache TTL.

**Permission gate**: requires `canEditIntegrationSecrets` (see [Roles](#roles)) to edit or test.

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

**Type**: VirusTotal (API key; IPs/domains/URLs/hashes) — the only remaining provider. AbuseIPDB, Have I Been Pwned, and Generic REST were retired: an audit found the automatic IOC-extraction-from-note-text flow they fed almost never fires in this product (it only ever scans analyst-typed note text, never the structured titles the two automated case sources — compliance violations, workflow triggers — generate), and they had no other use here. VirusTotal stays both for that on-demand lookup and as the intended engine for a planned separate feature: hashing installed binaries (Windows `.exe`, macOS `.dmg`, Android `.apk`) to flag sideloaded/unverified/malicious software once the agents collect those hashes.

Common fields: Name, Type (locked once created), Enabled. **Test** runs a known-safe lookup (`8.8.8.8`).

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
| [Compliance](compliance.md) Vulnerability Service conditions | Vulnerability Service, MISP, VulnCheck, Android Security Bulletin, and/or Apple Security Releases (conditions read the same merged status) |
| [Compliance](compliance.md) Self-Reported Attribute conditions | Applivery SOAR Agent + a deployed self-report script |
| [Compliance](compliance.md) App List conditions | App List inventory sync (Applivery SOAR Agent script, or the paced background refresher) |
| [Devices](devices.md) Vulnerability Service badge/section | Vulnerability Service, MISP, VulnCheck, Android Security Bulletin, and/or Apple Security Releases (results merge into the same badge/section) |
| [Devices](devices.md) app integrity badge | Threat Intel VirusTotal provider enabled + Binary Integrity refresh interval saved + agent-reported `sha256` on the app |
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
