-- OS Patch Level Smart Attribute mapping (Settings > Workspace Automation).
-- Which Applivery Smart Attribute name holds a device's OS patch-level
-- value, so normalizeDeviceFull() can surface it as NormalizedDevice's own
-- osPatchLevel field for CVE-matching precision + a new Compliance Policy
-- condition type.

-- AlterTable
ALTER TABLE "WorkspaceState" ADD COLUMN "osPatchLevelSmartAttributeName" TEXT;
