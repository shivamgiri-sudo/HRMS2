-- Add email and mobile fields to ats_recruiter table
-- This allows candidates to see recruiter contact info after registration

USE mas_hrms;

ALTER TABLE ats_recruiter
ADD COLUMN email VARCHAR(255) NULL COMMENT 'Recruiter email address',
ADD COLUMN mobile VARCHAR(20) NULL COMMENT 'Recruiter mobile number';

-- Create index for faster lookups
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
-- The COLUMN is checked as well as the index: on a fresh database the two are different
-- questions, and 138 indexed ats_candidate(branch_name) on a table that has no such column.
SET @idx_idx_ats_recruiter_name = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter' AND INDEX_NAME = 'idx_ats_recruiter_name'
);
SET @col_idx_ats_recruiter_name = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter' AND COLUMN_NAME IN ('name')
);
SET @sql = IF(@idx_idx_ats_recruiter_name = 0 AND @col_idx_ats_recruiter_name = 1,
  'CREATE INDEX idx_ats_recruiter_name ON ats_recruiter (name)',
  'SELECT ''idx_ats_recruiter_name skipped: already present, or a column it indexes does not exist'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Update existing recruiters with contact info from employees table if available
UPDATE ats_recruiter r
JOIN employees e ON TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) = r.name
SET
  r.email = COALESCE(r.email, e.email),
  r.mobile = COALESCE(r.mobile, e.mobile)
WHERE r.active_status = 1
  AND e.active_status = 1;
