-- Per-(Trigger, device) firing state -- Trigger.lastFiredAt/fireCount are
-- workspace-wide aggregates across every device; this backs "did trigger X
-- fire for device Y (and when)" for the new Compliance Policy Builder
-- "Inbound Webhook Fired" condition. lastPayload is kept purely for admin
-- visibility, never read by the compliance evaluator.

-- CreateTable
CREATE TABLE "TriggerFireState" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "lastFiredAt" TIMESTAMP(3) NOT NULL,
    "fireCount" INTEGER NOT NULL DEFAULT 1,
    "lastPayload" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriggerFireState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TriggerFireState_workspaceSlug_triggerId_deviceId_key" ON "TriggerFireState"("workspaceSlug", "triggerId", "deviceId");

-- CreateIndex
CREATE INDEX "TriggerFireState_workspaceSlug_deviceId_idx" ON "TriggerFireState"("workspaceSlug", "deviceId");
