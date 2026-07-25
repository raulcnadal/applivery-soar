"""Regression coverage for the last line of defense between a misconfigured
Compliance Policy / Case Auto-Run Rule and a destructive action firing
unattended against real devices: destructive-step detection (the thing the
autoRunDestructiveAck save-time gate checks) and the autoRun circuit
breaker (the thing that trips a policy off after repeated total failures).

These are exactly the code paths flagged in the project status review as
the highest-value target for test coverage — a bug here is the difference
between "a bad policy gets queued for manual review" and "a bad policy
wipes the fleet unattended."
"""


def _workflow(*, action_key=None, action_keys=None, step_type="mdm_action"):
    """Builds a minimal workflow dict with one or more mdm_action steps."""
    keys = action_keys if action_keys is not None else ([action_key] if action_key else [])
    steps = [{"type": step_type, "config": {"action": k}} for k in keys]
    return {"id": "wf-1", "name": "Test workflow", "steps": steps}


class TestWorkflowHasDestructiveStep:
    def test_none_workflow_is_not_destructive(self, main):
        assert main._workflow_has_destructive_step(None) is False

    def test_workflow_with_no_steps_is_not_destructive(self, main):
        assert main._workflow_has_destructive_step({"steps": []}) is False

    def test_workflow_missing_steps_key_is_not_destructive(self, main):
        assert main._workflow_has_destructive_step({}) is False

    def test_non_destructive_action_is_not_destructive(self, main):
        wf = _workflow(action_key="syncDevice")
        assert main._workflow_has_destructive_step(wf) is False

    def test_destructive_action_is_destructive(self, main):
        wf = _workflow(action_key="wipeDevice")
        assert main._workflow_has_destructive_step(wf) is True

    def test_schedule_os_update_is_destructive(self, main):
        # The auto-remediation action this session wired up to the OS
        # Lifecycle catalog — must stay flagged destructive so it's still
        # gated behind autoRunDestructiveAck even when its target version
        # is a template, not a hardcoded string.
        wf = _workflow(action_key="scheduleOsUpdate")
        assert main._workflow_has_destructive_step(wf) is True

    def test_one_destructive_step_among_several_still_flags_workflow(self, main):
        wf = _workflow(action_keys=["syncDevice", "rebootDevice", "wipeDevice"])
        assert main._workflow_has_destructive_step(wf) is True

    def test_non_mdm_action_steps_are_ignored(self, main):
        # A notification/http_request step referencing nothing destructive
        # shouldn't ever be able to trip this check, even if its config
        # happens to contain a string that looks like an action key.
        wf = {"id": "wf-2", "steps": [
            {"type": "notification", "config": {"action": "wipeDevice", "message": "not a real action"}},
        ]}
        assert main._workflow_has_destructive_step(wf) is False

    def test_unknown_action_key_defaults_to_not_destructive(self, main):
        wf = _workflow(action_key="totallyMadeUpActionThatDoesNotExist")
        assert main._workflow_has_destructive_step(wf) is False


class TestRunFullyFailed:
    def test_no_results_is_not_fully_failed(self, main):
        # No results yet (e.g. run still initializing) shouldn't count
        # toward the failure streak in either direction.
        assert main._run_fully_failed({"results": []}) is False
        assert main._run_fully_failed({}) is False

    def test_all_failed_results_is_fully_failed(self, main):
        run = {"results": [{"finalStatus": "failed"}, {"finalStatus": "failed"}]}
        assert main._run_fully_failed(run) is True

    def test_any_success_means_not_fully_failed(self, main):
        run = {"results": [{"finalStatus": "failed"}, {"finalStatus": "success"}]}
        assert main._run_fully_failed(run) is False

    def test_any_partial_means_not_fully_failed(self, main):
        run = {"results": [{"finalStatus": "failed"}, {"finalStatus": "partial"}]}
        assert main._run_fully_failed(run) is False


