"""Coverage for the MITRE ATT&CK suggestion assist added to the Policy
Builder: given the `conditions` an admin has added to a draft Compliance
Policy, suggest which curated MITRE techniques (see MITRE_TECHNIQUES in
main.py) those conditions map to, via COMPLIANCE_FIELD_MITRE_HINTS.

This is a suggestion only — it never touches a policy's own mitreTechniques
field, which stays entirely admin-controlled. So the coverage here is: (1)
the pure mapping function _suggest_mitre_techniques_for_conditions, driven
directly per this repo's stated preference for pure-function tests over
HTTP-level tests where the logic doesn't need one, and (2) a thin HTTP-level
check that the endpoint wires the same function through with a valid
dashboard token, matching the TestClient pattern used across the other
compliance suites.
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
    return {"X-Dashboard-Token": _token(main, email), "X-Workspace-Slug": slug}


class TestSuggestMitreTechniquesForConditions:
    def test_no_conditions_returns_nothing(self, main):
        assert main._suggest_mitre_techniques_for_conditions([]) == []
        assert main._suggest_mitre_techniques_for_conditions(None) == []

    def test_condition_with_no_curated_hint_is_skipped(self, main):
        # 'platform' and other purely administrative fields deliberately
        # have no entry in COMPLIANCE_FIELD_MITRE_HINTS.
        conditions = [{"field": "platform", "operator": "equals", "value": "apple"}]
        assert main._suggest_mitre_techniques_for_conditions(conditions) == []

    def test_condition_missing_field_key_is_skipped_not_erroring(self, main):
        assert main._suggest_mitre_techniques_for_conditions([{"operator": "equals", "value": 1}]) == []

    def test_outdated_os_condition_suggests_client_exploitation_technique(self, main):
        conditions = [{"field": "osVersion", "operator": "lessThan", "value": "17.0"}]
        result = main._suggest_mitre_techniques_for_conditions(conditions)
        ids = [t["id"] for t in result]
        assert "T1203" in ids
        entry = next(t for t in result if t["id"] == "T1203")
        assert entry["triggeredByFields"] == ["osVersion"]
        assert entry["name"]  # carried through from _MITRE_TECHNIQUES_BY_ID
        assert entry["tactic"] == "execution"

    def test_missing_required_security_app_suggests_impair_defenses(self, main):
        conditions = [{"field": "requiredAppList", "operator": "equals", "value": "list-123"}]
        result = main._suggest_mitre_techniques_for_conditions(conditions)
        assert [t["id"] for t in result] == ["T1562"]

    def test_disallowed_app_suggests_multiple_techniques(self, main):
        conditions = [{"field": "disallowedAppList", "operator": "equals", "value": "list-456"}]
        result = main._suggest_mitre_techniques_for_conditions(conditions)
        ids = {t["id"] for t in result}
        assert ids == {"T1204", "T1105"}

    def test_multiple_conditions_dedupe_and_merge_triggered_fields(self, main):
        # Both osVersion and osUpdateExploitedPending map to T1203 — should
        # appear once, with both fields listed as triggers.
        conditions = [
            {"field": "osVersion", "operator": "lessThan", "value": "17.0"},
            {"field": "osUpdateExploitedPending", "operator": "equals", "value": True},
        ]
        result = main._suggest_mitre_techniques_for_conditions(conditions)
        assert len(result) == 1
        assert result[0]["id"] == "T1203"
        assert set(result[0]["triggeredByFields"]) == {"osVersion", "osUpdateExploitedPending"}

    def test_preserves_first_triggered_order(self, main):
        conditions = [
            {"field": "requiredAppList", "operator": "equals", "value": "x"},  # -> T1562
            {"field": "disallowedAppList", "operator": "equals", "value": "y"},  # -> T1204, T1105
        ]
        result = main._suggest_mitre_techniques_for_conditions(conditions)
        assert [t["id"] for t in result] == ["T1562", "T1204", "T1105"]

    def test_every_hinted_technique_id_exists_in_curated_catalog(self, main):
        # Guards against a typo'd technique id in COMPLIANCE_FIELD_MITRE_HINTS
        # that would otherwise silently vanish (the function drops unknown
        # ids rather than erroring) instead of ever surfacing as a suggestion.
        for field_key, technique_ids in main.COMPLIANCE_FIELD_MITRE_HINTS.items():
            for tid in technique_ids:
                assert tid in main._MITRE_TECHNIQUES_BY_ID, (
                    f"COMPLIANCE_FIELD_MITRE_HINTS['{field_key}'] references "
                    f"unknown technique id {tid}"
                )

    def test_every_curated_field_key_exists_in_compliance_fields(self, main):
        # Guards against the hint map drifting from COMPLIANCE_FIELDS if a
        # field key is ever renamed/removed there.
        known_field_keys = {f["key"] for f in main.COMPLIANCE_FIELDS}
        for field_key in main.COMPLIANCE_FIELD_MITRE_HINTS:
            assert field_key in known_field_keys, (
                f"COMPLIANCE_FIELD_MITRE_HINTS references unknown field '{field_key}'"
            )


class TestSuggestMitreTechniquesEndpoint:
    def test_requires_dashboard_token(self, client):
        res = client.post("/api/compliance/suggest-mitre-techniques", json={"conditions": []})
        assert res.status_code in (401, 403)

    def test_returns_suggestions_for_given_conditions(self, main, client):
        slug = f"test-mitre-suggest-{uuid.uuid4().hex[:12]}"
        res = client.post(
            "/api/compliance/suggest-mitre-techniques",
            json={"conditions": [{"field": "osVersion", "operator": "lessThan", "value": "17.0"}]},
            headers=_dash_headers(main, "admin@x.com", slug),
        )
        assert res.status_code == 200
        items = res.json()["items"]
        assert [t["id"] for t in items] == ["T1203"]

    def test_empty_conditions_returns_empty_items(self, main, client):
        slug = f"test-mitre-suggest-{uuid.uuid4().hex[:12]}"
        res = client.post(
            "/api/compliance/suggest-mitre-techniques",
            json={},
            headers=_dash_headers(main, "admin@x.com", slug),
        )
        assert res.status_code == 200
        assert res.json()["items"] == []
