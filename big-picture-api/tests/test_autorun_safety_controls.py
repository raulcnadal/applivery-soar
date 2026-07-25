"""Regression coverage for the two autoRun safety-control additions:

1. CompliancePolicyPayload.autoRunBatchCap's "no limit" sentinel — a policy
   can now opt into an uncapped autoRun pass via an explicit `None`, resolved
   for enforcement by the pure helper `_resolve_autorun_batch_cap`. Missing
   key, positive int, None, and 0/negative are all exercised, matching the
   exact semantics documented on that function (see main.py).
2. WorkflowPayload.allowUnattendedDestructive — an author-level, non-gating
   flag surfaced on a workflow so Policy/Rule editors can pre-fill their own
   independent acknowledgment checkbox. This suite confirms it defaults to
   False, and that it round-trips correctly through create/update via the
   real HTTP routes (no RBAC gate exists on these two routes today, so only
   dashboard-token presence is exercised, mirroring test_firewall_rulesets.py
   / test_vuln_service_endpoints.py's TestClient pattern).

Crucially, this suite also asserts what these two features deliberately do
NOT do: setting allowUnattendedDestructive=True on a workflow must not by
itself flip _workflow_has_destructive_step's *consumers* (autoRunDestructiveAck
on a policy/rule) — that field remains independently required, unaffected by
this flag. That invariant is the whole reason the feature was designed as an
"additional layer" rather than an authoritative bypass.
"""
import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def slug():
    return f"test-autorun-{uuid.uuid4().hex[:12]}"


@pytest.fixture
def client(main):
    return TestClient(main.app)


def _token(main, email="admin@x.com"):
    return jwt.encode({"sub": email, "exp": int(time.time()) + 3600}, main.DASHBOARD_SECRET, algorithm="HS256")


def _dash_headers(main, email, slug):
    return {"X-Dashboard-Token": _token(main, email), "X-Workspace-Slug": slug}


def _workflow_payload(**overrides):
    base = {
        "name": "Test workflow",
        "description": "",
        "steps": [],
        "targetPlatform": None,
        "targetDeploymentModel": None,
    }
    base.update(overrides)
    return base


class TestResolveAutorunBatchCap:
    """Pure-function coverage for _resolve_autorun_batch_cap, matching the
    codebase's convention of testing pure functions directly rather than
    driving the heavy async _run_compliance_evaluation for this logic."""

    def test_missing_key_defaults_to_15(self, main):
        assert main._resolve_autorun_batch_cap({}) == 15

    def test_explicit_positive_int_passes_through(self, main):
        assert main._resolve_autorun_batch_cap({"autoRunBatchCap": 5}) == 5
        assert main._resolve_autorun_batch_cap({"autoRunBatchCap": 250}) == 250

    def test_explicit_none_means_unlimited(self, main):
        assert main._resolve_autorun_batch_cap({"autoRunBatchCap": None}) is None

    def test_zero_falls_back_to_default(self, main):
        assert main._resolve_autorun_batch_cap({"autoRunBatchCap": 0}) == 15

    def test_negative_falls_back_to_default(self, main):
        assert main._resolve_autorun_batch_cap({"autoRunBatchCap": -3}) == 15

    def test_default_matches_pydantic_model_default(self, main):
        # CompliancePolicyPayload.autoRunBatchCap's own default (15) should
        # stay in lockstep with this helper's "missing key" behavior.
        payload = main.CompliancePolicyPayload(name="p", conditions=[])
        assert payload.autoRunBatchCap == 15
        assert main._resolve_autorun_batch_cap({}) == payload.autoRunBatchCap


class TestWorkflowAllowUnattendedDestructiveDefault:
    def test_defaults_false_when_omitted(self, main):
        payload = main.WorkflowPayload(name="wf")
        assert payload.allowUnattendedDestructive is False

    def test_explicit_true_is_honored(self, main):
        payload = main.WorkflowPayload(name="wf", allowUnattendedDestructive=True)
        assert payload.allowUnattendedDestructive is True


