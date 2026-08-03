import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * The Segments panel's state — port of App.jsx's isSegmentPanelOpen/
 * globalSegment/selectedSegment/segmentsList/segmentSearch/showChildren/
 * expandedSegments (App.jsx:2895-2901). Global (a hardcoded `{id:0}`
 * pseudo-node, never part of the fetched tree) is the "no filter" state.
 *
 * Tree data comes from this app's own GET /api/segments/tree — the
 * original fetched this directly from the browser against
 * api.applivery.io; this migration proxies it server-side instead (see
 * backend/devices/deviceCatalog.service.ts's getSegmentsTree doc comment).
 */
export interface SegmentTreeNode {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  children: SegmentTreeNode[];
}
export interface SelectedSegment {
  id: string | number;
  name: string;
}

export const GLOBAL_SEGMENT: SelectedSegment = { id: 0, name: "Global" };

export const useSegmentsStore = defineStore("segments", () => {
  const isPanelOpen = ref(false);
  const tree = ref<SegmentTreeNode[]>([]);
  const isLoaded = ref(false);
  const selectedSegment = ref<SelectedSegment>(GLOBAL_SEGMENT);
  const search = ref("");
  const showChildren = ref(true);
  const expanded = ref<Record<string, boolean>>({});

  async function fetchTree() {
    if (isLoaded.value) return;
    try {
      const { api } = await import("../api/http");
      const res = await api.get("/segments/tree");
      tree.value = res.data?.items ?? [];
    } catch {
      tree.value = [];
    } finally {
      isLoaded.value = true;
    }
  }

  function select(seg: SelectedSegment) {
    selectedSegment.value = seg;
  }
  function reset() {
    selectedSegment.value = GLOBAL_SEGMENT;
  }
  function toggleExpanded(id: string) {
    expanded.value[id] = expanded.value[id] === false ? true : false;
  }

  // Port of utils/segments.js's collectSegmentIds — Global (id 0) means "no
  // filter" (returns null); otherwise the selected segment's id plus every
  // descendant's id, walked from the fetched tree. Devices/Cases apply this
  // client-side against their own already-fetched full list, same as the
  // original (no extra network round-trip when switching segments).
  function collectSegmentIds(rootId: string | number | undefined | null): Set<string> | null {
    if (rootId === undefined || rootId === null || Number(rootId) === 0) return null;
    const target = String(rootId);
    const ids = new Set<string>();
    function walk(nodes: SegmentTreeNode[]) {
      for (const n of nodes ?? []) {
        ids.add(String(n.id));
        walk(n.children);
      }
    }
    function findAndCollect(nodes: SegmentTreeNode[]): boolean {
      for (const n of nodes ?? []) {
        if (String(n.id) === target) {
          ids.add(String(n.id));
          walk(n.children);
          return true;
        }
        if (findAndCollect(n.children)) return true;
      }
      return false;
    }
    if (!findAndCollect(tree.value)) ids.add(target);
    return ids;
  }

  return {
    isPanelOpen, tree, isLoaded, selectedSegment, search, showChildren, expanded,
    fetchTree, select, reset, toggleExpanded, collectSegmentIds,
  };
});
