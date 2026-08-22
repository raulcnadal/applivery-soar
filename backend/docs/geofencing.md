# Geofencing — Admin Guide

**Geofencing** lets you draw a zone directly on the [Playground](playground.md) map, save it as a reusable asset, and reference it from a [Compliance Policy](compliance.md) condition — "device is inside zone X" or "device is outside zone X." There's no equivalent in the original SOAR — this is a disclosed new capability, built on the device location data the platform already gathers via the Applivery API.

## Drawing a zone

From **Playground → Map View** (the flat, clustered map — switch to it from the toolbar or by zooming the globe in far enough), the toolbar has two drawing buttons plus a management button:

- **Draw Circle** — click a center point on the map, then drag out to set the radius. Release to finish.
- **Draw Polygon** — click each vertex in turn; double-click (or click the first vertex again) to close the shape.
- **Manage Zones** — opens the zone list (see below).

After drawing, a small floating form appears asking for a **name** (required), an optional **description**, and an overlay **color**. Save to persist the zone, or discard to throw the drawing away. The zone then renders as a colored overlay on the map going forward, alongside device markers.

Zones are workspace-scoped, not tied to any one Compliance Policy — draw one once, reference it from as many policies as you like.

## Managing zones

**Manage Zones** opens a modal listing every saved zone with its shape summary (circle + radius, or polygon + point count). From there you can:

- **Edit** — rename, change the description, or change the overlay color. The geometry itself (the actual shape/points) isn't editable in place — redraw a new zone and delete the old one if the boundary needs to change.
- **Delete** — removes the zone. Any Compliance Policy condition referencing it stops matching any device (the condition doesn't error, it just never matches — see below), so double-check nothing important depends on it first.

## Using a zone in a Compliance Policy

In the [Policy Builder](compliance.md#policy-builder)'s condition list, two new operators appear under a **Geofence Zone** field:

| Operator | Matches |
|---|---|
| **Inside** | the device's most recently known location falls within the selected zone |
| **Outside** | the device's most recently known location falls outside the selected zone (or has no location on file at all — see semantics below) |

There are also two supporting fields for building more precise conditions:

| Field | Notes |
|---|---|
| **Has location data** | true/false — whether any location has ever been fetched for the device. Combine with a geofence condition to build fail-closed logic (see below). |
| **Location age (minutes)** | how old the device's stored location is — combine with a staleness threshold (e.g. "less than 240") to avoid triggering on a location that's technically inside/outside a zone but too stale to trust. |

**Missing-location semantics**: a device with no location on file matches **neither Inside nor Outside** — the same "unknown data simply doesn't match" rule every other condition type in this builder follows. This is deliberate: it keeps a never-synced or location-permission-denied device from silently tripping an "outside the office" alert it never should have. If you want the opposite — treat "we don't know where this device is" as itself a violation — build that explicitly, e.g. **Match ANY**: "Outside Zone X" OR "Has location data = false".

Geofence conditions combine with every other condition type the same way as anything else in the builder — mix a geofence check with an OS-version check, a risk-tier check, etc., under either **Match ANY** or **Match ALL**.

## Where the location data comes from

Device locations come from the same Applivery API location history already used elsewhere in the app (Devices drawer's Location tab, Playground's globe/map markers) — precise and network-based positions reported by the MDM agent. Geofencing doesn't add a new data source; it adds a background refresher that keeps a lightweight, per-device "last known location" cache warm specifically for Compliance Policy evaluation, plus the point-in-zone geometry to test it against a saved shape.

### Why a separate refresher

Compliance Policy evaluation runs unattended, on a schedule, potentially against a fleet of hundreds of thousands of devices. Applivery's Locations endpoint is **per-device only** — there's no bulk/fleet-wide endpoint — and the platform already spends its Applivery API budget on device sync, installed-app inventory, and other background work. A geofence-heavy policy naively calling out to Applivery for every device on every evaluation run would either blow through API rate limits or evaluate against location data that's minutes-to-hours stale by the time it's fetched.

Instead, a **budgeted, background location refresher** runs continuously, independent of when policies actually evaluate:

- Only devices actually **in scope of an enabled policy's geofence condition** are refreshed — a fleet with no geofence policies spends zero extra API budget on this.
- Devices are refreshed **oldest-synced-first**, so coverage rotates through the whole scoped fleet rather than starving devices that happen to sort last.
- A configurable **budget (requests/hour)** caps how much of the shared Applivery API allowance this refresher is allowed to spend, so it never crowds out device sync or other background jobs. Default 2,000/hour, adjustable between 200 and 4,000.
- Each cycle only fetches what's needed to keep the cache warm — this is a delta-style refresh, not a full re-pull of location history, since Compliance Policy evaluation only ever needs the *current* location, not the full trail.

This mirrors the same pattern already used for the installed-app inventory refresher (see [Apps → App Lists](apps.md#app-lists-tab)) — a proven approach for keeping large-fleet background data fresh under a shared, rate-limited API budget.

### Refresh status panel

**Manage Zones** also shows a **Device-location refresh** panel (only once at least one enabled policy uses a geofence condition):

- **Coverage %** — how many of the scoped devices have a synced location on file.
- **Oldest sync age** — how stale the least-recently-refreshed device's location is.
- **Estimated full cycle** — roughly how long, at the current budget, it takes to cycle through every scoped device once.
- **Fetch errors** — devices whose last location fetch failed (e.g. device offline, no location permission granted on the MDM side).
- **Refresh now** — manually kicks off a refresh pass instead of waiting for the next background tick.
- **Budget** — click to edit the requests/hour cap.

If coverage is low or the estimated cycle time is long, that's a signal to either raise the budget (if you have Applivery API headroom to spare) or narrow which policies use geofence conditions.

## Widgets & Reports

Three **Geofencing (SOAR)** data sources are selectable from both the [Overview](overview.md) widget builder and the [Reporting](reporting.md) builder (they share one catalog — anything addable as a widget is also reportable):

| Data source | Shows |
|---|---|
| **Devices per geofence zone** | A scorecard (total zones defined) plus a per-zone breakdown of how many tracked devices currently fall inside each one, based on the latest stored position. |
| **Devices inside/outside zones** | A three-way split: inside at least one zone, outside every zone, or no location data yet. |
| **Geofence location freshness** | Tracked devices bucketed by how long ago their position was last confirmed (under 1 hour / 1–6 hours / 6–24 hours / over 24 hours), plus a "no location data yet" bucket. Useful for spotting when the background refresher (see above) is falling behind. |

All three read the same `DeviceLocation` rows the geofence evaluator itself uses — no separate live Applivery call, no extra API budget spent. Their "universe" is whatever devices the background location refresher is currently tracking (i.e. devices scoped by at least one enabled policy's geofence condition) — draw a zone and add a policy condition first if these show empty. A device whose location has never been successfully fetched always lands in "no location data yet" rather than being tested against a bogus position, matching the same missing-location handling described above.

## Related guides

- [Playground](playground.md) — where zones are drawn, on the Map View.
- [Compliance](compliance.md) — where geofence conditions are built into policies, and where the App List inventory refresher this design mirrors lives.
- [Overview](overview.md) and [Reporting](reporting.md) — where the Geofencing (SOAR) widgets/report sources above live.
