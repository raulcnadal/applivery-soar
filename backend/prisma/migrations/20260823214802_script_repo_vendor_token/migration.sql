ALTER TABLE "ScriptRepo" ADD COLUMN "vendor" TEXT NOT NULL DEFAULT 'github';
ALTER TABLE "ScriptRepo" ADD COLUMN "baseUrl" TEXT;
ALTER TABLE "ScriptRepo" ADD COLUMN "tokenEncrypted" TEXT;
