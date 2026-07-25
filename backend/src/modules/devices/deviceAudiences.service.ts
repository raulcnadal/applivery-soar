import { appliveryClient } from "../../services/appliveryClient";
import { liveCacheGet, liveCacheInvalidateSource, liveCacheSet } from "../../services/liveCache";
import { extractItems } from "../../utils/extractItems";
import { HttpError } from "../../utils/httpError";
import { resolveOrgBase } from "../auth/rbac.service";
import { getDevicesFull } from "./devices.service";
import type { DeviceAudienceCreatePayload } from "./devices.schemas";

type Headers = Record<string, string>;

/**
 * Device Audiences are entirely Applivery-side resources in the original
 * app (main.py:3728-4083) — there is NO local Postgres persistence, unlike
 * most other SOAR resources. List/create both proxy straight through to
 * Applivery; the only local state is the live-cache TTL entry (same
 * pattern as segments/policies/apps). The `DeviceAudience` Prisma model in
 * schema.prisma is declared for a possible future local mirror but is not
 * written to here, matching the original exactly.
 */
export async function listDeviceAudiences(authorization: string, workspaceSlug: string) {
  const slugKey = workspaceSlug || "global";
  const cached = liveCacheGet(slugKey, "device_audiences");
  if (cached !== null) return cached;

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const res = await appliveryClient.get<any>(`${orgBase}/mdm/device-audiences`, { headers, params: { limit: 500 } });
  if (res.status !== 200) throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  const items = extractItems(res.data);
  const result = { items: items.map((a) => ({ id: String(a.id ?? a._id ?? ""), name: a.name ?? "Unnamed audience" })) };
  liveCacheSet(slugKey, "device_audiences", result);
  return result;
}

/** Port of `create_device_audience` (main.py:4053). */
export async function createDeviceAudience(authorization: string, workspaceSlug: string, payload: DeviceAudienceCreatePayload) {
  if (!payload.name.trim()) throw new HttpError(400, "Give the audience a name.");

  const slugKey = workspaceSlug || "global";
  const body: Record<string, unknown> = { name: payload.name.trim(), selectors: payload.selectors };
  if (payload.description && payload.description.trim()) body.description = payload.description.trim();

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const res = await appliveryClient.post<any>(`${orgBase}/mdm/device-audiences`, body, { headers });
  if (res.status !== 200 && res.status !== 201) {
    throw new HttpError(502, `Applivery rejected the audience: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  }
  const data = (res.data as any)?.data ?? res.data ?? {};

  liveCacheInvalidateSource(slugKey, "device_audiences"); // so the next picker load sees it
  return { id: String(data.id ?? data._id ?? ""), name: data.name ?? payload.name };
}

/**
 * Direct, single-audience diagnostic call — port of
 * `_diagnose_device_audience_preview` (main.py:3822). Used only when the
 * aggregate pipeline (fetchDeviceAudienceMembershipMap, inside
 * getDevicesFull) reports zero matched devices for an audience, to
 * distinguish "Applivery itself has zero members" from "an id-space
 * resolution bug hid real members" without needing server log access.
 */
async function diagnoseDeviceAudiencePreview(headers: Headers, orgBase: string, audienceId: string) {
  const result: {
    httpStatus: number | null;
    error: string | null;
    rawMemberCount: number;
    totalDocs: number | null;
    rawMembers: Array<{ id: string; displayName: unknown; platformKey: unknown }>;
  } = { httpStatus: null, error: null, rawMemberCount: 0, totalDocs: null, rawMembers: [] };

  let payload: any;
  try {
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/device-audiences/${audienceId}/preview`, { headers, params: { limit: 100 } });
    result.httpStatus = res.status;
    if (res.status !== 200) {
      result.error = String(JSON.stringify(res.data)).slice(0, 500);
      return result;
    }
    payload = res.data;
  } catch (e) {
    result.error = String(e).slice(0, 500);
    return result;
  }

  const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload.data ?? payload : payload;
  const items = extractItems(payload);
  result.totalDocs = data && typeof data === "object" ? data.totalDocs ?? null : null;
  for (const dev of items) {
    const memberId = dev.id ?? dev._id;
    if (!memberId) continue;
    result.rawMemberCount += 1;
    if (result.rawMembers.length < 20) {
      result.rawMembers.push({ id: String(memberId), displayName: dev.displayName, platformKey: dev.deviceType ?? dev.platform ?? "" });
    }
  }
  return result;
}

/**
 * Given a Device Audience id, return which devices currently belong to it —
 * port of `get_device_audience_matched_devices` (main.py:3758). Deliberately
 * reuses getDevicesFull's own `deviceAudiences` field (populated by
 * fetchDeviceAudienceMembershipMap) rather than re-deriving membership
 * independently, guaranteeing this matches whatever the future Compliance
 * Policy evaluation engine (Phase 3) will scope against. Forces refresh=true
 * for the same staleness reason the original does: an audience assignment
 * made moments ago must be visible immediately.
 */
export async function getDeviceAudienceMatchedDevices(authorization: string, workspaceSlug: string, audienceId: string) {
  const devicesResp = await getDevicesFull(authorization, workspaceSlug, true);
  const devices = devicesResp.items;
  const matched = devices.filter((d) => (d.deviceAudiences ?? []).some((a) => String(a.id) === String(audienceId)));

  let diagnostics = null;
  if (matched.length === 0) {
    const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
    const orgBase = await resolveOrgBase(headers, workspaceSlug);
    diagnostics = await diagnoseDeviceAudiencePreview(headers, orgBase, audienceId);
  }

  return {
    items: matched.map((d) => ({
      id: d.id,
      displayName: d.displayName,
      platform: d.platform,
      platformLabel: d.platformLabel,
      isCompliant: d.isCompliant,
      state: d.state,
    })),
    total: matched.length,
    diagnostics,
  };
}
