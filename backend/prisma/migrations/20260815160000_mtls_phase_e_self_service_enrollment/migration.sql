-- mTLS agent authentication, Phase E (self-service enrollment addendum) —
-- see backend/docs/mtls-agent-auth-roadmap.md. Off by default:
-- mtlsSelfServiceMode defaults to 'disabled', so this alone changes no
-- existing route's behavior.

ALTER TABLE "WorkspaceState" ADD COLUMN "mtlsSelfServiceMode" TEXT NOT NULL DEFAULT 'disabled';

CREATE TABLE "EnrollmentSecret" (
    "workspaceSlug" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "rotatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrollmentSecret_pkey" PRIMARY KEY ("workspaceSlug")
);

CREATE TABLE "DeviceEnrollmentRequest" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "platform" TEXT,
    "displayName" TEXT,
    "csrPem" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "DeviceEnrollmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceEnrollmentRequest_workspaceSlug_serialNumber_status_key" ON "DeviceEnrollmentRequest"("workspaceSlug", "serialNumber", "status");

CREATE INDEX "DeviceEnrollmentRequest_workspaceSlug_status_idx" ON "DeviceEnrollmentRequest"("workspaceSlug", "status");
