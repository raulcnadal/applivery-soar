import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";

/**
 * Script & OMA-URI Library CRUD — port of main.py:4894-5023. Two entry
 * `type`s: 'script' (a pointer to an existing Applivery script Asset,
 * executed by direct per-device push — see mdmActionExecutor's
 * executeRunScript) and 'oma_uri' (a one-off raw SyncML command, our own
 * local {{ device.x }} templating applied to `value` at send time — see
 * executeMdmAction's 'customOmaUri' branch). Backed by the real
 * ActionLibraryEntry table (Phase 4a already added this model since
 * mdmActionExecutor.ts's 'runScript'/firewall branches depend on it) rather
 * than the original's per-workspace JSON file.
 */

export interface ActionLibraryEntryPayload {
  type: "script" | "oma_uri";
  name: string;
  description?: string | null;
  platform: string;
  assetId?: string | null;
  assetName?: string | null;
  arguments?: string | null;
  scope?: string | null;
  path?: string | null;
  action?: string | null;
  format?: string | null;
  value?: string | null;
}

function validatePayload(payload: ActionLibraryEntryPayload): void {
  if (payload.type !== "script" && payload.type !== "oma_uri") {
    throw new HttpError(400, "type must be 'script' or 'oma_uri'");
  }
  if (payload.type === "script" && !payload.assetId) {
    throw new HttpError(400, "A script library entry needs a script Asset selected");
  }
  if (payload.type === "oma_uri" && !(payload.path && payload.format)) {
    throw new HttpError(400, "An OMA-URI library entry needs a path and format");
  }
}

export async function listActionLibraryEntries(workspaceSlug: string) {
  return prisma.actionLibraryEntry.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
}

export async function createActionLibraryEntry(workspaceSlug: string, payload: ActionLibraryEntryPayload, actorEmail: string) {
  validatePayload(payload);
  const created = await prisma.actionLibraryEntry.create({
    data: {
      workspaceSlug, type: payload.type, name: payload.name, description: payload.description ?? "",
      platform: payload.platform, assetId: payload.assetId ?? null, assetName: payload.assetName ?? null,
      arguments: payload.arguments ?? "", scope: payload.scope ?? "machine",
      path: payload.path ?? null, action: payload.action ?? null, format: payload.format ?? null, value: payload.value ?? null,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "workflow", action: "action_library_entry_created", actor: actorEmail,
    targetType: "action_library_entry", targetId: created.id, targetName: created.name,
    message: `"${created.name}" (${payload.type}) added to the Script & OMA-URI library`,
  });
  return created;
}

export async function updateActionLibraryEntry(workspaceSlug: string, entryId: string, payload: ActionLibraryEntryPayload, actorEmail: string) {
  validatePayload(payload);
  const existing = await prisma.actionLibraryEntry.findFirst({ where: { workspaceSlug, id: entryId } });
  if (!existing) throw new HttpError(404, "Library entry not found");
  const updated = await prisma.actionLibraryEntry.update({
    where: { id: entryId },
    data: {
      type: payload.type, name: payload.name, description: payload.description ?? "",
      platform: payload.platform, assetId: payload.assetId ?? null, assetName: payload.assetName ?? null,
      arguments: payload.arguments ?? "", scope: payload.scope ?? "machine",
      path: payload.path ?? null, action: payload.action ?? null, format: payload.format ?? null, value: payload.value ?? null,
    },
  });
  await recordAuditEvent(workspaceSlug, {
    category: "workflow", action: "action_library_entry_updated", actor: actorEmail,
    targetType: "action_library_entry", targetId: entryId, targetName: updated.name,
    message: `"${updated.name}" updated in the Script & OMA-URI library`,
  });
  return updated;
}

export async function deleteActionLibraryEntry(workspaceSlug: string, entryId: string, actorEmail: string) {
  const deleted = await prisma.actionLibraryEntry.findFirst({ where: { workspaceSlug, id: entryId } });
  if (deleted) {
    await prisma.actionLibraryEntry.delete({ where: { id: entryId } });
    await recordAuditEvent(workspaceSlug, {
      category: "workflow", action: "action_library_entry_deleted", actor: actorEmail, severity: "warning",
      targetType: "action_library_entry", targetId: entryId, targetName: deleted.name,
      message: `"${deleted.name}" removed from the Script & OMA-URI library`,
    });
  }
  return { status: "ok" };
}

export interface ImportAssetRef {
  id: string;
  name?: string | null;
  platform?: string | null;
  description?: string | null;
}

/**
 * Bulk-adds library entries pointing at script Assets that already exist on
 * Applivery (selected from the "Fetch from Applivery" browser) — port of
 * main.py:4988-5023. Skips any Asset id already present rather than
 * creating a duplicate pointer.
 */
export async function importActionLibraryEntries(workspaceSlug: string, assets: ImportAssetRef[], actorEmail: string) {
  const existing = await prisma.actionLibraryEntry.findMany({ where: { workspaceSlug, type: "script", assetId: { not: null } }, select: { assetId: true } });
  const existingAssetIds = new Set(existing.map((e) => e.assetId));

  const imported: Array<Record<string, unknown>> = [];
  const skipped: Array<string | undefined> = [];
  for (const a of assets) {
    if (!a.id || existingAssetIds.has(a.id)) {
      skipped.push(a.id);
      continue;
    }
    const created = await prisma.actionLibraryEntry.create({
      data: {
        workspaceSlug, type: "script", name: a.name || a.id, description: a.description || "",
        platform: a.platform || "windows", assetId: a.id, assetName: a.name || "", arguments: "", scope: "machine",
      },
    });
    imported.push(created);
    existingAssetIds.add(a.id);
  }

  if (imported.length) {
    await recordAuditEvent(workspaceSlug, {
      category: "workflow", action: "action_library_bulk_imported", actor: actorEmail,
      message: `Imported ${imported.length} script${imported.length !== 1 ? "s" : ""} from Applivery into the Script & OMA-URI library`
        + (skipped.length ? ` (${skipped.length} already present, skipped)` : ""),
    });
  }
  return { imported, skippedCount: skipped.length };
}
