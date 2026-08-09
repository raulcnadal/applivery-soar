-- Rolling "latest build" store for the two native Applivery SOAR Agent
-- binaries (Windows/macOS) — pushed here by each agent repo's own CI, see
-- agentBuilds.service.ts's module doc.

CREATE TABLE "AgentBuild" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "version" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentBuild_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentBuild_platform_key" ON "AgentBuild"("platform");

-- Per-workspace "Publish to Applivery" bookkeeping — see AgentBuild's own
-- comment above and WorkspaceState.windowsAgentApplicationId's doc comment.
ALTER TABLE "WorkspaceState" ADD COLUMN "windowsAgentApplicationId" TEXT;
ALTER TABLE "WorkspaceState" ADD COLUMN "macosAgentApplicationId" TEXT;
ALTER TABLE "WorkspaceState" ADD COLUMN "windowsAgentPublishedAt" TIMESTAMP(3);
ALTER TABLE "WorkspaceState" ADD COLUMN "macosAgentPublishedAt" TIMESTAMP(3);
