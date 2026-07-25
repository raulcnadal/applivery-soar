import { SOAR_FEATURE_AREAS, SOAR_RISKY_ACTIONS, setCachedAccess, type SoarRoleRecord } from "../../middleware/rbac.middleware";
import { recordAuditEvent } from "../../services/auditLog";
import { appliveryClient } from "../../services/appliveryClient";
import { prisma } from "../../services/prisma";
import { extractItems } from "../../utils/extractItems";
import { HttpError } from "../../utils/httpError";
import { extractCollaboratorTagCandidates, findSelfCollaborator, fetchCollaboratorGroups, resolveOrgBase, resolveSoarAccess } from "../auth/rbac.service";
import type { CollaboratorTagsPayload, RolePayload, TestAccessPayload } from "./roles.schemas";

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  featureAccess: unknown;
  riskyActions: unknown;
  appliveryTagValues: string[];
  segmentIds: string[];
}

export function toSoarRoleRecord(r: RoleRow): SoarRoleRecord {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    featureAccess: r.featureAccess as SoarRoleRecord["featureAccess"],
    riskyActions: r.riskyActions as SoarRoleRecord["riskyActions"],
    appliveryTagValues: r.appliveryTagValues,
    segmentIds: r.segmentIds,
  };
}

// GET /api/roles (main.py:1293)
export async function listRoles(workspaceSlug: string) {
  const rows = await prisma.role.findMany({ where: { workspaceSlug } });
  return { items: rows.map(toSoarRoleRecord), featureAreas: SOAR_FEATURE_AREAS, riskyActions: SOAR_RISKY_ACTIONS };
}

// POST /api/roles (main.py:1297)
export async function createRole(workspaceSlug: string, payload: RolePayload, actorEmail: string) {
  const created = await prisma.role.create({
    data: {
      workspaceSlug,
      name: payload.name,
      description: payload.description,
      featureAccess: payload.featureAccess,
      riskyActions: payload.riskyActions,
      appliveryTagValues: payload.appliveryTagValues,
      segmentIds: payload.segmentIds,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "role_created",
    actor: actorEmail,
    targetType: "role",
    targetId: created.id,
    targetName: created.name,
    message: `SOAR Role "${created.name}" created`,
  });
  return toSoarRoleRecord(created);
}

// PUT /api/roles/{role_id} (main.py:1313)
export async function updateRole(workspaceSlug: string, roleId: string, payload: RolePayload, actorEmail: string) {
  const existing = await prisma.role.findFirst({ where: { id: roleId, workspaceSlug } });
  if (!existing) {
    throw new HttpError(404, "Role not found");
  }
  const updated = await prisma.role.update({
    where: { id: roleId },
    data: {
      name: payload.name,
      description: payload.description,
      featureAccess: payload.featureAccess,
      riskyActions: payload.riskyActions,
      appliveryTagValues: payload.appliveryTagValues,
      segmentIds: payload.segmentIds,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "role_updated",
    actor: actorEmail,
    targetType: "role",
    targetId: roleId,
    targetName: updated.name,
    message: `SOAR Role "${updated.name}" updated`,
  });
  // Any collaborator currently resolved to this role has a stale cached
  // permission set until they re-resolve — same tradeoff as the cache TTL
  // itself. Not force-invalidated here, matching the original.
  return toSoarRoleRecord(updated);
}

// DELETE /api/roles/{role_id} (main.py:1335)
export async function deleteRole(workspaceSlug: string, roleId: string, actorEmail: string) {
  const existing = await prisma.role.findFirst({ where: { id: roleId, workspaceSlug } });
  if (existing) {
    await prisma.role.delete({ where: { id: roleId } });
    await recordAuditEvent(workspaceSlug, {
      category: "settings",
      action: "role_deleted",
      actor: actorEmail,
      severity: "warning",
      targetType: "role",
      targetId: roleId,
      targetName: existing.name,
      message: `SOAR Role "${existing.name}" deleted`,
    });
  }
  return { status: "ok" };
}

// GET /api/roles/collaborators-directory (main.py:1348)
export async function getCollaboratorsDirectory(authorization: string, workspaceSlug: string) {
  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);

  const collabRes = await appliveryClient.get<any>(`${orgBase}/collaborators/`, { headers, params: { limit: 500 } });
  const collaborators = collabRes.status === 200 ? extractItems(collabRes.data) : [];
  for (const c of collaborators) {
    // 'unassigned', matching Applivery's real role enum — feeds
    // updateCollaboratorTags' PUT body when an admin saves without
    // touching the role selector.
    c.role_normalized = String(c.role ?? "unassigned").toLowerCase();
    c.tagCandidates = extractCollaboratorTagCandidates(c);
  }

  const segRes = await appliveryClient.get<any>(`${orgBase}/segments/by-user`, { headers });
  const segments = segRes.status === 200 ? extractItems(segRes.data) : [];

  const availableTags = await fetchCollaboratorGroups(orgBase, headers);

  return { collaborators, segments, availableTags };
}

// PUT /api/roles/collaborators/{collaborator_id} (main.py:1387)
export async function updateCollaboratorTags(
  collaboratorId: string,
  payload: CollaboratorTagsPayload,
  authorization: string,
  workspaceSlug: string,
  actorEmail: string,
) {
  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const body: Record<string, unknown> = { tags: payload.tags };
  if (payload.role) body.role = payload.role;

  const orgBase = await resolveOrgBase(headers, workspaceSlug);
  const res = await appliveryClient.put<any>(`${orgBase}/collaborators/${collaboratorId}`, body, { headers });

  if (res.status !== 200 && res.status !== 204) {
    const detail = res.data?.message ?? "Failed to update collaborator in Applivery.";
    throw new HttpError(res.status >= 400 ? res.status : 502, detail);
  }

  await recordAuditEvent(workspaceSlug, {
    category: "settings",
    action: "collaborator_tags_updated",
    actor: actorEmail,
    targetType: "collaborator",
    targetId: collaboratorId,
    targetName: collaboratorId,
    message: `Collaborator tags updated (role=${payload.role ?? "unchanged"}, tags=${JSON.stringify(payload.tags)})`,
  });
  return { status: "ok" };
}

// POST /api/roles/test-access (main.py:1427)
export async function testAccess(payload: TestAccessPayload, authorization: string, workspaceSlug: string) {
  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  const orgBase = await resolveOrgBase(headers, workspaceSlug);

  const roleRows: RoleRow[] = await prisma.role.findMany({ where: { workspaceSlug } });
  const roles: SoarRoleRecord[] = roleRows.map(toSoarRoleRecord);

  const collaborator = await findSelfCollaborator(orgBase, headers, payload.email);
  const access = await resolveSoarAccess(orgBase, headers, payload.email, roles);
  setCachedAccess(workspaceSlug, payload.email, access);

  return {
    ...access,
    collaboratorFound: collaborator !== null,
    liveTagCandidates: collaborator ? extractCollaboratorTagCandidates(collaborator) : [],
    roleTagValuesChecked: roles.map((r: SoarRoleRecord) => ({ roleId: r.id, roleName: r.name, tagValues: r.appliveryTagValues ?? [] })),
  };
}