class TestAutorunCircuitBreaker:
    """_autorun_circuit_breaker_check walks a policy's own violation history,
    most-recent-first, counting consecutive fully-failed auto_fired runs.
    All tests monkeypatch _lookup_workflow_run so no disk/DB access happens."""

    def _violation(self, policy_id="pol-1", run_id="run-1", status="auto_fired"):
        return {"policyId": policy_id, "status": status, "workflowRunId": run_id}

    def test_no_violations_never_trips(self, main):
        policy = {"id": "pol-1"}
        assert main._autorun_circuit_breaker_check("ws", policy, []) is None

    def test_trips_after_threshold_consecutive_failures(self, main, monkeypatch):
        threshold = main.AUTORUN_CIRCUIT_BREAKER_THRESHOLD
        policy = {"id": "pol-1"}
        violations = [self._violation(run_id=f"run-{i}") for i in range(threshold)]

        def fake_lookup(slug_key, run_id):
            return {"status": "completed", "results": [{"finalStatus": "failed"}]}

        monkeypatch.setattr(main, "_lookup_workflow_run", fake_lookup)
        reason = main._autorun_circuit_breaker_check("ws", policy, violations)
        assert reason is not None
        assert str(threshold) in reason

    def test_does_not_trip_below_threshold(self, main, monkeypatch):
        threshold = main.AUTORUN_CIRCUIT_BREAKER_THRESHOLD
        policy = {"id": "pol-1"}
        violations = [self._violation(run_id=f"run-{i}") for i in range(threshold - 1)]

        def fake_lookup(slug_key, run_id):
            return {"status": "completed", "results": [{"finalStatus": "failed"}]}

        monkeypatch.setattr(main, "_lookup_workflow_run", fake_lookup)
        assert main._autorun_circuit_breaker_check("ws", policy, violations) is None

    def test_a_success_anywhere_in_the_streak_resets_it(self, main, monkeypatch):
        # Most-recent-first: a success right after (i.e. chronologically
        # more recent than) some failures should stop the count cold, even
        # if there are more failures further back that would otherwise
        # exceed the threshold.
        threshold = main.AUTORUN_CIRCUIT_BREAKER_THRESHOLD
        policy = {"id": "pol-1"}
        violations = [self._violation(run_id=f"run-{i}") for i in range(threshold + 2)]

        run_outcomes = {
            "run-0": {"results": [{"finalStatus": "success"}]},  # most recent — breaks the streak immediately
        }

        def fake_lookup(slug_key, run_id):
            return run_outcomes.get(run_id, {"results": [{"finalStatus": "failed"}]})

        monkeypatch.setattr(main, "_lookup_workflow_run", fake_lookup)
        assert main._autorun_circuit_breaker_check("ws", policy, violations) is None

    def test_running_or_waiting_runs_are_skipped_not_counted(self, main, monkeypatch):
        # An in-flight run shouldn't count as a failure OR break the streak
        # — it just hasn't told us anything yet.
        threshold = main.AUTORUN_CIRCUIT_BREAKER_THRESHOLD
        policy = {"id": "pol-1"}
        violations = [self._violation(run_id=f"run-{i}") for i in range(threshold + 1)]

        def fake_lookup(slug_key, run_id):
            if run_id == "run-0":
                return {"status": "running", "results": []}
            return {"status": "completed", "results": [{"finalStatus": "failed"}]}

        monkeypatch.setattr(main, "_lookup_workflow_run", fake_lookup)
        reason = main._autorun_circuit_breaker_check("ws", policy, violations)
        assert reason is not None  # the `threshold` real failures behind the in-flight run still trip it

    def test_ignores_violations_from_other_policies(self, main, monkeypatch):
        threshold = main.AUTORUN_CIRCUIT_BREAKER_THRESHOLD
        policy = {"id": "pol-1"}
        violations = [self._violation(policy_id="pol-OTHER", run_id=f"run-{i}") for i in range(threshold + 5)]

        def fake_lookup(slug_key, run_id):
            return {"status": "completed", "results": [{"finalStatus": "failed"}]}

        monkeypatch.setattr(main, "_lookup_workflow_run", fake_lookup)
        assert main._autorun_circuit_breaker_check("ws", policy, violations) is None

    def test_ignores_non_auto_fired_violations(self, main, monkeypatch):
        threshold = main.AUTORUN_CIRCUIT_BREAKER_THRESHOLD
        policy = {"id": "pol-1"}
        violations = [self._violation(run_id=f"run-{i}", status="pending") for i in range(threshold + 5)]

        def fake_lookup(slug_key, run_id):
            return {"status": "completed", "results": [{"finalStatus": "failed"}]}

        monkeypatch.setattr(main, "_lookup_workflow_run", fake_lookup)
        assert main._autorun_circuit_breaker_check("ws", policy, violations) is None
