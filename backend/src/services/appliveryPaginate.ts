import { appliveryClient } from "./appliveryClient";
import { extractItems } from "../utils/extractItems";
import { HttpError } from "../utils/httpError";

/**
 * Walks every page of an Applivery list endpoint rather than trusting a
 * single limit=500/1000 call to return everything — direct port of
 * `_fetch_all_pages` (main.py:2710). Applivery's list responses carry a
 * standard pagination envelope ({data: {items, hasNextPage, ...}}); past a
 * few thousand records a single call silently truncates. Capped at
 * `maxPages` (40 pages of 1000 = up to 40,000 records) as a sanity ceiling.
 *
 * Throws only if the FIRST page fails (mirrors the original); a later page
 * failing just stops there and returns what was already collected.
 */
export async function fetchAllPages(
  headers: Record<string, string>,
  url: string,
  baseParams: Record<string, unknown> = {},
  pageLimit = 1000,
  maxPages = 40,
): Promise<any[]> {
  const allItems: any[] = [];
  let page = 1;
  while (page <= maxPages) {
    const params = { ...baseParams, limit: pageLimit, page };
    const res = await appliveryClient.get<any>(url, { headers, params });
    if (res.status !== 200) {
      if (page === 1) {
        throw new HttpError(502, `Applivery API returned ${res.status}: ${String(JSON.stringify(res.data)).slice(0, 300)}`);
      }
      break;
    }
    const data = res.data && typeof res.data === "object" && !Array.isArray(res.data) ? (res.data as any).data ?? res.data : res.data;
    const items = extractItems(res.data);
    if (!items.length) break;
    allItems.push(...items);
    const hasNext = data && typeof data === "object" && !Array.isArray(data) && Boolean((data as any).hasNextPage);
    if (!hasNext) break;
    page += 1;
  }
  return allItems;
}
