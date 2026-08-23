# Playground — Admin Guide

**Playground** is a full-screen, live visualization of your device fleet's geographic locations — a rotating 3D globe by default, with an optional flat, clustered map for zoomed-in regions (see [Map View](#map-view) below). It's a genuinely live view — it fetches real device data on its own, not a static demo. Clicking any device opens its own detail card, which now includes a **Compliance** tab (risk score, risk factors, policy violations, open cases) sourced live from the same compliance engine as the [Devices](devices.md) view's detail modal — a separate, lighter card from the Devices table's modal (different tab set: Overview/Compliance/Assets/Agent vs. Overview/Compliance/Location), not literally the same component, but now covering the same compliance ground.

Reach it via the **Devices / Playground** tab switcher at the top of the [Devices](devices.md) header, and switch back the same way from inside Playground.

## Segments panel

The same sliding **Segments** panel available from Overview, Devices, Compliance, and Cases (hover the far-left screen edge, or tap the edge tab on mobile) is also reachable from Playground — pick a segment to scope the globe/map to only devices in it and its sub-segments, same "Global" reset and search/tree behavior as everywhere else it appears. A small badge next to the Playground title shows which segment is currently active.

## Header bar

- Device count and a live breakdown: compliant / non-compliant counts, plus per-platform counts (Apple, Android, Windows) — all scoped to the active segment, if one is selected.
- **Policy filter** — pick a [Compliance Policy](compliance.md) to show only the devices currently violating it (the globe tints purple while this filter is active).
- **Non-Compliant Only** toggle (tints red while active).
- **Sync Locations** — refreshes GPS data for the fleet (same action as the Devices modal's Location tab).
- **Pause Rotation / Rotation Paused** — freezes the globe's auto-rotation and its cloud layer in place. Useful before clicking a device — a still globe is much easier to hit precisely than a rotating one. Toggle back to resume.
- **Map View / Globe View** — manually switch between the 3D globe and the flat clustered map (see below). Switching to the globe again drops any in-progress map pan/zoom; switching to the map re-centers on wherever the globe was last pointed.

## The globe itself

Each device with resolvable coordinates renders as a pulsing marker, colored primarily by **compliance status** (green = compliant, red = non-compliant), falling back to a **platform color** only when compliance status is unknown. Hovering shows the device name and status; clicking opens its detail card, same as clicking a row in the Devices table.

**Devices with no location on file are still plotted** — at a stable, deterministic pseudo-random position derived from the device's ID, shown as a visibly smaller marker with no pulse ring. There's no separate on-screen label distinguishing "real GPS" from "placeholder position" beyond that smaller size, so don't read scattered markers as literal geography until you've run **Sync Locations**.

A few elements are purely decorative and not tied to real data: the animated cloud layer, arcs between a handful of devices, and orbiting "satellite" sprites.

## Map View

A curved 3D surface makes devices clustered in the same city or campus nearly impossible to click individually — the exact scenario this view exists for. It replaces the globe with a flat OpenStreetMap tile map where nearby devices are grouped into a numbered cluster bubble that expands (zooms in, then splits apart) as you click into it, down to individual clickable device pins.

**Switching in:** either click the **Map View** toolbar button, or simply zoom the 3D globe in far enough — past a fixed camera-distance threshold, the view switches to the map automatically, centered on wherever you were looking. There's no reverse auto-switch (zooming back out on the map doesn't return you to the globe); use **Back to Globe** (top right of the map) or the toolbar's **Globe View** button.

Only devices with a real, resolved location are plotted on the map — unlike the globe, there are no placeholder pseudo-random pins here, since a flat map has no decorative use for a fake position. A small counter in the bottom-left shows how many devices were left off for lacking location data; run **Sync Locations** to fill them in.

Map tiles are the same OpenStreetMap data source used elsewhere in the app (e.g. the Devices modal's embedded location map) — no separate API key or paid mapping service involved.

### Geofence zones

The Map View toolbar also has **Draw Circle**, **Draw Polygon**, and **Manage Zones** — draw a shape directly on the map, save it as a named zone, and reference it from a [Compliance Policy](compliance.md) condition ("device inside/outside zone"). See [Geofencing](geofencing.md) for the full guide, including how zone location data is kept fresh in the background for unattended policy evaluation.

## Controls

**Globe:** standard drag-to-orbit and scroll/pinch-to-zoom. Auto-rotates slowly by default (toggle off with **Pause Rotation**); there's no "reset view" button — drag manually to reposition.

**Map:** standard drag-to-pan and scroll/pinch-to-zoom, same as any web map. Click a cluster bubble to zoom into it; click an individual pin to open that device.

## Empty and loading states

- Loading: a full-screen spinner, "Loading fleet data…"
- Zero devices in the workspace: a dim globe icon, "No devices found," with a **Sync device locations** call to action. (This only appears if the fleet itself is empty — devices with unsynced locations still render, per above.)

## Related guides

- [Devices](devices.md) — the fleet table and detail modal this view shares its data and device-click behavior with.
- [Compliance](compliance.md) — the policy filter's source list, and where geofence zones become policy conditions.
- [Geofencing](geofencing.md) — drawing and managing zones on the Map View.
