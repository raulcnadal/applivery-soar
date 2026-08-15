-- mTLS agent authentication, Phase A (backend PKI foundation) — disclosed
-- new feature, no main.py equivalent. See
-- backend/docs/mtls-agent-auth-roadmap.md for the full design. Purely
-- additive: no existing table is touched, no existing route depends on
-- these yet.

CREATE TABLE "CertificateAuthority" (
    "workspaceSlug" TEXT NOT NULL,
    "certPem" TEXT NOT NULL,
    "privateKeyPem" TEXT NOT NULL,
    "keyAlgorithm" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "serialCounter" INTEGER NOT NULL DEFAULT 1,
    "leafValidityDays" INTEGER NOT NULL DEFAULT 90,
    "notBefore" TIMESTAMP(3) NOT NULL,
    "notAfter" TIMESTAMP(3) NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateAuthority_pkey" PRIMARY KEY ("workspaceSlug")
);

CREATE TABLE "DeviceBootstrapToken" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceBootstrapToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceBootstrapToken_workspaceSlug_tokenHash_key" ON "DeviceBootstrapToken"("workspaceSlug", "tokenHash");
CREATE INDEX "DeviceBootstrapToken_workspaceSlug_serialNumber_idx" ON "DeviceBootstrapToken"("workspaceSlug", "serialNumber");

CREATE TABLE "DeviceCertificate" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "serialHex" TEXT NOT NULL,
    "certPem" TEXT NOT NULL,
    "notBefore" TIMESTAMP(3) NOT NULL,
    "notAfter" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceCertificate_workspaceSlug_serialHex_key" ON "DeviceCertificate"("workspaceSlug", "serialHex");
CREATE INDEX "DeviceCertificate_workspaceSlug_serialNumber_idx" ON "DeviceCertificate"("workspaceSlug", "serialNumber");
