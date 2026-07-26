# Architecture Guide

This is the developer-facing companion to [README.md](README.md) (project overview + deployment) and the [docs/](docs/) admin guides (what each screen does for an end user). This document explains how the codebase itself is put together — for an engineer picking up the project for the first time.

The app is two halves: a React SPA (`wow-dashboard/`) and a FastAPI backend (`big-picture-api/`), shipped together in a single Docker image where the backend serves the built frontend as static files.

---

## 1. Frontend (`wow-dashboard/`)

### 1.1 Stack

- React 19, Vite 8, `@vitejs/plugin-react`.
- No router — a single `currentView` state variable drives which top-level screen renders (§1.4).
- No state-management library (no Redux/Zustand/Context store) — everything is `useState`/`useEffect` in the root component, prop-drilled down.
- Charts: `echarts` + `echarts-for-react`. Grid layout: `react-grid-layout` (Overview widget board). 3D globe: `react-globe.gl` + `three`.
- Icons: `@solar-icons/react` is the primary set, but every import aliases the real Solar icon name to a conventional/lucide-style local name, e.g. `import { CloseCircle as X, ShieldWarning as ShieldAlert } from '@solar-icons/react'`. `lucide-react` is also present as a secondary/legacy set. Keep using this aliasing convention for consistency when adding new icons.
- Styling: Tailwind, plus a `brand` color scale in `tailwind.config.js` mirroring `src/theme.js`'s BlueSky-derived palette. In practice, most of the codebase still styles via inline `style={{...}}` objects driven by JS color constants (`PRIMARY_BLUE`, `SUCCESS`, `WARNING`, `DANGER`) or a `theme` prop — Tailwind classes are used mostly for layout (flex/grid/spacing), not color. Follow the existing file's convention rather than mixing both styling approaches in one component.
- `npm run dev` / `npm run build` / `npm run lint` / `npm run preview`.

**Known cruft, don't be confused by it**: `src/App.jsx.master.jsx` is a stale backup, not imported anywhere. The `custom-scrollbar` CSS class is applied all over the codebase but has no matching CSS rule anywhere — it currently does nothing. `oidc-client-ts`/`react-oidc-context` are in `package.json` but unused (login is Applivery's own API, not OIDC).

### 1.2 Entry point and the one big file

`src/main.jsx` → `src/App.jsx`. `App.jsx` is ~6,400 lines and is genuinely monolithic — it contains the auth screens, the top nav, the Overview dashboard (inline, not a separate component), the Playground globe view (inline), the Reporting view (inline, including its Builder/Schedules/Template modals), the Settings modal shell plus several inline settings tabs, and dozens of shared helper components (`ModalHeader`, `WidgetCardShell`, `OsIcon`, etc.) that exist only at module scope in this file and aren't exported for reuse elsewhere.

Everything under `src/components/**` is a genuinely separate, imported component: `devices/`, `compliance/`, `cases/`, `workflows/`, `audit/`, `settings/`, `onboarding/`, `shared/`. When adding a new top-level view, the established pattern is: build it as its own file under `src/components/<area>/`, and wire it into `App.jsx` as an import + a `{currentView === '...' && <YourView .../>}` block — don't add more inline view code to `App.jsx` itself.

