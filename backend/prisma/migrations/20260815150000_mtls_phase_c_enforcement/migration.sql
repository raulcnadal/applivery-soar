-- mTLS agent authentication, Phase C (cutover — enforcement flag) — see
-- backend/docs/mtls-agent-auth-roadmap.md §7. Off by default: this alone
-- changes no existing route's behavior.

ALTER TABLE "WorkspaceState" ADD COLUMN "mtlsEnforcementEnabled" BOOLEAN NOT NULL DEFAULT false;
