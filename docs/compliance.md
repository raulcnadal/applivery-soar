# Compliance — Admin Guide

Compliance is where you define what "out of compliance" means for a device, and what should happen automatically the moment a device crosses that line. A **Compliance Policy** is a set of conditions (e.g. OS too old, disk not encrypted, a required app missing), a match rule (any condition, or all of them), and a linked [Workflow](workflows.md) that runs against any device meeting those conditions. A policy can also tag the device, open a [Case](cases.md), and escalate to a tougher workflow if the device's own risk tier is already high.

This guide covers both sub-views: **Policies** (the main list + builder) and **App Lists** (mandatory/disallowed app catalogs referenced from policy conditions), reached via the tab switcher at the top right.

## Policies list

Each policy is a card showing: name, description, a condition summary ("N conditions, match ANY/ALL"), the linked workflow's name (or "No workflow linked"), when it was last evaluated, and a live count of devices currently violating it. Three toggle chips let you flip settings without opening the editor: **Enabled/Disabled**, **Auto-run/Review first**, and **Cases: on/off/auto-resolve**. If auto-run has tripped (see below), a red "autoRun tripped" badge appears with the reason as a tooltip.

The list is scoped by whatever [Segment](devices.md) is selected in the left panel.

**Evaluate now** (top right) runs every enabled policy immediately, ignoring each policy's own schedule, and shows a summary: devices checked, new violations, auto-fired count, queued-for-review count, recovered count, and anything blocked by a safety limit.

Turning a policy's **Enabled** toggle on triggers an immediate background check of just that policy.

## Policy Builder

Open by clicking **Create Compliance Policy** or editing an existing one.

**Basics**: Name (required), Description.

