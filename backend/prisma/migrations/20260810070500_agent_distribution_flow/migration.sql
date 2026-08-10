-- Correct "Publish to Applivery" to Applivery's real three-tier App
-- Distribution model (App container -> Build -> MDM enterprise-application
-- Publication) instead of the single mdm/assets-upload shortcut that was
-- rejected server-side ("Build ... not found in organization"). See
-- WorkspaceState.agentDistributionAppId's doc comment in schema.prisma.

ALTER TABLE "WorkspaceState" ADD COLUMN "agentDistributionAppId" TEXT;
ALTER TABLE "WorkspaceState" ADD COLUMN "windowsAgentBuildId" TEXT;
ALTER TABLE "WorkspaceState" ADD COLUMN "macosAgentBuildId" TEXT;
