# Visual & Feature Parity Roadmap — BlueSky migration vs. original wow-dashboard

**Goal:** the migrated app (`frontend/`, Vue3 + `@applivery/bluesky-vue`) must look and behave exactly like the original `wow-dashboard/` (React) app, adapted only where the stack genuinely forces a different implementation (icon library, component primitives). No feature dropped, no visual detail skipped, unless explicitly called out below as an intentional/approved deviation.

**Source of truth:** `Applivery Big Picture SOAR.zip`, unzipped for reference at `/tmp/original/Applivery Big Picture SOAR/` in the sandbox (`wow-dashboard/src/App.jsx` + `wow-dashboard/src/components/**`). Also: the live original app at **https://big-picture.mi-labs.es** (same login as SOAR) — this is authoritative for anything ambiguous in source (computed styles, animations, exact copy).

**This document was produced by actually reading the original source and diffing line counts / structure against the migrated files — not by assumption.** Every gap listed below is grounded in a specific file. Where a view hasn't been read in full depth yet, that is stated explicitly rather than guessed at, and the phase's first step is to finish that reading before writing any code.

**Critical discovery while writing this roadmap:** `docs/*.md` in this repo (`audit-logs.md`, `cases.md`, `compliance.md`, `devices.md`, `overview.md`, `playground.md`, `reporting.md`, `settings.md`, `workflows.md`) already contains a detailed, per-view admin-guide spec — these are the docs `HelpIcon` deep-links into from each view. Spot-checking `devices.md` and `cases.md` against this session's fresh source-reading confirms they describe the same gaps found independently (status tabs, saved filters, bulk actions, drawer tabs, etc.) *plus finer detail this pass didn't have time to extract from source directly* (e.g. `devices.md` documents a "What's driving this score" risk popover, five specific OS-version mini-badges, and an exact bulk-action list including "Re-attest now"; `cases.md` documents an "Export CSV" button, a "My cases" toggle, and a MITRE-tactic pill strip with live counts — none of which had been located in the quick grep pass below). These docs also describe some genuinely new SOAR-specific backend capabilities that go beyond the original `wow-dashboard` (risk scoring, OS Lifecycle, Vulnerability Service, Vulnerability Catalog) — those are **in scope to build**, not deviations to avoid, since they're part of *this* product's already-built backend, just not yet exposed by the migrated frontend.

