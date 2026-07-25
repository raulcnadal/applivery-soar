"""Regression coverage for the RBAC feature in main.py:
_extract_collaborator_tag_candidates, _resolve_soar_access,
_get_cached_access/_set_cached_access, require_permission, and the
/api/roles* + /api/auth/resolve-access endpoints.

The two things that would actually hurt someone if they broke: (1) the
Applivery workspace Owner ever getting locked out (isSuperAdmin bypass must
never fail), and (2) an unmapped collaborator ever landing anywhere other
than fully denied (no accidental read-only fallback — see the module
comment in main.py above SOAR_FEATURE_AREAS). Both are covered directly,
plus the ordinary role-matching and permission-dependency paths, using the
same "call plain functions / async endpoints directly, no HTTP layer"
pattern as test_workspace_onboarding.py.
"""
import asyncio
import time
import uuid

import pytest


@pytest.fixture
def slug():
    return f"test-{uuid.uuid4().hex[:12]}"


class FakeResponse:
    """Minimal stand-in for an httpx.Response — just enough surface
    (.status_code, .json()) for main._applivery_call's callers."""
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload


@pytest.fixture
def patch_collaborators(monkeypatch, main):
    """Monkeypatches main._applivery_call so every outbound Applivery call
    (both the org-slug-to-id lookup and the /collaborators/ fetch used by
    _find_self_collaborator) returns the given collaborator list, without a
    real HTTP round-trip."""
    def _apply(collaborators):
        async def fake_call(client, method, url, headers=None, **kwargs):
            return FakeResponse(200, {"items": collaborators})
        monkeypatch.setattr(main, "_applivery_call", fake_call)
    return _apply


# ─── _extract_collaborator_tag_candidates ───

class TestExtractCollaboratorTagCandidates:
    def test_scalar_tag_field(self, main):
        assert main._extract_collaborator_tag_candidates({"tag": "soc-analyst"}) == ["soc-analyst"]

    def test_list_tags_field(self, main):
        out = main._extract_collaborator_tag_candidates({"tags": ["a", "b", "a"]})
        assert out == ["a", "b"]

    def test_multiple_candidate_fields_combined_and_deduped(self, main):
        raw = {"tag": "x", "group": "x", "labels": ["y"]}
        assert main._extract_collaborator_tag_candidates(raw) == ["x", "y"]

    def test_no_candidate_fields_present(self, main):
        assert main._extract_collaborator_tag_candidates({"email": "a@b.com"}) == []

    def test_ignores_empty_and_whitespace_only_values(self, main):
        assert main._extract_collaborator_tag_candidates({"tag": "  ", "tags": ["", "z"]}) == ["z"]

    def test_non_string_scalar_is_stringified(self, main):
        assert main._extract_collaborator_tag_candidates({"tag": 7}) == ["7"]


# ─── _resolve_soar_access — the actual access decision ───

