"""Regression coverage for _normalize_device_full's displayName fallback.

Surfaced while debugging the Device Audience linkage bug: once membership
resolution was actually working, the Policy Builder's "devices that will
receive this policy" box showed a real matched device as "Unknown Device"
instead of its real name. The device's own /mdm/devices/ list record
apparently omits both top-level `displayName` and `name` for this device,
even though a Device Audience preview response for the SAME device (curled
directly against the live tenant) carries the name under
`summary.name` (confirmed live: {"summary": {"name": "iPhone 14 Pro Max",
...}}). _normalize_device_full only checked raw.displayName/raw.name before
falling straight to the 'Unknown Device' default — missing the same
summary-first fallback pattern already used for imei/model/manufacturer/
osVersion just below it.
"""
import sys
sys.path.insert(0, ".")


def _raw(**overrides):
    base = {"id": "dev-1", "type": "apple"}
    base.update(overrides)
    return base


class TestDisplayNameFallback:
    def test_uses_top_level_display_name_when_present(self, main):
        raw = _raw(displayName="Top Level Name", name="Fallback Name", summary={"name": "Summary Name"})
        result = main._normalize_device_full(raw, comp_ids=set(), loc_cache={})
        assert result["displayName"] == "Top Level Name"

    def test_falls_back_to_top_level_name(self, main):
        raw = _raw(name="Fallback Name", summary={"name": "Summary Name"})
        result = main._normalize_device_full(raw, comp_ids=set(), loc_cache={})
        assert result["displayName"] == "Fallback Name"

    def test_falls_back_to_summary_name_when_top_level_fields_missing(self, main):
        # This is the actual bug: a real device whose /mdm/devices/ record
        # has neither displayName nor name at the top level, but does carry
        # the name under summary (confirmed via a live Device Audience
        # preview response for this exact device).
        raw = _raw(summary={"name": "iPhone 14 Pro Max"})
        result = main._normalize_device_full(raw, comp_ids=set(), loc_cache={})
        assert result["displayName"] == "iPhone 14 Pro Max"

    def test_falls_back_to_unknown_device_when_nothing_present(self, main):
        raw = _raw(summary={})
        result = main._normalize_device_full(raw, comp_ids=set(), loc_cache={})
        assert result["displayName"] == "Unknown Device"

    def test_falls_back_to_unknown_device_when_no_summary_key_at_all(self, main):
        raw = {"id": "dev-1", "type": "apple"}
        result = main._normalize_device_full(raw, comp_ids=set(), loc_cache={})
        assert result["displayName"] == "Unknown Device"
