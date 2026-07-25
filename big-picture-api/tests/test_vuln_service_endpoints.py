"""HTTP-level regression coverage for the four Vulnerability Service routes
(GET/PUT /api/vuln-service/config, POST /api/vuln-service/test, POST
/api/vuln-service/refresh) plus the app-version self-report ingestion route
(POST /api/device-data/report-apps).

Everything else in this suite deliberately calls plain functions / async
endpoint coroutines directly rather than going through FastAPI's routing
layer (see conftest.py and test_rbac.py's module docstring) — that's a
real, intentional choice, but it means a route decorator mistake (wrong
`area`/`level`/`action` passed to require_permission, or the dependency
forgotten entirely) would never be caught. This file closes that specific
gap for the newest, most sensitive area of the app (an area that hands out
a secret token) using FastAPI's TestClient against the real `app` object —
the first file in this suite to do so.

TestClient is instantiated WITHOUT a `with` block on purpose: Starlette
only runs startup/shutdown lifespan handlers when used as a context
manager, and this app's startup handler spawns a dozen-plus
`asyncio.create_task(...)` background loops (report scheduler, installed
apps refresher, vuln service refresher, etc.) that have no place running
during a permission-gating test. Instantiating plainly and just calling
`.get/.put/.post(...)` skips lifespan entirely, confirmed empirically
(a bare request without a dashboard token returns 401 immediately, not
some cascade from a half-started app).
"""
import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def slug():
    return f"test-vulnsvc-ep-{uuid.uuid4().hex[:12]}"


@pytest.fixture
def client(main):
    return TestClient(main.app)


def _token(main, email="admin@x.com"):
    return jwt.encode({"sub": email, "exp": int(time.time()) + 3600}, main.DASHBOARD_SECRET, algorithm="HS256")


def _dash_headers(main, email, slug):
    return {"X-Dashboard-Token": _token(main, email), "X-Workspace-Slug": slug}


def _grant(main, slug, email, feature_access, risky_actions=None, is_super_admin=False):
    role = {"featureAccess": feature_access, "riskyActions": risky_actions or {}}
    main._set_cached_access(slug, email, {"allowed": True, "isSuperAdmin": is_super_admin, "role": role})


class FakeHttpxResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text or str(payload)

    def json(self):
        return self._payload


class FakeAsyncClient:
    """Stands in for httpx.AsyncClient as an async context manager, so the
    test endpoint's outbound POST to the (fake) Worker never actually hits
    the network — deterministic and fast, while still exercising the real
    endpoint code path end-to-end."""
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, **kwargs):
        return FakeHttpxResponse(200, {"mapped": True, "counts": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}, "uncertain": 0, "cve_list": []})


class TestNoDashboardToken:
    """Every one of these must 401 before ever reaching require_permission —
    confirms verify_dashboard_token is actually wired on all four routes."""

    def test_get_config_requires_token(self, client, slug):
        assert client.get("/api/vuln-service/config", headers={"X-Workspace-Slug": slug}).status_code == 401

    def test_put_config_requires_token(self, client, slug):
        assert client.put("/api/vuln-service/config", json={}, headers={"X-Workspace-Slug": slug}).status_code == 401

    def test_test_connection_requires_token(self, client, slug):
        assert client.post("/api/vuln-service/test", json={}, headers={"X-Workspace-Slug": slug}).status_code == 401

    def test_refresh_requires_token(self, client, slug):
        assert client.post("/api/vuln-service/refresh", headers={"X-Workspace-Slug": slug}).status_code == 401


class TestAccessNeverResolved:
    """Valid token, but this workspace was never resolved via
    /api/auth/resolve-access — must deny, never silently fall through to
    read-only or any other default."""

    def test_get_config_denied(self, main, client, slug):
        r = client.get("/api/vuln-service/config", headers=_dash_headers(main, "nobody@x.com", slug))
        assert r.status_code == 403
        assert "not resolved" in r.json()["detail"]


class TestReadOnlyRole:
    """area=integrations level=read — enough for GET, nothing else."""

    def test_get_config_allowed(self, main, client, slug):
        _grant(main, slug, "reader@x.com", {"integrations": "read"})
        r = client.get("/api/vuln-service/config", headers=_dash_headers(main, "reader@x.com", slug))
        assert r.status_code == 200
        assert r.json()["apiToken"] == {"set": False, "last4": None}

    def test_put_config_denied(self, main, client, slug):
        _grant(main, slug, "reader@x.com", {"integrations": "read"})
        r = client.put("/api/vuln-service/config", json={"enabled": True, "baseUrl": "https://x.example", "apiToken": "tok"},
                        headers=_dash_headers(main, "reader@x.com", slug))
        assert r.status_code == 403

    def test_test_connection_denied(self, main, client, slug):
        _grant(main, slug, "reader@x.com", {"integrations": "read"})
        r = client.post("/api/vuln-service/test", json={"baseUrl": "https://x.example", "apiToken": "tok"},
                         headers=_dash_headers(main, "reader@x.com", slug))
        assert r.status_code == 403

    def test_refresh_denied(self, main, client, slug):
        _grant(main, slug, "reader@x.com", {"integrations": "read"})
        r = client.post("/api/vuln-service/refresh", headers={**_dash_headers(main, "reader@x.com", slug), "Authorization": "Bearer fake"})
        assert r.status_code == 403


