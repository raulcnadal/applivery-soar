"""Regression coverage for the Vulnerability Service integration (Applivery-
hosted CloudFlare Worker CVE matching) — an independent, additive signal
alongside the EUVD-based Vulnerability Catalog covered in
test_compliance_intelligence.py, so many test shapes here deliberately
mirror that file's conventions.

Focus areas:
1. Store/cache helpers (config defaults, clamp, cache keys, freshness).
2. _compute_vuln_service_status — the local-cache-only per-device read that
   never calls the Worker inline: unsupported platforms get None, covered
   platforms with nothing cached yet get a checked:False shell, and
   OS/app cache hits aggregate correctly (counts, KEV, EPSS, CVE sort).
3. The three new COMPLIANCE_FIELDS wired into _evaluate_condition.
4. The new _compute_device_risk scoring block — additive with every other
   signal, gated on "checked", capped at 100.
5. The two new registries (COMPLIANCE_FIELDS, EXPORTABLE_CONFIG_STORES)
   actually carry the new keys.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest


@pytest.fixture
def slug():
    return f"test-vulnsvc-{uuid.uuid4().hex[:12]}"


def _condition(field, operator, value):
    return {"field": field, "operator": operator, "value": value}


def _fresh_iso():
    return datetime.now(timezone.utc).isoformat()


def _stale_iso():
    return (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()


class TestClampRefreshHours:
    def test_within_range_passes_through(self, main):
        assert main._clamp_vuln_service_refresh_hours(12) == 12

    def test_below_minimum_clamps_to_one(self, main):
        assert main._clamp_vuln_service_refresh_hours(0) == 1
        assert main._clamp_vuln_service_refresh_hours(-5) == 1

    def test_above_maximum_clamps_to_72(self, main):
        assert main._clamp_vuln_service_refresh_hours(999) == 72

    def test_non_numeric_falls_back_to_default(self, main):
        assert main._clamp_vuln_service_refresh_hours("not-a-number") == 6
        assert main._clamp_vuln_service_refresh_hours(None) == 6


class TestVulnServiceConfigStore:
    def test_default_config_shape(self, main, slug):
        cfg = main._load_vuln_service_config(slug)
        assert cfg == {
            "enabled": False, "baseUrl": "", "apiTokenEncrypted": "", "refreshIntervalHours": 6,
            "lastRefreshAt": None, "lastRefreshError": None, "lastRefreshStats": None,
        }

    def test_save_then_load_round_trips(self, main, slug):
        cfg = main._load_vuln_service_config(slug)
        cfg.update({"enabled": True, "baseUrl": "https://vuln.example.workers.dev", "apiTokenEncrypted": main._encrypt_secret("secret-token")})
        main._save_vuln_service_config(slug, cfg)
        reloaded = main._load_vuln_service_config(slug)
        assert reloaded["enabled"] is True
        assert reloaded["baseUrl"] == "https://vuln.example.workers.dev"
        assert main._vuln_service_decrypt_token(reloaded) == "secret-token"

    def test_configs_are_isolated_per_workspace(self, main, slug):
        other_slug = f"{slug}-other"
        cfg = main._load_vuln_service_config(slug)
        cfg["enabled"] = True
        main._save_vuln_service_config(slug, cfg)
        assert main._load_vuln_service_config(other_slug)["enabled"] is False


class TestVulnServiceSecretEncryption:
    def test_encrypt_then_decrypt_round_trips(self, main):
        ciphertext = main._encrypt_secret("super-secret-token")
        assert ciphertext != "super-secret-token"
        assert main._decrypt_secret(ciphertext) == "super-secret-token"

    def test_empty_plaintext_encrypts_to_empty(self, main):
        assert main._encrypt_secret("") == ""
        assert main._decrypt_secret("") == ""

    def test_decrypting_garbage_returns_empty_instead_of_raising(self, main):
        # e.g. DASHBOARD_SECRET rotated since this was encrypted, or the
        # stored value is simply corrupt — must degrade gracefully, not 500.
        assert main._decrypt_secret("not-a-valid-fernet-token") == ""

    def test_mask_secret_tail_reports_set_and_last4(self, main):
        assert main._mask_secret_tail("") == {"set": False, "last4": None}
        assert main._mask_secret_tail("abcd1234") == {"set": True, "last4": "1234"}

    def test_config_public_view_never_leaks_plaintext_or_ciphertext(self, main, slug):
        cfg = main._load_vuln_service_config(slug)
        cfg["apiTokenEncrypted"] = main._encrypt_secret("my-real-token")
        public = main._vuln_service_config_public(cfg)
        assert "apiTokenEncrypted" not in public
        assert "my-real-token" not in str(public)
        assert public["apiToken"] == {"set": True, "last4": "oken"}

    def test_config_public_view_when_no_token_set(self, main, slug):
        cfg = main._load_vuln_service_config(slug)
        public = main._vuln_service_config_public(cfg)
        assert public["apiToken"] == {"set": False, "last4": None}


class TestVulnServiceCacheHelpers:
    def test_app_cache_key_is_lowercased_and_pipe_delimited(self, main):
        assert main._vuln_service_app_cache_key("Com.Example.App", "1.2.3", "android") == "com.example.app|1.2.3|android"

    def test_os_cache_key_format(self, main):
        assert main._vuln_service_os_cache_key("windows", "10.0.19045") == "windows|10.0.19045"

    def test_fresh_entry_within_ttl(self, main):
        assert main._vuln_service_cache_is_fresh({"fetchedAt": _fresh_iso()}) is True

    def test_stale_entry_beyond_ttl(self, main):
        assert main._vuln_service_cache_is_fresh({"fetchedAt": _stale_iso()}) is False

    def test_missing_or_malformed_entry_is_never_fresh(self, main):
        assert main._vuln_service_cache_is_fresh(None) is False
        assert main._vuln_service_cache_is_fresh({}) is False
        assert main._vuln_service_cache_is_fresh({"fetchedAt": "not-a-date"}) is False

    def test_default_cache_store_shape(self, main, slug):
        assert main._load_vuln_service_cache(slug) == {"apps": {}, "os": {}}


class TestPlatformMap:
    def test_maps_our_platforms_to_worker_platforms(self, main):
        assert main._VULN_SERVICE_PLATFORM_MAP["macos"] == "macos"
        assert main._VULN_SERVICE_PLATFORM_MAP["apple"] == "ios"  # iOS/iPadOS, distinct from macOS
        assert main._VULN_SERVICE_PLATFORM_MAP["android"] == "android"
        assert main._VULN_SERVICE_PLATFORM_MAP["aosp"] == "android"  # best-effort, no separate AOSP product line
        assert main._VULN_SERVICE_PLATFORM_MAP["windows"] == "windows"

    def test_unrecognized_platform_has_no_mapping(self, main):
        assert main._VULN_SERVICE_PLATFORM_MAP.get("other") is None


class TestComputeVulnServiceStatus:
    def test_unsupported_platform_returns_none(self, main):
        device = {"platform": "other", "osVersion": "1.0"}
        assert main._compute_vuln_service_status(device, {"apps": {}, "os": {}}, {}) is None

    def test_covered_platform_with_nothing_cached_yet_returns_unchecked_shell(self, main):
        device = {"platform": "macos", "osVersion": "14.5"}
        status = main._compute_vuln_service_status(device, {"apps": {}, "os": {}}, {})
        assert status["checked"] is False
        assert status["counts"] == {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
        assert status["hasKev"] is False

    def test_never_cached_shell_has_no_last_checked_at(self, main):
        # Never queried at all — lastCheckedAt is None, which is what the UI
        # uses to say "waiting on the next scheduled refresh" rather than
        # "was checked before, that data's just old now."
        device = {"platform": "macos", "osVersion": "14.5"}
        status = main._compute_vuln_service_status(device, {"apps": {}, "os": {}}, {})
        assert status["lastCheckedAt"] is None

    def test_stale_shell_reports_when_it_was_last_checked(self, main):
        # A cache entry exists (so this device WAS checked at some point)
        # but it's aged out — lastCheckedAt should surface that timestamp
        # even though the entry itself is no longer trusted as current.
        device = {"platform": "macos", "osVersion": "14.5"}
        stale_ts = _stale_iso()
        cache = {"os": {"macos|14.5": {"result": {"mapped": True, "counts": {}, "uncertain": 0, "cve_list": []}, "fetchedAt": stale_ts}}, "apps": {}}
        status = main._compute_vuln_service_status(device, cache, {})
        assert status["checked"] is False
        assert status["lastCheckedAt"] == stale_ts

    def test_stale_shell_uses_most_recent_of_os_and_app_timestamps(self, main):
        device = {"platform": "android", "osVersion": "14"}
        older = _stale_iso()
        newer = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()  # still stale (>24h), but more recent than `older`
        apps_entry = {"apps": [{"identifier": "com.example.app", "version": "2.0", "name": "Example"}]}
        cache = {
            "os": {"android|14": {"result": {"mapped": True, "counts": {}, "uncertain": 0, "cve_list": []}, "fetchedAt": older}},
            "apps": {"com.example.app|2.0|android": {"result": {"mapped": True, "counts": {}, "uncertain": 0, "cve_list": []}, "fetchedAt": newer}},
        }
        status = main._compute_vuln_service_status(device, cache, apps_entry)
        assert status["checked"] is False
        assert status["lastCheckedAt"] == newer

    def test_os_only_cache_hit_aggregates(self, main):
        device = {"platform": "windows", "osVersion": "10.0.19045"}
        cache = {
            "os": {"windows|10.0.19045": {"result": {
                "mapped": True, "counts": {"CRITICAL": 1, "HIGH": 0, "MEDIUM": 2, "LOW": 0}, "uncertain": 0,
                "cve_list": [{"id": "CVE-2024-1111", "severity": "CRITICAL", "score": 9.1, "is_kev": False, "epss_score": 0.2}],
            }, "fetchedAt": _fresh_iso()}},
            "apps": {},
        }
        status = main._compute_vuln_service_status(device, cache, {})
        assert status["checked"] is True
        assert status["counts"] == {"CRITICAL": 1, "HIGH": 0, "MEDIUM": 2, "LOW": 0}
        assert status["appsCheckedCount"] == 0
        assert status["hasKev"] is False
        assert status["maxEpss"] == 0.2

    def test_app_only_cache_hit_aggregates(self, main):
        device = {"platform": "android", "osVersion": "14"}
        apps_entry = {"apps": [{"identifier": "com.example.app", "version": "2.0", "name": "Example"}]}
        cache = {
            "os": {},
            "apps": {"com.example.app|2.0|android": {"result": {
                "mapped": True, "counts": {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 0, "LOW": 0}, "uncertain": 0,
                "cve_list": [{"id": "CVE-2024-2222", "severity": "HIGH", "score": 7.5, "is_kev": False, "epss_score": 0.1}],
            }, "fetchedAt": _fresh_iso()}},
        }
        status = main._compute_vuln_service_status(device, cache, apps_entry)
        assert status["checked"] is True
        assert status["appsCheckedCount"] == 1
        assert status["counts"]["HIGH"] == 1

    def test_unmapped_app_result_is_excluded(self, main):
        # The Worker returns mapped: False when it couldn't match the
        # identifier/version to anything in its CPE database — that should
        # not count as "checked" coverage for this app.
        device = {"platform": "android", "osVersion": "14"}
        apps_entry = {"apps": [{"identifier": "com.unknown.app", "version": "9.9", "name": "Unknown"}]}
        cache = {"os": {}, "apps": {"com.unknown.app|9.9|android": {"result": {"mapped": False, "counts": {}, "uncertain": 1, "cve_list": []}, "fetchedAt": _fresh_iso()}}}
        status = main._compute_vuln_service_status(device, cache, apps_entry)
        assert status["checked"] is False
        assert status["appsCheckedCount"] == 0

    def test_stale_cache_entries_are_ignored(self, main):
        device = {"platform": "macos", "osVersion": "14.5"}
        cache = {"os": {"macos|14.5": {"result": {"mapped": True, "counts": {"CRITICAL": 1, "HIGH": 0, "MEDIUM": 0, "LOW": 0}, "uncertain": 0, "cve_list": []}, "fetchedAt": _stale_iso()}}, "apps": {}}
        status = main._compute_vuln_service_status(device, cache, {})
        assert status["checked"] is False

    def test_kev_prioritized_first_in_top_cves_regardless_of_score(self, main):
        device = {"platform": "macos", "osVersion": "14.5"}
        cache = {
            "os": {"macos|14.5": {"result": {
                "mapped": True, "counts": {"CRITICAL": 2, "HIGH": 0, "MEDIUM": 0, "LOW": 0}, "uncertain": 0,
                "cve_list": [
                    {"id": "CVE-HIGH-SCORE-NOT-KEV", "severity": "CRITICAL", "score": 10.0, "is_kev": False, "epss_score": 0.05},
                    {"id": "CVE-LOWER-SCORE-IS-KEV", "severity": "CRITICAL", "score": 8.0, "is_kev": True, "epss_score": 0.9},
                ],
            }, "fetchedAt": _fresh_iso()}},
            "apps": {},
        }
        status = main._compute_vuln_service_status(device, cache, {})
        assert status["topCves"][0]["id"] == "CVE-LOWER-SCORE-IS-KEV"
        assert status["hasKev"] is True
        assert status["maxEpss"] == 0.9

    def test_combined_os_and_app_results_both_count(self, main):
        device = {"platform": "windows", "osVersion": "10.0.19045"}
        apps_entry = {"apps": [{"identifier": "acme.tool", "version": "3.1", "name": "Acme Tool"}]}
        cache = {
            "os": {"windows|10.0.19045": {"result": {"mapped": True, "counts": {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 0, "LOW": 0}, "uncertain": 0, "cve_list": []}, "fetchedAt": _fresh_iso()}},
            "apps": {"acme.tool|3.1|windows": {"result": {"mapped": True, "counts": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 1, "LOW": 0}, "uncertain": 0, "cve_list": []}, "fetchedAt": _fresh_iso()}},
        }
        status = main._compute_vuln_service_status(device, cache, apps_entry)
        assert status["counts"] == {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 1, "LOW": 0}
        assert status["appsCheckedCount"] == 1


class TestVulnServiceComplianceFields:
    def test_critical_high_count_matches_above_threshold(self, main):
        device = {"vulnServiceStatus": {"checked": True, "counts": {"CRITICAL": 1, "HIGH": 2, "MEDIUM": 0, "LOW": 0}}}
        assert main._evaluate_condition(device, _condition("vulnServiceCriticalHighCount", "greaterThan", 0)) is True

    def test_critical_high_count_never_matches_when_unchecked(self, main):
        device = {"vulnServiceStatus": {"checked": False, "counts": {"CRITICAL": 5, "HIGH": 5}}}
        assert main._evaluate_condition(device, _condition("vulnServiceCriticalHighCount", "greaterThan", 0)) is False

    def test_critical_high_count_never_matches_when_integration_disabled(self, main):
        device = {"vulnServiceStatus": None}
        assert main._evaluate_condition(device, _condition("vulnServiceCriticalHighCount", "greaterThan", 0)) is False

    def test_has_kev_true(self, main):
        device = {"vulnServiceStatus": {"checked": True, "hasKev": True}}
        assert main._evaluate_condition(device, _condition("vulnServiceHasKev", "equals", True)) is True

    def test_has_kev_false_when_unchecked(self, main):
        device = {"vulnServiceStatus": {"checked": False, "hasKev": True}}
        assert main._evaluate_condition(device, _condition("vulnServiceHasKev", "equals", True)) is False

    def test_checked_true_when_device_was_actually_checked(self, main):
        device = {"vulnServiceStatus": {"checked": True}}
        assert main._evaluate_condition(device, _condition("vulnServiceChecked", "equals", True)) is True

    def test_checked_false_when_integration_disabled(self, main):
        device = {"vulnServiceStatus": None}
        assert main._evaluate_condition(device, _condition("vulnServiceChecked", "equals", False)) is True
        assert main._evaluate_condition(device, _condition("vulnServiceChecked", "equals", True)) is False


class TestVulnServiceRiskScoring:
    def _base_device(self, **overrides):
        device = {
            "isCompliant": True, "selfReported": {}, "nativeSecurity": None,
            "osUpdateStatus": None, "vulnStatus": None, "osLifecycleStatus": None,
            "appleAppUpdateStatus": None, "vulnServiceStatus": None,
        }
        device.update(overrides)
        return device

    def test_unchecked_status_contributes_nothing(self, main):
        clean = main._compute_device_risk(self._base_device())
        device = self._base_device(vulnServiceStatus={"checked": False, "counts": {"CRITICAL": 9}, "hasKev": True})
        result = main._compute_device_risk(device)
        assert result["riskScore"] == clean["riskScore"]

    def test_none_status_contributes_nothing(self, main):
        clean = main._compute_device_risk(self._base_device())
        result = main._compute_device_risk(self._base_device(vulnServiceStatus=None))
        assert result["riskScore"] == clean["riskScore"]

    def test_critical_high_counts_add_points_and_factor(self, main):
        clean = main._compute_device_risk(self._base_device())
        device = self._base_device(vulnServiceStatus={"checked": True, "counts": {"CRITICAL": 2, "HIGH": 0, "MEDIUM": 0, "LOW": 0}, "hasKev": False, "maxEpss": 0.0})
        result = main._compute_device_risk(device)
        assert result["riskScore"] > clean["riskScore"]
        assert any("critical/high CVE" in f["label"] and "Vulnerability Service" in f["label"] for f in result["riskFactors"])

    def test_zero_counts_contribute_nothing(self, main):
        clean = main._compute_device_risk(self._base_device())
        device = self._base_device(vulnServiceStatus={"checked": True, "counts": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}, "hasKev": False, "maxEpss": 0.0})
        result = main._compute_device_risk(device)
        assert result["riskScore"] == clean["riskScore"]

    def test_kev_adds_extra_points_beyond_severity_counts(self, main):
        without_kev = main._compute_device_risk(self._base_device(
            vulnServiceStatus={"checked": True, "counts": {"CRITICAL": 1, "HIGH": 0, "MEDIUM": 0, "LOW": 0}, "hasKev": False, "maxEpss": 0.0}))
        with_kev = main._compute_device_risk(self._base_device(
            vulnServiceStatus={"checked": True, "counts": {"CRITICAL": 1, "HIGH": 0, "MEDIUM": 0, "LOW": 0}, "hasKev": True, "maxEpss": 0.95}))
        assert with_kev["riskScore"] > without_kev["riskScore"]
        assert any("known-exploited" in f["label"].lower() for f in with_kev["riskFactors"])

    def test_high_epss_without_kev_still_adds_points(self, main):
        clean = main._compute_device_risk(self._base_device())
        device = self._base_device(vulnServiceStatus={"checked": True, "counts": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}, "hasKev": False, "maxEpss": 0.8})
        result = main._compute_device_risk(device)
        assert result["riskScore"] > clean["riskScore"]
        assert any("exploitation-probability" in f["label"] for f in result["riskFactors"])

    def test_additive_with_euvd_vuln_status(self, main):
        # The two vulnerability signals (EUVD vulnStatus + Vulnerability
        # Service vulnServiceStatus) are independent and both score —
        # neither should suppress the other.
        only_euvd = main._compute_device_risk(self._base_device(
            vulnStatus={"confidence": "version", "pendingCount": 2, "pendingCves": [{"exploited": False}]}))
        both = main._compute_device_risk(self._base_device(
            vulnStatus={"confidence": "version", "pendingCount": 2, "pendingCves": [{"exploited": False}]},
            vulnServiceStatus={"checked": True, "counts": {"CRITICAL": 2, "HIGH": 0, "MEDIUM": 0, "LOW": 0}, "hasKev": False, "maxEpss": 0.0},
        ))
        assert both["riskScore"] > only_euvd["riskScore"]

    def test_score_still_caps_at_100_with_vuln_service_stacked_on(self, main):
        device = self._base_device(
            isCompliant=False,
            osUpdateStatus={"pendingCount": 50, "pendingKbs": [{"exploited": True}] * 5},
            vulnStatus={"confidence": "version", "pendingCount": 50, "pendingCves": [{"exploited": True}] * 5},
            osLifecycleStatus={"isEol": True},
            appleAppUpdateStatus={"pendingCount": 50},
            vulnServiceStatus={"checked": True, "counts": {"CRITICAL": 50, "HIGH": 50, "MEDIUM": 0, "LOW": 0}, "hasKev": True, "maxEpss": 1.0},
        )
        result = main._compute_device_risk(
            device,
            open_cases=[{"id": "c1"}, {"id": "c2"}, {"id": "c3"}],
            active_violations=[{"policyName": "p1"}, {"policyName": "p2"}, {"policyName": "p3"}],
        )
        assert result["riskScore"] == 100
        assert result["riskTier"] == "critical"


class TestVulnServiceRegistries:
    def test_compliance_fields_include_vuln_service_keys(self, main):
        keys = {f["key"] for f in main.COMPLIANCE_FIELDS}
        assert {"vulnServiceCriticalHighCount", "vulnServiceHasKev", "vulnServiceChecked"} <= keys

    def test_exportable_config_stores_include_vuln_service_config(self, main):
        assert main.EXPORTABLE_CONFIG_STORES.get("vulnServiceConfig") == ("vuln_service_config", dict)

    def test_registered_in_system_health_jobs_for_alerting(self, main):
        # The ONLY thing that gets a background loop failure-alerted anywhere
        # in this app is being listed here — see system_health_monitor_loop.
        # Forgetting this line would mean vuln_service_refresh_loop could
        # fail every tick forever with nobody ever notified.
        assert "vuln_service_refresh" in main.SYSTEM_HEALTH_JOBS
        assert main.SYSTEM_HEALTH_JOBS["vuln_service_refresh"]["intervalSeconds"] == main.VULN_SERVICE_TICK_SECONDS


class _FakeRetryResponse:
    def __init__(self, status_code):
        self.status_code = status_code
        self.text = f"status {status_code}"

    def json(self):
        return {}


class _FakePostClient:
    """Replays a scripted sequence of outcomes, one per call — either an
    exception instance (raised) or a status code (wrapped in
    _FakeRetryResponse). Records how many times .post() was actually
    called so tests can assert retry counts precisely."""
    def __init__(self, outcomes):
        self._outcomes = list(outcomes)
        self.calls = 0

    async def post(self, url, headers=None, json=None, timeout=None):
        outcome = self._outcomes[self.calls]
        self.calls += 1
        if isinstance(outcome, Exception):
            raise outcome
        return _FakeRetryResponse(outcome)


@pytest.fixture(autouse=True)
def _no_real_sleep(monkeypatch, main):
    """Every retry test below intentionally exercises 1-2 backoff sleeps —
    patched to instant so the suite doesn't take multiple real seconds."""
    async def _instant_sleep(_seconds):
        return None
    monkeypatch.setattr(main.asyncio, "sleep", _instant_sleep)


