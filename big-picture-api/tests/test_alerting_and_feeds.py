"""Regression coverage for the five features added in this session's pass
over the project's recommended enhancements:

1. Paging alerts (PagerDuty/Opsgenie) + SMTP wired into SLA/health alerts
2. MITRE ATT&CK catalog freshness (live STIX cross-check)
3. Workspace config export/import bundle
4. Outbound structured event feed (CEF format for Log Export Destinations)
5. Inbound rate limiting

Each of these touches either a pure/near-pure function (CEF formatting, the
rate limiter, the STIX parser) or the generic SQLite store abstraction
(config export/import) — both well suited to direct unit tests without
spinning up the full FastAPI app against a mocked Applivery API, consistent
with the rest of this suite.
"""
import uuid

import pytest


@pytest.fixture
def slug():
    """A fresh, never-before-used workspace slug for each test — see the
    identical fixture in test_storage.py for why this matters (every slug
    gets its own SQLite file, so tests can't see each other's state)."""
    return f"test-{uuid.uuid4().hex[:12]}"


class TestCefFormatting:
    def _event(self, **overrides):
        base = {
            "id": "evt-1", "timestamp": "2026-07-20T12:00:00+00:00",
            "category": "violation", "action": "policy_violated", "severity": "critical",
            "actor": "system", "targetType": "device", "targetId": "dev-1", "targetName": "iPhone-01",
            "message": "Device violates policy",
        }
        base.update(overrides)
        return base

    def test_header_shape(self, main):
        cef = main._format_event_as_cef(self._event())
        assert cef.startswith("CEF:0|Applivery|SOAR|1.0|policy_violated|Device violates policy|9|")

    def test_severity_mapping(self, main):
        for sev, expected in main.CEF_SEVERITY_MAP.items():
            cef = main._format_event_as_cef(self._event(severity=sev))
            assert f"|{expected}|" in cef

    def test_unknown_severity_defaults_to_info_level(self, main):
        cef = main._format_event_as_cef(self._event(severity="something-unrecognized"))
        assert f"|{main.CEF_SEVERITY_MAP['info']}|" in cef

    def test_extension_fields_present(self, main):
        cef = main._format_event_as_cef(self._event())
        assert "cat=violation" in cef
        assert "act=policy_violated" in cef
        assert "suser=system" in cef
        assert "cs1Label=TargetType cs1=device" in cef
        assert "cs2Label=TargetId cs2=dev-1" in cef
        assert "cs3Label=TargetName cs3=iPhone-01" in cef
        assert "rt=" in cef

    def test_missing_optional_fields_omitted_not_blank(self, main):
        cef = main._format_event_as_cef(self._event(targetType=None, targetId=None, targetName=None))
        assert "cs1=" not in cef
        assert "cs2=" not in cef
        assert "cs3=" not in cef

    def test_pipe_in_name_escaped_in_header(self, main):
        cef = main._format_event_as_cef(self._event(message="Policy A | Policy B triggered"))
        header = cef.split("|cat=")[0]
        assert "Policy A \\| Policy B triggered" in header

    def test_equals_in_extension_escaped(self, main):
        cef = main._format_event_as_cef(self._event(message="threshold=5 exceeded"))
        assert "msg=threshold\\=5 exceeded" in cef

    def test_bad_timestamp_does_not_raise(self, main):
        cef = main._format_event_as_cef(self._event(timestamp="not-a-real-timestamp"))
        assert cef.startswith("CEF:0|")
        assert "rt=" not in cef  # silently omitted rather than crashing the whole export


class TestInboundRateLimiter:
    def test_allows_up_to_limit_then_blocks(self, main):
        rl = main._InboundRateLimiter()
        results = [rl.check("k", limit=3, window_seconds=60) for _ in range(5)]
        assert results == [True, True, True, False, False]

    def test_different_keys_are_independent(self, main):
        rl = main._InboundRateLimiter()
        for _ in range(3):
            assert rl.check("a", limit=3, window_seconds=60) is True
        assert rl.check("a", limit=3, window_seconds=60) is False
        assert rl.check("b", limit=3, window_seconds=60) is True

    def test_window_resets_after_expiry(self, main, monkeypatch):
        rl = main._InboundRateLimiter()
        t = [1000.0]
        monkeypatch.setattr(main.time, "time", lambda: t[0])
        for _ in range(3):
            assert rl.check("k", limit=3, window_seconds=60) is True
        assert rl.check("k", limit=3, window_seconds=60) is False
        t[0] += 61  # past the window
        assert rl.check("k", limit=3, window_seconds=60) is True

    def test_rate_limit_rules_cover_login_and_public_receivers(self, main):
        prefixes = [r[0] for r in main._RATE_LIMIT_RULES]
        assert "/api/auth/login" in prefixes
        assert any(p.startswith("/api/triggers/fire") for p in prefixes)
        assert any(p.startswith("/api/applivery-webhook/receive") for p in prefixes)
        # Generic catch-all must be listed LAST (least specific) so a match
        # against '/api/auth/login' etc. is found first via next().
        assert prefixes[-1] == "/api/"


