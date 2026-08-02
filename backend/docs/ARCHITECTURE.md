# Architecture — Applivery SOAR (BlueSky stack)

This is Applivery SOAR: a Vue 3 + TypeScript single-page frontend and a Node.js/Express + TypeScript backend, backed by Postgres via Prisma ORM.

Every account is an existing Applivery Collaborator — there's no local user database. Every device/policy/app action ultimately calls Applivery's own management API on the caller's behalf, using their own forwarded Applivery session token.

## 1. Frontend (`frontend/`)

Vue 3 with `<script setup>` and the Composition API throughout, built with Vite. State lives in Pinia stores (one per feature area, `frontend/src/stores/*.ts` — 23 in total, e.g. `devices.ts`, `compliance.ts`, `workflows.ts`, `auth.ts`, `roles.ts`, `catalogs.ts`), routed with Vue Router 4 (`createWebHistory`, so any deployment serving this SPA needs a fallback-to-`index.html` rule for non-file paths — see §8).

UI primitives come from `@applivery/bluesky-vue`, a component library vendored at `packages/bluesky-vue` and consumed via a relative path alias in `frontend/vite.config.ts` (not published to a registry — its own `node_modules` need installing separately, see the Dockerfiles). Feature-specific visualizations that aren't part of that library are hand-wrapped directly: `globe.gl` for the Playground 3D device globe, `vue-echarts`/ECharts for Overview/Reporting charts, `grid-layout-plus` for the draggable widget grid, and Leaflet (+ `leaflet.markercluster`) for the Devices map — there's no maintained Vue binding for Leaflet, so it's wrapped directly in a thin component, same pattern as the globe widget.

Top-level views (`frontend/src/views/`): `OverviewView`, `PlaygroundView`, `DevicesView`, `ComplianceView`, `WorkflowsView`, `CasesView`, `ReportingView`, `AuditLogsView`, `SettingsView`, `LoginView`. Settings alone hosts 20 sub-sections as tabs inside one view (see `docs/settings.md` for the full list) rather than 20 separate routes.

The API client (`frontend/src/api/http.ts`) is a single Axios instance with a request interceptor that stamps three things onto every call automatically, so no component ever attaches them by hand: the dashboard JWT (`X-Dashboard-Token`), the active workspace slug (`X-Workspace-Slug`), and the user's live Applivery bearer token (`Authorization`). `GET`/`POST /api/state` and `/api/layout` are the one deliberate exception — they always pin `X-Workspace-Slug: global`, since that pair of endpoints is shared dashboard-wide state, not per-workspace.

## 2. Backend (`backend/`)

Express + TypeScript, organized as one module per feature area under `backend/src/modules/` (18 modules: `auth`, `devices`, `compliance`, `catalogs`, `workflows`, `cases`, `integrations`, `threatIntel`, `config`, `settings`, `roles`, `auditLogs`, `analytics`, `reports`, `appLists`, `systemHealth`, `health`, `help`). Each module is typically `*.controller.ts` (routes + request/response shaping), `*.service.ts` (business logic, the actual Applivery/Prisma calls), and `*.schemas.ts` (Zod request validation). Routes are wrapped in a shared `asyncHandler` so a thrown/rejected error always reaches the centralized error-handling middleware rather than needing a try/catch in every handler.

Around 185 routes total (confirmed by `authRequired.test.ts`, which walks the live Express router stack rather than trusting a static count — see §9). Every route requires the dashboard token except a small, explicit allowlist of externally-triggered receivers (device self-report webhooks, the Applivery inbound webhook, trigger-fire URLs, and the two scheduler-poke endpoints gated by a separate `TRIGGER_SECRET` instead).

## 3. Storage layer — Postgres via Prisma

One `schema.prisma` (45 models) is the single source of truth for every persisted store — Compliance Policies, Workflows (with version history), Triggers, Roles, Cases, Integrations, Threat Intel providers, the five global intelligence catalogs, Automation Credentials, System Health heartbeats, and so on. Unlike the original app's one-SQLite-file-per-workspace model, every workspace's data lives in the same Postgres database, scoped by a `workspaceSlug` column on each table — simpler operationally (one database to back up, one place migrations apply) and the only architecture that supports the durable-workflow `wait` step cleanly across restarts.

Migrations are Prisma's own (`prisma migrate deploy`, run automatically at container start — see the backend `Dockerfile`'s `CMD`). Nothing here is a soft dependency the way the original's Postgres-for-durable-workflows-only was: Postgres is required for this build to start at all.

## 4. Authentication & RBAC

Login is a thin proxy to Applivery's own traditional-credentials login API (`POST /api/auth/login`) — there's no separate signup or local password. A successful login returns two independent things the frontend holds onto: this app's own short-lived dashboard JWT (the sole gate on every `/api/*` route, verified by `middleware/auth.middleware.ts`), and the user's real Applivery session (access/refresh token pair + expiry, forwarded as `Authorization: Bearer <token>` on every subsequent call to this app's backend, which in turn forwards it straight to Applivery's own API).

