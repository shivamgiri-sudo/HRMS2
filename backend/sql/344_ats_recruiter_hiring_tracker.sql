-- 344_ats_recruiter_hiring_tracker.sql
-- Recruiter hiring tracker / calling sheet source-of-truth

USE mas_hrms;

-- ---------------------------------------------------------------------------
-- ats_candidate repairs / tracker snapshots
-- ---------------------------------------------------------------------------
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'profile_status') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN profile_status VARCHAR(100) NULL DEFAULT ''registered''',
  'SELECT ''profile_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'status') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN status VARCHAR(100) NULL COMMENT ''Human-readable ATS status''',
  'SELECT ''status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'q_token') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN q_token VARCHAR(50) NULL COMMENT ''Human-readable queue token''',
  'SELECT ''q_token already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'created_date') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN created_date DATE NULL COMMENT ''Tracker helper for queue display''',
  'SELECT ''created_date already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'created_time') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN created_time TIME NULL COMMENT ''Tracker helper for queue display''',
  'SELECT ''created_time already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'final_decision') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN final_decision VARCHAR(100) NULL',
  'SELECT ''final_decision already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'walkin_end_stage') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN walkin_end_stage VARCHAR(150) NULL',
  'SELECT ''walkin_end_stage already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'recruiter_assigned_name') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN recruiter_assigned_name VARCHAR(255) NULL',
  'SELECT ''recruiter_assigned_name already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'recruiter_assigned_at') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN recruiter_assigned_at DATETIME NULL',
  'SELECT ''recruiter_assigned_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'recruiter_assignment_status') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN recruiter_assignment_status VARCHAR(50) NULL',
  'SELECT ''recruiter_assignment_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'recruiter_transfer_count') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN recruiter_transfer_count INT NOT NULL DEFAULT 0',
  'SELECT ''recruiter_transfer_count already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'round1_result') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN round1_result VARCHAR(100) NULL',
  'SELECT ''round1_result already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'round1_voc') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN round1_voc VARCHAR(255) NULL',
  'SELECT ''round1_voc already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'round1_remarks') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN round1_remarks TEXT NULL',
  'SELECT ''round1_remarks already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'skilltest_typing') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN skilltest_typing DECIMAL(8,2) NULL',
  'SELECT ''skilltest_typing already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'skilltest_ai') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN skilltest_ai DECIMAL(8,2) NULL',
  'SELECT ''skilltest_ai already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'skilltest_result') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN skilltest_result VARCHAR(100) NULL',
  'SELECT ''skilltest_result already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'skilltest_voc') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN skilltest_voc VARCHAR(255) NULL',
  'SELECT ''skilltest_voc already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'skilltest_remarks') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN skilltest_remarks TEXT NULL',
  'SELECT ''skilltest_remarks already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'round2_result') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN round2_result VARCHAR(100) NULL',
  'SELECT ''round2_result already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'round2_voc') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN round2_voc VARCHAR(255) NULL',
  'SELECT ''round2_voc already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'round2_remarks') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN round2_remarks TEXT NULL',
  'SELECT ''round2_remarks already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'second_round_interviewer_id') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN second_round_interviewer_id CHAR(36) NULL',
  'SELECT ''second_round_interviewer_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'second_round_interviewer_name_snapshot') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN second_round_interviewer_name_snapshot VARCHAR(255) NULL',
  'SELECT ''second_round_interviewer_name_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'second_round_interviewer_branch_snapshot') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN second_round_interviewer_branch_snapshot VARCHAR(255) NULL',
  'SELECT ''second_round_interviewer_branch_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'client_round_conducted') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN client_round_conducted TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''client_round_conducted already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'client_round_interviewer_name') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN client_round_interviewer_name VARCHAR(255) NULL',
  'SELECT ''client_round_interviewer_name already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'client_round_result') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN client_round_result VARCHAR(100) NULL',
  'SELECT ''client_round_result already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'client_round_remarks') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN client_round_remarks TEXT NULL',
  'SELECT ''client_round_remarks already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'offer_salary') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN offer_salary DECIMAL(12,2) NULL',
  'SELECT ''offer_salary already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'offer_doj') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN offer_doj DATE NULL',
  'SELECT ''offer_doj already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'reporting_shift') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN reporting_shift VARCHAR(100) NULL',
  'SELECT ''reporting_shift already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'offer_performance_incentive') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN offer_performance_incentive VARCHAR(255) NULL',
  'SELECT ''offer_performance_incentive already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'referee_employee_id') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN referee_employee_id CHAR(36) NULL',
  'SELECT ''referee_employee_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'referee_employee_code') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN referee_employee_code VARCHAR(50) NULL',
  'SELECT ''referee_employee_code already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'referee_name') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN referee_name VARCHAR(255) NULL',
  'SELECT ''referee_name already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'referee_branch') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN referee_branch VARCHAR(255) NULL',
  'SELECT ''referee_branch already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'referee_process') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN referee_process VARCHAR(255) NULL',
  'SELECT ''referee_process already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'referral_relationship') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN referral_relationship VARCHAR(100) NULL',
  'SELECT ''referral_relationship already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'referral_remarks') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN referral_remarks TEXT NULL',
  'SELECT ''referral_remarks already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'referral_validated_at') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN referral_validated_at DATETIME NULL',
  'SELECT ''referral_validated_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'referral_validation_status') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN referral_validation_status VARCHAR(50) NULL',
  'SELECT ''referral_validation_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'latest_calling_activity_id') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN latest_calling_activity_id CHAR(36) NULL',
  'SELECT ''latest_calling_activity_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'calling_source_snapshot') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN calling_source_snapshot VARCHAR(100) NULL',
  'SELECT ''calling_source_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'calling_last_remarks') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN calling_last_remarks TEXT NULL',
  'SELECT ''calling_last_remarks already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'calling_lineup_date') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN calling_lineup_date DATE NULL',
  'SELECT ''calling_lineup_date already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'calling_turnup_status') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN calling_turnup_status VARCHAR(50) NULL',
  'SELECT ''calling_turnup_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'employee_code') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN employee_code VARCHAR(30) DEFAULT NULL',
  'SELECT ''employee_code already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- helpful indexes for tracker lookups
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND INDEX_NAME = 'idx_ats_candidate_mobile_date') = 0,
  'CREATE INDEX idx_ats_candidate_mobile_date ON ats_candidate (mobile, walk_in_date)',
  'SELECT ''idx_ats_candidate_mobile_date already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND INDEX_NAME = 'idx_ats_candidate_branch_process') = 0,
  'CREATE INDEX idx_ats_candidate_branch_process ON ats_candidate (applied_for_branch, applied_for_process)',
  'SELECT ''idx_ats_candidate_branch_process already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND INDEX_NAME = 'idx_ats_candidate_status') = 0,
  'CREATE INDEX idx_ats_candidate_status ON ats_candidate (status)',
  'SELECT ''idx_ats_candidate_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND INDEX_NAME = 'idx_ats_candidate_final_decision') = 0,
  'CREATE INDEX idx_ats_candidate_final_decision ON ats_candidate (final_decision)',
  'SELECT ''idx_ats_candidate_final_decision already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND INDEX_NAME = 'idx_ats_candidate_recruiter_name') = 0,
  'CREATE INDEX idx_ats_candidate_recruiter_name ON ats_candidate (recruiter_assigned_name)',
  'SELECT ''idx_ats_candidate_recruiter_name already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND INDEX_NAME = 'idx_ats_candidate_source') = 0,
  'CREATE INDEX idx_ats_candidate_source ON ats_candidate (sourcing_channel)',
  'SELECT ''idx_ats_candidate_source already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND INDEX_NAME = 'idx_ats_candidate_referee_code') = 0,
  'CREATE INDEX idx_ats_candidate_referee_code ON ats_candidate (referee_employee_code)',
  'SELECT ''idx_ats_candidate_referee_code already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND INDEX_NAME = 'idx_ats_candidate_q_token') = 0,
  'CREATE INDEX idx_ats_candidate_q_token ON ats_candidate (q_token)',
  'SELECT ''idx_ats_candidate_q_token already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- ats_queue_token cleanup / helpers
