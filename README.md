# Applivery SOAR

SOAR is a self-hosted admin dashboard layered on top of an [Applivery](https://www.applivery.com) UEM/MDM workspace. It adds Compliance Policies, automated Workflows, an incident-tracking Case system, RBAC, and a set of built-in security-intelligence feeds (vulnerability catalogs, OS lifecycle, patch status) — the kind of policy-driven, SOAR-style automation Applivery's own console doesn't provide out of the box.

It's a Vue 3 single-page frontend and a Node.js/Express + TypeScript backend, backed by Postgres via Prisma ORM. Every account is an existing Applivery Collaborator — there's no separate user database, and every device/policy action ultimately calls Applivery's own management API on your behalf.

## What it does

- **[Overview](docs/overview.md)** — a fully customizable widget dashboard across ~55 data sources spanning your device fleet, App Distribution, and every SOAR feature below.
- **[Devices](docs/devices.md)** — fleet inventory, per-device security posture (vulnerabilities, patch status, OS lifecycle, firewall state), segment/policy/tag management, and a live 3D globe view ([Playground](docs/playground.md)).
- **[Compliance](docs/compliance.md)** — policy-as-code device compliance, with a template gallery for ISO 27001 / ENS / NIS2, and an App Lists sub-view for mandatory/disallowed app enforcement.
- **[Workflows](docs/workflows.md)** — chained MDM actions, scripts, HTTP calls, and notifications, auto-fired by Compliance or run manually — including a Script/OMA-URI Library, a Windows Firewall Policy Library for network-remediation actions, and Inbound Webhook Triggers for third-party tools.
- **[Cases](docs/cases.md)** — the incident layer above raw violations, with SLA tracking, Jira/ServiceNow ticketing sync, and threat-intel IOC lookups.
- **[Reporting](docs/reporting.md)** — build, template, and schedule branded PDF reports from the same widget catalog as Overview.
- **[Audit Logs](docs/audit-logs.md)** — a unified, exportable activity log with configurable retention and SIEM export.
- **[Settings](docs/settings.md)** — RBAC role management, every integration (Jira/ServiceNow/Slack/Teams/Discord/PagerDuty/Opsgenie/S3/SFTP/syslog), and the security-intelligence catalogs, most of which need zero configuration beyond viewing status.

For how any of these actually work as an admin, start with the guide for that view under [docs/](docs/) — each one is written to be read on its own, and cross-links to the others where features connect. For how the codebase is built, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Requirements

- An Applivery workspace, with at least one Collaborator account (you'll log in with real Applivery credentials — there's no separate signup).
- Docker and Docker Compose.
- A Postgres database (bundled by the shipped compose file, or bring your own).

---

## Deployment

### Quick start

```bash
git clone <this repo>
cd "Applivery SOAR"
cp .env.example .env
# edit .env and fill in DASHBOARD_SECRET / POSTGRES_PASSWORD — see below
docker compose pull
docker compose up -d
```

`soar-frontend` and `soar-backend` both pull pre-built multi-arch images from GitHub Container Registry (`ghcr.io/raulcnadal/applivery-soar-frontend` and `ghcr.io/raulcnadal/applivery-soar`, published by `docker-publish.yml` on every push to `main`) — no local build or full repo checkout required to deploy, `docker-compose.yml` and `.env.example` are all you actually need.

Both packages are public, even though this repo itself is private — GHCR decouples package visibility from repo visibility — so the deployment host pulls anonymously, no `docker login` needed.

This runs four services: `soar-frontend` (Nginx, serving the built Vue app and reverse-proxying `/api/*` to the backend — published on host port `8080`), `soar-backend` (the Node/Express API, published on `8000` for direct access/debugging), `soar-db` (Postgres), and `soar-redis` (only used if you scale `soar-backend` to more than one replica — see [Background jobs at scale](#background-jobs-at-scale) below). Open `http://localhost:8080` once it's up.

If you'd rather run one container instead of the split topology above, `ghcr.io/raulcnadal/applivery-soar` alone (built from `backend/Dockerfile`) still serves the complete app — frontend bundled in, Express serving it as static files.

If you're working on the source and want to build locally instead of pulling, layer `docker-compose.build.yml` on top: `docker compose -f docker-compose.yml -f docker-compose.build.yml up --build`.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DASHBOARD_SECRET` | **Yes** | Signs this app's own dashboard session tokens. The process refuses to start without it. Generate a long random string and keep it stable — rotating it invalidates every logged-in session. |
| `POSTGRES_PASSWORD` | **Yes**, if using the shipped Postgres service | Password for the bundled Postgres service. |
| `DATABASE_URL` | Optional (set automatically from the above) | If you're not using the bundled Postgres service, point this at your own instance instead: `postgresql://user:pass@host:5432/dbname`. |
| `APPLIVERY_API_URL` | Optional | Defaults to `https://api.applivery.io/v1`. Only override if Applivery gives you a different base URL for your account. |
| `APPLIVERY_RATE_LIMIT_PER_HOUR` / `APPLIVERY_RATE_LIMIT_BURST` | Optional | Defaults to Applivery's own documented ceiling (10,000/hour, burst 100). Override only if your org's actual plan/contract grants a different limit. |
| `TRIGGER_SECRET` | Optional | Only needed if you wire up an external cron to call `POST /api/workflows/resume-due` or `POST /api/compliance/evaluate-due` over HTTP, instead of relying on this container's own background loops. |
| `REDIS_URL` | Optional | Set this (and point it at the bundled `soar-redis` service, or your own) only if you scale `soar-backend` to more than one replica — see below. Leave unset for a single replica. |
| `CORS_ORIGINS` | Optional | Only matters if you call the backend directly from a different origin than `soar-frontend`'s Nginx proxy. Defaults to `*`. |

Copy `.env.example` to `.env` and fill these in (`docker-compose.yml` reads them via `${VAR}` substitution).

### Data & persistence

Postgres data lives under `./pgdata`, bind-mounted by `docker-compose.yml` — **back this up**, it's the entire application state (every workspace's Compliance Policies, Workflows, Cases, Roles, and Settings configuration). If you run `soar-redis`, its data lives under `./redisdata`, but that's disposable job-queue state, not something you need to back up.

Losing `./pgdata` loses every Compliance Policy, Workflow, Case, Role, and Settings configuration across every workspace on this deployment. It does **not** lose anything in Applivery itself (devices, policies pushed to Applivery, App Distribution) — that data stays in Applivery's own systems and is re-fetched live.

### Background jobs at scale

Background jobs (the compliance evaluator, workflow-wait resumer, ticket sync, intelligence-catalog refreshers, and more — 17 in total) run in-process by default, which is correct and sufficient for a single `soar-backend` replica. If you scale `soar-backend` out (`docker compose up --scale soar-backend=3`), set `REDIS_URL` so these jobs run through the bundled `soar-redis` service instead — otherwise every replica's own copy of each job would fire independently, and the compliance evaluator, workflow resumer, etc. would all run multiple times per tick instead of once.

### Building without the bundled Postgres service

If you already run Postgres elsewhere, drop the `soar-db` service from `docker-compose.yml`, and set `DATABASE_URL` on `soar-backend` to point at your own instance instead. Everything else is unchanged.

### First login and RBAC bootstrap

On first login, whoever holds the **Owner** role in your Applivery workspace gets full Super Admin access automatically — that's the only automatic bypass. Everyone else needs a [Role](docs/settings.md#roles) created first (Settings → Roles, Super Admin only), mapping an Applivery collaborator tag to a set of permissions, or they'll be denied access entirely when they try to log in. Set this up before inviting other admins.

### Upgrading

```bash
docker compose pull
docker compose up -d
```

Prisma migrations apply automatically at container start (`prisma migrate deploy`, baked into the backend image's `CMD`) — no separate migration step is required.

### Health checks

[Settings → System Health](docs/settings.md#system-health) (inside the app, once logged in) is the fastest way to confirm every background job is actually running after a deploy. The `soar-db` Postgres service has a `pg_isready` healthcheck baked into `docker-compose.yml`, which `soar-backend` waits on before starting.

## Further reading

- [docs/](docs/) — one admin guide per view, written for the person actually using the dashboard day to day.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the frontend and backend are actually built, for developers extending the project.
