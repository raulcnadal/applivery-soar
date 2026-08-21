-- OSV.dev "Android" ecosystem connector (Settings > Android Security
-- Bulletin) — fourth CVE source, merged into the same aggregate via
-- vulnSources.ts. Unlike MISP/VulnCheck, no secret/baseUrl field: it's a
-- free/public bulk ZIP dump, no auth. OsvAndroidCache is keyed by Android
-- major version ("android|15"), not per device/app combo.

-- CreateTable
CREATE TABLE "OsvAndroidConfig" (
    "workspaceSlug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "refreshIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "lastRefreshAt" TIMESTAMP(3),
    "lastRefreshError" TEXT,
    "lastRefreshStats" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsvAndroidConfig_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "OsvAndroidCache" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OsvAndroidCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OsvAndroidCache_workspaceSlug_key_key" ON "OsvAndroidCache"("workspaceSlug", "key");
