-- MISP Threat Intel connector (Settings > MISP) — mirrors VulnServiceConfig/
-- VulnServiceCache's shape exactly (see mispService.ts's doc comment): a
-- per-workspace config row plus a per-(identifier|version|platform) result
-- cache, so its cache keys line up with VulnServiceCache's and the two can
-- be merged at read time in vulnService.ts.

-- CreateTable
CREATE TABLE "MispConfig" (
    "workspaceSlug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "apiKeyEncrypted" TEXT,
    "verifySsl" BOOLEAN NOT NULL DEFAULT true,
    "cpeGuesserBaseUrl" TEXT NOT NULL DEFAULT '',
    "refreshIntervalHours" INTEGER NOT NULL DEFAULT 12,
    "lastRefreshAt" TIMESTAMP(3),
    "lastRefreshError" TEXT,
    "lastRefreshStats" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MispConfig_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "MispVulnCache" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MispVulnCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MispVulnCache_workspaceSlug_key_key" ON "MispVulnCache"("workspaceSlug", "key");
