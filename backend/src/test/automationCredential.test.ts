import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * automationCredential.service.ts — rewritten from a session-snapshot
 * (apiToken/refreshToken pair, self-refreshing) design to a single Applivery
 * Service Account Bearer token, after a real production incident: a live
 * browser session (frontend/src/composables/useSessionGuards.ts) and this
 * backend's own periodic refresh were two independent consumers rotating
 * the same shared Applivery refresh token, silently invalidating each
 * other's copy. See schema.prisma's AutomationCredential doc comment and
 * backend/docs/settings.md#workspace-automation for the full incident.
 *
 * Same vi.doMock("../services/prisma", ...) pattern as
 * mtlsAgentSubdomain.test.ts / mtlsGlobalBootstrapToken.test.ts. Also mocks
 * "../services/appliveryClient" since setAutomationCredential now validates
 * the pasted token against Applivery before persisting it.
 */

const AUDIT_MOCK = { create: vi.fn(async () => ({ id: "log-1" })) };

describe("automationCredential.service — Service Account token store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getAutomationCredentialStatus returns not-configured when no row exists", async () => {
    vi.doMock("../services/prisma", () => ({ prisma: { automationCredential: { findUnique: vi.fn(async () => null) } } }));
    const { getAutomationCredentialStatus } = await import("../modules/settings/automationCredential.service");
    await expect(getAutomationCredentialStatus("acme")).resolves.toEqual({ configured: false, source: null });
  });

  it("getAutomationCredentialStatus treats a pre-migration row with an empty serviceAccountToken as not-configured", async () => {
    // Rows that existed before the Service Account rewrite have their old
    // apiToken/refreshToken columns dropped and serviceAccountToken
    // defaulted to '' by the migration — an admin has to paste a fresh
    // token, same one-time step as the original setup.
    const findUnique = vi.fn(async () => ({ workspaceSlug: "acme", serviceAccountToken: "", configuredBy: "old@acme.com", configuredAt: new Date(), lastVerifiedAt: null }));
    vi.doMock("../services/prisma", () => ({ prisma: { automationCredential: { findUnique } } }));
    const { getAutomationCredentialStatus } = await import("../modules/settings/automationCredential.service");
    await expect(getAutomationCredentialStatus("acme")).resolves.toEqual({ configured: false, source: null });
  });

  it("getAutomationCredentialStatus reports a genuinely configured row", async () => {
    const configuredAt = new Date("2026-08-16T10:00:00Z");
    const lastVerifiedAt = new Date("2026-08-16T10:00:01Z");
    const findUnique = vi.fn(async () => ({ workspaceSlug: "acme", serviceAccountToken: "iv:tag:cipher", configuredBy: "admin@acme.com", configuredAt, lastVerifiedAt }));
    vi.doMock("../services/prisma", () => ({ prisma: { automationCredential: { findUnique } } }));
    const { getAutomationCredentialStatus } = await import("../modules/settings/automationCredential.service");
    await expect(getAutomationCredentialStatus("acme")).resolves.toEqual({
      configured: true,
      source: "stored",
      configuredBy: "admin@acme.com",
      configuredAt: configuredAt.toISOString(),
      lastVerifiedAt: lastVerifiedAt.toISOString(),
    });
  });

  it("setAutomationCredential rejects a token Applivery itself rejects (401/403), never persisting it", async () => {
    const upsert = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({ prisma: { automationCredential: { upsert }, auditLogEntry: AUDIT_MOCK } }));
    vi.doMock("../services/appliveryClient", () => ({ appliveryClient: { get: vi.fn(async () => ({ status: 401, data: {} })) } }));
    const { setAutomationCredential } = await import("../modules/settings/automationCredential.service");
    await expect(setAutomationCredential("acme", { serviceAccountToken: "bad-token" }, "admin@acme.com")).rejects.toMatchObject({ statusCode: 400 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("setAutomationCredential surfaces a 502 when Applivery itself is unreachable, never persisting it", async () => {
    const upsert = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({ prisma: { automationCredential: { upsert }, auditLogEntry: AUDIT_MOCK } }));
    vi.doMock("../services/appliveryClient", () => ({ appliveryClient: { get: vi.fn(async () => { throw new Error("network error"); }) } }));
    const { setAutomationCredential } = await import("../modules/settings/automationCredential.service");
    await expect(setAutomationCredential("acme", { serviceAccountToken: "some-token" }, "admin@acme.com")).rejects.toMatchObject({ statusCode: 502 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("setAutomationCredential validates against Applivery, then encrypts and upserts the trimmed token on success", async () => {
    const upsert = vi.fn(async (_args: any) => undefined);
    const getSpy = vi.fn(async () => ({ status: 200, data: { status: true, data: {} } }));
    vi.doMock("../services/prisma", () => ({ prisma: { automationCredential: { upsert }, auditLogEntry: AUDIT_MOCK } }));
    vi.doMock("../services/appliveryClient", () => ({ appliveryClient: { get: getSpy } }));
    const { setAutomationCredential } = await import("../modules/settings/automationCredential.service");
    await setAutomationCredential("acme", { serviceAccountToken: "  a-real-token  " }, "admin@acme.com");

    expect(getSpy).toHaveBeenCalledWith("/organizations/acme", { headers: { Authorization: "Bearer a-real-token" } });
    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0]![0];
    expect(call.where).toEqual({ workspaceSlug: "acme" });
    expect(call.create.serviceAccountToken).not.toBe("a-real-token"); // encrypted at rest, never the raw value
    expect(call.create.serviceAccountToken).not.toContain("a-real-token");
    expect(call.create.configuredBy).toBe("admin@acme.com");
    // AES-GCM uses a random IV per call, so create's and update's ciphertext
    // legitimately differ even though both encrypt the same plaintext —
    // decrypt both back and compare the plaintext instead of the ciphertext.
    const { decryptSecret } = await import("../utils/secretCipher");
    expect(decryptSecret(call.create.serviceAccountToken)).toBe("a-real-token");
    expect(decryptSecret(call.update.serviceAccountToken)).toBe("a-real-token");
  });

  it("getAutomationBearer returns null when nothing is configured — no refresh attempt, just a lookup", async () => {
    vi.doMock("../services/prisma", () => ({ prisma: { automationCredential: { findUnique: vi.fn(async () => null) } } }));
    const { getAutomationBearer } = await import("../modules/settings/automationCredential.service");
    await expect(getAutomationBearer("acme")).resolves.toBeNull();
  });

  it("getAutomationBearer decrypts and returns 'Bearer <token>' with no network call at all (the whole point of dropping the refresh flow)", async () => {
    const { encryptSecret } = await import("../utils/secretCipher");
    const encrypted = encryptSecret("real-service-account-token");
    vi.doMock("../services/prisma", () => ({ prisma: { automationCredential: { findUnique: vi.fn(async () => ({ workspaceSlug: "acme", serviceAccountToken: encrypted })) } } }));
    const getSpy = vi.fn();
    vi.doMock("../services/appliveryClient", () => ({ appliveryClient: { get: getSpy } }));
    const { getAutomationBearer } = await import("../modules/settings/automationCredential.service");
    await expect(getAutomationBearer("acme")).resolves.toBe("Bearer real-service-account-token");
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("listAutomationWorkspaces excludes pre-migration rows with an empty serviceAccountToken", async () => {
    const findMany = vi.fn(async () => [{ workspaceSlug: "acme" }, { workspaceSlug: "zeta" }]);
    vi.doMock("../services/prisma", () => ({ prisma: { automationCredential: { findMany } } }));
    const { listAutomationWorkspaces } = await import("../modules/settings/automationCredential.service");
    await expect(listAutomationWorkspaces()).resolves.toEqual(["acme", "zeta"]);
    expect(findMany).toHaveBeenCalledWith({ where: { serviceAccountToken: { not: "" } }, select: { workspaceSlug: true } });
  });

  it("clearAutomationCredential deletes an existing row and records an audit event", async () => {
    const deleteFn = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({
      prisma: { automationCredential: { findUnique: vi.fn(async () => ({ workspaceSlug: "acme" })), delete: deleteFn }, auditLogEntry: AUDIT_MOCK },
    }));
    const { clearAutomationCredential } = await import("../modules/settings/automationCredential.service");
    await clearAutomationCredential("acme", "admin@acme.com");
    expect(deleteFn).toHaveBeenCalledWith({ where: { workspaceSlug: "acme" } });
  });

  it("clearAutomationCredential is a no-op when nothing is configured", async () => {
    const deleteFn = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({
      prisma: { automationCredential: { findUnique: vi.fn(async () => null), delete: deleteFn } },
    }));
    const { clearAutomationCredential } = await import("../modules/settings/automationCredential.service");
    await clearAutomationCredential("acme", "admin@acme.com");
    expect(deleteFn).not.toHaveBeenCalled();
  });
});
