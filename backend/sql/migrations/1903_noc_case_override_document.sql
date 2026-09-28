-- Migration 1903: NOC override document upload
--
-- Adds two columns to noc_case so a Payroll Head override can attach the scanned/
-- photographed paper NOC that was signed by hand instead of (or alongside) the digital
-- 8-signatory chain: override_document_path (multer-stored disk path, same convention as
-- payroll_noc.doc_path) and override_document_original_name (the filename the uploader
-- saw). Both nullable — an override with only a reason and no document, the existing
-- behaviour, keeps working exactly as before.
--
-- Idempotent: each statement is guarded by information_schema before ALTER. No existing
-- row values are changed.

SET @col_path := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'noc_case'
    AND COLUMN_NAME  = 'override_document_path'
);
SET @sql_path := IF(@col_path = 0,
  'ALTER TABLE noc_case ADD COLUMN override_document_path VARCHAR(500) NULL AFTER override_reason',
  'SELECT ''override_document_path already exists'' AS info'
);
PREPARE _s FROM @sql_path; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @col_name := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'noc_case'
    AND COLUMN_NAME  = 'override_document_original_name'
);
SET @sql_name := IF(@col_name = 0,
  'ALTER TABLE noc_case ADD COLUMN override_document_original_name VARCHAR(255) NULL AFTER override_document_path',
  'SELECT ''override_document_original_name already exists'' AS info'
);
PREPARE _s FROM @sql_name; EXECUTE _s; DEALLOCATE PREPARE _s;
