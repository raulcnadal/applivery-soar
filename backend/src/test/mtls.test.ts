import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * mTLS agent-authentication functional tests — see
 * backend/docs/mtls-agent-auth-roadmap.md, including the Global Bootstrap
 * Token addendum that replaced the original per-device Bootstrap Tokens and
 * the Phase E self-service-mode addendum with one always-on mechanism.
 * Boundary/route-gating coverage (dashboard-token requirement, RBAC
 * area/level/action) already lives in authRequired.test.ts and
 * rbacBoundary.test.ts; this file instead exercises the actual security
 * properties the design depends on:
 *   - the CSR's own claimed CN is never trusted — the issued cert's CN is
 *     always forced to the identity the caller already proved (the
 *     request's own claimed serialNumber for register, or the
 *     mTLS-authenticated renewal caller for renew)
 *   - registerDevice's full token/anti-hijack/Applivery-known-device chain
 *   - the leaf-validity floor is enforced
 *   - verifyMtlsIdentity's full header/secret/revocation check chain
 */

describe("mtlsPki — crypto primitives (real @peculiar/x509, no mocks)", () => {
  it("generates a self-signed CA and validates its own cert/key pair", async () => {
    const { generateCertificateAuthority, validateUploadedCaPair } = await import("../utils/mtlsPki");
    const ca = await generateCertificateAuthority("test-ws");
    expect(ca.certPem).toContain("BEGIN CERTIFICATE");
    expect(ca.privateKeyPem).toContain("BEGIN PRIVATE KEY");

    const validation = await validateUploadedCaPair(ca.certPem, ca.privateKeyPem);
    expect(validation.ok).toBe(true);
  });

  it("rejects a CA cert paired with a DIFFERENT CA's private key", async () => {
    const { generateCertificateAuthority, validateUploadedCaPair } = await import("../utils/mtlsPki");
    const caA = await generateCertificateAuthority("ws-a");
    const caB = await generateCertificateAuthority("ws-b");
    const validation = await validateUploadedCaPair(caA.certPem, caB.privateKeyPem);
    expect(validation.ok).toBe(false);
    expect(validation.error).toMatch(/do not match/i);
  });

  it("rejects an uploaded cert that isn't a CA (BasicConstraints CA=false)", async () => {
    const x509 = await import("@peculiar/x509");
    const { validateUploadedCaPair } = await import("../utils/mtlsPki");

    // Build a non-CA self-signed cert directly (bypassing generateCertificateAuthority,
    // which always sets CA=true) to exercise the CA=false rejection path.
    const keys = await x509.cryptoProvider.get().subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const notBefore = new Date();
    const notAfter = new Date(notBefore.getTime() + 365 * 24 * 60 * 60 * 1000);
    const nonCaCert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: "01",
      name: "CN=not-a-ca",
      notBefore,
      notAfter,
      signingAlgorithm: { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as any,
      keys,
      extensions: [new x509.BasicConstraintsExtension(false, undefined, true)],
    });
    const privateKeyPkcs8 = await x509.cryptoProvider.get().subtle.exportKey("pkcs8", keys.privateKey);
    const privateKeyPem = x509.PemConverter.encode(privateKeyPkcs8, x509.PemConverter.PrivateKeyTag);

    const result = await validateUploadedCaPair(nonCaCert.toString("pem"), privateKeyPem);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/BasicConstraints CA=true/i);
  });

  it("CRITICAL: signDeviceCsr always forces the issued cert's CN to `forcedCn`, ignoring whatever CN the CSR itself claims", async () => {
    const x509 = await import("@peculiar/x509");
    const { generateCertificateAuthority, signDeviceCsr, createTestCsr, MTLS_LEAF_VALIDITY_DAYS_DEFAULT } = await import("../utils/mtlsPki");

    const ca = await generateCertificateAuthority("test-ws");
    const { csrPem } = await createTestCsr("attacker-claimed-identity");

    const leaf = await signDeviceCsr({
      csrPem,
      forcedCn: "REAL-DEVICE-SERIAL",
      caCertPem: ca.certPem,
      caPrivateKeyPem: ca.privateKeyPem,
      serialCounter: 42,
      validityDays: MTLS_LEAF_VALIDITY_DAYS_DEFAULT,
    });

    const parsed = new x509.X509Certificate(leaf.certPem);
    expect(parsed.subject).toBe("CN=REAL-DEVICE-SERIAL");
    expect(parsed.subject).not.toContain("attacker-claimed-identity");
  });

  it("rejects a CSR with an invalid self-signature", async () => {
    const { generateCertificateAuthority, signDeviceCsr, MTLS_LEAF_VALIDITY_DAYS_DEFAULT } = await import("../utils/mtlsPki");
    const ca = await generateCertificateAuthority("test-ws");
    const garbageCsr = "-----BEGIN CERTIFICATE REQUEST-----\nbm90YXJlYWxjc3I=\n-----END CERTIFICATE REQUEST-----";
    await expect(
      signDeviceCsr({ csrPem: garbageCsr, forcedCn: "X", caCertPem: ca.certPem, caPrivateKeyPem: ca.privateKeyPem, serialCounter: 1, validityDays: MTLS_LEAF_VALIDITY_DAYS_DEFAULT }),
    ).rejects.toThrow();
  });
});

