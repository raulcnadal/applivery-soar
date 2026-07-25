import { env } from "../../config/env";
import { appliveryClient } from "../../services/appliveryClient";
import { extractItems } from "../../utils/extractItems";
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
