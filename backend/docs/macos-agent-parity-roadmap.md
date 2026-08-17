# macOS SOAR Agent — Feature Parity Roadmap

**Status:** proposed, not started. Written after a research pass over three codebases — the existing macOS agent (`applivery-soar-agent-macos`, Go, already live in production doing basic telemetry + Custom Device Checks), the Windows agent (`applivery-soar-agent-windows`, Go + native tray, full mTLS/watchdog/Event-Watches/tray-card feature set), and the backend (confirming what's already platform-agnostic vs. Windows-only) — plus current PPPC/notarization deployment practice. No code in this roadmap has been written yet.

**Goal:** bring the macOS agent to full feature parity with the Windows agent — mTLS device identity, Force report/Force evaluate compliance, Event Watches, a native menu-bar status app with the same BlueSky-styled card, notifications, and process supervision — while producing everything an admin needs to actually deploy this through Applivery UEM (PPPC profile, Gatekeeper/notarization, LaunchDaemon/LaunchAgent scope).

---

## 0. What's already true — the good news

A research pass over the backend (see §9 for the full breakdown) found that **most of the backend is already platform-agnostic**. Concretely, these need **zero backend changes** — only a macOS Go/Swift client implementation:

- **mTLS PKI** (`DeviceCertificate`/`CertificateAuthority`/Global Bootstrap Token, `/api/device-mtls/register`+`/renew`) — no `platform` column anywhere in the data model, no platform check in any route. A macOS agent presenting a CSR today would register exactly like a Windows one.
- **Force report / Force evaluate compliance** (`POST /api/device-data/evaluate-now`) — this was never a server push in the first place, on either platform: it's the agent calling this endpoint synchronously when a human clicks a button. No polling, no marker file on the backend side — the "trigger file" pattern described below is purely an implementation detail *inside* the Windows agent (service ↔ tray IPC), not something the backend knows about.
- **Custom Device Checks** — `CHECK_PLATFORMS = ["windows", "macos"]` already, with explicit macOS branches for every checker type. The macOS agent already implements all five (`customchecks_macos.go`) — this is done.
- **Compliance conditions** (disk encryption / firewall / screen lock) — already normalized to shared keys (`diskEncryptionEnabled`, `firewallEnabled`, `screenLockEnabled`) that both `BitLockerStatus` (Windows) and `FileVaultEnabled` (macOS) map onto. Templates already ship parallel Windows/macOS entries per framework.
- **Agent Logs/Trace fetch-on-demand** — keyed by Applivery's own device `_id`, no platform branch anywhere.
- **`installLocation`** on reported apps — plain optional string, not platform-typed (one stale Windows-only *comment*, nothing enforced).

What genuinely needs backend work is narrow: **Event Watches** (`WATCH_PLATFORMS = ["windows"]` today, explicitly gated — §5) and the **Device Data Webhook panel's Bootstrap Token generation** (frontend-only — currently tells the admin "macOS has no mTLS support yet" — §1.4).

This changes the shape of the roadmap: most of the work below is macOS-agent-side (Go daemon + new SwiftUI app), not backend.

---

## 1. Phase 1 — mTLS device identity

Port `mtls_windows.go`'s design 1:1, swapping only the OS-specific keystore mechanics.

- **Keystore: file-based, matching the Windows v1 choice deliberately** — Windows' own `mtls_windows.go` explicitly disclosed using PEM files under `%ProgramData%` rather than the real Windows Certificate Store/CNG, as a v1 simplification. The equivalent macOS "correct" answer would be the Keychain (`Security.framework`, `SecItemAdd`/`SecIdentity`), but that requires CGo bindings and loses the "no local Windows/GDI to verify" pragmatism that kept the Windows agent buildable/testable without a full native toolchain in CI. **Recommendation: mirror Windows exactly for v1** — PEM files under `/Library/Application Support/Applivery/SOAR/mtls/` (`device-cert.pem`, `device-key.pem`, `ca-cert.pem`), permissions locked to `root:wheel 0600` (this agent already runs as root via LaunchDaemon, so no ACL gymnastics needed — simpler than Windows' `icacls` dance). Keychain migration can be a later hardening pass on both agents together, not a blocker here.
- **Flow** — identical to Windows: `ensureMtlsIdentity()` once per report cycle; no identity + `BootstrapToken` configured → generate ECDSA P-256 keypair + CSR → `POST /api/device-mtls/register` with `X-Bootstrap-Token`; identity exists and inside the renewal window (1/3 of validity remaining) → `POST /api/device-mtls/renew` authenticated via the current client cert, fresh keypair each time.
- **Config field** — add `BootstrapToken string` to `Config` (`config.go`), matching the Windows agent's field name for a shared Managed Configuration template.
- **HTTP client factory** — one `mtlsHTTPClient()` (Go's `crypto/tls` `Certificates` field pointed at the loaded identity) deciding cert-vs-legacy-secret per call, same seam as Windows.
- **Diagnostics** — port the `responseBodySnippet(resp)` fix from this session's Windows work (log the actual JSON error body on any non-2xx, not just the status code) from day one — it's what let us diagnose the Windows 401 storm in minutes instead of days; no reason to ship macOS without it.

**Backend-side:** none. **Frontend-side:** `DeviceDataWebhookPanel.vue` currently tells the admin macOS gets "only the plain report secret" — once this phase ships, generate the macOS Managed Configuration (see §1.1 below) with `BootstrapToken` included, same as the Windows bundle.

### 1.1 Managed Configuration format

Windows uses a flat JSON file; macOS MDM configuration profiles are natively `.mobileconfig` (XML plist), but this agent already reads a flat JSON file at `/Library/Preferences/es.mi-labs.soar.agent.json` rather than a real `com.apple.ManagedClient.preferences` domain — keep that pattern (it's simpler, and Applivery UEM's "Custom Settings" payload can push an arbitrary file to an arbitrary path same as any other MDM). Add `bootstrap_token` as a new key, generated fresh per-device or per-fleet exactly like Windows' equivalent flow.

---

## 2. Phase 2 — Process supervision (the "watchdog", macOS-shaped)

Windows needed a **custom mutual-watchdog** (`AppliverySOARWatchdog` service polling `AppliverySOARAgent` and vice versa, 30s interval) specifically because **Windows SCM does not restart a killed service on its own** unless configured with Recovery Actions (and even those are commonly overridden by tamper attempts) — hence a second, independent service.

**launchd does not have this problem.** A `LaunchDaemon` with `KeepAlive: true` (or the more precise `{"SuccessfulExit": false}` form) is restarted by `launchd` itself, unconditionally, with no custom supervisor process needed. This is a genuine simplification, not parity-for-parity's-sake — Phase 2 is smaller than its Windows counterpart:

- **LaunchDaemon** (`es.mi-labs.soar.agent`, existing) — add `KeepAlive` (already implicitly true via the plist's current `<true/>`, confirm it survives a `kill -9`, not just a clean exit) and a sane `ThrottleInterval` (e.g. 10s) so a crash-loop doesn't hammer the backend.
- **LaunchAgent** (new, per-console-user, for the menu-bar app — §3) — same `KeepAlive` treatment, loaded via `bootstrap gui/<uid>` rather than `system`.
- **Tamper-resistance framing** — be honest about this the same way the Windows README already is (`§"Tamper resistance"`: "a deterrent, not a hard guarantee" — stopping the service gets it restarted within ~30s, but a determined local admin can always defeat it). On macOS the equivalent statement is: `launchctl bootout` by a user with `sudo` unloads the daemon and launchd will *not* re-bootstrap it until next boot or an explicit `bootstrap` — same limitation, no new promise being made. Document this plainly rather than overselling it.
- **Self-check, not mutual-watchdog** — since launchd already restarts each process independently, the one thing still worth checking is *cross-process* health the way Windows' `EnsureTrayRunning` does: does the daemon verify the LaunchAgent is actually loaded for the active console session (`launchctl print gui/<uid>/es.mi-labs.soar.tray`), and re-bootstrap it if the user logged in before the LaunchAgent's `RunAtLoad` ever fired (edge case: MDM pushes the LaunchAgent plist while the user is already logged in — `RunAtLoad` won't retroactively fire). A periodic check from the daemon (which already has a ticker loop) covers this in a few lines, no second binary needed.

---

## 3. Phase 3 — Menu bar app (SwiftUI)

**Shipped.** Implemented essentially as designed below, with two naming/scope
notes worth recording here rather than only in the macOS repo's own README:
the bundle identifier actually used is `es.mi-labs.soar.menubar` (not the
`es.mi-labs.soar.tray` placeholder in §7 below — "menu bar" reads clearer
than "tray" for the macOS-native term, and nothing downstream depended on
the placeholder value yet), and the daemon-side "is the LaunchAgent actually
loaded" self-check mentioned in Phase 2's bullet above is still NOT built —
see the macOS repo's README "Process Supervision" section for the honest
disclosure of that gap and why it's low-priority (the LaunchAgent installs
once via the `.pkg`'s postinstall script and is rarely removed by anything
short of a full uninstall). Everything else below — IPC contract, SwiftUI
card layout/data model, fonts, notifications — shipped as designed.

This is the biggest net-new piece, and where Xcode access matters. Structure:

- **New target: `Applivery SOAR.app`** — a proper `.app` bundle (not a bare binary like the Go daemon), `LSUIElement: true` in `Info.plist` (no Dock icon, no menu bar app switcher entry — matches the Windows tray's "no taskbar window" feel), registered as a **LaunchAgent** (`~/Library/LaunchAgents` or, for MDM-wide deployment, `/Library/LaunchAgents` so it self-installs for whichever user logs in — matches Windows' `schtasks ONLOGON` scope).
- **Menu bar icon: `NSStatusItem`** with a template image (`isTemplate = true`) — this is a genuine simplification over Windows: template images auto-invert for light/dark menu bar themes with zero manual swap logic, versus the Windows tray's two separate `.ico` files (`tray_light.ico`/`tray_dark.ico`) and its own `isLightTheme()` registry read. One asset, not two.
- **Status card: SwiftUI, not hand-rolled drawing** — this is the other big simplification. Everything the Windows `card.go`/`gdi.go` had to hand-implement with raw GDI (rounded rects, pill borders, DPI-scaled fonts, `AddFontMemResourceEx` private font loading) is native in SwiftUI: `RoundedRectangle`, `.font(.custom(...))`, automatic Retina scaling. Layout mirrors the just-shipped Windows card exactly (device name + Status/compliance pills top-right, Force report / Force evaluate compliance buttons, Reporting section, Compliance section with risk bar + policy list, footer "Managed by {slug}") — same BlueSky tokens (`SKILL.md`), translated to actual SwiftUI `Font`/`Color` values instead of hand-picked GDI pixel constants.
- **Fonts** — same 3 Outfit static weights already added to the Windows repo (`Outfit-Regular/SemiBold/Bold.ttf`) get added to this app's bundle and registered via `Info.plist`'s `ATSApplicationFontsPath` (or `UIAppFonts`-style `CTFontManagerRegisterFontsForURL` at launch) — no private-memory-loading tricks needed, bundled fonts are just available to `Font.custom` directly.
- **IPC with the daemon — file-based, mirroring Windows deliberately** (not XPC). XPC is the more "idiomatic" macOS answer, but it requires a signed Mach service contract between a root LaunchDaemon and a per-user LaunchAgent, which is meaningfully more moving parts (service name registration, bundle ID trust) for a first pass, and the Windows agent already proved the file-based approach is simple, debuggable with `cat`, and good enough for a status readout + a couple of trigger flags. Concretely, under `/Library/Application Support/Applivery/SOAR/` (root-owned dir, `0755` so any user can read/traverse):
  - `status.json` — written by the daemon after every report cycle, `0644`.
  - `trigger-report.flag` / `trigger-evaluate.flag` — written by the LaunchAgent (unprivileged user) on button click. Since the directory is root-owned, the LaunchAgent can't write directly into it — options: (a) a dedicated subdirectory `.../triggers/` created `0777` (world-writable, but the files carry no sensitive payload — same threat model as Windows' own trigger files, which are also just presence markers), or (b) a `_appliverysoar` system group with the daemon running `setgid`-writable — (a) is simpler and matches Windows' own "it's just a marker, not a secret" reasoning; recommend (a) unless you'd rather harden it now.
  - Same read/poll cadence as Windows: status on open + 60s timer; triggers checked once per daemon report-loop tick.
- **Notifications — `UNUserNotificationCenter`**, not a raw Win32-style API — request authorization once at first launch, fire local notifications on the same 0→N/N→0 compliance-violation transition Windows uses (`checkComplianceTransition`) plus the two force-action confirmations. Requires the app to request notification permission, which (like Windows' balloon) is not silently pre-grantable without... see §7 (Notification permission *can* be pre-approved via an MDM profile's `com.apple.notificationsettings` payload, sparing the user a prompt — worth doing given this is an admin-pushed compliance tool, not something a user opted into).

---

## 4. Phase 4 — Custom Device Checks: verify, don't rebuild

**Verified (2026-08-17), no code changes needed.** Already implemented and already backend-ready (`CHECK_PLATFORMS` includes `"macos"`, all 5 checker types have macOS branches, `customchecks_macos.go` implements all of them). Checked directly against the Windows agent's `customchecks_windows.go` and the backend's `customChecks.schemas.ts`:

- **Param field names match the backend's `validateCheckParams` exactly** on both platforms — macOS's `registryOrFileValue` correctly uses `path`/`plistKey` (not Windows' `registryPath`/`valueName`), `serviceStatus` uses the launchd label, `appInstalled` uses a bundle identifier — all per-platform-appropriate, all consistent with what the schema requires and what the frontend's `CustomDeviceChecksPanel.vue` actually sends (confirmed the panel already fully supports macOS: platform toggle, correct field labels/placeholders — "Launchd label", "Bundle identifier", "bash" for the command checker — no gating anywhere).
- **Error-message *semantics* parity confirmed** (error = "couldn't determine," a legitimately negative result like "process not running" is a normal `Value`, never an `Error`) — exact wording necessarily differs between platforms since the underlying primitives differ (WMI/SCM/registry vs pgrep/launchctl/plutil), which is expected and fine; the contract the backend's compliance evaluator depends on is the semantic one, not literal string matching.
- **30s command timeout / 4000-char output cap with `"… (truncated)"` suffix match Windows exactly**, character-for-character in the truncation logic.

This phase really was verification-only, as predicted — no engineering follow-up.

---

## 5. Phase 5 — Event Watches (macOS watch types)

**Shipped (2026-08-17).** Implemented essentially as scoped below, with the design questions this section originally left open now resolved in practice:

- `WATCH_TYPES` widened to `["registryKey", "etwProvider", "fsEventsPath", "launchdJobState"]` and `WATCH_PLATFORMS` to `["windows", "macos"]` (`eventWatches.schemas.ts`), keeping `validateWatchParams(watchType, params)` at its original 2-arg signature (no `platform` argument added) — the disjoint-per-platform watchType-name approach this section already leaned toward, since Windows' `registryKey`/`etwProvider` genuinely have no macOS equivalent value to share.
- The one other backend gate found beyond this doc's own citations: `deviceData.controller.ts`'s agent poll route had a literal `if (platform !== "windows")` 400 check (not mentioned below) — widened to check membership in `WATCH_PLATFORMS` instead of a second hardcoded literal.
- `fsEventsPath` uses `fsnotify` exactly as planned. `launchdJobState` could NOT get a true kernel-level notification the way `registryKey`/`etwProvider` do — there's no CGo-free "notify me when this launchd job's state changes" API — so it polls `launchctl list <label>` every 3s and diffs the (loaded, PID, LastExitStatus) tuple instead. Disclosed as a deliberate trade-off (see the macOS repo's own README "Event Watches" section), not a shortcut taken silently.
- Debounce module ported essentially verbatim from the Windows agent's own inline `debouncer` (that repo has no separate `internal/debounce/` package either, contrary to this section's phrasing below — it's inline in `eventwatch_windows.go`, and the macOS port is inline in `eventwatch_macos.go` the same way).
- Frontend: `EventWatchesPanel.vue` gained a platform toggle (mirroring `CustomDeviceChecksPanel.vue`'s own), platform-scoped watch-type lists/labels, and `fsEventsPath`/`launchdJobState` param fields. The hardcoded `platform: "windows" as const` literal in `save()` is gone.
- New Go dependency: `github.com/fsnotify/fsnotify` — the macOS Agent repo had zero third-party dependencies before this; CI's `build-pkg.yml` now runs `go mod tidy` before building (network access on the `macos-latest` runner generates `go.sum`, which the development sandbox that wrote this code has no way to compute by hand).
- Also backported to macOS in the same round: the Windows agent's own Phase-4 `remoteIntervalSecAtomic`/hot-ticker-reset mechanism (`telemetry_macos.go`) — needed because the event-watches poll response carries a `remoteIntervalSec` override, and macOS had no prior mechanism to apply one without an agent restart.

Original scoping notes, left for reference:

Today `eventWatches.schemas.ts` hardcodes `WATCH_PLATFORMS = ["windows"] as const` with an explicit comment that macOS is "intentionally not offered yet — no macOS agent support exists," and `WATCH_TYPES = ["registryKey", "etwProvider"]` are both Windows-only mechanisms. The poll/notify routes themselves (`GET .../event-watches`, `POST .../event-notify`) are already generic — they just need the allowlists widened:

- **Backend:** add `"macos"` to `WATCH_PLATFORMS`; add macOS-appropriate `watchType` values with `validateWatchParams` branches:
  - `fsEventsPath` — watch a file/directory for changes (the closest macOS analog to Windows' `registryKey` watch — e.g. "alert if `/Library/Preferences/com.apple.something.plist` changes").
  - `launchdJobState` — watch for a launchd job loading/unloading or crash-looping (the closest analog to `etwProvider`'s process-lifecycle watching).
- **Agent:** implement the watcher using **`fsnotify`** (`github.com/fsnotify/fsnotify`) rather than raw `FSEvents`/CoreServices — it's kqueue-based on Darwin, pure Go (no CGo), and avoids the cross-compilation pain the Windows agent hit with `golang-etw` (a real, documented struggle in that repo's history). This keeps the "no local macOS build machine needed, CI (`macos-latest` runner) verifies it" property the Go daemon has enjoyed so far — worth protecting, since unlike Windows, this repo's CI runner actually *can* run the resulting binary for a smoke test if we ever want that.
  - Reuse the debounce module design already built for Windows' registry watcher (config-driven, per-watch debounce interval) rather than inventing a new one.
- **Frontend:** widen the platform filter in the Event Watches admin UI (Settings) to offer macOS once the backend allowlist changes.

---

## 6. Phase 6 — Agent Logs/Trace: verify UI gating only

**Verified (2026-08-17), no code changes needed.** Checked both layers directly:

- **Frontend (`DeviceDetailDrawer.vue`):** the "Agent" tab is unconditionally listed in the tab bar (no platform check) and its content template (`v-else-if="tab === 'agent'"`) has zero platform gating anywhere inside it — the "Fetch Agent Logs & Trace" button renders and works identically for every device regardless of platform. There was no Windows-only guard to remove.
- **Backend (`devices.service.ts`):** `fetchDeviceAgentDiagnostics(authorization, workspaceSlug, deviceId, platform)` takes `platform` as a plain string and passes it straight through `mdmTypeSegment(platform)`, which already maps `"apple" | "macos"` → `"admDevice"` and `"windows"` → `"winDevice"` — the same mapping the rest of this route file (locations, network-status) already uses for macOS. `POST /api/devices/{id}/agent-diagnostics/fetch` calls Applivery's `GET /mdm/agent-logs`/`GET /mdm/agent-trace` with that resolved device type; both are Applivery's own per-device diagnostic feed, platform-blind from this backend's perspective.

Original scoping note, confirmed accurate: Backend is device-`_id`-keyed with no platform branch at all. The only thing worth checking was whether `DeviceDetailDrawer.vue`'s Agent tab conditionally hid the fetch buttons for non-Windows devices — it doesn't, and never did.

---

## 7. Phase 0 — Signing, notarization, PPPC, and what Applivery UEM needs to push

This phase has no engineering-blocking code — it's account/tooling setup and one doc — and per your answers below, **it's explicitly deferred, not first**: you currently only have a free personal-team Apple ID (Xcode's free signing tier — ad-hoc/local signing only, no Developer ID distribution, no notarization capability), and the plan is for Applivery's own developers (who hold the paid Organization Apple Developer account) to take over signing/notarization once this agent's build is ready, not before. That means Phases 1-3 proceed now using free-team/ad-hoc signing for CI builds — fully buildable and testable, just not yet notarized or Gatekeeper-clean for fleet-wide MDM push. This section documents what Applivery's Developer-account team will need to plug in later, so the handoff is a checklist, not a research project for them.

**Build/verification workflow (confirmed):** CI-verified via `macos-latest` (Xcode preinstalled), same pattern as the Go agents — I write Swift source and push, GitHub Actions builds it. You can separately open the repo in Xcode locally whenever you want to see/click through the UI, but CI is the source of truth for "does it compile," matching how this whole project has verified Go code with no local toolchain all session.

**Cert custody (confirmed, for later):** once Applivery's team is ready to hand off a Developer ID Application + Developer ID Installer certificate, it goes into this repo's GitHub Actions secrets as a base64'd `.p12` (+ a passphrase secret, + `APPLE_TEAM_ID`, + a notarization API key or app-specific password) — same pattern as this org's other CI secrets (`SOAR_AGENT_BUILD_SECRET`). CI signs and notarizes unattended on every push to `main`, same shape as `build-pkg.yml`'s existing unattended `.pkg` publish step. Until those secrets exist, `build-pkg.yml`'s new signing/notarization steps should be written to **no-op gracefully** (skip signing, log why, still produce an unsigned artifact for CI/testing) — exactly the existing `SOAR_AGENT_BUILD_SECRET` guard's pattern (`if [ -z "$SECRET" ]; then ... skip ...; fi`) — so this repo's CI doesn't break the moment this section is implemented, only gains capability once the real secret lands.

- **Code signing — Developer ID, not Mac App Store.** This is an MDM-distributed enterprise tool, not something going through App Review — needs a **Developer ID Application** certificate (for the `.app` and any embedded binaries/daemon) and a **Developer ID Installer** certificate (for the `.pkg` itself, which today's `pkgbuild` step doesn't sign at all). Both come from an active Apple Developer Program membership (paid, $99/yr, enrolled as an Organization ideally so the Team ID is stable and not tied to one person's personal account).
- **Notarization** — every Developer-ID-signed binary distributed outside the Mac App Store must be submitted to Apple's notary service (`xcrun notarytool submit`) and the ticket stapled (`xcrun stapler staple`) before Gatekeeper will run it without a manual right-click-Open override. CI already runs on `macos-latest` (Xcode preinstalled) — this is a straightforward addition to `build-pkg.yml`: sign the `.app` → sign the daemon binary → build the `.pkg` → sign the `.pkg` with the Installer cert → notarize → staple. Needs `APPLE_TEAM_ID`, a signing certificate + private key (as a `.p12`, base64'd into a GitHub Actions secret, same pattern as this org's other CI secrets), and an app-specific password or API key for `notarytool`.
- **PPPC (Privacy Preferences Policy Control)** — a profile you deploy via Applivery UEM (or any MDM) that pre-grants TCC permissions so the agent doesn't prompt the logged-in user (who likely can't/shouldn't approve a system-level security tool's permissions themselves). Concretely, PPPC entries need to be authored **after** Phase 0's signing is locked in, because a PPPC "Code Requirement" matches against the actual Developer ID signature — can't be finalized on unsigned/ad-hoc-signed builds. What this agent will likely need, based on what it already does or plans to do:
  - **None of the current checks need Full Disk Access** — `fdesetup`, `socketfilterfw`, `sysadminctl`, `profiles`, `df`, `sysctl`, and scanning `/Applications`/`/System/Applications`/`~/Applications` for `Info.plist` are all either root-exempt or in non-TCC-protected locations. Worth stating plainly in the deployment doc so admins don't over-grant.
  - **The `command` custom-check type is the wildcard** — since it runs arbitrary admin-authored shell commands as root, *some* future check could touch a TCC-protected location (Photos, Mail, Contacts, Desktop/Documents/Downloads under the console user) and get silently denied. Recommend documenting this as "grant Full Disk Access to the agent binary defensively if you plan to author `command` checks that touch user data locations" rather than blanket-granting FDA by default.
  - **Notifications** — `com.apple.notificationsettings` payload, pre-authorizing `UNUserNotificationCenter` alerts for the menu bar app's bundle ID, so the user never sees (and can't dismiss/deny) the permission prompt.
  - Bundle identifiers and Code Requirements for **every** binary that needs a PPPC entry (the daemon, the menu bar `.app`, and its embedded executable) must be finalized once Phase 3's bundle structure is locked — placeholder identifiers below, real ones once code signing is set up: `es.mi-labs.soar.agent` (daemon, existing), `es.mi-labs.soar.tray` (new menu bar app — matching the Windows agent's `Applivery-SOAR-Tray.exe` naming convention translated to a reverse-DNS bundle ID).
- **Gatekeeper note specific to MDM deployment** — a `.pkg` pushed via MDM's own installer daemon typically does **not** carry the `com.apple.quarantine` extended attribute a browser download would (quarantine is set by the *downloading* app, not universally), so Gatekeeper's "verify with Apple" dialog often doesn't even trigger for MDM-pushed packages regardless of signing status. Signing/notarization is still the right thing to do (policy compliance, PPPC code-requirement matching, and it's simply correct practice for any real distribution) — but worth knowing this isn't the single point of failure it might seem, so Phase 0 shouldn't block starting Phase 1-2 work in parallel.

### Decisions confirmed with you

1. **Apple Developer Program status** — only a free personal-team Apple ID today; Applivery's own developers hold the paid Organization account and will take over signing/notarization once the build is ready, not before. Phase 0's signing/notarization steps are deferred; engineering (Phases 1-3) is not blocked by this.
2. **Certificate custody** — GitHub Actions secrets, once Applivery's team provides them (see §7 above for the exact secret shape and the no-op-until-configured guard).
3. **Build/verification workflow** — CI-verified via `macos-latest`, matching the Go agents. You may also build/run locally in Xcode for visual iteration, but CI compiling is the actual pass/fail signal, same as every Go round this session.

---

## 8. Suggested build order

Numbered by narrative logic above, suggested *execution* order balances "ship something visibly better soon" against dependencies:

1. **Phase 0** (deferred — Applivery's Developer-account team handles signing/notarization once a build is ready; doesn't block starting engineering, see §7)
2. **Phase 1** (mTLS) — closes the real security gap (shared secret → per-device cert), same as Windows' own priority order this session.
3. **Phase 2** (supervision) — small, mostly free via launchd, do it right after the LaunchAgent exists in Phase 3 anyway.
4. **Phase 3** (SwiftUI menu bar app) — the visible, user-facing win; needs Phase 0's signing to actually be *deployable* to a fleet, but can be built/tested locally (self-signed / ad-hoc) before that's finished.
5. **Phase 5** (Event Watches) — after the above, since it's the most net-new backend+agent work.
6. **Phase 4 and 6** — verification passes, can happen anytime, cheap.
7. **Deployment doc** (PPPC + Gatekeeper + Applivery UEM push instructions, `docs/apps.md`/`docs/settings.md`-equivalent for macOS) — written incrementally as each phase lands, finalized once Phase 0 and Phase 3 are both real.

---

## 9. Backend research appendix (source of truth for §0's claims)

Full file:line detail from the research pass, for anyone implementing a phase above and wanting to jump straight to the relevant backend code:

- **mTLS platform-agnostic:** `prisma/schema.prisma:1140-1170` (`CertificateAuthority`/`DeviceCertificate`, no platform column), `mtls.schemas.ts:41-49`, `deviceMtls.service.ts:105,125-174`, `mtlsEnforcement.service.ts:22-55`, `deviceMtls.controller.ts:33-51`.
- **Force-evaluate is agent-pull, not server-push:** `deviceData.controller.ts:79-86`, `compliance.service.ts:811,824-839`.
- **Event Watches gated to Windows:** `prisma/schema.prisma:790`, `eventWatches.schemas.ts:18,21-23,33,84-122`, `deviceData.service.ts:328`.
- **Custom Checks already cross-platform:** `customChecks.schemas.ts:12-16,52-85`, `deviceData.controller.ts:45-57`.
- **`installLocation` untyped-by-platform:** `installedApps.service.ts:43-46`, `deviceData.schemas.ts:122`, `vulnService.ts:543,567,591`. Adjacent gap: `origin?: "winget"|"msi"|"store"` (`installedApps.service.ts:42,447`) would need widening for macOS-specific origins (`homebrew`, `appstore`, `reported`) once Phase 4's app-inventory work wants to distinguish them.
- **Compliance conditions already shared:** `complianceFields.ts:251-296,373-388,597-606,641-656`; alias tables `deviceData.schemas.ts:13-51` (`WINDOWS_ATTR_ALIASES`/`MACOS_ATTR_ALIASES`). The one real Windows-only condition is TPM/Secure Boot (`complianceFields.ts:300,393,637`) — correctly scoped, not a naming leak.
- **`macos` as first-class platform value generally:** `agentDownloads.service.ts:28-31,37,154-167` (both repos proxied symmetrically).
- **Device Data Webhook panel gap (frontend only):** `DeviceDataWebhookPanel.vue:6-7,61,454-456`.
- **Agent Logs/Trace is device-generic:** `devices.service.ts:544-668` (`fetchDeviceAgentDiagnostics`/`getStoredAgentDiagnostics`), keyed by Applivery device `_id`, no platform branch.

Windows-side architecture referenced throughout this doc, for anyone porting logic 1:1: `internal/svcwatch/svcwatch.go:1-68`, `internal/svcwatch/tray.go:104-141`, `watchdog/main.go:4-71`, `internal/agentstatus/agentstatus.go:89-134`, `status_windows.go:23-38`, `telemetry_windows.go:170-179`, `tray/main.go:93-94,354-425`, `agent.wxs:6-58,106-133`, `mtls_windows.go` (keystore §5's file paths, `ensureMtlsIdentity`/`withinRenewalWindow:180-194`, `mtlsHTTPClient:93-112`, `restrictKeystoreACL:442-448`).
