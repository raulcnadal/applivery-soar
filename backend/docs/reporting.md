# Reporting — Admin Guide

**Reporting** builds, schedules, and templates **PDF reports** summarizing whatever the dashboard tracks — device fleet stats, compliance/framework status, cases, workflows, risk, vulnerabilities, OS lifecycle, App Distribution, geofencing — using the same widget catalog as the [Overview](overview.md) dashboard. Reached via three sub-tabs: **Builder**, **Schedules**, and **Template**.

## Builder tab

Click **Create Report** to open the Report Builder:

1. **Report Name** — free text, e.g. "Weekly Compliance Report."
2. **Select Data Sources** — the same widget catalog as Overview (minus "Organisation profile," which isn't chart/table-shaped) — any metric available as an Overview widget can go in a report.
3. **Time Lapse** — Last 7 Days / Last 30 Days / All Time. No custom date picker here.
4. **Filters** — Operating System, Compliance, Role, Auth Origin, and a "hide devices not reported in last 24h" checkbox. There's no in-modal segment picker — whatever [Segment](devices.md) is currently selected in the left sidebar at generation time is applied automatically.
5. **Display Options** — Trend Charts (Line/Bar), Distribution Charts (Donut/Pie/Bar/Radar), Data Tables (Standard/Progress Bars) — toggle each on/off independently.
6. **Delivery** — Download PDF directly, Send to Webhook, Send via Email (reveals a recipients box). Note: **"Send to Webhook" doesn't attach the PDF** — it fires a chat notification ("Analytics Report Generated…") with no file attached. Only Download and Email actually deliver the PDF itself.
7. **Automation & Scheduling** (toggle on/off) — Frequency (Daily / Weekly-Mondays / Monthly-1st), Execution Time, Timezone, Start Date. Only relevant if you're saving this as a recurring schedule.

**Generate Now** renders the report immediately server-side and, per your Delivery choices, downloads it to your browser and/or emails it. The button reads "Generating…" while in flight.

**Save Schedule** (only visible with Scheduling on) saves the config as a recurring definition and switches to the Schedules tab — it does **not** generate a report right away.

## Schedules tab

The list is a searchable, sortable table — the same list experience as the Devices view: a search box (matches name and recipients), a frequency filter (All/Daily/Weekly/Monthly), and sortable columns (Report, Frequency, Sources). Each row also shows the execution time + timezone and recipients if email delivery is on. Below 768px wide, the table becomes a stacked card list instead.

- **Run now** — generates immediately using the schedule's saved config, and **always downloads a PDF to your browser** regardless of that schedule's own "Download PDF directly" setting — a manual run always drops a copy locally in addition to whatever email/webhook delivery is configured.
- **Edit** — reopens the Builder pre-filled.
- **Delete** — removes it (confirm-gated).

There's no separate "pause" control — to pause a schedule without deleting it, edit it and turn the Automation & Scheduling toggle off.

Recurring delivery only supports **email** and the **chat webhook** notification described above — no generic webhook file delivery, Slack/Teams, SMS, or other channel.

**How it actually fires**: a background job wakes every 60 seconds and, for every enabled schedule, resolves the workspace's stored [Automation Credential](settings.md#workspace-automation) (skipping — and logging — any workspace without one configured), checks whether the current local time/day matches the schedule's frequency/time/timezone, and if so generates and delivers the report exactly as described above, using the workspace-level email/webhook settings (not anything per-schedule beyond recipients). This runs even when nobody is logged in, which is exactly why the Automation Credential is required.

## Template tab

Opens a **Custom HTML Template** editor — a raw code textarea, not a visual/WYSIWYG editor. Use Jinja2 syntax to inject data (e.g. `{{ Report_Title }}`); leave it blank to use the built-in default template. Two links above the editor:

- **Download default template** — downloads the built-in template's actual source (in the same Jinja2-subset grammar described below), as a real starting point rather than reverse-engineering the grammar from this doc alone.
- **Preview current template** — opens a new tab rendering whichever template is currently active (your saved custom one, or the built-in default if none is set) against sample data, so you can see roughly what a real report will look like without waiting for the next scheduled run or spending a Generate Now.

The **default template** defines the PDF's whole visual identity: a blue top bar with your logo/wordmark and workspace name, a metadata bar (workspace, sources analyzed, applied filters), one card per selected data section (chart image + optional table), and a fixed footer. Available template variables: `Workspace_Name`, `Report_Title`, `Generated_Date`, `Time_Lapse`, `metadata`, and `report_sections` (each with a title, chart image, optional table, and full-width flag) — a custom template only ever gets `html_table` for a section, never a chart image; bring your own visualization if you need one.

This is a single, deployment-wide setting — not per-workspace, despite living under a specific workspace's Settings — saved once and used verbatim for every future report/schedule across every workspace until you change it again. **Reset to Default** clears it back to the built-in template (confirm-gated). **Apply & Save** validates the template server-side before persisting it (balanced `{% for %}`/`{% if %}` blocks, only supported loop sources, looks like a real HTML document, and actually renders against sample data without throwing) — a broken template is now rejected right in this modal with a specific error, rather than silently breaking the next scheduled report.

## Settings this view depends on

- **Email delivery** needs [Settings → SMTP](settings.md#smtp) configured (Host/Username at minimum) — the Builder shows an inline warning if it isn't.
- **Webhook delivery** needs a "Notifications Webhook URL" set under [Settings → General](settings.md#general) (this is a Google Chat webhook specifically, not a generic one) — same inline warning if missing.
- **Scheduled reports specifically** need a per-workspace [Automation Credential](settings.md#workspace-automation) — without one, that workspace's schedules are silently skipped every tick. One-off Generate Now / Run Now don't need this; they use your own logged-in session.
- **[System Health](settings.md#system-health)** is the only place you'd notice if the report scheduler itself stopped running — it tracks a heartbeat for this job and flags it overdue.

## Generation failures

If a report fails to generate, you'll see a generic "Failed to generate report" message — the app doesn't currently distinguish between a network error, a broken custom template, or a server-side rendering problem. A broken custom template specifically is now caught at save time (see Template tab above), so this is less likely than it used to be — but if it's failing across every workspace right after someone edits the Template tab, reopen it, use **Preview current template** to check, and **Reset to Default** if needed. Otherwise confirm SMTP/webhook settings if delivery (not generation) is what's failing.

## Related guides

- [Overview](overview.md) — the widget catalog reports are built from, and where to check what a metric means before including it in a report.
- [Geofencing](geofencing.md) — the Geofencing (SOAR) data sources selectable here.
- [Settings](settings.md) — SMTP, webhook URL, and Automation Credential setup.
