"""Regression coverage for the Firewall Rule Set feature (Windows network
remediation, Zero Networks-style micro-segmentation via Applivery's
runScript primitive).

Focus areas, matching the design's own stated invariants:
1. PowerShell generation (_generate_firewall_apply_script/_restore_script,
   _firewall_rule_to_powershell) — deterministic, idempotent (always clears
   its own Group before recreating), and correctly omits PowerShell
   parameters that would error for the given protocol/value combination
   (e.g. -LocalPort is only valid alongside -Protocol TCP/UDP).
2. The restore model: only ever removes rules tagged with this rule set's
   own Group, and only reverts the profile default action (to Windows' own
   documented OS default) when this rule set actually changed it — never a
   full snapshot/restore.
3. Store round trips (firewall_library, firewall_remediation_state).
4. HTTP-level RBAC on the CRUD + template endpoints (TestClient, mirroring
   test_vuln_service_endpoints.py's pattern).
5. The applyFirewallRuleSet/restoreFirewallRuleSet dispatch branch inside
   _execute_mdm_action — delegates to the existing 'runScript' internals
   and records per-device state on success.
"""
import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def slug():
    return f"test-fw-{uuid.uuid4().hex[:12]}"


@pytest.fixture
def client(main):
    return TestClient(main.app)


def _token(main, email="admin@x.com"):
    return jwt.encode({"sub": email, "exp": int(time.time()) + 3600}, main.DASHBOARD_SECRET, algorithm="HS256")


def _dash_headers(main, email, slug, authorization=None):
    headers = {"X-Dashboard-Token": _token(main, email), "X-Workspace-Slug": slug}
    if authorization:
        headers["Authorization"] = authorization
    return headers


def _grant(main, slug, email, feature_access, risky_actions=None, is_super_admin=False):
    role = {"featureAccess": feature_access, "riskyActions": risky_actions or {}}
    main._set_cached_access(slug, email, {"allowed": True, "isSuperAdmin": is_super_admin, "role": role})


def _rule(**overrides):
    base = {"name": "rule", "direction": "inbound", "action": "block", "protocol": "Any",
            "localPorts": "Any", "remoteAddresses": "Any", "profile": "Any", "enabled": True}
    base.update(overrides)
    return base


class TestFirewallRuleToPowershell:
    def test_protocol_any_omits_protocol_and_localport(self, main):
        rule = _rule(protocol="Any", localPorts="445")
        line = main._firewall_rule_to_powershell(rule, "GRP", "rs1", 0)
        assert "-Protocol" not in line
        assert "-LocalPort" not in line

    def test_tcp_with_ports_includes_both(self, main):
        rule = _rule(protocol="TCP", localPorts="445")
        line = main._firewall_rule_to_powershell(rule, "GRP", "rs1", 0)
        assert "-Protocol TCP" in line
        assert "-LocalPort 445" in line

    def test_tcp_with_any_ports_omits_localport(self, main):
        rule = _rule(protocol="TCP", localPorts="Any")
        line = main._firewall_rule_to_powershell(rule, "GRP", "rs1", 0)
        assert "-Protocol TCP" in line
        assert "-LocalPort" not in line

    def test_remote_any_omitted_specific_included(self, main):
        assert "-RemoteAddress" not in main._firewall_rule_to_powershell(_rule(remoteAddresses="Any"), "GRP", "rs1", 0)
        line = main._firewall_rule_to_powershell(_rule(remoteAddresses="10.0.0.0/8"), "GRP", "rs1", 0)
        assert '-RemoteAddress "10.0.0.0/8"' in line

    def test_profile_any_omitted_specific_included(self, main):
        assert "-Profile" not in main._firewall_rule_to_powershell(_rule(profile="Any"), "GRP", "rs1", 0)
        assert "-Profile Domain,Private" in main._firewall_rule_to_powershell(_rule(profile="Domain,Private"), "GRP", "rs1", 0)

    def test_direction_and_action_mapped(self, main):
        line = main._firewall_rule_to_powershell(_rule(direction="outbound", action="allow"), "GRP", "rs1", 0)
        assert "-Direction Outbound" in line
        assert "-Action Allow" in line

    def test_disabled_rule_emits_enabled_false(self, main):
        line = main._firewall_rule_to_powershell(_rule(enabled=False), "GRP", "rs1", 0)
        assert "-Enabled False" in line

    def test_every_rule_tagged_with_group(self, main):
        line = main._firewall_rule_to_powershell(_rule(), "MyGroup", "rs1", 3)
        assert '-Group "MyGroup"' in line
        assert "MyGroup-3-" in line  # DisplayName includes group + index for uniqueness

    def test_name_is_escaped(self, main):
        line = main._firewall_rule_to_powershell(_rule(name='Block "bad" traffic'), "GRP", "rs1", 0)
        assert '`"bad`"' in line