When reading or editing `App.jsx`, read it in sections (it's too large for one pass) — the rough map is: constants/helpers (~1–350), Overview widget catalog and info-modal (~1100–1700), Overview widget-grid rendering components (~1700–2470 area), the `Dashboard`/`App()` component body starting ~2470 (state, effects, handlers), the JSX return (top nav ~3990–4160, Overview render ~4160–4360, other view mounts ~4356–4500, Reporting ~4495–4890, footer ~4880–4960, Settings modal ~5400–5990, remaining top-level modals after that).

### 1.3 Auth and session model — two independent tokens

1. **Dashboard JWT** — this app's own short-lived gate token, issued by `POST /api/auth/login`, stored as `applivery_dashboard_token`. A global axios *request* interceptor stamps it onto every request whose URL contains `/api`, automatically — components never attach it manually.
2. **Applivery session** (`applivery_apiToken`/`refreshToken`/expiry timestamps) — the user's real Applivery access/refresh token pair, obtained from the same login response. This is what's forwarded, explicitly, per call site, as `Authorization: Bearer <apiToken>` both for calls to this app's own `/api/*` backend (alongside `X-Workspace-Slug: <orgSlug>`) and for direct calls to `api.applivery.io`.

Login (`AuthScreen` in `App.jsx`) is a state machine: `credentials` → (optional) `mfa` (Applivery's own 2FA, a 6-digit code) → (optional) `workspace` (pick org, if the user belongs to more than one) → `finishLogin` persists 8 localStorage keys.

A global axios *response* interceptor handles two distinct failure modes: a 401 from a direct `api.applivery.io` call triggers one silent token-refresh-and-retry; a 401 from this app's own backend only forces a full logout if the error message specifically indicates an invalid/missing dashboard session — other 401s (e.g. a data-level permission error) are left alone rather than logging the user out.

**When adding a new API call**: match the existing pattern for whichever backend you're calling — `Authorization: Bearer <apiToken>` + `X-Workspace-Slug: <orgSlug>` for this app's own `/api/*` routes (the dashboard-JWT headers are added automatically by the interceptor, don't add them yourself), or `Authorization: Bearer <apiToken>` alone (org in the URL path) for direct Applivery calls.

### 1.4 View routing

`currentView` (plain `useState`, default `'overview'`) drives everything — no router. The top nav's tab array filters itself by RBAC (`hasFeatureAccess(access, tab.area, 'read')`) before rendering, and clicking a tab just calls `setCurrentView(view)`. Two views (`appLists`, `auditLogs`) are intentionally left out of the top nav array and are only reachable via cross-links from other views (e.g. `onOpenAppLists` from Compliance, the workspace menu for Audit Logs) — this is the deliberate pattern for a "sub-view" that shouldn't clutter primary navigation.

The Settings modal is **not** a `currentView` — it's a `fixed inset-0` overlay gated by a separate `isSettingsModalOpen` boolean, so it stacks on top of whatever view is currently showing.

### 1.5 Segments

A "segment" is Applivery's own device-grouping hierarchy. `selectedSegment`/`segmentsList` state lives in the root component and is prop-drilled into every view that needs it (Overview, Devices, Compliance, Cases). Segment membership resolution (including "parent segment selected ⇒ include every descendant's devices") is handled by `src/utils/segments.js`'s tree-walking helpers, not duplicated per-view.

### 1.6 RBAC (frontend side)

`resolveSoarAccess()` calls `POST /api/auth/resolve-access` once per login/workspace-switch and caches the result to `localStorage['applivery_access']`. `hasFeatureAccess(access, area, level)` and `hasRiskyAction(access, action)` are the two helpers everything else is built on; both give an unconditional bypass to `access.isSuperAdmin`. A handful of derived booleans (`canDeletePolicyOrWorkflow`, `canRunDestructiveWorkflow`, `canEditIntegrationSecrets`, `canExportOrImportConfig`, `canBulkTriage`) are computed once near the top of the root component and threaded as props into whichever views need them.

**This is a UX layer only.** It exists to hide buttons before a wasted round-trip, not to enforce anything — the real boundary is the backend's `require_permission` dependency (§2.4), which mirrors the exact same area/level/action model server-side. Never rely on a frontend-only permission check for anything that matters.

### 1.7 Theming

`THEME.light`/`THEME.dark` (in `App.jsx`) each define `{ bg, card, border, text, textMuted, chartPalette, gridLine }`. `themeMode` (`light`/`dark`/`system`) is persisted to localStorage; the resolved `activeTheme` object is prop-drilled as `theme={activeTheme}` into essentially every component — there's no ThemeContext. When building a new component, take a `theme` prop and read colors off it (`theme.card`, `theme.textMuted`, etc.) rather than hardcoding hex values, to stay consistent with dark/light mode.

### 1.8 Overview widget system

`CATALOG` (the full "Add Widget" picker), `WIDGET_DESCRIPTIONS` (the ⓘ info-modal copy per widget), `SOURCE_SHAPES` (which chart types are valid for which data source), `ALL_CHART_TYPES`, `SIZES`, and `DEFAULT_DASHBOARD` (the starter layout for a brand-new workspace) all live near the top of `App.jsx`. Widget data fetching is **one HTTP GET per widget**, run in parallel (`Promise.all` over `GET /api/analytics/widget?source=...&chart_type=...`), not a single bulk endpoint — polled every 60 seconds while the Overview view is mounted. `react-grid-layout`'s `<Responsive>` component handles drag/resize/persistence of the layout array. [Reporting](docs/reporting.md) reuses this exact same `CATALOG` for its data-source picker, so a new widget source added to `CATALOG` automatically becomes available in both places.

### 1.9 Shared components (`src/components/shared/`)

Only two files exist here today: `ViewSwitcher.jsx` (the generic pill/segmented-tab switcher used everywhere two peer sub-views need a toggle — Workflows/Library/Firewall Library, Compliance/App Lists, Reporting's Builder/Schedules/Template) and `MitreCatalog.jsx` (a `useMitreCatalog` hook fetching the MITRE ATT&CK catalog once, shared between Compliance's Policy Builder and Cases' tag picker so they never drift out of sync).

**When you need a right-aligned header cluster next to a `ViewSwitcher`** (e.g. an action button alongside the tabs), add `ml-auto` to that cluster's wrapper `className` (or pass `className="ml-auto"` straight into `<ViewSwitcher>` if it's the only element on that side). The header row pattern used everywhere (`flex justify-between items-start ... flex-wrap`) will otherwise silently left-align that cluster if it ever wraps onto its own line on a narrow viewport — a real bug that was hit and fixed project-wide; don't reintroduce it in a new view's header.

### 1.10 Settings modal structure

`SETTINGS_TABS` (a flat array of `{ id, label, Icon, superAdminOnly? }`) drives a fixed-width left nav; `settingsTab` state picks which panel renders. A handful of tabs render inline in `App.jsx` (general, SMTP, account, backup, audit, automation, device-data-webhook); the rest mount an imported component from `src/components/settings/`, always conditionally (`{isSettingsModalOpen && <XSettings .../>}`) so each panel fetches fresh data every time the modal opens rather than staying mounted in the background. When adding a new Settings page, follow this conditional-mount pattern and add your tab to `SETTINGS_TABS`.

### 1.11 Cross-cutting conventions

- Modal shell: `ModalHeader` (icon + title + subtitle + close). Confirmations are plain `window.confirm(...)`, not a custom dialog component — this is deliberate and consistent across the whole file, keep using it rather than introducing a new confirm pattern.
- No toast/snackbar system. Errors surface either as a bare `alert(...)` or an inline error banner in the view's own state.
- Loading state is a per-component `isLoading`/`isRefreshing` boolean pair with a spinner div — no shared `<Spinner>` component exists.

---

## 2. Backend (`big-picture-api/`)

### 2.1 Structure

Almost the entire backend is one file, `main.py` (~17,000 lines). `template.html` is the default Jinja2 PDF-report template ([Reporting](docs/reporting.md#template-tab)). `scripts/` holds the standalone device self-report agent scripts (`report-installed-apps.sh`/`.ps1`, `report-security-attributes.sh`/`.ps1`) that admins download from [Settings → Device Data Webhook](docs/settings.md#device-data-webhook) and deploy to endpoints. `tests/` mirrors the file's own section structure (§2.11).

FastAPI app: `title="Applivery SOAR API"`. CORS is wide open (`allow_origins=["*"]`) — access control is entirely at the application layer (dashboard JWT + RBAC), not CORS. A custom `@app.middleware("http")` inbound rate limiter sits in front of everything — an in-process, single-instance fixed-window counter keyed by `(path-prefix, client IP)`, deliberately not Redis-backed. `/api/auth/login` is capped at 10 req/60s; the two secret-in-URL receivers (`/api/triggers/fire/`, `/api/applivery-webhook/receive/`) get a deliberately generous 120 req/60s since a monitoring tool firing many events at once is legitimate; everything else under `/api/` gets a 300 req/60s catch-all.

The static frontend build (`dist/`, copied in from the frontend Docker stage) is mounted and served with a catch-all route for React's own client-side view switching (§1.4) — the backend serves `index.html` for any unmatched path, guarded against path traversal.

### 2.2 Storage layer

A generic, hand-rolled per-workspace SQLite store, not an ORM. `DATA_DIR = "data"` (relative to CWD — this is exactly what `docker-compose.yml`'s `./data:/app/data` bind-mount persists). **One SQLite file per workspace slug** (`data/db/{slug}.sqlite3`), each with a single generic table: `store(kind TEXT, key TEXT, value TEXT, updated_at TEXT, PRIMARY KEY(kind, key))`, opened in WAL mode. A fixed pseudo-slug (`_global`) gets its own file for the handful of stores that aren't workspace-scoped (system health, global integrations).

`_store_load(slug, kind, default_factory, key='')` / `_store_save(slug, kind, data, key='')` are the two primitives everything else is built on — `kind` names a logical store (`'cases'`, `'compliance_policies'`, `'firewall_library'`, etc.), `key` is used for composite-keyed data (e.g. daily snapshots keyed `"{date}:{source}"`). A `default_factory` callable (not a bare mutable default) avoids the classic shared-mutable-default bug. **When adding a new persisted feature**, add a new `kind`, write thin `_load_X`/`_save_X` wrappers around the two primitives (matching every existing feature's pattern), and — if it should be exportable/cloneable — add an entry to `EXPORTABLE_CONFIG_STORES` (§2.9).

The first time a given `(slug, kind, key)` is read and SQLite has nothing, a one-time legacy-JSON import runs if a resolver was registered for that store (pre-SQLite-migration compatibility path) — old JSON files are never deleted, so this is safe to leave in place indefinitely.

**Postgres (`asyncpg`) is entirely optional** and solves exactly one problem the SQLite scheme doesn't: a workflow's `wait`/`run_script_wait` step needs to park a device's step chain for minutes-to-days without holding a coroutine or HTTP client hostage, and needs an indexed "what's due right now" query rather than a full-store scan. Three tables (`workflow_runs`, `workflow_run_results`, `workflow_pending_steps`) back this. If `DATABASE_URL` isn't set, `_get_pg_pool()` returns `None` and any workflow containing a `wait`/`run_script_wait` step is refused at launch rather than silently run unsafely in memory — every other feature, including the fully in-memory workflow engine used for workflows *without* a wait step, works with zero Postgres dependency.

### 2.3 Auth model

`DASHBOARD_SECRET` is a required environment variable — the process refuses to start without it. `POST /api/auth/login` is a thin proxy to Applivery's own login API (no local password storage, no local 2FA implementation — a `twoFactorCode` is just passed through, and Applivery's own 4014 error code triggers the frontend's MFA step). On success, it mints a 30-day dashboard JWT (`jwt.encode({"sub": email, ...}, DASHBOARD_SECRET, HS256)`) and returns it alongside Applivery's own real access/refresh tokens — see §1.3 for why both exist. `POST /api/auth/refresh` only renews the Applivery-side tokens; it never touches the dashboard JWT.

`verify_dashboard_token` (reads `X-Dashboard-Token` or `Authorization-Dashboard`) is the sole gate on every `/api/*` route — it only proves "a valid dashboard session exists." It says nothing about what that user is allowed to do; that's RBAC (§2.4), a separate layer.

`_applivery_call` is the single choke point every outbound call to `api.applivery.io` goes through — a drop-in replacement for `client.get/post/put/delete` that adds a shared async token-bucket rate limiter (capped conservatively below Applivery's own published ceiling) and automatic 429 retry with backoff. **Use `_applivery_call` for any new Applivery API integration** rather than calling `httpx` directly, to stay inside the shared budget.

### 2.4 RBAC

No local user database — every "user" is an Applivery Collaborator, and access is resolved from Applivery's own data plus this app's own Role records. Precedence, in order:

1. Applivery `role == "owner"` for the current org → **Super Admin**, unconditional bypass of every check.
2. Otherwise, the collaborator's Applivery `tags` field is matched (case-insensitively) against a Role's configured tag values.
3. No match → **denied outright**. There is no default-read fallback.

`SOAR_FEATURE_AREAS`: `devices, compliance, workflows, cases, integrations, settings` are the areas actually enforced via `require_permission(area=...)` calls (`reporting` and `auditLog` are declared in the enum but not currently gated by any endpoint). `SOAR_RISKY_ACTIONS` (the 5 checkboxes on a Role, see [Settings → Roles](docs/settings.md#roles)): `canDeletePolicyOrWorkflow`, `canRunDestructiveWorkflow` (enforced via an inline check rather than `require_permission(action=...)`, since it gates a specific in-function branch rather than a whole endpoint), `canEditIntegrationSecrets`, `canExportOrImportConfig`, `canBulkTriage`.

`POST /api/auth/resolve-access` does the live Applivery lookup and writes the result into an **in-process, in-memory** cache (`_ACCESS_CACHE`, keyed `(workspace_slug, lowercased_email)`, 12-hour TTL) — never persisted to disk. `require_permission(area=None, level="read", action=None, super_admin_only=False)` (a FastAPI dependency factory) **only ever reads this cache** — it never re-resolves live inline. A caller who hasn't triggered `resolve-access` for this workspace this session is denied, fail-closed. This is why the frontend calls `resolveSoarAccess` exactly once per login/workspace-switch (§1.6) rather than relying on a per-request live check — the design deliberately trades a small staleness window for not hitting Applivery's API on every single permission check.

**When adding a new gated endpoint**: use `Depends(require_permission(area="...", level="read"|"manage", action="..."))` matching the existing area/action vocabulary above — don't invent a new area or risky action without also adding it to `SOAR_FEATURE_AREAS`/`SOAR_RISKY_ACTIONS` and the [Roles](docs/settings.md#roles) UI, or it'll be unreachable/unconfigurable from the admin side.

### 2.5 Background loops

`start_scheduler()` (an `@app.on_event("startup")` handler) launches ~17 `asyncio.create_task` background loops. Every one heartbeats into a global `SYSTEM_HEALTH_JOBS`-registered health store via `_record_job_heartbeat(job_key, 'ok'|'error', detail)`, which is what powers [Settings → System Health](docs/settings.md#system-health).

| Loop | Interval | Purpose |
|---|---|---|
| Compliance scheduler | 60s tick, per-policy interval | Evaluates only Compliance Policies whose own `evaluationIntervalMinutes` is due |
| Report scheduler | 60s | Delivers due [scheduled reports](docs/reporting.md#schedules-tab) |
| Snapshot scheduler | daily | Captures a per-workspace/per-source analytics snapshot |
| Installed apps refresher | 30s | Refreshes the installed-app inventory ([App Lists](docs/compliance.md#app-lists-sub-view)) |
| Workflow wait resumer | 30s | Polls Postgres for due parked workflow steps |
| Audit log rotation | daily | Enforces per-workspace retention |
| Log export scheduler | daily | Ships batch (S3/NFS/SFTP) [Log Export](docs/settings.md#log-export) destinations |
| Script log reconciler | 90s | Polls Applivery for outstanding `runScript` results |
| Ticket status sync | 15 min | Pulls live Jira/ServiceNow status for open [Cases](docs/cases.md) |
| Case SLA monitor | 5 min | Flags SLA breaches, fires one-shot notifications |
| OS update catalog refresh | daily | Refreshes the MSRC Windows update feed |
| Vuln catalog refresh | daily | Refreshes the EUVD Apple/Android CVE feed |
| Vuln Service refresh | hourly check | Refreshes the opt-in [Vulnerability Service](docs/settings.md#vulnerability-service) cache (per-workspace interval) |
| OS lifecycle refresh | weekly | Refreshes endoflife.date data |
| GDMF refresh | daily | Refreshes Apple's Software Lookup Service data |
| MITRE catalog refresh | daily | Cross-checks the local ATT&CK technique catalog against MITRE's published STIX bundle |
| System health monitor | 5 min | Scans every job above (including itself); fires a one-time alert on unhealthy/overdue, and a one-time recovery notice on heal |

### 2.6 Integrations

`INTEGRATION_TYPES = ('slack', 'teams', 'discord', 'jira', 'servicenow', 'generic_webhook', 'pagerduty', 'opsgenie')` — dispatched from `_dispatch_case_integrations` on Case open/reopen/close. Chat types share one generic webhook sender; Jira/ServiceNow each have their own create/transition/status-fetch functions (polled by the ticket-sync loop above); PagerDuty/Opsgenie share a paging-event sender keyed by a dedup key (`case:{id}` or `system_health:{job_key}` — the same paging path is reused for both Case alerts and System Health alerts). SMTP email is a separate path reused for both scheduled-report delivery and Case SLA/System Health alert emails (with a distinct recipient list for the latter). Threat Intel providers (VirusTotal/AbuseIPDB/HIBP/generic REST) are IOC-reputation lookups, not automated — triggered only by a manual "Enrich" action or by auto-detected IOC-looking text in a Case note, cached 6 hours.

Two inbound receivers exist for external systems to call *into* this app: `POST /api/applivery-webhook/receive/{secret}` (Applivery's own native event webhook — auto-registers a rule per distinct event type the first time it's seen) and `POST /api/triggers/fire/{trigger_id}/{secret}` (a generic inbound endpoint for any third-party tool to fire a Workflow). Both use a secret embedded in the URL path as their entire auth model — no dashboard token required, since the caller is an external system, not a logged-in admin.

### 2.7 Workflow execution engine

Two engines, chosen automatically per workflow: a fully **in-memory** engine (`_execute_workflow_run_in_memory`) for any workflow with no `wait`/`run_script_wait` step, and a **Postgres-backed durable** engine (`_run_device_step_chain`) for workflows that do have one — see §2.2 for why. `_run_device_step_chain` walks one device's step list from a given start point (defaulting to the first step), with a 50-step guard against infinite loops.

Step dispatch (see [Workflows admin guide](docs/workflows.md#building-a-workflow) for the user-facing description of each): `wait` and `run_script_wait` are the only steps that persist state and return early with `status: "waiting"`; every other step type (`mdm_action`, `http_request`, `notification`, `policy_replace`/`policy_add`/`policy_restore`, `monitor`) runs synchronously inline in the same coroutine and moves straight to the next step. Branching (`onSuccess`/`onFailure`, each a step id / `'end'` / `None`) is resolved per step after it runs.

**Recovery steps** (`_run_recovery_steps`) fire when the loop detects, at the top of each iteration, that the device is no longer violating the workflow's linked recovery Compliance Policy. Two phases: (1) automatic — any already-executed `runScript` step in this run's log that had a paired restore-script field configured gets that restore script re-fired; (2) the workflow's own explicit `recovery.steps`, run once, linearly, no branching.

`_execute_mdm_action` is the single dispatcher for every MDM Action step — validates the action exists, the platform/deployment-model is compatible, required fields are present, then branches per action key. New MDM actions that reuse an existing mechanism (e.g. the Firewall Rule Set feature's `applyFirewallRuleSet`/`restoreFirewallRuleSet`, which recursively delegate to the same function's `runScript` branch) are the established pattern for adding a device action without duplicating the underlying `scripts[]` PUT/tracking logic.

### 2.8 Audit logging

`_record_audit_event(slug, category, action, actor, target_type, target_id, target_name, message, severity)` writes into the per-workspace SQLite `audit_log` store (newest-first, hard-capped at 50,000 regardless of retention setting), and synchronously fans out to any enabled real-time [Log Export](docs/settings.md#log-export) destination (syslog/webhook) on every write — batch destinations (S3/NFS/SFTP) are handled by the daily scheduler instead. Queried via `GET /api/audit-logs` (filterable) — see [Audit Logs admin guide](docs/audit-logs.md).

### 2.9 Config export/import

`EXPORTABLE_CONFIG_STORES` is a `{friendly_key: (sqlite_kind, default_factory)}` dict — this is the authoritative list of what's included in [Backup & Restore](docs/settings.md#backup--restore) export/import/clone. **Every time you add a new persisted `kind` that an admin would reasonably want to export or clone into another workspace, add it here too** — nothing is automatic. Import/clone is a wholesale overwrite per selected store, never a merge, specifically so cross-references (e.g. a Trigger's `workflowId`) stay intact rather than being silently renumbered.

### 2.10 Device/MDM abstraction

`_platform_path_segment(platform)` maps a normalized platform (`apple`/`macos`/`android`/`windows`/`aosp`) to the URL segment Applivery's own API expects. `MDM_ACTIONS` is a dict registry (~40 entries) of every device action the app knows how to perform, each with a `label`, `destructive` flag, allowed `platforms`, per-platform `deploymentModels` restriction, and optional admin-fillable `fields` metadata that the frontend's Workflow Builder renders dynamically — **this dict, not a hardcoded frontend list, is the single source of truth for what actions exist and what platforms they're valid on.** `DEPLOYMENT_MODELS` similarly backs the frontend's Step-2 picker.

### 2.11 Compliance engine

`_policy_violated(device, policy, slug)` evaluates a policy's `conditions` list (each a `{field, operator, value}` triple) against a device, combined via `conditionLogic` (`'any'`/`'all'`). `COMPLIANCE_FIELDS` is the registry backing every condition field type available in the [Policy Builder](docs/compliance.md#conditions--the-full-field-catalog) — same "dict is the source of truth for what the frontend can offer" pattern as `MDM_ACTIONS`.

`_run_compliance_evaluation` is the shared core for both manual ("Evaluate now") and scheduled evaluation — a two-pass design (pure in-memory decision-making first, batched marker writes second) so a fleet-wide evaluation doesn't do one sequential Applivery round-trip per device. The scheduler uses the workspace's stored [Automation Credential](docs/settings.md#workspace-automation) and evaluates only policies whose own interval has elapsed; the manual "Evaluate now" endpoint always evaluates every enabled policy using the calling admin's own session; `POST /api/compliance/evaluate-due` is the external-trigger equivalent (gated by a separate `TRIGGER_SECRET`) for a deployment that prefers an outside cron to drive evaluation instead of relying on this process's own loop.

An `autoRunBatchCap` (default 15, per-policy) caps how many devices a single evaluation pass will auto-fire a workflow against unattended — violators beyond the cap are queued for manual review instead. A circuit breaker independently pauses a policy's auto-run if its last 3 consecutive fired runs all failed on every device, since that's a signal the automation itself is broken, not that devices are hard to fix.

### 2.12 Endpoint map (by prefix, roughly by size)

`/api/compliance*`, `/api/workflows*`, `/api/cases*`, `/api/settings*`, `/api/app-lists*`, `/api/roles*`, `/api/triggers*`, `/api/devices*`, `/api/threat-intel*`, `/api/script-repos*`/`/api/script-assets*`, `/api/integrations*`, `/api/analytics*`, `/api/action-library*`, `/api/vuln-service*`, `/api/firewall-rulesets*`, `/api/config*`, `/api/case-autorun-rules*`, `/api/applivery-webhook*`, `/api/auth*`, `/api/audit-logs*`, `/api/app-catalog*`, `/api/vuln-catalog*`, `/api/os-updates*`, `/api/os-lifecycle*`, `/api/mitre*`, `/api/gdmf*`, `/api/device-data*`, `/api/device-audiences*`, `/api/case-sla-settings*`, `/api/apple-app-updates*`, plus single-purpose reads (`/api/system-health`, `/api/smart-attributes`, `/api/segments`, `/api/reports`, `/api/policies`, `/api/mdm-users*`, `/api/mdm-actions`, `/api/firewall-ruleset-templates`, `/api/device-tags`, `/api/deployment-models`, `/api/apps`, `/api/app-search`). ~178 routes total.

### 2.13 Testing (`big-picture-api/tests/`)

`conftest.py` has an autouse session-scoped fixture that `chdir`s into a fresh temp directory and sets `DASHBOARD_SECRET` **before** `main.py` is ever imported — necessary because `main.py` has import-time side effects (creates `data/`, hard-requires `DASHBOARD_SECRET`).

The dominant, long-established convention (9 of 11 test files) is **plain function/coroutine-level testing** — call pure functions or `async def` route handler coroutines directly, bypassing FastAPI's routing/dependency layer entirely. This is a deliberate choice: most of the safety-critical logic (condition evaluation, the autoRun circuit breaker, RBAC resolution) lives in plain functions that don't need HTTP scaffolding to test.

`TestClient` (real HTTP-level testing against the actual `app` object, including its dependency/RBAC layer) is newer and still comparatively rare, introduced specifically to catch a class of bug pure function tests can't — a wrong `area`/`level`/`action` on a `require_permission` dependency, or a missing dependency entirely. When you add a new endpoint with RBAC gating, add at least one `TestClient`-based test asserting the permission boundary (see `test_vuln_service_endpoints.py` or `test_firewall_rulesets.py` for the pattern), in addition to whatever pure-function tests cover the underlying logic. **Always instantiate `TestClient` without a `with` block** in this codebase — a context-managed client runs the app's `startup` lifespan handler, which spawns every background loop in §2.5, none of which have any place running during a test.

Test file map: `test_storage.py` (generic SQLite store), `test_rbac.py` (access resolution + `require_permission`), `test_safety_critical.py` (destructive-step detection, autoRun circuit breaker), `test_compliance_intelligence.py` (OS-update/vuln/lifecycle signals feeding conditions and risk), `test_compliance_templates.py` (template catalog integrity), `test_alerting_and_feeds.py` (paging, MITRE STIX freshness, config export/import, CEF formatting, rate limiter), `test_workspace_onboarding.py` (empty-workspace detection, clone-safety), `test_vuln_service.py` / `test_vuln_service_endpoints.py`, `test_firewall_rulesets.py`.

Run the suite from `big-picture-api/`: `python3 -m pytest tests/ -q`. `python3 -m py_compile main.py` is a fast syntax sanity check worth running before the full suite.

---

## 3. Adding a new feature — the established pattern

Looking at how the Vulnerability Service and Firewall Rule Set features were built (both added this way), the repeatable shape for a new integration/feature is:

1. **Backend model + storage**: a Pydantic payload model, a `_load_X`/`_save_X` pair over the generic SQLite store (§2.2), and — if it holds a secret — encrypt it at rest the same way the Vulnerability Service token is (Fernet, keyed off `DASHBOARD_SECRET`), never store it in plaintext in a new feature going forward.
2. **CRUD endpoints**, gated with `require_permission(area=..., level=...)` matching an existing area (§2.4) — don't invent a new area casually.
3. **If it needs to run unattended**: register a background loop (§2.5), give it a `SYSTEM_HEALTH_JOBS` entry so it shows up in [System Health](docs/settings.md#system-health) automatically.
4. **If it's config an admin would want to export/clone**: add it to `EXPORTABLE_CONFIG_STORES` (§2.9).
5. **Frontend settings page**: a new component under `src/components/settings/`, added to `SETTINGS_TABS`, conditionally mounted only while the Settings modal is open (§1.10).
6. **Tests**: pure-function tests for the core logic, plus a `TestClient`-based test asserting the RBAC boundary on any new gated endpoint (§2.13).
7. **Docs**: update the relevant guide under [docs/](docs/) and this file if you've changed the architecture, not just added a leaf feature.

---

## Related documentation

- [README.md](README.md) — project overview and deployment.
- [docs/](docs/) — end-user admin guides, one per main view.
