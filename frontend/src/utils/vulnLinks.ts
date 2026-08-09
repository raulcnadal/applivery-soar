// Client-side URL builders for making a vulnerability id clickable in the
// Device Detail Drawer's Compliance tab — every vulnerability source this
// app tracks (EUVD/ENISA catalog, MSRC OS Updates, Apple GDMF Rapid
// Security Response, the optional Vulnerability Service) hands back a bare
// id and nothing else; none of them carry a stored reference/advisory URL
// worth threading through the backend (EUVD's own item.references array
// gets discarded when the catalog computes each device's pendingCves, and
// MSRC/GDMF never captured one to begin with). Building the link straight
// from the id keeps this a pure frontend change with no schema/API impact.

const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;
const EUVD_PATTERN = /^EUVD-\d{4}-\d+$/i;

export function isCveId(id: string | null | undefined): boolean {
  return typeof id === "string" && CVE_PATTERN.test(id.trim());
}

/** NVD's own per-CVE detail page — the closest thing to a universal "explain this CVE" source, covering every platform this app tracks. */
export function nvdUrl(cveId: string | null | undefined): string | null {
  if (!isCveId(cveId)) return null;
  return `https://nvd.nist.gov/vuln/detail/${cveId!.trim().toUpperCase()}`;
}

/** Microsoft's own Security Update Guide entry — more specific than NVD for a Windows KB's CVEs (affected-product list, exploitability index, KB cross-links). */
export function msrcUrl(cveId: string | null | undefined): string | null {
  if (!isCveId(cveId)) return null;
  return `https://msrc.microsoft.com/update-guide/vulnerability/${cveId!.trim().toUpperCase()}`;
}

/**
 * The EUVD catalog's own vulnCatalog.ts falls back to the EUVD item id
 * (e.g. "EUVD-2025-10933") instead of a CVE id when a given entry has no
 * assigned CVE yet — vulnLink() below is what routes a device's
 * pendingCves[].cveId to the right site depending on which shape it turns
 * out to be, rather than every call site duplicating that branch.
 */
export function euvdUrl(euvdId: string | null | undefined): string | null {
  if (typeof euvdId !== "string" || !EUVD_PATTERN.test(euvdId.trim())) return null;
  return `https://euvd.enisa.europa.eu/vulnerability/${euvdId.trim().toUpperCase()}`;
}

/** Best available external link for an id that might be a real CVE or an EUVD-catalog fallback id — null if it's neither (so the caller can fall back to plain, non-clickable text). */
export function vulnLink(id: string | null | undefined): string | null {
  return nvdUrl(id) ?? euvdUrl(id);
}
