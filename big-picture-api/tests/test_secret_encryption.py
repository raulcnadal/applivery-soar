"""Regression coverage for extending the Vulnerability Service's existing
Fernet-at-rest secret encryption (see test_vuln_service.py's
TestVulnServiceSecretEncryption) to the rest of the credentials a workspace
admin enters into Settings: Integrations (Jira/ServiceNow/PagerDuty/
Opsgenie/chat webhook URLs), Threat Intel providers (VirusTotal/AbuseIPDB/
HIBP API keys), and the SMTP password on dashboard_state.

Focus areas:
1. _decrypt_secret_migrating — the legacy-plaintext-safe decrypt helper
   these fields use instead of the strict _decrypt_secret.
2. _encrypt_integration_config/_decrypt_integration_config and
   _encrypt_threat_intel_config/_decrypt_threat_intel_config — per-type
   secret-field whitelists, round-tripped and confirmed to leave
   non-secret fields untouched.
3. _load_integrations/_save_integrations and
   _load_threat_intel_providers/_save_threat_intel_providers — the actual
   at-rest ciphertext (read back raw via _store_load) differs from the
   plaintext the wrapper functions hand back to every other call site.
4. _load_state/_save_state — same coverage for smtpConfig.pass.
5. Backward compatibility — a row written before this change (raw
   plaintext, as if by an older version of this app) is still read
   correctly, not silently blanked, by every wrapper above.
"""
import uuid

import pytest


@pytest.fixture
def slug():
    return f"test-secretenc-{uuid.uuid4().hex[:12]}"


class TestDecryptSecretMigrating:
    def test_round_trips_genuine_ciphertext(self, main):
        ciphertext = main._encrypt_secret("hunter2")
        assert ciphertext.startswith("gAAAAA")
        assert main._decrypt_secret_migrating(ciphertext) == "hunter2"

    def test_legacy_plaintext_passes_through_unchanged(self, main):
        # A value saved before this field was ever encrypted — doesn't
        # start with the Fernet "gAAAAA" prefix, so it's returned as-is
        # rather than run through Fernet and lost.
        assert main._decrypt_secret_migrating("xoxb-legacy-slack-webhook-token") == "xoxb-legacy-slack-webhook-token"

    def test_empty_string_returns_empty(self, main):
        assert main._decrypt_secret_migrating("") == ""

    def test_corrupt_ciphertext_shaped_value_blanks_not_raises(self, main):
        # Starts with the Fernet prefix but isn't actually valid (e.g.
        # DASHBOARD_SECRET rotated, or genuinely corrupt) — same
        # fail-blank-not-crash contract as _decrypt_secret itself.
        assert main._decrypt_secret_migrating("gAAAAA-not-actually-valid") == ""


