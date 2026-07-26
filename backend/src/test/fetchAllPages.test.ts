import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appliveryClient } from "../services/appliveryClient";
import { fetchAllPages } from "../services/appliveryPaginate";

/**
 * Regression coverage for the scale fix: fetchAllPages used to default to
 * pageLimit=1000/maxPages=40 (a hard, silent 40,000-record ceiling) — way
 * under "hundreds of thousands of devices." Now defaults to
 * pageLimit=10,000 (Applivery's own documented max) / maxPages=100 (up to
 * 1,000,000 records), and — just as importantly — logs loudly instead of
 * silently returning a truncated list whenever a fleet/list genuinely is
 * larger than that.
 */
function pageResponse(items: unknown[], hasNextPage: boolean) {
  return { status: 200, data: { data: { items, hasNextPage } } };
}

describe("fetchAllPages", () => {
  const getMock = vi.mocked(appliveryClient.get);
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getMock.mockReset();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("walks multiple pages until hasNextPage is false, requesting Applivery's documented max page size by default", async () => {
    getMock
      .mockResolvedValueOnce(pageResponse([{ id: "1" }, { id: "2" }], true) as any)
      .mockResolvedValueOnce(pageResponse([{ id: "3" }], false) as any);

    const items = await fetchAllPages({}, "https://api.example/mdm/devices/");

    expect(items).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock.mock.calls[0][1]).toMatchObject({ params: { limit: 10_000, page: 1 } });
    expect(getMock.mock.calls[1][1]).toMatchObject({ params: { limit: 10_000, page: 2 } });
  });

  it("can collect well past the old 40,000-record ceiling without truncating (simulated large fleet)", async () => {
    const totalPages = 60; // 60 * 10,000 = 600,000 records — comfortably "hundreds of thousands"
    for (let i = 0; i < totalPages; i++) {
      getMock.mockResolvedValueOnce(pageResponse([{ id: `page-${i}` }], i < totalPages - 1) as any);
    }

    const items = await fetchAllPages({}, "https://api.example/mdm/devices/");
    expect(items).toHaveLength(totalPages);
    expect(errorSpy).not.toHaveBeenCalled(); // never hit the ceiling, so no truncation warning
  });

  it("logs loudly (does not fail silently) when the maxPages ceiling is actually hit", async () => {
    // Always claims more pages remain — will hit whatever maxPages is passed.
    getMock.mockImplementation(async () => pageResponse([{ id: "x" }], true) as any);

    const items = await fetchAllPages({}, "https://api.example/mdm/devices/", {}, 10_000, 5);

    expect(items).toHaveLength(5);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/hit the 5-page safety ceiling/);
    expect(errorSpy.mock.calls[0][0]).toMatch(/INCOMPLETE/);
  });

  it("throws if the very first page fails", async () => {
    getMock.mockResolvedValueOnce({ status: 500, data: { message: "boom" } } as any);
    await expect(fetchAllPages({}, "https://api.example/mdm/devices/")).rejects.toThrow(/Applivery API returned 500/);
  });

  it("logs loudly and returns partial results if a later page fails mid-walk", async () => {
    getMock
      .mockResolvedValueOnce(pageResponse([{ id: "1" }], true) as any)
      .mockResolvedValueOnce({ status: 503, data: {} } as any);

    const items = await fetchAllPages({}, "https://api.example/mdm/devices/");
    expect(items).toEqual([{ id: "1" }]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/page 2 failed/);
    expect(errorSpy.mock.calls[0][0]).toMatch(/INCOMPLETE/);
  });
});