/**
 * NOTE on mocking `prisma` directly below: the shared setup.ts prisma mock
 * is a Proxy whose `get` trap returns a BRAND NEW `vi.fn()` on every single
 * property access (by design — see its own comment: it exists to make any
 * Prisma call resolve to *something* generic, not to support per-test
 * `.mockResolvedValueOnce` overrides). That means `prisma.certificateAuthority.findUnique`
 * in a test file and the same expression evaluated inside application code
 * are two entirely different mock-function instances — configuring one has
 * zero effect on the other. Blocks below instead `vi.doMock("../services/prisma", ...)`
 * with a small, STABLE local mock object (plain object literals, not a
 * Proxy) so the exact same `vi.fn()` reference is shared between the test's
 * setup and the service code under test — the only way to actually assert
 * on call counts/sequenced return values here.
 */

describe("ca.service — leaf validity floor", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects setLeafValidityDays below the 47-day floor before touching the database", async () => {
    const findUnique = vi.fn();
    vi.doMock("../services/prisma", () => ({ prisma: { certificateAuthority: { findUnique, update: vi.fn() } } }));
    const { setLeafValidityDays } = await import("../modules/mtls/ca.service");
    await expect(setLeafValidityDays("acme", "tester", 30)).rejects.toThrow(/47/);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("accepts exactly the floor value (47) once a CA exists", async () => {
    const findUnique = vi.fn(async () => ({ workspaceSlug: "acme", certPem: "x", source: "generated", keyAlgorithm: "ECDSA-P256", leafValidityDays: 47, notBefore: new Date(), notAfter: new Date(), uploadedBy: null, updatedAt: new Date() }));
    const update = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({
      prisma: {
        certificateAuthority: { findUnique, update },
        auditLogEntry: { create: vi.fn(async () => ({ id: "log-1" })) },
      },
    }));
    const { setLeafValidityDays } = await import("../modules/mtls/ca.service");
    await expect(setLeafValidityDays("acme", "tester", 47)).resolves.toBeDefined();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { leafValidityDays: 47 } }));
  });
});