class TestVulnServicePostWithRetry:
    def test_succeeds_immediately_no_retry_needed(self, main):
        client = _FakePostClient([200])
        res = asyncio.run(main._vuln_service_post_with_retry(client, "https://x/test", {}, {}, timeout=5.0))
        assert res.status_code == 200
        assert client.calls == 1

    def test_retries_on_connection_error_then_succeeds(self, main):
        client = _FakePostClient([ConnectionError("refused"), 200])
        res = asyncio.run(main._vuln_service_post_with_retry(client, "https://x/test", {}, {}, timeout=5.0))
        assert res.status_code == 200
        assert client.calls == 2

    def test_retries_on_retryable_status_then_succeeds(self, main):
        client = _FakePostClient([503, 200])
        res = asyncio.run(main._vuln_service_post_with_retry(client, "https://x/test", {}, {}, timeout=5.0))
        assert res.status_code == 200
        assert client.calls == 2

    def test_does_not_retry_permanent_4xx(self, main):
        # 401 (bad token) is not in the retryable set — first attempt's
        # result is returned as-is, no wasted retries on a permanent error.
        client = _FakePostClient([401, 200])
        res = asyncio.run(main._vuln_service_post_with_retry(client, "https://x/test", {}, {}, timeout=5.0))
        assert res.status_code == 401
        assert client.calls == 1

    def test_exhausts_retries_and_returns_last_bad_response(self, main):
        client = _FakePostClient([503, 502, 500])
        res = asyncio.run(main._vuln_service_post_with_retry(client, "https://x/test", {}, {}, timeout=5.0))
        assert res.status_code == 500
        assert client.calls == main._VULN_SERVICE_MAX_ATTEMPTS

    def test_exhausts_retries_and_raises_last_connection_error(self, main):
        client = _FakePostClient([ConnectionError("a"), ConnectionError("b"), ConnectionError("c")])
        with pytest.raises(ConnectionError, match="c"):
            asyncio.run(main._vuln_service_post_with_retry(client, "https://x/test", {}, {}, timeout=5.0))
        assert client.calls == main._VULN_SERVICE_MAX_ATTEMPTS


