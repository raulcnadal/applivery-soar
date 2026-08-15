import { listBootstrapTokens } from "./bootstrapTokens.service";
import { listCertificates, type CertificateStatus } from "./certificates.service";

/**
 * "Pick devices to mint bootstrap tokens for" — the Applivery-fleet-backed
 * alternative to typing serial numbers by hand into Settings > mTLS >
 * Bootstrap Tokens. Requested directly by the admin: Applivery UEM already
 * knows every device's serial number, so the minting UI should read from
 * that instead of asking for manual entry.
 *
 * Deliberately does NOT change the trust model — a device still needs its
 * own one-time, serial-bound bootstrap token exactly as before
 * (bootstrapTokens.service.ts's consumeBootstrapToken is untouched). This
 * only removes the "where do I even get the list of serial numbers" friction
 * on the admin side; how each minted token then reaches its specific device
 * (imaging, an installer step, a provisioning script) is unchanged and still
 * the admin/IT's responsibility — Applivery's own Managed
 * Configuration/Policy interpolation (`{{device.serialNumber}}` etc., see
 * docs.applivery.com's Dynamic Variables page) has no mechanism to carry a
 * secret WE mint through a single shared profile, so it can't do that part
 * for us.
 */

export interface EnrollmentCandidate {
  serialNumber: string;
  displayName: string;
  platform: string;
  mtlsStatus: "none" | "pending" | CertificateStatus["status"];
}

export interface EnrollmentCandidatesResponse {
  available: boolean;
  reason?: string;
  items: EnrollmentCandidate[];
}

export async function listEnrollmentCandidates(workspaceSlug: string): Promise<EnrollmentCandidatesResponse> {
  const { getAutomationBearer } = await import("../settings/automationCredential.service");
  const bearer = await getAutomationBearer(workspaceSlug);
  if (!bearer) {
    return {
      available: false,
      reason: "No Automation Credential configured for this workspace yet — ask an admin to set one up under Settings > Workspace Automation, then come back here to pick devices from the live fleet.",
      items: [],
    };
  }

  const { getDevicesFull } = await import("../devices/devices.service");
  const [devicesResp, certificates, tokens] = await Promise.all([
    getDevicesFull(bearer, workspaceSlug, false),
    listCertificates(workspaceSlug),
    listBootstrapTokens(workspaceSlug),
  ]);

  // listCertificates is already ordered issuedAt desc, so the first hit per
  // serial is that device's most recent certificate.
  const certBySerial = new Map<string, CertificateStatus>();
  for (const cert of certificates) {
    if (!certBySerial.has(cert.serialNumber)) certBySerial.set(cert.serialNumber, cert);
  }
  const pendingTokenSerials = new Set(tokens.filter((t) => t.status === "pending").map((t) => t.serialNumber));

  const items: EnrollmentCandidate[] = devicesResp.items
    .filter((d) => d.serialNumber && d.serialNumber.trim())
    .map((d) => {
      const cert = certBySerial.get(d.serialNumber);
      let mtlsStatus: EnrollmentCandidate["mtlsStatus"] = "none";
      if (cert && (cert.status === "active" || cert.status === "expiring-soon")) {
        // Already enrolled and currently trusted — takes priority over any
        // stray pending token (e.g. one minted for a since-completed
        // re-enrollment) since this is the status that actually matters.
        mtlsStatus = cert.status;
      } else if (pendingTokenSerials.has(d.serialNumber)) {
        mtlsStatus = "pending";
      } else if (cert) {
        mtlsStatus = cert.status; // expired / revoked / superseded — was enrolled, isn't currently
      }
      return { serialNumber: d.serialNumber, displayName: d.displayName || d.serialNumber, platform: d.platform, mtlsStatus };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { available: true, items };
}
