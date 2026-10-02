import { env } from "../../config/env";
import { appliveryClient } from "../../services/appliveryClient";
import { extractItems } from "../../utils/extractItems";
import { HttpError } from "../../utils/httpError";
import type { ResolvedAccess, SoarRoleRecord } from "../../middleware/rbac.middleware";

/**
 * Ported from main.py lines 1121-1200 (_extract_collaborator_tag_candidates,
 * _fetch_collaborator_groups, _find_self_collaborator, _resolve_soar_access)
 * and _resolve_org_base (main.py:2871). "tags" is the confirmed Applivery
 * Collaborator field; the rest are a defensive fallback for older tenants.
 */
const COLLABORATOR_TAG_FIELD_CANDIDATES = [
  "tags",
  "tag",
  "label",
  "labels",
  "group",
  "groups",
  "roleTag",
  "customTag",
  "segmentRole",
];

export function extractCollaboratorTagCandidates(raw: Record<string, any>): string[] {
  const out: string[] = [];
  for (const field of COLLABORATOR_TAG_FIELD_CANDIDATES) {
    const value = raw?.[field];
    if (value === undefined || value === null) continue;
    const candidates = Array.isArray(value) ? value : [value];
    for (const c of candidates) {
      const s = String(c).trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

/** Resolves a workspace slug or 24-hex org id to "{base}/organizations/{hexId}". */
export async function resolveOrgBase(headers: Record<string, string>, workspaceSlug: string): Promise<string> {
  let hexId = workspaceSlug;
  if (!/^[a-fA-F0-9]{24}$/.test(workspaceSlug)) {
    const res = await appliveryClient.get(`/organizations/${workspaceSlug}`, { headers });
    if (res.status === 200) {
      const d = (res.data as any)?.data ?? res.data ?? {};
      hexId = d._id ?? d.id ?? workspaceSlug;
    }
  }
  return `${env.appliveryApiUrl}/organizations/${hexId}`;
}

/** GET {orgBase}/collaborators/groups — canonical org-wide list of tag values in use. */
export async function fetchCollaboratorGroups(orgBase: string, headers: Record<string, string>): Promise<string[]> {
  const res = await appliveryClient.get(`${orgBase}/collaborators/groups`, { headers });
  if (res.status !== 200) return [];
  const items = extractItems(res.data);
  const out: string[] = [];
  for (const i of items) {
    const v = i && typeof i === "object" ? i.value : i;
    const s = v != null ? String(v).trim() : "";
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Collaborator.role values ranked by privilege, highest first. Used to pick
 * a winner when one email resolves to more than one Collaborator record in
 * the same org (see findSelfCollaborator's doc comment) — an org can have
 * duplicate collaborator rows for the same address (e.g. a traditional
 * login account plus a separate SSO-auto-provisioned account that happens
 * to share the same email), and the real person's effective access is
 * whichever row grants them the most, never the lesser one.
 */
const ROLE_PRIVILEGE_ORDER = ["owner", "admin", "editor", "viewer", "unassigned"];

function rolePrivilegeRank(role: unknown): number {
  const idx = ROLE_PRIVILEGE_ORDER.indexOf(String(role ?? "").toLowerCase());
  return idx === -1 ? ROLE_PRIVILEGE_ORDER.length : idx;
}

/** Picks the highest-privilege collaborator among candidates matching the same email (see ROLE_PRIVILEGE_ORDER). */
function pickBestCollaborator(candidates: Record<string, any>[]): Record<string, any> | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, cur) => (rolePrivilegeRank(cur.role) < rolePrivilegeRank(best.role) ? cur : best));
}

/**
 * Finds the authenticated user's own Collaborator record(s) by email.
 *
 * Primary strategy: ask Applivery's own `GET .../collaborators` for that
 * exact email server-side (the endpoint's documented `email` query param —
 * confirmed via the Applivery Docs MCP against get-collaborators' OpenAPI
 * schema). This sidesteps pagination/ordering entirely: wherever a match
 * would have landed, the server finds it directly, in one call.
 *
 * One email can legitimately resolve to MORE THAN ONE Collaborator record
 * in the same org — confirmed directly against a live, affected account:
 * a traditional-login account (role "owner") and a separate, later,
 * SSO-auto-provisioned account for the exact same address (role
 * "unassigned", `user.ssoUser: true`), each with its own distinct
 * `user.id`. Taking "whichever comes first in the array" is unsafe here:
 * Applivery's default (unsorted) list order isn't documented as
 * email/role-stable, and in the case that surfaced this, the newer
 * "unassigned" duplicate had the most recently updated `updatedAt` of any
 * collaborator in the org, which is exactly the kind of record a
 * recency-biased default sort would place first — silently downgrading a
 * genuine Owner to "No SOAR Role mapped". Collecting every match and
 * picking the highest-privilege role (pickBestCollaborator) makes the
 * result correct regardless of array order.
 *
 * Fallback: if the email-filtered call comes back empty (defensive — in
 * case that filter turns out to be case-sensitive, or doesn't match the way
 * `user.email` does for some account types), fall back to a full paginated
 * scan (page=1,2,3... following the response's own hasNextPage) rather than
 * a single `limit: 500` call, collecting every match the same way.
 */
export async function findSelfCollaborator(
  orgBase: string,
  headers: Record<string, string>,
  email: string,
): Promise<Record<string, any> | null> {
  const emailLower = (email || "").toLowerCase();
  if (!emailLower) return null;

  const filtered = await appliveryClient.get(`${orgBase}/collaborators/`, { headers, params: { limit: 50, email: emailLower } });
  if (filtered.status === 401 || filtered.status === 403) {
    throw new HttpError(401, "Applivery session expired — please sign in again.");
  }
  if (filtered.status === 200) {
    const items = extractItems(filtered.data);
    const matches = items.filter((i) => (i.email ?? i.user?.email ?? "").toLowerCase() === emailLower);
    if (matches.length > 0) return pickBestCollaborator(matches);
  }

  const matches: Record<string, any>[] = [];
  for (let page = 1; ; page++) {
    const res = await appliveryClient.get(`${orgBase}/collaborators/`, { headers, params: { limit: 500, page } });
    // A 401/403 here means the *forwarded Applivery bearer token* is
    // invalid/expired -- not that this account genuinely has no Collaborator
    // record. appliveryClient deliberately never throws on non-2xx (callers
    // inspect .status themselves, see its class doc), so without this check
    // an expired-but-otherwise-valid session silently fell through to the
    // same `return null` as a real "no such collaborator" case below, which
    // resolveSoarAccess then reported as allowed:false with a misleading
    // "No Applivery Collaborator record found" reason -- a 200 OK from our
    // own /auth/resolve-access, not an error the frontend could recognize as
    // "your session expired, please sign in again" (router/index.ts and
    // http.ts's response interceptor both only react to a real 401). Throwing
    // here instead makes that distinction explicit and correctly surfaces as
    // an actual 401 from /auth/resolve-access.
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(401, "Applivery session expired — please sign in again.");
    }
    if (res.status !== 200) break;

    const items = extractItems(res.data);
    for (const i of items) {
      // Per Applivery's own get-collaborators API schema, a collaborator
      // item has NO top-level `email` — only a nested `user.email`. `i.email`
      // is checked first purely as a defensive fallback for any older/
      // alternate response shape; real data only ever has `i.user.email`.
      const candidateEmail = (i.email ?? i.user?.email ?? "").toLowerCase();
      if (candidateEmail === emailLower) matches.push(i);
    }

    const container = res.data && typeof res.data === "object" ? ((res.data as any).data ?? res.data) : res.data;
    if (!container?.hasNextPage) break;
  }
  return pickBestCollaborator(matches);
}

/**
 * The actual access decision — 3-step precedence documented on
 * rbac.middleware.ts. Returns a value safe to cache and to return straight
 * to the frontend.
 */
export async function resolveSoarAccess(
  orgBase: string,
  headers: Record<string, string>,
  email: string,
  roles: SoarRoleRecord[],
): Promise<ResolvedAccess> {
  const collaborator = await findSelfCollaborator(orgBase, headers, email);
  if (!collaborator) {
    return {
      allowed: false,
      isSuperAdmin: false,
      role: null,
      collaboratorRole: null,
      matchedTagValue: null,
      deniedReason: "No Applivery Collaborator record found for this account in this workspace.",
    };
  }

  const collaboratorRole = String(collaborator.role ?? "").toLowerCase();
  if (collaboratorRole === "owner") {
    return {
      allowed: true,
      isSuperAdmin: true,
      role: null,
      collaboratorRole,
      matchedTagValue: null,
      deniedReason: null,
    };
  }

  const tagCandidates = new Set(extractCollaboratorTagCandidates(collaborator).map((t) => t.toLowerCase()));
  for (const role of roles) {
    for (const tagValue of role.appliveryTagValues ?? []) {
      if (tagCandidates.has(tagValue.trim().toLowerCase())) {
        return {
          allowed: true,
          isSuperAdmin: false,
          role,
          collaboratorRole,
          matchedTagValue: tagValue,
          deniedReason: null,
        };
      }
    }
  }

  return {
    allowed: false,
    isSuperAdmin: false,
    role: null,
    collaboratorRole,
    matchedTagValue: null,
    deniedReason:
      "No SOAR Role is mapped to this collaborator's tag yet. Ask a Super Admin (the Applivery workspace Owner) to configure one under Settings > Roles.",
  };
}