class TestMitreCatalogParsing:
    def _bundle(self, objects):
        return {"type": "bundle", "objects": objects}

    def _attack_pattern(self, ext_id, name, tactics=None, revoked=False, deprecated=False, source_name="mitre-attack"):
        return {
            "type": "attack-pattern", "name": name,
            "external_references": [{"source_name": source_name, "external_id": ext_id}],
            "kill_chain_phases": [{"kill_chain_name": "mitre-attack", "phase_name": t} for t in (tactics or [])],
            "revoked": revoked, "x_mitre_deprecated": deprecated,
        }

    @pytest.mark.asyncio
    async def test_parses_attack_patterns_and_skips_others(self, main, monkeypatch):
        bundle = self._bundle([
            self._attack_pattern("T1078", "Valid Accounts", tactics=["initial-access", "persistence"]),
            {"type": "malware", "name": "not a technique"},
            self._attack_pattern("X1", "wrong source", source_name="other-source"),
        ])
        self._patch_httpx(main, monkeypatch, bundle)
        catalog = await main._refresh_mitre_catalog()
        assert catalog["lastError"] is None
        assert len(catalog["techniques"]) == 1
        t = catalog["techniques"][0]
        assert t["id"] == "T1078"
        assert t["name"] == "Valid Accounts"
        assert t["tactics"] == ["initial-access", "persistence"]
        assert t["revoked"] is False

    @pytest.mark.asyncio
    async def test_revoked_and_deprecated_flags_captured(self, main, monkeypatch):
        bundle = self._bundle([self._attack_pattern("T1999", "Old Technique", revoked=True, deprecated=True)])
        self._patch_httpx(main, monkeypatch, bundle)
        catalog = await main._refresh_mitre_catalog()
        t = catalog["techniques"][0]
        assert t["revoked"] is True
        assert t["deprecated"] is True

    @pytest.mark.asyncio
    async def test_fetch_failure_preserves_previous_catalog(self, main, monkeypatch, slug):
        # Seed a previously-successful catalog...
        main._save_mitre_catalog({"techniques": [{"id": "T1078", "name": "Valid Accounts", "tactics": [], "revoked": False, "deprecated": False}], "lastFetchedAt": "2026-01-01T00:00:00+00:00", "lastError": None})

        class BoomClient:
            def __init__(self, *a, **k): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def get(self, url): raise RuntimeError("network unreachable")

        monkeypatch.setattr(main.httpx, "AsyncClient", BoomClient)
        catalog = await main._refresh_mitre_catalog()
        assert catalog["lastError"] is not None
        # Old data survives a failed refresh — never wiped by a bad fetch.
        assert catalog["techniques"] == [{"id": "T1078", "name": "Valid Accounts", "tactics": [], "revoked": False, "deprecated": False}]

    def _patch_httpx(self, main, monkeypatch, bundle):
        class FakeResponse:
            def __init__(self, data): self._data = data
            def raise_for_status(self): pass
            def json(self): return self._data

        class FakeClient:
            def __init__(self, *a, **k): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def get(self, url): return FakeResponse(bundle)

        monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)


class TestConfigExportImport:
    def test_export_covers_expected_stores(self, main):
        expected = {
            "compliancePolicies", "workflows", "triggers", "integrations", "caseAutoRunRules",
            "caseSlaSettings", "threatIntelProviders", "appliveryWebhookConfig", "actionLibrary",
            "appLists", "scriptRepos", "dashboardState", "vulnServiceConfig", "firewallRuleSets",
        }
        assert set(main.EXPORTABLE_CONFIG_STORES.keys()) == expected

    def test_export_then_import_round_trips_and_preserves_ids(self, main, slug):
        main._save_compliance_policies(slug, [{"id": "pol-1", "name": "Require passcode"}])
        main._save_workflows(slug, [{"id": "wf-1", "name": "Isolate device"}])
        main._save_case_autorun_rules(slug, [{"id": "rule-1", "workflowId": "wf-1"}])

        exported = {
            key: main._store_load(slug, kind, default_factory)
            for key, (kind, default_factory) in main.EXPORTABLE_CONFIG_STORES.items()
        }

        target = f"{slug}-restored"
        for key in ("compliancePolicies", "workflows", "caseAutoRunRules"):
            kind, _default = main.EXPORTABLE_CONFIG_STORES[key]
            main._store_save(target, kind, exported[key])

        assert main._load_compliance_policies(target) == [{"id": "pol-1", "name": "Require passcode"}]
        assert main._load_workflows(target) == [{"id": "wf-1", "name": "Isolate device"}]
        # Cross-reference (workflowId) intact because ids are never regenerated on import.
        assert main._load_case_autorun_rules(target)[0]["workflowId"] == "wf-1"

    def test_import_of_unselected_store_is_a_noop(self, main, slug):
        main._save_workflows(slug, [{"id": "wf-1"}])
        target = f"{slug}-target"
        # Simulate the endpoint's loop, but only "select" compliancePolicies —
        # workflows should be left untouched (still default empty).
        selected_data = {"compliancePolicies": [{"id": "pol-1"}]}
        for key in ("compliancePolicies",):
            kind, _default = main.EXPORTABLE_CONFIG_STORES[key]
            main._store_save(target, kind, selected_data[key])
        assert main._load_compliance_policies(target) == [{"id": "pol-1"}]
        assert main._load_workflows(target) == []
