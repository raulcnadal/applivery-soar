"""Regression coverage for the new-workspace onboarding feature:
_workspace_config_is_empty / GET /api/config/workspace-status / POST
/api/config/clone-from in main.py.

The one thing that would actually hurt someone if this broke: the clone
endpoint silently overwriting a workspace that already has real config, or
pulling from the wrong source. Both of those failure modes are covered
directly rather than through the HTTP layer (auth/app wiring is already
covered by the app importing cleanly elsewhere) — these are plain functions
plus one async endpoint callable directly, same pattern as
test_compliance_templates.py.
"""
import uuid

import pytest


@pytest.fixture
def slug():
    return f"test-{uuid.uuid4().hex[:12]}"


@pytest.fixture
def other_slug():
    return f"test-{uuid.uuid4().hex[:12]}"


class TestWorkspaceConfigIsEmpty:
    def test_brand_new_workspace_is_empty(self, main, slug):
        is_empty, has_data = main._workspace_config_is_empty(slug)
        assert is_empty is True
        assert all(v is False for v in has_data.values())
        assert set(has_data.keys()) == set(main.EXPORTABLE_CONFIG_STORES.keys())

    def test_workspace_with_one_populated_store_is_not_empty(self, main, slug):
        main._save_compliance_policies(slug, [{"id": "p1", "name": "Some policy"}])
        is_empty, has_data = main._workspace_config_is_empty(slug)
        assert is_empty is False
        assert has_data["compliancePolicies"] is True
        assert has_data["workflows"] is False

    def test_dict_store_with_content_counts_as_not_empty(self, main, slug):
        main._save_state(slug, {"someKey": "someValue"})  # dashboardState store
        is_empty, has_data = main._workspace_config_is_empty(slug)
        assert has_data["dashboardState"] is True
        assert is_empty is False


class TestWorkspaceStatusEndpoint:
    def test_reports_empty_for_a_fresh_workspace(self, main, slug):
        import asyncio
        result = asyncio.run(main.get_workspace_config_status(x_workspace_slug=slug))
        assert result["isEmpty"] is True

    def test_reports_not_empty_once_something_is_saved(self, main, slug):
        import asyncio
        main._save_workflows(slug, [{"id": "wf1", "name": "Isolate device"}])
        result = asyncio.run(main.get_workspace_config_status(x_workspace_slug=slug))
        assert result["isEmpty"] is False
        assert result["hasData"]["workflows"] is True


class TestCloneWorkspaceConfig:
    def _dash(self):
        return {"sub": "admin@example.com"}

    def test_clones_selected_stores_into_an_empty_target(self, main, slug, other_slug):
        main._save_compliance_policies(other_slug, [{"id": "pol-1", "name": "Require passcode"}])
        main._save_workflows(other_slug, [{"id": "wf-1", "name": "Isolate device"}])
        # Not selected — must NOT be copied even though the source has it.
        main._save_case_autorun_rules(other_slug, [{"id": "rule-1", "workflowId": "wf-1"}])

        import asyncio
        payload = main.ConfigClonePayload(sourceWorkspaceSlug=other_slug, stores=["compliancePolicies", "workflows"])
        result = asyncio.run(main.clone_workspace_config(payload, x_workspace_slug=slug, dash=self._dash()))

        assert result["status"] == "ok"
        assert set(result["cloned"]) == {"compliancePolicies", "workflows"}
        assert main._load_compliance_policies(slug) == [{"id": "pol-1", "name": "Require passcode"}]
        assert main._load_workflows(slug) == [{"id": "wf-1", "name": "Isolate device"}]
        # Ids preserved exactly (no regeneration) — same reasoning as
        # import_workspace_config: cross-references must survive.
        assert main._load_case_autorun_rules(slug) == []  # not selected, stayed empty

    def test_refuses_to_clone_into_a_non_empty_target(self, main, slug, other_slug):
        main._save_compliance_policies(other_slug, [{"id": "pol-1"}])
        main._save_workflows(slug, [{"id": "already-here"}])  # target already has something

        import asyncio
        payload = main.ConfigClonePayload(sourceWorkspaceSlug=other_slug, stores=["compliancePolicies"])
        with pytest.raises(main.HTTPException) as exc_info:
            asyncio.run(main.clone_workspace_config(payload, x_workspace_slug=slug, dash=self._dash()))
        assert exc_info.value.status_code == 400
        # Target's existing data must survive the rejected attempt untouched.
        assert main._load_compliance_policies(slug) == []
        assert main._load_workflows(slug) == [{"id": "already-here"}]

    def test_refuses_source_and_target_being_the_same(self, main, slug):
        import asyncio
        payload = main.ConfigClonePayload(sourceWorkspaceSlug=slug, stores=["workflows"])
        with pytest.raises(main.HTTPException) as exc_info:
            asyncio.run(main.clone_workspace_config(payload, x_workspace_slug=slug, dash=self._dash()))
        assert exc_info.value.status_code == 400

    def test_rejects_unknown_store_keys(self, main, slug, other_slug):
        import asyncio
        payload = main.ConfigClonePayload(sourceWorkspaceSlug=other_slug, stores=["notARealStore"])
        with pytest.raises(main.HTTPException) as exc_info:
            asyncio.run(main.clone_workspace_config(payload, x_workspace_slug=slug, dash=self._dash()))
        assert exc_info.value.status_code == 400

    def test_empty_store_selection_is_a_noop_not_an_error(self, main, slug, other_slug):
        main._save_compliance_policies(other_slug, [{"id": "pol-1"}])
        import asyncio
        payload = main.ConfigClonePayload(sourceWorkspaceSlug=other_slug, stores=[])
        result = asyncio.run(main.clone_workspace_config(payload, x_workspace_slug=slug, dash=self._dash()))
        assert result["cloned"] == []
        assert main._load_compliance_policies(slug) == []
