-- Adds per-policy violation alerting (rolled-up webhook/email alert fired
-- once per evaluation pass on a policy's new violations, independent of
-- autoRun/workflow) plus lastAlertSentAt/lastAlertError so a misconfigured
-- alert channel is visible rather than a silent no-op. All nullable/
-- default-false — every existing policy keeps alertOnViolation=false
-- (no behavior change) until explicitly turned on.
ALTER TABLE "CompliancePolicy" ADD COLUMN "alertOnViolation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompliancePolicy" ADD COLUMN "alertViaWebhook" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompliancePolicy" ADD COLUMN "alertViaEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompliancePolicy" ADD COLUMN "alertWebhookUrl" TEXT;
ALTER TABLE "CompliancePolicy" ADD COLUMN "alertEmailRecipients" TEXT;
ALTER TABLE "CompliancePolicy" ADD COLUMN "lastAlertSentAt" TIMESTAMP(3);
ALTER TABLE "CompliancePolicy" ADD COLUMN "lastAlertError" TEXT;