class TestResolveSoarAccess:
    def test_owner_is_super_admin_regardless_of_roles(self, main, patch_collaborators):
        patch_collaborators([{"email": "owner@x.com", "role": "owner"}])
        result = asyncio.run(main._resolve_soar_access(None, "https://x", {}, "owner@x.com", roles=[]))
        assert result["allowed"] is True
        assert result["isSuperAdmin"] is True
        assert result["deniedReason"] is None

    def test_owner_email_match_is_case_insensitive(self, main, patch_collaborators):
        patch_collaborators([{"email": "Owner@X.com", "role": "owner"}])
        result = asyncio.run(main._resolve_soar_access(None, "https://x", {}, "owner@x.com", roles=[]))
        assert result["isSuperAdmin"] is True

    def test_no_collaborator_record_denies(self, main, patch_collaborators):
        patch_collaborators([])
        result = asyncio.run(main._resolve_soar_access(None, "https://x", {}, "nobody@x.com", roles=[]))
        assert result["allowed"] is False
        assert result["isSuperAdmin"] is False
        assert "No Applivery Collaborator record" in result["deniedReason"]

    def test_tag_match_grants_the_mapped_role(self, main, patch_collaborators):
        patch_collaborators([{"email": "analyst@x.com", "role": "admin", "tag": "soc-analyst"}])
        roles = [{"id": "r1", "name": "SOC Analyst", "appliveryTagValues": ["soc-analyst"], "featureAccess": {}, "riskyActions": {}}]
        result = asyncio.run(main._resolve_soar_access(None, "https://x", {}, "analyst@x.com", roles=roles))
        assert result["allowed"] is True
        assert result["isSuperAdmin"] is False
        assert result["role"]["id"] == "r1"
        assert result["matchedTagValue"] == "soc-analyst"

    def test_tag_match_is_case_insensitive(self, main, patch_collaborators):
        patch_collaborators([{"email": "analyst@x.com", "role": "admin", "tag": "SOC-Analyst"}])
        roles = [{"id": "r1", "appliveryTagValues": ["soc-analyst"]}]
        result = asyncio.run(main._resolve_soar_access(None, "https://x", {}, "analyst@x.com", roles=roles))
        assert result["allowed"] is True

    def test_unmapped_tag_is_denied_not_read_only_fallback(self, main, patch_collaborators):
        patch_collaborators([{"email": "someone@x.com", "role": "admin", "tag": "unmapped-tag"}])
        roles = [{"id": "r1", "appliveryTagValues": ["soc-analyst"]}]
        result = asyncio.run(main._resolve_soar_access(None, "https://x", {}, "someone@x.com", roles=roles))
        assert result["allowed"] is False
        assert result["isSuperAdmin"] is False
        assert result["role"] is None
        assert "No SOAR Role is mapped" in result["deniedReason"]

    def test_collaborator_with_no_roles_configured_at_all_is_denied(self, main, patch_collaborators):
        patch_collaborators([{"email": "someone@x.com", "role": "admin", "tag": "soc-analyst"}])
        result = asyncio.run(main._resolve_soar_access(None, "https://x", {}, "someone@x.com", roles=[]))
        assert result["allowed"] is False

    def test_first_matching_role_wins_when_multiple_roles_share_a_tag(self, main, patch_collaborators):
        patch_collaborators([{"email": "a@x.com", "role": "admin", "tag": "shared-tag"}])
        roles = [
            {"id": "r1", "appliveryTagValues": ["shared-tag"]},
            {"id": "r2", "appliveryTagValues": ["shared-tag"]},
        ]
        result = asyncio.run(main._resolve_soar_access(None, "https://x", {}, "a@x.com", roles=roles))
        assert result["role"]["id"] == "r1"


# ─── access cache — TTL + fail-closed semantics ───

class TestAccessCache:
    def test_fresh_entry_is_returned(self, main):
        main._set_cached_access("ws1", "fresh@x.com", {"allowed": True, "isSuperAdmin": True})
        cached = main._get_cached_access("ws1", "fresh@x.com")
        assert cached is not None
        assert cached["isSuperAdmin"] is True

    def test_missing_entry_returns_none(self, main):
        assert main._get_cached_access("ws-nope", "nobody@x.com") is None

    def test_expired_entry_returns_none(self, main):
        # A resolved_at comfortably more than one TTL window in the past
        # (relative to *this process's* monotonic clock, not an assumed
        # absolute value — monotonic()'s epoch is arbitrary and can be
        # small on a freshly-booted sandbox) guarantees the entry reads as
        # expired regardless of how long the test process has been up.
        stale_resolved_at = time.monotonic() - main._ACCESS_CACHE_TTL_SECONDS - 10
        main._ACCESS_CACHE[("ws-old", "old@x.com")] = (stale_resolved_at, {"allowed": True, "isSuperAdmin": True})
        assert main._get_cached_access("ws-old", "old@x.com") is None

    def test_cache_key_is_case_insensitive_on_email(self, main):
        main._set_cached_access("ws1", "Mixed@X.com", {"allowed": True})
        assert main._get_cached_access("ws1", "mixed@x.com") is not None


# ─── require_permission dependency factory ───