class TestVulnServiceCacheEviction:
    def test_evicts_entries_no_longer_in_current_fleet(self, main):
        cache = {
            "os": {"macos|14.0": {"result": {}, "fetchedAt": "x"}, "windows|10.0": {"result": {}, "fetchedAt": "x"}},
            "apps": {"com.old.app|1.0|macos": {"result": {}, "fetchedAt": "x"}},
        }
        removed = main._evict_orphaned_vuln_service_cache_entries(cache, os_combos={"macos|14.0": ("macos", "14.0")}, app_combos={})
        assert removed == 2
        assert list(cache["os"].keys()) == ["macos|14.0"]
        assert cache["apps"] == {}

    def test_keeps_entries_still_present_in_current_fleet(self, main):
        cache = {"os": {"macos|14.0": {"result": {}, "fetchedAt": "x"}}, "apps": {}}
        removed = main._evict_orphaned_vuln_service_cache_entries(cache, os_combos={"macos|14.0": ("macos", "14.0")}, app_combos={})
        assert removed == 0
        assert "macos|14.0" in cache["os"]

    def test_empty_cache_evicts_nothing(self, main):
        cache = {"os": {}, "apps": {}}
        removed = main._evict_orphaned_vuln_service_cache_entries(cache, os_combos={}, app_combos={})
        assert removed == 0