-- ---------------------------------------------------------------------------
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_queue_token' AND COLUMN_NAME = 'token_number') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN token_number VARCHAR(50) NULL',
  'SELECT ''token_number already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_queue_token' AND COLUMN_NAME = 'estimated_wait_time') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN estimated_wait_time INT NULL',
  'SELECT ''estimated_wait_time already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_queue_token' AND COLUMN_NAME = 'called_at') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN called_at DATETIME NULL',
  'SELECT ''called_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_queue_token' AND COLUMN_NAME = 'interview_started_at') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN interview_started_at DATETIME NULL',
  'SELECT ''interview_started_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_queue_token' AND COLUMN_NAME = 'interview_completed_at') = 0,
  'ALTER TABLE ats_queue_token ADD COLUMN interview_completed_at DATETIME NULL',
  'SELECT ''interview_completed_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- recruiter assignment log extensions
-- ---------------------------------------------------------------------------
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'queue_token_id') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN queue_token_id CHAR(36) NULL',
  'SELECT ''queue_token_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'old_recruiter_name_snapshot') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN old_recruiter_name_snapshot VARCHAR(255) NULL',
  'SELECT ''old_recruiter_name_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'new_recruiter_name_snapshot') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN new_recruiter_name_snapshot VARCHAR(255) NULL',
  'SELECT ''new_recruiter_name_snapshot already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'branch_name') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN branch_name VARCHAR(255) NULL',
  'SELECT ''branch_name already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'transfer_reason') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN transfer_reason VARCHAR(255) NULL',
  'SELECT ''transfer_reason already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'override_reason') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN override_reason TEXT NULL',
  'SELECT ''override_reason already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'assignment_source') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN assignment_source VARCHAR(50) NULL',
  'SELECT ''assignment_source already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'notification_status') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN notification_status VARCHAR(50) NULL',
  'SELECT ''notification_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'old_recruiter_notified_at') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN old_recruiter_notified_at DATETIME NULL',
  'SELECT ''old_recruiter_notified_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'new_recruiter_notified_at') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN new_recruiter_notified_at DATETIME NULL',
  'SELECT ''new_recruiter_notified_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'work_inbox_item_id') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN work_inbox_item_id CHAR(36) NULL',
  'SELECT ''work_inbox_item_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_assignment_log' AND COLUMN_NAME = 'created_by_user_id') = 0,
  'ALTER TABLE ats_recruiter_assignment_log ADD COLUMN created_by_user_id CHAR(36) NULL',
  'SELECT ''created_by_user_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- interview submission audit enhancements
