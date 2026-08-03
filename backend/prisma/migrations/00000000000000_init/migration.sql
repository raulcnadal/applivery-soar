-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "featureAccess" JSONB NOT NULL,
    "riskyActions" JSONB NOT NULL,
    "appliveryTagValues" TEXT[],
    "segmentIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationCredential" (
    "workspaceSlug" TEXT NOT NULL,
    "apiToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "apiTokenExpireAt" TIMESTAMP(3),
    "refreshTokenExpireAt" TIMESTAMP(3),
    "configuredBy" TEXT,
    "configuredAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationCredential_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "WorkspaceState" (
    "workspaceSlug" TEXT NOT NULL,
    "dashboard" JSONB,
    "themeMode" TEXT,
    "webhookUrl" TEXT,
    "smtpConfig" JSONB,
    "scheduledReports" JSONB,
    "timezone" TEXT,
    "customReportTemplate" TEXT,
    "auditLogRetentionDays" INTEGER,
    "sessionTimeoutMinutes" INTEGER,
    "installedAppsRefreshBudgetPerHour" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceState_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "WidgetLayout" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WidgetLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompliancePolicy" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoRun" BOOLEAN NOT NULL DEFAULT false,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "conditionLogic" TEXT NOT NULL DEFAULT 'any',
    "conditions" JSONB NOT NULL,
    "workflowId" TEXT,
    "nonComplianceTag" TEXT,
    "nonComplianceSmartAttributeId" TEXT,
    "openCaseOnViolation" BOOLEAN NOT NULL DEFAULT true,
    "autoResolveCaseOnRecovery" BOOLEAN NOT NULL DEFAULT false,
    "mitreTechniques" TEXT[],
    "framework" TEXT,
    "controlRef" TEXT,
    "targetDeviceAudienceId" TEXT,
    "segmentId" TEXT,
    "evaluationIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "autoRunBatchCap" INTEGER DEFAULT 15,
    "autoRunDestructiveAck" BOOLEAN NOT NULL DEFAULT false,
    "escalatedWorkflowId" TEXT,
    "escalatedWorkflowMinRiskTier" TEXT NOT NULL DEFAULT 'high',
    "lastEvaluatedAt" TIMESTAMP(3),
    "autoRunTripped" BOOLEAN NOT NULL DEFAULT false,
    "autoRunTrippedAt" TIMESTAMP(3),
    "autoRunTrippedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompliancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceViolation" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyName" TEXT,
    "workflowId" TEXT,
    "workflowName" TEXT,
    "workflowRunId" TEXT,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT,
    "platform" TEXT,
    "platformDeviceId" TEXT,
    "matchedConditions" JSONB,
    "caseId" TEXT,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ComplianceViolation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyQuarantineEntry" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT,
    "policies" JSONB NOT NULL,
    "workflowId" TEXT,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyQuarantineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceEvaluationState" (
    "workspaceSlug" TEXT NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ComplianceEvaluationState_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "steps" JSONB NOT NULL,
    "targetPlatform" TEXT,
    "targetDeploymentModel" TEXT,
    "recovery" JSONB NOT NULL,
    "allowUnattendedDestructive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workflowName" TEXT,
    "targetDescription" TEXT,
    "status" TEXT NOT NULL,
    "total" INTEGER,
    "log" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowPendingStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "deviceSnapshot" JSONB NOT NULL,
    "workflowId" TEXT NOT NULL,
    "slugKey" TEXT NOT NULL,
    "nextStepId" TEXT NOT NULL,
    "log" JSONB NOT NULL,
    "resumeAt" TIMESTAMP(3) NOT NULL,
    "stepKind" TEXT NOT NULL DEFAULT 'timer',
    "onFailureStepId" TEXT,
    "pendingToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowPendingStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRunResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT,
    "steps" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "finalStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRunResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trigger" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "workflowId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "openCase" BOOLEAN NOT NULL DEFAULT false,
    "caseSeverity" TEXT NOT NULL DEFAULT 'medium',
    "deviceLookupField" TEXT,
    "secret" TEXT NOT NULL,
    "lastFiredAt" TIMESTAMP(3),
    "fireCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "source" TEXT NOT NULL,
    "deviceId" TEXT,
    "deviceName" TEXT,
    "segmentId" TEXT,
    "policyId" TEXT,
    "policyName" TEXT,
    "violationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workflowRunIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignee" TEXT,
    "createdBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "slaClockStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "slaAckBreachNotifiedAt" TIMESTAMP(3),
    "slaResolveBreachNotifiedAt" TIMESTAMP(3),
    "mitreTechniques" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "threatIntel" JSONB NOT NULL DEFAULT '[]',
    "externalRefs" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseNote" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorEmail" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseTimelineEntry" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseTimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAutoRunRule" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minSeverity" TEXT NOT NULL DEFAULT 'high',
    "mitreTechniques" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workflowId" TEXT NOT NULL,
    "autoRunDestructiveAck" BOOLEAN NOT NULL DEFAULT false,
    "maxFiresPerHour" INTEGER NOT NULL DEFAULT 10,
    "recentFires" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseAutoRunRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseSlaSettings" (
    "workspaceSlug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnBreach" BOOLEAN NOT NULL DEFAULT true,
    "thresholds" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseSlaSettings_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnOpen" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnClose" BOOLEAN NOT NULL DEFAULT false,
    "minSeverity" TEXT NOT NULL DEFAULT 'low',
    "autoCloseCaseOnRemoteResolve" BOOLEAN NOT NULL DEFAULT false,
    "notifyOnSystemHealth" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "lastFiredAt" TIMESTAMP(3),
    "fireCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreatIntelProvider" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreatIntelProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreatIntelCache" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "ioc" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreatIntelCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppliveryWebhookConfig" (
    "workspaceSlug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "secret" TEXT NOT NULL,
    "recentEvents" JSONB NOT NULL DEFAULT '[]',
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "lastReceivedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppliveryWebhookConfig_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "AppliveryWebhookRule" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "openCase" BOOLEAN NOT NULL DEFAULT false,
    "caseSeverity" TEXT NOT NULL DEFAULT 'medium',
    "runWorkflow" BOOLEAN NOT NULL DEFAULT false,
    "workflowId" TEXT,
    "autoRunDestructiveAck" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AppliveryWebhookRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAudience" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "selectors" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevicePushData" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevicePushData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstalledAppInventory" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "apps" JSONB NOT NULL,
    "agentVersion" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstalledAppInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingAppReport" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingAppReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceReportSecret" (
    "workspaceSlug" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "rotatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceReportSecret_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "ScriptRunTracking" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT,
    "platformPath" TEXT NOT NULL,
    "platformDeviceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "scriptName" TEXT,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "baselineSuccess" INTEGER NOT NULL DEFAULT 0,
    "baselineError" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workflowResume" JSONB,

    CONSTRAINT "ScriptRunTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirewallRuleSet" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ensureFirewallEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultInboundAction" TEXT NOT NULL DEFAULT 'notConfigured',
    "defaultOutboundAction" TEXT NOT NULL DEFAULT 'notConfigured',
    "rules" JSONB NOT NULL,
    "applyLibraryId" TEXT,
    "restoreLibraryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirewallRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirewallRemediationState" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "rulesetId" TEXT NOT NULL,
    "appliedState" JSONB NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirewallRemediationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionLibraryEntry" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "platform" TEXT NOT NULL,
    "assetId" TEXT,
    "assetName" TEXT,
    "arguments" TEXT,
    "scope" TEXT DEFAULT 'machine',
    "path" TEXT,
    "action" TEXT,
    "format" TEXT,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptRepo" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "path" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptRepo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppCatalogEntry" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT,
    "iconUrl" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppCatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppList" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "platform" TEXT NOT NULL,
    "appIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VulnServiceConfig" (
    "workspaceSlug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "apiTokenEncrypted" TEXT,
    "refreshIntervalHours" INTEGER NOT NULL DEFAULT 6,
    "lastRefreshAt" TIMESTAMP(3),
    "lastRefreshError" TEXT,
    "lastRefreshStats" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VulnServiceConfig_pkey" PRIMARY KEY ("workspaceSlug")
);

-- CreateTable
CREATE TABLE "VulnServiceCache" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VulnServiceCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalCatalog" (
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "lastRefreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalCatalog_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "LocationCache" (
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLogEntry" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "targetName" TEXT,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogExportDestination" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "format" TEXT NOT NULL DEFAULT 'json',
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "lastExportedAt" TIMESTAMP(3),
    "lastExportError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogExportDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemHealthJob" (
    "jobKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "lastAlertSentAt" TIMESTAMP(3),

    CONSTRAINT "SystemHealthJob_pkey" PRIMARY KEY ("jobKey")
);

-- CreateTable
CREATE TABLE "ConfigOperationLog" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "stores" TEXT[],
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigOperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Role_workspaceSlug_idx" ON "Role"("workspaceSlug");

-- CreateIndex
CREATE UNIQUE INDEX "WidgetLayout_workspaceSlug_userEmail_key" ON "WidgetLayout"("workspaceSlug", "userEmail");

-- CreateIndex
CREATE INDEX "CompliancePolicy_workspaceSlug_idx" ON "CompliancePolicy"("workspaceSlug");

-- CreateIndex
CREATE INDEX "ComplianceViolation_workspaceSlug_policyId_idx" ON "ComplianceViolation"("workspaceSlug", "policyId");

-- CreateIndex
CREATE INDEX "ComplianceViolation_workspaceSlug_status_idx" ON "ComplianceViolation"("workspaceSlug", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyQuarantineEntry_workspaceSlug_deviceId_key" ON "PolicyQuarantineEntry"("workspaceSlug", "deviceId");

-- CreateIndex
CREATE INDEX "Workflow_workspaceSlug_idx" ON "Workflow"("workspaceSlug");

-- CreateIndex
CREATE INDEX "WorkflowVersion_workflowId_idx" ON "WorkflowVersion"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowRun_workspaceSlug_workflowId_idx" ON "WorkflowRun"("workspaceSlug", "workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowPendingStep_pendingToken_key" ON "WorkflowPendingStep"("pendingToken");

-- CreateIndex
CREATE INDEX "WorkflowPendingStep_resumeAt_idx" ON "WorkflowPendingStep"("resumeAt");

-- CreateIndex
CREATE INDEX "WorkflowPendingStep_runId_idx" ON "WorkflowPendingStep"("runId");

-- CreateIndex
CREATE INDEX "WorkflowRunResult_runId_idx" ON "WorkflowRunResult"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRunResult_runId_deviceId_key" ON "WorkflowRunResult"("runId", "deviceId");

-- CreateIndex
CREATE INDEX "Trigger_workspaceSlug_idx" ON "Trigger"("workspaceSlug");

-- CreateIndex
CREATE INDEX "Case_workspaceSlug_status_idx" ON "Case"("workspaceSlug", "status");

-- CreateIndex
CREATE INDEX "Case_workspaceSlug_policyId_deviceId_idx" ON "Case"("workspaceSlug", "policyId", "deviceId");

-- CreateIndex
CREATE INDEX "CaseNote_caseId_idx" ON "CaseNote"("caseId");

-- CreateIndex
CREATE INDEX "CaseTimelineEntry_caseId_idx" ON "CaseTimelineEntry"("caseId");

-- CreateIndex
CREATE INDEX "CaseAutoRunRule_workspaceSlug_idx" ON "CaseAutoRunRule"("workspaceSlug");

-- CreateIndex
CREATE INDEX "Integration_workspaceSlug_idx" ON "Integration"("workspaceSlug");

-- CreateIndex
CREATE INDEX "ThreatIntelProvider_workspaceSlug_idx" ON "ThreatIntelProvider"("workspaceSlug");

-- CreateIndex
CREATE UNIQUE INDEX "ThreatIntelCache_workspaceSlug_ioc_providerType_key" ON "ThreatIntelCache"("workspaceSlug", "ioc", "providerType");

-- CreateIndex
CREATE UNIQUE INDEX "AppliveryWebhookRule_workspaceSlug_actionKey_key" ON "AppliveryWebhookRule"("workspaceSlug", "actionKey");

-- CreateIndex
CREATE INDEX "DeviceAudience_workspaceSlug_idx" ON "DeviceAudience"("workspaceSlug");

-- CreateIndex
CREATE UNIQUE INDEX "DevicePushData_workspaceSlug_deviceId_kind_key" ON "DevicePushData"("workspaceSlug", "deviceId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "InstalledAppInventory_workspaceSlug_deviceId_key" ON "InstalledAppInventory"("workspaceSlug", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingAppReport_workspaceSlug_deviceId_key" ON "PendingAppReport"("workspaceSlug", "deviceId");

-- CreateIndex
CREATE INDEX "ScriptRunTracking_workspaceSlug_idx" ON "ScriptRunTracking"("workspaceSlug");

-- CreateIndex
CREATE INDEX "FirewallRuleSet_workspaceSlug_idx" ON "FirewallRuleSet"("workspaceSlug");

-- CreateIndex
CREATE UNIQUE INDEX "FirewallRemediationState_workspaceSlug_deviceId_rulesetId_key" ON "FirewallRemediationState"("workspaceSlug", "deviceId", "rulesetId");

-- CreateIndex
CREATE INDEX "ActionLibraryEntry_workspaceSlug_idx" ON "ActionLibraryEntry"("workspaceSlug");

-- CreateIndex
CREATE INDEX "ScriptRepo_workspaceSlug_idx" ON "ScriptRepo"("workspaceSlug");

-- CreateIndex
CREATE UNIQUE INDEX "AppCatalogEntry_workspaceSlug_platform_identifier_key" ON "AppCatalogEntry"("workspaceSlug", "platform", "identifier");

-- CreateIndex
CREATE INDEX "AppList_workspaceSlug_idx" ON "AppList"("workspaceSlug");

-- CreateIndex
CREATE UNIQUE INDEX "VulnServiceCache_workspaceSlug_key_key" ON "VulnServiceCache"("workspaceSlug", "key");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSnapshot_workspaceSlug_date_source_key" ON "AnalyticsSnapshot"("workspaceSlug", "date", "source");

-- CreateIndex
CREATE INDEX "AuditLogEntry_workspaceSlug_createdAt_idx" ON "AuditLogEntry"("workspaceSlug", "createdAt");

-- CreateIndex
CREATE INDEX "LogExportDestination_workspaceSlug_idx" ON "LogExportDestination"("workspaceSlug");

-- AddForeignKey
ALTER TABLE "ComplianceViolation" ADD CONSTRAINT "ComplianceViolation_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CompliancePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowPendingStep" ADD CONSTRAINT "WorkflowPendingStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRunResult" ADD CONSTRAINT "WorkflowRunResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTimelineEntry" ADD CONSTRAINT "CaseTimelineEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppliveryWebhookRule" ADD CONSTRAINT "AppliveryWebhookRule_workspaceSlug_fkey" FOREIGN KEY ("workspaceSlug") REFERENCES "AppliveryWebhookConfig"("workspaceSlug") ON DELETE RESTRICT ON UPDATE CASCADE;

