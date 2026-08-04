-- Geofencing: zones + per-device latest-location cache for compliance
-- evaluation, plus the location-refresher's own budget setting.

CREATE TABLE "GeofenceZone" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "shape" TEXT NOT NULL,
    "geometry" JSONB NOT NULL,
    "color" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeofenceZone_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GeofenceZone_workspaceSlug_idx" ON "GeofenceZone"("workspaceSlug");

CREATE TABLE "DeviceLocation" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "source" TEXT,
    "recordedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "error" TEXT,

    CONSTRAINT "DeviceLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceLocation_workspaceSlug_deviceId_key" ON "DeviceLocation"("workspaceSlug", "deviceId");
CREATE INDEX "DeviceLocation_workspaceSlug_fetchedAt_idx" ON "DeviceLocation"("workspaceSlug", "fetchedAt");

ALTER TABLE "WorkspaceState" ADD COLUMN "locationRefreshBudgetPerHour" INTEGER;