-- ---------------------------------------------------------------------------
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission_audit' AND COLUMN_NAME = 'candidate_id') = 0,
  'ALTER TABLE ats_interview_submission_audit ADD COLUMN candidate_id CHAR(36) NULL',
  'SELECT ''candidate_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission_audit' AND COLUMN_NAME = 'event_type') = 0,
  'ALTER TABLE ats_interview_submission_audit ADD COLUMN event_type VARCHAR(100) NULL',
  'SELECT ''event_type already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission_audit' AND COLUMN_NAME = 'actor_role') = 0,
  'ALTER TABLE ats_interview_submission_audit ADD COLUMN actor_role VARCHAR(100) NULL',
  'SELECT ''actor_role already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission_audit' AND COLUMN_NAME = 'ip_address') = 0,
  'ALTER TABLE ats_interview_submission_audit ADD COLUMN ip_address VARCHAR(100) NULL',
  'SELECT ''ip_address already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission_audit' AND COLUMN_NAME = 'user_agent') = 0,
  'ALTER TABLE ats_interview_submission_audit ADD COLUMN user_agent VARCHAR(500) NULL',
  'SELECT ''user_agent already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Secure candidate files
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ats_candidate_file (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  file_type ENUM('resume','selfie','aadhaar','pan','bank_proof','education','address_proof','bgv','court_check','offer','appointment','other') NOT NULL,
  original_filename VARCHAR(255) NULL,
  stored_filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(1000) NOT NULL,
  mime_type VARCHAR(100) NULL,
  file_size_bytes BIGINT NULL,
  checksum_sha256 CHAR(64) NULL,
  visibility ENUM('private','candidate_token','hr_only') NOT NULL DEFAULT 'private',
  status ENUM('active','deleted','quarantined') NOT NULL DEFAULT 'active',
  uploaded_by_user_id CHAR(36) NULL,
  uploaded_by_candidate_token_id CHAR(36) NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  migrated_from_public_url VARCHAR(1000) NULL,
  INDEX idx_acf_candidate (candidate_id),
  INDEX idx_acf_type (file_type),
  INDEX idx_acf_status (status),
  INDEX idx_acf_uploaded_at (uploaded_at)
);

