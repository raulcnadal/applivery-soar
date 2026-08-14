import { appliveryClient } from "../../services/appliveryClient";
import type { WindowsAppCatalogItem } from "./windowsAppCatalog.service";

type Headers = Record<string, string>;

/**
 * Windows per-device installed-app inventory — replaces the previously-used
 * `GET /mdm/windows/enterprise/devices/{winDeviceId}/applications` call
 * inside installedApps.service.ts's fetchAndStoreInstalledApps, which was
 * confirmed (both independently and by the user) to error persistently for
 * every Windows device in this org — its documented response schema is an
 * untyped `data: {}` with no items shape, consistent with it just not
 * working for this org/device population.
 *
 * The user found working alternatives, all hanging off the same
 * device-detail call (`GET /mdm/windows/enterprise/devices/{winDeviceId}`,
 * confirmed via the Applivery Docs MCP — see get-device.md):
 *
 *  - `data.config["./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/{productCode}/..."]`
 *    — one OMA-DM sub-tree per MSI product actually present on the device
 *    (Name, Version, Publisher, Status, InstallDate, ...). Verified against a
 *    real device dump the user provided: this is genuine third-party app
 *    data (7-Zip, VLC, the Applivery Agent MSI itself all showed up with
 *    correct name/version/publisher). Surfaced as `msiApps` below.
 *
 *  - `data.deviceWinPolicy.applicationsInfo` — the apps Applivery's Windows
 *    App Distribution has actually deployed/assigned to this device via its
 *    policy. The user supplied a real sample of this — each entry has the
 *    *same* shape as a windowsAppCatalog.service.ts WindowsAppCatalogItem
 *    (id, type, config, info, ...), i.e. it's the org's own
 *    application-catalog entry embedded directly rather than a separate
 *    schema. Its `info.config.msi.productCode` is the same productCode key
 *    used by the MSI CSP tree above, so this is used to mark which installed
 *    MSI apps are policy-enforced vs. merely present on the device for some
 *    other reason (e.g. the Applivery Agent MSI itself, which installs via
 *    enrollment, not app deployment, and correctly does NOT show up here on
 *    the sample device).
 *
 *  - `data.config["./Device/Vendor/MSFT/EnterpriseModernAppManagement/AppManagement/AppInventoryResults"]`
 *    — a large OMA-URI XML blob (`<Packages><Package .../></Packages>`) of
 *    every Appx/UWP package on the device. An earlier round of this
 *    integration deliberately excluded this entirely — parsed against one
 *    real device dump, every entry (even after excluding IsFramework/IsStub/
 *    IsProvisioned packages) was a first-party Microsoft Store component
 *    (Calculator, Paint, Xbox overlays, WebView runtimes, Widgets, ...), and
 *    corporate line-of-business apps install as classic desktop EXE/MSI, not
 *    Appx — so the conclusion at the time was "zero compliance signal, ~150
 *    OS-noise rows added per device."
 *
 *    That conclusion held for App List *compliance matching* (still true —
 *    complianceEvaluate.ts's requiredAppList/disallowedAppList only ever
 *    needs the identifiers, and those first-party components are a poor
 *    target for either kind of condition), but the user reported a real gap
 *    it created elsewhere: Applivery's own dashboard shows every one of
 *    these packages for a device (142 for the device the user checked, vs. 9
 *    from the MSI-only surface this module previously exposed) — admins
 *    comparing SOAR's Apps view against Applivery's own UI saw SOAR as
 *    strictly less complete, not appropriately curated. Surfaced now as
 *    `storeApps` below, tagged `origin: "store"` (vs. `"msi"`) throughout the
 *    pipeline so the UI can distinguish/filter them from classic installer
 *    apps rather than blending the two silently — parity with what Applivery
 *    itself shows, not a curated "what matters for compliance" subset.
 *    IsFramework packages ARE still excluded (shared runtime libraries are
 *    never a "package" in any user- or admin-facing sense, on any platform
 *    this app tracks); IsStub/IsProvisioned are kept but flagged, so a
 *    consumer that wants a stricter view can filter on those later without
 *    the raw signal having been thrown away at the source.
 */
export interface WindowsMsiApp {
  productCode: string;
  name: string;
  version: string;
  publisher: string | null;
  status: string | null;
  /** True when this productCode also appears in deviceWinPolicy.applicationsInfo. */
  enforcedByPolicy: boolean;
}

export interface WindowsStoreApp {
  /** The AppX package family/identity name, e.g. "Microsoft.WindowsCalculator" — this CSP node carries no separate human-friendly display name, so this doubles as both identifier source and the only name available. */
  name: string;
  version: string;
  publisher: string | null;
  packageFullName: string | null;
  isStub: boolean;
  isProvisioned: boolean;
}

const MSI_PREFIX = "./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/";
const APP_INVENTORY_KEY = "./Device/Vendor/MSFT/EnterpriseModernAppManagement/AppManagement/AppInventoryResults";

function normalizeProductCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Some OMA-DM sub-nodes come back as an error object instead of a plain
 * string when Applivery's own query to the device for that specific node
 * failed, e.g. `{"isError":true,"status":404,"reason":"CommandNotFound","attempts":[...]}`
 * (observed on a real device for one product's Version node) — treat those
 * as absent rather than stringifying "[object Object]" into a version field.
 */
function asCleanString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * `deviceWinPolicy.applicationsInfo` → Map<normalized productCode,
 * WindowsAppCatalogItem>. Only entries carrying an MSI productCode are
 * indexed (that's the only cross-reference this org's data has ever shown —
 * MSIX/store-type policy apps would need a different join key, not
 * available from the device-detail response).
 */
function indexEnforcedApplications(applicationsInfo: unknown): Map<string, WindowsAppCatalogItem> {
  const byProductCode = new Map<string, WindowsAppCatalogItem>();
  if (!Array.isArray(applicationsInfo)) return byProductCode;
  for (const item of applicationsInfo) {
    const code = item?.info?.config?.msi?.productCode;
    if (typeof code === "string" && code.trim()) {
      byProductCode.set(normalizeProductCode(code), item as WindowsAppCatalogItem);
    }
  }
  return byProductCode;
}

function xmlAttr(tag: string, attr: string): string | null {
  const m = new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return m ? m[1] : null;
}
function xmlBoolAttr(tag: string, attr: string): boolean {
  const v = xmlAttr(tag, attr);
  return v === "1" || (v ?? "").toLowerCase() === "true";
}

/**
 * Regex-based rather than a full XML parser — deliberately, since the shape
 * this OMA-URI node returns is a flat list of self-closing `<Package .../>`
 * elements under one `<Packages>` root (no nesting, no text content), which
 * a generic XML dependency would be overkill for. Tolerant of attribute
 * order/casing and of the two IsFramework spellings Microsoft's own CSP
 * implementations have shipped across OS builds ("IsFramework" being the
 * documented one) by matching case-insensitively.
 */
export function parseAppInventoryResults(xml: string): WindowsStoreApp[] {
  if (!xml || typeof xml !== "string") return [];
  const apps: WindowsStoreApp[] = [];
  const seen = new Set<string>();
  const tagRe = /<Package\b[^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = tagRe.exec(xml))) {
    const tag = m[0];
    if (xmlBoolAttr(tag, "IsFramework")) continue;
    const name = xmlAttr(tag, "Name");
    const version = xmlAttr(tag, "Version");
    if (!name || !version) continue;
    const packageFullName = xmlAttr(tag, "PackageFullName");
    const dedupeKey = (packageFullName || `${name}|${version}`).toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    apps.push({
      name,
      version,
      publisher: xmlAttr(tag, "Publisher"),
      packageFullName,
      isStub: xmlBoolAttr(tag, "IsStub"),
      isProvisioned: xmlBoolAttr(tag, "IsProvisioned"),
    });
  }
  return apps;
}

export async function fetchWindowsDeviceApps(
  headers: Headers,
  orgBase: string,
  winDeviceId: string,
): Promise<{ msiApps: WindowsMsiApp[]; storeApps: WindowsStoreApp[]; enforced: Map<string, WindowsAppCatalogItem>; error: string | null }> {
  try {
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/windows/enterprise/devices/${winDeviceId}`, { headers });
    if (res.status >= 300) return { msiApps: [], storeApps: [], enforced: new Map(), error: `Applivery returned ${res.status}` };

    const data = res.data?.data;
    const config = data?.config;
    const enforced = indexEnforcedApplications(data?.deviceWinPolicy?.applicationsInfo);
    if (!config || typeof config !== "object") return { msiApps: [], storeApps: [], enforced, error: null };

    // The MSI CSP is flattened into individual dotted keys per product code
    // (e.g. ".../MSI/{23170F69-...}/Name", ".../MSI/{23170F69-...}/Version"),
    // alongside a couple of tree-level keys (".../MSI" itself,
    // ".../MSI/UpgradeCode") that aren't product codes — discover the real
    // product codes by taking the first path segment after the MSI prefix.
    const productCodes = new Set<string>();
    for (const key of Object.keys(config)) {
      if (!key.startsWith(MSI_PREFIX)) continue;
      const rest = key.slice(MSI_PREFIX.length);
      const slash = rest.indexOf("/");
      if (slash <= 0) continue;
      productCodes.add(rest.slice(0, slash));
    }

    const msiApps: WindowsMsiApp[] = [];
    for (const code of productCodes) {
      const base = MSI_PREFIX + code;
      const name = asCleanString(config[`${base}/Name`]);
      const version = asCleanString(config[`${base}/Version`]);
      if (!name || !version) continue;
      // The config object's own keys use the raw (URL-encoded) product code,
      // e.g. "%7B23170F69-...%7D" — but deviceWinPolicy.applicationsInfo's
      // productCode is plain "{23170F69-...}". Decode before storing/matching
      // so productCode is in one consistent (plain-GUID) form everywhere
      // downstream, and so the enforced-by-policy cross-reference actually
      // matches instead of silently always missing.
      const decodedCode = decodeURIComponent(code);
      msiApps.push({
        productCode: decodedCode,
        name,
        version,
        publisher: asCleanString(config[`${base}/Publisher`]),
        status: asCleanString(config[`${base}/Status`]),
        enforcedByPolicy: enforced.has(normalizeProductCode(decodedCode)),
      });
    }

    const inventoryXml = asCleanString(config[APP_INVENTORY_KEY]);
    const storeApps = inventoryXml ? parseAppInventoryResults(inventoryXml) : [];

    return { msiApps, storeApps, enforced, error: null };
  } catch (e) {
    return { msiApps: [], storeApps: [], enforced: new Map(), error: String(e) };
  }
}
