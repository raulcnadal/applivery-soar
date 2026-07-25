"""Regression coverage for the OS-update/vulnerability/lifecycle/app-update
intelligence signals wired into the Compliance condition engine and device
risk scoring this session ("close the loop between detection and
enforcement"). Two things matter most here:

1. Each new condition field reads the right nested status dict and compares
   correctly (_evaluate_condition).
2. A device with no confirmed signal (wrong platform, catalog hasn't run,
   catalog couldn't confirm a match) never triggers a numeric/boolean
   condition — this app's established "never guess past what's confirmed"
   rule, and the easiest thing for a future edit to accidentally break.

Plus the risk-scoring side (_compute_device_risk): each new signal adds the
expected points and an explainable factor, is additive with the existing
scoring, and the total still caps at 100.
"""


def _condition(field, operator, value):
    return {"field": field, "operator": operator, "value": value}


class TestOsUpdatePendingCount:
    def test_matches_when_above_threshold(self, main):
        device = {"osUpdateStatus": {"pendingCount": 3}}
        assert main._evaluate_condition(device, _condition("osUpdatePendingCount", "greaterThan", 0)) is True

    def test_does_not_match_when_at_or_below_threshold(self, main):
        device = {"osUpdateStatus": {"pendingCount": 0}}
        assert main._evaluate_condition(device, _condition("osUpdatePendingCount", "greaterThan", 0)) is False

    def test_lessthan_operator(self, main):
        device = {"osUpdateStatus": {"pendingCount": 1}}
        assert main._evaluate_condition(device, _condition("osUpdatePendingCount", "lessThan", 5)) is True

    def test_never_matches_when_no_os_update_status(self, main):
        # Non-Windows device, or Windows device the catalog hasn't confirmed
        # a build match for yet — osUpdateStatus is None either way.
        device = {"osUpdateStatus": None}
        assert main._evaluate_condition(device, _condition("osUpdatePendingCount", "greaterThan", 0)) is False

    def test_never_matches_when_field_missing_entirely(self, main):
        device = {}
        assert main._evaluate_condition(device, _condition("osUpdatePendingCount", "greaterThan", 0)) is False


class TestOsUpdateExploitedPending:
    def test_true_when_any_pending_kb_exploited(self, main):
        device = {"osUpdateStatus": {"pendingKbs": [{"exploited": False}, {"exploited": True}]}}
        assert main._evaluate_condition(device, _condition("osUpdateExploitedPending", "equals", True)) is True

    def test_false_when_none_exploited(self, main):
        device = {"osUpdateStatus": {"pendingKbs": [{"exploited": False}]}}
        assert main._evaluate_condition(device, _condition("osUpdateExploitedPending", "equals", True)) is False

    def test_false_when_no_status_at_all(self, main):
        device = {}
        assert main._evaluate_condition(device, _condition("osUpdateExploitedPending", "equals", True)) is False
        # Explicitly asking for "not exploited" on a device with no data
        # should read as true (there's nothing exploited pending) rather
        # than raising or silently matching the wrong branch.
        assert main._evaluate_condition(device, _condition("osUpdateExploitedPending", "equals", False)) is True


class TestVulnPendingCveCount:
    def test_matches_when_confirmed_and_above_threshold(self, main):
        device = {"vulnStatus": {"confidence": "version", "pendingCount": 2}}
        assert main._evaluate_condition(device, _condition("vulnPendingCveCount", "greaterThan", 0)) is True

    def test_never_matches_when_confidence_unknown(self, main):
        # EUVD catalog couldn't confirm a fixed-version match for this OS
        # version — even if pendingCount happens to be populated, this
        # should never be treated as a confirmed signal.
        device = {"vulnStatus": {"confidence": "unknown", "pendingCount": 5}}
        assert main._evaluate_condition(device, _condition("vulnPendingCveCount", "greaterThan", 0)) is False

    def test_never_matches_when_no_vuln_status(self, main):
        device = {"vulnStatus": None}
        assert main._evaluate_condition(device, _condition("vulnPendingCveCount", "greaterThan", 0)) is False