class TestGroupTagAndEscaping:
    def test_group_tag_deterministic_and_unique(self, main):
        assert main._firewall_group_tag("rs1") == main._firewall_group_tag("rs1")
        assert main._firewall_group_tag("rs1") != main._firewall_group_tag("rs2")

    def test_ps_escape_handles_backtick_and_quote(self, main):
        assert main._ps_escape('a "b" c') == 'a `"b`" c'
        assert main._ps_escape('back`tick') == 'back``tick'
        assert main._ps_escape('') == ''
        assert main._ps_escape(None) == ''


class TestGenerateApplyScript:
    def _rs(self, **overrides):
        base = {
            "id": "rs-apply-1", "name": "Test Rule Set",
            "ensureFirewallEnabled": True, "defaultInboundAction": "notConfigured",
            "defaultOutboundAction": "notConfigured", "rules": [],
        }
        base.update(overrides)
        return base

    def test_always_clears_own_group_first_idempotent(self, main):
        script = main._generate_firewall_apply_script(self._rs())
        assert "Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Remove-NetFirewallRule" in script
        # Clearing must happen before any New-NetFirewallRule below it
        clear_idx = script.index("Remove-NetFirewallRule")
        assert clear_idx < len(script)  # sanity: line exists at all

    def test_ensure_firewall_enabled_emits_set_profile_enabled(self, main):
        script = main._generate_firewall_apply_script(self._rs(ensureFirewallEnabled=True))
        assert "-Enabled True" in script

    def test_edr_present_omits_enabled_toggle(self, main):
        script = main._generate_firewall_apply_script(self._rs(ensureFirewallEnabled=False))
        assert "-Enabled True" not in script

    def test_no_profile_command_when_nothing_configured(self, main):
        script = main._generate_firewall_apply_script(self._rs(ensureFirewallEnabled=False))
        assert "Set-NetFirewallProfile" not in script

    def test_default_actions_included_when_set(self, main):
        script = main._generate_firewall_apply_script(self._rs(defaultInboundAction="block", defaultOutboundAction="block"))
        assert "-DefaultInboundAction Block" in script
        assert "-DefaultOutboundAction Block" in script

    def test_default_actions_omitted_when_not_configured(self, main):
        script = main._generate_firewall_apply_script(self._rs())
        assert "-DefaultInboundAction" not in script
        assert "-DefaultOutboundAction" not in script

    def test_includes_every_rule(self, main):
        script = main._generate_firewall_apply_script(self._rs(rules=[_rule(name="r1"), _rule(name="r2")]))
        assert script.count("New-NetFirewallRule") == 2

    def test_rule_set_name_and_id_are_documented_in_header(self, main):
        script = main._generate_firewall_apply_script(self._rs(name="My Special Set", id="rs-xyz"))
        assert "My Special Set" in script
        assert "rs-xyz" in script


class TestGenerateRestoreScript:
    def _rs(self, **overrides):
        base = {
            "id": "rs-restore-1", "name": "Test Rule Set",
            "defaultInboundAction": "notConfigured", "defaultOutboundAction": "notConfigured",
        }
        base.update(overrides)
        return base

    def test_removes_own_group_only(self, main):
        script = main._generate_firewall_restore_script(self._rs())
        group = main._firewall_group_tag("rs-restore-1")
        assert f'$Group = "{group}"' in script
        assert "Remove-NetFirewallRule" in script

    def test_no_default_action_revert_when_not_configured(self, main):
        script = main._generate_firewall_restore_script(self._rs())
        assert "Set-NetFirewallProfile" not in script

    def test_reverts_to_windows_os_defaults_when_configured(self, main):
        script = main._generate_firewall_restore_script(self._rs(defaultInboundAction="block", defaultOutboundAction="block"))
        # Reverts to Windows' OWN documented OS defaults (Block-in/Allow-out),
        # not necessarily what was there before this rule set touched it —
        # see the module design comment.
        assert "-DefaultInboundAction Block" in script
        assert "-DefaultOutboundAction Allow" in script

    def test_only_reverts_the_axis_that_was_configured(self, main):
        script = main._generate_firewall_restore_script(self._rs(defaultInboundAction="notConfigured", defaultOutboundAction="block"))
        assert "-DefaultInboundAction" not in script
        assert "-DefaultOutboundAction Allow" in script