class TestRequirePermission:
    def test_denies_when_access_never_resolved(self, main):
        checker = main.require_permission(area="workflows", level="manage")
        with pytest.raises(main.HTTPException) as exc:
            asyncio.run(checker(dash={"sub": "nobody@x.com"}, x_workspace_slug="ws-unresolved"))
        assert exc.value.status_code == 403
        assert "not resolved" in exc.value.detail

    def test_denies_when_cached_access_is_not_allowed(self, main):
        main._set_cached_access("ws1", "denied@x.com", {"allowed": False, "isSuperAdmin": False, "deniedReason": "no role mapped"})
        checker = main.require_permission(area="workflows", level="read")
        with pytest.raises(main.HTTPException) as exc:
            asyncio.run(checker(dash={"sub": "denied@x.com"}, x_workspace_slug="ws1"))
        assert exc.value.status_code == 403
        assert exc.value.detail == "no role mapped"

    def test_super_admin_bypasses_every_check_including_super_admin_only(self, main):
        main._set_cached_access("ws1", "owner@x.com", {"allowed": True, "isSuperAdmin": True, "role": None})
        checker = main.require_permission(area="settings", level="manage", action="canExportOrImportConfig", super_admin_only=True)
        result = asyncio.run(checker(dash={"sub": "owner@x.com"}, x_workspace_slug="ws1"))
        assert result["isSuperAdmin"] is True

    def test_super_admin_only_blocks_a_regular_role_even_with_manage_access(self, main):
        role = {"featureAccess": {"settings": "manage"}, "riskyActions": {}}
        main._set_cached_access("ws1", "admin@x.com", {"allowed": True, "isSuperAdmin": False, "role": role})
        checker = main.require_permission(super_admin_only=True)
        with pytest.raises(main.HTTPException) as exc:
            asyncio.run(checker(dash={"sub": "admin@x.com"}, x_workspace_slug="ws1"))
        assert exc.value.status_code == 403
        assert "Super Admin" in exc.value.detail

    def test_area_level_read_passes_but_manage_is_denied(self, main):
        role = {"featureAccess": {"compliance": "read"}, "riskyActions": {}}
        main._set_cached_access("ws1", "viewer@x.com", {"allowed": True, "isSuperAdmin": False, "role": role})

        read_checker = main.require_permission(area="compliance", level="read")
        assert asyncio.run(read_checker(dash={"sub": "viewer@x.com"}, x_workspace_slug="ws1"))["allowed"] is True

        manage_checker = main.require_permission(area="compliance", level="manage")
        with pytest.raises(main.HTTPException) as exc:
            asyncio.run(manage_checker(dash={"sub": "viewer@x.com"}, x_workspace_slug="ws1"))
        assert exc.value.status_code == 403

    def test_area_omitted_from_feature_access_defaults_to_none(self, main):
        role = {"featureAccess": {}, "riskyActions": {}}
        main._set_cached_access("ws1", "u@x.com", {"allowed": True, "isSuperAdmin": False, "role": role})
        checker = main.require_permission(area="workflows", level="read")
        with pytest.raises(main.HTTPException):
            asyncio.run(checker(dash={"sub": "u@x.com"}, x_workspace_slug="ws1"))

    def test_risky_action_flag_gates_independently_of_feature_level(self, main):
        # High feature-area access ("manage") does NOT imply a risky-action
        # flag is granted — they're deliberately independent per the RBAC
        # design (see SOAR_RISKY_ACTIONS comment in main.py).
        role_without_flag = {"featureAccess": {"workflows": "manage"}, "riskyActions": {"canDeletePolicyOrWorkflow": False}}
        main._set_cached_access("ws1", "u1@x.com", {"allowed": True, "isSuperAdmin": False, "role": role_without_flag})
        checker = main.require_permission(area="workflows", level="manage", action="canDeletePolicyOrWorkflow")
        with pytest.raises(main.HTTPException) as exc:
            asyncio.run(checker(dash={"sub": "u1@x.com"}, x_workspace_slug="ws1"))
        assert exc.value.status_code == 403

        role_with_flag = {"featureAccess": {"workflows": "manage"}, "riskyActions": {"canDeletePolicyOrWorkflow": True}}
        main._set_cached_access("ws1", "u2@x.com", {"allowed": True, "isSuperAdmin": False, "role": role_with_flag})
        result = asyncio.run(checker(dash={"sub": "u2@x.com"}, x_workspace_slug="ws1"))
        assert result["allowed"] is True

    def test_missing_workspace_slug_header_falls_back_to_global(self, main):
        main._set_cached_access("global", "u@x.com", {"allowed": True, "isSuperAdmin": True})
        checker = main.require_permission()
        result = asyncio.run(checker(dash={"sub": "u@x.com"}, x_workspace_slug=None))
        assert result["isSuperAdmin"] is True


# ─── /api/roles* CRUD endpoints ───

