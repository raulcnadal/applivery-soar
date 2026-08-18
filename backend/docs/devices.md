# Devices — Admin Guide

The **Devices** view is the fleet-wide inventory and management screen for every MDM-enrolled device (iOS, macOS, Android, Windows) synced from Applivery. It's where you see the whole fleet at a glance, check who's out of compliance, drill into a single device's full health/security posture, and take action — change segment/policy/tags, run a workflow, sync locations — without leaving the dashboard.

The header shows a live summary: **N devices** and, if any, **· N non-compliant**. An "Updated HH:MM" timestamp and a **Refresh** button sit top right.

## "Compliance shown" toggle

Just under the header, a two-option control decides which compliance signal drives the non-compliant count and every compliance badge on this page:

- **Applivery flag** — Applivery's own built-in `isCompliant` flag on the device record. Doesn't yet account for your Compliance Policies or any 3rd-party telemetry.
- **Compliance Policies** — SOAR's own engine: a device counts as compliant only if it isn't currently violating any enabled [Compliance Policy](compliance.md) assigned to it. More accurate and flexible until Applivery's own flag can consume custom conditions.

Your choice is saved in your browser and persists across sessions. A small "fleet risk trend" sparkline (once ≥2 days of data exist) shows the average fleet risk score over the last 14 days.

Selecting **Compliance Policies** reveals a second dropdown next to the toggle — **All policies**, or any single policy by name. Picking one scopes the entire table (device count, non-compliant count, and every row) down to just the devices currently violating that specific policy, live — the same underlying "who's violating this policy right now" data the [Playground](playground.md) globe's own policy filter uses. Switch back to **All policies**, or to the **Applivery flag** source, to clear the scope.

## Fleet table

**Columns**: a select-all checkbox, **Device** (name + platform badge), **Employee** (assigned user or "Unassigned"), **Hardware** (manufacturer/model + a color-coded battery bar), **OS Version** (version string plus up to five stacked status mini-badges, see below), **Compliance** (pill), **Risk** (sortable — tier + numeric score, plus small "active violations" / "open cases" chips), **Last Seen**, and a chevron to open the device drawer.

