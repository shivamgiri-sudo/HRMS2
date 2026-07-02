-- Add missing created_by column to ats_candidate table.
-- The createCandidate service INSERT has always referenced this column
-- but the original 004_ats.sql definition omitted it.
-- NOTE: Migration runner handles "Duplicate column" errors as idempotent
ALTER TABLE ats_candidate ADD COLUMN created_by CHAR(36) NULL AFTER remarks;