class TestWorkflowAllowUnattendedDestructiveRoundTrip:
    """HTTP-level round trip through the real create/update routes. These
    routes have no require_permission(...) RBAC gate (unlike /api/vuln-service
    or /api/firewall) — only a valid X-Dashboard-Token is required — so unlike
    those sibling suites there's no permission-denial branch to cover here."""

    def test_create_persists_flag(self, main, client, slug):
        res = client.post("/api/workflows", json=_workflow_payload(allowUnattendedDestructive=True),
                           headers=_dash_headers(main, "admin@x.com", slug))
        assert res.status_code == 200
        body = res.json()
        assert body["allowUnattendedDestructive"] is True
        assert body["id"]

        # And it's actually persisted to the store, not just echoed back.
        stored = main._load_workflows(slug)
        match = next(w for w in stored if w["id"] == body["id"])
        assert match["allowUnattendedDestructive"] is True

    def test_create_without_flag_defaults_false(self, main, client, slug):
        res = client.post("/api/workflows", json=_workflow_payload(),
                           headers=_dash_headers(main, "admin@x.com", slug))
        assert res.status_code == 200
        assert res.json()["allowUnattendedDestructive"] is False

    def test_update_can_flip_flag_on(self, main, client, slug):
        create_res = client.post("/api/workflows", json=_workflow_payload(allowUnattendedDestructive=False),
                                  headers=_dash_headers(main, "admin@x.com", slug))
        workflow_id = create_res.json()["id"]

        update_res = client.put(f"/api/workflows/{workflow_id}",
                                 json=_workflow_payload(allowUnattendedDestructive=True),
                                 headers=_dash_headers(main, "admin@x.com", slug))
        assert update_res.status_code == 200
        assert update_res.json()["allowUnattendedDestructive"] is True

        stored = main._load_workflows(slug)
        match = next(w for w in stored if w["id"] == workflow_id)
        assert match["allowUnattendedDestructive"] is True

    def test_update_can_flip_flag_off(self, main, client, slug):
        create_res = client.post("/api/workflows", json=_workflow_payload(allowUnattendedDestructive=True),
                                  headers=_dash_headers(main, "admin@x.com", slug))
        workflow_id = create_res.json()["id"]

        update_res = client.put(f"/api/workflows/{workflow_id}",
                                 json=_workflow_payload(allowUnattendedDestructive=False),
                                 headers=_dash_headers(main, "admin@x.com", slug))
        assert update_res.status_code == 200
        assert update_res.json()["allowUnattendedDestructive"] is False

    def test_no_dashboard_token_rejected(self, main, client, slug):
        res = client.post("/api/workflows", json=_workflow_payload())
        assert res.status_code in (401, 403)


class TestAllowUnattendedDestructiveDoesNotBypassConsumerAck:
    """The design invariant confirmed with the user: this flag is an
    additional, non-authoritative layer. It must never make
    _workflow_has_destructive_step's consumers (autoRunDestructiveAck on a
    policy/rule) unnecessary — that independent acknowledgment is still what
    actually gates autoRun. This test proves the workflow-level flag has no
    effect on _workflow_has_destructive_step's own return value, since that
    function is the thing every consumer's enforcement check is built on."""

    def test_destructive_step_detection_ignores_the_new_flag(self, main):
        destructive_action_key = next(
            key for key, cfg in main.MDM_ACTIONS.items() if cfg.get('destructive')
        )
        workflow_flag_true = {
            "allowUnattendedDestructive": True,
            "steps": [{"type": "mdm_action", "config": {"action": destructive_action_key}}],
        }
        workflow_flag_false = {
            "allowUnattendedDestructive": False,
            "steps": [{"type": "mdm_action", "config": {"action": destructive_action_key}}],
        }
        # Same destructive-step verdict regardless of the new flag's value —
        # it's informational for pre-filling the UI, not an enforcement input.
        assert main._workflow_has_destructive_step(workflow_flag_true) is True
        assert main._workflow_has_destructive_step(workflow_flag_false) is True
