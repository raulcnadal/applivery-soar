import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import type { AppCatalogAddPayload, AppListPayload } from "./appLists.schemas";

/** GET /api/app-catalog (main.py:8107) — optionally filtered by platform. */
export async function listAppCatalog(workspaceSlug: string, platform?: string) {
  const items = await prisma.appCatalogEntry.findMany({
    where: { workspaceSlug, ...(platform ? { platform } : {}) },
    orderBy: { createdAt: "asc" },
  });
  return { items };
}

/**
 * Dedup by (platform, identifier) — port of `_upsert_app_catalog_entry`
 * (main.py:8081). Every add-to-list flow funnels through here first.
 */
export async function upsertAppCatalogEntry(
  workspaceSlug: string,
  platform: string,
  identifier: string,
  name: string | null | undefined,
  iconUrl: string | null | undefined,
  source: string,
) {
  const cleanIdentifier = (identifier ?? "").trim();
  const existing = await prisma.appCatalogEntry.findFirst({
    where: { workspaceSlug, platform, identifier: { equals: cleanIdentifier, mode: "insensitive" } },
  });
  if (existing) return existing;
  return prisma.appCatalogEntry.create({
    data: { workspaceSlug, platform, identifier: cleanIdentifier, name: name || cleanIdentifier, iconUrl, source },
  });
}

/** POST /api/app-catalog (main.py:8114). */
export async function addAppCatalogEntry(workspaceSlug: string, payload: AppCatalogAddPayload) {
  if (!payload.identifier.trim()) {
    throw new HttpError(400, "An app identifier (bundle ID / package name) is required");
  }
  return upsertAppCatalogEntry(workspaceSlug, payload.platform, payload.identifier, payload.name, payload.iconUrl, payload.source);
}

/** DELETE /api/app-catalog/{entry_id} (main.py:8122). */
export async function deleteAppCatalogEntry(workspaceSlug: string, entryId: string) {
  const lists = await prisma.appList.findMany({ where: { workspaceSlug } });
  const referencing = lists.filter((l) => l.appIds.includes(entryId));
  if (referencing.length > 0) {
    const names = referencing.map((l) => l.name || l.id).join(", ");
    throw new HttpError(409, `Still referenced by list(s): ${names} — remove it from those first`);
  }
  await prisma.appCatalogEntry.deleteMany({ where: { workspaceSlug, id: entryId } });
  return { status: "ok" };
}

/** GET /api/app-lists (main.py:8140). */
export async function listAppLists(workspaceSlug: string, platform?: string) {
  const items = await prisma.appList.findMany({
    where: { workspaceSlug, ...(platform ? { platform } : {}) },
    orderBy: { createdAt: "asc" },
  });
  return { items };
}

/** POST /api/app-lists (main.py:8147). */
export async function createAppList(workspaceSlug: string, payload: AppListPayload, actorEmail: string) {
  const created = await prisma.appList.create({
    data: { workspaceSlug, name: payload.name, description: payload.description, platform: payload.platform, appIds: payload.appIds },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "compliance",
    action: "app_list_created",
    actor: actorEmail,
    targetType: "app_list",
    targetId: created.id,
    targetName: created.name,
    message: `App list "${created.name}" created (${created.appIds.length} apps)`,
  });
  return created;
}

/** PUT /api/app-lists/{list_id} (main.py:8163). */
export async function updateAppList(workspaceSlug: string, listId: string, payload: AppListPayload, actorEmail: string) {
  const existing = await prisma.appList.findFirst({ where: { id: listId, workspaceSlug } });
  if (!existing) throw new HttpError(404, "App list not found");
  const updated = await prisma.appList.update({
    where: { id: listId },
    data: { name: payload.name, description: payload.description, platform: payload.platform, appIds: payload.appIds },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "compliance",
    action: "app_list_updated",
    actor: actorEmail,
    targetType: "app_list",
    targetId: listId,
    targetName: updated.name,
    message: `App list "${updated.name}" updated (${updated.appIds.length} apps)`,
  });
  return updated;
}

/**
 * Compliance Policies with a requiredAppList/disallowedAppList condition
 * pointing at this list — port of `_policies_referencing_app_list`
 * (main.py:8198). Queried directly against Prisma (not via
 * compliance.service) to avoid a module import cycle — compliance.service
 * itself depends on this module for AppListsContext.
 */
export async function policiesReferencingAppList(workspaceSlug: string, listId: string) {
  const policies = await prisma.compliancePolicy.findMany({ where: { workspaceSlug } });
  return policies.filter((p) => {
    const conditions = (p.conditions as any[]) ?? [];
    return conditions.some((c) => ["requiredAppList", "disallowedAppList"].includes(c?.field) && String(c?.value) === String(listId));
  });
}

/** DELETE /api/app-lists/{list_id} (main.py:8181). */
export async function deleteAppList(workspaceSlug: string, listId: string, actorEmail: string) {
  const referencing = await policiesReferencingAppList(workspaceSlug, listId);
  if (referencing.length > 0) {
    const names = referencing.map((p) => p.name || p.id).join(", ");
    throw new HttpError(409, `Still referenced by Compliance Policy: ${names} — remove that condition first`);
  }
  const deleted = await prisma.appList.findFirst({ where: { id: listId, workspaceSlug } });
  await prisma.appList.deleteMany({ where: { workspaceSlug, id: listId } });
  if (deleted) {
    await recordAuditEvent(workspaceSlug, {
      category: "compliance",
      action: "app_list_deleted",
      actor: actorEmail,
      severity: "warning",
      targetType: "app_list",
      targetId: listId,
      targetName: deleted.name,
      message: `App list "${deleted.name}" deleted`,
    });
  }
  return { status: "ok" };
}

/** GET /api/app-lists/{list_id}/usage (main.py:8210). */
export async function getAppListUsage(workspaceSlug: string, listId: string) {
  const policies = await policiesReferencingAppList(workspaceSlug, listId);
  return { items: policies.map((p) => ({ id: p.id, name: p.name })) };
}

/**
 * Loads catalog + lists once and shapes them into the lightweight
 * AppListsContext compliance evaluation needs (see complianceEvaluate.ts) —
 * called once per evaluation pass, mirroring _run_compliance_evaluation's
 * own one-time catalog/list loads.
 */
export async function loadAppListsContext(workspaceSlug: string) {
  const [catalog, lists] = await Promise.all([
    prisma.appCatalogEntry.findMany({ where: { workspaceSlug } }),
    prisma.appList.findMany({ where: { workspaceSlug } }),
  ]);
  return {
    catalogById: new Map(catalog.map((e) => [e.id, { id: e.id, identifier: e.identifier }])),
    listById: new Map(lists.map((l) => [l.id, { id: l.id, appIds: l.appIds }])),
  };
}
