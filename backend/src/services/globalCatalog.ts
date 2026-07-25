import { prisma } from "./prisma";

/**
 * Generic global (not per-workspace) catalog store, backed by the
 * GlobalCatalog Prisma table — Node equivalent of main.py's
 * `_store_load(_GLOBAL_STORE_SLUG, source, default_factory)` /
 * `_store_save(_GLOBAL_STORE_SLUG, source, data)` used by every
 * public-data catalog (OS Update/MSRC, Vuln/EUVD, OS Lifecycle, GDMF,
 * MITRE) — these are shared reference data refreshed once for every
 * workspace, not tenant-scoped.
 */
export async function loadGlobalCatalog<T>(source: string, defaultFactory: () => T): Promise<T> {
  const row = await prisma.globalCatalog.findUnique({ where: { source } });
  if (!row) return defaultFactory();
  return row.payload as unknown as T;
}

export async function saveGlobalCatalog(source: string, payload: unknown): Promise<void> {
  await prisma.globalCatalog.upsert({
    where: { source },
    create: { source, payload: payload as any },
    update: { payload: payload as any, lastRefreshedAt: new Date() },
  });
}
