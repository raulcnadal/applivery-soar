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

/** Finds the authenticated user's own Collaborator record by email. */
export async function findSelfCollaborator(
  orgBase: string,
  headers: Record<string, string>,
  email: string,
): Promise<Record<string, any> | null> {
  const res = await appliveryClient.get(`${orgBase}/collaborators/`, { headers, params: { limit: 500 } });
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
  if (res.status !== 200) return null;
  const items = extractItems(res.data);
  const emailLower = (email || "").toLowerCase();
  for (const i of items) {
    const candidateEmail = (i.email ?? i.user?.email ?? "").toLowerCase();
    if (candidateEmail === emailLower) return i;
  }
  return null;
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
