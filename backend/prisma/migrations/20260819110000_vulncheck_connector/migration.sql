-- VulnCheck connector (Settings > VulnCheck) — third CVE source alongside
-- the Vulnerability Service Worker and MISP, merged into the same
-- aggregate via vulnSources.ts's generic plugin registry. Same
-- config/cache table shape as MispConfig/MispVulnCache, minus a baseUrl
-- field since VulnCheck is a fixed SaaS API, not self-hosted.

-- CreateTable
CREATE TABLE "VulncheckConfig" (
    "workspaceSlug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyEncrypted" TEXT,
    "cpeGuesserBaseUrl" TEXT NOT NULL DEFAULT '',
    "refreshIntervalHours" INTEGER NOT NULL DEFAULT 12,
    "lastRefreshAt" TIMESTAMP(3),
    "lastRefreshError" TEXT,
    "lastRefreshStats" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VulncheckConfig_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "VulncheckCache" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VulncheckCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VulncheckCache_workspaceSlug_key_key" ON "VulncheckCache"("workspaceSlug", "key");
