"""Regression coverage for the SQLite-backed generic storage abstraction
(`_store_load` / `_store_save` / `_store_keys` / `_store_delete`) that
replaced the old one-JSON-file-per-store pattern, plus the handful of
concrete `_load_X`/`_save_X` pairs whose behavior is bespoke enough (caps,
migration-on-load hooks, composite keys, legacy-JSON import) that a plain
round-trip isn't the whole story.

Every test uses its own unique workspace slug (via the `slug` fixture) so
tests never see state left behind by another test sharing the same on-disk
SQLite file / cached connection.
"""
import json
import os
import uuid

import pytest


@pytest.fixture
def slug():
    """A fresh, never-before-used workspace slug for each test — avoids
    cross-test interference through the process-wide `_sqlite_connections`
    cache, since every slug gets its own SQLite file."""
    return f"test-{uuid.uuid4().hex[:12]}"


class TestStoreLoadSave:
    def test_load_returns_default_when_nothing_stored(self, main, slug):
        assert main._store_load(slug, 'widget', list) == []
        assert main._store_load(slug, 'widget', dict) == {}

    def test_default_factory_called_fresh_each_time_no_shared_mutable(self, main, slug):
        # Regression: default_factory must be a zero-arg callable, not a bare
        # value, so two different keys never end up sharing the same list/dict
        # object across calls.
        a = main._store_load(slug, 'widget', list, key='a')
        b = main._store_load(slug, 'widget', list, key='b')
        a.append('x')
        assert b == []

    def test_save_then_load_round_trips(self, main, slug):
        main._store_save(slug, 'widget', {"name": "foo", "count": 3})
        assert main._store_load(slug, 'widget', dict) == {"name": "foo", "count": 3}

    def test_save_overwrites_previous_value(self, main, slug):
        main._store_save(slug, 'widget', {"v": 1})
        main._store_save(slug, 'widget', {"v": 2})
        assert main._store_load(slug, 'widget', dict) == {"v": 2}

    def test_different_kinds_do_not_collide(self, main, slug):
        main._store_save(slug, 'kind_a', [1, 2, 3])
        main._store_save(slug, 'kind_b', [4, 5, 6])
        assert main._store_load(slug, 'kind_a', list) == [1, 2, 3]
        assert main._store_load(slug, 'kind_b', list) == [4, 5, 6]

    def test_different_slugs_do_not_collide(self, main, slug):
        other = f"{slug}-other"
        main._store_save(slug, 'widget', {"who": "first"})
        main._store_save(other, 'widget', {"who": "second"})
        assert main._store_load(slug, 'widget', dict) == {"who": "first"}
        assert main._store_load(other, 'widget', dict) == {"who": "second"}

    def test_composite_key_round_trips_independently(self, main, slug):
        main._store_save(slug, 'widget', {"n": 1}, key="2026-01-01:source_a")
        main._store_save(slug, 'widget', {"n": 2}, key="2026-01-01:source_b")
        assert main._store_load(slug, 'widget', dict, key="2026-01-01:source_a") == {"n": 1}
        assert main._store_load(slug, 'widget', dict, key="2026-01-01:source_b") == {"n": 2}

    def test_post_load_hook_applied_to_default_and_stored_data(self, main, slug):
        bump = lambda d: {**d, "touched": True}
        assert main._store_load(slug, 'widget', dict, post_load=bump) == {"touched": True}
        main._store_save(slug, 'widget', {"x": 1})
        assert main._store_load(slug, 'widget', dict, post_load=bump) == {"x": 1, "touched": True}

    def test_corrupt_row_falls_back_to_default(self, main, slug):
        # Simulate a corrupted value by writing invalid JSON directly, below
        # the _store_save API, and confirm _store_load degrades to the
        # default rather than raising.
        conn = main._get_sqlite_conn(slug)
        conn.execute(
            "INSERT INTO store (kind, key, value, updated_at) VALUES (?, ?, ?, ?)",
            ('widget', '', 'not valid json{{', 'now'),
        )
        conn.commit()
        assert main._store_load(slug, 'widget', list) == []


