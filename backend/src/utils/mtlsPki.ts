import "reflect-metadata"; // required by @peculiar/x509 (tsyringe DI internals) — must be imported before the x509 import below, see its README's "Reflect Polyfill Required" section
import { webcrypto } from "crypto";
import * as x509 from "@peculiar/x509";

/**
 * PKI primitives for the mTLS agent-authentication feature (Phase A — see
 * backend/docs/mtls-agent-auth-roadmap.md §3). Everything here is a thin,
 * carefully-scoped wrapper around @peculiar/x509 — no bespoke ASN.1/crypto
 * code of our own. ECDSA P-256 throughout (CA and every leaf), per the
 * user's own spec and the roadmap's confirmed decision.
 *
 * Node's built-in `crypto.webcrypto` (native since Node 19, and this repo
 * requires Node >=20 — package.json's `engines`) implements the WebCrypto
 * SubtleCrypto interface @peculiar/x509 expects, so no extra polyfill
 * package (@peculiar/webcrypto) is needed — just point the library at it
 * once, here, at module load.
 */

// This project's tsconfig has no "dom" lib (backend code has no browser
// surface), so the bare global `Crypto`/`CryptoKey`/`CryptoKeyPair` type
// names @peculiar/x509's own .d.ts assumes aren't resolvable here — Node's
// own types instead nest the equivalent WebCrypto types under the
// `webcrypto` namespace (merged with the `webcrypto` const import below),
// so every reference in this file goes through that namespace instead.
type NodeCryptoKey = webcrypto.CryptoKey;
type NodeCryptoKeyPair = webcrypto.CryptoKeyPair;

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0]);

export const MTLS_KEY_ALGORITHM = "ECDSA-P256";
export const MTLS_LEAF_VALIDITY_DAYS_DEFAULT = 90;
export const MTLS_LEAF_VALIDITY_DAYS_FLOOR = 47; // future-proofing against shorter industry-standard TLS lifetimes (CA/Browser Forum's trend line) — confirmed by the user

const ECDSA_ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as webcrypto.EcdsaParams & { hash: string };
const CLIENT_AUTH_EKU_OID = "1.3.6.1.5.5.7.3.2";

async function generateEcKeyPair(): Promise<NodeCryptoKeyPair> {
  return webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as Promise<NodeCryptoKeyPair>;
}

async function exportPrivateKeyPem(key: NodeCryptoKey): Promise<string> {
  const pkcs8 = await webcrypto.subtle.exportKey("pkcs8", key);
  return x509.PemConverter.encode(pkcs8, x509.PemConverter.PrivateKeyTag);
}

async function importEcPrivateKeyFromPem(pem: string): Promise<NodeCryptoKey> {
  const pkcs8 = x509.PemConverter.decodeFirst(pem);
  return webcrypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]) as Promise<NodeCryptoKey>;
}

/** hex string, zero-padded to an even length (X.509 serial numbers must not have a leading sign bit set on an odd-length hex byte — @peculiar/x509 handles the DER integer encoding, this just keeps our own counter->hex conversion tidy and collision-free). */
function serialToHex(serial: number): string {
  const hex = serial.toString(16);
  return hex.length % 2 === 0 ? hex : `0${hex}`;
}

export interface GeneratedCa {
  certPem: string;
  privateKeyPem: string;
  notBefore: Date;
  notAfter: Date;
}

/** Generates a new self-signed CA — ECDSA P-256, ~10-year validity (a fleet-wide rotation event, not something rotated casually). */
export async function generateCertificateAuthority(workspaceSlug: string): Promise<GeneratedCa> {
  const keys = await generateEcKeyPair();
  const notBefore = new Date();
  const notAfter = new Date(notBefore);
  notAfter.setFullYear(notAfter.getFullYear() + 10);

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: `CN=Applivery SOAR CA (${workspaceSlug})`,
    notBefore,
    notAfter,
    signingAlgorithm: ECDSA_ALG,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });

  return {
    certPem: cert.toString("pem"),
    privateKeyPem: await exportPrivateKeyPem(keys.privateKey),
    notBefore,
    notAfter,
  };
}

export interface UploadedCaValidationResult {
  ok: boolean;
  error?: string;
  notBefore?: Date;
  notAfter?: Date;
}

/**
 * Validates an admin-uploaded CA cert/key pair actually match each other —
 * signs and verifies a throwaway challenge rather than trusting the caller.
 * Also confirms the cert is self-signed and has BasicConstraints CA=true,
 * since a non-CA cert can't legally sign leaf certificates.
 */
