-- mTLS: consolidate into a single Global Bootstrap Token mechanism.
--
-- Retires per-device DeviceBootstrapToken (Phase A/B/D, one-time tokens
-- minted per serial number) and the Phase E admin-approval queue
-- (DeviceEnrollmentRequest / "self-service enrollment" mode toggle) in favor
-- of ONE workspace-wide token, validated at registration time against a live
-- Applivery UEM serial-number check and always issued immediately (no
-- approval step -- classic bootstrap-token semantics). See
-- backend/docs/mtls-agent-auth-roadmap.md's Global Bootstrap Token addendum.
--
-- Only one pilot device was ever enrolled against the retired tables at the
-- time of this migration, so this is a real destructive cleanup rather than
-- a preserve-everything rename for those two -- confirmed with the user
-- before writing this file. EnrollmentSecret is the one exception: it's
-- renamed in place (not dropped/recreated) so an already-configured secret
-- survives this migration unchanged.

ALTER TABLE "EnrollmentSecret" RENAME TO "GlobalBootstrapToken";

DROP TABLE "DeviceEnrollmentRequest";
DROP TABLE "DeviceBootstrapToken";

ALTER TABLE "WorkspaceState" DROP COLUMN "mtlsSelfServiceMode";
