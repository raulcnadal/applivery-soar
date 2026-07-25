"""Regression coverage for a real bug: _run_compliance_evaluation used to
call get_devices_full(refresh=False, ...), which can silently reuse a
device-fleet snapshot up to DEVICES_CACHE_TTL_SECONDS (15 minutes) old —
including whatever Device Audience membership (device['deviceAudiences'])
was baked into that snapshot. An admin who creates a Device Audience in
Applivery's own console, scopes a new Compliance Policy to it via
targetDeviceAudienceId, and immediately checks results (via the
create-triggered background evaluation, or "Evaluate now") could get zero
devices in scope — indistinguishable from "this audience has no members" —
purely because the cached snapshot predates the audience/assignment.

This suite doesn't spin up a live Applivery-backed evaluation (that needs
network mocking well beyond this pure-function-focused suite's scope, per
conftest.py) — it monkeypatches main.get_devices_full to a stub that records
what `refresh` value it was called with, and asserts _run_compliance_evaluation
always requests a live pull regardless of caller (manual "Evaluate now",
the on-create immediate check, or the scheduler loop all share this one
function)."""
import asyncio
import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def slug():
    return f"test-compliance-fresh-{uuid.uuid4().hex[:12]}"


@pytest.fixture
def client(main):
    return TestClient(main.app)


def _token(main, email="admin@x.com"):
    return jwt.encode({"sub": email, "exp": int(time.time()) + 3600}, main.DASHBOARD_SECRET, algorithm="HS256")


def _dash_headers(main, email, slug):
    return {"X-Dashboard-Token": _token(main, email), "X-Workspace-Slug": slug, "Authorization": "Bearer fake-token"}


def _minimal_policy(**overrides):
    base = {
        "id": str(uuid.uuid4()),
        "name": "Freshness test policy",
        "enabled": True,
        "autoRun": False,
        "conditions": [],
        "conditionLogic": "any",
        "workflowId": None,
        "escalatedWorkflowId": None,
        "nonComplianceTag": None,
        "nonComplianceSmartAttributeId": None,
        "targetDeviceAudienceId": "aud-123",
        "autoRunTripped": False,
        "autoRunBatchCap": 15,
        "openCaseOnViolation": False,
        "autoResolveCaseOnRecovery": False,
    }
    base.update(overrides)
    return base


class TestComplianceEvaluationUsesLiveDeviceData:
    def test_evaluation_forces_a_fresh_device_fetch(self, main, slug, monkeypatch):
        main._save_compliance_policies(slug, [_minimal_policy()])

        calls = []

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            calls.append(refresh)
            return {"items": [], "total": 0}

        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        summary = asyncio.run(main._run_compliance_evaluation("Bearer fake-token", slug))

        assert calls == [True], (
            "compliance evaluation must always pass refresh=True to get_devices_full — "
            "reusing the cached fleet snapshot (up to DEVICES_CACHE_TTL_SECONDS old) can "
            "miss a Device Audience that was just created/assigned in Applivery, making "
            "targetDeviceAudienceId scoping silently resolve to zero devices"
        )
        assert summary["devicesChecked"] == 0

    def test_scheduler_due_policy_evaluation_also_forces_fresh_fetch(self, main, slug, monkeypatch):
        # Same guarantee via the policy_ids= path used by compliance_scheduler_loop
        # for "due" policies, not just the policy_ids=None "Evaluate now" path.
        policy = _minimal_policy()
        main._save_compliance_policies(slug, [policy])

        calls = []

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            calls.append(refresh)
            return {"items": [], "total": 0}

        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        asyncio.run(main._run_compliance_evaluation("Bearer fake-token", slug, policy_ids=[policy["id"]]))

        assert calls == [True]


class TestDevicesCheckedReflectsPolicyScope:
    """summary["devicesChecked"] used to be set to the whole fetched fleet
    size, regardless of each policy's own targetDeviceAudienceId scoping —
    so a policy scoped to a 2-device audience in a 5-device fleet reported
    "Checked 5 devices against 1 policy," which read as if audience scoping
    wasn't being applied at all. It's now the sum of each evaluated
    policy's actually-scoped device count instead."""

    def _fleet(self):
        return {
            "items": [
                {"id": "d1", "deviceAudiences": [{"id": "aud-ios", "name": "iOS Devices"}]},
                {"id": "d2", "deviceAudiences": [{"id": "aud-ios", "name": "iOS Devices"}]},
                {"id": "d3", "deviceAudiences": [{"id": "aud-android", "name": "Android Devices"}]},
                {"id": "d4", "deviceAudiences": []},
                {"id": "d5", "deviceAudiences": []},
            ],
            "total": 5,
        }

    def test_scoped_policy_reports_only_audience_size(self, main, slug, monkeypatch):
        policy = _minimal_policy(targetDeviceAudienceId="aud-ios")
        main._save_compliance_policies(slug, [policy])

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            return self._fleet()
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        summary = asyncio.run(main._run_compliance_evaluation("Bearer fake-token", slug))
        assert summary["devicesChecked"] == 2  # d1, d2 — not the fleet's 5

    def test_unscoped_policy_reports_whole_fleet(self, main, slug, monkeypatch):
        policy = _minimal_policy(targetDeviceAudienceId=None)
        main._save_compliance_policies(slug, [policy])

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            return self._fleet()
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        summary = asyncio.run(main._run_compliance_evaluation("Bearer fake-token", slug))
        assert summary["devicesChecked"] == 5

    def test_multiple_policies_sum_their_own_scopes(self, main, slug, monkeypatch):
        policy_a = _minimal_policy(targetDeviceAudienceId="aud-ios")
        policy_b = _minimal_policy(targetDeviceAudienceId="aud-android")
        main._save_compliance_policies(slug, [policy_a, policy_b])

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            return self._fleet()
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        summary = asyncio.run(main._run_compliance_evaluation("Bearer fake-token", slug))
        assert summary["devicesChecked"] == 3  # 2 (iOS) + 1 (Android)


class TestEvaluateNowEndpointCanTargetOnePolicy:
    """POST /api/compliance/evaluate used to always evaluate every enabled
    policy — no way to test/tune one policy's conditions without also
    re-firing every other enabled policy's autoRun workflow in the same
    workspace at the same time. It now accepts an optional policyId body
    field to scope a manual run to exactly one policy."""

    def test_no_policy_id_evaluates_every_enabled_policy(self, main, client, slug, monkeypatch):
        main._save_compliance_policies(slug, [_minimal_policy(id="p1"), _minimal_policy(id="p2")])

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            return {"items": [], "total": 0}
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        res = client.post("/api/compliance/evaluate", json={}, headers=_dash_headers(main, "admin@x.com", slug))
        assert res.status_code == 200
        assert res.json()["evaluatedPolicies"] == 2

    def test_policy_id_scopes_to_just_that_policy(self, main, client, slug, monkeypatch):
        main._save_compliance_policies(slug, [_minimal_policy(id="p1"), _minimal_policy(id="p2")])

        async def fake_get_devices_full(refresh=False, authorization=None, x_workspace_slug=None):
            return {"items": [], "total": 0}
        monkeypatch.setattr(main, "get_devices_full", fake_get_devices_full)

        res = client.post("/api/compliance/evaluate", json={"policyId": "p2"}, headers=_dash_headers(main, "admin@x.com", slug))
        assert res.status_code == 200
        assert res.json()["evaluatedPolicies"] == 1