class TestIntegrationConfigEncryption:
    def test_jira_api_token_encrypted_then_decrypted(self, main):
        encrypted = main._encrypt_integration_config("jira", {"apiToken": "jira-secret-123", "baseUrl": "https://x.atlassian.net"})
        assert encrypted["apiToken"] != "jira-secret-123"
        assert encrypted["apiToken"].startswith("gAAAAA")
        assert encrypted["baseUrl"] == "https://x.atlassian.net"  # non-secret field untouched
        decrypted = main._decrypt_integration_config("jira", encrypted)
        assert decrypted["apiToken"] == "jira-secret-123"

    def test_servicenow_password_field(self, main):
        encrypted = main._encrypt_integration_config("servicenow", {"password": "sn-pass", "username": "admin"})
        assert encrypted["password"] != "sn-pass"
        assert encrypted["username"] == "admin"
        assert main._decrypt_integration_config("servicenow", encrypted)["password"] == "sn-pass"

    def test_chat_webhook_url_encrypted_for_slack_teams_discord(self, main):
        for itype in ("slack", "teams", "discord"):
            encrypted = main._encrypt_integration_config(itype, {"webhookUrl": "https://hooks.example.com/secret"})
            assert encrypted["webhookUrl"] != "https://hooks.example.com/secret"
            assert main._decrypt_integration_config(itype, encrypted)["webhookUrl"] == "https://hooks.example.com/secret"

    def test_generic_webhook_url_encrypted(self, main):
        encrypted = main._encrypt_integration_config("generic_webhook", {"url": "https://example.com/hook?token=abc"})
        assert encrypted["url"] != "https://example.com/hook?token=abc"
        assert main._decrypt_integration_config("generic_webhook", encrypted)["url"] == "https://example.com/hook?token=abc"

    def test_pagerduty_routing_key_and_opsgenie_api_key(self, main):
        pd = main._encrypt_integration_config("pagerduty", {"routingKey": "pd-routing-key"})
        assert pd["routingKey"] != "pd-routing-key"
        assert main._decrypt_integration_config("pagerduty", pd)["routingKey"] == "pd-routing-key"

        og = main._encrypt_integration_config("opsgenie", {"apiKey": "og-api-key", "region": "eu"})
        assert og["apiKey"] != "og-api-key"
        assert og["region"] == "eu"
        assert main._decrypt_integration_config("opsgenie", og)["apiKey"] == "og-api-key"

    def test_empty_config_value_is_left_empty_not_encrypted(self, main):
        # Nothing to protect — encrypting "" would just waste a Fernet
        # token and complicate the "is this field set" check elsewhere.
        encrypted = main._encrypt_integration_config("jira", {"apiToken": ""})
        assert encrypted["apiToken"] == ""

    def test_unknown_type_is_a_no_op(self, main):
        # No _INTEGRATION_SECRET_FIELDS entry for this type — config passes
        # through unchanged rather than raising.
        cfg = {"someField": "someValue"}
        assert main._encrypt_integration_config("not-a-real-type", cfg) == cfg


class TestIntegrationsStoreEncryptsAtRest:
    def test_saved_integration_is_ciphertext_on_disk_but_plaintext_via_loader(self, main, slug):
        integrations = [{
            "id": "int-1", "name": "Prod Jira", "type": "jira", "enabled": True,
            "config": {"apiToken": "at-rest-secret", "baseUrl": "https://x.atlassian.net"},
        }]
        main._save_integrations(slug, integrations)

        raw = main._store_load(slug, "integrations", list)
        assert raw[0]["config"]["apiToken"] != "at-rest-secret"
        assert raw[0]["config"]["apiToken"].startswith("gAAAAA")

        loaded = main._load_integrations(slug)
        assert loaded[0]["config"]["apiToken"] == "at-rest-secret"
        assert loaded[0]["name"] == "Prod Jira"  # non-secret fields pass through untouched

    def test_legacy_plaintext_row_still_reads_correctly(self, main, slug):
        # Simulates data written by a version of this app before secret
        # encryption existed on this store — a raw plaintext write,
        # bypassing _save_integrations entirely.
        main._store_save(slug, "integrations", [{
            "id": "int-legacy", "name": "Old Slack", "type": "slack", "enabled": True,
            "config": {"webhookUrl": "https://hooks.slack.com/services/legacy-plaintext"},
        }])
        loaded = main._load_integrations(slug)
        assert loaded[0]["config"]["webhookUrl"] == "https://hooks.slack.com/services/legacy-plaintext"

    def test_resaving_a_legacy_row_upgrades_it_to_ciphertext(self, main, slug):
        main._store_save(slug, "integrations", [{
            "id": "int-legacy", "name": "Old Slack", "type": "slack", "enabled": True,
            "config": {"webhookUrl": "https://hooks.slack.com/services/legacy-plaintext"},
        }])
        loaded = main._load_integrations(slug)
        main._save_integrations(slug, loaded)  # e.g. an admin edits and re-saves via PUT

        raw = main._store_load(slug, "integrations", list)
        assert raw[0]["config"]["webhookUrl"].startswith("gAAAAA")
        assert main._load_integrations(slug)[0]["config"]["webhookUrl"] == "https://hooks.slack.com/services/legacy-plaintext"


