"""Coverage for GET /api/device-audiences/{audience_id}/matched-devices —
the endpoint backing the Compliance Policy Builder's "devices that will
receive this policy" box (see PolicyBuilder.jsx). This exists specifically
so an admin can confirm, before saving a policy, that a selected Device
Audience actually resolves to the devices they expect — after the Device
Audience linkage bug (wrong preview API call, see
_fetch_device_audience_membership_map) made that invisible for a while.

The endpoint deliberately reuses get_devices_full's own `deviceAudiences`
field rather than re-deriving membership independently, so this suite
monkeypatches get_devices_full (same pattern as
test_compliance_evaluation_freshness.py) instead of mocking the Applivery
HTTP layer directly for the "devices found" path — what's under test there
is the filtering/shaping logic and the refresh=True freshness guarantee,
not membership resolution itself (that's test_device_audience_membership.py's
job).

When zero devices match, the endpoint makes one extra, independent live
call (_diagnose_device_audience_preview) so an admin can see WHY — this
exists precisely because "the fix" reported as done in an earlier round
still showed zero devices for a real, non-empty audience, with no way to
tell whether that was a permissions issue, a wrong audience id, an id-space
resolution gap, or a genuinely empty audience without server log access.
TestMatchedDevicesEndpointDiagnostics covers that path, mocking
main._applivery_call directly (same FakeApplHttpResponse pattern as
test_device_audience_membership.py) since it's a real, separate HTTP call.
"""
import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(main):
    return TestClient(main.app)


def _token(main, email="admin@x.com"):
    return jwt.encode({"sub": email, "exp": int(time.time()) + 3600}, main.DASHBOARD_SECRET, algorithm="HS256")


def _dash_headers(main, email, slug):
    return {"X-Dashboard-Token": _token(main, email), "X-Workspace-Slug": slug, "Authorization": "Bearer fake-token"}


def _device(id, audiences=None, **overrides):
    d = {
        "id": id, "displayName": f"Device {id}", "platform": "apple", "platformLabel": "iOS/iPadOS/tvOS",
        "isCompliant": True, "state": "active", "deviceAudiences": audiences or [],
    }
    d.update(overrides)
    return d


class FakeApplHttpResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


@pytest.fixture
def stub_no_diagnostics_network_calls(monkeypatch, main):
    """For tests where `matched` is non-empty (no diagnostics call should
    happen at all) or where the diagnostics path itself isn't under test —
    monkeypatches _resolve_org_base and _applivery_call to fail loudly if
    hit, so a regression that starts calling out to the real network gets
    caught immediately instead of hanging/timing out in CI."""
    async def fail_org_base(client, headers, x_workspace_slug):
        raise AssertionError("did not expect a live Applivery call in this test")

    async def fail_applivery_call(client, method, url, headers=None, **kwargs):
        raise AssertionError("did not expect a live Applivery call in this test")

    monkeypatch.setattr(main, "_resolve_org_base", fail_org_base)
    monkeypatch.setattr(main, "_applivery_call", fail_applivery_call)


class TestMatchedDevicesEndpoint:
    def test_returns_only_devices_in_the_requested_audience(self, main, client, monkeypatch, stub_no_diagnostics_network_calls):
        slug = f"test-matched-devices-{uuid.uuid4().hex[:12]}"

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            return {"items": [
                _device("d1", audiences=[{"id": "aud-ios", "name": "iOS Devices"}]),
                _device("d2", audiences=[{"id": "aud-ios", "name": "iOS Devices"}]),
                _device("d3", audiences=[{"id": "aud-android", "name": "Android Devices"}]),
                _device("d4", audiences=[]),
            ]}
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        res = client.get("/api/device-audiences/aud-ios/matched-devices", headers=_dash_headers(main, "admin@x.com", slug))
        assert res.status_code == 200
        body = res.json()
        assert body["total"] == 2
        assert {d["id"] for d in body["items"]} == {"d1", "d2"}
        assert body["diagnostics"] is None  # matches were found — no extra live call needed

    def test_response_shape_carries_display_fields(self, main, client, monkeypatch, stub_no_diagnostics_network_calls):
        slug = f"test-matched-devices-{uuid.uuid4().hex[:12]}"

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            return {"items": [_device("d1", audiences=[{"id": "aud1", "name": "A"}], displayName="iPhone of Raul", platform="apple", platformLabel="iOS/iPadOS/tvOS", isCompliant=False, state="active")]}
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        res = client.get("/api/device-audiences/aud1/matched-devices", headers=_dash_headers(main, "admin@x.com", slug))
        item = res.json()["items"][0]
        assert item == {
            "id": "d1", "displayName": "iPhone of Raul", "platform": "apple",
            "platformLabel": "iOS/iPadOS/tvOS", "isCompliant": False, "state": "active",
        }

    def test_forces_a_fresh_device_fetch(self, main, client, monkeypatch):
        # Same staleness guarantee as _run_compliance_evaluation — an
        # audience assignment made moments ago must be visible here
        # immediately, not after the cache TTL. matched is empty here, so
        # also stub the diagnostics call's HTTP layer rather than asserting
        # it's never hit.
        slug = f"test-matched-devices-{uuid.uuid4().hex[:12]}"
        calls = []

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            calls.append(refresh)
            return {"items": []}
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        async def fake_applivery_call(client, method, url, headers=None, **kwargs):
            return FakeApplHttpResponse(500, {"error": "irrelevant to this test"})
        monkeypatch.setattr(main, "_applivery_call", fake_applivery_call)

        client.get("/api/device-audiences/aud1/matched-devices", headers=_dash_headers(main, "admin@x.com", slug))
        assert calls == [True]

    def test_requires_dashboard_token(self, client):
        res = client.get("/api/device-audiences/aud1/matched-devices")
        assert res.status_code in (401, 403)


