-- Admin-defined custom device checks (disclosed new feature, no main.py
-- equivalent) — see customChecks.service.ts's module doc.

CREATE TABLE "CustomCheckDefinition" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "checkerType" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomCheckDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomCheckDefinition_workspaceSlug_platform_key_key" ON "CustomCheckDefinition"("workspaceSlug", "platform", "key");
CREATE INDEX "CustomCheckDefinition_workspaceSlug_idx" ON "CustomCheckDefinition"("workspaceSlug");
