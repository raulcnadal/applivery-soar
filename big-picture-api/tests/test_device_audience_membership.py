"""Regression coverage for _fetch_device_audience_membership_map.

History, kept honest rather than rewritten, because each pass narrowed the
real problem even when its specific fix was wrong:

Pass 1 (correct instinct, kept as defensive fallback): if the preview
endpoint's member entries return Applivery's PLATFORM-NATIVE device id (the
same id already used elsewhere in this file as admDevice/emmDevice/
winDevice — see _normalize_device_full's platform_device_id) rather than the
UNIFIED device id this app keys every device on (device['id']), a naive
audience_map keyed straight off the preview response would never match up
later. The fix — a reverse lookup from raw_devices' own admDevice/emmDevice/
winDevice fields — is kept and tested in
TestDeviceAudienceMembershipIdResolution below, though it turned out not to
be the live blocker (see pass 3).

Pass 2 (a misdiagnosis, since corrected): concluded, from an incomplete
docs-MCP keyword search that only surfaced Applivery's OTHER, separate POST
{org_base}/mdm/device-audiences/preview endpoint (an ad-hoc "preview an
arbitrary/prospective selectors object" tool), that the per-audience GET
{org_base}/mdm/device-audiences/{deviceAudienceId}/preview route didn't
exist, and switched this function to POST instead. Reverted — the GET route
was real all along.

Pass 3 (the actual, confirmed root cause — confirmed by the user running the
real curl command against their live tenant and pasting the response):
Applivery's own OpenAPI reference documents this endpoint's response as
{data: {emmDevices, admDevices, winDevices, aosDevices}} — a split-by-
platform shape. The REAL live response is {data: {items: [...], totalDocs,
hasNextPage, ...}} — a flat, paginated list of full device records, the
same envelope every other Applivery list endpoint in this app already uses.
Every previous pass, regardless of which URL it called, was parsing for
emmDevices/admDevices/winDevices/aosDevices keys that the real response
never has — so raw_member_count was always 0, on every single call, no
matter how correct the URL was. This function now reads `data.items` (via
extract_items, same as every other list call in this file) and paginates
through hasNextPage via _fetch_all_pages, matching the confirmed live shape
instead of the (apparently stale, for this account) documented one.
"""
import pytest


class FakeApplHttpResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


@pytest.fixture
def patch_applivery_call(monkeypatch, main):
    def _apply(responses):
        state = {"n": 0, "calls": []}

        async def fake_call(client, method, url, headers=None, **kwargs):
            state["calls"].append({"method": method, "url": url, **kwargs})
            idx = min(state["n"], len(responses) - 1)
            state["n"] += 1
            return responses[idx]

        monkeypatch.setattr(main, "_applivery_call", fake_call)
        return state
    return _apply


def _raw_device(unified_id, **platform_ids):
    d = {"id": unified_id, "displayName": f"Device {unified_id}"}
    d.update(platform_ids)
    return d


def _audience(aud_id, name):
    return {"id": aud_id, "name": name}


def _preview_page(items, has_next_page=False):
    """Matches the CONFIRMED live response envelope for GET
    .../mdm/device-audiences/{id}/preview — a flat, paginated `items` list,
    not the emmDevices/admDevices/winDevices/aosDevices split documented
    (incorrectly, for this account) in Applivery's OpenAPI reference."""
    return FakeApplHttpResponse(200, {"data": {
        "items": items, "totalDocs": len(items), "limit": 1000, "page": 1,
        "totalPages": 1, "hasPrevPage": False, "hasNextPage": has_next_page,
    }})


def _member(id, displayName="Some Device", deviceType="apple"):
    # Mirrors the real shape: {id, displayName, deviceType, state, summary, ...}
    return {"id": id, "displayName": displayName, "deviceType": deviceType, "state": "ACTIVE", "summary": {}}


class TestDeviceAudiencePreviewCallContract:
    """Confirms the fix calls the real endpoint the real way — GET
    .../mdm/device-audiences/{deviceAudienceId}/preview, keyed by the
    audience's own id in the URL path, no request body, and parses the real
    `items` envelope rather than the documented-but-wrong split arrays."""

    @pytest.mark.asyncio
    async def test_calls_get_preview_by_audience_id(self, main, patch_applivery_call):
        state = patch_applivery_call([
            FakeApplHttpResponse(200, {"data": {"items": [_audience("aud1", "iOS Devices")]}}),
            _preview_page([]),
        ])
        await main._fetch_device_audience_membership_map(None, {}, "https://api.applivery.io/v1/organizations/x")

        preview_call = state["calls"][1]
        assert preview_call["method"] == "GET"
        assert preview_call["url"] == "https://api.applivery.io/v1/organizations/x/mdm/device-audiences/aud1/preview"
        assert "json" not in preview_call  # no request body on this endpoint

    @pytest.mark.asyncio
    async def test_parses_real_flat_items_shape_not_the_documented_split_arrays(self, main, patch_applivery_call):
        # This is the actual regression test for the real bug: a response
        # shaped like Applivery's OpenAPI reference documents it (split by
        # platform) has NO `items` key, so extract_items would find nothing
        # — and a response shaped like the real live API (flat `items`) must
        # resolve correctly.
        raw_devices = [_raw_device("unified-1")]
        patch_applivery_call([
            FakeApplHttpResponse(200, {"data": {"items": [_audience("aud1", "iOS Devices")]}}),
            _preview_page([_member("unified-1", displayName="iPhone 14 Pro Max")]),
        ])
        audience_map = await main._fetch_device_audience_membership_map(None, {}, "https://api.applivery.io/v1/organizations/x", raw_devices=raw_devices)
        assert audience_map.get("unified-1") == [{"id": "aud1", "name": "iOS Devices"}]

    @pytest.mark.asyncio
    async def test_documented_split_array_shape_yields_no_members(self, main, patch_applivery_call):
        # Locks in why the earlier passes silently found nothing: a response
        # in the shape Applivery's docs describe (no top-level `items`) must
        # NOT be mistaken for having members — this app's extract_items
        # correctly returns [] for it, same as it always did.
        patch_applivery_call([
            FakeApplHttpResponse(200, {"data": {"items": [_audience("aud1", "iOS Devices")]}}),
            FakeApplHttpResponse(200, {"data": {"admDevices": [{"id": "adm-1"}], "emmDevices": [], "winDevices": [], "aosDevices": []}}),
        ])
        audience_map = await main._fetch_device_audience_membership_map(None, {}, "https://api.applivery.io/v1/organizations/x")
        assert audience_map == {}

    @pytest.mark.asyncio
    async def test_paginates_through_multiple_pages(self, main, patch_applivery_call):
        state = patch_applivery_call([
            FakeApplHttpResponse(200, {"data": {"items": [_audience("aud1", "Big Audience")]}}),
            _preview_page([_member("d1"), _member("d2")], has_next_page=True),
            _preview_page([_member("d3")], has_next_page=False),
        ])
        audience_map = await main._fetch_device_audience_membership_map(None, {}, "https://api.applivery.io/v1/organizations/x")
        assert set(audience_map.keys()) == {"d1", "d2", "d3"}
        # list call + 2 preview pages
        assert len(state["calls"]) == 3


