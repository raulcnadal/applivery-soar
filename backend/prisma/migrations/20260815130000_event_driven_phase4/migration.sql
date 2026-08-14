-- Event-driven detection Phase 4 (rollout controls + metrics) — see
-- backend/docs/event-driven-agent-detection-roadmap.md §4 and
-- eventWatches.service.ts's module doc.

ALTER TABLE "WorkspaceState" ADD COLUMN "eventDrivenDetectionEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WorkspaceState" ADD COLUMN "eventDrivenRemoteIntervalSec" INTEGER;

CREATE TABLE "EventNotifyMetric" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "watchKey" TEXT NOT NULL,
    "action" TEXT,
    "status" TEXT NOT NULL,
    "rawEventCount" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventNotifyMetric_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventNotifyMetric_workspaceSlug_createdAt_idx" ON "EventNotifyMetric"("workspaceSlug", "createdAt");