class TestVulnExploitedPending:
    def test_true_when_any_pending_cve_exploited(self, main):
        device = {"vulnStatus": {"pendingCves": [{"exploited": True}]}}
        assert main._evaluate_condition(device, _condition("vulnExploitedPending", "equals", True)) is True

    def test_false_when_no_pending_cves(self, main):
        device = {"vulnStatus": {"pendingCves": []}}
        assert main._evaluate_condition(device, _condition("vulnExploitedPending", "equals", True)) is False


class TestOsEol:
    def test_true_when_confirmed_eol(self, main):
        device = {"osLifecycleStatus": {"isEol": True}}
        assert main._evaluate_condition(device, _condition("osEol", "equals", True)) is True

    def test_false_when_confirmed_not_eol(self, main):
        device = {"osLifecycleStatus": {"isEol": False}}
        assert main._evaluate_condition(device, _condition("osEol", "equals", True)) is False

    def test_unconfirmed_eol_never_matches_true(self, main):
        # isEol is a tri-state (True/False/None) — None means "version train
        # not found in the endoflife.date catalog yet," which must not be
        # silently treated as either compliant or non-compliant.
        device = {"osLifecycleStatus": {"isEol": None}}
        assert main._evaluate_condition(device, _condition("osEol", "equals", True)) is False
        assert main._evaluate_condition(device, _condition("osEol", "equals", False)) is True

    def test_no_lifecycle_status_at_all(self, main):
        device = {}
        assert main._evaluate_condition(device, _condition("osEol", "equals", True)) is False


class TestAppleAppUpdatesPending:
    def test_matches_when_above_threshold(self, main):
        device = {"appleAppUpdateStatus": {"pendingCount": 4}}
        assert main._evaluate_condition(device, _condition("appleAppUpdatesPending", "greaterThan", 0)) is True

    def test_never_matches_before_first_sync(self, main):
        device = {"appleAppUpdateStatus": None}
        assert main._evaluate_condition(device, _condition("appleAppUpdatesPending", "greaterThan", 0)) is False


