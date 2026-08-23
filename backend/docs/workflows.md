# Workflows — Admin Guide

**Workflows** are chained actions — MDM commands, API calls, and notifications — that you run manually, auto-fire from a [Compliance Policy](compliance.md) violation, launch from a [Case](cases.md), or trigger from a third-party tool. This guide covers all three sub-views reached via the tab switcher at the top right: **Workflows** (the list, builder, and run history), **Script & OMA-URI Library**, and **Firewall Policy Library**.

## Workflow list

The list is a searchable, sortable table — the same list experience as the Devices view: a search box (matches name and description) and sortable columns (Workflow, Platform, Steps). Each row shows the step count, a target platform badge (e.g. "iOS · Supervised") if the workflow has a locked target, description, and an orange **MDM** warning badge in the Flags column if any step touches a device directly. If the workflow also has a destructive step (wipe, unenroll, and similar) and its author has marked it **"approved to run unattended"** (see [Unattended auto-run approval](#unattended-auto-run-approval) below), a second green **Auto-run approved** badge sits next to the MDM one. Below 768px wide, the table becomes a stacked card list instead.

Row actions:
- **Run** — opens the [device picker](#running-a-workflow). Disabled with a tooltip if the workflow has an MDM step and your role lacks the destructive-workflow permission.
- **Dry run** (test tube icon) — [safe preview](#dry-run), nothing executes.
- **Version history** (clock icon) — [past snapshots](#version-history), with restore.
- **Edit** / **Delete** (delete respects `canDeletePolicyOrWorkflow`).

**Recent runs**, below the list: each row's status icon shows Running (spinning), Waiting (parked at a wait step), Completed (all succeeded), Partial (mixed), or Failed. A date-range filter and **Export CSV** sit above it; **Show more** loads 20 at a time.

## Building a workflow

### Step 1 — target

Pick a **Platform** — **Common (all platforms)**, iOS, macOS, Android, Windows, or AOSP — and, for iOS, macOS, or Android, a **Deployment Model** (Supervised/Unsupervised for Apple; Work Profile/COPE/Device Owner for Android). Windows has one management model, so it's skipped. AOSP is Device Owner only. **Common** is what a Workflow linked to a **Common**-type [Compliance Policy](compliance.md) needs — a policy with no platform restriction of its own requires a Workflow that isn't locked to one platform either, so it can actually fire for whichever platform violated it.

The target you pick filters every MDM Action step to only the actions actually compatible with that platform/model. Changing the target later automatically clears any step whose action is no longer valid, so you have to re-pick it. Non-MDM steps (HTTP, Notification, Wait, Monitor, the policy steps) stay available regardless of target. **Common** is the one exception on the MDM side: since it isn't a single platform, MDM Action and Run Script & Wait steps aren't offered at all for a Common-targeted workflow — build it from the platform-agnostic step types above (HTTP, Notification, policy steps, etc.).

### Step 2 — steps

Add as many steps as you need, in order. Every step type:

**MDM Action** — pick from a dropdown filtered to what's compatible with your target. Destructive actions are marked with a warning icon; actions not yet wired to a confirmed Applivery API call are labeled "(not wired yet)" and will fail cleanly with an explanation rather than silently do nothing. Per-action fields render dynamically (e.g. "Run script" needs a Script Library entry, "Apply Firewall Rule Set" needs a rule set — see the library sections below).

**Run Script & Wait for Result** — a distinct step type from an MDM Action's "Run script." Pick a script from the [Script Library](#script--oma-uri-library) (filtered to your target platform) and a timeout in minutes (default 30). Unlike the MDM Action version, which fires-and-forgets (moves on as soon as Applivery accepts the command), this step **pauses** that device's chain until the Applivery agent actually reports a result back — success only counts if the script itself exits clean, and failure fires on script error, timeout, or the device never reporting back (e.g. offline). This is what makes conditional chains like "only quarantine if the remediation script actually failed" possible.

**HTTP Request** — Method (GET/POST/PUT/PATCH/DELETE), URL, Headers (JSON), Body. Both URL and body support `{{ device.x }}` templating, resolved per-device at run time.

**Notification** — Channel: Google Chat webhook (optional per-step URL override, blank = the org-wide one from Settings), Email (Target: admin only / device's assigned user only / both, admin recipients, subject — note devices with no assigned MDM user will fail this step if targeting the user), or Applivery push (requires the Applivery Agent on-device; has a Title field). The Message field supports `{{ device.x }}` templating on every channel.

**Quarantine (Replace Policies)** — pick a replacement policy. Replaces **all** of the device's current policies with it, after automatically snapshotting the original stack so it can come back later.

**Add Policy** — pick a policy and a **Priority**: Primary (top) or Lowest (fallback). Adds alongside the existing stack rather than replacing it; also snapshots first.

**Restore Policies** — no fields. Restores whatever was snapshotted by the *first* Quarantine or Add Policy step for that device, then clears the snapshot. A graceful no-op if nothing is currently quarantined.

**Monitor Compliance** — pick a Compliance Policy to re-check, and a **"Restore previous policies automatically when compliant again"** checkbox (default on). This is how a tiered escalate → wait → monitor → auto-restore pattern is built: on success (compliant again) the default is Stop, ending cleanly; on failure (still violating) the default is Next step, so you can escalate further or jump back to an earlier Wait to keep looping.

**Wait** — Amount (number) + Unit (Minutes/Hours/Days). Pauses that device's chain before continuing, so a multi-tier sequence can space itself out over real time. This — and "Run Script & Wait" — only survive a backend restart or hold for hours/days safely when the deployment has its optional database configured (see the [deployment guide](../README.md#deployment) and [Architecture guide](../ARCHITECTURE.md)); without it, a workflow containing either step type is refused at launch rather than started unsafely.

### Branching

Every step (except recovery steps) has **On Success** and **On Failure** dropdowns:
- **Next step (default)** — falls through to whatever's physically next. For On Failure specifically, the unset default is actually **Stop** — a failed step halts that device's run unless redirected.
- **End workflow** — ends this device's run here, regardless of position.
- **Jump to: [step name]** — one option per other step, so you can build loops (failure jumps back to an earlier Wait to retry) or skip ahead (success jumps past several steps to a final notification).

### Recovery steps

At the bottom of the Steps screen: an **Enabled** checkbox and a linked **Compliance Policy** dropdown. The moment that policy stops being violated for a device, the main escalation steps stop right there (no further steps run for that device), and the recovery steps run once, in order — a linear cleanup pass, not another escalation chain.

Two things happen on recovery:
- **Automatically** — any main-chain "Run script" step that had a **restore/rollback script** configured in its own field gets that paired restore script re-fired for every device where the original step actually ran.
- **Manually, via steps you add here** — everything else needed to fully undo the escalation: a Restore Policies step, reinstalling something removed, re-enabling the device, a closing notification, and so on.

### Unattended auto-run approval

If any step is a destructive MDM Action (wipe, unenroll, and similar — the same set flagged with the warning icon in the step picker), the Steps screen shows an extra panel: **"This workflow is approved to run unattended."** This is a per-workflow, author-set default — it records the workflow author's own judgment that this specific chain is safe to fire without a human watching, independent of who ends up using it.

Important: checking this box does **not**, by itself, let any Compliance Policy, Case Auto-Run Rule, or Applivery Event rule auto-fire the workflow unattended. Every one of those still requires its own separate acknowledgment checkbox (see [Compliance](compliance.md#auto-run) and [Settings](settings.md#case-auto-run-rules)) before autoRun is actually allowed for that policy/rule. All this switch does is **pre-fill** that checkbox to checked the moment someone newly selects this workflow in a Policy/Rule editor — a convenience for the common case where the two decisions agree, not a bypass. A human still has to save the Policy/Rule with the checkbox checked for autoRun to take effect, and editing an existing Policy/Rule never silently flips its already-saved acknowledgment based on this flag.

Leave the box unchecked (the default) for workflows whose destructive steps should always require a fresh, explicit decision per Policy/Rule that adopts them.

## Running a workflow

Click **Run** (from the list, a device drawer, or a case) to open the device picker, which has three modes:
- **Pick devices** — search + checkbox multi-select.
- **By Device Audience** — pick an Applivery Device Audience; every current member is targeted.
- **By Tag** — pick a tag present on any device; every matching device is targeted.

Confirm reads "Run on N devices." Audience/Tag runs record a target description (e.g. "Device Audience: Finance Laptops") visible later in Recent runs.

**Run Result modal**: while in progress, shows "Running X of Y" or "Waiting on N devices…" with a note that it's safe to close and check back later — the run keeps executing server-side regardless. It polls automatically every 1.5 seconds. Each device gets its own card with an overall status and a per-step breakdown; steps that ran as part of automatic recovery are tagged **RECOVERY** so you can tell escalation from cleanup at a glance.

## Dry run

A read-only preview against a **sample device** or a real device you search for. No MDM commands, API calls, or notifications are actually sent — every step is assumed to succeed, with the failure branch shown for reference only. Each step shows its plain-English summary and its On Success/On Failure targets. Recovery steps preview separately, if enabled.

## Version history

Every save (edit or restore) automatically snapshots the previous version — there's no manual "save version" step. The list shows each snapshot's timestamp, who made the change, and step count. **Show/Hide changes** toggles a lightweight diff against the current version (added/removed/changed rows — index-based, so a step inserted mid-chain can show as several "changed" rows rather than one clean "added" row). **Restore** snapshots the current version first (so nothing is lost), then reverts.

## Script & OMA-URI Library

A named reference library you can pick from a workflow's "Run script" and "Custom OMA-URI command" steps, instead of retyping an Asset ID or path/value every time.

**Two entry types:**

- **Script** — points at a script Asset already uploaded to Applivery (or write a new one directly here, which uploads it to Applivery's Global segment for you). Fields: Type, Platform (Windows/macOS), Name, Description, and either a search-and-pick of existing Applivery script Assets, a pasted Asset ID, or a new script written inline. Execution **scope** (Machine/User) and optional **Arguments** (with quick-insert buttons for variables Applivery itself resolves at execution time: `device.id`, `device.displayName`, `device.serialNumber`, `device.osVersion`, `device.chip`, `device.hostName`, `user.id`, `user.email`, `user.name`). Script execution is a direct, per-device push — Applivery resolves the argument variables itself when the script runs.
- **OMA-URI command** — a direct, one-off Windows CSP command, not tied to a Policy. Fields: Path, Action (Add/Replace/Delete/Exec/Get/Copy), Format, and an optional Value that supports local `{{ device.x }}` templating (resolved before the command is sent — a different, wider variable set than the script Arguments above).

**Fetch from Applivery** bulk-imports existing script Assets already uploaded to your org. **Import from Git repo** connects an external script repository and imports from there. Like the Workflow list above, the library is a searchable, sortable table (search box plus Type/Platform filter pills, sortable Name/Type/Platform columns), and drops to a stacked card list below 768px wide; each entry has Edit and Remove actions.

## Firewall Policy Library

**Windows only.** Build a set of Windows Firewall rules once, then reference it from a workflow's **Apply Firewall Rule Set** and **Restore Firewall** steps — the network-remediation equivalent of Quarantine/Restore Policies, but for the OS firewall instead of MDM policies.

Every rule this library creates is tagged with a unique group name so it can always be cleanly identified and removed later. Restore only removes this rule set's own tagged rules — it is **not** a full firewall snapshot/restore. A device's prior firewall state returns automatically once the tagged rules are gone, assuming nothing else changed the firewall in the meantime.

**Creating a rule set**: click **Add to library**, then either start from a template or from scratch.

- **Name**, **Description**.
- **Ensure Windows Firewall is enabled when applying** — turn this **off** for devices running a 3rd-party EDR, since EDR agents commonly require Windows Firewall to stay off to avoid conflicting with their own driver-level rules. When off, this rule set only adds/removes its own rules and never touches the firewall's on/off state. You decide this per rule set, per your fleet's actual EDR footprint — the app never tries to detect it automatically.
- **Default inbound/outbound action** (Leave as-is / Block / Allow) — Windows Firewall always lets an explicit Block *rule* beat an explicit Allow *rule*, regardless of order. So a genuine "block everything except these exceptions" posture can only be built by changing the **default action** here and then adding Allow rules below as the exceptions — a naive "block-all rule + allow-exception rule" pair silently never lets the exception through. Leave both "as-is" for rule sets that only add specific Block/Allow rules (e.g. blocking one port) without touching the fleet-wide default. Restore reverts these to Windows' own out-of-box defaults (inbound Block, outbound Allow) — only for whichever axis you actually configured.
- **Rules** — add as many as needed, each with: Name, Direction (Inbound/Outbound), Action (Block/Allow), Protocol (Any/TCP/UDP), Local port(s) (only meaningful for TCP/UDP), Remote address(es) (comma-separated IPs/CIDRs, or Any), Profile (Any/Domain/Private/Public, combinable), and Enabled.

**Starter templates** (pre-fill the builder — you still review and save):
- **Isolate Device** — blocks all inbound/outbound by default via the profile's default posture, with a disabled placeholder Allow rule for management traffic you fill in and enable yourself.
- **Block Lateral Movement (SMB/RDP/WinRM)** — blocks inbound SMB (445), RDP (3389), and WinRM (5985-5986) from anywhere, without touching the default posture.
- **Block Outbound to IP/CIDR** — a disabled placeholder Block rule for ad-hoc containment of a specific address (e.g. a threat-intel hit); fill in the address and enable it.

Once saved, reference the rule set from a workflow's **Apply Firewall Rule Set** (destructive) or **Restore Firewall** (non-destructive) MDM Action step. Deleting a rule set from the library does **not** auto-restore any device it's already been applied to — it only removes your ability to apply/restore it via new workflow runs going forward; a device keeps its rules until an explicit Restore action runs.

Like the other two sub-views, the library is a searchable, sortable table (search box, sortable Name/Rules columns, posture badges), dropping to a stacked card list below 768px wide.

The device detail drawer's [Firewall Rule Sets section](devices.md#overview-tab-section-by-section) shows what's currently believed active per device, based on the last dispatched Apply/Restore action.

## Settings this view depends on

- **[Roles](settings.md#roles)** — `canRunDestructiveWorkflow` (running/auto-running a workflow with a destructive step), `canDeletePolicyOrWorkflow` (deleting a workflow).
- Durable **Wait**/**Run Script & Wait** steps need the deployment's optional database configured — see the [README deployment guide](../README.md#deployment).

## Related guides

- [Compliance](compliance.md) — how a policy links to and auto-fires a workflow.
- [Cases](cases.md) — running a workflow directly from a case.
- [Devices](devices.md) — running a workflow against one device from its drawer, and the Firewall Rule Sets section.
- [Settings](settings.md) — role permissions and the automation credential background jobs use.
