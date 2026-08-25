-- Adds DeviceCertificate.lastSeenAt — stamped on every successful mTLS-gated
-- request (see mtlsIdentity.middleware.ts's assertMtlsIdentity ->
-- certificates.service.ts's touchCertificateLastSeen). Gives the Devices
-- list's "SOAR Agent" column a real signal for mTLS-only callers (the mobile
-- app), which never POSTs a DevicePushData report the way the legacy
-- Windows/macOS report webhook does.
ALTER TABLE "DeviceCertificate" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
