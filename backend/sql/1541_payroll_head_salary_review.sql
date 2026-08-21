-- Migration 1541: Payroll Head mandatory salary/journey review gate
--
-- New employees become fully payroll-eligible the instant Branch Head approves
-- their offer (employee-creation-orchestrator.service.ts writes employee_code
-- and a bare employee_salary_assignment row in that same transaction), with no
-- independent review of their documents, BGV, bank details, or actual assigned
-- salary. This adds a mandatory Payroll Head checkpoint between "employee
-- exists" and "payroll can build their salary".
--
-- SAFETY: employee_payroll_head_review only ever gets a row for an employee
-- created AFTER this ships (via a new INSERT IGNORE in the orchestrator, added
-- in the same change as this migration). No backfill is written here or
-- anywhere else — every one of the ~58,840 pre-existing employees has zero
-- rows in this table forever, so the new payroll-run gate
-- (`NOT EXISTS (... WHERE status <> 'approved')`) is vacuously true for all of
-- them. Do not add a backfill INSERT to this file later; that is the one way
-- a mistake here could actually exclude a real, already-active employee from
-- payroll.
--
-- ROLLBACK:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code IN ('PAYROLL_HEAD_SALARY_REVIEW_QUEUE','PAYROLL_HEAD_SALARY_REVIEW_DETAIL');
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code IN ('PAYROLL_HEAD_SALARY_REVIEW_QUEUE','PAYROLL_HEAD_SALARY_REVIEW_DETAIL');
--   UPDATE payroll_config_flags SET config_value = 'false' WHERE config_key = 'payroll_head_review_gate_enabled';
--   (employee_payroll_head_review / payroll_head_review_reason_master left in place — dropping
--    them would break the FK from any row already written; disable via the flag above instead.)

-- ── 1. Reason lookup table (Category + reason code, mirrors attendance_reason_master) ─────────
CREATE TABLE IF NOT EXISTS payroll_head_review_reason_master (
  code       VARCHAR(50)  NOT NULL PRIMARY KEY,
  category   ENUM('salary','documents','bgv','bank','other') NOT NULL,
  label      VARCHAR(255) NOT NULL,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  INDEX idx_phrrm_category (category)
);

INSERT IGNORE INTO payroll_head_review_reason_master (code, category, label) VALUES
  ('SALARY_MISMATCH',         'salary',    'Assigned package does not match offer CTC'),
  ('SALARY_NO_BREAKDOWN',     'salary',    'No approved component breakdown on file'),
  ('SALARY_WRONG_PACKAGE',    'salary',    'Wrong salary package for band/branch'),
  ('SALARY_OTHER',            'salary',    'Other salary issue'),
  ('DOC_MISSING',             'documents', 'Mandatory document missing'),
  ('DOC_ILLEGIBLE',           'documents', 'Uploaded document illegible/unreadable'),
  ('DOC_NAME_MISMATCH',       'documents', 'Document name does not match employee record'),
  ('DOC_OTHER',               'documents', 'Other document issue'),
  ('BGV_PENDING',             'bgv',       'BGV still pending/not initiated'),
  ('BGV_HOLD',                'bgv',       'BGV report on hold'),
  ('BGV_EXCEPTION_UNRESOLVED','bgv',       'Open BGV exception not resolved'),
  ('BGV_OTHER',               'bgv',       'Other BGV issue'),
  ('BANK_MISSING',            'bank',      'No bank detail on file'),
  ('BANK_INVALID_IFSC',       'bank',      'Invalid IFSC'),
  ('BANK_ACCOUNT_MISMATCH',   'bank',      'Account holder name mismatch'),
  ('BANK_DUPLICATE_PRIMARY',  'bank',      'Multiple active primary accounts'),
  ('BANK_OTHER',              'bank',      'Other bank detail issue'),
  ('OTHER_GENERAL',           'other',     'Other — see remarks');

