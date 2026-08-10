-- Add email and mobile fields to ats_recruiter table
-- This allows candidates to see recruiter contact info after registration

USE mas_hrms;

ALTER TABLE ats_recruiter
ADD COLUMN IF NOT EXISTS email VARCHAR(255) NULL COMMENT 'Recruiter email address',
ADD COLUMN IF NOT EXISTS mobile VARCHAR(20) NULL COMMENT 'Recruiter mobile number';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_ats_recruiter_name ON ats_recruiter(name);

-- Update existing recruiters with contact info from employees table if available
UPDATE ats_recruiter r
JOIN employees e ON TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) = r.name
SET
  r.email = COALESCE(r.email, e.email),
  r.mobile = COALESCE(r.mobile, e.mobile)
WHERE r.active_status = 1
  AND e.active_status = 1;
