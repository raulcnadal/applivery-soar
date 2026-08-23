# Applivery SOAR Integration Guide — EDR, XDR, MTD & DEX

This guide is for admins wiring an external endpoint/mobile security tool — EDR (endpoint detection & response), XDR, MTD (mobile threat defense), DEX (digital experience/anomaly monitoring), or anything similar that can fire an outbound webhook — into Applivery SOAR so its alerts actually **do** something here: get visibility as a Compliance violation, open a Case, run a remediation Workflow, and — critically — clean themselves up automatically once the external tool says the alert cleared.

It assumes you're already familiar with the three features it combines. If not, read these first:
- [Settings → Inbound Webhooks](settings.md#inbound-webhooks) — the Fire/Resolve URLs.
- [Compliance → Policy Builder](compliance.md#policy-builder), specifically the [Inbound Webhook Fired condition](compliance.md#conditions--the-full-field-catalog).
- [Workflows](workflows.md) — the step catalog (MDM actions, Quarantine, Firewall Rule Sets, Notifications) this guide's examples are built from.

## Why this guide exists

An Inbound Webhook Trigger on its own answers "run this one Workflow when my EDR calls this URL." That's enough for a single, simple response ("EDR flags malware → lock the device"), but most real EDR/XDR/MTD/DEX programs want more than a one-shot action:

- **Visibility** — a device an EDR agent flagged should show up as a genuine compliance violation in SOAR, not just a one-line audit-log entry, so it's tracked, reported on, and doesn't silently expire.
- **A real Fired/Resolved lifecycle** — the alert clearing on the EDR side should un-flag the device in SOAR automatically, not leave it permanently marked non-compliant.
- **A response ladder** — notify first, contain if it persists, escalate to something destructive only as a last resort, and require a human for the truly destructive tier unless you've explicitly decided otherwise.

Triggers plus Compliance Policies together cover all three. This guide is the worked-example version of that combination, specifically for the class of tool (EDR/XDR/MTD/DEX) whose alerts are inherently *about* a device's security state — exactly what a Compliance Policy is built to track.

## The three building blocks, recapped

**1. Inbound Webhook Trigger** (Settings → Inbound Webhooks) — a URL of the form `.../api/triggers/fire/{id}/{secret}` your EDR/XDR/MTD/DEX tool POSTs JSON to. Every Trigger:
- Always runs **one specific linked Workflow**, immediately, unconditionally — there's no payload-content rule-builder. Different alert types/severities that need different handling need **separate Triggers**, each with its own URL, workflow, and Case settings (see [Multiple Triggers per integration](#multiple-triggers-per-integration-one-trigger--one-response-profile) below).
- Optionally opens a Case (`source: workflow_trigger`, fixed severity, no default assignee — see [Case Management](#case-management-trigger-level-vs-policy-level) below for why a Compliance Policy is usually the better place for assignee routing).
- Optionally resolves a specific device via a **Device lookup field** — the JSON key in your tool's payload that identifies the device (e.g. `serialNumber`), matched against that device's serial number, Applivery device ID, or MDM user email, in that order. Required if you want this trigger to participate in Compliance conditions or the Resolved lifecycle at all.
- Gets a **second URL**, `.../api/triggers/resolve/{id}/{secret}`, once a Device lookup field is set — this is what tells SOAR the alert your EDR/XDR/MTD/DEX raised is no longer active for that device (see [Fired/Resolved lifecycle](settings.md#inbound-webhooks) for the full mechanics).

**2. Compliance Policy** with an **Inbound Webhook Fired** condition (Policy Builder → Watch for → pick the Trigger). This is where the actual visibility + governed response lives:
- The condition matches `exists` for as long as the trigger's Fired state is `active` for that device (i.e. since the last Fire call, before any matching Resolve call) — optionally with a **"treat as no-longer-active after N minutes"** staleness cutoff for a tool that can't reliably call the Resolve URL.
- Everything a Compliance Policy normally does becomes available: **AND/OR with other conditions** (e.g. "EDR fired AND device risk tier is high"), **autoRun with safety limits** (batch cap, destructive-action acknowledgment, escalation on risk tier), an **optional Case with its own default assignee**, **alerts** (webhook/email, independently rate-limited), and a **tag/Smart Attribute marker** applied on Applivery's own console — all of it automatically undone the moment the condition clears (device recovers), whether that's because your tool called the Resolve URL or the policy's own staleness cutoff kicked in.
- A policy's linked Workflow is **optional** — a policy can exist purely to record the violation, apply a tag, open a Case, and/or alert, without running any Workflow at all. Useful for the pure-visibility DEX use case in [Example 3](#example-3--dex-anomaly-signal-visibility-only-no-remediation) below.

**3. Workflow** — the actual response, built from MDM Action steps (lock, wipe, unenroll, relinquish ownership — see the [platform action reference](#platform-action-reference-block-quarantine-wipe-unenroll) below), Quarantine/Add Policy/Restore Policies, Apply Firewall Rule Set/Restore Firewall (Windows network isolation), Wait, Notification, and HTTP Request steps, chained with On Success/On Failure branching and an optional linear **Recovery** chain. Full catalog: [Workflows guide](workflows.md#building-a-workflow).

## Two ways to wire an alert to a response — and when to use which

### Pattern A — Direct fire (fastest, simplest)

Point your tool's webhook straight at a Trigger's Fire URL. The Trigger's own linked Workflow runs immediately, every single time, unconditionally. Optionally opens a Case at a fixed severity.

Use this when the response is genuinely unconditional and single-shot — "any time this specific alert fires, always do exactly this one thing" — and you don't need the device to show up as a tracked Compliance violation, don't need a Resolved-triggered cleanup, and don't need AND/OR logic with other device state.

**Limitation:** no visibility beyond the audit log + whatever Case/Workflow-run history you keep, and nothing auto-reverts if the alert clears — the Workflow already ran.

### Pattern B — Policy-driven (governed, reversible, tiered)

Point the webhook at a Trigger whose own linked Workflow is trivial (a no-op notification, or nothing more than recording the fire), and let a **Compliance Policy** watching that Trigger's "Inbound Webhook Fired" condition own the actual response.

Use this whenever you want any of: visibility as a tracked violation, automatic reversal on Resolve, combining the alert with other device state (risk tier, OS version, other conditions), autoRun safety rails (batch cap, destructive ack), a Case with a specific default assignee, or per-channel-rate-limited alerting.

### Pattern C — Layered (recommended for anything above "notify")

Both at once: the Trigger's own Workflow does something immediate and cheap (log it, ping a Slack/Chat channel, open a lightweight Case right away for on-call visibility), while a Compliance Policy watching the same Trigger governs the actual escalation — tiered, reversible, and with SOAR's own safety rails. This is the pattern the [worked example](#reference-walkthrough) and [practical examples](#practical-examples) below use.

## Multiple Triggers per integration: one Trigger = one response profile

A single Trigger has exactly one linked Workflow, one Case on/off + severity, and one Device lookup field — there's no per-call parameter to vary any of that. If your EDR/XDR/MTD/DEX tool can raise alerts of meaningfully different severity or type that should be handled differently, create **one Trigger per response profile**, not one Trigger for the whole integration:

| Trigger | Linked Workflow | Open a Case | Severity |
|---|---|---|---|
| `EDR — Malware Detected` | Notify on-call (Tier 0) | Yes | critical |
| `EDR — Suspicious Behavior` | Notify on-call (Tier 0) | Yes | medium |
| `MTD — Jailbreak/Root Detected` | Notify on-call (Tier 0) | Yes | high |
| `DEX — Anomaly Signal` | none needed | No | — |

Configure your tool's alert rules to POST to whichever Trigger's URL matches that rule's own severity/type — most EDR/XDR/MTD/DEX consoles let you set a different webhook URL per alert rule or per severity tier already, since this is exactly the pattern generic webhook-only integrations (Slack, PagerDuty, etc.) also expect. Each Trigger then gets its own row in the Policy Builder's Inbound Webhook Fired picker, so a Compliance Policy can watch (and respond to) each response profile independently.

## Identity mapping: making sure SOAR and your tool agree on "which device"

The Device lookup field is a JSON key name, not a fixed identity scheme — whatever key your tool's payload uses, SOAR reads that key's value and compares it (case-insensitively) against three things on every device in the workspace, in order: **serial number**, **Applivery device ID**, **MDM user email**. First match wins.

Practical guidance:
- **Serial number is the most reliable choice** for EDR/MTD tools that run as an on-device agent — it's stable, platform-agnostic, and something Applivery already has from MDM enrollment.
- **MDM user email** works well for DEX/user-experience tools that report per-user rather than per-device, provided the device has an assigned MDM user in Applivery.
- **Applivery device ID** only works if your tool was itself given that ID at enrollment time (e.g. via a custom attribute pushed during onboarding) — uncommon unless you've built that pairing deliberately.
- If your tool's payload nests the identifier (e.g. `{"device": {"serial": "..."}}`), the lookup only reads a **top-level** key — flatten it in your tool's webhook payload template if it supports one, or add a thin translation step (an HTTP proxy, or an intermediate automation tool) that reshapes the payload before forwarding to SOAR's Fire URL.
- A Fire call with no match on a Trigger that has a Device lookup field configured **fails loudly** (404, `trigger_fired_no_device` audit event) rather than silently running a device-less Workflow — this is deliberate, so a broken identity mapping is visible immediately instead of looking like a working integration that quietly does nothing useful.

## Platform action reference: block, quarantine, wipe, unenroll

The exact response ladder differs by platform. This is the practical MDM Action step catalog relevant to a security-driven response (see [Workflows → Building a workflow](workflows.md#building-a-workflow) for the full step type list, including non-MDM steps):

| Response tier | iOS/iPadOS | macOS | Android | Windows |
|---|---|---|---|---|
| Notify only | Notification step (any platform, or Common) | | | |
| Lock the device | Device Lock | Device Lock | Lock | Remote Lock |
| Clear passcode | Clear Passcode | Clear Passcode | Reset Password | Reset Password |
| Network containment | — (use MDM policy Quarantine instead) | — (use MDM policy Quarantine instead) | — (use MDM policy Quarantine instead) | Apply Firewall Rule Set (Isolate Device template) |
| Quarantine (swap MDM policy stack) | Quarantine (Replace Policies) | Quarantine (Replace Policies) | Quarantine (Replace Policies) | Quarantine (Replace Policies) |
| Rotate disk encryption key | — | Rotate FileVault Key | — | — |
| Full wipe | Erase Device | Erase Device | Wipe | Remote Wipe (with Autopilot reset option) |
| Unenroll from MDM | — (use wipe; iOS has no non-destructive unenroll) | — | Device Owner: factory-reset only | MDM Unenroll |
| Relinquish ownership (COPE only) | n/a | n/a | Removes company management/work profile — **not** a data wipe | n/a |

Notes:
- **Quarantine (Replace Policies)** is usually the right "contain without destroying data" first step across all platforms — it swaps the device's entire MDM policy stack for a locked-down one (e.g. blocking corporate resources, restricting apps) while automatically snapshotting the original stack so **Restore Policies** can put it back cleanly on recovery.
- On **Windows**, network-level isolation via a **Firewall Rule Set** (the "Isolate Device" starter template) is a good, fully-reversible Tier 1 response that doesn't touch MDM policy at all — see [Firewall Policy Library](workflows.md#firewall-policy-library). If the device is already running your EDR agent, remember to leave **"Ensure Windows Firewall is enabled when applying"** off for that rule set, since most EDR agents need Windows Firewall left alone.
- **Relinquish ownership** and **full wipe/unenroll** are destructive actions — the Workflow builder flags them with a warning icon, and any Compliance Policy or Trigger that would auto-run one unattended requires an explicit **destructive-action acknowledgment** checkbox (see [Safety rails](#safety-rails-for-an-unattended-security-response-pipeline) below). Treat these as the last rung of the ladder, not the first.

## The escalation ladder — from Notify to Wipe/Unenroll

A tiered Workflow, built with **Wait** and **Monitor Compliance** steps and a linked **Recovery** section, is how you turn "notify → contain → escalate → destructive" into one self-managing chain instead of four separate manual interventions. Skeleton:

1. **Tier 0 — Notify.** First step: a Notification (Chat/Email/Applivery push) so a human knows immediately. On Success → next step.
2. **Tier 1 — Contain.** Quarantine (Replace Policies) and/or Apply Firewall Rule Set. On Success → **Wait** (e.g. 30 minutes) → **Monitor Compliance** (pointed at the same policy that's driving this Workflow).
3. **Tier 2 — Escalate if it hasn't cleared.** Monitor Compliance's On Failure (still violating) branch jumps to a stronger action — a second, harsher Quarantine, or straight to Tier 3 — while its On Success (compliant again) branch just stops; SOAR's own automatic recovery (see below) already handled the cleanup.
4. **Tier 3 — Destructive, gated.** Wipe/Unenroll/Relinquish ownership only after Tier 1/2 demonstrably failed to clear the condition, and only if you've deliberately checked the destructive-action acknowledgment for this specific policy — otherwise, this tier fires into the **review queue** instead of unattended, so a human approves it explicitly (see [Violations / review queue](compliance.md#violations--review-queue)).

### Recovery — what happens when Resolved is called

The moment your tool calls the Trigger's Resolve URL for a device, that device's `Inbound Webhook Fired` state flips to inactive. On the **next** compliance evaluation pass (fired immediately, event-driven, not waiting out the policy's own evaluation interval — see `triggerEventDrivenReEvaluation` in the architecture notes), if that was the only unmet condition:
- The device recovers — status returns to compliant for this policy.
- Any tag/Smart Attribute marker this policy applied is removed from the device on Applivery's own console, automatically.
- A Case this policy opened auto-resolves, if **"Auto-resolve the Case once the device recovers"** is turned on; otherwise it stays open for an analyst to close manually (which itself triggers the same tag/marker cleanup, independent of whether auto-resolve is on).
- If you built a Recovery chain into the Workflow (Restore Policies, Restore Firewall, a "problem resolved" notification), it runs — once, linearly, not as another escalation pass.

If your tool genuinely can't call the Resolve URL (some older/simpler tools only support a single fire-and-forget webhook), set the condition's **"auto-expire after N minutes"** — the device stops being flagged after that window regardless, so it's never stuck out of compliance forever on a resolution that will never arrive. This is a safety net, not the primary signal — prefer wiring the real Resolve callback whenever your tool supports one (most EDR/SIEM/alerting tools that support an outbound "fired" webhook have an equivalent "cleared"/"resolved" callback).

## Case Management: Trigger-level vs. Policy-level

Both a Trigger and a Compliance Policy can open a Case, and they behave differently:

| | Trigger-opened Case | Policy-opened Case |
|---|---|---|
| Title | `Trigger: {name} — {device}` | Policy name + device |
| Source | `workflow_trigger` | policy violation |
| Severity | Fixed per Trigger | Fixed per Policy |
| Default assignee | None (manual assignment only) | Optional — every Case this policy opens/reopens auto-assigns to whoever you set |
| Auto-resolve on recovery | No — always requires manual close | Optional, per policy |
| Reopens on repeat violation | No — a fresh fire opens a new Case each time | Yes — a new violation of the same still-open Case reuses it rather than duplicating |

For anything beyond "notify on-call once," prefer the **policy-opened Case** — the default-assignee routing and auto-resolve/reopen behavior matter a lot once an EDR/MTD tool is generating more than the occasional one-off alert.

## Reference walkthrough

A concrete, minimal end-to-end setup using Pattern C (layered). Substitute your own tool's webhook configuration screen for "your EDR/XDR/MTD/DEX console" below — the SOAR-side steps are identical regardless of which specific product you're integrating.

1. **Build the Workflows first** (Workflows → Create):
   - `EDR Notify (Tier 0)` — one Notification step (Chat/Email), target platform Common. No MDM step, so no destructive-action gating.
   - `EDR Contain & Escalate (Tier 1-3)` — Quarantine (Replace Policies) → Wait 30m → Monitor Compliance (linked to the policy you'll build in step 3) → on failure, Erase Device (Tier 3). Mark the Erase Device step's containing Workflow **NOT** approved to run unattended by default — leave that decision to the Policy's own destructive-ack checkbox.
2. **Create the Trigger** (Settings → Inbound Webhooks → Add):
   - Name: `EDR — Malware Detected`. Workflow: `EDR Notify (Tier 0)`. Device lookup field: `serialNumber`. Open a Case: yes, severity `critical`.
   - Copy the **Fire URL** into your EDR console's webhook action for its "malware detected" alert rule, and the **Resolve URL** into the same rule's "alert cleared" callback, if it has one.
3. **Create the Compliance Policy** (Compliance → Create):
   - Watch for: `Inbound Webhook Fired` → pick `EDR — Malware Detected` (optionally add "auto-expire after 240 minutes" as a safety net).
   - Then run (optional): `EDR Contain & Escalate (Tier 1-3)`.
   - Auto-run workflow: on. Max devices per pass: a real cap (e.g. 20), **not** "No limit" — a noisy/misconfigured EDR rule shouldn't be able to quarantine your entire fleet in one pass unattended (see [Safety rails](#safety-rails-for-an-unattended-security-response-pipeline)).
   - Case Management: open a Case (reuses/extends the Tier 0 Case if you like, or leave the Trigger's own Case as the only one and skip this) with a default assignee (e.g. your SecOps on-call rotation's shared mailbox).
   - Alerts: on, Webhook + Email, capped at a sane per-day limit each.
   - Mark on Applivery console: tag `edr:malware-detected` — gives you an at-a-glance signal directly in Applivery's own device list, independent of SOAR.
4. **Test it** without waiting for a real detection — from a terminal:

   ```bash
   # Fire
   curl -X POST "https://<your-soar-host>/api/triggers/fire/<trigger-id>/<secret>" \
     -H "Content-Type: application/json" \
     -d '{"serialNumber": "C02XG2JMJGH5", "alertName": "Malware.Generic.12345", "severity": "critical"}'

   # ...later, once the "infection" clears...

   # Resolve
   curl -X POST "https://<your-soar-host>/api/triggers/resolve/<trigger-id>/<secret>" \
     -H "Content-Type: application/json" \
     -d '{"serialNumber": "C02XG2JMJGH5"}'
   ```

   Only `serialNumber` (whatever you set as the Device lookup field) needs to be present and correct in the Resolve body — extra fields are accepted but ignored by both endpoints beyond that lookup key. Note the two calls' bodies don't need to match beyond the lookup field itself.

5. **Watch it land**: the device should show a new violation in [Violations / review queue](compliance.md#violations--review-queue) (or fire straight through if autoRun is on and under the batch cap), the tag should appear on the device in Applivery's own console, and a Case should open. Calling the Resolve URL should clear all three on the next evaluation pass (near-immediate, event-driven).

## Practical examples

### Example 1 — Endpoint malware detection → quarantine → escalate to wipe if not cleared

Covered in full in the [reference walkthrough](#reference-walkthrough) above. The key design decision: Tier 1 (Quarantine) is reversible and safe to auto-run broadly; Tier 3 (Erase Device) only fires unattended if you've deliberately checked the destructive-ack box for this specific policy, and even then only after Monitor Compliance confirms the device is *still* violating 30 minutes later — a transient/flaky EDR detection that clears on its own never reaches the wipe step.

### Example 2 — Mobile jailbreak/root detection (MTD) → tag + Case, block corporate resources, unenroll if unresolved

- Trigger: `MTD — Jailbreak Detected`, Device lookup field `serialNumber` (or `imei`/`udid` if your MTD tool reports that instead and Applivery has it as the device's serial), Workflow `MTD Notify (Tier 0)`, opens a Case at `high` severity.
- Compliance Policy: `Inbound Webhook Fired` (this trigger) **AND** `Target Platform is Android/iOS` (if you run this policy workspace-wide and want it scoped) → Quarantine (Replace Policies) to a lockdown policy that strips corporate app/VPN access, tag `mtd:jailbreak`, Case with default assignee = Mobile Security team.
- Because jailbreak/root status rarely "un-happens" without a factory reset, most MTD tools won't ever call a genuine Resolve for this alert type — set a conservative auto-expire (or skip it entirely and require manual Dismiss from the review queue) so the device doesn't silently self-recover while still actually compromised. This is a case where you deliberately **don't** want the automatic Resolve-driven cleanup to be the primary path — require an analyst to confirm remediation (device wiped/reset, or genuinely returned to a trusted state) before manually resolving the Case.
- Full unenroll (Android Device Owner: factory-reset only; there's no soft "just remove MDM" for a jailbroken device) sits as the Tier 3 escalation for a device that stays flagged past a set window, same pattern as Example 1's wipe.

### Example 3 — DEX anomaly signal: visibility only, no remediation

Not every signal should trigger an automated response — a DEX tool flagging "unusual battery drain" or "app crash spike" is valuable as a compliance/reporting signal, not a security incident.

- Trigger: `DEX — Anomaly Signal`, Device lookup field `serialNumber`, Workflow: skip entirely if your integration only needs the Compliance layer — a Trigger still requires *some* linked Workflow, so point it at a trivial one-step "log to Chat" Workflow that does nothing device-impacting.
- Compliance Policy: `Inbound Webhook Fired` (this trigger) → **no Workflow linked** (this is exactly the "alerting/visibility without running any Workflow" use case the optional-Workflow Policy Builder change supports) → Case: off → Alerts: on, Email only, capped at a low per-day limit → tag `dex:anomaly` for visibility on Applivery's own console.
- This gives you a clean audit trail (violation history, review queue entry) and an at-a-glance tag, with zero risk of an over-eager automated response to a signal that was never meant to trigger one.

### Example 4 — Full unenroll/relinquish ownership for a confirmed BYOD compromise (COPE)

- Trigger: `EDR — Confirmed Compromise (BYOD)`, Device lookup field `mdmUserEmail`-mapped key (useful when your EDR reports by user identity rather than device serial for BYOD fleets), Workflow `Notify Security + IT` (Tier 0), opens a Case at `critical`.
- Compliance Policy: `Inbound Webhook Fired` (this trigger) → Workflow `Relinquish Ownership (COPE)` — a single MDM Action step removing company management/the work profile (not a data wipe, so the employee's own personal data/apps are untouched) — **autoRun on, but with destructive-ack checked and Max devices per pass set to 1-2**, since a "confirmed compromise" signal firing for more than a couple of devices in one pass is far more likely to be a broken integration than a real multi-device incident, and you want that scenario queued for review, not auto-fired against everyone.
- No auto-expire on this condition — a confirmed compromise shouldn't self-clear on a timer; require the Resolve callback (if your EDR supports a "confirmed false positive"/"remediated" callback) or manual Dismiss from the review queue.

## Safety rails for an unattended security response pipeline

EDR/XDR/MTD/DEX signals are exactly the kind of noisy, sometimes-bursty input that SOAR's autoRun safety rails were built for. When wiring one in:

- **Max devices auto-fired per evaluation pass** — leave a real number here, not "No limit," for any policy whose Workflow does anything beyond notify. A single broken alert rule, a stale EDR agent update, or a misconfigured detection firing for your whole fleet at once should queue for review past the cap, not auto-run against everyone unattended.
- **Destructive-action acknowledgment** — required before autoRun can fire a Wipe/Unenroll/Relinquish-ownership step unattended. Leave it unchecked and let those fire into the [review queue](compliance.md#violations--review-queue) instead, unless you've specifically decided this exact policy's trigger source is trustworthy enough to skip human approval.
- **Escalate on high-risk devices** — if you already score device risk elsewhere in SOAR (patch level, vulnerability findings, geofence), you can route the *same* Inbound Webhook Fired condition to a tougher Workflow automatically for devices already at elevated risk, without needing a second policy.
- **Per-channel daily alert caps** — a genuinely bad EDR rule that re-fires every evaluation pass shouldn't be able to flood a Slack/Chat channel or an inbox; cap Webhook and Email independently.
- **The review queue is your human-in-the-loop fallback** — anything that trips a safety limit (batch cap, missing destructive ack) doesn't get silently dropped; it lands in Violations / review queue for a manual Approve (runs the Workflow) or Dismiss (records it as handled, with the same tag/marker cleanup as any other resolution path).

## Operational notes

- **Rotating a Trigger's secret breaks both URLs immediately** — Fire and Resolve share one secret. Update both ends of your EDR/XDR/MTD/DEX tool's webhook configuration in the same maintenance window.
- **Audit trail**: every fire/resolve (and failure to match a device) is recorded — `trigger_fired`, `trigger_fired_no_device`, `trigger_resolved`, `trigger_resolved_no_device` — visible in the workspace Audit Log, independent of whether a Compliance Policy is watching that trigger at all.
- **Per-device visibility beyond the audit log**: each Trigger's row shows total fire count and last-fired time; per-device Fired/Resolved state is what actually backs the Compliance condition, and is visible through the resulting violation/Case/tag rather than as its own dedicated device-level screen.
- **`{{ device.x }}` templating in a Trigger-launched Workflow** (Notification/HTTP Request steps) only has access to the matched device's own identity fields — `id`, `displayName`, `platform`, `platformDeviceId`, `serialNumber`, `osVersion`, `manufacturer`, `model`, `udid`, `mdmUser` (e.g. `mdmUser.email`). Your tool's own payload fields (alert name, malware family, detection ID, and similar) are **not** injected into that templating context — if you need that detail in a notification, an HTTP Request step's own static Body can still reference `{{ device.x }}` for device identity, but not anything from the inbound Fire/Resolve call itself. If you need the raw alert detail relayed onward, do it directly from your EDR/XDR/MTD/DEX tool's own webhook action (most can POST the same alert to two destinations) rather than round-tripping it through SOAR.
- **No automation credential configured** → both endpoints return `503` rather than a silent no-op; set one under [Workspace Automation](settings.md#workspace-automation) before going live.

## Quick reference

**Endpoints:**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/triggers/fire/{triggerId}/{secret}` | secret-in-path | Fires the linked Workflow, optionally opens a Case, marks this device's Trigger state `active` |
| POST | `/api/triggers/resolve/{triggerId}/{secret}` | secret-in-path | Marks this device's Trigger state `resolved` — no Workflow run, no Case opened |

**Compliance condition:** `Inbound Webhook Fired` — pick a Trigger, operator `exists`/`missing`, optional `auto-expire after N minutes`.

**Related guides:** [Settings → Inbound Webhooks](settings.md#inbound-webhooks) · [Compliance → Policy Builder](compliance.md#policy-builder) · [Workflows](workflows.md) · [Cases](cases.md)
