import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * fetchAndStoreInstalledApps (installedApps.service.ts) — regression test for
 * a real reported bug: a device that had been failing to fetch fresh
 * installed-app data for months (offline, unenrolled, whatever) still showed
 * "19m ago" in the Apps view, because fetchedAt was stamped to now() on every
 * attempt, including failed ones. Applivery UEM itself reported the same
 * device's last report as 3 months old. The fix preserves the previous
 * serverFetch entry's fetchedAt on error, same as it already preserved
 * identifiers/apps on error — fetchedAt should answer "how fresh is this
 * data", not "when did we last try".
 */

const OLD_FETCHED_AT = "2026-05-16T10:00:00.000Z"; // ~3 months before the fixed "now" below

describe("fetchAndStoreInstalledApps — fetchedAt must reflect last SUCCESS, not last attempt", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T10:00:00.000Z"));
  });

  it("preserves the old fetchedAt (and old app data) when the live fetch errors, instead of stamping now()", async () => {
    const existingEntry = {
      identifiers: ["com.example.app"],
      apps: [{ identifier: "com.example.app", name: "Example App", version: "1.0.0" }],
      platform: "android",
      fetchedAt: OLD_FETCHED_AT,
      error: null,
      source: "server_fetch" as const,
      appleAppUpdates: null,
    };
    const upsert = vi.fn(async (_args: any) => undefined);
    vi.doMock("../services/prisma", () => ({
      prisma: {
        installedAppInventory: {
          findUnique: vi.fn(async () => ({ apps: { selfReported: null, serverFetch: existingEntry } })),
          upsert,
        },
      },
    }));
    vi.doMock("../services/appliveryClient", () => ({
      appliveryClient: { get: vi.fn(async () => { throw new Error("device unreachable"); }) },
    }));

    const { fetchAndStoreInstalledApps } = await import("../modules/appLists/installedApps.service");
    await fetchAndStoreInstalledApps({ Authorization: "Bearer x" }, "https://api.applivery.io/v1/organizations/acme", { id: "dev-1", platform: "android" } as any, "acme");

    expect(upsert).toHaveBeenCalledTimes(1);
    const written = upsert.mock.calls[0]![0].update.apps.serverFetch;
    expect(written.error).not.toBeNull(); // the attempt genuinely failed
    expect(written.fetchedAt).toBe(OLD_FETCHED_AT); // but freshness is unchanged, not stamped to now()
    expect(written.apps).toEqual(existingEntry.apps); // and the old data is preserved, not wiped
  });

  it("still stamps now() on error when there's no prior successful fetch to fall back to (a brand-new device)", async () => {
    const upsert = vi.fn(async (_args: any) => undefined);
    vi.doMock("../services/prisma", () => ({
      prisma: {
        installedAppInventory: {
          findUnique: vi.fn(async () => null),
          upsert,
        },
      },
    }));
    vi.doMock("../services/appliveryClient", () => ({
      appliveryClient: { get: vi.fn(async () => { throw new Error("device unreachable"); }) },
    }));

    const { fetchAndStoreInstalledApps } = await import("../modules/appLists/installedApps.service");
    await fetchAndStoreInstalledApps({ Authorization: "Bearer x" }, "https://api.applivery.io/v1/organizations/acme", { id: "dev-2", platform: "android" } as any, "acme");

    const written = upsert.mock.calls[0]![0].update.apps.serverFetch;
    expect(written.error).not.toBeNull();
    expect(written.fetchedAt).toBe("2026-08-16T10:00:00.000Z"); // no better value exists yet, so now() is the honest answer
  });

  it("stamps a fresh fetchedAt on a genuinely successful fetch", async () => {
    const upsert = vi.fn(async (_args: any) => undefined);
    vi.doMock("../services/prisma", () => ({
      prisma: {
        installedAppInventory: {
          findUnique: vi.fn(async () => null),
          upsert,
        },
      },
    }));
    vi.doMock("../services/appliveryClient", () => ({
      appliveryClient: {
        get: vi.fn(async () => ({
          status: 200,
          data: { data: [{ packageName: "com.example.app", displayName: "Example App", versionName: "2.0.0", state: "INSTALLED" }] },
        })),
      },
    }));

    const { fetchAndStoreInstalledApps } = await import("../modules/appLists/installedApps.service");
    await fetchAndStoreInstalledApps({ Authorization: "Bearer x" }, "https://api.applivery.io/v1/organizations/acme", { id: "dev-3", platform: "android" } as any, "acme");

    const written = upsert.mock.calls[0]![0].update.apps.serverFetch;
    expect(written.error).toBeNull();
    expect(written.fetchedAt).toBe("2026-08-16T10:00:00.000Z");
    expect(written.apps).toHaveLength(1);
  });
});
