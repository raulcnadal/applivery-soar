import { appliveryClient } from "../../services/appliveryClient";
import { liveCacheGet, liveCacheSet } from "../../services/liveCache";
import { extractItems } from "../../utils/extractItems";
import { HttpError } from "../../utils/httpError";
import { resolveOrgBase } from "../auth/rbac.service";
import { platformPathSegment } from "./deviceNormalize";

type Headers = Record<string, string>;

/** List assignable MDM policies for a platform — port of `get_policies` (main.py:3661). */
export async function getPolicies(authorization: string, workspaceSlug: string, platform: string) {
  const platformPath = platformPathSegment(platform);
  if (!platformPath) throw new HttpError(400, `Unsupported platform '${platform}' for policy listing`);

  const slugKey = workspaceSlug || "global";
  const cacheSource = `policies_${platformPath}`;
  const cached = liveCacheGet(slugKey, cacheSource);
  if (cached !== null) return cached;

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const res = await appliveryClient.get<any>(`${orgBase}/mdm/${platformPath}/enterprise/policies/`, { headers, params: { limit: 500 } });
  if (res.status !== 200) throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  const items = extractItems(res.data);
  const result = { items: items.map((p) => ({ id: String(p.id ?? p._id ?? ""), name: p.name ?? "Unnamed policy" })) };
  liveCacheSet(slugKey, cacheSource, result);
  return result;
}

const OSS_MAP: Record<string, string> = { apple: "ios", macos: "macos", android: "android", windows: "windows", aosp: "aosp" };

/** List Applivery App Distribution catalog apps for a platform — port of `get_apps` (main.py:3692). */
export async function getApps(authorization: string, workspaceSlug: string, platform: string) {
  const oss = OSS_MAP[platform];
  if (!oss) throw new HttpError(400, `Unsupported platform '${platform}' for app listing`);

  const slugKey = workspaceSlug || "global";
  const cacheSource = `apps_${oss}`;
  const cached = liveCacheGet(slugKey, cacheSource);
  if (cached !== null) return cached;

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const res = await appliveryClient.get<any>(`${orgBase}/apps`, { headers, params: { oss, limit: 500 } });
  if (res.status !== 200) throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  const items = extractItems(res.data);
  const result = { items: items.map((a) => ({ id: String(a.id ?? a._id ?? ""), name: a.name ?? "Unnamed app" })) };
  liveCacheSet(slugKey, cacheSource, result);
  return result;
}

/** GET /segments returns a nested tree; flatten with a breadcrumb label — port of `_flatten_segment_tree` (main.py:3880). */
function flattenSegmentTree(nodes: Array<Record<string, any>>, prefix = ""): Array<{ id: string; name: string }> {
  const flat: Array<{ id: string; name: string }> = [];
  for (const n of nodes ?? []) {
    if (!n || typeof n !== "object") continue;
    const label = `${prefix}${n.name ?? "Unnamed segment"}`;
    flat.push({ id: String(n.id), name: label });
    flat.push(...flattenSegmentTree(n.children ?? [], `${label} / `));
  }
  return flat;
}

/** List Segments for pickers — port of `get_segments_list` (main.py:3893). */
export async function getSegments(authorization: string, workspaceSlug: string) {
  const slugKey = workspaceSlug || "global";
  const cached = liveCacheGet(slugKey, "segments");
  if (cached !== null) return cached;

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const res = await appliveryClient.get<any>(`${orgBase}/segments`, { headers });
  if (res.status !== 200) throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  const data = res.data && typeof res.data === "object" ? (res.data as any).data ?? res.data : res.data;
  const result = { items: flattenSegmentTree(data?.children ?? []) };
  liveCacheSet(slugKey, "segments", result);
  return result;
}

export interface SegmentTreeNode {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  children: SegmentTreeNode[];
}

function toSegmentTree(nodes: Array<Record<string, any>>): SegmentTreeNode[] {
  const out: SegmentTreeNode[] = [];
  for (const n of nodes ?? []) {
    if (!n || typeof n !== "object") continue;
    out.push({
      id: String(n.id ?? n._id ?? ""),
      name: n.name ?? "Unnamed segment",
      icon: n.icon !== undefined ? String(n.icon) : n.iconId !== undefined ? String(n.iconId) : null,
      color: n.color !== undefined ? String(n.color) : n.colorId !== undefined ? String(n.colorId) : null,
      children: toSegmentTree(n.children ?? []),
    });
  }
  return out;
}