**Enabled** / **Auto-run workflow (skip review queue)** checkboxes. With Auto-run off, violations land in the [Awaiting review queue](#violations--review-queue) for a human to approve or dismiss. With it on, the linked workflow fires immediately and unattended.

**Auto-run safety limits** (shown only when Auto-run is on):
- **Max devices auto-fired per evaluation pass** (default 15) — violators beyond this cap in one pass are queued for manual review instead of firing unattended. This exists so a bad condition, a stale sync, or an entire Device Audience flipping non-compliant at once can't unattended-fire a destructive workflow against far more devices than you intended. A **No limit** checkbox next to the field removes the cap entirely for this policy — every violator in the pass fires unattended, none get queued for manual review regardless of count. This is an explicit, per-policy opt-in (there's no global "uncapped" setting); a red callout explains the tradeoff when it's checked. Leave it unchecked unless you specifically need a policy to keep pace with a fleet-wide event.
- **Destructive-action acknowledgment** — if the linked workflow (primary or escalated) contains a destructive MDM action, you must explicitly check "I understand and want autoRun to fire this unattended" before you can save. Re-checked on every evaluation too, in case the workflow was edited afterward to add a destructive step. Selecting a workflow that its own author has marked [approved to run unattended](workflows.md#unattended-auto-run-approval) pre-fills this checkbox as checked — you can still uncheck it, and switching to a different workflow re-evaluates the pre-fill against that workflow's own flag. This pre-fill never happens silently on an existing, already-saved policy; it only fires the moment you actively pick a workflow in this dropdown.
- **Escalate on high-risk devices** (optional) — pick a second, tougher workflow plus a minimum risk tier (Medium+/High+/Critical). If a violating device's live risk tier already meets that threshold, the escalated workflow runs instead of the default one.

**Segment** — administrative/visibility scope only. It does **not** filter which devices get checked.

**Evaluation frequency** — how often the background scheduler re-checks this policy (1–24 hours; blank = the 60-minute org default). "Evaluate now" always ignores this.

Near the bottom of the builder: **Apply to devices** — optionally scope evaluation to one Applivery Device Audience; membership is re-resolved on every run. Leave blank to check the whole fleet. Directly below it, a **Devices that will receive this policy** box shows, live, exactly which devices the selected audience currently resolves to — the same membership resolution the evaluation itself uses, so an empty or unexpected result here means the audience needs fixing (or a different one picking) before you save, not a surprise after. If it comes up empty for an audience you know has members, it also shows what Applivery's API itself returned for that audience, to help tell a permissions issue apart from a genuinely empty one.

### Conditions — the full field catalog

Each condition is Field → Operator → Value. Choose **Match ANY condition** (OR) or **Match ALL conditions** (AND) for the whole set.

| Field | Notes |
|---|---|
| Applivery compliance flag | Compliant/Non-compliant |
| Platform | apple, macos, android, windows |
| OS version | less/greater than, equals |
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
| Self-Reported Attribute (agent) | from the optional self-report script — e.g. `diskEncryptionEnabled`, `screenLockEnabled`, `antivirusEnabled`. Needs [Settings → Device Data Webhook](settings.md#device-data-webhook) set up and the matching script deployed |
| Days since last self-report / Has ever self-reported | |
| Custom Device Check result | pick one of the checks defined in [Settings → Custom Device Checks](settings.md#custom-device-checks) — any admin-defined process/service/registry-or-plist/app-version/command check the native agent runs locally on each device. Windows-authored checks only ever appear as options on a Windows-scoped policy, and macOS-authored checks only on a macOS-scoped one |
| **Missing a required app** (App List) | pick an existing App List — only matches devices on that list's platform |
| **Has a disallowed app** (App List) | same, inverse |
| Device Risk Score / Risk Tier | |
| Pending Windows security updates / exploited-CVE pending | needs the OS Updates catalog to have run at least once |
| Pending known CVEs (Apple/Android) / exploited-in-wild pending | Vulnerability Catalog, no Settings needed |
| OS version is end of life | OS Lifecycle catalog, no Settings needed |
| Pending Apple app updates | |
| Critical/high CVEs — Vulnerability Service / known-exploited CVE present / checked against Vulnerability Service | needs [Settings → Vulnerability Service](settings.md#vulnerability-service) enabled and configured |

There is no dedicated "jailbreak/root" or "disk encryption" field type for every platform — those are built from **Custom device field** (Android) and **Self-Reported Attribute** (Windows/macOS agent) instead; iOS has no disk-encryption signal at all (Apple ties it to passcode enforcement).

**Then run** — pick the primary Workflow (required to save).

**Mark on Applivery console**: a **non-compliance tag** (applied while violated, removed on recovery — give each policy its own distinct tag) and/or a **Smart Attribute** to attach/detach. Either, both, or neither.

**Case Management**: **Open a Case when violated** (default on) and, only if that's on, **Auto-resolve the Case once the device recovers** (default off — recommended only for conditions that reliably self-heal; otherwise let an analyst confirm the fix first).

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

## App Lists sub-view

An **App List** is a named, platform-specific catalog of apps (by bundle ID / package name / product ID), referenced by the "Missing a required app" and "Has a disallowed app" conditions above.

**Creating a list**: Name, Platform (locked once created), optional Description, then add apps three ways:
- **Quick-start presets** (common browsers, collaboration apps) — one click, but worth spot-checking since they're not guaranteed 100% current.
- **Search** — Apple App Store (iOS/macOS), Homebrew Cask (macOS, name only — confirm the bundle ID via `mdls`), Microsoft Store/Winget (Windows — Winget is a community index, unofficial), or "Known Apps" (Android — only apps already known to your org's App Distribution/Android Enterprise catalog, since there's no free Play Store search API).
- **Manual entry** — name + raw identifier for anything not found via search.

Each list shows its app count and which Compliance Policies currently reference it; deletion is blocked while still referenced.

**Installed-app inventory sync panel** at the top of the page shows coverage % (devices synced), self-reported count, oldest sync age, an estimated full-refresh cycle time, error count, and a manual **Refresh now**. This panel stays idle until at least one enabled policy actually uses an App List condition — until then there's nothing to sync for.

## Settings this view depends on

- **[OS Updates](settings.md#os-updates)** — powers the pending-update conditions; needs at least one catalog refresh to have happened.
- **[Vulnerability Service](settings.md#vulnerability-service)** — opt-in, needs an API token configured before its conditions produce real data.
- **[Device Data Webhook](settings.md#device-data-webhook)** — required for Self-Reported Attribute conditions (disk encryption, screen lock, antivirus on Windows/macOS).
- **[Custom Device Checks](settings.md#custom-device-checks)** — required for Custom Device Check result conditions; a check must exist (and be enabled) before it shows up as a pickable condition.
- **App List inventory** — populated either via the self-report script or the paced background Applivery-API refresher; a brand-new App List condition won't match anything until coverage catches up.
- **[Roles](settings.md#roles)** — `canBulkTriage` gates bulk approve/dismiss on the violations queue; `canDeletePolicyOrWorkflow` gates policy deletion.

## Related guides

- [Workflows](workflows.md) — build the workflows a policy links to, including the destructive-action rules that gate auto-run.
- [Cases](cases.md) — how policy violations become Cases and inherit MITRE tags.
- [Devices](devices.md) — the "Compliance Policies" signal shown on the fleet table and device drawer.
