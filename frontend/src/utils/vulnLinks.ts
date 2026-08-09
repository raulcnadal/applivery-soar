// Client-side URL builders for making a vulnerability id clickable in the
// Device Detail Drawer's Compliance tab — every vulnerability source this
// app tracks (EUVD/ENISA catalog, MSRC OS Updates, Apple GDMF Rapid
// Security Response, the optional Vulnerability Service) hands back a bare
// id and nothing else; none of them carry a stored reference/advisory URL
// worth threading through the backend (EUVD's own item.references array
// gets discarded when the catalog computes each device's pendingCves, and
// MSRC/GDMF never captured one to begin with). Building the link straight
// from the id keeps this a pure frontend change with no schema/API impact.
//
// EUVD (ENISA's own EU Vulnerability Database), not NVD, is the default
// target for a plain CVE id — NVD's own reliability has been degraded for
// months (widely reported outages/backlog since NVD's 2024 processing
// slowdown), so it's a poor default "explain this vulnerability" link even
// though it covers slightly more CVEs than EUVD does today. MSRC keeps its
// own dedicated link (msrcUrl) for the OS Updates section regardless —
// that's Microsoft's own first-party advisory, not NVD, and isn't affected
// by NVD's issues.

const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;
const EUVD_PATTERN = /^EUVD-\d{4}-\d+$/i;

export function isCveId(id: string | null | undefined): boolean {
  return typeof id === "string" && CVE_PATTERN.test(id.trim());
}

/** Microsoft's own Security Update Guide entry — more specific than a general vulnerability database for a Windows KB's CVEs (affected-product list, exploitability index, KB cross-links), and unaffected by NVD's reliability issues since it isn't NVD. */
export function msrcUrl(cveId: string | null | undefined): string | null {
  if (!isCveId(cveId)) return null;
  return `https://msrc.microsoft.com/update-guide/vulnerability/${cveId!.trim().toUpperCase()}`;
}

/**
 * The EUVD catalog's own vulnCatalog.ts falls back to the EUVD item id
 * (e.g. "EUVD-2025-10933") instead of a CVE id when a given entry has no
 * assigned CVE yet — when we already have one of these, it's a direct hit
 * on EUVD's own per-vulnerability page (no search round-trip needed).
 */
export function euvdUrl(euvdId: string | null | undefined): string | null {
  if (typeof euvdId !== "string" || !EUVD_PATTERN.test(euvdId.trim())) return null;
  return `https://euvd.enisa.europa.eu/vulnerability/${euvdId.trim().toUpperCase()}`;
}

/**
 * For a plain CVE id (the common case — MSRC, the Vulnerability Service,
 * and Apple GDMF only ever hand back a CVE, never an EUVD id), EUVD has no
 * stable "detail page keyed by CVE id" route the way it does for its own
 * EUVD-YYYY-##### ids, so this routes to EUVD's own search results
 * pre-filled with the CVE — `text` is EUVD's documented search parameter
 * (matches against description, EUVD id, aliases — which includes CVE
 * numbers — product, and vendor). Lands one click away from the record
 * rather than directly on it, which is still strictly better than a flaky
 * NVD detail page.
 */
export function euvdSearchUrl(cveId: string | null | undefined): string | null {
  if (!isCveId(cveId)) return null;
  return `https://euvd.enisa.europa.eu/search?text=${encodeURIComponent(cveId!.trim().toUpperCase())}`;
}

/** Best available EUVD link for an id that might be a real CVE or an EUVD-catalog fallback id — a direct hit for a known EUVD id, a search for a CVE id, or null if it's neither (so the caller can fall back to plain, non-clickable text). */
export function vulnLink(id: string | null | undefined): string | null {
  return euvdUrl(id) ?? euvdSearchUrl(id);
}
