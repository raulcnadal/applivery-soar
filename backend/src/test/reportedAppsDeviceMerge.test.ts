import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedDevice } from "../modules/devices/deviceNormalize";

/**
 * getReportedAppsOverview (installedApps.service.ts) — regression test for a
 * real reported bug: an app installed on ONE device, seen by both the SOAR
 * Agent (self-reported) and Applivery UEM (server-fetch), used to show up as
 * TWO separate device rows in the Apps view's per-app detail modal — same
 * device, same version, twice. The user's exact words: "an app should not
 * show 2 records for the same device and version... imagine with 100,000
 * devices." The fix merges both slots' contributions for a given
 * (device, app) down to one row, tagged with every source that saw it.
 */

function device(id: string, displayName: string): NormalizedDevice {
  return { id, displayName, platform: "windows" } as unknown as NormalizedDevice;
}

describe("getReportedAppsOverview — one row per (device, app), not one per (device, source)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("merges a self-reported + server-fetch sighting of the same app on the same device into a single devices[] row", async () => {
    const selfReported = {
      identifiers: ["7-zip"],
      apps: [{ identifier: "7-zip", name: "7-Zip", version: "23.01" }],
      platform: "windows",
      fetchedAt: "2026-08-16T09:30:00.000Z",
      error: null,
      source: "self_reported" as const,
      appleAppUpdates: null,
    };
    const serverFetch = {
      identifiers: ["7-zip"],
      apps: [{ identifier: "7-zip", name: "7-Zip", version: "23.01" }],
      platform: "windows",
      fetchedAt: "2026-08-16T10:00:00.000Z",
      error: null,
      source: "server_fetch" as const,
      appleAppUpdates: null,
    };
    vi.doMock("../services/prisma", () => ({
      prisma: {
        installedAppInventory: {
          findMany: vi.fn(async () => [{ deviceId: "dev-1", apps: { selfReported, serverFetch } }]),
        },
      },
    }));

    const { getReportedAppsOverview } = await import("../modules/appLists/installedApps.service");
    const { apps } = await getReportedAppsOverview("acme", [device("dev-1", "MI User ES-fe5db8652")]);

    expect(apps).toHaveLength(1);
    const app = apps[0]!;
    expect(app.identifier).toBe("7-zip");
    expect(app.deviceCount).toBe(1); // one physical device, not two
    expect(app.devices).toHaveLength(1); // one row, not one per source
    const row = app.devices[0]!;
    expect(row.deviceId).toBe("dev-1");
    expect(row.sources.slice().sort()).toEqual(["self_reported", "server_fetch"]);
    expect(row.version).toBe("23.01");
    expect(row.lastSyncAt).toBe("2026-08-16T10:00:00.000Z"); // the freshest of the two
    expect(row.versionsBySource).toBeUndefined(); // versions agree, no divergence to flag
  });

  it("still produces one row per device when only one source ever reported (Chrome self-reported only)", async () => {
    const selfReported = {
      identifiers: ["google chrome"],
      apps: [{ identifier: "google chrome", name: "Google Chrome", version: "151.0.7922.138" }],
      platform: "windows",
      fetchedAt: "2026-08-16T09:18:00.000Z",
      error: null,
      source: "self_reported" as const,
      appleAppUpdates: null,
    };
    vi.doMock("../services/prisma", () => ({
      prisma: {
        installedAppInventory: {
          findMany: vi.fn(async () => [{ deviceId: "dev-1", apps: { selfReported, serverFetch: null } }]),
        },
      },
    }));

    const { getReportedAppsOverview } = await import("../modules/appLists/installedApps.service");
    const { apps } = await getReportedAppsOverview("acme", [device("dev-1", "MI User ES-fe5db8652")]);

    expect(apps).toHaveLength(1);
    expect(apps[0]!.devices).toHaveLength(1);
    expect(apps[0]!.devices[0]!.sources).toEqual(["self_reported"]);
  });

  it("records a version disagreement between sources via versionsBySource instead of silently picking one", async () => {
    const selfReported = {
      identifiers: ["notepad++"],
      apps: [{ identifier: "notepad++", name: "Notepad++", version: "8.6.9" }],
      platform: "windows",
      fetchedAt: "2026-08-16T08:00:00.000Z",
      error: null,
      source: "self_reported" as const,
      appleAppUpdates: null,
    };
    const serverFetch = {
      identifiers: ["notepad++"],
      apps: [{ identifier: "notepad++", name: "Notepad++", version: "8.7.0" }],
      platform: "windows",
      fetchedAt: "2026-08-16T10:00:00.000Z",
      error: null,
      source: "server_fetch" as const,
      appleAppUpdates: null,
    };
    vi.doMock("../services/prisma", () => ({
      prisma: {
        installedAppInventory: {
          findMany: vi.fn(async () => [{ deviceId: "dev-1", apps: { selfReported, serverFetch } }]),
        },
      },
    }));

    const { getReportedAppsOverview } = await import("../modules/appLists/installedApps.service");
    const { apps } = await getReportedAppsOverview("acme", [device("dev-1", "MI User ES-fe5db8652")]);

    const row = apps[0]!.devices[0]!;
    expect(row.version).toBe("8.7.0"); // the fresher (server-fetch) contribution wins as the headline
    expect(row.versionsBySource).toEqual({ self_reported: "8.6.9", server_fetch: "8.7.0" });
  });

  it("keeps two separate devices as two separate rows (merge is per-device, not fleet-wide)", async () => {
    const entryFor = (source: "self_reported" | "server_fetch") => ({
      identifiers: ["7-zip"],
      apps: [{ identifier: "7-zip", name: "7-Zip", version: "23.01" }],
      platform: "windows",
      fetchedAt: "2026-08-16T10:00:00.000Z",
      error: null,
      source,
      appleAppUpdates: null,
    });
    vi.doMock("../services/prisma", () => ({
      prisma: {
        installedAppInventory: {
          findMany: vi.fn(async () => [
            { deviceId: "dev-1", apps: { selfReported: entryFor("self_reported"), serverFetch: null } },
            { deviceId: "dev-2", apps: { selfReported: null, serverFetch: entryFor("server_fetch") } },
          ]),
        },
      },
    }));

    const { getReportedAppsOverview } = await import("../modules/appLists/installedApps.service");
    const { apps } = await getReportedAppsOverview("acme", [device("dev-1", "Device 1"), device("dev-2", "Device 2")]);

    expect(apps[0]!.deviceCount).toBe(2);
    expect(apps[0]!.devices.map((d) => d.deviceId).sort()).toEqual(["dev-1", "dev-2"]);
  });
});