RBAC (`middleware/rbac.middleware.ts`) is this app's own layer entirely — Applivery's Collaborator role is a fixed 5-value enum (Owner/Admin/Editor/Viewer/Unassigned) with no fine-grained permission model of its own. Precedence, in order: (1) Applivery Collaborator role `owner` → Super Admin, unconditional full access, the only automatic bypass; (2) everyone else is resolved by matching a "role tag" read off their Applivery Collaborator record against the tag values a SOAR Role (`Settings → Roles`, Super-Admin-only) has been configured to accept; (3) no confirmed match → denied outright, never a default-read-only fallback. Resolution happens at login and at every workspace switch (`POST /api/auth/resolve-access`) and is cached server-side, in-memory, 12h TTL, fail-closed (a caller who hasn't resolved access for the current workspace this session is denied rather than re-resolved live inline).

Eight feature areas (`devices`, `compliance`, `workflows`, `cases`, `integrations`, `reporting`, `settings`, `auditLog`), each with three access levels (`none`/`read`/`manage`), gated per-route via `requirePermission({area, level})`. Five additional "risky action" checkboxes (`canDeletePolicyOrWorkflow`, `canRunDestructiveWorkflow`, `canEditIntegrationSecrets`, `canExportOrImportConfig`, `canBulkTriage`) are orthogonal to the area/level grid and gate specific destructive endpoints regardless of a role's general access level.

## 5. Background jobs

17 recurring jobs (`jobs/backgroundJobs.ts` is the single registry) cover everything that needs to run with no human signed in: the five global intelligence-catalog refreshers (OS Update/MSRC, Vulnerability/EUVD, OS Lifecycle, Apple GDMF, MITRE ATT&CK), the Compliance scheduler, the durable-workflow wait-step resumer, the script-run log reconciler, ticket-status sync, Case SLA monitoring, audit-log rotation, the batch log-export scheduler, the System Health alert monitor, the per-workspace Vulnerability Service refresher, the analytics snapshot capture, the scheduled-report sender, and the installed-apps rolling refresher. Every job records a heartbeat (`services/systemHealth.ts`) at the end of each run, success or failure, surfaced in `Settings → System Health`.

By default every job runs as a plain `setInterval` loop in the same Node process, staggered 15s apart at boot so they don't all fire in the same instant. If `REDIS_URL` is configured, the same 17 jobs instead run as BullMQ repeatable jobs against Redis (`queue/backgroundQueue.ts`) — this matters only once the backend is scaled to more than one replica, since N independent `setInterval` loops across N replicas would each fire independently (double/triple/N-tuple-firing the compliance evaluator, workflow resumer, etc.); BullMQ's Redis-lock-based job distribution instead guarantees exactly one instance of each job runs cluster-wide, regardless of replica count.

Automation Credentials (`Settings → Workspace Automation`, `modules/settings/automationCredential.service.ts`) are what let these jobs call Applivery's API unattended, per workspace — the app has no admin who's "always logged in," so a real signed-in session's tokens are captured on demand and self-refreshed thereafter.

## 6. Outbound Applivery API client & rate limiting

`services/appliveryClient.ts` wraps Axios in a singleton that never throws on a non-2xx response (callers inspect `.status` themselves) and auto-retries on `429` using the `Retry-After` header. Every outbound call is gated by a shared `TokenBucket` (`utils/tokenBucket.ts`) tuned to Applivery's own documented ceiling — 10,000 requests/hour with burst capability (`docs.applivery.com`) — configurable via `APPLIVERY_RATE_LIMIT_PER_HOUR`/`APPLIVERY_RATE_LIMIT_BURST` in case a given org's actual contract grants a different limit. List-endpoint pagination (`services/appliveryPaginate.ts`) walks every page using Applivery's own documented maximum page size (10,000) rather than a smaller default, and logs loudly — rather than silently truncating — if a fleet is ever larger than the configured safety ceiling.

Inbound, three tiers of per-IP rate limiting (`middleware/rateLimiter.middleware.ts`) protect this app's own API: a tight limit on `/api/auth/login`, a looser one on the two secret-in-URL-path receivers, and a default catch-all for everything else.

## 7. Deployment topology

`docker-publish.yml` publishes two multi-arch images to Docker Hub on every push to `main`: `raulcnadal/applivery-soar` (backend/Dockerfile) and `raulcnadal/applivery-soar-frontend` (frontend/Dockerfile). Two supported deployment shapes both pull from these, no local build required:

- **Split services (current default, `docker-compose.yml`)** — `soar-frontend` (`raulcnadal/applivery-soar-frontend`, Nginx serving the built Vue SPA, reverse-proxying `/api/*` to the backend so the browser only ever talks to one origin — no CORS needed), `soar-backend` (`raulcnadal/applivery-soar`, API-only), `soar-db` (Postgres), and `soar-redis` (optional — only needed if `soar-backend` is scaled to more than one replica, see §5).
- **Single container** — `raulcnadal/applivery-soar` alone also bundles the frontend (`COPY --from=frontend-builder ... /app/frontend/dist`) and Express falls back to serving it as static files for any non-`/api` route (`app.ts`) if no separate frontend service is fronting it. Same image either way — it's just unused static files when `soar-frontend`'s Nginx is what's actually serving traffic.

Building from local source instead of pulling (e.g. to test unreleased changes) is a `docker-compose.build.yml` override layered on top of `docker-compose.yml`.

Either way, the backend refuses to start without `DASHBOARD_SECRET` and `DATABASE_URL` set.

## 8. Testing

Backend: Vitest + Supertest (`backend/src/test/`), run against a fully in-memory mocked Prisma client, a mocked `appliveryClient`/raw `axios` (so catalog refreshers don't make real outbound calls during tests), and the app's real Express router (`app.ts`'s `createApp()`), so route/RBAC/rate-limit assertions exercise actual middleware rather than a stub. CI (`ci.yml`) additionally runs `prisma generate` + `prisma migrate deploy` against a real ephemeral Postgres service, and runs the full suite there too — the one thing that can't be validated in a sandboxed environment without a real database. Frontend: Vitest for unit tests, `vue-tsc -b && vite build` as the authoritative typecheck.

## Further reading

Each feature area has its own admin-facing guide under `docs/` (`overview.md`, `devices.md`, `compliance.md`, `workflows.md`, `cases.md`, `reporting.md`, `audit-logs.md`, `settings.md`, `playground.md`) — those describe how to *use* the app; this file describes how it's *built*.
