-- Optional per-channel daily send caps for Compliance Policy violation
-- alerts (Compliance Policy Builder > Alerts). Null max = unlimited,
-- matching every other optional Int? column on this table (e.g.
-- autoRunBatchCap). Counts reset per day via alertCountersDate, a
-- "YYYY-MM-DD" day key compared against today's date in
-- firePolicyViolationAlert -- same convention as AnalyticsSnapshot's date
-- column.

-- AlterTable
ALTER TABLE "CompliancePolicy" ADD COLUMN "alertWebhookMaxPerDay" INTEGER;
ALTER TABLE "CompliancePolicy" ADD COLUMN "alertEmailMaxPerDay" INTEGER;
ALTER TABLE "CompliancePolicy" ADD COLUMN "alertWebhookSentToday" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CompliancePolicy" ADD COLUMN "alertEmailSentToday" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CompliancePolicy" ADD COLUMN "alertCountersDate" TEXT;
