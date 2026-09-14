-- Disables the seeded 'LEAVE_APPROVAL' generic-workflow-engine definition
-- (015_platform_foundation.sql: Team Leader -> HR, 2 steps).
--
-- 2026-08-13 leave-module audit + policy sign-off on #24: the confirmed,
-- approved leave workflow is Employee -> Reporting Manager -> Approved, with
-- no mandatory HR second-level approval. This 'LEAVE_APPROVAL' row was never
-- actually wired to the leave module (leave.service.ts / leave.secure.routes.ts
-- never call workflowService with this or any workflow_code) but it IS
-- visible in a live admin screen (Workflow Definitions tab, /workflow-admin,
-- admin/hr role) as an apparently-active 2-step "Leave Request Approval"
-- workflow including an HR step -- directly contradicting the confirmed
-- policy for anyone who opens that screen.
--
-- workflowService.listWorkflows()/getWorkflowByCode() both filter on
-- active_status = 1 (workflow.service.ts), so this UPDATE removes it from
-- that screen entirely without deleting the row -- reversible, and the row
-- (plus its steps) remains in place for audit/history if ever needed.
--
-- Purely additive/corrective UPDATE against static workflow-definition
-- reference data, not against any employee/payroll/attendance/leave-balance
-- data. No FK cascades affected: no leave_request has ever referenced this
-- workflow (never called), so no approval_request rows exist for it to check.

UPDATE approval_workflow_master
   SET active_status = 0
 WHERE workflow_code = 'LEAVE_APPROVAL';
