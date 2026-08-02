-- Add process_id FK to ats_interview_submission so the stored process name
-- is anchored to process_master. Nullable so existing rows are unaffected.
ALTER TABLE ats_interview_submission
  ADD COLUMN IF NOT EXISTS process_id CHAR(36) NULL AFTER interviewed_for_process,
  ADD CONSTRAINT fk_ais_process FOREIGN KEY (process_id)
    REFERENCES process_master(id) ON DELETE SET NULL ON UPDATE CASCADE;
