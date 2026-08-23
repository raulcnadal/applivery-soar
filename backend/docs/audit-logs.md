# Audit Logs — Admin Guide

A single chronological feed of every policy evaluation alert and admin action in your workspace — policy evaluations and violations, workflow events, settings changes, and system events, alongside admin actions. It's the unified activity/security log for the whole app, not raw device telemetry.

## Filters

- **Search** — matches device, policy, workflow, actor.
- **Category** — All / Policy / Workflow / Violation / Settings / System.
- **Severity** — All / Info / Warning / Critical.
- **Actor** — populated from whoever's actually appeared in the log (or "System" for automated entries).
- **Date range** — from/to.
- **Target/device chip** — set automatically when you arrive via a cross-link (see below); an exact match on the device, not a name search, since device names can collide.

**Clear filters** resets everything at once.

## What each row shows

A category icon (color-coded), the message, timestamp, actor, a severity pill, and — for device-targeted entries — an "Open {device name}" link that jumps straight to that device.

## Getting here

- From a device's **Active Violations** section in its [detail modal](devices.md#overview-tab-section-by-section) — jumps here pre-filtered to that exact device.
- From the workspace/profile menu (top right) — a plain, unfiltered **Audit Logs** entry.

## Export

**Export CSV** downloads the currently-filtered results.

## Retention

This view is display-only for retention — it shows how long events are being kept ("kept for N days" or "kept forever") but the actual setting lives under [Settings → Audit Log](settings.md#audit-log).

## Empty, loading, and error states

- Loading: "Loading audit log…"
- No events at all: "No audit events yet — policy evaluations and admin actions will show up here as they happen."
- No matches for the current filters: "No events match these filters — try widening the date range or clearing a filter."
- Load failure: a red error banner with the server's detail message.
- Results load 50 at a time with a **Load more** button and a running "Showing X of Y" count.

## Related guides

- [Devices](devices.md) — the Active Violations cross-link.
- [Compliance](compliance.md) — most policy/violation entries originate here.
- [Settings → Audit Log](settings.md#audit-log) and [Settings → Log Export](settings.md#log-export) — retention and shipping this data to an external SIEM.