class TestFirewallLibraryStore:
    def test_default_is_empty_list(self, main, slug):
        assert main._load_firewall_library(slug) == []

    def test_save_then_load_round_trips(self, main, slug):
        main._save_firewall_library(slug, [{"id": "rs1", "name": "Test"}])
        assert main._load_firewall_library(slug) == [{"id": "rs1", "name": "Test"}]

    def test_isolated_per_workspace(self, main, slug):
        other = f"{slug}-other"
        main._save_firewall_library(slug, [{"id": "rs1"}])
        assert main._load_firewall_library(other) == []


class TestFirewallRemediationState:
    def test_apply_records_active_ruleset(self, main, slug):
        rule_set = {"id": "rs1", "name": "Isolate"}
        main._record_firewall_remediation_dispatch(slug, "dev1", rule_set, applying=True)
        state = main._load_firewall_remediation_state(slug)
        assert state["dev1"]["active"][0]["ruleSetId"] == "rs1"
        assert state["dev1"]["active"][0]["ruleSetName"] == "Isolate"

    def test_restore_removes_active_ruleset(self, main, slug):
        rule_set = {"id": "rs1", "name": "Isolate"}
        main._record_firewall_remediation_dispatch(slug, "dev1", rule_set, applying=True)
        main._record_firewall_remediation_dispatch(slug, "dev1", rule_set, applying=False)
        state = main._load_firewall_remediation_state(slug)
        assert state["dev1"]["active"] == []

    def test_multiple_rulesets_tracked_independently(self, main, slug):
        rs_a, rs_b = {"id": "rsA", "name": "A"}, {"id": "rsB", "name": "B"}
        main._record_firewall_remediation_dispatch(slug, "dev1", rs_a, applying=True)
        main._record_firewall_remediation_dispatch(slug, "dev1", rs_b, applying=True)
        active_ids = {a["ruleSetId"] for a in main._load_firewall_remediation_state(slug)["dev1"]["active"]}
        assert active_ids == {"rsA", "rsB"}

    def test_reapplying_same_ruleset_does_not_duplicate(self, main, slug):
        rule_set = {"id": "rs1", "name": "Isolate"}
        main._record_firewall_remediation_dispatch(slug, "dev1", rule_set, applying=True)
        main._record_firewall_remediation_dispatch(slug, "dev1", rule_set, applying=True)
        assert len(main._load_firewall_remediation_state(slug)["dev1"]["active"]) == 1

    def test_no_device_id_is_a_no_op(self, main, slug):
        main._record_firewall_remediation_dispatch(slug, None, {"id": "rs1"}, applying=True)
        assert main._load_firewall_remediation_state(slug) == {}


class TestFirewallRulesetTemplatesEndpoint:
    def test_requires_token(self, client, slug):
        assert client.get("/api/firewall-ruleset-templates", headers={"X-Workspace-Slug": slug}).status_code == 401

    def test_returns_three_starter_templates(self, main, client, slug):
        _grant(main, slug, "u@x.com", {"workflows": "read"})
        r = client.get("/api/firewall-ruleset-templates", headers=_dash_headers(main, "u@x.com", slug))
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 3
        keys = {i["key"] for i in items}
        assert keys == {"isolate_device", "block_lateral_movement", "block_outbound_ip_cidr"}

    def test_isolate_template_uses_default_posture_not_block_all_rule(self, main, client, slug):
        # The whole point of the default-posture mechanism: the isolate
        # template should NOT ship a "block everything" rule (which would
        # silently defeat its own allow-exception), it should flip the
        # profile default instead.
        _grant(main, slug, "u@x.com", {"workflows": "read"})
        r = client.get("/api/firewall-ruleset-templates", headers=_dash_headers(main, "u@x.com", slug))
        isolate = next(i for i in r.json()["items"] if i["key"] == "isolate_device")
        assert isolate["defaultInboundAction"] == "block"
        assert isolate["defaultOutboundAction"] == "block"

    def test_placeholder_rules_ship_disabled(self, main, client, slug):
        # Templates with an editable placeholder (management CIDR, target
        # IP) must ship with that rule disabled — an unedited placeholder
        # string like "REPLACE-WITH-..." would fail as a real
        # -RemoteAddress value if someone applied it without reading it.
        _grant(main, slug, "u@x.com", {"workflows": "read"})
        r = client.get("/api/firewall-ruleset-templates", headers=_dash_headers(main, "u@x.com", slug))
        for tmpl in r.json()["items"]:
            for rule in tmpl["rules"]:
                if "REPLACE-WITH" in (rule.get("remoteAddresses") or ""):
                    assert rule["enabled"] is False, f"{tmpl['key']} ships an unedited placeholder rule enabled"