class TestStoreKeysAndDelete:
    def test_store_keys_empty_when_nothing_stored(self, main, slug):
        assert main._store_keys(slug, 'snapshot') == []

    def test_store_keys_lists_all_keys_for_kind_sorted(self, main, slug):
        main._store_save(slug, 'snapshot', {}, key="2026-02-01:stats")
        main._store_save(slug, 'snapshot', {}, key="2026-01-01:stats")
        main._store_save(slug, 'snapshot', {}, key="2026-01-15:stats")
        assert main._store_keys(slug, 'snapshot') == [
            "2026-01-01:stats", "2026-01-15:stats", "2026-02-01:stats",
        ]

    def test_store_keys_respects_kind_isolation(self, main, slug):
        main._store_save(slug, 'snapshot', {}, key="k1")
        main._store_save(slug, 'other_kind', {}, key="k2")
        assert main._store_keys(slug, 'snapshot') == ["k1"]

    def test_store_keys_prefix_filter(self, main, slug):
        main._store_save(slug, 'snapshot', {}, key="2026-01-01:stats_a")
        main._store_save(slug, 'snapshot', {}, key="2026-01-01:stats_b")
        main._store_save(slug, 'snapshot', {}, key="2026-02-01:stats_a")
        assert main._store_keys(slug, 'snapshot', prefix="2026-01-01:") == [
            "2026-01-01:stats_a", "2026-01-01:stats_b",
        ]

    def test_store_delete_removes_only_target_row(self, main, slug):
        main._store_save(slug, 'snapshot', {"a": 1}, key="k1")
        main._store_save(slug, 'snapshot', {"a": 2}, key="k2")
        main._store_delete(slug, 'snapshot', key="k1")
        assert main._store_keys(slug, 'snapshot') == ["k2"]
        assert main._store_load(slug, 'snapshot', dict, key="k2") == {"a": 2}


class TestKnownWorkspaceSlugs:
    def test_new_slug_appears_after_first_write(self, main, slug):
        assert slug not in main._known_workspace_slugs()
        main._store_save(slug, 'widget', {"x": 1})
        assert slug in main._known_workspace_slugs()

    def test_global_pseudo_workspace_excluded(self, main, slug):
        main._store_save(main._GLOBAL_STORE_SLUG, 'widget', {"x": 1})
        assert main._GLOBAL_STORE_SLUG not in main._known_workspace_slugs()


class TestLegacyJsonImport:
    def test_import_happens_once_then_sqlite_wins(self, main, slug, tmp_path):
        legacy_path = tmp_path / f"{slug}.json"
        legacy_path.write_text(json.dumps({"imported": True, "n": 1}))

        main._register_legacy_json('legacy_test_kind', lambda s, k: str(legacy_path))

        # First load: no SQLite row yet -> imports from the legacy JSON file.
        first = main._store_load(slug, 'legacy_test_kind', dict)
        assert first == {"imported": True, "n": 1}

        # Mutate the legacy file on disk; a second load must NOT re-import —
        # the SQLite row written by the first load's import now wins.
        legacy_path.write_text(json.dumps({"imported": True, "n": 999}))
        second = main._store_load(slug, 'legacy_test_kind', dict)
        assert second == {"imported": True, "n": 1}

    def test_no_import_when_legacy_file_absent(self, main, slug):
        main._register_legacy_json('legacy_missing_kind', lambda s, k: "/nonexistent/path.json")
        assert main._store_load(slug, 'legacy_missing_kind', list) == []

    def test_no_import_when_kind_has_no_resolver(self, main, slug):
        assert main._store_load(slug, 'kind_with_no_legacy_resolver', dict) == {}


class TestComplianceViolationsCap:
    def test_save_truncates_to_cap(self, main, slug):
        violations = [{"id": i} for i in range(10)]
        main._save_compliance_violations(slug, violations, cap=3)
        assert main._load_compliance_violations(slug) == [{"id": 0}, {"id": 1}, {"id": 2}]

    def test_default_cap_is_500(self, main, slug):
        violations = [{"id": i} for i in range(600)]
        main._save_compliance_violations(slug, violations)
        loaded = main._load_compliance_violations(slug)
        assert len(loaded) == 500
        assert loaded[0] == {"id": 0}
        assert loaded[-1] == {"id": 499}


class TestAuditLogCap:
    def test_save_truncates_to_hard_cap(self, main, slug):
        entries = [{"id": i} for i in range(main.AUDIT_LOG_HARD_CAP + 50)]
        main._save_audit_log(slug, entries)
        loaded = main._load_audit_log(slug)
        assert len(loaded) == main.AUDIT_LOG_HARD_CAP


class TestWorkflowRunsAppendCap:
    def test_append_inserts_newest_first_and_caps(self, main, slug):
        for i in range(5):
            main._append_workflow_run(slug, {"id": i}, cap=3)
        runs = main._load_workflow_runs(slug)
        # Newest first, capped at 3.
        assert [r["id"] for r in runs] == [4, 3, 2]