describe("assertMtlsIdentity — header/secret/revocation chain", () => {
  // Phase C refactor: assertMtlsIdentity is the reusable throwing-async core
  // (HttpError, matching this codebase's usual auth-check shape) — tested
  // directly here rather than via the Express-middleware wrapper
  // (verifyMtlsIdentity), which is now just asyncHandler(assertMtlsIdentity)
  // and used unconditionally on POST /api/device-mtls/renew. The Phase C
  // enforcement-flag branch (deviceData.service.ts's verifyDeviceIdentity)
  // also calls assertMtlsIdentity directly, so this is the shared surface
  // both paths depend on.
  function fakeReq(headers: Record<string, string | undefined>): Request {
    return { header: (name: string) => headers[name] } as unknown as Request;
  }

  beforeEach(() => {
    vi.resetModules();
  });

  it("fails closed (503) when MTLS_INTERNAL_PROXY_SECRET is not configured", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "";
    const { assertMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    await expect(assertMtlsIdentity(fakeReq({}))).rejects.toMatchObject({ statusCode: 503 });
  });

  it("rejects a request missing/wrong on the internal proxy secret, even with a well-formed identity header (closes the 'reach the backend directly and spoof the header' gap)", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    const { assertMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const req = fakeReq({
      "X-Internal-Proxy-Secret": "wrong-secret",
      "X-Client-Cert-Verified": "SUCCESS",
      "X-Client-Cert-CN": "DEVICE-1",
    });
    await expect(assertMtlsIdentity(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects when the proxy secret is correct but no verified cert identity is present", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    const { assertMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const req = fakeReq({ "X-Internal-Proxy-Secret": "the-real-secret" });
    await expect(assertMtlsIdentity(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects when everything is present but there's no active DeviceCertificate row for that CN (revoked/superseded/expired/never-issued)", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => null) }));
    const { assertMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const req = fakeReq({
      "X-Internal-Proxy-Secret": "the-real-secret",
      "X-Client-Cert-Verified": "SUCCESS",
      "X-Client-Cert-CN": "DEVICE-1",
      "X-Workspace-Slug": "acme",
    });
    await expect(assertMtlsIdentity(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("returns the verified serial number when everything checks out", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => ({ id: "cert-1" })), touchCertificateLastSeen: vi.fn() }));
    const { assertMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const req = fakeReq({
      "X-Internal-Proxy-Secret": "the-real-secret",
      "X-Client-Cert-Verified": "SUCCESS",
      "X-Client-Cert-CN": "DEVICE-1",
      "X-Workspace-Slug": "acme",
    });
    await expect(assertMtlsIdentity(req)).resolves.toBe("DEVICE-1");
  });

  it("parses the bare CN out of a full RFC 2253 subject DN string ($ssl_client_s_dn's real format — $ssl_client_s_dn_cn is not a real nginx variable, see mtlsIdentity.middleware.ts's extractCommonName doc comment)", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    vi.doMock("../modules/mtls/certificates.service", () => ({
      findActiveCertificate: vi.fn(async (_workspaceSlug: string, cn: string) => (cn === "DEVICE-1" ? { id: "cert-1" } : null)),
      touchCertificateLastSeen: vi.fn(),
    }));
    const { assertMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const req = fakeReq({
      "X-Internal-Proxy-Secret": "the-real-secret",
      "X-Client-Cert-Verified": "SUCCESS",
      "X-Client-Cert-CN": "CN=DEVICE-1",
      "X-Workspace-Slug": "acme",
    });
    await expect(assertMtlsIdentity(req)).resolves.toBe("DEVICE-1");
  });

  it("parses the bare CN out of a multi-RDN subject DN string (CN not the only attribute)", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    vi.doMock("../modules/mtls/certificates.service", () => ({
      findActiveCertificate: vi.fn(async (_workspaceSlug: string, cn: string) => (cn === "DEVICE-1" ? { id: "cert-1" } : null)),
      touchCertificateLastSeen: vi.fn(),
    }));
    const { assertMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const req = fakeReq({
      "X-Internal-Proxy-Secret": "the-real-secret",
      "X-Client-Cert-Verified": "SUCCESS",
      "X-Client-Cert-CN": "CN=DEVICE-1,O=Applivery SOAR",
      "X-Workspace-Slug": "acme",
    });
    await expect(assertMtlsIdentity(req)).resolves.toBe("DEVICE-1");
  });

  it("respects env-configured (non-default) header names, proving the design isn't NPM/nginx-specific", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    process.env.MTLS_HEADER_CERT_VERIFIED = "X-Custom-Verified";
    process.env.MTLS_HEADER_CERT_CN = "X-Custom-CN";
    process.env.MTLS_HEADER_PROXY_SECRET = "X-Custom-Proxy-Secret";
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => ({ id: "cert-1" })), touchCertificateLastSeen: vi.fn() }));
    const { assertMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const req = fakeReq({
      "X-Custom-Proxy-Secret": "the-real-secret",
      "X-Custom-Verified": "SUCCESS",
      "X-Custom-CN": "DEVICE-1",
    });
    await expect(assertMtlsIdentity(req)).resolves.toBe("DEVICE-1");

    delete process.env.MTLS_HEADER_CERT_VERIFIED;
    delete process.env.MTLS_HEADER_CERT_CN;
    delete process.env.MTLS_HEADER_PROXY_SECRET;
  });
});

describe("deviceMtls.service — register/renew identity-forcing behavior (persistence mocked, real mtlsPki crypto)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../modules/mtls/certificates.service");
  });

  it("registerDevice issues a cert whose CN matches the request's serialNumber, never the CSR's own claimed CN, once the token and Applivery both check out", async () => {
    const { generateCertificateAuthority, createTestCsr } = await import("../utils/mtlsPki");
    const x509 = await import("@peculiar/x509");
    const ca = await generateCertificateAuthority("acme");

    vi.doMock("../modules/mtls/globalBootstrapToken.service", () => ({ getGlobalBootstrapTokenStatus: vi.fn(async () => ({ configured: true, secret: "the-real-token" })) }));
    const findActiveCertificate = vi.fn(async () => null);
    const issueCertificateRecord = vi.fn(async () => undefined);
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate, issueCertificateRecord, supersedeActiveCertificates: vi.fn(async () => undefined) }));
    vi.doMock("../modules/settings/automationCredential.service", () => ({ getAutomationBearer: vi.fn(async () => "Bearer xyz") }));
    vi.doMock("../modules/devices/devices.service", () => ({
      getDevicesFull: vi.fn(async () => ({ items: [{ serialNumber: "REAL-SERIAL-99", displayName: "Laptop 99" }], total: 1, fetchedAt: "now" })),
    }));
    vi.doMock("../modules/mtls/ca.service", () => ({
      getCaForSigning: vi.fn(async () => ({ certPem: ca.certPem, privateKeyPem: ca.privateKeyPem, leafValidityDays: 90 })),
      claimNextSerial: vi.fn(async () => 7),
    }));

    const { registerDevice } = await import("../modules/mtls/deviceMtls.service");
    const { csrPem } = await createTestCsr("whatever-the-agent-put-in-the-csr");

    const result = await registerDevice("acme", { csrPem, serialNumber: "REAL-SERIAL-99" }, "the-real-token");

    const parsed = new x509.X509Certificate(result.certPem);
    expect(parsed.subject).toBe("CN=REAL-SERIAL-99");
    expect(issueCertificateRecord).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: "REAL-SERIAL-99" }));
  });

  it("registerDevice fails closed (503) when no global bootstrap token is configured for the workspace", async () => {
    vi.doMock("../modules/mtls/globalBootstrapToken.service", () => ({ getGlobalBootstrapTokenStatus: vi.fn(async () => ({ configured: false, secret: null })) }));
    const { registerDevice } = await import("../modules/mtls/deviceMtls.service");
    await expect(registerDevice("acme", { csrPem: "x", serialNumber: "SN-1" }, "any-token")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("registerDevice rejects a wrong or missing token", async () => {
    vi.doMock("../modules/mtls/globalBootstrapToken.service", () => ({ getGlobalBootstrapTokenStatus: vi.fn(async () => ({ configured: true, secret: "the-real-token" })) }));
    const { registerDevice } = await import("../modules/mtls/deviceMtls.service");
    await expect(registerDevice("acme", { csrPem: "x", serialNumber: "SN-1" }, "wrong-token")).rejects.toMatchObject({ statusCode: 401 });
    await expect(registerDevice("acme", { csrPem: "x", serialNumber: "SN-1" }, undefined)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("CRITICAL: rejects a device that already has an active certificate, before ever calling out to Applivery — the anti-hijack backstop", async () => {
    vi.doMock("../modules/mtls/globalBootstrapToken.service", () => ({ getGlobalBootstrapTokenStatus: vi.fn(async () => ({ configured: true, secret: "the-real-token" })) }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => ({ id: "cert-1" })) }));
    const getDevicesFull = vi.fn();
    vi.doMock("../modules/devices/devices.service", () => ({ getDevicesFull }));

    const { registerDevice } = await import("../modules/mtls/deviceMtls.service");
    await expect(registerDevice("acme", { csrPem: "x", serialNumber: "SN-1" }, "the-real-token")).rejects.toMatchObject({ statusCode: 409 });
    expect(getDevicesFull).not.toHaveBeenCalled();
  });

  it("rejects a serial number Applivery doesn't currently recognize as an enrolled device", async () => {
    vi.doMock("../modules/mtls/globalBootstrapToken.service", () => ({ getGlobalBootstrapTokenStatus: vi.fn(async () => ({ configured: true, secret: "the-real-token" })) }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => null) }));
    vi.doMock("../modules/settings/automationCredential.service", () => ({ getAutomationBearer: vi.fn(async () => "Bearer xyz") }));
    vi.doMock("../modules/devices/devices.service", () => ({
      getDevicesFull: vi.fn(async () => ({ items: [{ serialNumber: "SOME-OTHER-SN", displayName: "Other" }], total: 1, fetchedAt: "now" })),
    }));

    const { registerDevice } = await import("../modules/mtls/deviceMtls.service");
    await expect(registerDevice("acme", { csrPem: "x", serialNumber: "SN-1" }, "the-real-token")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("registerDevice fails closed (503) when no Automation Credential is configured, without ever signing anything", async () => {
    vi.doMock("../modules/mtls/globalBootstrapToken.service", () => ({ getGlobalBootstrapTokenStatus: vi.fn(async () => ({ configured: true, secret: "the-real-token" })) }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => null) }));
    vi.doMock("../modules/settings/automationCredential.service", () => ({ getAutomationBearer: vi.fn(async () => null) }));
    const getDevicesFull = vi.fn();
    vi.doMock("../modules/devices/devices.service", () => ({ getDevicesFull }));

    const { registerDevice } = await import("../modules/mtls/deviceMtls.service");
    await expect(registerDevice("acme", { csrPem: "x", serialNumber: "SN-1" }, "the-real-token")).rejects.toMatchObject({ statusCode: 503 });
    expect(getDevicesFull).not.toHaveBeenCalled();
  });

  it("renewDevice rejects when the request body's serialNumber doesn't match the mTLS-verified identity", async () => {
    vi.doMock("../modules/mtls/ca.service", () => ({ getCaForSigning: vi.fn(), claimNextSerial: vi.fn() }));
    vi.doMock("../modules/mtls/certificates.service", () => ({ issueCertificateRecord: vi.fn(), supersedeActiveCertificates: vi.fn() }));

    const { renewDevice } = await import("../modules/mtls/deviceMtls.service");
    const { createTestCsr } = await import("../utils/mtlsPki");
    const { csrPem } = await createTestCsr("X");

    await expect(renewDevice("acme", { csrPem, serialNumber: "DEVICE-B" }, "DEVICE-A")).rejects.toThrow(/does not match/i);
  });

  it("renewDevice supersedes the old cert(s) BEFORE issuing the new one, so the new row is never itself marked superseded", async () => {
    const { generateCertificateAuthority, createTestCsr } = await import("../utils/mtlsPki");
    const ca = await generateCertificateAuthority("acme");

    const callOrder: string[] = [];
    vi.doMock("../modules/mtls/ca.service", () => ({
      getCaForSigning: vi.fn(async () => {
        callOrder.push("issue");
        return { certPem: ca.certPem, privateKeyPem: ca.privateKeyPem, leafValidityDays: 90 };
      }),
      claimNextSerial: vi.fn(async () => 3),
    }));
    vi.doMock("../modules/mtls/certificates.service", () => ({
      issueCertificateRecord: vi.fn(async () => undefined),
      supersedeActiveCertificates: vi.fn(async () => {
        callOrder.push("supersede");
      }),
    }));

    const { renewDevice } = await import("../modules/mtls/deviceMtls.service");
    const { csrPem } = await createTestCsr("DEVICE-A");
    await renewDevice("acme", { csrPem, serialNumber: "DEVICE-A" }, "DEVICE-A");

    expect(callOrder).toEqual(["supersede", "issue"]);
  });
});

describe("mtlsEnforcement.service — the Phase C cutover flag", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getMtlsEnforcementEnabled defaults to false when the workspace has no WorkspaceState row yet", async () => {
    const findUnique = vi.fn(async () => null);
    vi.doMock("../services/prisma", () => ({ prisma: { workspaceState: { findUnique } } }));
    const { getMtlsEnforcementEnabled } = await import("../modules/mtls/mtlsEnforcement.service");
    await expect(getMtlsEnforcementEnabled("acme")).resolves.toBe(false);
  });

  it("getMtlsEnforcementEnabled reflects the stored flag once a row exists", async () => {
    const findUnique = vi.fn(async () => ({ mtlsEnforcementEnabled: true }));
    vi.doMock("../services/prisma", () => ({ prisma: { workspaceState: { findUnique } } }));
    const { getMtlsEnforcementEnabled } = await import("../modules/mtls/mtlsEnforcement.service");
    await expect(getMtlsEnforcementEnabled("acme")).resolves.toBe(true);
  });

  it("refuses to enable enforcement when no CA is configured for the workspace yet — the fleet-lockout guard", async () => {
    const findUniqueCa = vi.fn(async () => null);
    const upsert = vi.fn();
    vi.doMock("../services/prisma", () => ({
      prisma: { certificateAuthority: { findUnique: findUniqueCa }, workspaceState: { upsert } },
    }));
    const { setMtlsEnforcementEnabled } = await import("../modules/mtls/mtlsEnforcement.service");
    await expect(setMtlsEnforcementEnabled("acme", "tester", true)).rejects.toMatchObject({ statusCode: 400 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("enables enforcement once a CA exists, upserting WorkspaceState and recording an audit event", async () => {
    const findUniqueCa = vi.fn(async () => ({ workspaceSlug: "acme" }));
    const upsert = vi.fn(async () => undefined);
    const create = vi.fn(async () => ({ id: "log-1" }));
    vi.doMock("../services/prisma", () => ({
      prisma: { certificateAuthority: { findUnique: findUniqueCa }, workspaceState: { upsert }, auditLogEntry: { create } },
    }));
    const { setMtlsEnforcementEnabled } = await import("../modules/mtls/mtlsEnforcement.service");
    await expect(setMtlsEnforcementEnabled("acme", "tester", true)).resolves.toEqual({ enabled: true });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceSlug: "acme" },
      create: { workspaceSlug: "acme", mtlsEnforcementEnabled: true },
      update: { mtlsEnforcementEnabled: true },
    }));
  });

  it("disabling enforcement never checks for a CA — always allowed, to give an admin an escape hatch", async () => {
    const findUniqueCa = vi.fn();
    const upsert = vi.fn(async () => undefined);
    vi.doMock("../services/prisma", () => ({
      prisma: { certificateAuthority: { findUnique: findUniqueCa }, workspaceState: { upsert }, auditLogEntry: { create: vi.fn(async () => ({ id: "log-1" })) } },
    }));
    const { setMtlsEnforcementEnabled } = await import("../modules/mtls/mtlsEnforcement.service");
    await expect(setMtlsEnforcementEnabled("acme", "tester", false)).resolves.toEqual({ enabled: false });
    expect(findUniqueCa).not.toHaveBeenCalled();
  });
});

