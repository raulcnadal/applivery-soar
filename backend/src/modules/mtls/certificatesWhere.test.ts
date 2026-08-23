import { describe, expect, it } from "vitest";
import { buildCertificatesWhere, normalizeHexSearch } from "./certificates.service";

/**
 * Pure-logic regression test for the Issued Device Certificates panel
 * redesign's search filter (no Prisma involved) — specifically the
 * colon-agnostic thumbprint search normalization, since a pasted thumbprint
 * copy/pasted from a browser's certificate viewer almost always has colons
 * ("AB:12:CD:...") while the stored column is plain hex.
 */
describe("normalizeHexSearch", () => {
  it("strips colons and uppercases", () => {
    expect(normalizeHexSearch("ab:12:cd")).toBe("AB12CD");
  });

  it("strips whitespace and other punctuation", () => {
    expect(normalizeHexSearch("ab 12-cd")).toBe("AB12CD");
  });

  it("drops non-hex letters, leaving only hex-ish characters", () => {
    expect(normalizeHexSearch("ghij")).toBe(""); // g,h,i,j aren't hex digits
    expect(normalizeHexSearch("deadBEEF")).toBe("DEADBEEF");
  });
});

describe("buildCertificatesWhere", () => {
  it("filters to revokedAt: null for status=active", () => {
    const where = buildCertificatesWhere("acme", { status: "active" });
    expect(where).toMatchObject({ workspaceSlug: "acme", revokedAt: null });
    expect(where.OR).toBeUndefined();
  });

  it("filters to revokedAt: { not: null } for status=revoked", () => {
    const where = buildCertificatesWhere("acme", { status: "revoked" });
    expect(where).toMatchObject({ workspaceSlug: "acme", revokedAt: { not: null } });
  });

  it("adds an OR across serialNumber/serialHex/thumbprintHex when search has hex content", () => {
    const where = buildCertificatesWhere("acme", { status: "active", search: "AB:12" });
    expect(Array.isArray(where.OR)).toBe(true);
    const or = where.OR as Record<string, unknown>[];
    expect(or).toContainEqual({ serialNumber: { contains: "AB:12", mode: "insensitive" } });
    expect(or).toContainEqual({ serialHex: { contains: "AB:12", mode: "insensitive" } });
    expect(or).toContainEqual({ thumbprintHex: { contains: "AB12" } });
  });

  it("omits the thumbprint branch when the search has no hex characters at all", () => {
    // Deliberately zero occurrences of 0-9/a-f (case-insensitive) anywhere
    // in this string — "unmatched device" or similar would actually contain
    // plenty of hex-valid letters (a, c, d, e) and defeat the point of this
    // test.
    const where = buildCertificatesWhere("acme", { status: "active", search: "Working Unit" });
    const or = where.OR as Record<string, unknown>[];
    expect(or.some((clause) => "thumbprintHex" in clause)).toBe(false);
  });

  it("adds no OR clause when search is blank/whitespace", () => {
    const where = buildCertificatesWhere("acme", { status: "active", search: "   " });
    expect(where.OR).toBeUndefined();
  });
});