-- ── 2. One review row per employee, reused across the whole approve/reject/resubmit loop ──────
CREATE TABLE IF NOT EXISTS employee_payroll_head_review (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id            CHAR(36)      NOT NULL,
  candidate_id           CHAR(36)      NULL,
  status                 ENUM('pending_review','approved','rejected') NOT NULL DEFAULT 'pending_review',
  -- Salary-package acceptance sub-step, separate from the overall approve/reject decision.
  salary_package_id      CHAR(36)      NULL,
  package_accepted       TINYINT(1)    NOT NULL DEFAULT 0,
  package_accepted_by    CHAR(36)      NULL,
  package_accepted_at    DATETIME      NULL,
  package_effective_from DATE          NULL,
  -- Overall decision.
  reviewed_by            CHAR(36)      NULL,
  reviewed_at            DATETIME      NULL,
  rejection_category     ENUM('salary','documents','bgv','bank','other') NULL,
  rejection_reason_code  VARCHAR(50)   NULL,
  rejection_remarks      TEXT          NULL,
  resubmitted_at         DATETIME      NULL,
  resubmit_count         INT           NOT NULL DEFAULT 0,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ephr_employee (employee_id),
  INDEX idx_ephr_status (status),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (salary_package_id) REFERENCES salary_package_master(id) ON DELETE SET NULL,
  FOREIGN KEY (rejection_reason_code) REFERENCES payroll_head_review_reason_master(code) ON DELETE SET NULL
);

-- ── 3. salary_component_assignments already has employee_id, just never populated by any live
--       write path for a normally-converted employee (only candidate_id is set). No new column;
--       just an index for the per-employee lookup payrollCalculate.service.ts already runs
--       (WHERE employee_id = ? AND status = 'active' ORDER BY effective_date DESC LIMIT 1),
--       which will start being hit once employees actually get rows here.
SET @sca_idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_component_assignments'
     AND INDEX_NAME = 'idx_sca_employee_status_effdate'
);
SET @sca_idx_sql = IF(@sca_idx_exists = 0,
  'ALTER TABLE salary_component_assignments ADD INDEX idx_sca_employee_status_effdate (employee_id, status, effective_date)',
  'SELECT 1'
);
PREPARE sca_idx_stmt FROM @sca_idx_sql;
EXECUTE sca_idx_stmt;
DEALLOCATE PREPARE sca_idx_stmt;

-- ── 4. Kill switch — reuses the existing global payroll_config_flags mechanism, no new table ──
INSERT IGNORE INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description)
VALUES (UUID(), NULL, NULL, 'payroll_head_review_gate_enabled', 'true',
        'If false, payrollCalculate.service.ts skips the payroll-head-review NOT EXISTS gate entirely (emergency kill switch, no redeploy needed).');

-- ── 5. Page catalog + role access — real tables are page_catalog / role_page_access, NOT
--       workforce_page_catalog (see 1007's own postmortem comment for why that distinction
--       matters: the wrong table name here previously took production down).
INSERT IGNORE INTO page_catalog
  (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('PAYROLL_HEAD_SALARY_REVIEW_QUEUE',  'Salary Review Queue',  '/payroll/salary-review',            'payroll',
   'Payroll Head mandatory salary/BGV/document/bank review queue for newly converted employees', 1),
  ('PAYROLL_HEAD_SALARY_REVIEW_DETAIL', 'Salary Review Detail', '/payroll/salary-review/:employeeId', 'payroll',
   'Single-employee review journey: BGV, documents, bank, salary package', 1);

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',  'PAYROLL_HEAD_SALARY_REVIEW_QUEUE',  1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',        'PAYROLL_HEAD_SALARY_REVIEW_QUEUE',  1, 1, 1, 0, 1, 1),
  (UUID(), 'payroll_head', 'PAYROLL_HEAD_SALARY_REVIEW_QUEUE',  1, 1, 1, 0, 1, 1),
  (UUID(), 'super_admin',  'PAYROLL_HEAD_SALARY_REVIEW_DETAIL', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',        'PAYROLL_HEAD_SALARY_REVIEW_DETAIL', 1, 1, 1, 0, 1, 1),
  (UUID(), 'payroll_head', 'PAYROLL_HEAD_SALARY_REVIEW_DETAIL', 1, 1, 1, 0, 1, 1);