/**
 * Nested segment tree for the Segments panel (App.jsx's left-edge hover
 * panel, App.jsx:4464-4515) — distinct from `getSegments` above, which
 * flattens the same tree into breadcrumb-labeled picker options. The
 * original fetched this directly from the browser
 * (`https://api.applivery.io/v1/organizations/{orgId}/segments/0`, with a
 * `/segments/by-user` fallback if that 404s) using the user's own Applivery
 * token; ported here as a proper backend proxy instead — same reasoning as
 * the Playground device-extras move (this app's own request logging/error
 * handling, no raw Applivery token round-tripping through client JS beyond
 * what's unavoidable). Reuses the same `${orgBase}/segments` call as
 * `getSegments` (already confirmed to return the identical nested-tree
 * shape `/segments/0` would), just without the breadcrumb flattening.
 */
export async function getSegmentsTree(authorization: string, workspaceSlug: string): Promise<{ items: SegmentTreeNode[] }> {
  const slugKey = workspaceSlug || "global";
  const cached = liveCacheGet<{ items: SegmentTreeNode[] }>(slugKey, "segments_tree");
  if (cached !== null) return cached;

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const res = await appliveryClient.get<any>(`${orgBase}/segments`, { headers });
  if (res.status !== 200) throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  const data = res.data && typeof res.data === "object" ? (res.data as any).data ?? res.data : res.data;
  const result = { items: toSegmentTree(data?.children ?? []) };
  liveCacheSet(slugKey, "segments_tree", result);
  return result;
}

/** List Smart Attribute definitions for pickers — port of `get_smart_attributes_list` (main.py:3923). */
export async function getSmartAttributes(authorization: string, workspaceSlug: string) {
  const slugKey = workspaceSlug || "global";
  const cached = liveCacheGet(slugKey, "smart_attributes");
  if (cached !== null) return cached;

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const res = await appliveryClient.get<any>(`${orgBase}/smart-attributes`, { headers, params: { limit: 500 } });
  if (res.status !== 200) throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  const items = extractItems(res.data);
  const result = { items: items.map((a) => ({ id: String(a.id ?? a._id ?? ""), name: a.name ?? "Unnamed attribute" })) };
  liveCacheSet(slugKey, "smart_attributes", result);
  return result;
}

/** All unique device tags in use across the fleet — port of `get_device_tags_list` (main.py:3953). */
export async function getDeviceTags(authorization: string, workspaceSlug: string) {
  const slugKey = workspaceSlug || "global";
  const cached = liveCacheGet(slugKey, "device_tags");
  if (cached !== null) return cached;

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const res = await appliveryClient.get<any>(`${orgBase}/mdm/devices/tags`, { headers });
  if (res.status !== 200) throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  const items = extractItems(res.data);
  const result = { items: Array.from(new Set(items.map((t) => String(t.value)).filter(Boolean))).sort() };
  liveCacheSet(slugKey, "device_tags", result);
  return result;
}

/** All unique employee (MDM user) tags — port of `get_mdm_user_tags_list` (main.py:3983). */
export async function getMdmUserTags(authorization: string, workspaceSlug: string) {
  const slugKey = workspaceSlug || "global";
  const cached = liveCacheGet(slugKey, "mdm_user_tags");
  if (cached !== null) return cached;

  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const res = await appliveryClient.get<any>(`${orgBase}/mdm/users/tags`, { headers });
  if (res.status !== 200) throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  const items = extractItems(res.data);
  const result = { items: Array.from(new Set(items.map((t) => String(t.value)).filter(Boolean))).sort() };
  liveCacheSet(slugKey, "mdm_user_tags", result);
  return result;
}

/** Employee (MDM user) picker — port of `get_mdm_users_list` (main.py:4012). Not cached — search should reflect live results. */
export async function getMdmUsers(authorization: string, workspaceSlug: string, search?: string) {
  const headers: Headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const params: Record<string, unknown> = { limit: 500 };
  if (search) params.search = search;
  const res = await appliveryClient.get<any>(`${orgBase}/mdm/users`, { headers, params });
  if (res.status !== 200) throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
  const items = extractItems(res.data);
  return { items: items.map((u) => ({ id: String(u.id ?? u._id ?? ""), email: u.email ?? "", name: u.name ?? u.email ?? "Unnamed" })) };
}

// Deployment model options offered in the workflow builder's Step 2 — port
// of DEPLOYMENT_MODELS (main.py:5497). Windows has one management model so
// it's skipped entirely, matching the original.
export const DEPLOYMENT_MODELS: Record<string, Array<{ value: string; label: string }>> = {
  apple: [
    { value: "supervised", label: "Supervised" },
    { value: "unsupervised", label: "Unsupervised" },
  ],
  macos: [
    { value: "supervised", label: "Supervised" },
    { value: "unsupervised", label: "Unsupervised" },
  ],
  android: [
    { value: "work_profile", label: "Work Profile (BYOD)" },
    { value: "cope", label: "Corporate-Owned, Personally Enabled (COPE)" },
    { value: "device_owner", label: "Device Owner (Fully Managed)" },
  ],
};