class TestSoarRolesCrud:
    def _dash(self):
        return {"sub": "admin@example.com"}

    def test_list_roles_empty_for_a_fresh_workspace(self, main, slug):
        result = asyncio.run(main.list_soar_roles(x_workspace_slug=slug))
        assert result["items"] == []
        assert result["featureAreas"] == main.SOAR_FEATURE_AREAS
        assert result["riskyActions"] == main.SOAR_RISKY_ACTIONS

    def test_create_role_persists_and_returns_it(self, main, slug):
        payload = main.RolePayload(name="SOC Analyst", appliveryTagValues=["soc-analyst"], featureAccess={"devices": "read"})
        created = asyncio.run(main.create_soar_role(payload, x_workspace_slug=slug, dash=self._dash()))
        assert created["name"] == "SOC Analyst"
        assert created["id"]
        assert created["createdAt"] == created["updatedAt"]
        stored = main._load_soar_roles(slug)
        assert len(stored) == 1
        assert stored[0]["appliveryTagValues"] == ["soc-analyst"]

    def test_update_role_preserves_id_and_created_at(self, main, slug):
        created = asyncio.run(main.create_soar_role(main.RolePayload(name="Old Name"), x_workspace_slug=slug, dash=self._dash()))
        updated = asyncio.run(main.update_soar_role(created["id"], main.RolePayload(name="New Name"), x_workspace_slug=slug, dash=self._dash()))
        assert updated["id"] == created["id"]
        assert updated["name"] == "New Name"
        assert updated["createdAt"] == created["createdAt"]
        assert main._load_soar_roles(slug)[0]["name"] == "New Name"

    def test_update_missing_role_404s(self, main, slug):
        with pytest.raises(main.HTTPException) as exc:
            asyncio.run(main.update_soar_role("does-not-exist", main.RolePayload(name="X"), x_workspace_slug=slug, dash=self._dash()))
        assert exc.value.status_code == 404

    def test_delete_role_removes_it(self, main, slug):
        created = asyncio.run(main.create_soar_role(main.RolePayload(name="Temp"), x_workspace_slug=slug, dash=self._dash()))
        result = asyncio.run(main.delete_soar_role(created["id"], x_workspace_slug=slug, dash=self._dash()))
        assert result["status"] == "ok"
        assert main._load_soar_roles(slug) == []

    def test_delete_nonexistent_role_is_a_noop_not_an_error(self, main, slug):
        result = asyncio.run(main.delete_soar_role("nope", x_workspace_slug=slug, dash=self._dash()))
        assert result["status"] == "ok"

    def test_roles_are_isolated_per_workspace(self, main, slug):
        other_slug = f"test-{uuid.uuid4().hex[:12]}"
        asyncio.run(main.create_soar_role(main.RolePayload(name="Only in first"), x_workspace_slug=slug, dash=self._dash()))
        assert main._load_soar_roles(other_slug) == []
        assert len(main._load_soar_roles(slug)) == 1


# ─── /api/auth/resolve-access endpoint ───

class TestResolveAccessEndpoint:
    def _dash(self):
        return {"sub": "owner@x.com"}

    def test_resolves_and_caches_owner_access(self, main, patch_collaborators):
        patch_collaborators([{"email": "owner@x.com", "role": "owner"}])
        hex_slug = "507f1f77bcf86cd799439011"
        result = asyncio.run(main.resolve_soar_access(authorization="Bearer tok", x_workspace_slug=hex_slug, dash=self._dash()))
        assert result["allowed"] is True
        assert result["isSuperAdmin"] is True
        cached = main._get_cached_access(hex_slug, "owner@x.com")
        assert cached is not None
        assert cached["isSuperAdmin"] is True

    def test_missing_credentials_raises_401(self, main):
        with pytest.raises(main.HTTPException) as exc:
            asyncio.run(main.resolve_soar_access(authorization=None, x_workspace_slug="ws1", dash=self._dash()))
        assert exc.value.status_code == 401


# ─── /api/roles/collaborators-directory endpoint ───

class TestCollaboratorsDirectoryEndpoint:
    def test_surfaces_tag_candidates_segments_and_available_tags(self, main, monkeypatch):
        hex_slug = "507f1f77bcf86cd799439022"

        async def fake_call(client, method, url, headers=None, **kwargs):
            if url.endswith('/collaborators/'):
                return FakeResponse(200, {"items": [{"email": "a@x.com", "role": "admin", "tags": ["soc-analyst"]}]})
            if url.endswith('/segments/by-user'):
                return FakeResponse(200, {"items": [{"_id": "seg1", "name": "EU Fleet"}]})
            if url.endswith('/collaborators/groups'):
                return FakeResponse(200, {"items": [{"value": "soc-analyst"}, {"value": "eu-team"}]})
            return FakeResponse(200, {})

        monkeypatch.setattr(main, "_applivery_call", fake_call)
        result = asyncio.run(main.get_collaborators_directory(authorization="Bearer tok", x_workspace_slug=hex_slug))
        assert result["collaborators"][0]["tagCandidates"] == ["soc-analyst"]
        assert result["collaborators"][0]["role_normalized"] == "admin"
        assert result["segments"][0]["name"] == "EU Fleet"
        assert result["availableTags"] == ["soc-analyst", "eu-team"]

    def test_missing_credentials_raises_401(self, main):
        with pytest.raises(main.HTTPException) as exc:
            asyncio.run(main.get_collaborators_directory(authorization=None, x_workspace_slug="ws1"))
        assert exc.value.status_code == 401


