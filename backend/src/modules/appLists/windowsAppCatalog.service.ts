import { appliveryClient } from "../../services/appliveryClient";
import { extractItems } from "../../utils/extractItems";

type Headers = Record<string, string>;

/**
 * Applivery's own Windows App Distribution/MDM application library — a
 * different thing from installedApps.service.ts's per-device installed-app
 * inventory. This is the org's catalog of deployable Windows packages
 * (assets uploaded to Applivery, App Distribution builds, Microsoft Store
 * references) each carrying a real winApplicationId, the same id
 * deviceWinPolicy.applications[].winApplicationId assignments reference.
 * Confirmed against docs.applivery.com's Windows > Applications API
 * reference (get-applications / get-application) — GET .../applications
 * returns the paginated list, GET .../applications/:winApplicationId
 * returns one entry's full detail.
 *
 * Used to enrich the Apps view's Reported Apps detail modal: a Windows app
 * SOAR sees installed (self-reported or MDM-fetched) has no direct id
 * shared with this catalog — the only reliable cross-reference available
 * without a real GUID/productCode match on both sides is name equality, so
 * matching here is a best-effort convenience, not authoritative.
 */
export interface WindowsAppCatalogItem {
  id: string;
  type: string;
  origin: string;
  config: Record<string, any>;
  info: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

const LIST_PAGE_LIMIT = 100;
const LIST_MAX_PAGES = 10; // hard cap — 1000 catalog entries is far beyond any real org's Windows app library today

export async function fetchWindowsApplications(headers: Headers, orgBase: string): Promise<WindowsAppCatalogItem[]> {
  const url = `${orgBase}/mdm/windows/enterprise/applications`;
  const items: WindowsAppCatalogItem[] = [];
  let page = 1;
  for (; page <= LIST_MAX_PAGES; page++) {
    const res = await appliveryClient.get<any>(url, { headers, params: { page, limit: LIST_PAGE_LIMIT } });
    if (res.status >= 300) break;
    const pageItems = extractItems(res.data);
    items.push(...pageItems);
    if (!res.data?.data?.hasNextPage) break;
  }
  return items;
}

export async function fetchWindowsApplicationDetail(headers: Headers, orgBase: string, winApplicationId: string): Promise<WindowsAppCatalogItem | null> {
  const url = `${orgBase}/mdm/windows/enterprise/applications/${winApplicationId}`;
  const res = await appliveryClient.get<any>(url, { headers });
  if (res.status >= 300) return null;
  const data = res.data?.data ?? res.data;
  return data && typeof data === "object" ? data : null;
}

/**
 * Every item's `info` shape varies by `type` (asset/lastBuild/store/...) —
 * pulls out whatever field plausibly holds the human-readable app name for
 * matching purposes, mirroring the several shapes seen in real org data
 * (asset: info.name / info.config.msi.productName; lastBuild:
 * info.name / info.applicationInfo.name; msix bundles:
 * info.config.msix.displayName).
 */
function candidateNames(item: WindowsAppCatalogItem): string[] {
  const info = item.info ?? {};
  const names = new Set<string>();
  if (info.name) names.add(String(info.name));
  if (info.applicationInfo?.name) names.add(String(info.applicationInfo.name));
  if (info.config?.msi?.productName) names.add(String(info.config.msi.productName));
  if (info.config?.msix?.displayName) names.add(String(info.config.msix.displayName));
  return Array.from(names);
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function candidateProductCode(item: WindowsAppCatalogItem): string | null {
  const code = item.info?.config?.msi?.productCode;
  return typeof code === "string" && code.trim() ? code.trim().toUpperCase() : null;
}

/**
 * Matches an app against the catalog. When `productCode` is supplied (only
 * available for Windows apps SOAR has itself fetched via the MSI CSP — see
 * windowsDeviceApps.service.ts), it's tried first: an exact GUID match is
 * authoritative, unlike the name-based fallback below which is inherently
 * best-effort (an app can be named differently in Applivery's catalog than
 * however it self-reports/CSP-reports its DisplayName). Falls back to
 * case/whitespace-insensitive name match when there's no productCode to go
 * on (self-reported apps) or it didn't match anything (app was never staged
 * through Applivery's catalog under that productCode).
 */
export function matchWindowsApplication(items: WindowsAppCatalogItem[], candidateName: string, productCode?: string | null): WindowsAppCatalogItem | null {
  if (productCode && productCode.trim()) {
    const target = productCode.trim().toUpperCase();
    const byCode = items.find((item) => candidateProductCode(item) === target);
    if (byCode) return byCode;
  }
  const target = normalize(candidateName);
  if (!target) return null;
  for (const item of items) {
    if (candidateNames(item).some((n) => normalize(n) === target)) return item;
  }
  return null;
}
