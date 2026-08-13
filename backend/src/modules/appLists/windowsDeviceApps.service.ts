import { appliveryClient } from "../../services/appliveryClient";

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
 * The user found two endpoints that DO work, both hanging off the same
 * device-detail call (`GET /mdm/windows/enterprise/devices/{winDeviceId}`,
 * confirmed via the Applivery Docs MCP — see get-device.md):
 *
 *  - `data.config["./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/{productCode}/..."]`
 *    — one OMA-DM sub-tree per MSI product Applivery has deployed/tracked on
 *    the device (Name, Version, Publisher, Status, InstallDate, ...). Verified
 *    against a real device dump the user provided: this is genuine
 *    third-party app data (7-Zip, VLC, the Applivery Agent MSI itself all
 *    showed up with correct name/version/publisher). This is what this
 *    module surfaces, tagged as "Applivery UEM" (source: "server_fetch") in
 *    the Apps view.
 *
 *  - `data.config["./Device/Vendor/MSFT/EnterpriseModernAppManagement/AppManagement/AppInventoryResults"]`
 *    — a large OMA-URI XML blob (`<Packages><Package .../></Packages>`) of
 *    every Appx/UWP package on the device. Deliberately NOT surfaced by this
 *    module: parsed against the same real device dump, every single entry —
 *    even after filtering out IsFramework/IsStub/IsProvisioned packages —
 *    was a first-party Microsoft Store component (Calculator, Paint, Xbox
 *    overlays, WebView runtimes, Widgets, ...). Corporate apps like
 *    Chrome/Slack/Figma install as classic desktop EXE/MSI, not Appx, so on
 *    real data this blob carries zero compliance signal and would add
 *    ~150 OS-noise rows to the Apps view per Windows device. If a future org
 *    genuinely deploys Appx/MSIX apps via Applivery, this is the place to
 *    add that parsing back in.
 *
 * `deviceWinPolicy.applicationsInfo` (apps enforced by the device's assigned
 * Windows policy) is intentionally not parsed here either — its `items`
 * schema is undocumented (`type: object, properties: {}`) and no real sample
 * of its shape was available to build a parser against without guessing at
 * field names.
 */
export interface WindowsMsiApp {
  productCode: string;
  name: string;
  version: string;
  publisher: string | null;
  status: string | null;
}

const MSI_PREFIX = "./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/";

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

export async function fetchWindowsDeviceMsiApps(headers: Headers, orgBase: string, winDeviceId: string): Promise<{ apps: WindowsMsiApp[]; error: string | null }> {
  try {
    const res = await appliveryClient.get<any>(`${orgBase}/mdm/windows/enterprise/devices/${winDeviceId}`, { headers });
    if (res.status >= 300) return { apps: [], error: `Applivery returned ${res.status}` };

    const config = res.data?.data?.config;
    if (!config || typeof config !== "object") return { apps: [], error: null };

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

    const apps: WindowsMsiApp[] = [];
    for (const code of productCodes) {
      const base = MSI_PREFIX + code;
      const name = asCleanString(config[`${base}/Name`]);
      const version = asCleanString(config[`${base}/Version`]);
      if (!name || !version) continue;
      apps.push({
        productCode: code,
        name,
        version,
        publisher: asCleanString(config[`${base}/Publisher`]),
        status: asCleanString(config[`${base}/Status`]),
      });
    }
    return { apps, error: null };
  } catch (e) {
    return { apps: [], error: String(e) };
  }
}