class TestMatchedDevicesEndpointDiagnostics:
    """When the aggregate pipeline (get_devices_full's deviceAudiences
    field) finds zero matched devices, the endpoint makes one extra, direct
    GET .../device-audiences/{id}/preview call and surfaces the raw result —
    this is what lets an admin (or whoever's debugging next) tell a
    permissions/HTTP problem apart from a genuine id-space resolution gap
    apart from a genuinely empty audience, without server log access."""

    def test_no_diagnostics_call_when_devices_were_found(self, main, client, monkeypatch, stub_no_diagnostics_network_calls):
        slug = f"test-matched-devices-diag-{uuid.uuid4().hex[:12]}"

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            return {"items": [_device("d1", audiences=[{"id": "aud1", "name": "A"}])]}
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        res = client.get("/api/device-audiences/aud1/matched-devices", headers=_dash_headers(main, "admin@x.com", slug))
        assert res.json()["diagnostics"] is None

    def test_diagnostics_surfaces_http_error(self, main, client, monkeypatch):
        slug = f"test-matched-devices-diag-{uuid.uuid4().hex[:12]}"

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            return {"items": []}
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        async def fake_resolve_org_base(client, headers, x_workspace_slug):
            return "https://api.applivery.io/v1/organizations/org123"
        monkeypatch.setattr(main, "_resolve_org_base", fake_resolve_org_base)

        async def fake_applivery_call(client, method, url, headers=None, **kwargs):
            assert method == "GET"
            assert url == "https://api.applivery.io/v1/organizations/org123/mdm/device-audiences/aud1/preview"
            return FakeApplHttpResponse(403, {"error": {"code": 4003, "message": "Forbidden"}})
        monkeypatch.setattr(main, "_applivery_call", fake_applivery_call)

        res = client.get("/api/device-audiences/aud1/matched-devices", headers=_dash_headers(main, "admin@x.com", slug))
        diag = res.json()["diagnostics"]
        assert diag["httpStatus"] == 403
        assert "Forbidden" in diag["error"]
        assert diag["rawMemberCount"] == 0

    def test_diagnostics_surfaces_raw_members_even_when_aggregate_found_none(self, main, client, monkeypatch):
        # This is the exact "smoking gun" case that was actually live: the
        # real Applivery response returns real members for the audience
        # (flat `items`, confirmed against a real tenant's curl output —
        # NOT the emmDevices/admDevices/winDevices/aosDevices split
        # Applivery's OpenAPI reference documents), but get_devices_full's
        # aggregate resolution still produced zero matches BEFORE the parsing
        # fix — proving the gap was response-shape parsing, not a
        # misconfigured/empty audience or a permissions issue.
        slug = f"test-matched-devices-diag-{uuid.uuid4().hex[:12]}"

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            return {"items": []}
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        async def fake_resolve_org_base(client, headers, x_workspace_slug):
            return "https://api.applivery.io/v1/organizations/org123"
        monkeypatch.setattr(main, "_resolve_org_base", fake_resolve_org_base)

        async def fake_applivery_call(client, method, url, headers=None, **kwargs):
            return FakeApplHttpResponse(200, {"data": {
                "items": [
                    {"id": "69ebf014966a764cef5f763a", "displayName": "iPhone 14 Pro Max", "deviceType": "apple", "state": "ACTIVE", "summary": {}},
                    {"id": "68935dab52ee7163395f4328", "displayName": "MI Exchange User", "deviceType": "apple", "state": "ACTIVE", "summary": {}},
                ],
                "totalDocs": 2, "limit": 100, "page": 1, "totalPages": 1, "hasPrevPage": False, "hasNextPage": False,
            }})
        monkeypatch.setattr(main, "_applivery_call", fake_applivery_call)

        res = client.get("/api/device-audiences/aud1/matched-devices", headers=_dash_headers(main, "admin@x.com", slug))
        diag = res.json()["diagnostics"]
        assert diag["httpStatus"] == 200
        assert diag["rawMemberCount"] == 2
        assert diag["totalDocs"] == 2
        assert {m["id"] for m in diag["rawMembers"]} == {"69ebf014966a764cef5f763a", "68935dab52ee7163395f4328"}
        assert all(m["platformKey"] == "apple" for m in diag["rawMembers"])

    def test_diagnostics_reports_genuinely_empty_audience(self, main, client, monkeypatch):
        slug = f"test-matched-devices-diag-{uuid.uuid4().hex[:12]}"

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            return {"items": []}
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        async def fake_resolve_org_base(client, headers, x_workspace_slug):
            return "https://api.applivery.io/v1/organizations/org123"
        monkeypatch.setattr(main, "_resolve_org_base", fake_resolve_org_base)

        async def fake_applivery_call(client, method, url, headers=None, **kwargs):
            return FakeApplHttpResponse(200, {"data": {"items": [], "totalDocs": 0, "limit": 100, "page": 1, "totalPages": 0, "hasPrevPage": False, "hasNextPage": False}})
        monkeypatch.setattr(main, "_applivery_call", fake_applivery_call)

        res = client.get("/api/device-audiences/aud1/matched-devices", headers=_dash_headers(main, "admin@x.com", slug))
        diag = res.json()["diagnostics"]
        assert diag["httpStatus"] == 200
        assert diag["error"] is None
        assert diag["rawMemberCount"] == 0
        assert diag["totalDocs"] == 0
        assert diag["rawMembers"] == []
