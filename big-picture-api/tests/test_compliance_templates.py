"""Regression coverage for the Compliance Policy Templates feature —
COMPLIANCE_FRAMEWORKS / COMPLIANCE_POLICY_TEMPLATES in main.py.

Three concerns matter most here, in order of how badly a bug would hurt:

1. Cross-platform safety: a template's conditions must never false-positive
   on a device that simply doesn't emit the signal a condition checks for
   (e.g. an Android device evaluated against a Windows/macOS self-reported
   attribute). See the long comment above COMPLIANCE_POLICY_TEMPLATES in
   main.py for why this is a real risk (notEquals-against-missing-value)
   and how it's avoided (equals-against-the-bad-value). This suite proves
   it holds for every template, not just the ones a human eyeballed.
2. Catalog integrity: every template references a real framework and only
   uses fields/operators that actually exist in COMPLIANCE_FIELDS — a typo
   here would silently produce a template whose condition never matches
   anything (or worse, means something different than its label claims).
3. The template → policy-draft handoff on the frontend expects specific
   keys (title, description, severity, conditionLogic, conditions,
   controlRef, framework) — covered by a shape check so a rename here
   doesn't silently break TemplateGallery.jsx without a test failing.
"""
import uuid

import pytest


@pytest.fixture
def slug():
    """A fresh, never-before-used workspace slug for each test — see the
    identical fixture in test_storage.py/test_alerting_and_feeds.py for why
    this matters (every slug gets its own SQLite file, so tests can't see
    each other's state)."""
    return f"test-{uuid.uuid4().hex[:12]}"


class TestFrameworkCatalogIntegrity:
    def test_every_template_references_a_known_framework(self, main):
        known = {f["key"] for f in main.COMPLIANCE_FRAMEWORKS}
        for t in main.COMPLIANCE_POLICY_TEMPLATES:
            assert t["framework"] in known, f"{t['id']} references unknown framework {t['framework']!r}"

    def test_template_ids_are_unique(self, main):
        ids = [t["id"] for t in main.COMPLIANCE_POLICY_TEMPLATES]
        assert len(ids) == len(set(ids))

    def test_requested_frameworks_present_and_dora_excluded(self, main):
        # DORA was deliberately dropped from the catalog — see the comment
        # above COMPLIANCE_FRAMEWORKS in main.py: it's almost entirely an
        # entity-level regulation with only a thin, largely-redundant
        # device-security slice, so it wasn't meaningfully differentiated
        # from ISO 27001/NIS2's device controls for UEM customers.
        keys = {f["key"] for f in main.COMPLIANCE_FRAMEWORKS}
        assert keys == {"iso27001", "ens", "nis2"}
        assert "dora" not in keys
        assert not any(t["framework"] == "dora" for t in main.COMPLIANCE_POLICY_TEMPLATES)

    def test_every_framework_has_at_least_one_template(self, main):
        covered = {t["framework"] for t in main.COMPLIANCE_POLICY_TEMPLATES}
        for f in main.COMPLIANCE_FRAMEWORKS:
            assert f["key"] in covered, f"{f['key']} has no templates"

    def test_every_framework_documents_its_scope_caveat(self, main):
        # The EUCC mismatch that prompted swapping to NIS2 (product
        # certification vs. ongoing device policy) is exactly the kind of
        # thing a caveat exists to prevent recurring — every framework must
        # have one, not just the ones that prompted this rule.
        for f in main.COMPLIANCE_FRAMEWORKS:
            assert f.get("caveats"), f"{f['key']} is missing a scope caveat"

    def test_valid_severity_and_condition_logic(self, main):
        for t in main.COMPLIANCE_POLICY_TEMPLATES:
            assert t["severity"] in ("low", "medium", "high", "critical"), t["id"]
            assert t["conditionLogic"] in ("any", "all"), t["id"]
            assert len(t["conditions"]) >= 1, t["id"]

    def test_conditions_only_use_known_fields_and_operators(self, main):
        fields_by_key = {f["key"]: f for f in main.COMPLIANCE_FIELDS}
        for t in main.COMPLIANCE_POLICY_TEMPLATES:
            for cond in t["conditions"]:
                field_key = cond["field"]
                assert field_key in fields_by_key, f"{t['id']} uses unknown field {field_key!r}"
                allowed_ops = fields_by_key[field_key]["operators"]
                assert cond["operator"] in allowed_ops, f"{t['id']}/{field_key} uses disallowed operator {cond['operator']!r}"

    def test_templates_endpoint_filters_by_framework(self, main):
        # get_compliance_policy_templates is a plain async function with no
        # auth/side effects beyond the dict lookups it does internally, so
        # it's callable directly without spinning up the app/client.
        import asyncio
        result = asyncio.run(main.get_compliance_policy_templates(framework="nis2"))
        assert all(t["framework"] == "nis2" for t in result["items"])
        assert len(result["items"]) >= 1
        assert result["frameworks"] == main.COMPLIANCE_FRAMEWORKS

    def test_templates_endpoint_rejects_unknown_framework(self, main):
        import asyncio
        with pytest.raises(main.HTTPException) as exc_info:
            asyncio.run(main.get_compliance_policy_templates(framework="not-a-real-framework"))
        assert exc_info.value.status_code == 404