class TestManageWithoutSecretsAction:
    """integrations: manage, but the canEditIntegrationSecrets risky-action
    flag isn't granted — GET and refresh (manage-level only) should pass;
    PUT/test (which also require canEditIntegrationSecrets) must not."""

    def test_get_config_allowed(self, main, client, slug):
        _grant(main, slug, "u@x.com", {"integrations": "manage"}, risky_actions={"canEditIntegrationSecrets": False})
        r = client.get("/api/vuln-service/config", headers=_dash_headers(main, "u@x.com", slug))
        assert r.status_code == 200

    def test_put_config_denied(self, main, client, slug):
        _grant(main, slug, "u@x.com", {"integrations": "manage"}, risky_actions={"canEditIntegrationSecrets": False})
        r = client.put("/api/vuln-service/config", json={"enabled": True, "baseUrl": "https://x.example", "apiToken": "tok"},
                        headers=_dash_headers(main, "u@x.com", slug))
        assert r.status_code == 403

    def test_test_connection_denied(self, main, client, slug):
        _grant(main, slug, "u@x.com", {"integrations": "manage"}, risky_actions={"canEditIntegrationSecrets": False})
        r = client.post("/api/vuln-service/test", json={"baseUrl": "https://x.example", "apiToken": "tok"},
                         headers=_dash_headers(main, "u@x.com", slug))
        assert r.status_code == 403

    def test_refresh_reaches_business_logic_not_403(self, main, client, slug):
        # refresh only requires area=integrations level=manage — no
        # canEditIntegrationSecrets action — so this role should get PAST
        # the permission gate. It then 400s because the workspace has no
        # saved config yet, which is the correct non-403 outcome proving
        # the gate passed.
        _grant(main, slug, "u@x.com", {"integrations": "manage"}, risky_actions={"canEditIntegrationSecrets": False})
        r = client.post("/api/vuln-service/refresh", headers={**_dash_headers(main, "u@x.com", slug), "Authorization": "Bearer fake"})
        assert r.status_code == 400
        assert "not resolved" not in r.json()["detail"]


class TestFullAccess:
    """integrations: manage + canEditIntegrationSecrets — every route
    should get past its permission gate and reach real business logic."""

    def test_put_then_get_round_trips_and_redacts(self, main, client, slug, monkeypatch):
        _grant(main, slug, "admin@x.com", {"integrations": "manage"}, risky_actions={"canEditIntegrationSecrets": True})
        put_res = client.put("/api/vuln-service/config", json={
            "enabled": False, "baseUrl": "https://vuln.example.workers.dev", "apiToken": "super-secret-token-9999", "refreshIntervalHours": 12,
        }, headers=_dash_headers(main, "admin@x.com", slug))
        assert put_res.status_code == 200
        body = put_res.json()
        assert "apiTokenEncrypted" not in body
        assert "super-secret-token-9999" not in str(body)
        assert body["apiToken"] == {"set": True, "last4": "9999"}
        assert body["baseUrl"] == "https://vuln.example.workers.dev"
        assert body["refreshIntervalHours"] == 12

        get_res = client.get("/api/vuln-service/config", headers=_dash_headers(main, "admin@x.com", slug))
        assert get_res.status_code == 200
        assert get_res.json()["apiToken"] == {"set": True, "last4": "9999"}
        assert "super-secret-token-9999" not in get_res.text

    def test_put_with_blank_token_keeps_existing_one(self, main, client, slug):
        _grant(main, slug, "admin@x.com", {"integrations": "manage"}, risky_actions={"canEditIntegrationSecrets": True})
        client.put("/api/vuln-service/config", json={"enabled": False, "baseUrl": "https://a.example", "apiToken": "original-token"},
                    headers=_dash_headers(main, "admin@x.com", slug))
        r2 = client.put("/api/vuln-service/config", json={"enabled": True, "baseUrl": "https://b.example", "apiToken": ""},
                         headers=_dash_headers(main, "admin@x.com", slug))
        assert r2.status_code == 200
        assert r2.json()["apiToken"]["set"] is True
        assert r2.json()["baseUrl"] == "https://b.example"
        stored = main._load_vuln_service_config(slug)
        assert main._vuln_service_decrypt_token(stored) == "original-token"

    def test_connection_test_reaches_worker_call(self, main, client, slug, monkeypatch):
        monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
        _grant(main, slug, "admin@x.com", {"integrations": "manage"}, risky_actions={"canEditIntegrationSecrets": True})
        r = client.post("/api/vuln-service/test", json={"baseUrl": "https://vuln.example.workers.dev", "apiToken": "tok-123"},
                         headers=_dash_headers(main, "admin@x.com", slug))
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_connection_test_falls_back_to_saved_token_when_blank(self, main, client, slug, monkeypatch):
        monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
        _grant(main, slug, "admin@x.com", {"integrations": "manage"}, risky_actions={"canEditIntegrationSecrets": True})
        client.put("/api/vuln-service/config", json={"enabled": True, "baseUrl": "https://saved.example", "apiToken": "saved-token"},
                    headers=_dash_headers(main, "admin@x.com", slug))
        r = client.post("/api/vuln-service/test", json={"baseUrl": "https://saved.example", "apiToken": ""},
                         headers=_dash_headers(main, "admin@x.com", slug))
        assert r.status_code == 200

    def test_refresh_400s_on_unconfigured_workspace_not_403(self, main, client, slug):
        _grant(main, slug, "admin@x.com", {"integrations": "manage"}, risky_actions={"canEditIntegrationSecrets": True})
        r = client.post("/api/vuln-service/refresh", headers={**_dash_headers(main, "admin@x.com", slug), "Authorization": "Bearer fake"})
        assert r.status_code == 400


