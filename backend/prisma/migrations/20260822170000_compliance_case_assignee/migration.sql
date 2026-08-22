-- Optional default assignee auto-set on every Case a Compliance Policy
-- opens/reopens (Compliance Policy Builder > Case creation). Null means
-- "leave unassigned," the pre-existing behavior -- still freely
-- reassignable afterward from the Cases view like any other case.

-- AlterTable
ALTER TABLE "CompliancePolicy" ADD COLUMN "caseAssignee" TEXT;