**OS Version mini-badges** (hover any of them for detail):
- OS update status — Up to date / N updates behind / Patch level unconfirmed.
- Vulnerability Catalog status — No known pending CVEs / N CVEs pending / Vuln status unconfirmed.
- Vulnerability Service status — pending / check stale / no known CVEs / N critical-high CVEs / known-exploited CVE present. Only appears once [Settings → Vulnerability Service](settings.md#vulnerability-service) is configured.
- OS Lifecycle status — Unsupported OS / Not on latest / Rapid Security Response available.
- App Updates status — Apps up to date / N app updates pending.

Click a device's **Risk** badge to open a "What's driving this score" popover listing each contributing factor and its point value.

**Filters/toolbar**: free-text search (device name, assigned user, tags, serial, IMEI, model), Platform pills (All/Apple/Android/Windows/macOS), a Non-compliant toggle (shows a live count), a Risk tier dropdown, Min/Max risk score inputs, and a **saved filters** dropdown so you can bookmark and reapply a filter combination. A running "N of M" count sits at the right edge of the toolbar.

**Sorting**: only the Risk column is sortable (click to cycle desc → asc → off); everything else is unsorted.

## Bulk actions

Select one or more rows via their checkboxes to reveal a bulk action bar:

- **Run workflow…** — opens the [workflow device picker](workflows.md#running-a-workflow) and runs the chosen workflow against every selected device.
- **Re-attest now** — pushes the Windows/macOS security-attestation self-report script immediately instead of waiting for its scheduled run (confirms first; reports "skipped" for platforms with no reporter, i.e. Android/iOS). See [Settings → Applivery SOAR Agent](settings.md#applivery-soar-agent) for the underlying script.
- **Add tag…** — applies one tag to every selected device.
- **Move segment…** — moves all selected devices to a chosen segment.
- **Clear** — deselects everything.

Both "Add tag" and "Move segment" report a summary afterward (e.g. "Applied on 8/10 devices — 2 failed").

## Device detail drawer

Click any row to open the drawer. The header shows device name, platform + hardware, Compliance badge, Risk badge, assigned user, and a **Run workflow** button — plus an **(i)** help icon that opens this guide. Five tabs: **Overview**, **Compliance**, **Apps**, **Location**, and **Agent**.

### Overview tab, section by section

1. **Identifiers** — serial number, IMEI, UDID, EMM device ID, Windows ID (only populated fields show).
2. **Hardware & OS** — model, OS version, battery %, storage, RAM, state, last seen.
3. **OS Updates** (Windows) — current patch level, pending security KBs (number, type, release month, severity, CVEs), or "up to date." Security updates only — not driver/feature/quality-only updates.
4. **OS Lifecycle** — support status, EOL date and ESU-until date if applicable, latest known signed build, whether the match is confirmed for this exact hardware, and a Rapid Security Response callout if one's available.
5. **Vulnerabilities** (Vulnerability Catalog) — pending CVEs with fixed-in version, severity, exploited flag, EPSS score, or "no known pending CVEs."
6. **Vulnerability Service** — only shown once configured in [Settings → Vulnerability Service](settings.md#vulnerability-service). Three states: not yet checked ("waiting on the next scheduled refresh"), stale ("check Settings → Vulnerability Service for refresh errors"), or findings (CVE count across OS + apps, KEV flag, top CVEs, EPSS scores).
7. **Firewall Rule Sets** — **Windows only**. Shows which [Firewall Policy Library](workflows.md#firewall-policy-library) rule sets are currently believed active on this device, and when they were applied. This reflects the last Apply/Restore action dispatched from a workflow, not a live read of the device — if it looks stale, re-run the matching action.
8. **App Updates** (Apple/macOS) — pending app updates from Apple's own App Store/VPP metadata, or "all up to date."
9. **Smart Attributes** — any Applivery Smart Attribute values on the device.
10. **Segment** — current segment, with a **Change** link.
11. **Active Policies** — chips for each assigned policy, each removable; **Add** opens a picker filtered to the device's platform.
12. **Tags** — chips of current tags; **Edit** opens the tag editor.

### Compliance tab

Everything about this device's standing against your [Compliance Policies](compliance.md) and its computed risk, pulled out of Overview into its own tab so it doesn't get lost among hardware/OS details:

1. **Compliance Status** — the same Compliance/Risk badges from the header, plus a visual risk meter (0–100, colored by tier).
2. **Risk Factors** — each factor contributing to the risk score and its point value.
3. **Compliance Policy Violations** — every currently-open violation against this device (regardless of review status), with its policy name and status (pending / approved / dismissed / auto-fired), or a green "no open violations" state.
4. **Awaiting Review** — the subset of violations still sitting in the [review queue](compliance.md#violations--review-queue); clickable rows that jump to the [Audit Log](audit-logs.md) filtered to this device.
5. **Open Cases** — clickable rows that open the linked [Case](cases.md).

### Apps tab

Every app this specific device reports as installed — self-reported (SOAR Agent App Inventory Reporting) or Applivery-UEM-fetched — each row showing version, source, an "update available" flag (Apple/macOS only), and (Windows only) whether it's assigned/enforced via Applivery's Windows App Distribution policy. This is the same underlying data as the [Apps](apps.md) main-nav view's Reported Apps table, scoped to just this device.

When [Vulnerability Service](settings.md#vulnerability-service) is enabled, each app row also shows its own CVE count/severity for the exact installed version, with a link out to each CVE's detail page — see [Apps → Vulnerability Service risk scoring](apps.md#vulnerability-service-risk-scoring) for how this differs from the Compliance tab's Vulnerability Service section (that one is a device-wide OS+apps rollup; this tab breaks it down per app). With the integration off, or no cached match yet for a given app/version, the row just shows plain inventory with no CVE badge — never an error.

No installed-app data yet for this device shows an empty state pointing at [App Inventory Reporting](settings.md#app-inventory-reporting--security-attestation-reporting) or the paced background refresher (only runs for devices in scope of an App List compliance condition).

### Location tab

Shows last-known coordinates with an **Open in Google Maps** link, or an empty state if none is on file. **Sync fleet locations** refreshes GPS data for the *entire fleet* (one Applivery call per device), not just this one — it can take a moment.

### Actions available from the drawer

- **Run workflow** — runs a chosen workflow against just this device.
- **Change segment / Add or remove a policy / Edit tags** — as described above.
- **Sync fleet locations** / **Open in Google Maps**.
- **Awaiting Review** rows (Compliance tab) → jump to the device's filtered Audit Log.
- **Open Cases** rows (Compliance tab) → open that Case.

All mutations show a busy state and an inline red error banner ("That change failed. Please try again.") on failure.

## Playground — 3D globe view

A tab switcher at the top of the Devices header ("Devices" / "Playground") switches to a live 3D globe visualization of the fleet's locations, with an optional flat, clustered map view for zoomed-in regions. It fetches its own live device data, is filterable by compliance status or a specific violated Compliance Policy, and lets you click any device to open its detail card — including the same Compliance tab described above. Full detail: [Playground guide](playground.md).

## Empty, loading, and error states

- Loading: "Fetching device fleet…" spinner.
- Load failure: a red "Couldn't load devices" card with the server's error.
- No table matches: "No devices match your filters."
- Location tab empty: "No location on file — Sync locations to fetch the latest known position."

## Related guides

- [Compliance](compliance.md) — how Compliance Policies compute the "Compliance Policies" signal and the risk-affecting conditions shown here.
- [Workflows](workflows.md) — running workflows against one or many devices, and the Firewall Policy Library referenced in the drawer.
- [Cases](cases.md) — the cases linked from a device's Open Cases section.
- [Apps](apps.md) — the fleet-wide Reported Apps table and App Catalog the Apps tab's per-device view is scoped from.
- [Settings](settings.md) — Vulnerability Service, Applivery SOAR Agent (self-report scripts), and OS Updates/Lifecycle catalogs that feed the badges on this page.