class TestDeviceAudienceMembershipIdResolution:
    @pytest.mark.asyncio
    async def test_resolves_platform_native_member_id_to_unified_id(self, main, patch_applivery_call):
        # Kept as a defensive-fallback test even though the live shape's own
        # `id` is normally already the unified id — if some account variant
        # ever returns a platform-native id instead, this must still resolve.
        raw_devices = [_raw_device("unified-1", admDevice="adm-native-999")]
        patch_applivery_call([
            FakeApplHttpResponse(200, {"data": {"items": [_audience("aud1", "iOS Devices")]}}),
            _preview_page([_member("adm-native-999")]),
        ])
        audience_map = await main._fetch_device_audience_membership_map(None, {}, "https://api.applivery.io/v1/organizations/x", raw_devices=raw_devices)
        assert "unified-1" in audience_map
        assert audience_map["unified-1"] == [{"id": "aud1", "name": "iOS Devices"}]
        assert "adm-native-999" not in audience_map

    @pytest.mark.asyncio
    async def test_resolves_when_preview_already_returns_unified_id(self, main, patch_applivery_call):
        raw_devices = [_raw_device("unified-2", emmDevice="emm-native-42")]
        patch_applivery_call([
            FakeApplHttpResponse(200, {"data": {"items": [_audience("aud2", "Android Devices")]}}),
            _preview_page([_member("unified-2")]),
        ])
        audience_map = await main._fetch_device_audience_membership_map(None, {}, "https://api.applivery.io/v1/organizations/x", raw_devices=raw_devices)
        assert audience_map.get("unified-2") == [{"id": "aud2", "name": "Android Devices"}]

    @pytest.mark.asyncio
    async def test_unmatched_member_id_falls_back_instead_of_being_dropped(self, main, patch_applivery_call):
        raw_devices = [_raw_device("unified-3", winDevice="win-native-7")]
        patch_applivery_call([
            FakeApplHttpResponse(200, {"data": {"items": [_audience("aud3", "Windows Devices")]}}),
            _preview_page([_member("totally-unrelated-id")]),
        ])
        audience_map = await main._fetch_device_audience_membership_map(None, {}, "https://api.applivery.io/v1/organizations/x", raw_devices=raw_devices)
        assert audience_map.get("totally-unrelated-id") == [{"id": "aud3", "name": "Windows Devices"}]

    @pytest.mark.asyncio
    async def test_no_raw_devices_still_resolves_unified_ids(self, main, patch_applivery_call):
        patch_applivery_call([
            FakeApplHttpResponse(200, {"data": {"items": [_audience("aud4", "No Fleet Context")]}}),
            _preview_page([_member("some-id")]),
        ])
        audience_map = await main._fetch_device_audience_membership_map(None, {}, "https://api.applivery.io/v1/organizations/x")
        assert audience_map.get("some-id") == [{"id": "aud4", "name": "No Fleet Context"}]

    @pytest.mark.asyncio
    async def test_list_failure_returns_empty_map_and_logs(self, main, patch_applivery_call, capsys):
        patch_applivery_call([FakeApplHttpResponse(500, {"error": "boom"})])
        audience_map = await main._fetch_device_audience_membership_map(None, {}, "https://api.applivery.io/v1/organizations/x")
        assert audience_map == {}
        assert "[Device Audiences]" in capsys.readouterr().out

    @pytest.mark.asyncio
    async def test_preview_failure_for_one_audience_does_not_block_others(self, main, patch_applivery_call, capsys):
        raw_devices = [_raw_device("unified-5", admDevice="adm-5")]
        patch_applivery_call([
            FakeApplHttpResponse(200, {"data": {"items": [
                _audience("aud-broken", "Broken Audience"),
                _audience("aud-ok", "OK Audience"),
            ]}}),
            FakeApplHttpResponse(500, {"error": "boom"}),
            _preview_page([_member("adm-5")]),
        ])
        audience_map = await main._fetch_device_audience_membership_map(None, {}, "https://api.applivery.io/v1/organizations/x", raw_devices=raw_devices)
        assert audience_map.get("unified-5") == [{"id": "aud-ok", "name": "OK Audience"}]
        assert "[Device Audiences]" in capsys.readouterr().out
