-- Migration 1542: Hardening pass on the Payroll Head salary review gate (1541),
-- from a full end-to-end rethink after 1541 shipped and was tested live.
--
-- Fixes:
--   1. branch_head/payroll_hr/hr could never reach the review detail page at
--      all (no page_catalog grant), even though the backend already
--      authorizes them for /resubmit and the rejection notification links
--      straight there. Grants view-only access to the DETAIL page only —
--      not the queue, which stays the reviewer's own worklist.
--   2. New employee_payroll_head_review_history table: a full audit trail of
--      every status transition (approve/reject/resubmit/reopen), since the
--      live review row only ever holds the LATEST rejection reason — a
--      second rejection silently overwrote the first with no record kept
--      anywhere the UI could show.
--   3. New reopen_* columns on employee_payroll_head_review, for a
--      correction path after approval — 'approved' was fully terminal in
--      1541, with no way to fix a mistake caught after the fact.
--
-- ROLLBACK:
--   DELETE FROM role_page_access WHERE page_code = 'PAYROLL_HEAD_SALARY_REVIEW_DETAIL' AND role_key IN ('payroll_hr','branch_head','hr');
--   (employee_payroll_head_review_history and the reopen_* columns left in place —
--    dropping them would destroy audit history for no operational benefit.)

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'payroll_hr',  'PAYROLL_HEAD_SALARY_REVIEW_DETAIL', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_head', 'PAYROLL_HEAD_SALARY_REVIEW_DETAIL', 1, 0, 0, 0, 0, 1),
  (UUID(), 'hr',          'PAYROLL_HEAD_SALARY_REVIEW_DETAIL', 1, 0, 0, 0, 0, 1);

CREATE TABLE IF NOT EXISTS employee_payroll_head_review_history (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id  CHAR(36)     NOT NULL,
  review_id    CHAR(36)     NOT NULL,
  action       ENUM('approved','rejected','resubmitted','reopened') NOT NULL,
  actor_user_id CHAR(36)    NULL,
  rejection_category    ENUM('salary','documents','bgv','bank','other') NULL,
  rejection_reason_code VARCHAR(50) NULL,
  rejection_remarks     TEXT NULL,
  reopen_reason          TEXT NULL,
  notified_payroll_hr_user_id  CHAR(36) NULL,
  notified_branch_head_user_id CHAR(36) NULL,
  notified_employee TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ephrh_employee (employee_id, created_at),
  INDEX idx_ephrh_review (review_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (review_id) REFERENCES employee_payroll_head_review(id) ON DELETE CASCADE
);

SET @ephr_reopen_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_payroll_head_review'
     AND COLUMN_NAME = 'reopen_count'
);
SET @ephr_reopen_sql = IF(@ephr_reopen_exists = 0,
  'ALTER TABLE employee_payroll_head_review
     ADD COLUMN reopened_at   DATETIME NULL AFTER resubmit_count,
     ADD COLUMN reopened_by   CHAR(36) NULL AFTER reopened_at,
     ADD COLUMN reopen_reason TEXT     NULL AFTER reopened_by,
     ADD COLUMN reopen_count  INT      NOT NULL DEFAULT 0 AFTER reopen_reason',
  'SELECT 1'
);
PREPARE ephr_reopen_stmt FROM @ephr_reopen_sql;
EXECUTE ephr_reopen_stmt;
DEALLOCATE PREPARE ephr_reopen_stmt;