# ─── _fetch_collaborator_groups ───

class TestFetchCollaboratorGroups:
    def test_extracts_and_dedupes_values(self, main, monkeypatch):
        async def fake_call(client, method, url, headers=None, **kwargs):
            return FakeResponse(200, {"data": {"items": [{"value": "soc-analyst"}, {"value": "eu-team"}, {"value": "soc-analyst"}]}})
        monkeypatch.setattr(main, "_applivery_call", fake_call)
        result = asyncio.run(main._fetch_collaborator_groups(None, "https://x", {}))
        assert result == ["soc-analyst", "eu-team"]

    def test_non_200_returns_empty_list(self, main, monkeypatch):
        async def fake_call(client, method, url, headers=None, **kwargs):
            return FakeResponse(404, {})
        monkeypatch.setattr(main, "_applivery_call", fake_call)
        assert asyncio.run(main._fetch_collaborator_groups(None, "https://x", {})) == []

    def test_ignores_blank_values(self, main, monkeypatch):
        async def fake_call(client, method, url, headers=None, **kwargs):
            return FakeResponse(200, {"items": [{"value": "  "}, {"value": "real-tag"}]})
        monkeypatch.setattr(main, "_applivery_call", fake_call)
        assert asyncio.run(main._fetch_collaborator_groups(None, "https://x", {})) == ["real-tag"]


# ─── PUT /api/roles/collaborators/{id} — write-back ───

class TestUpdateSoarCollaborator:
    def _dash(self):
        return {"sub": "admin@example.com"}

    def test_sends_role_and_tags_to_the_org_scoped_endpoint(self, main, monkeypatch):
        captured = {}

        async def fake_call(client, method, url, headers=None, **kwargs):
            if method == 'PUT' and '/collaborators/' in url:
                captured['method'] = method
                captured['url'] = url
                captured['json'] = kwargs.get('json')
                return FakeResponse(200, {"status": True})
            return FakeResponse(200, {})

        monkeypatch.setattr(main, "_applivery_call", fake_call)
        hex_slug = "507f1f77bcf86cd799439033"
        payload = main.CollaboratorTagsPayload(role="admin", tags=["soc-analyst", "eu-team"])
        result = asyncio.run(main.update_soar_collaborator("collab123", payload, authorization="Bearer tok", x_workspace_slug=hex_slug, dash=self._dash()))
        assert result["status"] == "ok"
        assert captured['url'].endswith(f"/organizations/{hex_slug}/collaborators/collab123")
        assert captured['json'] == {"tags": ["soc-analyst", "eu-team"], "role": "admin"}

        # Audited under the workspace slug used on the request.
        events = main._load_audit_log(hex_slug)
        assert any(e.get('action') == 'collaborator_tags_updated' for e in events)

    def test_omits_role_from_body_when_not_provided(self, main, monkeypatch):
        captured = {}

        async def fake_call(client, method, url, headers=None, **kwargs):
            if method == 'PUT':
                captured['json'] = kwargs.get('json')
            return FakeResponse(200, {})

        monkeypatch.setattr(main, "_applivery_call", fake_call)
        payload = main.CollaboratorTagsPayload(tags=["just-a-tag"])
        asyncio.run(main.update_soar_collaborator("collab456", payload, authorization="Bearer tok", x_workspace_slug="507f1f77bcf86cd799439044", dash=self._dash()))
        assert captured['json'] == {"tags": ["just-a-tag"]}

    def test_missing_credentials_raises_401(self, main):
        payload = main.CollaboratorTagsPayload(tags=[])
        with pytest.raises(main.HTTPException) as exc:
            asyncio.run(main.update_soar_collaborator("c1", payload, authorization=None, x_workspace_slug="ws1", dash=self._dash()))
        assert exc.value.status_code == 401

    def test_applivery_error_response_propagates_as_http_exception(self, main, monkeypatch):
        async def fake_call(client, method, url, headers=None, **kwargs):
            return FakeResponse(400, {"message": "Invalid tag value"})
        monkeypatch.setattr(main, "_applivery_call", fake_call)
        payload = main.CollaboratorTagsPayload(tags=["bad"])
        with pytest.raises(main.HTTPException) as exc:
            asyncio.run(main.update_soar_collaborator("c1", payload, authorization="Bearer tok", x_workspace_slug="507f1f77bcf86cd799439055", dash=self._dash()))
        assert exc.value.status_code == 400
        assert exc.value.detail == "Invalid tag value"