class TestCrossPlatformSafety:
    """For every template, a device with NO relevant signal at all (no
    self-report, no native security block, no OS lifecycle/vuln data) must
    never be flagged — see the module docstring above and the big comment
    in main.py this mirrors."""

    def _blank_device(self, **overrides):
        base = {
            "platform": "apple", "osVersion": "17.0", "lastSeen": None,
            "selfReported": None, "nativeSecurity": None,
            "osLifecycleStatus": None, "osUpdateStatus": None, "vulnStatus": None,
        }
        base.update(overrides)
        return base

    def test_no_template_false_positives_on_a_signal_less_device(self, main):
        device = self._blank_device()
        for t in main.COMPLIANCE_POLICY_TEMPLATES:
            # lastSeenDaysAgo-based conditions legitimately need `lastSeen`
            # to evaluate at all — skip those here, they're covered in
            # their own test below with an explicit fresh check-in instead.
            if any(c["field"] == "lastSeenDaysAgo" for c in t["conditions"]):
                continue
            triggered = [main._evaluate_condition(device, c) for c in t["conditions"]]
            assert not any(triggered), f"{t['id']} false-positived on a device with no relevant signal"

    def test_stale_checkin_templates_do_not_trigger_on_a_fresh_device(self, main):
        from datetime import datetime, timezone
        fresh = self._blank_device(lastSeen=datetime.now(timezone.utc).isoformat())
        for t in main.COMPLIANCE_POLICY_TEMPLATES:
            stale_conditions = [c for c in t["conditions"] if c["field"] == "lastSeenDaysAgo"]
            for c in stale_conditions:
                assert main._evaluate_condition(fresh, c) is False, t["id"]

    def test_disk_encryption_template_catches_windows_and_android_violations(self, main):
        windows_bad = self._blank_device(platform="windows", selfReported={"attributes": {"diskEncryptionEnabled": "false"}})
        android_bad = self._blank_device(platform="android", nativeSecurity={"isEncrypted": "false"})
        template = next(t for t in main.COMPLIANCE_POLICY_TEMPLATES if t["id"] == "iso27001-disk-encryption")
        assert any(main._evaluate_condition(windows_bad, c) for c in template["conditions"])
        assert any(main._evaluate_condition(android_bad, c) for c in template["conditions"])

    def test_exploited_vuln_template_catches_windows_and_apple_android_violations(self, main):
        windows_exploited = self._blank_device(platform="windows", osUpdateStatus={"pendingKbs": [{"exploited": True}]})
        apple_exploited = self._blank_device(platform="apple", vulnStatus={"confidence": "confirmed", "pendingCves": [{"exploited": True}]})
        template = next(t for t in main.COMPLIANCE_POLICY_TEMPLATES if t["id"] == "nis2-art21-vuln-handling")
        assert any(main._evaluate_condition(windows_exploited, c) for c in template["conditions"])
        assert any(main._evaluate_condition(apple_exploited, c) for c in template["conditions"])


class TestTemplateToPolicyDraftShape:
    """Mirrors TemplateGallery.jsx's templateToPolicyDraft — asserts the
    template dict has every key that function reads, so a backend rename
    fails loudly here instead of silently breaking the frontend handoff."""

    def test_every_template_has_the_fields_the_frontend_draft_builder_reads(self, main):
        required = {"id", "framework", "controlRef", "title", "severity", "conditionLogic", "description", "conditions"}
        for t in main.COMPLIANCE_POLICY_TEMPLATES:
            missing = required - set(t.keys())
            assert not missing, f"{t['id']} missing keys: {missing}"


class TestPolicyFrameworkTagging:
    """CompliancePolicyPayload.framework/controlRef — set by TemplateGallery.
    jsx when a policy is instantiated from a template, carried through
    untouched by PolicyBuilder.jsx on save. Nothing evaluation-related
    depends on these fields; they only exist to power the framework-scoped
    report widgets below, so the main thing worth testing is that they
    default to None (hand-built policies aren't accidentally attributed to
    a framework) and round-trip through the payload model unchanged."""

    def test_defaults_to_untagged(self, main):
        payload = main.CompliancePolicyPayload(name="Untagged policy")
        assert payload.framework is None
        assert payload.controlRef is None

    def test_round_trips_when_set(self, main):
        payload = main.CompliancePolicyPayload(name="ISO policy", framework="iso27001", controlRef="Annex A.8.1")
        as_dict = payload.dict()
        assert as_dict["framework"] == "iso27001"
        assert as_dict["controlRef"] == "Annex A.8.1"


