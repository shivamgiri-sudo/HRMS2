-- 1502_apr_source_column.sql
-- Add source column to apr table to track data origin and protect manual uploads
-- Manual uploads are locked and should not be overwritten by sync workers

ALTER TABLE apr
  ADD COLUMN IF NOT EXISTS source ENUM('sync', 'manual') NOT NULL DEFAULT 'sync' AFTER cost_centre,
  ADD COLUMN IF NOT EXISTS uploaded_by CHAR(36) NULL AFTER source,
  ADD COLUMN IF NOT EXISTS upload_batch_id CHAR(36) NULL AFTER uploaded_by;

-- Index for filtering manual uploads
CREATE INDEX IF NOT EXISTS idx_apr_source ON apr(source);
