# Event-Driven Change Detection for SOAR Agents — Roadmap

**Status:** Phases 0–2 implemented (2026-08-15) — Windows Agent config-driven registry watcher is live: `EventWatchDefinition` admin CRUD, `GET /api/device-data/event-watches`, `POST /api/device-data/event-notify`, and the agent-side watcher/debounce module (`Applivery SOAR - Windows Agent/eventwatch_windows.go`). Phase 1's hardcoded-watcher step was deliberately skipped in favor of going straight to Phase 2, per direction — no throwaway code. Phase 3 (ETW) and Phase 5/6 (macOS) remain future work.

**Goal:** replace (for the signals that matter most) the SOAR Agent's fixed-interval polling model with OS-native event notification, so a real change on a device — an app installed, a registry key touched, a process launched — reaches SOAR within seconds instead of waiting for the next scheduled report cycle (`config.IntervalSec`, default 3600s / 1h, `Applivery SOAR - Windows Agent/registry_windows.go:43`). Windows first, per the user's request; macOS is scoped as a later phase using the equivalent native APIs.

**Verdict: feasible, and worth doing, in stages.** Everything proposed below is built on real, documented Win32 primitives already reachable from Go with the dependencies this agent already has (`golang.org/x/sys/windows`) or one small, well-established additional Go module. Nothing here requires a driver, admin consent beyond what the agent already runs as (LocalSystem), or a rewrite of the existing report cycle — it's additive.

---

## 1. Why this is feasible (findings)

### 1.1 Registry change notification — `RegNotifyChangeKeyValue`

Confirmed against Microsoft's own reference (`learn.microsoft.com/windows/win32/api/winreg/nf-winreg-regnotifychangekeyvalue`):

- Exported by `advapi32.dll`. Takes an open key handle (`KEY_NOTIFY` access), a subtree flag, a filter mask (`REG_NOTIFY_CHANGE_NAME | REG_NOTIFY_CHANGE_LAST_SET` is what we want — subkey add/delete plus value changes), and can run asynchronously by signaling a Win32 event handle rather than blocking the calling thread.
- **Key detail that simplifies the Go implementation:** `REG_NOTIFY_THREAD_AGNOSTIC` (`0x10000000`, Windows 8+) decouples the notification's lifetime from the calling thread. Without it, the call must run on a *persistent* OS thread (a goroutine pinned via `runtime.LockOSThread()`, since Go's scheduler otherwise freely reschedules goroutines onto different OS threads, which would silently fire the notification early). With it, an ordinary goroutine works and there's nothing extra to reason about. Windows 8 is far below this fleet's floor, so this flag should always be set.
- This is exactly the "better approach for app installations" the enhancement request already named — watching `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall` (plus `WOW6432Node` and `HKCU`, the same three paths `getAppsViaRegistry` already reads in `apps_windows.go:172-174`) turns "did anything get installed" from a 1-hour-stale poll into a sub-second signal, with zero new Win32 surface beyond what `golang.org/x/sys/windows/registry` (already imported, `apps_windows.go:17`) exposes for opening the key — `RegNotifyChangeKeyValue` itself isn't wrapped by that package and needs a ~15-line manual `syscall.NewLazyDLL("advapi32.dll")` binding, the same pattern this repo already uses for PowerShell/`exec.Command` calls elsewhere in `apps_windows.go`.
- Explicitly **not** using `Win32_Product` WMI eviction events, per the user's own correct instinct — `Win32_Product` is documented to trigger an MSI consistency/repair scan on every enumeration, a well-known operational hazard, and it's already avoided in this codebase's synchronous app-scan path.

### 1.2 Event Tracing for Windows (ETW)

Confirmed against Microsoft's ETW reference (`learn.microsoft.com/windows/win32/etw/*`): the consumer side is `OpenTrace` → `ProcessTrace` (blocks the calling thread, delivers events to a callback in real time) → `CloseTrace`, against a real-time session created with `StartTrace`/`EnableTraceEx2` and a target provider GUID (e.g. `Microsoft-Windows-Kernel-Process`, `{22FB2CD6-0E7B-422B-A0C7-2FAD1FD0E716}`, for process start/stop).

