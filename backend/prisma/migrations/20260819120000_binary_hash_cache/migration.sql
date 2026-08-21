-- Binary integrity check (software identity/malware verdict) cache —
-- separate concern from the CVE vulnerability aggregate, keyed by
-- (workspaceSlug, sha256) alone rather than the identifier/version/platform
-- scheme the vuln sources share. See binaryIntegrityService.ts and
-- schema.prisma's BinaryHashCache doc comment.

-- CreateTable
CREATE TABLE "BinaryIntegrityConfig" (
    "workspaceSlug" TEXT NOT NULL,
    "refreshIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "lastRefreshAt" TIMESTAMP(3),
    "lastRefreshError" TEXT,
    "lastRefreshStats" JSONB,

    CONSTRAINT "BinaryIntegrityConfig_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "BinaryHashCache" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BinaryHashCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BinaryHashCache_workspaceSlug_sha256_key" ON "BinaryHashCache"("workspaceSlug", "sha256");