CREATE TABLE IF NOT EXISTS ats_candidate_file_access_audit (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  file_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NULL,
  actor_type ENUM('candidate','employee','system') NOT NULL DEFAULT 'employee',
  action ENUM('view','download','preview','blocked') NOT NULL,
  access_result ENUM('allowed','denied') NOT NULL,
  denial_reason VARCHAR(255) NULL,
  ip_address VARCHAR(100) NULL,
  user_agent VARCHAR(500) NULL,
  accessed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_acfaa_file (file_id),
  INDEX idx_acfaa_candidate (candidate_id),
  INDEX idx_acfaa_actor (actor_user_id),
  INDEX idx_acfaa_accessed (accessed_at)
);

-- ---------------------------------------------------------------------------
-- Interviewer eligibility mapping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ats_interviewer_eligibility (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  branch_name VARCHAR(255) NOT NULL,
  round_type ENUM('skill','second_round','ops_round','client_round_internal') NOT NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_aie_employee_branch_round (employee_id, branch_name, round_type),
  INDEX idx_aie_branch_round (branch_name, round_type, active_status),
  INDEX idx_aie_employee (employee_id)
);

-- ---------------------------------------------------------------------------
-- Comprehensive recruiter hiring tracker
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ats_recruiter_hiring_activity (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  activity_date DATE NOT NULL,
  activity_month VARCHAR(20) NULL,
  recruiter_id CHAR(36) NULL,
  recruiter_employee_id CHAR(36) NULL,
  recruiter_code VARCHAR(50) NULL,
  recruiter_name_snapshot VARCHAR(255) NOT NULL,
  hiring_source VARCHAR(100) NOT NULL,
  wp_group VARCHAR(255) NULL,
  position_name VARCHAR(150) NOT NULL,
  location_name VARCHAR(150) NOT NULL,
  branch_name VARCHAR(255) NULL,
  process_name VARCHAR(255) NOT NULL,
  candidate_name VARCHAR(255) NOT NULL,
  gender VARCHAR(30) NULL,
  mobile VARCHAR(20) NOT NULL,
  candidate_email VARCHAR(255) NULL,
  education_qualification VARCHAR(150) NULL,
  experience_level VARCHAR(100) NULL,
  candidate_location VARCHAR(255) NULL,
  recruiter_remarks VARCHAR(255) NULL,
  recruiter_rejection_reason VARCHAR(255) NULL,
  pi_hr_interviewer_date DATE NULL,
  pi_hr_interviewer_name VARCHAR(255) NULL,
  hr_interview_status VARCHAR(100) NULL,
  hr_rejection_reason VARCHAR(255) NULL,
  ai_assessment_score DECIMAL(8,2) NULL,
  ai_interview_result VARCHAR(100) NULL,
  ops_interviewer_employee_id CHAR(36) NULL,
  ops_interviewer_name VARCHAR(255) NULL,
  ops_interviewer_branch_snapshot VARCHAR(255) NULL,
  ops_interview_status VARCHAR(100) NULL,
  ops_rejection_reason VARCHAR(255) NULL,
  salary_package_inr DECIMAL(12,2) NULL,
  offer_letter_status VARCHAR(100) NULL,
  joining_status VARCHAR(100) NULL,
  batch_no VARCHAR(100) NULL,
  current_status VARCHAR(150) NULL,
  joined_candidate_emp_code VARCHAR(50) NULL,
  emp_referral_details TEXT NULL,
  referee_employee_id CHAR(36) NULL,
  referee_employee_code VARCHAR(50) NULL,
  referee_name VARCHAR(255) NULL,
  referee_branch VARCHAR(255) NULL,
  referee_process VARCHAR(255) NULL,
  referral_relationship VARCHAR(100) NULL,
  referral_remarks TEXT NULL,
  referral_validation_status VARCHAR(50) NULL,
  walkin_flag TINYINT(1) NOT NULL DEFAULT 0,
  final_selection_flag TINYINT(1) NOT NULL DEFAULT 0,
  joined_flag TINYINT(1) NOT NULL DEFAULT 0,
  contacted_flag TINYINT(1) NOT NULL DEFAULT 0,
  linked_candidate_id CHAR(36) NULL,
  queue_token_id CHAR(36) NULL,
  onboarding_bridge_id CHAR(36) NULL,
  employee_id CHAR(36) NULL,
  duplicate_warning TINYINT(1) NOT NULL DEFAULT 0,
  duplicate_of_activity_id CHAR(36) NULL,
  duplicate_override_reason TEXT NULL,
  import_batch_id CHAR(36) NULL,
  source_system VARCHAR(50) NOT NULL DEFAULT 'HRMS',
  raw_sheet_payload JSON NULL,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_arha_date (activity_date),
  INDEX idx_arha_month (activity_month),
  INDEX idx_arha_recruiter_date (recruiter_id, activity_date),
  INDEX idx_arha_recruiter_name_date (recruiter_name_snapshot, activity_date),
  INDEX idx_arha_mobile (mobile),
  INDEX idx_arha_mobile_process_date (mobile, process_name, activity_date),
  INDEX idx_arha_source (hiring_source),
  INDEX idx_arha_process (process_name),
  INDEX idx_arha_branch (branch_name),
  INDEX idx_arha_position (position_name),
  INDEX idx_arha_recruiter_remarks (recruiter_remarks),
  INDEX idx_arha_hr_status (hr_interview_status),
  INDEX idx_arha_ai_result (ai_interview_result),
  INDEX idx_arha_ops_status (ops_interview_status),
  INDEX idx_arha_joining_status (joining_status),
  INDEX idx_arha_current_status (current_status),
  INDEX idx_arha_walkin (walkin_flag),
  INDEX idx_arha_final_selection (final_selection_flag),
  INDEX idx_arha_joined (joined_flag),
  INDEX idx_arha_contacted (contacted_flag),
  INDEX idx_arha_linked_candidate (linked_candidate_id),
  INDEX idx_arha_emp_code (joined_candidate_emp_code),
  INDEX idx_arha_import_batch (import_batch_id)
);

CREATE TABLE IF NOT EXISTS ats_recruiter_hiring_import_batch (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  uploaded_by CHAR(36) NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_rows INT NOT NULL DEFAULT 0,
  inserted_rows INT NOT NULL DEFAULT 0,
  updated_rows INT NOT NULL DEFAULT 0,
  duplicate_rows INT NOT NULL DEFAULT 0,
  failed_rows INT NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'processing',
  error_summary TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_arhib_uploaded_at (uploaded_at),
  INDEX idx_arhib_status (status)
);

CREATE TABLE IF NOT EXISTS ats_recruiter_hiring_import_error (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  import_batch_id CHAR(36) NOT NULL,
  row_number INT NOT NULL,
  column_name VARCHAR(255) NULL,
  error_message TEXT NOT NULL,
  raw_row JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_arhie_batch (import_batch_id),
  INDEX idx_arhie_row (row_number)
);
