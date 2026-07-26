# Applivery SOAR

SOAR is a self-hosted admin dashboard layered on top of an [Applivery](https://www.applivery.com) UEM/MDM workspace. It adds Compliance Policies, automated Workflows, an incident-tracking Case system, RBAC, and a set of built-in security-intelligence feeds (vulnerability catalogs, OS lifecycle, patch status) — the kind of policy-driven, SOAR-style automation Applivery's own console doesn't provide out of the box.

It's a two-part app: a React single-page dashboard and a FastAPI backend, shipped together as one Docker image. Every account is an existing Applivery Collaborator — there's no separate user database, and every device/policy action ultimately calls Applivery's own management API on your behalf.

## What it does

- **[Overview](docs/overview.md)** — a fully customizable widget dashboard across ~55 data sources spanning your device fleet, App Distribution, and every SOAR feature below.
- **[Devices](docs/devices.md)** — fleet inventory, per-device security posture (vulnerabilities, patch status, OS lifecycle, firewall state), segment/policy/tag management, and a live 3D globe view ([Playground](docs/playground.md)).
- **[Compliance](docs/compliance.md)** — policy-as-code device compliance, with a template gallery for ISO 27001 / ENS / NIS2, and an App Lists sub-view for mandatory/disallowed app enforcement.
- **[Workflows](docs/workflows.md)** — chained MDM actions, scripts, HTTP calls, and notifications, auto-fired by Compliance or run manually — including a Script/OMA-URI Library and a Windows Firewall Policy Library for network-remediation actions.
- **[Cases](docs/cases.md)** — the incident layer above raw violations, with SLA tracking, Jira/ServiceNow ticketing sync, and threat-intel IOC lookups.
- **[Reporting](docs/reporting.md)** — build, template, and schedule branded PDF reports from the same widget catalog as Overview.
- **[Audit Logs](docs/audit-logs.md)** — a unified, exportable activity log with configurable retention and SIEM export.
- **[Settings](docs/settings.md)** — RBAC role management, every integration (Jira/ServiceNow/Slack/Teams/Discord/PagerDuty/Opsgenie/S3/SFTP/syslog), and the security-intelligence catalogs, most of which need zero configuration beyond viewing status.

For how any of these actually work as an admin, start with the guide for that view under [docs/](docs/) — each one is written to be read on its own, and cross-links to the others where features connect. For how the codebase is built, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Requirements

- An Applivery workspace, with at least one Collaborator account (you'll log in with real Applivery credentials — there's no separate signup).
- Docker and Docker Compose.
- A place to persist the `data/` and `pgdata/` volumes (see [Data & persistence](#data--persistence)).

---

## Deployment

### Quick start

```bash
git clone <this repo>
cd "Applivery Big Picture SOAR"
cp .env.example .env   # fresh clone only — this deployment already has a filled-in .env
# edit .env and fill in DASHBOARD_SECRET / POSTGRES_PASSWORD — see below
docker compose up -d --build
```

The stack has two services: the app itself, and a Postgres database backing the optional durable-workflow feature (see [Postgres](#postgres--durable-workflows) below). The app is not published to a host port by default (`docker-compose.yml` has `expose: 8000`, not `ports:`) — it's expected to sit behind a reverse proxy on a shared Docker network (`npm-network` in the shipped compose file, e.g. for Nginx Proxy Manager). If you're running this standalone without a reverse proxy, uncomment the `ports:` line in `docker-compose.yml` and remove/replace the `npm-network` network reference.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DASHBOARD_SECRET` | **Yes** | Signs this app's own dashboard session tokens. The process refuses to start without it. Generate a long random string and keep it stable — rotating it invalidates every logged-in session. |
| `POSTGRES_PASSWORD` | **Yes**, if using the shipped `docker-compose.yml` | Password for the bundled Postgres service backing durable workflows. |
| `DATABASE_URL` | Optional (set automatically by `docker-compose.yml` from the above) | If you're not using the bundled Postgres service, point this at your own instance instead: `postgresql://user:pass@host:5432/dbname`. |
| `AUTOMATION_ORG_SLUG` / `AUTOMATION_API_TOKEN` | Optional | A legacy, single-workspace fallback automation credential. Prefer configuring a credential per workspace from [Settings → Workspace Automation](docs/settings.md#workspace-automation) instead — that's what makes scheduled reports, the compliance scheduler, and the workflow resumer run unattended per-workspace. |
| `TRIGGER_SECRET` | Optional | Only needed if you wire up an external cron (e.g. a Cloudflare Worker Cron Trigger) to call `POST /api/workflows/resume-due` or `POST /api/compliance/evaluate-due` over HTTP, instead of relying on this container's own background loops. |

Copy `.env` and fill these in (`docker-compose.yml` reads them via `${VAR}` substitution — see the comments in the shipped `.env` file for the exact meaning of each).

### Data & persistence

Everything the app writes lives under the `data/` directory, bind-mounted by `docker-compose.yml` (`./data:/app/data`) — **back this up**, it's the entire application state (every workspace's SQLite database, under `data/db/*.sqlite3`). If you're running the durable-workflow Postgres service, its data lives under `./pgdata`, also bind-mounted — back that up too if you rely on long-running `wait` workflow steps.

Losing `data/` loses every Compliance Policy, Workflow, Case, Role, and Settings configuration across every workspace on this deployment. It does **not** lose anything in Applivery itself (devices, policies pushed to Applivery, App Distribution) — that data stays in Applivery's own systems and is re-fetched live.

### Postgres — durable workflows

Postgres backs exactly one feature: a workflow's `wait` and `run_script_wait` steps, which need to park a device's step chain for minutes-to-days without holding a server resource hostage (see [ARCHITECTURE.md §2.2](ARCHITECTURE.md#22-storage-layer)). If `DATABASE_URL` isn't configured, **every other feature in the app works normally** — Postgres is not a hard dependency for the app to run, only for that one workflow-step type, which is refused with a clear error at launch (rather than silently run unsafely) if the database isn't reachable.

### Building without the bundled Postgres service

If you already run Postgres elsewhere, drop the `applivery-big-picture-db` service and `db-network` from `docker-compose.yml`, and set `DATABASE_URL` on the app service to point at your own instance. Everything else is unchanged.

### Building the image manually

```bash
docker build -t applivery-big-picture .
```

The `Dockerfile` is a two-stage build: Stage 1 (`node:20-alpine`) builds the React frontend (`wow-dashboard/`) with `npm install && npm run build`; Stage 2 (`python:3.11-slim`) installs the Python backend's system dependencies (WeasyPrint's Cairo/Pango libraries, needed for [Reporting](docs/reporting.md)'s PDF generation), installs from the **root `requirements.txt`** (not `big-picture-api/requirements.txt` — the latter is a secondary/local copy for editor tooling that must be kept in sync, see the comment at the top of the root file), copies in `main.py`/`template.html`/`scripts/`, and copies the Stage 1 build output into `./dist`. The final image runs `uvicorn main:app --host 0.0.0.0 --port 8000`, serving the built frontend as static files from the same process.

**If you add a new Python import to `main.py`**, add the matching package to the **root** `requirements.txt` (and mirror it in `big-picture-api/requirements.txt`) — the Dockerfile only installs from the root file, and a hard top-level import missing from it will fail the container at startup, not at the point you use the feature. See the comment block at the top of `requirements.txt` for which dependencies are hard requirements (fail to start without them: `cryptography`) versus soft/optional ones the app degrades gracefully around (`asyncpg`, `boto3`, `paramiko`) versus lazily-imported ones only needed for one specific feature (`jinja2`, `weasyprint`, `matplotlib` — [Reporting](docs/reporting.md)'s PDF generation).

### First login and RBAC bootstrap

On first login, whoever holds the **Owner** role in your Applivery workspace gets full Super Admin access automatically — that's the only automatic bypass. Everyone else needs a [Role](docs/settings.md#roles) created first (Settings → Roles, Super Admin only), mapping an Applivery collaborator tag to a set of permissions, or they'll be denied access entirely when they try to log in. Set this up before inviting other admins.

### Upgrading

```bash
git pull
docker compose up -d --build
```

Data persists across rebuilds via the `data/`/`pgdata/` bind mounts described above; no separate migration step is required for the SQLite-backed stores (schema is created on demand). If a release changes the Postgres schema for durable workflows, that's handled automatically by `_init_durable_workflow_schema` on startup.

### Health checks

[Settings → System Health](docs/settings.md#system-health) (inside the app, once logged in) is the fastest way to confirm every background job — the compliance scheduler, report scheduler, ticket sync, catalog refreshers, and everything else in [ARCHITECTURE.md §2.5](ARCHITECTURE.md#25-background-loops) — is actually running after a deploy. The Postgres service itself has a `pg_isready` healthcheck baked into `docker-compose.yml`, which the app service waits on before starting.

## Further reading

- [docs/](docs/) — one admin guide per view, written for the person actually using the dashboard day to day.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the frontend and backend are actually built, for developers extending the project.
