import { prisma } from "../../services/prisma";
import { recordAuditEvent } from "../../services/auditLog";
import { HttpError } from "../../utils/httpError";
import { CONFIG_STORE_KEYS, type ConfigStoreKey } from "./config.schemas";

/**
 * Workspace configuration export/import/clone — port of main.py:1763-1907
 * (`EXPORTABLE_CONFIG_STORES`, `_workspace_config_is_empty`,
 * `clone_workspace_config`, `export_workspace_config`,
 * `import_workspace_config`). The original replaces one JSON-blob-per-store
 * wholesale; here each store maps onto one (or two, for
 * appliveryWebhookConfig) real Postgres tables, so a "wholesale replace"
 * means delete-then-recreate scoped to `workspaceSlug`, preserving every
 * row's original `id` so cross-references (a Trigger's workflowId, a Case
 * Auto-Run Rule's workflowId, etc.) survive the round-trip intact.
 *
 * One real difference from the original: these tables carry foreign-key
 * constraints the JSON-blob version never had (e.g. ComplianceViolation ->
 * CompliancePolicy). Deleting a store that's still referenced by
 * out-of-scope history rows (violations, cases, runs — none of which are
 * themselves exportable) can fail with an FK error where the original just
 * silently overwrote the dict entry. Each store is imported independently
 * and a failure on one is reported rather than aborting the rest, so a
 * bundle that hits this doesn't nuke the whole restore.
 */

interface StoreHandler {
  isEmpty(workspaceSlug: string): Promise<boolean>;
  load(workspaceSlug: string): Promise<unknown>;
  save(workspaceSlug: string, data: unknown): Promise<void>;
}

function listHandler(modelName: string): StoreHandler {
  const model = (): any => (prisma as any)[modelName];
  return {
    async isEmpty(workspaceSlug) {
      return (await model().count({ where: { workspaceSlug } })) === 0;
    },
    async load(workspaceSlug) {
      return model().findMany({ where: { workspaceSlug } });
    },
    async save(workspaceSlug, data) {
      const rows = Array.isArray(data) ? data : [];
      await model().deleteMany({ where: { workspaceSlug } });
      if (rows.length) await model().createMany({ data: rows.map((r: any) => ({ ...r, workspaceSlug })) });
    },
  };
}

/** Single-row-per-workspace stores keyed by `workspaceSlug` itself as the `@id`. */
function singletonHandler(modelName: string): StoreHandler {
  const model = (): any => (prisma as any)[modelName];
  return {
    async isEmpty(workspaceSlug) {
      return (await model().findUnique({ where: { workspaceSlug } })) === null;
    },
    async load(workspaceSlug) {
      return model().findUnique({ where: { workspaceSlug } });
    },
    async save(workspaceSlug, data) {
      if (!data || typeof data !== "object") return;
      const { workspaceSlug: _ignored, updatedAt: _updatedAt, ...rest } = data as Record<string, any>;
      await model().upsert({ where: { workspaceSlug }, create: { workspaceSlug, ...rest }, update: { ...rest } });
    },
  };
}

const appliveryWebhookConfigHandler: StoreHandler = {
  async isEmpty(workspaceSlug) {
    return (await prisma.appliveryWebhookConfig.findUnique({ where: { workspaceSlug } })) === null;
  },
  async load(workspaceSlug) {
    const [config, rules] = await Promise.all([
      prisma.appliveryWebhookConfig.findUnique({ where: { workspaceSlug } }),
      prisma.appliveryWebhookRule.findMany({ where: { workspaceSlug } }),
    ]);
    return { config, rules };
  },
  async save(workspaceSlug, data) {
    const bundle = (data as { config?: Record<string, any>; rules?: Record<string, any>[] }) ?? {};
    if (bundle.config) {
      const { workspaceSlug: _w, updatedAt: _u, ...rest } = bundle.config;
      await prisma.appliveryWebhookConfig.upsert({
        where: { workspaceSlug }, create: { workspaceSlug, ...rest }, update: { ...rest },
      });
    }
    await prisma.appliveryWebhookRule.deleteMany({ where: { workspaceSlug } });
    if (bundle.rules?.length) {
      await prisma.appliveryWebhookRule.createMany({ data: bundle.rules.map((r) => ({ ...r, workspaceSlug })) });
    }
  },
};

