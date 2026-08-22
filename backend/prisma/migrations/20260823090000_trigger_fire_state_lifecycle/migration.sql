-- Adds Fired/Resolved lifecycle to TriggerFireState -- an inbound Trigger
-- could move a device out of compliance (via the "Inbound Webhook Fired"
-- condition) with no way for the same external system to report the
-- condition cleared, leaving devices stuck out of compliance
-- indefinitely. Each Trigger now exposes a second .../resolve/{id}/{secret}
-- URL alongside its existing .../fire/{id}/{secret} one.

-- AlterTable
ALTER TABLE "TriggerFireState" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "TriggerFireState" ADD COLUMN "resolvedAt" TIMESTAMP(3);
