import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * mTLS agent-authentication (Phase A) functional tests — see
 * backend/docs/mtls-agent-auth-roadmap.md. Boundary/route-gating coverage
 * (dashboard-token requirement, RBAC area/level/action) already lives in
 * authRequired.test.ts and rbacBoundary.test.ts; this file instead exercises
 * the actual security properties the design depends on:
 *   - the CSR's own claimed CN is never trusted — the issued cert's CN is
 *     always forced to the identity the caller already proved (bootstrap
 *     token's bound serial, or the mTLS-authenticated renewal caller)
 *   - bootstrap tokens are truly one-shot and device-bound
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
 * NOTE on mocking `prisma` directly in these two describe blocks: the
 * shared setup.ts prisma mock is a Proxy whose `get` trap returns a BRAND
 * NEW `vi.fn()` on every single property access (by design — see its own
 * comment: it exists to make any Prisma call resolve to *something*
 * generic, not to support per-test `.mockResolvedValueOnce` overrides).
 * That means `prisma.deviceBootstrapToken.updateMany` in a test file and
 * the same expression evaluated inside application code are two entirely
 * different mock-function instances — configuring one has zero effect on
 * the other. Both blocks below instead `vi.doMock("../services/prisma", ...)`
 * with a small, STABLE local mock object (plain object literals, not a
 * Proxy) so the exact same `vi.fn()` reference is shared between the test's
 * setup and the service code under test — the only way to actually assert
 * on call counts/sequenced return values here.
 */

describe("bootstrapTokens.service — one-shot, device-bound consumption", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("consumeBootstrapToken succeeds once, then rejects a replay of the same token", async () => {
    const updateMany = vi.fn();
    vi.doMock("../services/prisma", () => ({ prisma: { deviceBootstrapToken: { updateMany } } }));
    const { consumeBootstrapToken } = await import("../modules/mtls/bootstrapTokens.service");

    // First call: the atomic updateMany claims exactly one row.
    updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(consumeBootstrapToken("acme", "DEVICE-1", "plaintext-token")).resolves.toBeUndefined();

    // Replay: the same WHERE clause (usedAt: null) no longer matches anything.
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(consumeBootstrapToken("acme", "DEVICE-1", "plaintext-token")).rejects.toThrow(/invalid, expired, already-used/i);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("rejects a token bound to a DIFFERENT serialNumber than the request claims (matched entirely via the WHERE clause, before any CSR is even parsed)", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    vi.doMock("../services/prisma", () => ({ prisma: { deviceBootstrapToken: { updateMany } } }));
    const { consumeBootstrapToken } = await import("../modules/mtls/bootstrapTokens.service");

    // The token exists and is valid, but was minted for DEVICE-A — a request
    // claiming to be DEVICE-B can never match the WHERE clause's serialNumber
    // filter, so updateMany affects 0 rows regardless of the token's own validity.
    await expect(consumeBootstrapToken("acme", "DEVICE-B", "token-minted-for-device-a")).rejects.toThrow(/invalid, expired, already-used, or mismatched-device/i);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ serialNumber: "DEVICE-B" }) }));
  });

  it("rejects a missing token outright, without touching the database", async () => {
    const updateMany = vi.fn();
    vi.doMock("../services/prisma", () => ({ prisma: { deviceBootstrapToken: { updateMany } } }));
    const { consumeBootstrapToken } = await import("../modules/mtls/bootstrapTokens.service");
    await expect(consumeBootstrapToken("acme", "DEVICE-1", undefined)).rejects.toThrow(/missing bootstrap token/i);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

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

describe("verifyMtlsIdentity middleware — header/secret/revocation chain", () => {
  function fakeReqRes(headers: Record<string, string | undefined>) {
    const req: any = { header: (name: string) => headers[name] };
    let statusCode = 200;
    let jsonBody: unknown;
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (body: unknown) => {
        jsonBody = body;
        return res;
      },
    };
    return { req, res, getStatus: () => statusCode, getBody: () => jsonBody };
  }

  beforeEach(() => {
    vi.resetModules();
  });

  it("fails closed (503) when MTLS_INTERNAL_PROXY_SECRET is not configured", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "";
    const { verifyMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const ctx = fakeReqRes({});
    let calledNext = false;
    await verifyMtlsIdentity(ctx.req, ctx.res, () => {
      calledNext = true;
    });
    expect(calledNext).toBe(false);
    expect(ctx.getStatus()).toBe(503);
  });

  it("rejects a request missing/wrong on the internal proxy secret, even with a well-formed identity header (closes the 'reach the backend directly and spoof the header' gap)", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    const { verifyMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const ctx = fakeReqRes({
      "X-Internal-Proxy-Secret": "wrong-secret",
      "X-Client-Cert-Verified": "SUCCESS",
      "X-Client-Cert-CN": "DEVICE-1",
    });
    let calledNext = false;
    await verifyMtlsIdentity(ctx.req, ctx.res, () => {
      calledNext = true;
    });
    expect(calledNext).toBe(false);
    expect(ctx.getStatus()).toBe(401);
  });

  it("rejects when the proxy secret is correct but no verified cert identity is present", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    const { verifyMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const ctx = fakeReqRes({ "X-Internal-Proxy-Secret": "the-real-secret" });
    let calledNext = false;
    await verifyMtlsIdentity(ctx.req, ctx.res, () => {
      calledNext = true;
    });
    expect(calledNext).toBe(false);
    expect(ctx.getStatus()).toBe(401);
  });

  it("rejects when everything is present but there's no active DeviceCertificate row for that CN (revoked/superseded/expired/never-issued)", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => null) }));
    const { verifyMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const ctx = fakeReqRes({
      "X-Internal-Proxy-Secret": "the-real-secret",
      "X-Client-Cert-Verified": "SUCCESS",
      "X-Client-Cert-CN": "DEVICE-1",
      "X-Workspace-Slug": "acme",
    });
    let calledNext = false;
    await verifyMtlsIdentity(ctx.req, ctx.res, () => {
      calledNext = true;
    });
    expect(calledNext).toBe(false);
    expect(ctx.getStatus()).toBe(401);
  });

  it("clears the gate and attaches req.mtlsSerialNumber when everything checks out", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => ({ id: "cert-1" })) }));
    const { verifyMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const ctx = fakeReqRes({
      "X-Internal-Proxy-Secret": "the-real-secret",
      "X-Client-Cert-Verified": "SUCCESS",
      "X-Client-Cert-CN": "DEVICE-1",
      "X-Workspace-Slug": "acme",
    });
    let calledNext = false;
    await verifyMtlsIdentity(ctx.req, ctx.res, () => {
      calledNext = true;
    });
    expect(calledNext).toBe(true);
    expect(ctx.req.mtlsSerialNumber).toBe("DEVICE-1");
  });

  it("respects env-configured (non-default) header names, proving the design isn't NPM/nginx-specific", async () => {
    process.env.MTLS_INTERNAL_PROXY_SECRET = "the-real-secret";
    process.env.MTLS_HEADER_CERT_VERIFIED = "X-Custom-Verified";
    process.env.MTLS_HEADER_CERT_CN = "X-Custom-CN";
    process.env.MTLS_HEADER_PROXY_SECRET = "X-Custom-Proxy-Secret";
    vi.doMock("../modules/mtls/certificates.service", () => ({ findActiveCertificate: vi.fn(async () => ({ id: "cert-1" })) }));
    const { verifyMtlsIdentity } = await import("../middleware/mtlsIdentity.middleware");
    const ctx = fakeReqRes({
      "X-Custom-Proxy-Secret": "the-real-secret",
      "X-Custom-Verified": "SUCCESS",
      "X-Custom-CN": "DEVICE-1",
    });
    let calledNext = false;
    await verifyMtlsIdentity(ctx.req, ctx.res, () => {
      calledNext = true;
    });
    expect(calledNext).toBe(true);

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

  it("registerDevice issues a cert whose CN matches the token's bound serialNumber, never the CSR's own claimed CN", async () => {
    const { generateCertificateAuthority, createTestCsr } = await import("../utils/mtlsPki");
    const x509 = await import("@peculiar/x509");
    const ca = await generateCertificateAuthority("acme");

    vi.doMock("../modules/mtls/bootstrapTokens.service", () => ({ consumeBootstrapToken: vi.fn(async () => undefined) }));
    vi.doMock("../modules/mtls/ca.service", () => ({
      getCaForSigning: vi.fn(async () => ({ certPem: ca.certPem, privateKeyPem: ca.privateKeyPem, leafValidityDays: 90 })),
      claimNextSerial: vi.fn(async () => 7),
    }));
    const issueCertificateRecord = vi.fn(async () => undefined);
    vi.doMock("../modules/mtls/certificates.service", () => ({ issueCertificateRecord, supersedeActiveCertificates: vi.fn(async () => undefined) }));

    const { registerDevice } = await import("../modules/mtls/deviceMtls.service");
    const { csrPem } = await createTestCsr("whatever-the-agent-put-in-the-csr");

    const result = await registerDevice("acme", { csrPem, serialNumber: "REAL-SERIAL-99" }, "some-bootstrap-token");

    const parsed = new x509.X509Certificate(result.certPem);
    expect(parsed.subject).toBe("CN=REAL-SERIAL-99");
    expect(issueCertificateRecord).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: "REAL-SERIAL-99" }));
  });

  it("renewDevice rejects when the request body's serialNumber doesn't match the mTLS-verified identity", async () => {
    vi.doMock("../modules/mtls/bootstrapTokens.service", () => ({ consumeBootstrapToken: vi.fn() }));
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
    vi.doMock("../modules/mtls/bootstrapTokens.service", () => ({ consumeBootstrapToken: vi.fn() }));
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