- None of this is wrapped by `golang.org/x/sys/windows` — it's raw `evntrace.h`/`tdh.h` COM-adjacent Win32, normally consumed from C++. Hand-rolling it in Go is possible but substantial (manual `EVENT_RECORD` struct marshaling, TDH property decoding). The realistic path is `github.com/0xrawsec/golang-etw`, a pure-Go (no cgo) real-time ETW consumer built for exactly this use case (it's the ETW layer behind that author's own Go-based EDR tooling) — it wraps session creation, provider enabling, and `EVENT_RECORD` decoding into a Go-idiomatic callback API. This would be this agent's first non-`golang.org/x/sys` / non-WMI dependency, so it's called out explicitly as a decision point in Phase 3 below rather than assumed.
- Kernel providers require the consuming process to run as Administrator/LocalSystem — already true for this agent (Windows Service, same reason `getAppsViaAppx`'s `Get-AppxPackage -AllUsers` already works under LocalSystem — see `apps_windows.go`'s own doc comment on that function). Multiple concurrent named kernel-logger sessions have been supported since Windows 10 1809 (this fleet's floor is comfortably above that), so this shouldn't collide with an existing EDR/AV product's own kernel ETW session on the same box — worth a real coexistence test on a machine running Defender/CrowdStrike/etc. before shipping, not just assumed.

### 1.3 Debounce semantics (as specified)

The reset-on-activity, fire-after-N-seconds-of-quiet pattern described in the request is a standard debounce, not a rate limiter — trivial to implement as a small generic Go type (one `time.Timer`, reset on every raw event, evaluated once the timer actually fires) with no new dependency. Keyed per "watch id" (see §3.2) so that, e.g., a burst of registry-Uninstall-key events and a burst of ETW process-start events don't debounce against each other's timers.

### 1.4 Config delivery — mirror the existing Custom Device Checks pattern

The request explicitly wants a way to change *which* things are watched from SOAR, without a bespoke script — this already has a working precedent in this exact codebase:

- `CustomCheckDefinition` (`backend/prisma/schema.prisma:673-690`) — a `workspaceSlug` + `platform`-scoped Prisma model, admin-authored in Settings, served to the agent read-only.
- `GET /api/device-data/custom-checks?platform=windows` (`deviceData.controller.ts:44-56`), authenticated by the same `X-Workspace-Slug` / `X-Device-Report-Secret` header pair every other agent-facing endpoint uses (`verifyDeviceReportSecret`, `deviceData.service.ts:41`) — no dashboard JWT, since the caller is an unattended device script/service, not a logged-in admin.
- Agent side, `fetchCustomChecks` (`customchecks_windows.go:50-82`) — a plain GET each cycle, dispatched by a `checkerType` string.

Section 3.1 below proposes a new `EventWatchDefinition` model and `GET /api/device-data/event-watches?platform=windows` route, same shape, same auth, same polling-for-config pattern — genuinely no new plumbing class, just a new table and a fourth thing the agent's existing cycle fetches alongside custom checks.

### 1.5 Precedent for agent-initiated, out-of-cycle calls to SOAR

`POST /api/device-data/evaluate-now` already exists and is called by the agent itself outside its normal report cycle — `forceEvaluateCompliance` (`status_windows.go:103-159`), triggered today by the tray's "Force evaluate" button, hits `compliance.service.ts`'s `forceEvaluateNow` (line 824), which already has a **per-workspace cooldown** (line 803) specifically to stop a burst of force-triggers from hammering the compliance evaluator. This is the right shape and the right existing safety net to extend for the new "something changed, act now" webhook in §3.3 — not a new pattern, an extension of one that's already in production.

---

## 2. Design principle: additive, not a replacement

Event-driven detection is a **fast lane** on top of the existing poll cycle, never a full replacement for it, for three concrete reasons:

1. **Missed-event window.** An agent that's offline, mid-update, or was just installed has no event history to replay — it needs a full baseline scan regardless. The existing report cycle already does this.
2. **Buffer loss.** ETW real-time sessions can drop events under sustained high load (documented, not hypothetical — buffer/event-loss counters are a normal part of `QueryTrace` session statistics). Registry notifications are more reliable but still depend on the watcher thread staying alive.
3. **Blast-radius containment.** If the event pipeline itself misbehaves (a bad SOAR-pushed watch config, a debounce bug, a provider that fires constantly), the slow-lane poll is the fallback that keeps device state eventually-correct no matter what the fast lane does.

Concretely: the existing `IntervalSec` full-cycle poll stays, and can likely be *relaxed* (e.g. default 1h → 4h) once the fast lane is proven in production for a given signal, rather than removed. This is a deliberate rollout lever, not a target for Phase 1.

---

## 3. Technical design

### 3.1 Config delivery: `EventWatchDefinition`

New Prisma model (needs a hand-authored SQL migration — this sandbox has no network route to `binaries.prisma.sh`, so `prisma migrate dev` can't run here; the migration will need to be authored by hand or run from a machine with Prisma network access, then verified in CI, same workaround already established for other schema changes this session):

```prisma
model EventWatchDefinition {
  id            String   @id @default(uuid())
  workspaceSlug String
  platform      String   // "windows" | "macos" (macos unused until Phase 6)
  key           String   // admin-facing label, unique per workspace+platform
  watchType     String   // "registryKey" | "etwProvider" (windows); "fsevents" (macos, later)
  // registryKey: { hive: "HKLM"|"HKCU", path: string, watchSubtree: bool }
  // etwProvider: { providerGuid: string, keywords?: string, opcode?: string }
  params        Json
  debounceMs    Int      @default(5000)
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([workspaceSlug, platform, key])
}
```

`GET /api/device-data/event-watches?platform=windows` — same controller module, same `verifyDeviceReportSecret` auth, same `{key, watchType, params, debounceMs}` shape `listEnabledChecksForAgent` already returns for custom checks. A Settings admin UI tab (mirroring the existing Custom Device Checks tab) lets an admin add/edit/disable watches without touching agent code or shipping a new build for every new thing worth watching — directly answering "we need an efficient method to deliver this to agent... a script to deliver this would be too complex."

Two built-in, always-on watches ship as Phase 1's hardcoded default (not admin-configurable yet) before this config layer exists at all — see Phase 1.

### 3.2 Agent-side: the watcher + debounce module

New package/file, e.g. `eventwatch_windows.go`, reusing `sendWebhook`'s existing HTTP/retry/auth plumbing (`telemetry_windows.go:233-269`) rather than building new transport:

- **Registry watchers**: one goroutine per watched key, looping on `RegOpenKeyEx` → `RegNotifyChangeKeyValue(..., REG_NOTIFY_THREAD_AGNOSTIC|REG_NOTIFY_CHANGE_NAME|REG_NOTIFY_CHANGE_LAST_SET, hEvent, TRUE)` → `WaitForSingleObject(hEvent)` → on signal, feed the debouncer, loop (the API delivers one notification per call and must be re-armed — this loop *is* the re-arm).
- **ETW watchers** (Phase 3): one real-time session (`golang-etw` or hand-rolled), provider(s) enabled per `EventWatchDefinition` rows of `watchType: "etwProvider"`, callback feeds the debouncer keyed by provider+event-type.
- **Debouncer**: `map[watchID]*time.Timer`. Raw event in → `Reset(debounceMs)` (create if absent). Timer fires → remove from map, call `onQuiet(watchID)`.
- **`onQuiet` handler**: POSTs to the new SOAR endpoint (§3.3) with `{watchId, watchType, deviceLocalTimestamp}` — deliberately *not* re-gathering and attaching a full state snapshot itself (that's SOAR's job, symmetric with how `forceEvaluateCompliance` today just triggers, it doesn't push a payload of everything that might have changed).

Config refresh: fetched once per existing report cycle (like `fetchCustomChecks` today), diffed against currently-running watchers — start new ones, stop removed/disabled ones, restart ones whose `params`/`debounceMs` changed. No separate poll loop needed; this rides the cycle that already exists.

### 3.3 New backend webhook: "something changed, act now"

`POST /api/device-data/event-notify` — same public-allowlist / device-secret auth as `report`, `report-apps`, `evaluate-now` (`authRequired.test.ts:23-27`). Body: `{serialNumber, watchType, watchKey, clientTimestamp}`.

Backend reaction (`deviceData.service.ts`, new function), gated by **two** layers of the cooldown pattern `forceEvaluateNow` already established, not just one:

1. **Per-device cooldown** (new — needed because a single noisy device, e.g. mid-Windows-Update, could still fire once every `debounceMs` for minutes) — e.g. skip if this device notified within the last N seconds, matching the debounce window's own order of magnitude.
2. **Per-workspace cooldown** (reuse `forceEvaluateNow`'s existing one, `compliance.service.ts:803`) — protects SOAR itself from a fleet-wide event storm (e.g. a patch gets pushed to 500 devices at once).

Action taken depends on `watchType`: a registry-Uninstall-key watch triggers the same targeted installed-apps refresh path `manualRefreshInstalledApps` already provides (installedApps.service.ts) for just that one device, out of the normal budgeted refresher cycle (`installedAppsJobs.ts`); a compliance-relevant watch calls `forceEvaluateNow` for just that device. This routing table is intentionally data-driven off `watchType`/`watchKey`, not hardcoded per-watch, so Phase 2's admin-configurable watches don't each need a backend code change to be useful.

---

## 4. Phased plan

| Phase | Scope | New deps | Depends on |
|---|---|---|---|
| **0** | Backend: `EventWatchDefinition` model + migration, `GET /api/device-data/event-watches` route, `POST /api/device-data/event-notify` route + per-device/per-workspace cooldown, Settings admin UI tab (clone of Custom Device Checks tab) | none (Prisma migration only) | — |
| **1** | Windows Agent: hardcoded registry watcher for the 3 Uninstall-key paths only (`HKLM`, `HKLM\WOW6432Node`, `HKCU`), generic debounce module, wired to `POST /event-notify` → targeted app-inventory refresh. No admin config yet — proves the mechanism end to end on the highest-value signal first. | none (manual `advapi32.dll` binding via existing `syscall` usage) | Phase 0's `/event-notify` route |
| **2** | Windows Agent: generalize Phase 1's hardcoded watcher into one driven by `GET /event-watches` (any admin-specified registry key, not just Uninstall) + per-watch debounce window from config | none | Phase 0's `/event-watches` route, Phase 1's watcher/debounce code |
| **3** | Windows Agent: ETW watcher for `Microsoft-Windows-Kernel-Process` (process start/stop) as the first provider, config-driven via the same `EventWatchDefinition` (`watchType: "etwProvider"`) | `github.com/0xrawsec/golang-etw` (or equivalent — evaluate at implementation time) | Phase 2's config plumbing |
| **4** | Rollout controls: per-workspace feature flag (event-driven mode on/off), metrics (webhook volume, debounce-collapse ratio, event-to-SOAR-reaction latency), and the `IntervalSec` relaxation lever from §2 | none | Phases 1–3 in production |
| **5** | macOS Agent equivalent: FSEvents for `/Applications` (direct analog of the registry watcher — likely via `fsnotify`'s existing macOS FSEvents backend rather than hand-rolled CoreServices bindings) as the first signal; process-exec-level monitoring via Apple's EndpointSecurity framework as a stretch goal, flagged separately since ES requires an Apple-granted entitlement this org may not currently hold — a decision point to raise with the user before scoping it further, not an assumption to build on top of. | `fsnotify` (macOS FSEvents backend) | Phase 0's backend (platform-agnostic already) |

Phases 0–2 are the concrete, low-risk, high-value slice that directly answers the request's own headline example (installs/uninstalls detected in seconds via the registry, debounced, config delivered from SOAR without a bespoke script) — recommended as the actual next unit of work, with Phase 3 (ETW) and Phase 5 (macOS) sequenced after that's proven live.

---

## 5. Open questions for the user before implementation starts

1. **Start scope** — build Phase 0 + Phase 1 now (registry-only, hardcoded, fastest path to a working demo), or go straight to Phase 0 + Phase 2 (registry, but config-driven from day one)? Phase 1 is faster to ship and de-risks the Go/Win32 plumbing before the config-delivery UI is also new; Phase 2 avoids a throwaway hardcoded version.
2. **ETW dependency** — comfortable adding `github.com/0xrawsec/golang-etw` (third-party, MIT-licensed, no cgo) as this agent's first non-Microsoft/non-WMI Go dependency, or is a hand-rolled `evntrace.h` binding (no third-party dependency, meaningfully more implementation effort) preferred for this codebase's dependency posture?
3. **EndpointSecurity entitlement (macOS, Phase 5 only)** — does this org already hold an Apple-granted `com.apple.developer.endpoint-security.client` entitlement? If not, that's a business/legal lead time item (Apple's approval process, not engineering effort) worth starting in parallel long before Phase 5's engineering work begins, if deep process-level monitoring on macOS is actually wanted — FSEvents alone (no entitlement needed) covers the Application-folder-changes case from the original request either way.
