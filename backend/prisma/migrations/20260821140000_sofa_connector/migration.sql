-- Apple SOFA feed connector (Settings > Apple Security Releases) — fifth
-- CVE source, merged into the same aggregate via vulnSources.ts. Same
-- shape as OsvAndroidConfig/OsvAndroidCache (no secret/baseUrl field, bulk
-- reference-data fetch), but SofaCache is keyed by exact ProductVersion
-- ("macos|26.6.1", "ios|18.5"), not a major-version bucket.

-- CreateTable
CREATE TABLE "SofaConfig" (
    "workspaceSlug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "refreshIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "lastRefreshAt" TIMESTAMP(3),
    "lastRefreshError" TEXT,
    "lastRefreshStats" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SofaConfig_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "SofaCache" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SofaCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SofaCache_workspaceSlug_key_key" ON "SofaCache"("workspaceSlug", "key");
