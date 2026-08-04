-- Adds CompliancePolicy.targetPlatform + targetDeploymentModel, mirroring
-- Workflow's own columns of the same name/purpose. Nullable, backward
-- compatible: every policy that existed before this migration keeps
-- evaluating against every device platform exactly as it did before --
-- compliance.service.ts's evaluation pass only narrows by platform when
-- targetPlatform is actually set.
ALTER TABLE "CompliancePolicy" ADD COLUMN "targetPlatform" TEXT;
ALTER TABLE "CompliancePolicy" ADD COLUMN "targetDeploymentModel" TEXT;
