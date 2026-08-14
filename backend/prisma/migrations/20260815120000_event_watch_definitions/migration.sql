-- Admin-defined event-driven detection watches (disclosed new feature, no
-- main.py equivalent) — see backend/docs/event-driven-agent-detection-roadmap.md
-- and eventWatches.service.ts's module doc.

CREATE TABLE "EventWatchDefinition" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "watchType" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "debounceMs" INTEGER NOT NULL DEFAULT 5000,
    "action" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventWatchDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventWatchDefinition_workspaceSlug_platform_key_key" ON "EventWatchDefinition"("workspaceSlug", "platform", "key");
CREATE INDEX "EventWatchDefinition_workspaceSlug_idx" ON "EventWatchDefinition"("workspaceSlug");
