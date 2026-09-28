-- 1859_roster_team_submission.sql
-- Team Roster: a reporting manager proposes roster cells (fill blanks / change already-rostered
-- dates) for their reporting tree. Nothing touches wfm_roster_assignment until the FINAL (WFM)
-- approval; the submission workflow lives entirely in these four tables.
--
--   roster_team_submission        one submission (draft -> pending_manager -> pending_wfm -> applied ...)
--   roster_team_submission_line   one proposed cell, with a snapshot of what it replaces (CHANGE)
--   roster_team_pending_cell      race-safe lock: one row per (employee, date) that is pending in ANY
--                                 submission. PRIMARY KEY (employee_id, roster_date) makes two
--                                 overlapping submits collide on the database, not in application code.
--   roster_team_submission_audit  timeline for the drill-down drawer
--
-- No FKs (as 1847/1850). Integrity is enforced in team-roster*.ts. Additive + idempotent
-- (CREATE TABLE IF NOT EXISTS); no existing table is touched.
--
-- COLLATION: mixed collations exist in production (see hrms2-new-table-collation-trap). Every id
-- column copies the collation of the column it is compared with, read from information_schema
-- at migration time: employee ids from employees.id, user ids from employees.user_id (the
-- audit/timeline joins go through employees.user_id), template ids from wfm_shift_template.id,
-- assignment ids from wfm_roster_assignment.id. Fallback utf8mb4_unicode_ci if the source is absent.

SET @rts_ec = COALESCE((SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'id' LIMIT 1), 'utf8mb4_unicode_ci');
SET @rts_uc = COALESCE((SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'user_id' LIMIT 1), 'utf8mb4_unicode_ci');
SET @rts_tc = COALESCE((SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_shift_template' AND COLUMN_NAME = 'id' LIMIT 1), 'utf8mb4_unicode_ci');
SET @rts_ac = COALESCE((SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'id' LIMIT 1), 'utf8mb4_unicode_ci');

-- ── submission ────────────────────────────────────────────────────────────────
-- draft_owner_key is set to the submitter's employee id while status = 'draft' and NULL afterwards;
-- its UNIQUE index (NULLs are distinct) is what guarantees "one open draft per submitter".
SET @rts_sql = CONCAT(
  'CREATE TABLE IF NOT EXISTS roster_team_submission (',
  ' id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,',
  ' submission_no VARCHAR(20) NULL,',
  ' submitter_employee_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_ec, ' NOT NULL,',
  ' submitter_user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_uc, ' NULL,',
  ' from_date DATE NULL,',
  ' to_date DATE NULL,',
  ' status VARCHAR(30) NOT NULL DEFAULT ''draft'',',
  ' draft_owner_key CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_ec, ' NULL,',
  ' manager_approver_employee_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_ec, ' NULL,',
  ' manager_decision VARCHAR(20) NULL,',
  ' manager_decided_by CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_uc, ' NULL,',
  ' manager_decided_at DATETIME NULL,',
  ' manager_remarks VARCHAR(1000) NULL,',
  ' wfm_decision VARCHAR(20) NULL,',
  ' wfm_decided_by CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_uc, ' NULL,',
  ' wfm_decided_at DATETIME NULL,',
  ' wfm_remarks VARCHAR(1000) NULL,',
  ' submitted_at DATETIME NULL,',
  ' applied_at DATETIME NULL,',
  ' note VARCHAR(500) NULL,',
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  ' updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,',
  ' UNIQUE KEY uq_rts_submission_no (submission_no),',
  ' UNIQUE KEY uq_rts_open_draft (draft_owner_key),',
  ' INDEX idx_rts_submitter_status (submitter_employee_id, status),',
  ' INDEX idx_rts_status (status),',
  ' INDEX idx_rts_manager_status (manager_approver_employee_id, status)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);
PREPARE rts_stmt FROM @rts_sql;
EXECUTE rts_stmt;
DEALLOCATE PREPARE rts_stmt;

-- ── line ──────────────────────────────────────────────────────────────────────
-- old_* is the snapshot of the row a CHANGE replaces; apply refuses to overwrite a row that no
-- longer matches it. An imported row has no shift_template_id (only times), hence the time columns.
SET @rtl_sql = CONCAT(
  'CREATE TABLE IF NOT EXISTS roster_team_submission_line (',
  ' id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,',
  ' submission_id BIGINT UNSIGNED NOT NULL,',
  ' employee_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_ec, ' NOT NULL,',
  ' roster_date DATE NOT NULL,',
  ' kind VARCHAR(12) NOT NULL,',
  ' old_assignment_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_ac, ' NULL,',
  ' old_assignment_type VARCHAR(50) NULL,',
  ' old_is_week_off TINYINT(1) NULL,',
  ' old_shift_template_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_tc, ' NULL,',
  ' old_shift_start_time VARCHAR(8) NULL,',
  ' old_shift_end_time VARCHAR(8) NULL,',
  ' new_assignment_type VARCHAR(20) NOT NULL,',
  ' new_shift_template_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_tc, ' NULL,',
  ' reason VARCHAR(500) NULL,',
  ' warnings_json LONGTEXT NULL,',
  ' line_status VARCHAR(12) NOT NULL DEFAULT ''pending'',',
  ' skip_reason VARCHAR(255) NULL,',
  ' applied_assignment_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_ac, ' NULL,',
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  ' updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,',
  ' UNIQUE KEY uq_rts_line_cell (submission_id, employee_id, roster_date),',
  ' INDEX idx_rts_line_employee_date (employee_id, roster_date)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);
PREPARE rtl_stmt FROM @rtl_sql;
EXECUTE rtl_stmt;
DEALLOCATE PREPARE rtl_stmt;

-- ── pending-cell lock ─────────────────────────────────────────────────────────
SET @rtp_sql = CONCAT(
  'CREATE TABLE IF NOT EXISTS roster_team_pending_cell (',
  ' employee_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_ec, ' NOT NULL,',
  ' roster_date DATE NOT NULL,',
  ' submission_id BIGINT UNSIGNED NOT NULL,',
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  ' PRIMARY KEY (employee_id, roster_date),',
  ' INDEX idx_rtp_submission (submission_id)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);
PREPARE rtp_stmt FROM @rtp_sql;
EXECUTE rtp_stmt;
DEALLOCATE PREPARE rtp_stmt;

-- ── audit timeline ────────────────────────────────────────────────────────────
SET @rta_sql = CONCAT(
  'CREATE TABLE IF NOT EXISTS roster_team_submission_audit (',
  ' id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,',
  ' submission_id BIGINT UNSIGNED NOT NULL,',
  ' action VARCHAR(40) NOT NULL,',
  ' actor_user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rts_uc, ' NULL,',
  ' actor_role VARCHAR(50) NULL,',
  ' remarks VARCHAR(1000) NULL,',
  ' meta_json LONGTEXT NULL,',
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  ' INDEX idx_rta_submission (submission_id, created_at)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);
PREPARE rta_stmt FROM @rta_sql;
EXECUTE rta_stmt;
DEALLOCATE PREPARE rta_stmt;