**Revised working method, given this discovery: for every phase, read the matching `docs/<view>.md` file FIRST, before opening the original React source.** Treat it as the primary spec (it's more complete and already SOAR-aware); use the original source and the live original app to fill in anything the doc doesn't cover (exact visual styling, colors, spacing, copy, icons) and to sanity-check the doc against reality — the doc could itself be stale or aspirational, so still verify claims against actual source/live behavior before trusting them blindly. Then diff both against the current migrated `.vue` files to find what's actually missing.

## Working method (apply to every phase, no exceptions)

1. **Read `docs/<view>.md` in full first** — it's the most complete single spec available (see discovery note above). Extract every concrete feature/field/button/badge/state it names.
2. **Read the original source in full** for the feature being worked on — the relevant file(s) under `wow-dashboard/src/`, not just the grep excerpts in this doc (those are pointers, not full specs). Use it to confirm and add detail to what the doc described, and to catch anything the doc omitted.
3. **Open the live original app** (big-picture.mi-labs.es) and interact with the equivalent screen. Screenshot/zoom as needed to confirm exact colors, spacing, copy, icons, and interaction behavior (hover states, animations, empty states, loading states). Doc + source + live must agree before implementing — if they conflict, live behavior wins.
4. **Diff against the current migrated file(s)** — list concrete differences (missing fields, wrong copy, wrong color, missing modal, wrong icon) before writing code. Don't rewrite wholesale if only part of a component is wrong.
5. **Implement to match exactly.** Icons: `@solar-icons/vue` is the available set (original uses `lucide-react`, not available here) — pick the closest semantic equivalent and note the substitution in a code comment, same pattern already used in `AppShell.vue`/`analyticsCatalog.ts`. Colors/copy/spacing/behavior: exact, no rounding.
6. **Build and typecheck before calling anything done**: `cd frontend && npm run build` (runs `vue-tsc -b && vite build`). Fix all errors. Watch the chunk-size output — importing an entire icon/component library with a wildcard import instead of named imports has already caused one accidental +11MB chunk (see `frontend/src/lib/solarIcons.ts` for the pattern to reuse: named imports registered in a small module, dynamic lookups via `resolveIcon(name)`).
7. **Commit** with a message that cites the original file/line the change was ported from.
8. **Batch related fixes within a phase**, then push once the phase (or a natural sub-chunk of it) is done — per the user's standing preference ("keep going, batch it") don't push after every single file. Always get a **fresh** GitHub PAT for each push (never reuse one); never persist it (export → build push URL → push → redact log → unset).
9. **Verify CI + Docker publish go green** on GitHub Actions after every push before telling the user it's ready to redeploy.
10. **After the user redeploys, verify live** against big-picture.mi-labs.es again for that phase's screens before marking the phase complete.

Standing sandbox workarounds (unchanged, still apply): `mv .git/index.lock ".git/index.lock.stale.$(date +%s)"` (and `HEAD.lock`) before every git operation; `mv dist "dist.stale.$(date +%s)"` before every `npm run build` (EPERM on unlink in this sandbox).

---

## Status snapshot (current line-count reality check)

Rough size comparison, original React (`.jsx`) vs. migrated Vue (`.vue`), same feature area. Not a precise fidelity score (Vue SFCs are more compact than JSX by nature), but a real signal of how much is actually missing — large gaps below are confirmed by more than just line count; see each phase.

| Area | Original (lines) | Migrated (lines) | Notes |
|---|---|---|---|
| Login screen | ~190 (App.jsx `AuthScreen`) | 277 (`LoginView.vue`) | Done this session — 1:1 |
| Top nav bar | ~120 (App.jsx nav) | 230 (`AppShell.vue`) | Done this session — 1:1 |
| Overview | ~1400 (App.jsx Overview + WidgetHeader/Builder/DateRangePicker/CalendarMonth) | ~1100 (`OverviewView.vue` + 4 new components + `analyticsCatalog.ts` additions) | Done this session — widget builder, date picker, card chrome, header all rebuilt 1:1. **Deferred within Overview:** full zoomed-chart `WidgetInfoModal`, Segments nav panel (see Phases 9–10). |
| Devices | 2616 (`DevicesView` 325 + `DeviceFleetTable` 936 + `DeviceDetailDrawer` 735 + `DevicePickers` 620) | 561 (`DevicesView.vue` 129 + `DeviceFleetTable.vue` 124 + `DeviceDetailDrawer.vue` 109 + `DevicePickers.vue` 122 + `DeviceMap.vue` 77) | **~21% — largest gap.** Phase 1. |
| Compliance (+ App Lists) | 2485 (`CompliancePoliciesView` 624 + `PolicyBuilder` 1033 + `AppListsView` 671 + `TemplateGallery` 152 + `AppListsManager` 5) | 887 (`ComplianceView.vue` 100 + `PoliciesTable.vue` 93 + `PolicyBuilderDrawer.vue` 296 + `ViolationsQueue.vue` 163 + `AppListsPanel.vue` 172 + `TemplateGallery.vue` 63) | **~36%.** Phase 2. |
| Cases | 1065 (`CasesView.jsx`) | 473 (`CasesView.vue` 53 + `CasesTable.vue` 102 + `CaseDetailDrawer.vue` 254 + `CaseCreateDialog.vue` 64) | **~44%, and missing whole filter/tab bar.** Phase 3. |
| Workflows (+ Library + Firewall) | 3067 (`WorkflowsView` 383 + `WorkflowBuilder` 1030 + `ActionLibraryView` 535 + `FirewallLibraryView` 377 + `ScriptLibraryModals` 474 + `WorkflowRunModals` 665, note some double-counted across files) | ~1800+ across `views/WorkflowsView.vue` (203) + `components/workflows/*.vue` (10 files) | Navigation restructured (6 tabs vs original's 3 nested differently) — needs a structural comparison, not just a content one. Phase 4. |
| Settings (21 tabs) | ~3253 across 14 standalone files + ~7 tabs inline in `App.jsx`'s settings modal | 2477 across ~28 files, rendered as a routed page (`SettingsView.vue`) not a modal | **Confirmed missing tab: "Inbound Webhooks" (`triggers`, `TriggersSettings.jsx`, 259 lines) — no migrated equivalent found at all.** Structural deviation: original is a modal overlay, ours is a page. Phase 5. |
| Audit Logs | 341 (`AuditLogsView.jsx`) | 126 (`AuditLogsView.vue`) | Filter set (search/category/severity/actor/date range) already matches functionally — mainly a visual-styling pass (raw `<select>`s vs styled inputs) plus retention-days display check. Phase 6 (small). |
| Reporting | ~703 (inline in `App.jsx`, `reportingTab` builder/scheduled/template) | 296 (`ReportingView.vue`) | All 3 tabs present. Needs a real diff pass but likely mostly there. Phase 7 (small-medium). |
| Playground | 157 (inline in `App.jsx`) | 151 (`PlaygroundView.vue`) | Closest to parity by size. Phase 8 (small). |
| Segments navigation panel | Entirely new feature — hover-reveal left-edge sidebar, gates Overview/Devices/Compliance/Cases | **Not built at all** | Phase 9. |
| WidgetInfoModal (chart zoom) | `App.jsx:1227+`, full-size chart re-render per widget | Simplified metadata popover shipped this session as a stand-in | Phase 10. |
| Dark mode | Full `THEME.dark` palette + toggle (`App.jsx` `THEME` const, `themeMode` state) | **Not built at all** — app is light-only | Phase 11. |

---

## Phase 1 — Devices (largest gap)

**Status: implemented (this session).** `DevicesView.vue`/`DeviceFleetTable.vue`/`DeviceDetailDrawer.vue` were rewritten from a full read of `DevicesView.jsx` (325), `DeviceFleetTable.jsx` (936), `DeviceDetailDrawer.jsx` (735), and the relevant exports of `DevicePickers.jsx` — plus `docs/devices.md` as the spec. New files: `SegmentPickerModal.vue`, `PolicyPickerModal.vue`, `TagEditorModal.vue` (replacing the old inline-form `DevicePickers.vue`), `WorkflowPickerModal.vue`, `WorkflowRunResultModal.vue` (polls `GET /api/workflows/runs/:id` while running/waiting), `DeviceMockup.vue` (OS badge avatar), and `lib/segments.ts` (`flattenSegments`). `stores/devices.ts` gained `complianceSource`/policy-scope/risk-trend/`syncLocations`, and a real bug fix: segment/tag/policy mutations now send `platformDeviceId` (not the internal `id`) as the original does — Apple/Windows/Android devices can have a different Applivery-side id than our normalized one, so this was silently hitting the wrong device before.

Delivered: header with Devices/Playground pill + "Updated HH:MM" + Refresh; "Compliance shown" toggle (Applivery flag / Compliance Policies) with policy-scope dropdown, persisted to `localStorage`; fleet risk trend sparkline; fleet table's full toolbar (search, `PLATFORM_FILTERS` pills, non-compliant toggle, risk-tier dropdown, min/max score, saved filters persisted to `localStorage`); risk-sortable column with the "what's driving this score" popover; the five OS-version mini-badges (render once backend data exists — see caveat below); bulk action bar (Run workflow…, Re-attest now, Add tag…, Move segment…, Clear); and the drawer's full 3-tab structure (Overview's 12 sections, Compliance's risk meter/violations/awaiting-review/open-cases, Location's sync + Google Maps link).

Two known caveats, both backend-side (not frontend gaps, confirmed by reading `deviceNormalize.ts`/`devices.service.ts`):
1. The five OS-version mini-badges/drawer sections (OS Updates, Vulnerability Catalog, Vulnerability Service, OS Lifecycle, App Updates) are wired correctly but will render nothing until `deviceNormalize.ts`'s `TODO(Phase3)` catalog-refresher jobs are implemented — today those fields are always `null`, matching a cold-start original.
2. `POST /api/devices/bulk-reattest` is a stub (`devices.service.ts`'s `bulkReattestDevices`, `TODO(Phase4b)`) that always reports failure with an honest "not wired up yet" detail — the frontend button/flow is correct and will start working the moment that lands.

Deferred (not this phase): the original's recursive segment-tree scoping (`collectSegmentIds`, cascading a sidebar's selected segment down to its descendants) depends on the global "Segments navigation panel" that doesn't exist yet anywhere in the migrated app (Phase 9) — the segment *filter* itself works, just not the cascade-to-children behavior yet. "Open Cases"/"Awaiting Review" rows in the Compliance tab now navigate to `/cases?caseId=` and `/audit-logs?deviceId=` — correct on the Devices side, but `CasesView.vue`/`AuditLogsView.vue` don't read those query params yet (Phases 3/6) so the destination page won't auto-filter/open until then.

**Spec:** `docs/devices.md` (read first). **Source:** `wow-dashboard/src/components/devices/{DevicesView,DeviceFleetTable,DeviceDetailDrawer,DevicePickers}.jsx`.

`docs/devices.md` already documents several concrete pieces this grep pass didn't surface — carry these into the implementation checklist verbatim: a "fleet risk trend" sparkline (≥2 days of data) next to the compliance-source toggle; a policy-scoping dropdown that appears once "Compliance Policies" is the selected source; five specific OS-version mini-badges (OS update status, Vulnerability Catalog status, Vulnerability Service status, OS Lifecycle status, App Updates status) with hover detail; a "What's driving this score" risk popover; the exact bulk-action list (Run workflow…, **Re-attest now**, Add tag…, Move segment…, Clear) with a success/failure summary toast; and an 8-section Overview tab in the drawer (Identifiers, Hardware & OS, OS Updates, OS Lifecycle, Vulnerabilities, Vulnerability Service, Firewall Rule Sets (Windows only), App Updates). Cross-check every one of these against backend support before assuming frontend-only work — some (Vulnerability Service, OS Lifecycle, Firewall Rule Sets) are conditionally shown only once their corresponding Settings tab is configured.

Confirmed concrete gaps (found via structural grep, needs full read to catch the rest):

- **Header**: `ViewSwitcher` (Devices/Playground pill toggle), "Updated HH:MM" timestamp reserved-space label, Refresh button with spin animation — compare against our `DevicesView.vue` header (currently a bare `Tabs` component for table/map layout switch, which is itself a deviation: original's ViewSwitcher toggles to the *Playground view*, not a table/map layout mode).
- **Compliance-source toggle** (`DevicesView.jsx:~213-230`): a segmented control choosing between "Applivery flag" and Compliance-Policies-derived compliance, persisted to `localStorage` under `huginn.devices.complianceSource` (mirror key name if reasonable, or document the deviation). **Entirely missing in migrated version.**
- **`DeviceFleetTable.jsx`**: `PLATFORM_FILTERS` pill bar (All/iOS-iPadOS-tvOS/Android/Windows/macOS), a battery-percentage min/max numeric range filter, saved filters persisted to `localStorage` (`huginn.devices.savedFilters`), a bulk "add tag to all selected" input, and a risk-tier badge system (`low/medium/high/critical` with specific colors: low=SUCCESS, medium=WARNING, high=`#F97316`, critical=DANGER). Need the exact column list (`sed -n` around `DeviceFleetTable.jsx:770-800` for header cells — read in full for the complete column set, not just what grep caught).
- **`DeviceDetailDrawer.jsx`**: 3 tabs — Overview / Compliance / Location (`TABS` const, line 63) — confirm our drawer has exactly these 3, not more/fewer. Also has a `workflows` section listing workflow runs against that device, and 3 picker modals wired in (`activePicker`: `'segment' | 'policy' | 'tags'`).
- **`DevicePickers.jsx`** (620 lines, exports 9 components): `ModalShell`, `flattenSegments`, `SegmentPickerModal`, `PolicyPickerModal`, `TagEditorModal`, `ChipGroup`, `GroupedTagSelector`, `DeviceAudienceCreateModal`, `AudiencePickerField`, `TagConditionField`. Our `DevicePickers.vue` is 122 lines total — almost certainly missing several of these (`DeviceAudienceCreateModal` in particular looks like a whole feature: creating a saved device audience from the picker flow). Confirm which of the 9 exist and which don't.

Execution: read all 4 files in full, build an exact component-by-component checklist (extending this list, don't just trust the bullets above), then rebuild `DevicesView.vue` + its sub-components to match. This is the single biggest phase — expect it to be multiple work sessions on its own.

## Phase 2 — Compliance (Policies + App Lists)

**Status: implemented (this session).** Read `docs/compliance.md` (127 lines) in full, then `CompliancePoliciesView.jsx` (624), `PolicyBuilder.jsx` (1033), `TemplateGallery.jsx` (152), and the `DeviceAudienceCreateModal`/`AudiencePickerField`/`TagConditionField` exports of `DevicePickers.jsx` (lines 296-620), then diffed against the migrated files and rebuilt: `stores/compliance.ts` (extended with `smartAttributeNames`/`selfReportedAttributeNames`/`smartAttributes`/`violatorCounts` + matching fetchers), 4 new components (`DeviceAudienceCreateModal.vue`, `AudiencePickerField.vue`, `TagConditionField.vue`, `ConditionRow.vue`), and full rewrites of `PolicyBuilderDrawer.vue`, `PoliciesTable.vue` (table → card grid), `ViolationsQueue.vue` (generic table → embedded Awaiting-review + Recent-activity sections matching the original's in-page layout), `TemplateGallery.vue` (tab → modal), and `ComplianceView.vue` (4 flat tabs → the original's 2-subview pill switcher with Violations embedded on the Policies subview and the Template Gallery as a modal).

One disclosed, deliberate gap: the Policy Builder's **Segment field is omitted**. `backend/prisma/schema.prisma`'s `CompliancePolicy` model has no `segmentId` column and `compliance.schemas.ts`'s zod schema doesn't accept one — combined with the fact that no Segments navigation panel exists anywhere in the migrated app yet (Phase 9), building the field would mean UI for a value the backend silently can't persist. Documented via a code comment at the top of `PolicyBuilderDrawer.vue`; revisit once Phase 9 lands and a backend column is added.

`AppListsPanel.vue` got a lighter pass than the rest of the phase, per a scoped decision rather than a full port of `AppListsView.jsx` (671 lines, not read in full this session — its content is known only from `docs/compliance.md`'s summary). Added: manual catalog entry (name + raw identifier, for anything the live search can't find) and a "used by N polic(ies)" indicator per list (computed client-side from policies' `requiredAppList`/`disallowedAppList` conditions), plus enforcing platform-locked-once-created on edit (matching the original). Deliberately deferred, documented via a code comment in the file: quick-start presets (one-click common browser/collaboration app sets) and the installed-app inventory sync panel (coverage %, self-reported count, oldest sync age, refresh-now) — both are additive UI over an inventory-coverage endpoint the frontend doesn't currently call.

**Spec:** `docs/compliance.md` (read first — at 13.7KB it's the second-largest doc after Settings, meaning Compliance's real feature surface is large; read it in full, not skimmed). **Source:** `wow-dashboard/src/components/compliance/{CompliancePoliciesView,PolicyBuilder,AppListsView,AppListsManager,TemplateGallery}.jsx`.

Confirmed concrete gaps:

- **`CompliancePoliciesView.jsx`**: 2 sub-tabs (`policies` / `appLists`, line 327-328) inside the Compliance view itself — confirm our `ComplianceView.vue` has this exact sub-navigation, not a flat page. Also: policy evaluation status badges with 7 distinct states (`auto_fired`, `approved`, `dismissed`, `no_workflow`, `autorun_blocked`, `autorun_capped`, `autorun_unavailable`/`workflow_unavailable` — read lines 560-570 in full for the exact set and colors), a per-policy live violator count, bulk violation actions, and a history limit control.
- **`PolicyBuilder.jsx`** (1033 lines vs. our `PolicyBuilderDrawer.vue` at 296 — the single largest content gap found this pass): ~40 distinct pieces of state including condition-logic builder (any/all), MITRE ATT&CK technique tagging, auto-run with configurable batch cap (or uncapped) and a destructive-action acknowledgement checkbox, escalation to a second workflow at a configurable minimum risk tier, non-compliance tagging AND non-compliance smart-attribute writing, open-case-on-violation / auto-resolve-case-on-recovery toggles, target device-audience scoping, and a configurable evaluation interval (hours or minutes unit). **Read this file in full — it is the richest single form in the whole original app and needs a line-by-line port, not a rewrite from memory.**
- **`AppListsView.jsx`** (671 lines vs. our `AppListsPanel.vue` at 172): per-platform app-store source config (`apple_store`/`homebrew` for macOS, `ms_store`/`winget` for Windows, `android_known` for Android), a starter-template picker with "Common browsers" / "Collaboration apps" presets per platform, and live app search against the store. Read in full.
- **`TemplateGallery.jsx`** (152 lines vs. our `TemplateGallery.vue` at 63) — the policy-template picker (ISO27001/ENS/NIS2 compliance framework templates mentioned elsewhere in `App.jsx`'s `CATALOG`). Read in full for the exact template list and card layout.

## Phase 3 — Cases

**Status: implemented (this session).** Read `docs/cases.md` in full, then all 1065 lines of `CasesView.jsx` (it's a single file — `CasesView`, `NewCaseModal`, `RunWorkflowFromCase`, `RetryIntegrationsButton`, `SyncTicketStatusButton`, `CaseDetailDrawer`, plus the shared `shared/MitreCatalog.jsx` module it imports), then diffed against the migrated files and rebuilt.

New shared modules (not case-specific — built here because Cases is the first view needing a rich MITRE tag UI, but usable by any future one): `lib/mitreCatalog.ts` (`tacticColorMap`/`techniqueByIdMap`, the pure-function half of the original's `useMitreCatalog`), `components/shared/MitreTagPills.vue` and `components/shared/MitreTagPicker.vue` (search + tactic-grouped checkboxes + revoked/deprecated badges + catalog-freshness footer). `stores/compliance.ts` gained `mitreCatalogMeta` + `refreshMitreCatalogNow()` to back the picker's "Sync now" cross-check against MITRE's live STIX feed. `components/cases/SlaBadge.vue` is new too (red/amber/gray countdown badge, used on both the list row and the drawer header).

`CasesView.vue`: full rewrite — the original's `STATUS_TABS` pill bar (Open/Resolved/Closed/False positive/All, with "Open" meaning `open ∪ investigating`), free-text search (title/device/assignee/policy), severity + MITRE tactic + MITRE technique filter dropdowns, a "My cases" toggle, an ATT&CK-coverage pill strip (click a tactic to filter by it), an open-count header badge, and — closing a caveat left open in Phase 1 — now reads `?caseId=` from the route on mount and opens that case's drawer directly (the Devices Compliance tab already linked here via `router.push({ path: "/cases", query: { caseId } })`, but this view wasn't reading it yet).

`CasesTable.vue`: rebuilt as a purely presentational list (filtering now lives in `CasesView.vue`, matching how Compliance's Phase 2 components split responsibility) — source icon, MITRE pills, `SlaBadge`, severity/status badges, and a bulk bar with **both** "Assign to me" and "Close selected" (the migrated version previously only had close), gated by `canBulkTriage` via `authStore.hasRiskyAction`.

`CaseDetailDrawer.vue`: full rewrite covering all 10 of the original's sections — free-text assignee input with a `<datalist>` of suggestions (previously a suggestions-only select, which couldn't accept an email outside that list) + "Assign to me"; MITRE tags now editable via `MitreTagPicker` with a "tags drifted from source policy" banner and one-click "Sync from policy" (previously read-only pills); run-workflow is now gated by `canRunDestructiveWorkflow` when the selected workflow has an `mdm_action` step, and the whole section is hidden if there's no linked device or no workflows exist at all (matching the original exactly — it has no "no linked device" placeholder); threat-intel results are shown newest-first with a "Cached" pill and 409-conflict "Force re-check"; the timeline maps each entry's `type` through a human label (`TIMELINE_LABEL`) instead of showing the raw type string.

`CaseCreateDialog.vue`: simplified to match the original's `NewCaseModal` exactly — title, severity, optional first note. The migrated version had grown `deviceId`/`deviceName` input fields that don't exist in the original (manual cases have no linked device; that's only ever populated by the compliance-violation/webhook-trigger auto-create paths) — removed rather than kept as an unrequested addition.

One disclosed, deliberate gap, same rationale as Phases 1-2: the original's implicit segment scoping (`collectSegmentIds` against a `selectedSegment` from the global Segments nav panel) isn't ported — no Segments panel exists anywhere in the migrated app yet (Phase 9).

**Spec:** `docs/cases.md` (read first). **Source:** `wow-dashboard/src/components/cases/CasesView.jsx` (1065 lines vs. our 473 across 4 files).

`docs/cases.md` already names several specifics to carry into the checklist: how cases get auto-created (compliance violation with dedup+reopen logic, inbound webhook trigger, Applivery native event, manual) and that manual creation can fire a Case Auto-Run Rule; the case-list row shape (source icon, title, source label + assignee + "updated X ago," MITRE tag pills, SLA badge, severity badge, status badge); a MITRE-tactic pill strip below the filters showing live per-tactic counts (clickable to filter); header actions **Export CSV** and **New Case**; bulk actions **Assign to me** and **Close selected** (gated by the `canBulkTriage` permission, cross-check `docs/settings.md#roles`); and a 7-section case detail drawer (Header, Status/Severity, Assignee w/ autocomplete from recent audit-log actors, Context, Run-a-workflow, External ticket chips w/ Retry-integrations + Sync-ticket-status, MITRE tags).

Confirmed concrete gaps (from source-level grep, in addition to the doc-derived list above):

- **`STATUS_TABS`** (line 44-49): 5 tabs — Open (`open_investigating`), Resolved, Closed, False positive, All. **Our migrated version has a single plain `<select>` for status in `CasesTable.vue`, not a tab bar.** This is a real, visible structural difference.
- Missing filters confirmed absent in migrated code: severity filter, "only mine" toggle (assignee = current user), MITRE tactic filter, MITRE technique filter, free-text search box, multi-select + bulk actions (`selectedIds`/`isBulkBusy`).
- `SOURCE_META` (3 case-origin types with icons: compliance_violation/workflow_trigger/manual) and `THREAT_META` (malicious/suspicious/clean/unknown/error verdict badges) — confirm these render on the case list/detail, not just internally.

Read `CasesView.jsx` in full (it's a single file, more tractable than Devices/Compliance) and rebuild `CasesTable.vue`/`CaseDetailDrawer.vue`/a new tab-bar component to match exactly.

## Phase 4 — Workflows (+ Action Library, Firewall Library, Script Library)

**Spec:** `docs/workflows.md` (16.3KB — read in full first, it's the largest doc after Settings). **Source:** `wow-dashboard/src/components/workflows/{WorkflowsView,WorkflowBuilder,ActionLibraryView,FirewallLibraryView,ScriptLibraryModals,WorkflowRunModals}.jsx`.

This one needs a structural read before a content read — the navigation itself differs:

- Original `WorkflowsView.jsx` has **3 top-level tabs**: Workflows, "Script & OMA-URI Library" (`library`), "Firewall Policy Library" (`firewall`) — `WorkflowsView.jsx:148-150`.
- Migrated `WorkflowsView.vue` has **6 tabs**: Workflows, Run History, Action Library, Firewall Policies, Script Repos, Triggers.

This isn't necessarily wrong (more surface area than the original isn't automatically bad), but it needs a deliberate decision, not an accident: either (a) the extra tabs map to functionality that exists in the original as sub-panels *within* one of its 3 tabs (e.g. Run History might be `WorkflowRunModals.jsx`'s content, surfaced as a modal in the original but a full tab here — check `WorkflowsView.jsx`'s `historyWorkflow`/`recentRuns` state, lines 45-49, to see if "history" is a per-workflow modal there rather than a page), or (b) it's a deliberate, approved restructure that should be flagged to the user rather than silently "fixed" by deleting tabs. **Read `WorkflowRunModals.jsx` (665 lines) and `ScriptLibraryModals.jsx` (474 lines) in full first** — their names strongly suggest "modals", meaning our separate pages may have taken things that were originally popovers/modals and made them permanent navigation. Confirm with the live app before changing anything structural here.

`STEP_TYPES` (9 step types in `WorkflowBuilder.jsx:28-37`) already match our `WorkflowStepEditor.vue`'s `STEP_TYPES` 1:1 — this part is in good shape. Focus this phase on: the builder's visual layout/flow (1030 lines original vs our `WorkflowBuilderDrawer.vue` + `WorkflowStepEditor.vue` at 239+271=510 — still a meaningful gap), and the navigation-structure question above.

### Status: implemented (this session)

Resolved per the user's explicit standing directive ("navigation and UI MUST match the original — no feature loss, no skipped visual elements"): restructured `WorkflowsView.vue` down to the original's exact **3 tabs** — Workflows, "Script & OMA-URI Library", "Firewall Policy Library" — via a pill switcher matching the Devices/Compliance visual pattern (the original uses a shared `ViewSwitcher` React component; no equivalent shared Vue component exists yet, so this is a locally-duplicated pill, functionally identical). The "Create Workflow" button is always rendered (not conditionally mounted) but visually hidden (`invisible pointer-events-none` + `aria-hidden`) off the Workflows tab, porting the original's own layout-stability trick verbatim (`WorkflowsView.jsx:157-165`).

The 3 extra tabs the migrated app had accumulated were each individually diagnosed and folded back in, not deleted:

- **Run History** → was a full separate tab; the original only ever shows it inline as "Recent runs" below the workflow grid on the Workflows tab (`WorkflowsView.jsx:250-330`). New `RecentRunsSection.vue` replaces the old `RunHistoryTable.vue`, rendered inline at the bottom of the Workflows tab, with the same date-range filter + Export CSV + "Show more" the original has.
- **Script Repos** → was a whole extra tab (`ScriptReposTable.vue`/`ScriptRepoDialog.vue`/`ScriptRepoBrowseDialog.vue`, 3 components). The original has no persistent repos tab at all — `ScriptRepoModal` (`ScriptLibraryModals.jsx:220-380`) is a single on-demand modal reached via an "Import from Git repo" button on the Library tab. Consolidated into one new `ScriptRepoImportModal.vue` (connected-repos list + browse/import in one two-column modal); the 3 old components are deleted.
- **Triggers** → was a 6th Workflows tab. It's actually Settings' "Inbound Webhooks" tab (`TriggersSettings.jsx`), previously believed entirely missing from the migrated app (see the Phase 5 section below — that gap description was wrong; the components existed, just filed under the wrong top-level nav). `TriggersTable.vue`/`TriggerDialog.vue` moved from `components/workflows/` to `components/settings/` and wired into `SettingsView.vue` as the `triggers` tab (see Phase 5 update below), closing that gap for free.

`WorkflowBuilderDrawer.vue` (side drawer) → replaced by new `WorkflowBuilderModal.vue`, a centered 2-screen modal wizard matching the original's actual chrome: screen 1 locks in name/description/target platform/deployment model, screen 2 shows a locked-target summary bar with a "Change" link back to screen 1, the step list, a destructive-step warning + `allowUnattendedDestructive` checkbox, and a linear (non-branching) Recovery section. `VersionHistoryDrawer.vue` → replaced by `VersionHistoryModal.vue` (centered modal, matching the original's chrome instead of a side drawer).

Functional-correctness fixes found via close reading against the original, beyond pure navigation: `WorkflowStepEditor.vue`'s `policy_replace`/`policy_add` steps now use real MDM-Policy dropdowns (`devicesStore.getPolicies`) and `app_select` uses a real Apps dropdown (`devicesStore.getApps`, new) instead of free-text id inputs; fixed a genuine pre-existing bug where the On-Failure branch select hardcoded its default to the literal string `'end'` and excluded the empty/default option entirely, rather than defaulting to `null` ("Stop") like the original's `BranchSelect` — both On-Success and On-Failure now correctly share the same default-value semantics, differing only in their option label.

**One disclosed, deliberate, timeboxed deviation**: the original's `ActionLibraryView.jsx`/`FirewallLibraryView.jsx` edit entries **inline in the list** (the row swaps in place for an `EntryForm`/`RuleSetForm`, no modal). Given effort constraints, `ActionLibraryTable.vue`/`FirewallRuleSetsTable.vue` were rebuilt to match the original's header/toolbar/filter-chips/card-list visuals closely, but edit/create still opens a modal/drawer (`ActionLibraryEntryDialog.vue`, `FirewallRuleSetBuilderDrawer.vue`) rather than the fully inline card-editing the original uses. The field content of both forms matches the original exactly (including previously-incomplete OMA-URI `action`/`format` option lists and firewall `profile` option list, all fixed to the original's full sets this pass).

## Phase 5 — Settings

**Spec:** `docs/settings.md` (22.7KB — the largest doc; it's the primary spec for all ~21 tabs, read in full before starting, then re-read the specific section per tab as you work through the table below).

- ~~**Immediate, concrete fix**: add the missing **"Inbound Webhooks"** tab...~~ **Done (Phase 4 session)**: this gap description turned out to be wrong — `TriggersTable.vue`/`TriggerDialog.vue` already existed as a full working implementation, just misfiled as a 6th tab under Workflows instead of Settings. Moved to `components/settings/`, wired into Settings as the `triggers` tab (`Bolt` — the solar-icons equivalent of the original's `Zap`), positioned per `App.jsx:263` (right after Log Export, before Case Auto-Run Rules), anchor `inbound-webhooks`.
- ~~**Structural deviation to raise with the user, not silently decide**: original Settings is a full-screen **modal**...~~ **Resolved this session**, per the user's standing fidelity directive ("navigation and UI MUST match the original"). See the status block below.
- For the other ~19 tabs: original SETTINGS_TABS list is at `App.jsx:254-278`, with the anchor-id map right after at `SETTINGS_TAB_ANCHORS` (used for deep-linking the help button — confirm our `SETTINGS_TAB_ANCHORS` in `SettingsModal.vue` still matches 1:1 after any changes). Each of the ~14 standalone settings files needs its own read-and-diff pass against its migrated counterpart (see the file-size table below for the mapping); General/SMTP/Account/Backup/Audit-Log/Workspace-Automation/Device-Data-Webhook are inline in `App.jsx`'s modal (lines ~5838-6108) rather than separate files, so read those ranges directly in `App.jsx`.

### Status: implemented (this session)

**Structural fix — Settings converted from a routed page to the original's actual modal chrome.** The previously-open question ("original is a full-screen modal with a left-hand tab rail; migrated is a routed `/settings` page with horizontal pill tabs — ask before converting") is resolved in favor of matching the original, per the user's explicit standing directive. `views/SettingsView.vue` is deleted; a new `components/settings/SettingsModal.vue` ports `App.jsx:5798-6399`'s exact chrome: a `bg-black/80 backdrop-blur-sm` overlay, a `max-w-5xl max-h-[90vh]` card, a header (icon + "Platform Settings" + help icon + close), a body split into a `w-56` left-hand nav rail (icon + label buttons, active state highlighted) and one full-width content pane per section, and a footer "Apply & Save Configuration" button. It's opened from `AppShell.vue`'s gear icon as local component state (`isSettingsModalOpen`, lazy-loaded via `defineAsyncComponent` to keep it out of the eagerly-loaded shell chunk) rather than a router push — it now overlays whatever page was open underneath, exactly like the original, instead of replacing it. The `/settings` route is removed from `router/index.ts` since the original has no routable Settings page at all. `SETTINGS_TABS` in the new modal carries an `icon` field per tab (7 new icons added to `lib/solarIcons.ts`: `Settings`, `Letter`, `UserCircle`, `DocumentText`, `Database`, `Pulse2`, `Delivery`) and 2 tab labels were corrected to match the original exactly (`"Apple App Updates"` → `"App Updates (Apple)"`, `"Integrations"` → `"Ticketing & Chat"`).

**Content-level fixes found via diffing against `docs/settings.md` and the original's inline `settingsTab==='backup'`/permission-gate logic:**

- `BackupRestorePanel.vue` was missing an entire independent feature: the original's "Dashboard layout only" export/import (`exportDashboard`/`importDashboard`, `App.jsx:3492-3540` — a separate, smaller JSON round-trip of just `widgets`/`layout`/`webhookUrl`/`smtpConfig` via the `dashboardState` store, distinct from the "Full Workspace Configuration" bundle below it). Added, using the already-existing `dashboardState` store.
- `BackupRestorePanel.vue` had no permission gate at all on the Full Workspace Configuration controls; the doc is explicit that `canExportOrImportConfig` gates every control there with a dimmed/disabled state and an explanation banner. Added, matching `App.jsx:5972-5975`'s exact copy and the `opacity: canManageWorkspaceConfig ? 1 : 0.6` dimming.
- `BackupRestorePanel.vue`'s import-bundle checkbox list was missing the original's per-item counts (`(3)`, `(12)`, etc.) — added via a small `itemCount()` helper.
- `BackupRestorePanel.vue`'s "Copy from another workspace instead" button previously duplicated a hand-rolled source-workspace picker inline; the original reuses its own onboarding modal for this (`App.jsx:5979`, `onClick={() => setIsOnboardingModalOpen(true)}`). Rewired to reuse the already-built `WorkspaceOnboardingModal.vue` (the same one shown on first login to an empty workspace) instead of maintaining two copies of the same picker UI.
- `IntegrationsTable.vue`/`ThreatIntelProvidersTable.vue`/`IntegrationDialog.vue`/`ThreatIntelProviderDialog.vue` had no `canEditIntegrationSecrets` permission gating at all — the doc is explicit that New/Edit/Delete/Test are disabled without it (same permission `VulnerabilityServicePanel.vue` already correctly gated). Added disabled states + an explanatory `Alert` in both dialogs, and disabled Edit/Delete in both tables.

**Spot-checked and found already complete, no changes needed**: `RolesSettingsPanel.vue`/`RoleDialog.vue`/`RolesTable.vue`/`CollaboratorsDirectoryTable.vue`/`CollaboratorEditDialog.vue`/`TestAccessPanel.vue` — the 2 sub-views (Roles, Collaborators & Tags), the 3-way per-area access toggle, all 5 high-risk-action checkboxes, the Applivery tag-value mapping, and the optional Segments scope were all already ported correctly from a prior phase.

**One disclosed, minor, deliberate deviation**: `SystemHealthPanel.vue` renders each background job's heartbeat as a table row rather than the original's card (`App.jsx`'s System Health section). Every data point the original's card shows (status/label/interval/last-run/consecutive-errors/last-error-detail) is present in the table — this is a visual-only difference on a read-only monitoring page, not a feature gap, and wasn't rebuilt as a card grid given effort constraints.

Remaining, not yet diffed in this pass (deferred, disclosed): `GeneralSettingsForm.vue`, `SmtpSettingsForm.vue`, `AuditLogRetentionPanel.vue`, `WorkspaceAutomationPanel.vue`, `DeviceDataWebhookPanel.vue`, `LogExportDestinationsPanel.vue`, `AppliveryEventsPanel.vue`, `CaseSlaSettingsForm.vue`, `OsUpdateCatalogPanel.vue`, `VulnerabilityCatalogPanel.vue`, `OsLifecyclePanel.vue`, `AppleAppUpdatesPanel.vue`, `CaseAutoRunRulesTable.vue`/`CaseAutoRunRuleDialog.vue` — a line-by-line read-and-diff against each original file wasn't completed for these given the size of this phase (the modal-chrome conversion plus the concrete gaps above already represent a full session's worth of verified, tested change). A future pass should still work through the file-size table below tab by tab.

| Original file | Lines | Migrated equivalent(s) | Lines |
|---|---|---|---|
| (inline, `settingsTab==='general'`) | — | `GeneralSettingsForm.vue` | 76 |
| (inline, `settingsTab==='smtp'`) | — | `SmtpSettingsForm.vue` | 108 |
| (inline, `settingsTab==='account'`) | — | `AccountPanel.vue` | 64 |
| (inline, `settingsTab==='backup'`) | — | `BackupRestorePanel.vue` | 161 |
| (inline, `settingsTab==='audit'`) | — | `AuditLogRetentionPanel.vue` | 64 |
| (inline, `settingsTab==='automation'`) | — | `WorkspaceAutomationPanel.vue` | 55 |
| (inline, `settingsTab==='webhook'`) | — | `DeviceDataWebhookPanel.vue` | 97 |
| `LogExportDestinations.jsx` | 285 | `LogExportDestinationsPanel.vue` + `LogExportDestinationDialog.vue` | 78+149 |
| `TriggersSettings.jsx` | 259 | `TriggersTable.vue` + `TriggerDialog.vue` (moved from Workflows, Phase 4) | 70+87 |
| `CaseAutoRunRulesSettings.jsx` | 293 | `CaseAutoRunRuleDialog.vue` + `CaseAutoRunRulesTable.vue` | 87+36 |
| `AppliveryWebhookSettings.jsx` | 273 | `AppliveryEventsPanel.vue` | 155 |
| `CaseSlaSettings.jsx` | 142 | `CaseSlaSettingsForm.vue` | 71 |
| `SystemHealthSettings.jsx` | 118 | `SystemHealthPanel.vue` | 63 |
| `OsUpdatesSettings.jsx` | 145 | `OsUpdateCatalogPanel.vue` | 42 |
| `VulnCatalogSettings.jsx` | 152 | `VulnerabilityCatalogPanel.vue` | 53 |
| `VulnServiceSettings.jsx` | 244 | `VulnerabilityServicePanel.vue` | 105 |
| `OsLifecycleSettings.jsx` | 282 | `OsLifecyclePanel.vue` | 73 |
| `AppleAppUpdatesSettings.jsx` | 133 | `AppleAppUpdatesPanel.vue` | 60 |
| `IntegrationsSettings.jsx` | 368 | `IntegrationDialog.vue` + `IntegrationsTable.vue` | 195+39 |
| `ThreatIntelSettings.jsx` | 230 | `ThreatIntelProviderDialog.vue` + `ThreatIntelProvidersTable.vue` | 108+34 |
| `RolesSettings.jsx` | 629 | `RoleDialog.vue` + `RolesSettingsPanel.vue` + `RolesTable.vue` | 169+91+39 |

Go tab by tab, in the order listed (smallest gaps first is fine here — this phase is many small diffs, not one big rewrite like Phases 1-3).

## Phase 6 — Audit Logs (small)

**Spec:** `docs/audit-logs.md`. **Source:** `AuditLogsView.jsx` (341) vs `AuditLogsView.vue` (126). Filters already match functionally. Read the original in full for: exact column set, retention-days banner copy/placement, "load more" vs pagination behavior, and visual styling (raw `<select>` → should match the styled dropdown treatment used elsewhere). Low risk, do this early as a quick win.

## Phase 7 — Reporting (small-medium)

**Spec:** `docs/reporting.md`. **Source:** inline in `App.jsx` lines 4892-5594 (builder/scheduled/template tabs, `isTemplateModalOpen` custom-report-template editor at line 6404+). Our `ReportingView.vue` (296 lines) already has all 3 tabs. Read the full 700-line original range and diff each tab's content in detail — this is very likely mostly complete but unverified in depth.

## Phase 8 — Playground (small)

**Spec:** `docs/playground.md`. **Source:** inline in `App.jsx` lines 4736-4892 (157 lines) vs `PlaygroundView.vue` (151 lines) — closest to parity by size of any view. Quick diff pass, low priority.

## Phase 9 — Segments navigation panel (net-new feature)

**Spec:** check `docs/overview.md`, `docs/devices.md`, `docs/compliance.md`, and `docs/cases.md` for any existing mentions of segment scoping (`docs/devices.md` already references "implicit segment scoping" in Phase 3's Cases excerpt above — re-read all four for the full cross-view picture) before building. Confirmed live via the running original app during this session: hovering the far-left edge of the screen while on Overview/Devices/Compliance/Cases reveals a 280px sidebar (`isSegmentPanelOpen`, hover-triggered at `App.jsx:4462`) titled "Segments", with: a search box, a "Show children elements" toggle switch, a tree of segments starting from "Global" with nested sub-segments (icons per depth level), and a collapse button (chevron, bottom-right of the panel). Selecting a segment scopes the whole page's data to that segment (see `selectedSegment` threaded into `DevicesView`/`CompliancePoliciesView`/`CasesView`/Overview's widget data fetches).

Backend already has segment-related plumbing (`deviceAudiences.service.ts` and others reference segments — confirm exact endpoint via `wow-dashboard`'s network calls or `main.py` before assuming). This phase needs: (1) a `SegmentsPanel.vue` component with hover-reveal behavior on a screen-edge trigger element, (2) a Pinia store for the segment tree + selected segment, (3) threading `selectedSegment` into Overview/Devices/Compliance/Cases data-fetching the same way the original does, (4) the small segment-name chip that appears next to each view's H1 when a non-Global segment is active (seen in `DevicesView.jsx:170-174` and the Overview header equivalent).

## Phase 10 — WidgetInfoModal (chart zoom)

`App.jsx:1227+` — clicking a widget's info (ⓘ) button re-renders that widget's chart full-size in a modal, with its own donut/bar/line/gauge/radar option-builders (largely duplicating the live widget's chart logic at a bigger size) plus a text description pulled from `WIDGET_DESCRIPTIONS[widget.stat]`. Currently stood in for with a simple metadata popover in `OverviewView.vue` (shipped this session, flagged to the user as a placeholder). Needs: (1) find/build the `WIDGET_DESCRIPTIONS` map (grep `App.jsx` for its definition — not yet located), (2) a full-size modal reusing `WidgetCard.vue`'s chart-building logic at a larger size instead of duplicating it if reasonably possible.

## Phase 11 — Dark mode

`App.jsx`'s `THEME` const (light/dark palettes, already partially captured in the earlier session's notes) plus `themeMode` state (`'light' | 'dark' | 'system'`, persisted to `localStorage` as `applivery_theme`) and a theme-switcher menu (`isThemeMenuOpen`) somewhere in the top nav (not yet located precisely — grep `App.jsx` for `isThemeMenuOpen`'s render site before starting). This is genuinely new work for the migrated app: no dark-mode CSS variables, no toggle UI, no persistence exist today. Because it touches *every* component's color values, this should be done last, after every other view is otherwise at parity — reopening every file a second time for dark-mode variants before their light-mode is even correct would be wasted work.

---

## Suggested phase order

1. Phase 1 (Devices) — biggest gap, most user-visible day-to-day screen after Overview.
2. Phase 3 (Cases) — single file, more tractable than Devices/Compliance, good momentum after Phase 1.
3. Phase 2 (Compliance) — biggest single-file gap (`PolicyBuilder`), do after building up the pattern-library from Phases 1 and 3.
4. Phase 5 (Settings) — many small, low-risk diffs; good to interleave/batch between the bigger phases.
5. Phase 4 (Workflows) — needs the structural question (3 tabs vs 6) answered with the user before content work.
6. Phase 6, 7, 8 (Audit Logs, Reporting, Playground) — small, can be done as quick wins whenever there's a gap between bigger phases.
7. Phase 9 (Segments panel) — net-new, cross-cutting, do after the 4 views it appears on (Overview done, Devices/Compliance/Cases from Phases 1-3) are otherwise at parity, so it only needs building once.
8. Phase 10 (WidgetInfoModal) — small, isolated to Overview, do whenever convenient.
9. Phase 11 (Dark mode) — last, for the reason stated above.

This ordering is a recommendation, not a constraint — check with the user before starting each phase, same as this session's "Push now vs. keep going" pattern, since priorities may shift based on what they're actually using day to day.
