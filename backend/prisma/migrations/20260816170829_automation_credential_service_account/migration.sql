-- AutomationCredential: session-snapshot (apiToken/refreshToken pair) -> a
-- single Applivery Service Account Bearer token. See schema.prisma's model
-- doc comment and backend/docs/settings.md#workspace-automation for why.
--
-- Existing rows lose their stored session tokens outright (not migrated —
-- there's no way to convert a session token into a Service Account token,
-- and those tokens were already racing themselves stale). serviceAccountToken
-- defaults to '' for any pre-existing row so the column can be NOT NULL;
-- the application layer treats an empty value the same as "not configured"
-- (see automationCredential.service.ts), so an admin just needs to paste a
-- fresh Service Account token from Settings > Workspace Automation to
-- reconfigure, same one-time step as the original setup.

ALTER TABLE "AutomationCredential" DROP COLUMN "apiToken";
ALTER TABLE "AutomationCredential" DROP COLUMN "refreshToken";
ALTER TABLE "AutomationCredential" DROP COLUMN "apiTokenExpireAt";
ALTER TABLE "AutomationCredential" DROP COLUMN "refreshTokenExpireAt";
ALTER TABLE "AutomationCredential" DROP COLUMN "lastRefreshedAt";

ALTER TABLE "AutomationCredential" ADD COLUMN "serviceAccountToken" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AutomationCredential" ALTER COLUMN "serviceAccountToken" DROP DEFAULT;

ALTER TABLE "AutomationCredential" ADD COLUMN "lastVerifiedAt" TIMESTAMP(3);
