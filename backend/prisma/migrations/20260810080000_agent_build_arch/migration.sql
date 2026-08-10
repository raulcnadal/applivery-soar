-- Adds an arch dimension to AgentBuild (Windows now has amd64 + arm64
-- variants; macOS stays single-arch "universal") and splits
-- WorkspaceState's Windows "Publish to Applivery" bookkeeping into one
-- column pair per arch, since each arch is a separate deployable Applivery
-- application. See agentBuilds.service.ts's module doc.

DROP INDEX "AgentBuild_platform_key";
ALTER TABLE "AgentBuild" ADD COLUMN "arch" TEXT NOT NULL DEFAULT 'universal';
-- Backfill: the one windows row that already exists today is the amd64
-- build (the only arch this app's zero-config path has ever ingested) —
-- macOS rows correctly keep the 'universal' default.
UPDATE "AgentBuild" SET "arch" = 'amd64' WHERE "platform" = 'windows';
CREATE UNIQUE INDEX "AgentBuild_platform_arch_key" ON "AgentBuild"("platform", "arch");

ALTER TABLE "WorkspaceState" RENAME COLUMN "windowsAgentApplicationId" TO "windowsAmd64AgentApplicationId";
ALTER TABLE "WorkspaceState" RENAME COLUMN "windowsAgentPublishedAt" TO "windowsAmd64AgentPublishedAt";
ALTER TABLE "WorkspaceState" ADD COLUMN "windowsArm64AgentApplicationId" TEXT;
ALTER TABLE "WorkspaceState" ADD COLUMN "windowsArm64AgentPublishedAt" TIMESTAMP(3);