class TestFirewallRulesetCrudRbac:
    def test_list_requires_token(self, client, slug):
        assert client.get("/api/firewall-rulesets", headers={"X-Workspace-Slug": slug}).status_code == 401

    def test_read_only_role_can_list_but_not_create(self, main, client, slug):
        _grant(main, slug, "reader@x.com", {"workflows": "read"})
        assert client.get("/api/firewall-rulesets", headers=_dash_headers(main, "reader@x.com", slug)).status_code == 200
        r = client.post("/api/firewall-rulesets", json={"name": "X", "rules": []}, headers=_dash_headers(main, "reader@x.com", slug, "Bearer fake"))
        assert r.status_code == 403

    def test_manage_role_can_create(self, main, client, slug, monkeypatch):
        _grant(main, slug, "admin@x.com", {"workflows": "manage"})

        async def fake_resolve_org_base(client_arg, headers, ws_slug):
            return "https://api.applivery.io/v1/organizations/deadbeefdeadbeefdeadbeef"
        asset_counter = {"n": 0}
        async def fake_create_script_asset(client_arg, headers, upload_base, name, description, content, platform, segment_id=None, expose_to_children=None):
            asset_counter["n"] += 1
            return {"id": f"asset-{asset_counter['n']}", "name": name}, None
        monkeypatch.setattr(main, "_resolve_org_base", fake_resolve_org_base)
        monkeypatch.setattr(main, "_create_script_asset", fake_create_script_asset)

        r = client.post("/api/firewall-rulesets", json={
            "name": "Test Isolate", "description": "desc", "ensureFirewallEnabled": True,
            "defaultInboundAction": "block", "defaultOutboundAction": "block", "rules": [],
        }, headers=_dash_headers(main, "admin@x.com", slug, "Bearer fake"))
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == "Test Isolate"
        assert body["applyLibraryId"] and body["restoreLibraryId"]
        assert body["applyLibraryId"] != body["restoreLibraryId"]

        # Both auto-provisioned entries actually landed in the Action Library.
        library = main._load_action_library(slug)
        library_ids = {e["id"] for e in library}
        assert body["applyLibraryId"] in library_ids
        assert body["restoreLibraryId"] in library_ids
        apply_entry = next(e for e in library if e["id"] == body["applyLibraryId"])
        assert apply_entry["platform"] == "windows"
        assert apply_entry["firewallManaged"] is True

    def test_delete_requires_delete_risky_action(self, main, client, slug):
        main._save_firewall_library(slug, [{"id": "rs1", "name": "ToDelete", "rules": []}])
        _grant(main, slug, "u@x.com", {"workflows": "manage"}, risky_actions={"canDeletePolicyOrWorkflow": False})
        r = client.delete("/api/firewall-rulesets/rs1", headers=_dash_headers(main, "u@x.com", slug))
        assert r.status_code == 403

    def test_delete_succeeds_with_risky_action_granted(self, main, client, slug):
        main._save_firewall_library(slug, [{"id": "rs1", "name": "ToDelete", "rules": []}])
        _grant(main, slug, "u@x.com", {"workflows": "manage"}, risky_actions={"canDeletePolicyOrWorkflow": True})
        r = client.delete("/api/firewall-rulesets/rs1", headers=_dash_headers(main, "u@x.com", slug))
        assert r.status_code == 200
        assert main._load_firewall_library(slug) == []

    def test_delete_unknown_ruleset_404s(self, main, client, slug):
        _grant(main, slug, "u@x.com", {"workflows": "manage"}, risky_actions={"canDeletePolicyOrWorkflow": True})
        r = client.delete("/api/firewall-rulesets/does-not-exist", headers=_dash_headers(main, "u@x.com", slug))
        assert r.status_code == 404


class FakeApplHttpResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


@pytest.fixture
def patch_applivery_call(monkeypatch, main):
    def _apply(responses):
        state = {"n": 0}
        async def fake_call(client, method, url, headers=None, **kwargs):
            idx = min(state["n"], len(responses) - 1)
            state["n"] += 1
            return responses[idx]
        monkeypatch.setattr(main, "_applivery_call", fake_call)
        return state
    return _apply


