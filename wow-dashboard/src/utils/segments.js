// Shared helpers for the segment-filter sliding panel (App.jsx) and any view
// that needs to narrow a list down to "this segment and everything beneath
// it" — the same scoping rule Applivery's own Dashboard uses when you select
// a Segment (see docs.applivery.com/en/device-management/general-settings/segments/,
// "Segments across the Dashboard": selecting a Segment filters Devices/
// Policies/Resources to that Segment and its descendants).

/**
 * Walks a segment tree (array of {id, children}) and returns a Set of every
 * id at or below `rootId`, as strings (Applivery segment ids are sometimes
 * numbers, sometimes strings, depending on the endpoint — normalize once
 * here so callers can just do `.has(String(x))`).
 *
 * rootId === 0 (Global) is treated specially: returns null to mean
 * "no filter, everything belongs" — Global is the root of the whole tree,
 * so walking it would just mean "collect literally every id", but callers
 * usually want to skip filtering entirely at that point rather than compute
 * a giant set.
 */
export function collectSegmentIds(tree, rootId) {
  if (rootId === undefined || rootId === null || Number(rootId) === 0) return null;
  const target = String(rootId);
  const ids = new Set();

  function walk(nodes) {
    for (const n of nodes || []) {
      if (!n || typeof n !== 'object') continue;
      const id = String(n.id);
      if (ids.has(id)) { walk(n.children); continue; }
      ids.add(id);
      walk(n.children);
    }
  }

  function findAndCollect(nodes) {
    for (const n of nodes || []) {
      if (!n || typeof n !== 'object') continue;
      if (String(n.id) === target) { walk([n]); return true; }
      if (findAndCollect(n.children)) return true;
    }
    return false;
  }

  if (!findAndCollect(tree)) {
    // Selected segment wasn't found in the tree (stale selection, or the
    // tree hasn't loaded yet) — fall back to an exact-match-only filter
    // rather than silently showing everything.
    ids.add(target);
  }
  return ids;
}

/** True if `item.segmentId` belongs to `selectedSegment` (or its
 * descendants, via `segmentsList`) — Global always matches everything. */
export function matchesSelectedSegment(itemSegmentId, selectedSegment, segmentsList) {
  if (!selectedSegment || Number(selectedSegment.id) === 0) return true;
  const idSet = collectSegmentIds(segmentsList, selectedSegment.id);
  if (idSet === null) return true;
  return idSet.has(String(itemSegmentId ?? '0'));
}