class TestComplianceFrameworkRows:
    """_compliance_framework_rows — the aggregation function behind
    compliance_framework_coverage / iso27001_compliance_status /
    ens_compliance_status / nis2_compliance_status. Covers the three things
    that would silently produce a misleading report if wrong: an
    unconfigured control still appearing (as a gap, not an omission), a
    disabled policy not counting as 'enforcing' anything, and a device
    violating two controls of the same framework only counting once in the
    framework-wide total."""

    def test_unconfigured_control_reports_as_a_gap_not_omitted(self, main, slug):
        main._save_compliance_policies(slug, [])
        main._save_compliance_state(slug, {})
        rows, violating_ids = main._compliance_framework_rows(slug, "iso27001")
        iso_template_count = sum(1 for t in main.COMPLIANCE_POLICY_TEMPLATES if t["framework"] == "iso27001")
        assert len(rows) == iso_template_count
        assert all(r["configured"] is False and r["enabled"] is False and r["violatingDeviceCount"] == 0 for r in rows)
        assert violating_ids == set()

    def test_disabled_policy_counts_as_configured_but_not_enabled(self, main, slug):
        template = next(t for t in main.COMPLIANCE_POLICY_TEMPLATES if t["framework"] == "nis2")
        policy = {"id": "p1", "framework": "nis2", "controlRef": template["controlRef"], "enabled": False}
        main._save_compliance_policies(slug, [policy])
        main._save_compliance_state(slug, {"p1:dev-1": {"status": "pending"}})
        rows, violating_ids = main._compliance_framework_rows(slug, "nis2")
        row = next(r for r in rows if r["templateId"] == template["id"])
        assert row["configured"] is True
        assert row["enabled"] is False
        # A disabled policy isn't actually enforcing anything — its state
        # entries (likely stale, from before it was disabled) don't count.
        assert row["violatingDeviceCount"] == 0
        assert violating_ids == set()

    def test_device_violating_two_controls_counts_once_in_framework_total(self, main, slug):
        ens_templates = [t for t in main.COMPLIANCE_POLICY_TEMPLATES if t["framework"] == "ens"]
        assert len(ens_templates) >= 2, "test assumes ENS has at least 2 templates"
        t1, t2 = ens_templates[0], ens_templates[1]
        policies = [
            {"id": "p1", "framework": "ens", "controlRef": t1["controlRef"], "enabled": True},
            {"id": "p2", "framework": "ens", "controlRef": t2["controlRef"], "enabled": True},
        ]
        main._save_compliance_policies(slug, policies)
        # Same device (dev-1) violates both policies.
        main._save_compliance_state(slug, {"p1:dev-1": {}, "p2:dev-1": {}, "p1:dev-2": {}})
        rows, violating_ids = main._compliance_framework_rows(slug, "ens")
        row1 = next(r for r in rows if r["templateId"] == t1["id"])
        row2 = next(r for r in rows if r["templateId"] == t2["id"])
        assert row1["violatingDeviceCount"] == 2  # dev-1 and dev-2
        assert row2["violatingDeviceCount"] == 1  # dev-1 only
        assert violating_ids == {"dev-1", "dev-2"}  # deduplicated framework-wide total

    def test_policy_for_a_different_framework_is_ignored(self, main, slug):
        iso_template = next(t for t in main.COMPLIANCE_POLICY_TEMPLATES if t["framework"] == "iso27001")
        # Same controlRef string coincidentally reused under the wrong
        # framework tag — must not be picked up by the iso27001 report.
        policy = {"id": "p1", "framework": "nis2", "controlRef": iso_template["controlRef"], "enabled": True}
        main._save_compliance_policies(slug, [policy])
        main._save_compliance_state(slug, {"p1:dev-1": {}})
        rows, violating_ids = main._compliance_framework_rows(slug, "iso27001")
        row = next(r for r in rows if r["templateId"] == iso_template["id"])
        assert row["configured"] is False
        assert violating_ids == set()


class TestComplianceFrameworkWidgetSources:
    def test_widget_source_map_covers_exactly_the_three_kept_frameworks(self, main):
        assert set(main._COMPLIANCE_FRAMEWORK_WIDGET_SOURCES.values()) == {None, "iso27001", "ens", "nis2"}
        assert "dora_compliance_status" not in main._COMPLIANCE_FRAMEWORK_WIDGET_SOURCES