class TestSuperAdminBypass:
    def test_super_admin_reaches_every_route_regardless_of_role(self, main, client, slug, monkeypatch):
        monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
        main._set_cached_access(slug, "owner@x.com", {"allowed": True, "isSuperAdmin": True, "role": None})
        headers = _dash_headers(main, "owner@x.com", slug)
        assert client.get("/api/vuln-service/config", headers=headers).status_code == 200
        assert client.put("/api/vuln-service/config", json={"enabled": False, "baseUrl": "https://x.example", "apiToken": "t"}, headers=headers).status_code == 200
        assert client.post("/api/vuln-service/test", json={"baseUrl": "https://x.example", "apiToken": "t"}, headers=headers).status_code == 200
        assert client.post("/api/vuln-service/refresh", headers={**headers, "Authorization": "Bearer fake"}).status_code == 400  # not enabled yet, but past the gate


class TestDeviceAppReportIngestion:
    """POST /api/device-data/report-apps — the self-report webhook the
    macOS/Windows scripts POST to. Confirms the new `version` field (added
    alongside identifier/name — see report-installed-apps.sh/.ps1) actually
    makes it into the installed-apps store in the same {identifier, name,
    version} shape the MDM-sourced path writes, since that's what makes the
    Vulnerability Service's app matching source-agnostic."""

    def _seed_secret(self, main, slug, secret="test-device-report-secret"):
        main._save_device_report_secrets({slug: {"secret": secret}})
        return secret

    def test_requires_secret_header(self, main, client, slug):
        self._seed_secret(main, slug)
        r = client.post("/api/device-data/report-apps", json={"platform": "windows", "serialNumber": "SN123", "apps": []},
                         headers={"X-Workspace-Slug": slug})
        assert r.status_code == 401

    def test_unconfigured_workspace_fails_closed(self, main, client, slug):
        r = client.post("/api/device-data/report-apps", json={"platform": "windows", "serialNumber": "SN123", "apps": []},
                         headers={"X-Workspace-Slug": slug, "X-Device-Report-Secret": "whatever"})
        assert r.status_code == 503

    def test_apps_with_versions_land_in_versioned_apps_list(self, main, client, slug):
        secret = self._seed_secret(main, slug)
        # No cached device list, so this lands in the pending buffer keyed
        # by serial — still lets us assert the record shape directly.
        r = client.post("/api/device-data/report-apps", json={
            "platform": "windows", "serialNumber": "SN-WIN-1",
            "apps": [
                {"identifier": "Mozilla.Firefox", "name": "Mozilla Firefox", "version": "128.0.1"},
                {"identifier": "SomeVendor.NoVersionTool", "name": "No Version Tool"},  # no version reported
            ],
            "agentVersion": "report-installed-apps.ps1/1.1",
        }, headers={"X-Workspace-Slug": slug, "X-Device-Report-Secret": secret})
        assert r.status_code == 200

        pending = main._load_pending_app_reports(slug)
        record = pending["SN-WIN-1"]
        assert record["identifiers"] == ["mozilla.firefox", "somevendor.noversiontool"]
        assert record["apps"] == [{"identifier": "mozilla.firefox", "name": "Mozilla Firefox", "version": "128.0.1"}]

    def test_macos_apps_with_versions_land_in_versioned_apps_list(self, main, client, slug):
        secret = self._seed_secret(main, slug)
        r = client.post("/api/device-data/report-apps", json={
            "platform": "macos", "serialNumber": "SN-MAC-1",
            "apps": [{"identifier": "com.apple.Safari", "name": "Safari", "version": "17.4"}],
            "agentVersion": "report-installed-apps.sh/1.1",
        }, headers={"X-Workspace-Slug": slug, "X-Device-Report-Secret": secret})
        assert r.status_code == 200
        record = main._load_pending_app_reports(slug)["SN-MAC-1"]
        assert record["apps"] == [{"identifier": "com.apple.safari", "name": "Safari", "version": "17.4"}]
