# Compliance — Admin Guide

Compliance is where you define what "out of compliance" means for a device, and what should happen automatically the moment a device crosses that line. A **Compliance Policy** is a set of conditions (e.g. OS too old, disk not encrypted, a required app missing), a match rule (any condition, or all of them), and a linked [Workflow](workflows.md) that runs against any device meeting those conditions. A policy can also tag the device, open a [Case](cases.md), and escalate to a tougher workflow if the device's own risk tier is already high.

Compliance Policies are managed from a single view — Policies (the list + builder below). App Lists, the mandatory/disallowed app catalogs a policy's conditions can reference, live on the [Apps view's own App Lists tab](apps.md#app-lists-tab) instead, alongside Reported Apps and the App Catalog.

## Policies list

Each policy is a card showing: name, description, a condition summary ("N conditions, match ANY/ALL"), the linked workflow's name (or "No workflow linked"), when it was last evaluated, and a live count of devices currently violating it. Three toggle chips let you flip settings without opening the editor: **Enabled/Disabled**, **Auto-run/Review first**, and **Cases: on/off/auto-resolve**. If auto-run has tripped (see below), a red "autoRun tripped" badge appears with the reason as a tooltip.

The list is scoped by whatever [Segment](devices.md) is selected in the left panel.

**Evaluate now** (top right) runs every enabled policy immediately, ignoring each policy's own schedule, and shows a summary: devices checked, new violations, auto-fired count, queued-for-review count, recovered count, and anything blocked by a safety limit.

Turning a policy's **Enabled** toggle on, or saving a change to which devices it targets (Device Audience, platform, deployment model, segment, or the conditions themselves), triggers an immediate background check of just that policy — a routine edit that changes neither still follows its normal schedule below. Separately, a device's own self-reported attribute update (from the [Applivery SOAR Agent](settings.md#applivery-soar-agent)) also kicks an immediate, workspace-wide re-check the moment it lands, subject to the same 60-second cooldown "Force evaluate" on the agent itself uses — so a disk-encryption or firewall change a device reports about itself doesn't have to wait out the schedule either.

## Policy Builder

Open by clicking **Create Compliance Policy** or editing an existing one.

**Basics**: Name (required), Description.

**Target platform** — optionally lock a policy to one platform (Apple/macOS/Android/Windows) instead of "Common (all platforms)"; the Policy Builder then only offers conditions and Self-Reported Attribute/Custom Check names that actually apply to that platform, the same targeting concept [Workflows](workflows.md) already uses. Choosing **macOS** assumes every macOS device is supervised and skips straight to the conditions step — Apple's own supervision-dependent management surface makes an unsupervised Mac's device-level restrictions unreliable enough that it isn't worth a separate branch here, unlike Apple/iOS, which still asks.

**Enabled** / **Auto-run workflow (skip review queue)** checkboxes. With Auto-run off, violations land in the [Awaiting review queue](#violations--review-queue) for a human to approve or dismiss. With it on, the linked workflow fires immediately and unattended.

**Auto-run safety limits** (shown only when Auto-run is on):
- **Max devices auto-fired per evaluation pass** (default 15) — violators beyond this cap in one pass are queued for manual review instead of firing unattended. This exists so a bad condition, a stale sync, or an entire Device Audience flipping non-compliant at once can't unattended-fire a destructive workflow against far more devices than you intended. A **No limit** checkbox next to the field removes the cap entirely for this policy — every violator in the pass fires unattended, none get queued for manual review regardless of count. This is an explicit, per-policy opt-in (there's no global "uncapped" setting); a red callout explains the tradeoff when it's checked. Leave it unchecked unless you specifically need a policy to keep pace with a fleet-wide event.
- **Destructive-action acknowledgment** — if the linked workflow (primary or escalated) contains a destructive MDM action, you must explicitly check "I understand and want autoRun to fire this unattended" before you can save. Re-checked on every evaluation too, in case the workflow was edited afterward to add a destructive step. Selecting a workflow that its own author has marked [approved to run unattended](workflows.md#unattended-auto-run-approval) pre-fills this checkbox as checked — you can still uncheck it, and switching to a different workflow re-evaluates the pre-fill against that workflow's own flag. This pre-fill never happens silently on an existing, already-saved policy; it only fires the moment you actively pick a workflow in this dropdown.
- **Escalate on high-risk devices** (optional) — pick a second, tougher workflow plus a minimum risk tier (Medium+/High+/Critical). If a violating device's live risk tier already meets that threshold, the escalated workflow runs instead of the default one.

**Segment** — administrative/visibility scope only. It does **not** filter which devices get checked.

**Evaluation frequency** — how often the background scheduler re-checks this policy (1–24 hours; blank = the 60-minute org default) if nothing else has already triggered a fresher check first. "Evaluate now" always ignores this, and so do the immediate on-enable/on-scope-change and on-attribute-report triggers described above.

Near the bottom of the builder: **Apply to devices** — optionally scope evaluation to one Applivery Device Audience; membership is re-resolved on every run. Leave blank to check the whole fleet. Directly below it, a **Devices that will receive this policy** box shows, live, exactly which devices the selected audience currently resolves to — the same membership resolution the evaluation itself uses, so an empty or unexpected result here means the audience needs fixing (or a different one picking) before you save, not a surprise after. If it comes up empty for an audience you know has members, it also shows what Applivery's API itself returned for that audience, to help tell a permissions issue apart from a genuinely empty one.

### Conditions — the full field catalog

Each condition is Field → Operator → Value. Choose **Match ANY condition** (OR) or **Match ALL conditions** (AND) for the whole set.

| Field | Notes |
|---|---|
| Applivery compliance flag | Compliant/Non-compliant |
| Platform | apple, macos, android, windows |
| OS version | less/greater than, equals |
| OS Patch Level | less/greater than, equals — needs [Settings → OS Patch Level](settings.md#os-patch-level) Smart Attribute mapping configured; a platform-aware comparison (Android SPL date, Apple version+build, Windows full build), more precise than OS version alone once populated |
| Days since last check-in | staleness threshold |
| Time since enrollment | amount + unit |
| Battery % | |
| Available / total storage (GB) | |
| RAM (GB) | |
| Manufacturer / Model / Serial number / IMEI | equals/contains |
| MDM user email | equals/contains |
| Segment | equals/not equals |
| Tag | includes/excludes |
| Device state | |
| Missing a required MDM policy | pick a platform, then a specific Applivery MDM Policy |
| Device Audience membership | includes/excludes |
| Smart Attribute | equals/not equals/contains/greater/less/exists/missing, by attribute name |
| Custom device field (advanced) | free-text dot-path into the full device record, e.g. `nativeSecurity.isEncrypted` — used for things like Android disk-encryption/screen-lock checks where there's no dedicated field |
| Self-Reported Attribute (agent) | from the optional self-report script — e.g. `diskEncryptionEnabled`, `screenLockEnabled`, `antivirusEnabled`. Needs [Settings → Applivery SOAR Agent](settings.md#applivery-soar-agent) set up and the matching script deployed |
| Custom Check Result (agent) | an admin-defined check the matching agent runs locally and reports back — process running, service status, a registry/plist/file value, an app installed, or a raw command's output — equals/not equals/contains/greater/less/exists/missing, by check key. Define checks under [Settings → Applivery SOAR Agent](settings.md#applivery-soar-agent); the Policy Builder only offers check keys defined for the policy's own target platform |
| Days since last self-report / Has ever self-reported | |
| Inbound Webhook Fired | pick an enabled [Inbound Webhook](settings.md#inbound-webhooks) — exists/missing, optionally qualified with "within last N minutes" ("fired recently" vs. "hasn't fired recently, or ever"). Closes the visibility gap where an EDR/MTD/DEX tool calling a workspace's inbound webhook had no way to drive (or even surface in) a Compliance Policy — every webhook fire that resolves to a device now feeds this condition directly |
| **Missing a required app** (App List) | pick an existing App List — only matches devices on that list's platform |
| **Has a disallowed app** (App List) | same, inverse |
| **Geofence Zone** (Inside/Outside) | pick a zone drawn on [Playground → Map View](playground.md#map-view) — see [Geofencing](geofencing.md) for drawing zones, missing-location semantics, and how location data is kept fresh in the background |
| Has location data / Location age (minutes) | supporting fields for geofence conditions — see [Geofencing](geofencing.md) |
| Device Risk Score / Risk Tier | |
| Pending Windows security updates / exploited-CVE pending | needs the OS Updates catalog to have run at least once |
| Pending known CVEs (Apple/Android) / exploited-in-wild pending | Vulnerability Catalog, no Settings needed |
| OS version is end of life | OS Lifecycle catalog, no Settings needed |
| Pending Apple app updates | |
| Critical/high CVEs — Vulnerability Service / known-exploited CVE present / checked against Vulnerability Service | needs [Settings → Vulnerability Service](settings.md#vulnerability-service) enabled and configured |

There is no dedicated "jailbreak/root" or "disk encryption" field type for every platform — those are built from **Custom device field** (Android) and **Self-Reported Attribute** (Windows/macOS agent) instead; iOS has no disk-encryption signal at all (Apple ties it to passcode enforcement).

**Then run** — pick the primary Workflow (required to save).

**Mark on Applivery console**: a **non-compliance tag** (applied while violated, removed on recovery — give each policy its own distinct tag) and/or a **Smart Attribute** to attach/detach. Either, both, or neither. Removal happens three ways, all independent of each other: automatically the next time this policy evaluates and finds the device genuinely no longer matching the conditions (works whether or not this policy opens Cases at all); immediately if an analyst manually resolves or closes the Case a violation opened (from the [Cases](cases.md) view); or immediately if an analyst **Approves** or **Dismisses** the violation from the review queue below — the manual "this is handled" action for policies with **Open a Case when violated** turned off, where there's no Case to close in the first place.

**Case Management**: **Open a Case when violated** (default on) and, only if that's on, **Auto-resolve the Case once the device recovers** (default off — recommended only for conditions that reliably self-heal; otherwise let an analyst confirm the fix first) and an optional **Default assignee** — every Case this policy opens (or reopens) is auto-assigned to that person, still freely reassignable afterward from the Cases view like any other case. Leave it blank to keep new cases unassigned, the pre-existing behavior.

**Alerts**: **Send an alert when this policy is violated** (default off) fires one rolled-up message per evaluation pass that finds at least one new violation — e.g. "3 new violations" — not one per device, and independent of the workflow/autoRun settings above. Two channels, either or both:
- **Webhook** — an optional per-policy URL override (leave blank to reuse [Settings → General](settings.md)'s single global Notifications Webhook URL), with a **Test** button to send a sample message before relying on it.
- **Email** — this policy's own recipient list, separate from [Settings → SMTP](settings.md)'s global "Alert Email Recipients" (reserved for SLA breach/System Health instead). Requires SMTP to be configured in Settings.

Each channel also has its own optional **Limit to N alerts per day** guardrail — off (unlimited) by default. Turning it on caps just that channel independently of the other (e.g. unlimited Webhook while Email is capped at 20/day, or any other combination), so a misconfigured or overly broad policy that keeps re-tripping every evaluation pass can't flood a webhook channel or an inbox unboundedly. Extra violations found after a channel's daily cap is reached are still recorded (visible in the review queue/Recent activity below) — they just don't trigger another alert until the cap resets the next day.

**MITRE ATT&CK Tagging** — pick techniques this policy's violation represents; carried onto every Case it opens, purely for triage/reporting, no effect on evaluation. As you add conditions, a **Suggested from your conditions** row appears above the picker with techniques a curated field→technique mapping associates with those conditions (e.g. an outdated-OS or pending-CVE condition suggests *T1203 — Exploitation for Client Execution*; a missing required security app suggests *T1562 — Impair Defenses*). These are suggestions only — click one to add it, or ignore them entirely; nothing is auto-applied to the policy's tags.

**Framework/Control badge** — a read-only pill (e.g. "ISO 27001 — Annex A.8.1") shown only for policies created from a Template.

## Template Gallery

Click **New from Template** on the Policies page. Filter by framework — **ISO 27001**, **ENS**, or **NIS2** — each with its own scope caveat (e.g. ISO 27001 certification also needs a full ISMS with no device-policy equivalent; ENS encryption is only mandatory at categoría alta; NIS2's Article 21 measures include organizational areas no device policy can cover).

13 templates ship out of the box:
- **ISO 27001**: disk encryption not enforced, screen lock not enforced, anti-malware inactive, OS past end-of-life, no check-in >30 days.
- **ENS**: encryption not enforced, screen lock not active, no contact >7 days.
- **NIS2**: screen lock not enforced, vulnerability handling (EOL or exploited-CVE exposure), cryptography (disk encryption unconfirmed), asset visibility (no check-in >30 days).

Picking a template pre-fills a brand-new draft in the Policy Builder — name, description, severity, conditions, framework/control mapping. **Auto-run is always forced off** and **Case-opening is forced on**, regardless of the template, so nothing fires unattended before you've reviewed it. You still pick a Workflow and save it yourself.

## Violations / review queue

Lives directly on the Policies page. An **Awaiting review (N)** section appears above the policy list whenever there are pending (non-auto-run, or capped/blocked) violations. Each row shows the device, the policy, which workflow "would run," and matched-condition count, with **Dismiss** and **Approve & run** buttons. Select multiple for bulk **Dismiss selected** / **Approve & run selected** — bulk actions require the `canBulkTriage` permission (see [Settings → Roles](settings.md#roles)).

Below that, a **Recent activity** table lists resolved/handled violations with status (auto-fired, approved & ran, dismissed, blocked, capped, escalated, etc.), with pagination and a **Export CSV** button.

**autoRun circuit breaker**: if a policy's last 3 consecutive auto-fired runs *all* failed on every targeted device, autoRun automatically pauses for that policy — a signal the automation itself is broken (bad script reference, revoked credential, an Applivery outage), not that devices are hard to fix. Edit and re-save the policy to re-arm it.

## Settings this view depends on

- **[OS Updates](settings.md#os-updates)** — powers the pending-update conditions; needs at least one catalog refresh to have happened.
- **[Vulnerability Service](settings.md#vulnerability-service)** — opt-in, needs an API token configured before its conditions produce real data.
- **[Applivery SOAR Agent](settings.md#applivery-soar-agent)** — required for Self-Reported Attribute conditions (disk encryption, screen lock, antivirus on Windows/macOS).
- **[App List inventory](apps.md#app-lists-tab)** — populated either via the self-report script or the paced background Applivery-API refresher; a brand-new App List condition won't match anything until coverage catches up.
- **Geofence Zone inventory** — populated by the paced background location refresher (see [Geofencing](geofencing.md)); a brand-new geofence condition won't match anything until coverage catches up.
- **[Roles](settings.md#roles)** — `canBulkTriage` gates bulk approve/dismiss on the violations queue; `canDeletePolicyOrWorkflow` gates policy deletion.

## Related guides

- [Workflows](workflows.md) — build the workflows a policy links to, including the destructive-action rules that gate auto-run.
- [Cases](cases.md) — how policy violations become Cases and inherit MITRE tags.
- [Devices](devices.md) — the "Compliance Policies" signal shown on the fleet table and device drawer, including the per-condition status modal opened from a policy pill.
- [Apps](apps.md#app-lists-tab) — App Lists, the mandatory/disallowed app catalogs the "Missing a required app"/"Has a disallowed app" conditions reference.
- [Geofencing](geofencing.md) — drawing zones and the background location refresher behind the Geofence Zone condition.
