-- OS Patch Level Smart Attribute mapping now matches by Smart Attribute ID
-- rather than by name/label. Applivery's get-devices API only requires
-- {id, value, updatedAt} on each per-device smartAttributes[] entry — label
-- is optional and, in practice, can be absent even when the attribute has a
-- real value, which is why the earlier name-matching silently matched
-- nothing for some customers. osPatchLevelSmartAttributeName is kept
-- (nullable, untouched) for legacy rows saved before this column existed
-- and for the Settings UI's display text.

-- AlterTable
ALTER TABLE "WorkspaceState" ADD COLUMN "osPatchLevelSmartAttributeId" TEXT;