const STORE_HANDLERS: Record<ConfigStoreKey, StoreHandler> = {
  compliancePolicies: listHandler("compliancePolicy"),
  workflows: listHandler("workflow"),
  triggers: listHandler("trigger"),
  integrations: listHandler("integration"),
  caseAutoRunRules: listHandler("caseAutoRunRule"),
  caseSlaSettings: singletonHandler("caseSlaSettings"),
  threatIntelProviders: listHandler("threatIntelProvider"),
  appliveryWebhookConfig: appliveryWebhookConfigHandler,
  actionLibrary: listHandler("actionLibraryEntry"),
  appLists: listHandler("appList"),
  scriptRepos: listHandler("scriptRepo"),
  dashboardState: singletonHandler("workspaceState"),
  vulnServiceConfig: singletonHandler("vulnServiceConfig"),
  firewallRuleSets: listHandler("firewallRuleSet"),
};

/** Port of `_workspace_config_is_empty` (main.py:1781). */
export async function workspaceConfigIsEmpty(workspaceSlug: string): Promise<{ isEmpty: boolean; hasData: Record<string, boolean> }> {
  const hasData: Record<string, boolean> = {};
  for (const key of CONFIG_STORE_KEYS) {
    hasData[key] = !(await STORE_HANDLERS[key].isEmpty(workspaceSlug));
  }
  return { isEmpty: !Object.values(hasData).some(Boolean), hasData };
}

/** Port of `export_workspace_config` (main.py:1858). */
export async function exportWorkspaceConfig(workspaceSlug: string, actor: string) {
  const data: Record<string, unknown> = {};
  for (const key of CONFIG_STORE_KEYS) {
    data[key] = await STORE_HANDLERS[key].load(workspaceSlug);
  }
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "config_exported", actor,
    message: `Configuration exported by ${actor} (contains credentials — handle as sensitive)`,
  });
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    workspaceSlug,
    data,
  };
}

/** Port of `import_workspace_config` (main.py:1880) — wholesale overwrite per selected store, NOT a merge. */
export async function importWorkspaceConfig(workspaceSlug: string, data: Record<string, unknown>, stores: ConfigStoreKey[], actor: string) {
  const imported: string[] = [];
  const failed: Array<{ store: string; error: string }> = [];
  for (const key of stores) {
    if (!(key in data)) continue;
    try {
      await STORE_HANDLERS[key].save(workspaceSlug, data[key]);
      imported.push(key);
    } catch (e) {
      failed.push({ store: key, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "config_imported", actor, severity: "warning",
    message: `Configuration imported (overwritten) for store(s): ${imported.join(", ") || "none"} — imported by ${actor}` +
      (failed.length ? ` — FAILED: ${failed.map((f) => `${f.store} (${f.error})`).join("; ")}` : ""),
  });
  return { status: "ok", imported, failed };
}

/** Port of `clone_workspace_config` (main.py:1821) — bootstraps an empty workspace from another's config. */
export async function cloneWorkspaceConfig(workspaceSlug: string, sourceWorkspaceSlug: string, stores: ConfigStoreKey[], actor: string) {
  if (sourceWorkspaceSlug === workspaceSlug) {
    throw new HttpError(400, "Source and target workspace can't be the same.");
  }
  const { isEmpty } = await workspaceConfigIsEmpty(workspaceSlug);
  if (!isEmpty) {
    throw new HttpError(
      400,
      "This workspace already has configuration — clone-from-another-workspace only runs on a still-empty workspace. Use Settings > Backup & Restore to import a bundle with explicit per-store overwrite instead.",
    );
  }
  const cloned: string[] = [];
  for (const key of stores) {
    const data = await STORE_HANDLERS[key].load(sourceWorkspaceSlug);
    await STORE_HANDLERS[key].save(workspaceSlug, data);
    cloned.push(key);
  }
  await recordAuditEvent(workspaceSlug, {
    category: "settings", action: "config_cloned", actor,
    message: `Workspace bootstrapped from "${sourceWorkspaceSlug}" — store(s): ${cloned.join(", ") || "none"} — by ${actor}`,
  });
  return { status: "ok", cloned, sourceWorkspaceSlug };
}