class TestCaseSlaSettingsBackfill:
    def test_default_settings_have_all_severity_thresholds(self, main, slug):
        settings = main._load_case_sla_settings(slug)
        assert set(settings["thresholds"].keys()) == set(main.DEFAULT_CASE_SLA_THRESHOLDS.keys())

    def test_backfills_missing_severity_on_load(self, main, slug):
        # Simulate settings saved before a new severity tier existed: only
        # 'low' and 'medium' present.
        main._save_case_sla_settings(slug, {
            "enabled": True,
            "notifyOnBreach": True,
            "thresholds": {"low": {"acknowledgeMinutes": 999, "resolveMinutes": 999}},
        })
        settings = main._load_case_sla_settings(slug)
        # The custom 'low' value the workspace actually saved is preserved...
        assert settings["thresholds"]["low"] == {"acknowledgeMinutes": 999, "resolveMinutes": 999}
        # ...but every other severity got backfilled with the default.
        for sev in ("medium", "high", "critical"):
            assert settings["thresholds"][sev] == main.DEFAULT_CASE_SLA_THRESHOLDS[sev]


class TestSnapshotCompositeKey:
    def test_save_and_load_by_date_and_source(self, main, slug):
        main._save_snapshot(slug, "2026-03-01", "stats_devices", {"count": 42})
        assert main._load_snapshot(slug, "2026-03-01", "stats_devices") == {"count": 42}

    def test_load_missing_snapshot_returns_none(self, main, slug):
        assert main._load_snapshot(slug, "2026-03-01", "nonexistent_source") is None

    def test_list_snapshot_dates_sorted_and_deduped(self, main, slug):
        main._save_snapshot(slug, "2026-03-02", "stats_devices", {})
        main._save_snapshot(slug, "2026-03-01", "stats_devices", {})
        main._save_snapshot(slug, "2026-03-01", "stats_downloads", {})  # same date, different source
        assert main._list_snapshot_dates(slug) == ["2026-03-01", "2026-03-02"]


class TestFindBySecretAndIdBypassFunctions:
    def test_find_trigger_by_id_across_workspaces(self, main, slug):
        other = f"{slug}-other"
        main._save_triggers(slug, [{"id": "trig-1", "name": "in first workspace"}])
        main._save_triggers(other, [{"id": "trig-2", "name": "in second workspace"}])
        found = main._find_trigger_by_id("trig-2")
        assert found is not None
        found_slug, trigger = found
        assert found_slug == other
        assert trigger["name"] == "in second workspace"

    def test_find_trigger_by_id_returns_none_when_not_found(self, main, slug):
        main._save_triggers(slug, [{"id": "trig-1"}])
        assert main._find_trigger_by_id("does-not-exist") is None

    def test_find_applivery_webhook_config_by_secret(self, main, slug):
        other = f"{slug}-other"
        main._save_applivery_webhook_config(slug, {"enabled": True, "secret": "secret-a", "rules": [], "recentEvents": [], "receivedCount": 0, "lastReceivedAt": None})
        main._save_applivery_webhook_config(other, {"enabled": True, "secret": "secret-b", "rules": [], "recentEvents": [], "receivedCount": 0, "lastReceivedAt": None})
        found = main._find_applivery_webhook_config_by_secret("secret-b")
        assert found is not None
        found_slug, config = found
        assert found_slug == other


class TestLayoutShapeQuirkPreserved:
    """The GET/POST shape mismatch (GET returns the whole stored value,
    POST only ever writes payload.layout — an array, not the
    {"widgets":...,"layout":...} dict shape GET defaults to) predates this
    storage migration. These tests pin the *current* externally-observable
    behavior so the migration itself is verified not to have changed it,
    without asserting the mismatch is desirable."""

    def test_default_layout_shape(self, main, slug):
        # _load_layout is global, not per-slug — use a fresh state by
        # asserting on whatever the default factory produces when no row
        # exists yet for a never-used kind name.
        assert main._store_load(slug, 'layout_test_default', lambda: {"widgets": [], "layout": []}) == {"widgets": [], "layout": []}

    def test_save_layout_persists_raw_array(self, main):
        main._save_layout([{"i": "widget-1", "x": 0, "y": 0}])
        assert main._load_layout() == [{"i": "widget-1", "x": 0, "y": 0}]


class TestConcurrentWrites:
    def test_many_sequential_writes_do_not_corrupt(self, main, slug):
        # Not a true concurrency test (SQLite + the module's own write lock
        # serialize this anyway), but confirms rapid repeated writes to the
        # same kind/key never leave a partially-written or corrupted row.
        for i in range(200):
            main._store_save(slug, 'widget', {"n": i})
        assert main._store_load(slug, 'widget', dict) == {"n": 199}

    def test_concurrent_writes_from_multiple_threads_leave_consistent_state(self, main, slug):
        import threading

        errors = []

        def writer(n):
            try:
                for i in range(20):
                    main._store_save(slug, 'widget', {"thread": n, "i": i}, key=f"t{n}")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(n,)) for n in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        # Every thread's key should hold its own last-written value —
        # no cross-thread corruption of another thread's row.
        for n in range(8):
            val = main._store_load(slug, 'widget', dict, key=f"t{n}")
            assert val == {"thread": n, "i": 19}