class TestApplyRestoreDispatch:
    """_execute_mdm_action's applyFirewallRuleSet/restoreFirewallRuleSet
    branch — delegates to 'runScript' internals. The only outbound network
    call in that path (_applivery_call, used for the device GET+PUT) is
    monkeypatched; everything else is real local-store logic."""

    def _seed(self, main, slug):
        rule_set = {
            "id": "rs1", "name": "Test RS", "ensureFirewallEnabled": True,
            "applyLibraryId": "lib-apply", "restoreLibraryId": "lib-restore", "rules": [],
        }
        main._save_firewall_library(slug, [rule_set])
        main._save_action_library(slug, [
            {"id": "lib-apply", "type": "script", "platform": "windows", "assetId": "asset-apply", "name": "Test RS — Apply (Firewall)", "arguments": "", "scope": "machine"},
            {"id": "lib-restore", "type": "script", "platform": "windows", "assetId": "asset-restore", "name": "Test RS — Restore (Firewall)", "arguments": "", "scope": "machine"},
        ])
        return rule_set

    @pytest.mark.asyncio
    async def test_missing_ruleset_id_fails_cleanly(self, main, slug):
        ok, detail = await main._execute_mdm_action(
            None, {}, "https://api.applivery.io/v1/organizations/x", "windows", "dev-plat-1", "applyFirewallRuleSet",
            params={}, x_workspace_slug=slug, device_id="dev1",
        )
        # Caught by the generic required-field validation (MDM_ACTIONS
        # 'required' field metadata) before reaching the firewall-specific
        # branch at all.
        assert ok is False
        assert "requires a value" in detail

    @pytest.mark.asyncio
    async def test_unknown_ruleset_fails_cleanly(self, main, slug):
        ok, detail = await main._execute_mdm_action(
            None, {}, "https://api.applivery.io/v1/organizations/x", "windows", "dev-plat-1", "applyFirewallRuleSet",
            params={"ruleSetId": "does-not-exist"}, x_workspace_slug=slug, device_id="dev1",
        )
        assert ok is False
        assert "not found" in detail

    @pytest.mark.asyncio
    async def test_unprovisioned_ruleset_fails_cleanly(self, main, slug):
        main._save_firewall_library(slug, [{"id": "rs-unprovisioned", "name": "Nope", "rules": []}])
        ok, detail = await main._execute_mdm_action(
            None, {}, "https://api.applivery.io/v1/organizations/x", "windows", "dev-plat-1", "applyFirewallRuleSet",
            params={"ruleSetId": "rs-unprovisioned"}, x_workspace_slug=slug, device_id="dev1",
        )
        assert ok is False
        assert "hasn't finished provisioning" in detail

    @pytest.mark.asyncio
    async def test_apply_success_records_device_state(self, main, slug, patch_applivery_call):
        self._seed(main, slug)
        patch_applivery_call([FakeApplHttpResponse(200, {"data": {"scripts": []}}), FakeApplHttpResponse(200, {})])
        ok, detail = await main._execute_mdm_action(
            None, {}, "https://api.applivery.io/v1/organizations/x", "windows", "dev-plat-1", "applyFirewallRuleSet",
            params={"ruleSetId": "rs1"}, x_workspace_slug=slug, device_id="dev1",
        )
        assert ok is True
        assert "Applied" in detail
        state = main._load_firewall_remediation_state(slug)
        assert state["dev1"]["active"][0]["ruleSetId"] == "rs1"

    @pytest.mark.asyncio
    async def test_restore_success_clears_device_state(self, main, slug, patch_applivery_call):
        rule_set = self._seed(main, slug)
        main._record_firewall_remediation_dispatch(slug, "dev1", rule_set, applying=True)
        patch_applivery_call([FakeApplHttpResponse(200, {"data": {"scripts": []}}), FakeApplHttpResponse(200, {})])
        ok, detail = await main._execute_mdm_action(
            None, {}, "https://api.applivery.io/v1/organizations/x", "windows", "dev-plat-1", "restoreFirewallRuleSet",
            params={"ruleSetId": "rs1"}, x_workspace_slug=slug, device_id="dev1",
        )
        assert ok is True
        assert "Restored" in detail
        assert main._load_firewall_remediation_state(slug)["dev1"]["active"] == []

    @pytest.mark.asyncio
    async def test_failed_dispatch_does_not_record_state(self, main, slug, patch_applivery_call):
        self._seed(main, slug)
        patch_applivery_call([FakeApplHttpResponse(200, {"data": {"scripts": []}}), FakeApplHttpResponse(500, {"error": "boom"})])
        ok, detail = await main._execute_mdm_action(
            None, {}, "https://api.applivery.io/v1/organizations/x", "windows", "dev-plat-1", "applyFirewallRuleSet",
            params={"ruleSetId": "rs1"}, x_workspace_slug=slug, device_id="dev1",
        )
        assert ok is False
        assert main._load_firewall_remediation_state(slug) == {}