# ─── role_normalized fallback (feeds the write-back role selector) ───

class TestRoleNormalizedFallback:
    def test_missing_role_field_defaults_to_unassigned_not_user(self, main, monkeypatch):
        """A collaborator record with no 'role' field must default to a
        real Applivery enum value ('unassigned') — not the old 'user'
        fallback, which isn't a valid role and would get PUT back to
        Applivery unchanged if an admin saved without touching the role
        selector."""
        hex_slug = "507f1f77bcf86cd799439066"

        async def fake_call(client, method, url, headers=None, **kwargs):
            if url.endswith('/collaborators/'):
                return FakeResponse(200, {"items": [{"email": "norole@x.com"}]})
            return FakeResponse(200, {"items": []})

        monkeypatch.setattr(main, "_applivery_call", fake_call)
        result = asyncio.run(main.get_collaborators_directory(authorization="Bearer tok", x_workspace_slug=hex_slug))
        assert result["collaborators"][0]["role_normalized"] == "unassigned"


# ─── POST /api/roles/test-access — dry-run diagnostic ───

class TestSoarAccessDryRun:
    def test_allowed_collaborator_reports_matched_role_and_caches_result(self, main, patch_collaborators, slug):
        patch_collaborators([{"email": "analyst@x.com", "role": "admin", "tags": ["soc-analyst"]}])
        asyncio.run(main.create_soar_role(
            main.RolePayload(name="SOC Analyst", appliveryTagValues=["soc-analyst"]),
            x_workspace_slug=slug, dash={"sub": "admin@example.com"},
        ))
        result = asyncio.run(main.test_soar_access(main.TestAccessPayload(email="analyst@x.com"), authorization="Bearer tok", x_workspace_slug=slug))
        assert result["allowed"] is True
        assert result["role"]["name"] == "SOC Analyst"
        assert result["collaboratorFound"] is True
        assert result["liveTagCandidates"] == ["soc-analyst"]
        # Confirms a subsequent real login for this person would hit a warm cache.
        cached = main._get_cached_access(slug, "analyst@x.com")
        assert cached is not None
        assert cached["allowed"] is True

    def test_denied_collaborator_surfaces_live_tags_and_role_tag_values_for_diagnosis(self, main, patch_collaborators, slug):
        # Exactly the reported failure mode: a tag is on the live
        # collaborator record, but no saved Role has that tag mapped.
        patch_collaborators([{"email": "orphan@x.com", "role": "admin", "tags": ["brand-new-tag"]}])
        asyncio.run(main.create_soar_role(
            main.RolePayload(name="Unrelated Role", appliveryTagValues=["some-other-tag"]),
            x_workspace_slug=slug, dash={"sub": "admin@example.com"},
        ))
        result = asyncio.run(main.test_soar_access(main.TestAccessPayload(email="orphan@x.com"), authorization="Bearer tok", x_workspace_slug=slug))
        assert result["allowed"] is False
        assert result["collaboratorFound"] is True
        assert result["liveTagCandidates"] == ["brand-new-tag"]
        checked_values = [rv["tagValues"] for rv in result["roleTagValuesChecked"]]
        assert ["some-other-tag"] in checked_values
        assert "No SOAR Role is mapped" in result["deniedReason"]

    def test_collaborator_not_found_is_reported_distinctly(self, main, patch_collaborators, slug):
        patch_collaborators([])
        result = asyncio.run(main.test_soar_access(main.TestAccessPayload(email="ghost@x.com"), authorization="Bearer tok", x_workspace_slug=slug))
        assert result["allowed"] is False
        assert result["collaboratorFound"] is False
        assert result["liveTagCandidates"] == []

    def test_missing_credentials_raises_401(self, main):
        with pytest.raises(main.HTTPException) as exc:
            asyncio.run(main.test_soar_access(main.TestAccessPayload(email="x@x.com"), authorization=None, x_workspace_slug="ws1"))
        assert exc.value.status_code == 401
