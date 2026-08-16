import { describe, expect, it } from "vitest";
import { evaluateCondition, type AppListsContext } from "../modules/compliance/complianceEvaluate";
import type { NormalizedDevice } from "../modules/devices/deviceNormalize";

/**
 * Regression test for the Windows Store (AppX/MSIX) identifier mismatch
 * reported live: an app added to the Custom Catalog via the MS Store search
 * gets a PackageFamilyName-shaped identifier ("<Name>_<PublisherId>", e.g.
 * "1ED5AEA5.4160926B82DB_p2gbknwb5d8r2" — Applivery's own search API never
 * returns the bare package identity), while the Windows agent/UEM always
 * report the bare identity Name only ("1ed5aea5.4160926b82db"). Without
 * stripping the PublisherId segment, requiredAppList/disallowedAppList (and
 * the frontend's AppDetailModal.vue catalogEntry lookup, mirroring this same
 * logic) would never recognize the app as present, no matter how it was
 * installed or how many times the device reported.
 */
function baseDevice(installedApps: Set<string>): NormalizedDevice & Record<string, any> {
  return {
    id: "device-1",
    installedApps,
  } as unknown as NormalizedDevice & Record<string, any>;
}

describe("evaluateCondition — requiredAppList/disallowedAppList vs. PackageFamilyName-shaped catalog identifiers", () => {
  const appLists: AppListsContext = {
    catalogById: new Map([
      ["catalog-1", { id: "catalog-1", identifier: "1ED5AEA5.4160926B82DB_p2gbknwb5d8r2", name: "Angry Birds 2" }],
    ]),
    listById: new Map([["list-1", { id: "list-1", appIds: ["catalog-1"] }]]),
  };

  it("requiredAppList recognizes the app as present once the PublisherId suffix is stripped", () => {
    const device = baseDevice(new Set(["1ed5aea5.4160926b82db"]));
    const violated = evaluateCondition(device, { field: "requiredAppList", operator: "equals", value: "list-1" }, appLists);
    expect(violated).toBe(false); // present -> not violated
  });

  it("disallowedAppList still flags the app as present (violated) once stripped", () => {
    const device = baseDevice(new Set(["1ed5aea5.4160926b82db"]));
    const violated = evaluateCondition(device, { field: "disallowedAppList", operator: "equals", value: "list-1" }, appLists);
    expect(violated).toBe(true); // present -> disallowed policy violated
  });

  it("requiredAppList still reports missing when the app truly isn't installed", () => {
    const device = baseDevice(new Set(["some.other.app"]));
    const violated = evaluateCondition(device, { field: "requiredAppList", operator: "equals", value: "list-1" }, appLists);
    expect(violated).toBe(true); // absent -> violated
  });

  it("does not false-strip a legitimate winget-style identifier that happens to contain an underscore", () => {
    // "foo_bar" -> stripping would only trigger on a trailing "_<13 alnum>" segment;
    // "bar" here is 3 chars, so no strip should occur and only an exact/name match applies.
    const winget: AppListsContext = {
      catalogById: new Map([["catalog-2", { id: "catalog-2", identifier: "Publisher.App_bar", name: "Some App" }]]),
      listById: new Map([["list-2", { id: "list-2", appIds: ["catalog-2"] }]]),
    };
    const device = baseDevice(new Set(["publisher.app_bar"])); // exact match still works
    const violated = evaluateCondition(device, { field: "requiredAppList", operator: "equals", value: "list-2" }, winget);
    expect(violated).toBe(false);
  });
});
