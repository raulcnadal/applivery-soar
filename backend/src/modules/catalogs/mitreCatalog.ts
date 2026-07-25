import axios from "axios";
import { loadGlobalCatalog, saveGlobalCatalog } from "../../services/globalCatalog";
import { MITRE_TACTICS, MITRE_TECHNIQUES } from "../compliance/complianceFields";

/**
 * MITRE ATT&CK catalog cross-check — port of main.py:11673-11778. Fetches
 * MITRE's own published Enterprise ATT&CK STIX bundle and cross-checks it
 * against the curated ~41 technique IDs (complianceFields.ts) — surfacing
 * live names/status/lastFetchedAt rather than replacing the curation.
 * Global, not per-workspace.
 */

const STIX_BUNDLE_URL = "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json";
export const MITRE_CATALOG_TICK_MS = 86_400_000; // daily

interface MitreLiveCatalog {
  techniques: Array<{ id: string; name: string; tactics: string[]; revoked: boolean; deprecated: boolean; isSubtechnique: boolean }>;
  lastFetchedAt: string | null;
  lastError: string | null;
}

export async function loadMitreCatalog(): Promise<MitreLiveCatalog> {
  return loadGlobalCatalog("mitre_catalog", () => ({ techniques: [], lastFetchedAt: null, lastError: null }));
}

/** Port of `_refresh_mitre_catalog` (main.py:11692). */
export async function refreshMitreCatalog(): Promise<MitreLiveCatalog> {
  const catalog = await loadMitreCatalog();
  try {
    const resp = await axios.get(STIX_BUNDLE_URL, { timeout: 60000, validateStatus: () => true });
    if (resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
    const bundle = resp.data ?? {};
    const techniques: MitreLiveCatalog["techniques"] = [];
    for (const obj of bundle.objects ?? []) {
      if (obj.type !== "attack-pattern") continue;
      let externalId: string | null = null;
      for (const ref of obj.external_references ?? []) {
        if (ref.source_name === "mitre-attack" && String(ref.external_id ?? "").startsWith("T")) {
          externalId = ref.external_id;
          break;
        }
      }
      if (!externalId) continue;
      const tactics = (obj.kill_chain_phases ?? []).filter((p: any) => p.kill_chain_name === "mitre-attack").map((p: any) => p.phase_name);
      techniques.push({
        id: externalId, name: obj.name, tactics,
        revoked: Boolean(obj.revoked ?? false), deprecated: Boolean(obj.x_mitre_deprecated ?? false),
        isSubtechnique: Boolean(obj.x_mitre_is_subtechnique ?? false),
      });
    }
    if (!techniques.length) throw new Error("STIX bundle parsed but yielded zero attack-pattern objects — unexpected shape");
    catalog.techniques = techniques;
    catalog.lastFetchedAt = new Date().toISOString();
    catalog.lastError = null;
  } catch (e) {
    catalog.lastError = String(e).slice(0, 300);
    console.warn(`[MITRE Catalog] Refresh failed: ${e}`);
  }
  await saveGlobalCatalog("mitre_catalog", catalog);
  return catalog;
}

/** Port of `get_mitre_techniques` (main.py:11746). */
export async function getMitreTechniques() {
  const catalog = await loadMitreCatalog();
  const liveById = new Map((catalog.techniques ?? []).map((t) => [t.id, t]));
  const items = MITRE_TECHNIQUES.map((t) => {
    const live = liveById.get(t.id);
    return {
      ...t,
      name: live?.name ?? t.name,
      revoked: Boolean(live?.revoked),
      deprecated: Boolean(live?.deprecated),
      liveDataAvailable: live !== undefined,
    };
  });
  return {
    items, tactics: MITRE_TACTICS,
    catalogLastFetchedAt: catalog.lastFetchedAt, catalogLastError: catalog.lastError,
    catalogTechniqueCount: (catalog.techniques ?? []).length,
  };
}
