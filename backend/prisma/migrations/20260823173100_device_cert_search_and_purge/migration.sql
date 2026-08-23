-- Adds server-side searchability + a workspace-scoped bulk-purge setting for
-- Issued Device Certificates (Settings > mTLS Authentication).

-- Persisted SHA-256 thumbprint (plain hex, no colons) so search can use a
-- plain indexed `contains` instead of recomputing the thumbprint for every
-- row on every request. Nullable: existing rows backfill lazily on first
-- read (see certificates.service.ts's listCertificates).
ALTER TABLE "DeviceCertificate" ADD COLUMN "thumbprintHex" TEXT;

-- Backs the Active/Revoked section split + counts, and the purge query,
-- at fleet scale (thousands of rows).
CREATE INDEX "DeviceCertificate_workspaceSlug_revokedAt_idx" ON "DeviceCertificate"("workspaceSlug", "revokedAt");

-- Per-workspace bulk-purge-old-revoked-certs setting. Off by default —
-- purging is a hard delete, unlike every other retention knob in this app.
ALTER TABLE "WorkspaceState" ADD COLUMN "certPurgeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkspaceState" ADD COLUMN "certPurgeRetentionDays" INTEGER NOT NULL DEFAULT 90;
