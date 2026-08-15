import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * globalBootstrapToken.service.ts — the status/rotate/clear lifecycle for
 * the single, workspace-wide mTLS enrollment credential (see its module doc
 * and GlobalBootstrapToken's schema.prisma doc comment for the full design).
 * The actual enrollment validation chain (token compare + anti-hijack guard
 * + live Applivery serial-number check) lives in deviceMtls.service.ts's
 * registerDevice and is covered in mtls.test.ts's "deviceMtls.service"
 * describe block, right next to the CSR-signing logic it feeds.
 *
 * Same vi.doMock("../services/prisma", ...) pattern as mtls.test.ts (see
 * that file's own note on why the shared setup.ts Proxy mock can't support
 * per-test overrides) — a stable local mock object per test, registered
 * before the dynamic import of the module under test.
 */

const AUDIT_MOCK = { create: vi.fn(async () => ({ id: "log-1" })) };

describe("globalBootstrapToken.service — the single, workspace-wide mTLS enrollment credential", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getGlobalBootstrapTokenStatus reports not-configured when no row exists", async () => {
    vi.doMock("../services/prisma", () => ({ prisma: { globalBootstrapToken: { findUnique: vi.fn(async () => null) } } }));
    const { getGlobalBootstrapTokenStatus } = await import("../modules/mtls/globalBootstrapToken.service");
    await expect(getGlobalBootstrapTokenStatus("acme")).resolves.toEqual({ configured: false, secret: null });
  });

  it("getGlobalBootstrapTokenStatus decrypts and returns the stored token when configured", async () => {
    const findUnique = vi.fn(async () => ({ workspaceSlug: "acme", secret: "encrypted-blob", rotatedBy: "admin", updatedAt: new Date("2026-01-01T00:00:00Z") }));
    vi.doMock("../services/prisma", () => ({ prisma: { globalBootstrapToken: { findUnique } } }));
    vi.doMock("../utils/secretCipher", () => ({ decryptSecret: vi.fn(() => "plain-token-value"), encryptSecret: vi.fn((s: string) => `enc(${s})`) }));
    const { getGlobalBootstrapTokenStatus } = await import("../modules/mtls/globalBootstrapToken.service");
    await expect(getGlobalBootstrapTokenStatus("acme")).resolves.toEqual({
      configured: true,
      secret: "plain-token-value",
      rotatedBy: "admin",
      rotatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rotateGlobalBootstrapToken upserts an encrypted token and hands back the plaintext exactly once", async () => {
    const upsert = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({ prisma: { globalBootstrapToken: { upsert }, auditLogEntry: AUDIT_MOCK } }));
    const { rotateGlobalBootstrapToken } = await import("../modules/mtls/globalBootstrapToken.service");
    const result = await rotateGlobalBootstrapToken("acme", "tester");
    expect(result.configured).toBe(true);
    expect(typeof result.secret).toBe("string");
    expect(result.secret!.length).toBeGreaterThan(10);
    expect(upsert).toHaveBeenCalled();
  });

  it("clearGlobalBootstrapToken deletes the row when one exists", async () => {
    const deleteFn = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({
      prisma: { globalBootstrapToken: { findUnique: vi.fn(async () => ({ workspaceSlug: "acme" })), delete: deleteFn }, auditLogEntry: AUDIT_MOCK },
    }));
    const { clearGlobalBootstrapToken } = await import("../modules/mtls/globalBootstrapToken.service");
    await clearGlobalBootstrapToken("acme", "tester");
    expect(deleteFn).toHaveBeenCalledWith({ where: { workspaceSlug: "acme" } });
  });

  it("clearGlobalBootstrapToken is a no-op (no delete call) when nothing is configured", async () => {
    const deleteFn = vi.fn();
    vi.doMock("../services/prisma", () => ({
      prisma: { globalBootstrapToken: { findUnique: vi.fn(async () => null), delete: deleteFn }, auditLogEntry: AUDIT_MOCK },
    }));
    const { clearGlobalBootstrapToken } = await import("../modules/mtls/globalBootstrapToken.service");
    await clearGlobalBootstrapToken("acme", "tester");
    expect(deleteFn).not.toHaveBeenCalled();
  });
});
