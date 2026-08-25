-- Mobile telemetry roadmap Phase 3: Google Play Integrity API.
-- PlayIntegrityConfig: per-workspace admin settings (GCP Project Number +
-- offline-decryption key pair) -- Settings > Google Play Integrity API
-- (playIntegrity.service.ts).
CREATE TABLE "PlayIntegrityConfig" (
    "workspaceSlug" TEXT NOT NULL,
    "cloudProjectNumber" TEXT NOT NULL,
    "decryptionKey" TEXT NOT NULL,
    "verificationKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "configuredBy" TEXT,
    "configuredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayIntegrityConfig_pkey" PRIMARY KEY ("workspaceSlug")
);

-- PlayIntegrityNonce: single-use, short-lived nonces issued to devices ahead
-- of a Classic API integrity token request, consumed on first verified use --
-- Google's own documented replay-protection design for the nonce field.
CREATE TABLE "PlayIntegrityNonce" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "PlayIntegrityNonce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayIntegrityNonce_nonce_key" ON "PlayIntegrityNonce"("nonce");

CREATE INDEX "PlayIntegrityNonce_workspaceSlug_serialNumber_idx" ON "PlayIntegrityNonce"("workspaceSlug", "serialNumber");
