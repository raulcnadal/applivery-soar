/**
 * Ported verbatim from main.py's extract_items() — Applivery list endpoints
 * wrap their payload inconsistently ({items:[...]}, {data:{items:[...]}},
 * {data:[...]}, or a bare array), so every call site normalizes through
 * this rather than assuming one shape.
 */
export function extractItems(data: unknown): any[] {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items;
    if ("data" in obj) {
      const d = obj.data;
      if (d && typeof d === "object" && !Array.isArray(d) && Array.isArray((d as any).items)) {
        return (d as any).items;
      }
      if (Array.isArray(d)) return d;
    }
  }
  if (Array.isArray(data)) return data;
  return [];
}
