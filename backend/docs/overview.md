# Overview — Admin Guide

The **Overview** page is the dashboard landing screen — a customizable grid of widgets pulling live data from every part of SOAR: your Applivery device fleet, App Distribution, Compliance Policies, Cases, Workflows, Applivery's own native events, inbound third-party triggers, and the built-in intelligence catalogs (OS updates, vulnerabilities, OS lifecycle, app updates). It's meant to be a single-screen situational-awareness board that you fully control — add, remove, resize, and reconfigure any widget — rather than a fixed report.

A brand-new workspace doesn't start blank: it ships with four starter widgets (Organisation Profile, Devices by OS, Compliance Status, and a Download Trends chart) so there's always something to look at while you build out your own layout.

## What you can add — the full widget catalog

Click **+ Add Widget** (top right) to open the widget builder. Widgets are organized into 18 groups:

| Group | Widgets |
|---|---|
| UEM · Devices | Device list, Devices by OS, Devices by state, Compliance status, Battery levels, Device models, OS available updates, OS version distribution, Sync failures, Devices enrollment trend |
| UEM · Users & Segments | Device employees (UEM), UEM collaborators, Segments |
| App Distribution · Apps | Enterprise apps & builds, Builds by OS, Downloads trend, Builds trend |
| App Distribution · Users | Store users (employees), Store collaborators, Collaborator roles |
| System | Organisation profile |
| Compliance (SOAR) | Compliance Policies, Devices in violation, Violations by policy, Violations trend, Review queue status, autoRun safety interventions |
| Compliance Frameworks (SOAR) | Framework coverage (ISO 27001 / ENS / NIS2), ISO 27001 compliance status, ENS compliance status (mp.eq), NIS2 compliance status (Art. 21) |
| Cases (SOAR) | Cases by status, Open cases by severity, Cases by source, Cases opened trend, Case SLA status, Case MTTR trend, Threat intel verdicts, Ticketing sync status, MITRE ATT&CK coverage |
| Workflows & Risk (SOAR) | Workflow runs by outcome, Workflow runs trend, Device risk distribution, Device risk trend |
| Applivery Events (SOAR) | Events by type, Events received trend, Automation outcomes |
| Geofencing (SOAR) | Devices per geofence zone, Devices inside/outside zones, Geofence location freshness |
| Operations (SOAR) | System health |
| OS Updates (SOAR) | OS update catalog, OS update device status |
| Vulnerability Intel (SOAR) | Apple/Android vulnerability catalog, Apple/Android vulnerability device status, Vulnerability Service device status |
| OS Lifecycle (SOAR) | OS lifecycle catalog, OS lifecycle device status |
| App Updates (SOAR) | Apple app updates |
| 3rd-Party Events (SOAR) | Inbound trigger fires, Inbound trigger fires trend |

That's roughly 58 selectable widgets in total. Every widget also has a built-in "what does this number mean" explanation — see [The widget info icon](#the-widget-info-icon) below.

