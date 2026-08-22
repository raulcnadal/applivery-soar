# Apps — Admin Guide

The Apps main-nav view has three sub-tabs: **Reported Apps** (fleet-wide, read-only visibility into what's actually installed), **App Catalog** (the shared identifier catalog [App Lists](#app-lists-tab) are built from), and **App Lists** (the mandatory/disallowed app catalogs [Compliance Policy](compliance.md) conditions reference). All three read from the same underlying per-device app inventory; none requires another to be used.

## Reported Apps tab

One row per distinct app identifier seen anywhere in the fleet (grouped by platform + identifier), aggregated across every device with app-inventory data — self-reported via the [SOAR Agent's App Inventory Reporting](settings.md#app-inventory-reporting--security-attestation-reporting), or fetched live from Applivery's own MDM API. This is independent of whether any App List or Compliance Policy references the app; it's purely "what does SOAR currently see."

Columns:

- **App** — name and identifier (bundle ID / package name / winget ID, depending on platform and source).
- **Version** — the single version if every device agrees, or a "N versions" count if they've drifted (open the row for the per-device breakdown of which device has which).
- **Type** — the package format: "MSI" for classic Win32 installers, "APPX" for AppX/UWP (Store) packages, "IPA"/"APK" for Apple/Android, "Mixed" if a fleet has both an MSI and an APPX install of the same identifier. Windows-only data beyond the platform-derived Apple/Android fallback.
- **Reported by** — who told SOAR about this app: "Self-reported" (SOAR Agent), "Applivery UEM," or "Mixed" when both sources see it.
- **Source** — how the app got onto the device (Windows only): "UEM" when Applivery's own Windows App Distribution has it assigned/enforced, "MS Store" for AppX/UWP packages, "Winget" for an app the SOAR Agent detected via `winget list`, "Manual" otherwise — including a self-reporting agent build older than the winget/registry-fallback split, which can't yet distinguish "Winget" from "Manual" and reports "Manual" until that device's agent is updated.
- **Update** — count of devices with a pending update available (Apple/macOS only — Applivery is the only platform that exposes this flag today).
- **Risk** — see [Vulnerability Service risk scoring](#vulnerability-service-risk-scoring) below.
- **Devices** — total device count.

A platform filter and a name/identifier search sit above the table. Clicking a row opens the App detail modal.

### App detail modal

- **App Lists** — which of your [App Lists](#app-lists-tab) reference this app, matched against the App Catalog by identifier *or* name (case-insensitive) — an app added to the catalog via Winget search stores winget's PackageIdentifier (e.g. `Google.Chrome`), while a device's self-report often carries the lowercased DisplayName instead (`google chrome`) when winget isn't invokable from the agent's LocalSystem service context, so identifier-only matching would wrongly say "not in the catalog" for an app that demonstrably is.
- **Applivery Application Library** (Windows only) — a best-effort lookup against Applivery's own Windows App Distribution catalog, matched by MSI product code when available (exact) or by name (fallback).
- **Vulnerabilities** — per-version CVE breakdown, see below. Only shown when the [Vulnerability Service](settings.md#vulnerability-service) is enabled and has a cached match for at least one version of this app.
- **Devices** — one row per physical device (a device seen via both the SOAR Agent and Applivery UEM is merged, not duplicated), with version, package-type badge, every "Reported by" source that saw it, "enforced by policy" badge (Windows only — assigned via Applivery's Windows App Distribution, not just incidentally present), update-available flag, and its own "Last sync" column showing freshness and any live-fetch error. Windows apps also show their full on-disk install path on its own line below the row when known (always for AppX/Store packages, sometimes for classic Win32 installs) — purely informational, not used for any matching logic.
- **Applivery Application Library** is a *separate*, Windows-only lookup against Applivery's own Windows App Distribution/MDM catalog (a different system from SOAR's own App Catalog above) — matched by MSI product code when SOAR has one, name otherwise. "No matching entry found" here is expected, not a bug, for any app that was never deployed through Applivery itself (e.g. installed manually from the Microsoft Store) — it says nothing about whether the app is in SOAR's own App Catalog.

Each app also appears, per device, in that device's own detail drawer under its **Apps** tab — clicking a row there jumps straight to this same App detail modal for that app.

### Vulnerability Service risk scoring

Requires the [Vulnerability Service](settings.md#vulnerability-service) integration (Settings) to be enabled — without it, the Risk column reads "—" and the modal's Vulnerabilities section doesn't appear. This is a separate, opt-in, per-workspace CVE source from the built-in [Vulnerability Catalog](settings.md#vulnerability-catalog); it's the only one of the two that matches individual installed apps (not just OS versions), across all four platforms.

For each app, every version currently reported anywhere in the fleet is looked up against the Vulnerability Service's cache (never queried live from this view — the background refresher populates it on its own configured interval). A version with no cached match yet, or a stale one past the 24-hour cache TTL, is simply excluded rather than shown as an error.

The **risk score** (0–100, shown as a colored badge) rolls up every matched version's CVEs:

- Critical CVE: +40 points each
- High: +20
- Medium: +8
- Low: +2
- +25 flat bonus if any matched CVE is in CISA's Known Exploited Vulnerabilities (KEV) list
- Capped at 100

This mirrors the device Risk Score's own point-based approach ([Devices](devices.md)) but is scoped to one app's CVEs across every version currently in the fleet, not a whole device's combined risk factors. The badge's color follows the highest individual severity found (Critical/High/Medium/Low), and a small flame/shield indicator marks a KEV hit. Two apps with the same CVE count can still show different scores — severity mix and KEV status matter more than raw count.

The App detail modal's Vulnerabilities section breaks the same underlying data down **per version** — useful when a fleet has drifted across versions and only the older ones are actually vulnerable, which the rolled-up Risk column badge alone can't distinguish.

## App Catalog tab

The **Custom Catalog** (left column) is the shared, admin-curated set of app identifiers that [App Lists](#app-lists-tab) are built from — distinct from Reported Apps above, which is read-only fleet visibility with no authoring involved. An app doesn't need to have ever been seen installed to be added here (e.g. importing straight from an app store to pre-build a list before rollout), and conversely a reported app isn't automatically in the catalog until added.

A platform filter narrows the list; each entry can be removed (blocked if an App List still references it — remove it from the list first).

### Add new Apps wizard

The **Add new Apps** button (right column) opens a two-step wizard: pick an OS platform, then pick a source for that platform. Every source lets you search/browse and add straight into the Custom Catalog; a running count shows how many apps you've added in the current wizard session.

| Platform | Sources |
|---|---|
| Apple (iOS/iPadOS) | From Reported Apps, Apple App Store |
| macOS | From Reported Apps, Apple App Store, Homebrew (Cask) |
| Windows | From Reported Apps, Microsoft Store, Winget |
| Android | From Reported Apps, Applivery Catalog, Google Play (exact package) |

- **From Reported Apps** — a local filter over what SOAR has already seen installed for the chosen platform (no outbound API call); the fastest way to catalog an app you know is already in the fleet.
- **Apple App Store / Microsoft Store / Winget / Homebrew (Cask)** — live search against each platform's own public catalog.
- **Applivery Catalog** (Android) — Applivery's own list of commonly-managed Android apps.
- **Google Play (exact package)** — Google doesn't expose a free-text search API to EMMs, so this is an exact package-name lookup (e.g. `com.slack`) against Applivery's Google Play EMM integration rather than a browsable search.
- **Quick-start presets** (Common browsers, Collaboration apps) and a manual "Can't find it? Add manually" fallback (raw identifier + name) are also available per platform.

## App Lists tab

An **App List** is a named, platform-specific catalog of apps (by bundle ID / package name / product ID), referenced by [Compliance Policy](compliance.md)'s "Missing a required app" and "Has a disallowed app" conditions. This tab moved here from the Compliance view alongside the other app-related sub-tabs above, since it's fundamentally about apps, not policies — the policies that consume an App List still live in Compliance.

**Creating a list**: Name, Platform (locked once created), optional Description, then add apps three ways:
- **Quick-start presets** (common browsers, collaboration apps) — one click, but worth spot-checking since they're not guaranteed 100% current.
- **Search** — Apple App Store (iOS/macOS), Homebrew Cask (macOS, name only — confirm the bundle ID via `mdls`), Microsoft Store/Winget (Windows — Winget is a community index, unofficial), or "Known Apps" (Android — only apps already known to your org's App Distribution/Android Enterprise catalog, since there's no free Play Store search API).
- **Manual entry** — name + raw identifier for anything not found via search.

Each list shows its app count and which Compliance Policies currently reference it; deletion is blocked while still referenced.

**Installed-app inventory sync panel** at the top of the tab shows coverage % (devices synced), self-reported count, oldest sync age, an estimated full-refresh cycle time, error count, and a manual **Refresh now**. This panel stays idle until at least one enabled Compliance Policy actually uses an App List condition — until then there's nothing to sync for.

## Related guides

- [Compliance](compliance.md) — the Policy Builder conditions (`requiredAppList`/`disallowedAppList`) that consume App Lists, and the Custom Check Result condition an agent-run check can also feed.
- [Devices](devices.md) — the per-device Apps tab, a device-scoped view of the same Reported Apps data with the same per-app CVE detail.
- [Settings](settings.md) — App Inventory Reporting setup, the installed-apps refresh budget, Custom Device Checks, and Vulnerability Service configuration.