describe("deviceData.service.verifyDeviceIdentity — Phase C enforcement-flag branching", () => {
  // The combinator every one of the 6 device-caller routes now goes through
  // (deviceData.controller.ts) instead of calling verifyDeviceReportSecret
  // directly. These tests are the actual proof of the "hard cutover, never
  // both accepted on the same request" property the rollout design depends
  // on — see deviceData.service.ts's own doc comment on verifyDeviceIdentity.
  beforeEach(() => {
    vi.resetModules();
  });

  it("flag OFF: authenticates via the legacy X-Device-Report-Secret and never calls assertMtlsIdentity", async () => {
    vi.doMock("../modules/mtls/mtlsEnforcement.service", () => ({ getMtlsEnforcementEnabled: vi.fn(async () => false) }));
    const assertMtlsIdentity = vi.fn();
    vi.doMock("../middleware/mtlsIdentity.middleware", () => ({ assertMtlsIdentity }));
    const findUnique = vi.fn(async () => ({ secret: "encrypted-blob" }));
    vi.doMock("../services/prisma", () => ({ prisma: { deviceReportSecret: { findUnique } } }));
    vi.doMock("../utils/secretCipher", () => ({ decryptSecret: vi.fn(() => "the-real-secret") }));

    const { verifyDeviceIdentity } = await import("../modules/devices/deviceData.service");
    const req = { header: (name: string) => (name === "X-Device-Report-Secret" ? "the-real-secret" : undefined) } as any;

    await expect(verifyDeviceIdentity(req, "acme")).resolves.toBeUndefined();
    expect(assertMtlsIdentity).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalledWith({ where: { workspaceSlug: "acme" } });
  });

  it("flag OFF: still rejects a wrong legacy secret exactly as before Phase C", async () => {
    vi.doMock("../modules/mtls/mtlsEnforcement.service", () => ({ getMtlsEnforcementEnabled: vi.fn(async () => false) }));
    vi.doMock("../middleware/mtlsIdentity.middleware", () => ({ assertMtlsIdentity: vi.fn() }));
    vi.doMock("../services/prisma", () => ({ prisma: { deviceReportSecret: { findUnique: vi.fn(async () => ({ secret: "encrypted-blob" })) } } }));
    vi.doMock("../utils/secretCipher", () => ({ decryptSecret: vi.fn(() => "the-real-secret") }));

    const { verifyDeviceIdentity } = await import("../modules/devices/deviceData.service");
    const req = { header: () => "wrong-secret" } as any;
    await expect(verifyDeviceIdentity(req, "acme")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("flag ON: delegates entirely to assertMtlsIdentity and never touches the legacy-secret table, even with no X-Device-Report-Secret header at all", async () => {
    vi.doMock("../modules/mtls/mtlsEnforcement.service", () => ({ getMtlsEnforcementEnabled: vi.fn(async () => true) }));
    const assertMtlsIdentity = vi.fn(async () => "DEVICE-1");
    vi.doMock("../middleware/mtlsIdentity.middleware", () => ({ assertMtlsIdentity }));
    const findUnique = vi.fn();
    vi.doMock("../services/prisma", () => ({ prisma: { deviceReportSecret: { findUnique } } }));

    const { verifyDeviceIdentity } = await import("../modules/devices/deviceData.service");
    const req = { header: () => undefined } as any;
    await expect(verifyDeviceIdentity(req, "acme")).resolves.toBeUndefined();
    expect(assertMtlsIdentity).toHaveBeenCalledWith(req);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("flag ON: propagates assertMtlsIdentity's rejection instead of falling back to a validly-presented legacy secret — no dual-accept", async () => {
    vi.doMock("../modules/mtls/mtlsEnforcement.service", () => ({ getMtlsEnforcementEnabled: vi.fn(async () => true) }));
    const { HttpError } = await import("../utils/httpError");
    vi.doMock("../middleware/mtlsIdentity.middleware", () => ({
      assertMtlsIdentity: vi.fn(async () => {
        throw new HttpError(401, "no active certificate");
      }),
    }));
    const findUnique = vi.fn();
    vi.doMock("../services/prisma", () => ({ prisma: { deviceReportSecret: { findUnique } } }));

    const { verifyDeviceIdentity } = await import("../modules/devices/deviceData.service");
    const req = { header: () => "some-legacy-secret-that-would-have-worked-before-cutover" } as any;
    await expect(verifyDeviceIdentity(req, "acme")).rejects.toMatchObject({ statusCode: 401 });
    expect(findUnique).not.toHaveBeenCalled();
  });
});

