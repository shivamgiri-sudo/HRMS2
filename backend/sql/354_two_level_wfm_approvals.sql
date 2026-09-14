-- 354_two_level_wfm_approvals.sql
-- Adds manager_approved as the intermediate step before Branch WFM final approval.

ALTER TABLE employee_roster_preference
  MODIFY COLUMN status ENUM('pending','manager_approved','approved','rejected') NOT NULL DEFAULT 'pending';

SELECT '354_two_level_wfm_approvals.sql applied successfully' AS migration_status;