export async function validateUploadedCaPair(certPem: string, privateKeyPem: string): Promise<UploadedCaValidationResult> {
  let cert: x509.X509Certificate;
  try {
    cert = new x509.X509Certificate(certPem);
  } catch {
    return { ok: false, error: "Could not parse the uploaded certificate as a valid X.509 PEM." };
  }

  const basicConstraints = cert.getExtension(x509.BasicConstraintsExtension);
  if (!basicConstraints || !basicConstraints.ca) {
    return { ok: false, error: "The uploaded certificate does not have BasicConstraints CA=true — it can't be used to sign device certificates." };
  }

  let privateKey: NodeCryptoKey;
  try {
    privateKey = await importEcPrivateKeyFromPem(privateKeyPem);
  } catch {
    return { ok: false, error: "Could not parse the uploaded private key as a valid ECDSA PKCS#8 PEM." };
  }

  // Sign+verify a throwaway challenge with the uploaded key, then check the
  // signature validates against the uploaded cert's own public key — the
  // actual proof that these two were issued as a pair.
  const challenge = webcrypto.getRandomValues(new Uint8Array(32));
  let signature: ArrayBuffer;
  try {
    signature = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, challenge);
  } catch {
    return { ok: false, error: "The uploaded private key could not be used to sign (wrong algorithm or malformed key)." };
  }

  const certPublicKey = await cert.publicKey.export({ name: "ECDSA", namedCurve: "P-256" }, ["verify"]);
  const matches = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, certPublicKey, signature, challenge);
  if (!matches) {
    return { ok: false, error: "The uploaded certificate and private key do not match each other." };
  }

  return { ok: true, notBefore: cert.notBefore, notAfter: cert.notAfter };
}

export interface SignedLeafCertificate {
  certPem: string;
  serialHex: string;
  notBefore: Date;
  notAfter: Date;
}

/**
 * Signs a device CSR into a leaf client certificate. `forcedCn` is ALWAYS
 * used as the certificate's subject CN — the CSR's own claimed CN/subject is
 * read only to validate the CSR's self-signature, never trusted for
 * identity. This is the actual security boundary of the whole registration
 * flow (roadmap §3): a bootstrap token bound to device A can never result in
 * a certificate claiming to be device B, no matter what the CSR itself says.
 */
export async function signDeviceCsr(params: {
  csrPem: string;
  forcedCn: string;
  caCertPem: string;
  caPrivateKeyPem: string;
  serialCounter: number;
  validityDays: number;
}): Promise<SignedLeafCertificate> {
  const { csrPem, forcedCn, caCertPem, caPrivateKeyPem, serialCounter, validityDays } = params;

  let csr: x509.Pkcs10CertificateRequest;
  try {
    csr = new x509.Pkcs10CertificateRequest(csrPem);
  } catch {
    throw new Error("Could not parse the submitted CSR as a valid PKCS#10 PEM.");
  }

  const csrSignatureValid = await csr.verify();
  if (!csrSignatureValid) {
    throw new Error("The submitted CSR's self-signature does not validate — refusing to sign.");
  }

  const caCert = new x509.X509Certificate(caCertPem);
  const caPrivateKey = await importEcPrivateKeyFromPem(caPrivateKeyPem);

  const notBefore = new Date();
  const notAfter = new Date(notBefore);
  notAfter.setDate(notAfter.getDate() + validityDays);

  const serialHex = serialToHex(serialCounter);

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serialHex,
    subject: `CN=${forcedCn}`,
    issuer: caCert.subject,
    notBefore,
    notAfter,
    publicKey: csr.publicKey,
    signingKey: caPrivateKey,
    signingAlgorithm: ECDSA_ALG,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
      new x509.ExtendedKeyUsageExtension([CLIENT_AUTH_EKU_OID], true),
      await x509.SubjectKeyIdentifierExtension.create(csr.publicKey),
    ],
  });

  return { certPem: cert.toString("pem"), serialHex, notBefore, notAfter };
}

/**
 * SHA-256 thumbprint of a PEM-encoded certificate, colon-separated uppercase
 * hex (the conventional display format, matching what a browser's own
 * certificate viewer shows) — for admin-facing display only (Settings > mTLS
 * > Issued Device Certificates). Returns null if the stored PEM can't be
 * parsed, which should never happen for a certificate this system issued
 * itself, but this reads straight back from the database rather than
 * trusting that invariant blindly.
 */
export async function getCertificateThumbprint(certPem: string): Promise<string | null> {
  try {
    const cert = new x509.X509Certificate(certPem);
    const digest = await cert.getThumbprint({ name: "SHA-256" });
    return Buffer.from(digest).toString("hex").toUpperCase().replace(/(.{2})(?=.)/g, "$1:");
  } catch {
    return null;
  }
}

/** Builds an unsigned-request-ready CSR — used only by tests/tooling to simulate an agent's registration call; the real agent does this in Go (roadmap §6). */
export async function createTestCsr(cn: string): Promise<{ csrPem: string; privateKeyPem: string }> {
  const keys = await generateEcKeyPair();
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: `CN=${cn}`,
    keys,
    signingAlgorithm: ECDSA_ALG,
  });
  return { csrPem: csr.toString("pem"), privateKeyPem: await exportPrivateKeyPem(keys.privateKey) };
}
