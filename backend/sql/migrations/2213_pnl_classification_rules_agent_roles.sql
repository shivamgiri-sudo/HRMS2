-- 2213_pnl_classification_rules_agent_roles.sql
--
-- From September 2026 every agent was booked as DSC in the P&L (NOIDA agent cost 1.2 L, DSC 94 L; Aug was
-- 73.6 L / 11.3 L). Cause: five rows seeded in pnl_cost_classification_rule on 2026-09-04 09:44:44 (effective
-- 2026-09-01) map agent roles to dsc_people:
--     designation EXECUTIVE, designation SENIOR EXECUTIVE,
--     department OPERATIONS, department CUSTOMER SERVICE, department TELESALES.
-- With them off, resolution falls back to the role test: people with a process are agents unless a manager /
-- TL / trainer / QA / WFM role (still mapped by the remaining seeded rules and the support-role test).
-- Read-only dry run on prod 2026-10-15 (pnl-bucket-dryrun, Apr-Sep, real payroll lines): Apr-Aug unchanged
-- (rules not active), Sep branch totals identical, agent / DSC back to the Aug pattern:
--     NOIDA 81.9 / 11.9 (Aug 73.6 / 11.3), NOIDA-2 54.1 / 15.3 (51.8 / 15.5),
--     AHMEDABAD-JALDARSHAN 25.0 / 3.6 (25.0 / 3.3), HEAD OFFICE 1.8 / 5.2 (1.8 / 5.2).
--
-- Only active_status changes; idempotent (matches only active rows of that seed batch). REVERT:
--   UPDATE pnl_cost_classification_rule SET active_status = 1
--    WHERE DATE(created_at) = '2026-09-04' AND pnl_bucket = 'dsc_people'
--      AND ((scope_type = 'designation' AND UPPER(TRIM(scope_key)) IN ('EXECUTIVE', 'SENIOR EXECUTIVE'))
--        OR (scope_type = 'department' AND UPPER(TRIM(scope_key)) IN ('OPERATIONS', 'CUSTOMER SERVICE', 'TELESALES')));

UPDATE pnl_cost_classification_rule
   SET active_status = 0
 WHERE active_status = 1
   AND DATE(created_at) = '2026-09-04'
   AND pnl_bucket = 'dsc_people'
   AND process_id IS NULL
   AND branch_id IS NULL
   AND ( (scope_type = 'designation' AND UPPER(TRIM(scope_key)) IN ('EXECUTIVE', 'SENIOR EXECUTIVE'))
      OR (scope_type = 'department'  AND UPPER(TRIM(scope_key)) IN ('OPERATIONS', 'CUSTOMER SERVICE', 'TELESALES')) );