class TestThreatIntelStoreEncryptsAtRest:
    def test_virustotal_api_key_encrypted_at_rest(self, main, slug):
        main._save_threat_intel_providers(slug, [{
            "id": "ti-1", "name": "VT", "type": "virustotal", "enabled": True,
            "config": {"apiKey": "vt-api-key-123"},
        }])
        raw = main._store_load(slug, "threat_intel_providers", list)
        assert raw[0]["config"]["apiKey"] != "vt-api-key-123"
        assert main._load_threat_intel_providers(slug)[0]["config"]["apiKey"] == "vt-api-key-123"

    def test_generic_rest_url_template_untouched(self, main, slug):
        # No well-known single secret field for generic_rest — left as-is.
        main._save_threat_intel_providers(slug, [{
            "id": "ti-2", "name": "Custom", "type": "generic_rest", "enabled": True,
            "config": {"urlTemplate": "https://api.example.com/lookup?q={{ ioc }}"},
        }])
        loaded = main._load_threat_intel_providers(slug)
        assert loaded[0]["config"]["urlTemplate"] == "https://api.example.com/lookup?q={{ ioc }}"

    def test_legacy_plaintext_provider_still_reads_correctly(self, main, slug):
        main._store_save(slug, "threat_intel_providers", [{
            "id": "ti-legacy", "name": "Old AbuseIPDB", "type": "abuseipdb", "enabled": True,
            "config": {"apiKey": "legacy-plaintext-key"},
        }])
        assert main._load_threat_intel_providers(slug)[0]["config"]["apiKey"] == "legacy-plaintext-key"


class TestSmtpPasswordEncryptedAtRest:
    def test_smtp_password_encrypted_on_save_decrypted_on_load(self, main, slug):
        main._save_state(slug, {"smtpConfig": {"host": "smtp.example.com", "user": "bot@example.com", "pass": "smtp-secret-pw", "port": 587}})

        raw = main._store_load(main._state_slug_key(slug), "dashboard_state", dict)
        assert raw["smtpConfig"]["pass"] != "smtp-secret-pw"
        assert raw["smtpConfig"]["pass"].startswith("gAAAAA")
        assert raw["smtpConfig"]["host"] == "smtp.example.com"  # non-secret field untouched

        loaded = main._load_state(slug)
        assert loaded["smtpConfig"]["pass"] == "smtp-secret-pw"
        assert loaded["smtpConfig"]["host"] == "smtp.example.com"

    def test_legacy_plaintext_smtp_password_still_reads_correctly(self, main, slug):
        main._store_save(main._state_slug_key(slug), "dashboard_state", {"smtpConfig": {"host": "smtp.example.com", "pass": "legacy-plaintext-pw"}})
        assert main._load_state(slug)["smtpConfig"]["pass"] == "legacy-plaintext-pw"

    def test_state_without_smtp_config_is_unaffected(self, main, slug):
        main._save_state(slug, {"themeMode": "dark"})
        loaded = main._load_state(slug)
        assert loaded["themeMode"] == "dark"
        assert "smtpConfig" not in loaded

    def test_smtp_config_without_password_is_unaffected(self, main, slug):
        # e.g. an admin hasn't configured SMTP yet, or only set host/user.
        main._save_state(slug, {"smtpConfig": {"host": "smtp.example.com"}})
        raw = main._store_load(main._state_slug_key(slug), "dashboard_state", dict)
        assert raw["smtpConfig"] == {"host": "smtp.example.com"}

    def test_save_state_merge_preserves_encrypted_password_when_untouched(self, main, slug):
        # Mirrors the real POST /api/state handler's "load existing, merge
        # payload fields, save" pattern — editing an unrelated setting
        # (themeMode) shouldn't disturb an already-configured SMTP password.
        main._save_state(slug, {"smtpConfig": {"host": "smtp.example.com", "pass": "smtp-secret-pw"}})
        existing = main._load_state(slug)
        existing.update({"themeMode": "dark"})
        main._save_state(slug, existing)
        assert main._load_state(slug)["smtpConfig"]["pass"] == "smtp-secret-pw"
        assert main._load_state(slug)["themeMode"] == "dark"
