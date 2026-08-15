import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase E addendum — self-service enrollment (enrollmentSecret.service.ts +
 * mtlsEnrollment.service.ts). See mtlsEnrollment.service.ts's module doc for
 * the full SECURITY MODEL this is deliberately testing every edge of: the
 * shared EnrollmentSecret plus a live Applivery serial-number check stand in
 * for DeviceBootstrapToken's per-device cryptographic binding, and the
 * "already-active cert can never be silently re-claimed" rule is the one
 * hard backstop that keeps a leaked secret from being able to steal an
 * already-enrolled device's identity.
 *
 * Same vi.doMock("../services/prisma", ...) pattern as mtls.test.ts (see
 * that file's own note on why the shared setup.ts Proxy mock can't support
 * per-test overrides) — a stable local mock object per test, registered
 * before the dynamic import of the module under test.
 */

const CSR = "csr-pem-placeholder";
const AUDIT_MOCK = { create: vi.fn(async () => ({ id: "log-1" })) };

describe("enrollmentSecret.service — the shared self-service secret + mode toggle", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getEnrollmentSecretStatus reports not-configured when no row exists", async () => {
    vi.doMock("../services/prisma", () => ({ prisma: { enrollmentSecret: { findUnique: vi.fn(async () => null) } } }));
    const { getEnrollmentSecretStatus } = await import("../modules/mtls/enrollmentSecret.service");
    await expect(getEnrollmentSecretStatus("acme")).resolves.toEqual({ configured: false, secret: null });
  });

  it("getEnrollmentSecretStatus decrypts and returns the stored secret when configured", async () => {
    const findUnique = vi.fn(async () => ({ workspaceSlug: "acme", secret: "encrypted-blob", rotatedBy: "admin", updatedAt: new Date("2026-01-01T00:00:00Z") }));
    vi.doMock("../services/prisma", () => ({ prisma: { enrollmentSecret: { findUnique } } }));
    vi.doMock("../utils/secretCipher", () => ({ decryptSecret: vi.fn(() => "plain-secret-value"), encryptSecret: vi.fn((s: string) => `enc(${s})`) }));
    const { getEnrollmentSecretStatus } = await import("../modules/mtls/enrollmentSecret.service");
    await expect(getEnrollmentSecretStatus("acme")).resolves.toEqual({
      configured: true,
      secret: "plain-secret-value",
      rotatedBy: "admin",
      rotatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rotateEnrollmentSecret upserts an encrypted secret and hands back the plaintext exactly once", async () => {
    const upsert = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({ prisma: { enrollmentSecret: { upsert }, auditLogEntry: AUDIT_MOCK } }));
    const { rotateEnrollmentSecret } = await import("../modules/mtls/enrollmentSecret.service");
    const result = await rotateEnrollmentSecret("acme", "tester");
    expect(result.configured).toBe(true);
    expect(typeof result.secret).toBe("string");
    expect(result.secret!.length).toBeGreaterThan(10);
    expect(upsert).toHaveBeenCalled();
  });

  it("clearEnrollmentSecret deletes the secret AND resets self-service mode back to disabled", async () => {
    const deleteFn = vi.fn(async () => undefined);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    vi.doMock("../services/prisma", () => ({
      prisma: { enrollmentSecret: { findUnique: vi.fn(async () => ({ workspaceSlug: "acme" })), delete: deleteFn }, workspaceState: { updateMany }, auditLogEntry: AUDIT_MOCK },
    }));
    const { clearEnrollmentSecret } = await import("../modules/mtls/enrollmentSecret.service");
    await clearEnrollmentSecret("acme", "tester");
    expect(deleteFn).toHaveBeenCalledWith({ where: { workspaceSlug: "acme" } });
    expect(updateMany).toHaveBeenCalledWith({ where: { workspaceSlug: "acme" }, data: { mtlsSelfServiceMode: "disabled" } });
  });

  it("getSelfServiceMode defaults to 'disabled' when there's no WorkspaceState row", async () => {
    vi.doMock("../services/prisma", () => ({ prisma: { workspaceState: { findUnique: vi.fn(async () => null) } } }));
    const { getSelfServiceMode } = await import("../modules/mtls/enrollmentSecret.service");
    await expect(getSelfServiceMode("acme")).resolves.toBe("disabled");
  });

  it("setSelfServiceMode rejects an unrecognized mode value", async () => {
    vi.doMock("../services/prisma", () => ({ prisma: {} }));
    const { setSelfServiceMode } = await import("../modules/mtls/enrollmentSecret.service");
    await expect(setSelfServiceMode("acme", "tester", "yolo")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("setSelfServiceMode refuses to enable (silent/approval) without a CA configured", async () => {
    vi.doMock("../services/prisma", () => ({
      prisma: { certificateAuthority: { findUnique: vi.fn(async () => null) }, enrollmentSecret: { findUnique: vi.fn(async () => ({ workspaceSlug: "acme" })) } },
    }));
    const { setSelfServiceMode } = await import("../modules/mtls/enrollmentSecret.service");
    await expect(setSelfServiceMode("acme", "tester", "approval")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("setSelfServiceMode refuses to enable without an enrollment secret configured", async () => {
    vi.doMock("../services/prisma", () => ({
      prisma: { certificateAuthority: { findUnique: vi.fn(async () => ({ workspaceSlug: "acme" })) }, enrollmentSecret: { findUnique: vi.fn(async () => null) } },
    }));
    const { setSelfServiceMode } = await import("../modules/mtls/enrollmentSecret.service");
    await expect(setSelfServiceMode("acme", "tester", "approval")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("setSelfServiceMode succeeds once both a CA and a secret exist", async () => {
    const upsert = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({
      prisma: {
        certificateAuthority: { findUnique: vi.fn(async () => ({ workspaceSlug: "acme" })) },
        enrollmentSecret: { findUnique: vi.fn(async () => ({ workspaceSlug: "acme" })) },
        workspaceState: { upsert },
        auditLogEntry: AUDIT_MOCK,
      },
    }));
    const { setSelfServiceMode } = await import("../modules/mtls/enrollmentSecret.service");
    await expect(setSelfServiceMode("acme", "tester", "approval")).resolves.toEqual({ mode: "approval" });
    expect(upsert).toHaveBeenCalled();
  });

  it("setSelfServiceMode('disabled') never checks for a CA or secret — always allowed as an escape hatch", async () => {
    const findUniqueCa = vi.fn();
    vi.doMock("../services/prisma", () => ({
      prisma: { certificateAuthority: { findUnique: findUniqueCa }, workspaceState: { upsert: vi.fn(async () => undefined) }, auditLogEntry: AUDIT_MOCK },
    }));
    const { setSelfServiceMode } = await import("../modules/mtls/enrollmentSecret.service");
    await expect(setSelfServiceMode("acme", "tester", "disabled")).resolves.toEqual({ mode: "disabled" });
    expect(findUniqueCa).not.toHaveBeenCalled();
  });
});

describe("mtlsEnrollment.service — self-service enrollment request/poll/approval flow", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("requestEnrollment rejects outright when self-service mode is 'disabled' — the opt-in gate", async () => {
    vi.doMock("../modules/mtls/enrollmentSecret.service", () => ({ getSelfServiceMode: vi.fn(async () => "disabled"), getEnrollmentSecretStatus: vi.fn() }));
    const { requestEnrollment } = await import("../modules/mtls/mtlsEnrollment.service");
    await expect(requestEnrollment("acme", { csrPem: CSR, serialNumber: "SN-1" }, "some-secret")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects a wrong/missing enrollment secret", async () => {
    vi.doMock("../modules/mtls/enrollmentSecret.service", () => ({
      getSelfServiceMode: vi.fn(async () => "approval"),
      getEnrollmentSecretStatus: vi.fn(async () => ({ configured: true, secret: "the-real-secret" })),
    }));
    const { requestEnrollment } = await import("../modules/mtls/mtlsEnrollment.service");
    await expect(requestEnrollment("acme", { csrPem: CSR, serialNumber: "SN-1" }, "wrong-secret")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("CRITICAL: rejects a device that already has an active certificate, before ever calling out to Applivery — the anti-hijack backstop", async () => {
    vi.doMock("../modules/mtls/enrollmentSecret.service", () => ({
      getSelfServiceMode: vi.fn(async () => "approval"),
      getEnrollmentSecretStatus: vi.fn(async () => ({ configured: true, secret: "the-real-secret" })),
    }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => ({ id: "cert-1" })) }));
    const getDevicesFull = vi.fn();
    vi.doMock("../modules/devices/devices.service", () => ({ getDevicesFull }));

    const { requestEnrollment } = await import("../modules/mtls/mtlsEnrollment.service");
    await expect(requestEnrollment("acme", { csrPem: CSR, serialNumber: "SN-1" }, "the-real-secret")).rejects.toMatchObject({ statusCode: 409 });
    expect(getDevicesFull).not.toHaveBeenCalled();
  });

  it("rejects a serial number Applivery doesn't currently recognize as an enrolled device", async () => {
    vi.doMock("../modules/mtls/enrollmentSecret.service", () => ({
      getSelfServiceMode: vi.fn(async () => "approval"),
      getEnrollmentSecretStatus: vi.fn(async () => ({ configured: true, secret: "the-real-secret" })),
    }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => null) }));
    vi.doMock("../modules/settings/automationCredential.service", () => ({ getAutomationBearer: vi.fn(async () => "Bearer xyz") }));
    vi.doMock("../modules/devices/devices.service", () => ({
      getDevicesFull: vi.fn(async () => ({ items: [{ serialNumber: "SOME-OTHER-SN", displayName: "Other" }], total: 1, fetchedAt: "now" })),
    }));

    const { requestEnrollment } = await import("../modules/mtls/mtlsEnrollment.service");
    await expect(requestEnrollment("acme", { csrPem: CSR, serialNumber: "SN-1" }, "the-real-secret")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("silent mode issues a certificate immediately once the secret and live Applivery check both pass", async () => {
    vi.doMock("../modules/mtls/enrollmentSecret.service", () => ({
      getSelfServiceMode: vi.fn(async () => "silent"),
      getEnrollmentSecretStatus: vi.fn(async () => ({ configured: true, secret: "the-real-secret" })),
    }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => null) }));
    vi.doMock("../modules/settings/automationCredential.service", () => ({ getAutomationBearer: vi.fn(async () => "Bearer xyz") }));
    vi.doMock("../modules/devices/devices.service", () => ({
      getDevicesFull: vi.fn(async () => ({ items: [{ serialNumber: "SN-1", displayName: "Laptop 1" }], total: 1, fetchedAt: "now" })),
    }));
    const issueLeaf = vi.fn(async () => ({ certPem: "cert-pem", caCertPem: "ca-cert-pem", notAfter: "later" }));
    vi.doMock("../modules/mtls/deviceMtls.service", () => ({ issueLeaf }));

    const { requestEnrollment } = await import("../modules/mtls/mtlsEnrollment.service");
    const result = await requestEnrollment("acme", { csrPem: CSR, serialNumber: "SN-1" }, "the-real-secret");
    expect(result).toEqual({ status: "issued", certPem: "cert-pem", caCertPem: "ca-cert-pem", notAfter: "later" });
    expect(issueLeaf).toHaveBeenCalledWith("acme", "SN-1", CSR);
  });

  it("approval mode creates a pending request and never calls issueLeaf", async () => {
    vi.doMock("../modules/mtls/enrollmentSecret.service", () => ({
      getSelfServiceMode: vi.fn(async () => "approval"),
      getEnrollmentSecretStatus: vi.fn(async () => ({ configured: true, secret: "the-real-secret" })),
    }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => null) }));
    vi.doMock("../modules/settings/automationCredential.service", () => ({ getAutomationBearer: vi.fn(async () => "Bearer xyz") }));
    vi.doMock("../modules/devices/devices.service", () => ({
      getDevicesFull: vi.fn(async () => ({ items: [{ serialNumber: "SN-1", displayName: "Laptop 1" }], total: 1, fetchedAt: "now" })),
    }));
    const issueLeaf = vi.fn();
    vi.doMock("../modules/mtls/deviceMtls.service", () => ({ issueLeaf }));
    const upsert = vi.fn(async () => ({ id: "req-1" }));
    vi.doMock("../services/prisma", () => ({ prisma: { deviceEnrollmentRequest: { upsert }, auditLogEntry: AUDIT_MOCK } }));

    const { requestEnrollment } = await import("../modules/mtls/mtlsEnrollment.service");
    const result = await requestEnrollment("acme", { csrPem: CSR, serialNumber: "SN-1" }, "the-real-secret");
    expect(result).toEqual({ status: "pending", requestId: "req-1" });
    expect(issueLeaf).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceSlug_serialNumber_status: { workspaceSlug: "acme", serialNumber: "SN-1", status: "pending" } } }),
    );
  });

  it("pollEnrollmentStatus rejects a wrong secret before revealing anything about the request", async () => {
    vi.doMock("../modules/mtls/enrollmentSecret.service", () => ({ getEnrollmentSecretStatus: vi.fn(async () => ({ configured: true, secret: "the-real-secret" })) }));
    const findFirst = vi.fn();
    vi.doMock("../services/prisma", () => ({ prisma: { deviceEnrollmentRequest: { findFirst } } }));
    const { pollEnrollmentStatus } = await import("../modules/mtls/mtlsEnrollment.service");
    await expect(pollEnrollmentStatus("acme", "SN-1", "wrong")).rejects.toMatchObject({ statusCode: 401 });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("pollEnrollmentStatus returns 'issued' with cert material once an active certificate exists", async () => {
    vi.doMock("../modules/mtls/enrollmentSecret.service", () => ({ getEnrollmentSecretStatus: vi.fn(async () => ({ configured: true, secret: "the-real-secret" })) }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ getActiveCertificateMaterial: vi.fn(async () => ({ certPem: "cert-pem", notAfter: "later" })) }));
    vi.doMock("../modules/mtls/ca.service", () => ({ getCaStatus: vi.fn(async () => ({ configured: true, certPem: "ca-cert-pem" })) }));

    const { pollEnrollmentStatus } = await import("../modules/mtls/mtlsEnrollment.service");
    await expect(pollEnrollmentStatus("acme", "SN-1", "the-real-secret")).resolves.toEqual({ status: "issued", certPem: "cert-pem", caCertPem: "ca-cert-pem", notAfter: "later" });
  });

  it("pollEnrollmentStatus returns 'pending' while a pending request exists and nothing has been issued yet", async () => {
    vi.doMock("../modules/mtls/enrollmentSecret.service", () => ({ getEnrollmentSecretStatus: vi.fn(async () => ({ configured: true, secret: "the-real-secret" })) }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ getActiveCertificateMaterial: vi.fn(async () => null) }));
    vi.doMock("../services/prisma", () => ({ prisma: { deviceEnrollmentRequest: { findUnique: vi.fn(async () => ({ id: "req-1", status: "pending" })), findFirst: vi.fn() } } }));
    const { pollEnrollmentStatus } = await import("../modules/mtls/mtlsEnrollment.service");
    await expect(pollEnrollmentStatus("acme", "SN-1", "the-real-secret")).resolves.toEqual({ status: "pending" });
  });

  it("pollEnrollmentStatus returns 'rejected' with the admin's reason once the request has been declined", async () => {
    vi.doMock("../modules/mtls/enrollmentSecret.service", () => ({ getEnrollmentSecretStatus: vi.fn(async () => ({ configured: true, secret: "the-real-secret" })) }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ getActiveCertificateMaterial: vi.fn(async () => null) }));
    vi.doMock("../services/prisma", () => ({
      prisma: {
        deviceEnrollmentRequest: {
          findUnique: vi.fn(async () => null),
          findFirst: vi.fn(async () => ({ id: "req-1", status: "rejected", rejectionReason: "not our device" })),
        },
      },
    }));
    const { pollEnrollmentStatus } = await import("../modules/mtls/mtlsEnrollment.service");
    await expect(pollEnrollmentStatus("acme", "SN-1", "the-real-secret")).resolves.toEqual({ status: "rejected", reason: "not our device" });
  });

  it("approveEnrollmentRequest 404s for a request belonging to a different workspace", async () => {
    vi.doMock("../services/prisma", () => ({
      prisma: { deviceEnrollmentRequest: { findUnique: vi.fn(async () => ({ id: "req-1", workspaceSlug: "other-workspace", status: "pending" })) } },
    }));
    const { approveEnrollmentRequest } = await import("../modules/mtls/mtlsEnrollment.service");
    await expect(approveEnrollmentRequest("acme", "req-1", "tester")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("approveEnrollmentRequest rejects a request that's already been decided", async () => {
    vi.doMock("../services/prisma", () => ({ prisma: { deviceEnrollmentRequest: { findUnique: vi.fn(async () => ({ id: "req-1", workspaceSlug: "acme", status: "approved" })) } } }));
    const { approveEnrollmentRequest } = await import("../modules/mtls/mtlsEnrollment.service");
    await expect(approveEnrollmentRequest("acme", "req-1", "tester")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("approveEnrollmentRequest re-checks for an already-active certificate at decision time and refuses to double-issue", async () => {
    vi.doMock("../services/prisma", () => ({
      prisma: { deviceEnrollmentRequest: { findUnique: vi.fn(async () => ({ id: "req-1", workspaceSlug: "acme", serialNumber: "SN-1", status: "pending", csrPem: CSR })) } },
    }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => ({ id: "cert-now-exists" })) }));
    const issueLeaf = vi.fn();
    vi.doMock("../modules/mtls/deviceMtls.service", () => ({ issueLeaf }));

    const { approveEnrollmentRequest } = await import("../modules/mtls/mtlsEnrollment.service");
    await expect(approveEnrollmentRequest("acme", "req-1", "tester")).rejects.toMatchObject({ statusCode: 409 });
    expect(issueLeaf).not.toHaveBeenCalled();
  });

  it("approveEnrollmentRequest signs the stored CSR, issues the cert, and marks the request approved", async () => {
    const update = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({
      prisma: {
        deviceEnrollmentRequest: { findUnique: vi.fn(async () => ({ id: "req-1", workspaceSlug: "acme", serialNumber: "SN-1", status: "pending", csrPem: CSR })), update },
        auditLogEntry: AUDIT_MOCK,
      },
    }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => null) }));
    const issueLeaf = vi.fn(async () => ({ certPem: "cert-pem", caCertPem: "ca-cert-pem", notAfter: "later" }));
    vi.doMock("../modules/mtls/deviceMtls.service", () => ({ issueLeaf }));

    const { approveEnrollmentRequest } = await import("../modules/mtls/mtlsEnrollment.service");
    const result = await approveEnrollmentRequest("acme", "req-1", "tester");
    expect(result).toEqual({ certPem: "cert-pem", caCertPem: "ca-cert-pem", notAfter: "later" });
    expect(issueLeaf).toHaveBeenCalledWith("acme", "SN-1", CSR);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "req-1" }, data: expect.objectContaining({ status: "approved", decidedBy: "tester" }) }));
  });

  it("rejectEnrollmentRequest marks the request rejected with the given reason and never touches signing", async () => {
    const update = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({
      prisma: { deviceEnrollmentRequest: { findUnique: vi.fn(async () => ({ id: "req-1", workspaceSlug: "acme", serialNumber: "SN-1", status: "pending" })), update }, auditLogEntry: AUDIT_MOCK },
    }));
    const issueLeaf = vi.fn();
    vi.doMock("../modules/mtls/deviceMtls.service", () => ({ issueLeaf }));

    const { rejectEnrollmentRequest } = await import("../modules/mtls/mtlsEnrollment.service");
    await rejectEnrollmentRequest("acme", "req-1", "tester", "not our device");
    expect(issueLeaf).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "req-1" }, data: expect.objectContaining({ status: "rejected", rejectionReason: "not our device" }) }));
  });
});
