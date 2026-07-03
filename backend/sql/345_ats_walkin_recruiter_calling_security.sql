-- 345_ats_walkin_recruiter_calling_security.sql
-- ATS interview submission parity for branch-scoped recruiter calling / follow-up flow

USE mas_hrms;

-- ---------------------------------------------------------------------------
-- Interview submission parity columns
-- ---------------------------------------------------------------------------
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'second_round_interviewer_id') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN second_round_interviewer_id CHAR(36) NULL',
  'SELECT ''second_round_interviewer_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'second_round_interviewer_name_snapshot') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN second_round_interviewer_name_snapshot VARCHAR(255) NULL',
  'SELECT ''second_round_interviewer_name_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'second_round_interviewer_branch_snapshot') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN second_round_interviewer_branch_snapshot VARCHAR(255) NULL',
  'SELECT ''second_round_interviewer_branch_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'second_round_interviewer_designation_snapshot') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN second_round_interviewer_designation_snapshot VARCHAR(255) NULL',
  'SELECT ''second_round_interviewer_designation_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'second_round_interviewer_override_reason') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN second_round_interviewer_override_reason TEXT NULL',
  'SELECT ''second_round_interviewer_override_reason already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'client_round_conducted') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN client_round_conducted TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''client_round_conducted already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'client_round_interviewer_name') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN client_round_interviewer_name VARCHAR(255) NULL',
  'SELECT ''client_round_interviewer_name already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'client_round_result') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN client_round_result VARCHAR(100) NULL',
  'SELECT ''client_round_result already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'client_round_remarks') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN client_round_remarks TEXT NULL',
  'SELECT ''client_round_remarks already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'followup_required') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN followup_required TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''followup_required already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'followup_date') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN followup_date DATE NULL',
  'SELECT ''followup_date already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'followup_reason') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN followup_reason TEXT NULL',
  'SELECT ''followup_reason already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'hiring_source_snapshot') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN hiring_source_snapshot VARCHAR(100) NULL',
  'SELECT ''hiring_source_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'referee_employee_code_snapshot') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN referee_employee_code_snapshot VARCHAR(50) NULL',
  'SELECT ''referee_employee_code_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'referee_name_snapshot') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN referee_name_snapshot VARCHAR(255) NULL',
  'SELECT ''referee_name_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'calling_activity_id') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN calling_activity_id CHAR(36) NULL',
  'SELECT ''calling_activity_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'candidate_called_at') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN candidate_called_at DATETIME NULL',
  'SELECT ''candidate_called_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'interview_started_at') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN interview_started_at DATETIME NULL',
  'SELECT ''interview_started_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'calling_source_snapshot') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN calling_source_snapshot VARCHAR(100) NULL',
  'SELECT ''calling_source_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'calling_last_remarks') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN calling_last_remarks TEXT NULL',
  'SELECT ''calling_last_remarks already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'calling_lineup_date') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN calling_lineup_date DATE NULL',
  'SELECT ''calling_lineup_date already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'calling_turnup_status') = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN calling_turnup_status VARCHAR(50) NULL',
  'SELECT ''calling_turnup_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Additional indexes for recruiter / call flow lookups
-- ---------------------------------------------------------------------------
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND INDEX_NAME = 'idx_ats_interview_submission_recruiter_date') = 0,
  'CREATE INDEX idx_ats_interview_submission_recruiter_date ON ats_interview_submission (recruiter_code, submitted_at)',
  'SELECT ''idx_ats_interview_submission_recruiter_date already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND INDEX_NAME = 'idx_ats_interview_submission_followup') = 0,
  'CREATE INDEX idx_ats_interview_submission_followup ON ats_interview_submission (followup_required, followup_date)',
  'SELECT ''idx_ats_interview_submission_followup already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND INDEX_NAME = 'idx_ats_interview_submission_round2_interviewer') = 0,
  'CREATE INDEX idx_ats_interview_submission_round2_interviewer ON ats_interview_submission (second_round_interviewer_id)',
  'SELECT ''idx_ats_interview_submission_round2_interviewer already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND INDEX_NAME = 'idx_ats_interview_submission_calling_activity') = 0,
  'CREATE INDEX idx_ats_interview_submission_calling_activity ON ats_interview_submission (calling_activity_id)',
  'SELECT ''idx_ats_interview_submission_calling_activity already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
