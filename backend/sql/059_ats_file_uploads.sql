-- 059_ats_file_uploads.sql
-- Add resume_url and selfie_url columns to ats_candidate table for candidate file uploads

USE mas_hrms;

ALTER TABLE ats_candidate
ADD COLUMN resume_url VARCHAR(500) NULL COMMENT 'Path to uploaded resume PDF',
ADD COLUMN selfie_url VARCHAR(500) NULL COMMENT 'Path to uploaded selfie image';

SELECT 'Migration 059 applied: Added resume_url and selfie_url columns to ats_candidate' AS status;
