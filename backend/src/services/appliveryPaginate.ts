import { appliveryClient } from "./appliveryClient";
import { extractItems } from "../utils/extractItems";
import { HttpError } from "../utils/httpError";

/**
 * Walks every page of an Applivery list endpoint rather than trusting a
 * single limit=500/1000 call to return everything — direct port of
 * `_fetch_all_pages` (main.py:2710). Applivery's list responses carry a
 * standard pagination envelope ({data: {items, hasNextPage, ...}}); past a
 * few thousand records a single call silently truncates.
 *
 * `pageLimit` defaults to 10,000 — Applivery's own documented maximum for
 * `limit` on the unified devices endpoint (GET
 * /organizations/:id/mdm/devices, confirmed via the live API reference:
 * `limit` schema is `{minimum: 1, maximum: 10000}`) — rather than the
 * smaller value this used before, which meant 10x more round trips than
 * necessary for the same fleet size. `maxPages` defaults to 100, i.e. up to
 * 1,000,000 records at the max page size — sized for "hundreds of
 * thousands of devices," not just the fleet sizes this was originally
 * exercised against, while still being a finite safety ceiling rather than
 * an unbounded loop if the API's `hasNextPage` flag were ever wrong.
 *
 * Both truncation modes are now LOUD, not silent: hitting the `maxPages`
 * ceiling while more pages genuinely remained, and a non-first page failing
 * mid-walk, both log an error — a fleet quietly missing tens of thousands
 * of devices from every view (Devices, Compliance evaluation, Case
 * creation, Overview widgets) is a much worse failure mode than a log line,
 * and both cases used to produce neither.
 *
 * Throws only if the FIRST page fails (mirrors the original); a later page
 * failing just stops there and returns what was already collected (now with
 * a logged warning so it's visible instead of masquerading as "that's the
 * whole fleet").
 */
export async function fetchAllPages(
  headers: Record<string, string>,
  url: string,
  baseParams: Record<string, unknown> = {},
  pageLimit = 10_000,
  maxPages = 100,
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
      console.error(
        `[fetchAllPages] ${url}: page ${page} failed (HTTP ${res.status}) after collecting ${allItems.length} item(s) from prior pages — stopping early. Results are INCOMPLETE, not a full fleet/list.`,
      );
      break;
    }
    const data = res.data && typeof res.data === "object" && !Array.isArray(res.data) ? (res.data as any).data ?? res.data : res.data;
    const items = extractItems(res.data);
    if (!items.length) break;
    allItems.push(...items);
    const hasNext = data && typeof data === "object" && !Array.isArray(data) && Boolean((data as any).hasNextPage);
    if (!hasNext) break;
    if (page === maxPages) {
      console.error(
        `[fetchAllPages] ${url}: hit the ${maxPages}-page safety ceiling (${allItems.length} item(s) collected) but the API still reports more pages remaining — results are INCOMPLETE. Raise maxPages if this fleet/list is genuinely larger than ${maxPages * pageLimit} records.`,
      );
    }
    page += 1;
  }
  return allItems;
}
