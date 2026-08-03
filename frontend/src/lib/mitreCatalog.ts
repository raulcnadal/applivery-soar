// Shared MITRE ATT&CK color/lookup helpers — port of the pure-function half
// of useMitreCatalog (shared/MitreCatalog.jsx:12-64). The fetch/state half
// already lives in stores/compliance.ts (mitreTechniques/mitreTactics/
// mitreCatalogMeta/fetchMitreTechniques/refreshMitreCatalogNow) since both
// PolicyBuilderDrawer.vue and the Cases components read from that one
// already-fetched catalog rather than each fetching their own copy. This
// module is plain functions (not a component) so it can be imported from
// <script setup> blocks directly — see lib/segments.ts for the same pattern
// and the reason (a <script setup> SFC can't itself export functions).

// One color per tactic, cycling through a fixed palette in ATT&CK's usual
// left-to-right (recon → impact) order — purely a visual grouping aid.
export const TACTIC_PALETTE = [
  "#0241E3", "#7C3AED", "#DB2777", "#EF4444", "#F97316", "#F59E0B",
  "#EAB308", "#84CC16", "#22C55E", "#14B8A6", "#0EA5E9", "#6366F1",
];

export interface MitreTacticDef {
  key: string;
  name: string;
  order?: number;
}

export interface MitreTechniqueDef {
  id: string;
  name: string;
  tactic: string;
  triggeredByFields?: string[];
  revoked?: boolean;
  deprecated?: boolean;
  liveDataAvailable?: boolean;
}

export function tacticColorMap(tactics: MitreTacticDef[]): Record<string, string> {
  const map: Record<string, string> = {};
  tactics.forEach((t, i) => {
    map[t.key] = TACTIC_PALETTE[i % TACTIC_PALETTE.length];
  });
  return map;
}

export function techniqueByIdMap(techniques: MitreTechniqueDef[]): Record<string, MitreTechniqueDef> {
  const map: Record<string, MitreTechniqueDef> = {};
  techniques.forEach((t) => {
    map[t.id] = t;
  });
  return map;
}
