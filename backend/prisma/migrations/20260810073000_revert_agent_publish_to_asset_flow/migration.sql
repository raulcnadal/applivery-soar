-- Revert "Publish to Applivery" back to the simpler mdm/assets flow (see
-- agentBuilds.service.ts's rewritten module doc) — the App Distribution
-- App->Build->Publication model from the previous migration turned out not
-- to be the right fit; the asset-per-version approach with a name-based
-- dedup check is. Drops the now-unused App Distribution bookkeeping columns
-- added in 20260810070500_agent_distribution_flow.

ALTER TABLE "WorkspaceState" DROP COLUMN "agentDistributionAppId";
ALTER TABLE "WorkspaceState" DROP COLUMN "windowsAgentBuildId";
ALTER TABLE "WorkspaceState" DROP COLUMN "macosAgentBuildId";