Several widgets on this list depend on a Settings integration actually being turned on before they show real data:
- **Vulnerability Service device status** needs [Settings → Vulnerability Service](settings.md#vulnerability-service) configured.
- **OS update catalog / device status** and **OS lifecycle catalog / device status** need nothing configured — they run automatically — but only start showing device-level results once devices have reported in.
- **Case SLA status**, **Ticketing sync status**, and **Threat intel verdicts** depend on [Settings → Case SLA Settings](settings.md#case-sla) and [Settings → Ticketing & Chat Integrations](settings.md#integrations) respectively.
- **autoRun safety interventions** only has data once at least one [Compliance Policy](compliance.md#policy-builder) has auto-run enabled and something has actually been capped or blocked.
- The three **Geofencing (SOAR)** widgets only have data once at least one [geofence zone](geofencing.md) exists and at least one enabled Compliance Policy uses a Geofence Zone condition — that's what puts devices into the background location refresher's scope in the first place. All three read the same `DeviceLocation` rows the geofence evaluator itself uses; a device whose location has never been successfully fetched counts as "no location data yet" rather than being silently dropped or plotted at a bogus position.

## Chart types

Not every chart type is offered for every widget — the app looks at what shape of data a source actually returns and only offers chart types that make sense for it:

- **Scorecard** — one big number. Best for a single running total (e.g. total devices).
- **Gauge** — a semicircular arc showing one category as a % of the total. Good for a binary/dominant-state read (e.g. "% compliant").
- **Donut** — grouped categories in a ring with a total in the center and a legend.
- **Pie** — the same grouped-category chart as donut, filled (no center hole/total).
- **Bar** — vertical bars comparing categories side by side.
- **Line** — a time-series trend line with a filled area underneath; only offered for "…trend" data sources.
- **Radar** — a multi-axis "spider" chart comparing several categories at once.
- **List** — a ranked breakdown of rows (label + value), the most compact way to see many categories.
- **Bars** — the same row list as List but with a horizontal fill bar per row, so relative size is visible at a glance.

In practice: sources that are one flat number (e.g. Organisation profile) only offer Scorecard. Simple counts of a list (total devices, total users, segments) offer Scorecard/Gauge/Donut/List/Bars. Sources with a handful of stable categories (Devices by OS, Collaborator roles) unlock everything. Sources with many/unbounded categories (device models, OS versions) drop Donut/Pie/Radar/Gauge — too many slices to read — and keep Scorecard/Bar/List/Bars. Pre-aggregated 2–3 state buckets (compliant/non-compliant, battery bands) offer everything except Radar. Any "…trend" source only offers Line.

## Widget sizes

The grid is 12 columns wide:

- **Small** — 4 widgets fit per row.
- **Wide** (half) — 2 widgets fit per row.
- **Large** (full) — 1 widget takes the whole row.

All three sizes share the same row height; Large/Wide widgets are just taller as well as wider.

## Adding, editing, and arranging widgets

**Add a widget**: click **+ Add Widget** (top right, next to the date-range button). A slide-out panel opens from the left edge:
1. Type a **Widget Title**.
2. Click **Data Source** to open the grouped dropdown (the full catalog above).
3. If the source supports it, set optional **Filters** (OS, compliance status, role, authentication origin, "not reported in 24h" — only shown for a handful of sources like Device list, Enterprise apps, and collaborators).
4. Pick a **Visual Style** (chart type) from the tiles valid for that source.
5. Pick a **Card Size** (Small / Wide / Large).
6. Click **Add Widget**.

**Edit a widget**: open its "⋯" menu → **Edit widget**. The same panel opens pre-filled; the button reads **Save Changes**.

**Move or resize**: every unlocked widget has a drag handle across its body — click and drag to reposition, or drag a corner to resize. It snaps to the 12-column grid.

**Lock a widget in place**: "⋯" menu → **Lock position**. A locked widget can't be dragged or resized — useful for pinning a key metric while you rearrange everything else around it. Toggle again to unlock.

**Remove a widget**: "⋯" menu → **Hide widget** / **Remove widget** — removes it from the dashboard immediately.

**Save your layout**: any add/edit/move/resize/remove/lock marks the dashboard as having unsaved changes and a **Save Changes** button appears top right (it briefly reads "Saved" on success). Until you click it, layout changes are local to your browser session only.

## The widget info icon

Every widget header has a small ⓘ button next to its "⋯" menu. Clicking it opens a larger view of the same chart with exact values in the legend (not just the compact card version), and — most usefully — a **"How is it calculated?"** box with a plain-English explanation of exactly what the metric counts and how, plus a link out to Applivery's own metrics documentation. This is the fastest way to understand what a number actually means before you build a Compliance Policy or report around it.

## Date range and segment filtering

**Date range**: top right, a button shows the current range (e.g. "01/07/26 – 20/07/26"). Click it for presets — Today, Yesterday, Last 7 Days, Last 30 Days, This Month, Last Month, or a Custom Range. Changing the range clears and re-fetches every widget on the page; there's no per-widget override — the range applies globally.

**Segment**: the segment picker lives in a slide-out panel on the left edge of the whole app (hover the thin strip at the very edge, or use the toggle). Selecting a segment shows a badge next to "Dashboard Overview" and re-scopes every widget's data to that segment (and its children, if "Show children elements" is on). Click **Reset** in the panel, or select **Global**, to clear it.

## Refresh cadence

Overview widgets refresh automatically about once a minute while you're viewing the page, in addition to refetching immediately whenever you change the date range, segment, or widget list. No manual refresh is needed.

## Related guides

- [Devices](devices.md) — the fleet data behind most UEM widgets.
- [Compliance](compliance.md) — Compliance Policy and violation widgets.
- [Cases](cases.md) — Case-related widgets, including SLA and ticketing sync.
- [Workflows](workflows.md) — workflow run and Firewall/risk widgets.
- [Geofencing](geofencing.md) — the zone/location data behind the Geofencing (SOAR) widgets.
- [Settings](settings.md) — turn on the integrations several widgets depend on (Vulnerability Service, Ticketing & Chat, Threat Intel).