class TestComputeDeviceRiskIntelligenceFactors:
    """_compute_device_risk reads osUpdateStatus/vulnStatus/osLifecycleStatus/
    appleAppUpdateStatus straight off the device dict — get_devices_full
    always sets them before calling this function, so tests pass them
    directly rather than going through the full fleet-augmentation pipeline."""

    def _base_device(self, **overrides):
        device = {
            "isCompliant": True, "selfReported": {}, "nativeSecurity": None,
            "osUpdateStatus": None, "vulnStatus": None, "osLifecycleStatus": None, "appleAppUpdateStatus": None,
        }
        device.update(overrides)
        return device

    def test_clean_device_has_low_baseline_risk(self, main):
        device = self._base_device()
        result = main._compute_device_risk(device)
        # No self-reported/native security data at all is itself a 10-point
        # factor ("No security attestation reported") — see
        # _compute_device_risk — so a "clean" device isn't zero, just low.
        assert result["riskScore"] < 25
        assert result["riskTier"] == "low"

    def test_pending_windows_updates_add_points_and_factor(self, main):
        clean = main._compute_device_risk(self._base_device())
        device = self._base_device(osUpdateStatus={"pendingCount": 2, "pendingKbs": [{"exploited": False}, {"exploited": False}]})
        result = main._compute_device_risk(device)
        assert result["riskScore"] > clean["riskScore"]
        assert any("pending Windows security update" in f["label"] for f in result["riskFactors"])

    def test_exploited_pending_windows_update_adds_extra_points(self, main):
        without_exploit = main._compute_device_risk(self._base_device(
            osUpdateStatus={"pendingCount": 1, "pendingKbs": [{"exploited": False}]}))
        with_exploit = main._compute_device_risk(self._base_device(
            osUpdateStatus={"pendingCount": 1, "pendingKbs": [{"exploited": True}]}))
        assert with_exploit["riskScore"] > without_exploit["riskScore"]
        assert any("exploited CVE" in f["label"] for f in with_exploit["riskFactors"])

    def test_pending_cves_add_points_and_factor(self, main):
        clean = main._compute_device_risk(self._base_device())
        device = self._base_device(vulnStatus={"confidence": "version", "pendingCount": 3, "pendingCves": [{"exploited": False}]})
        result = main._compute_device_risk(device)
        assert result["riskScore"] > clean["riskScore"]
        assert any("pending known CVE" in f["label"] for f in result["riskFactors"])

    def test_unknown_confidence_vuln_status_contributes_nothing(self, main):
        # Same "never guess" rule as the compliance condition — an
        # unconfirmed vuln match shouldn't silently inflate risk.
        clean = main._compute_device_risk(self._base_device())
        device = self._base_device(vulnStatus={"confidence": "unknown", "pendingCount": 9})
        result = main._compute_device_risk(device)
        assert result["riskScore"] == clean["riskScore"]

    def test_exploited_pending_cve_adds_extra_points(self, main):
        without_exploit = main._compute_device_risk(self._base_device(
            vulnStatus={"confidence": "version", "pendingCount": 1, "pendingCves": [{"exploited": False}]}))
        with_exploit = main._compute_device_risk(self._base_device(
            vulnStatus={"confidence": "version", "pendingCount": 1, "pendingCves": [{"exploited": True}]}))
        assert with_exploit["riskScore"] > without_exploit["riskScore"]
        assert any("exploited in the wild" in f["label"] for f in with_exploit["riskFactors"])

    def test_eol_os_adds_points_and_factor(self, main):
        clean = main._compute_device_risk(self._base_device())
        device = self._base_device(osLifecycleStatus={"isEol": True})
        result = main._compute_device_risk(device)
        assert result["riskScore"] > clean["riskScore"]
        assert any("end of life" in f["label"] for f in result["riskFactors"])

    def test_not_eol_contributes_nothing(self, main):
        clean = main._compute_device_risk(self._base_device())
        device = self._base_device(osLifecycleStatus={"isEol": False})
        result = main._compute_device_risk(device)
        assert result["riskScore"] == clean["riskScore"]

    def test_pending_apple_app_updates_add_points_and_factor(self, main):
        clean = main._compute_device_risk(self._base_device())
        device = self._base_device(appleAppUpdateStatus={"pendingCount": 3})
        result = main._compute_device_risk(device)
        assert result["riskScore"] > clean["riskScore"]
        assert any("update available" in f["label"] for f in result["riskFactors"])

    def test_all_four_signals_are_additive(self, main):
        device = self._base_device(
            osUpdateStatus={"pendingCount": 1, "pendingKbs": [{"exploited": False}]},
            vulnStatus={"confidence": "version", "pendingCount": 1, "pendingCves": [{"exploited": False}]},
            osLifecycleStatus={"isEol": True},
            appleAppUpdateStatus={"pendingCount": 1},
        )
        clean = main._compute_device_risk(self._base_device())
        result = main._compute_device_risk(device)
        assert result["riskScore"] > clean["riskScore"]
        labels = " ".join(f["label"] for f in result["riskFactors"])
        assert "Windows security update" in labels
        assert "pending known CVE" in labels
        assert "end of life" in labels
        assert "update available" in labels

    def test_score_never_exceeds_100(self, main):
        # Stack every possible penalty at once — score must still clamp.
        device = self._base_device(
            isCompliant=False,
            osUpdateStatus={"pendingCount": 50, "pendingKbs": [{"exploited": True}] * 5},
            vulnStatus={"confidence": "version", "pendingCount": 50, "pendingCves": [{"exploited": True}] * 5},
            osLifecycleStatus={"isEol": True},
            appleAppUpdateStatus={"pendingCount": 50},
        )
        result = main._compute_device_risk(
            device,
            open_cases=[{"id": "c1"}, {"id": "c2"}, {"id": "c3"}],
            active_violations=[{"policyName": "p1"}, {"policyName": "p2"}, {"policyName": "p3"}],
        )
        assert result["riskScore"] == 100
        assert result["riskTier"] == "critical"
