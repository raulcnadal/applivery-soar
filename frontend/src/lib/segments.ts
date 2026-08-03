// Shared segment-tree helper — port of flattenSegments (DevicePickers.jsx:32-39).
// Lives outside any single .vue file since <script setup> can't export
// plain functions; both SegmentPickerModal.vue and DeviceDetailDrawer.vue
// (for the current-segment-name lookup) need this.
import type { PickerItem } from "../stores/devices";

export interface SegmentNode extends Omit<PickerItem, "id"> {
  id: string | number;
  children?: SegmentNode[];
  _realChildren?: SegmentNode[];
}

export function flattenSegments(nodes: SegmentNode[] | undefined, depth = 0): Array<SegmentNode & { depth: number }> {
  let out: Array<SegmentNode & { depth: number }> = [];
  for (const n of nodes || []) {
    out.push({ ...n, depth });
    const children = n.children || n._realChildren;
    if (children?.length) out = out.concat(flattenSegments(children, depth + 1));
  }
  return out;
}
