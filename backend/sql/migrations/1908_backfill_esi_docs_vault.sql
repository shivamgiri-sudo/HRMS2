-- Backfill existing bank-passbook images into document_vault_inventory.
--
-- Bank passbooks uploaded via POST /api/payroll/esi-reg-docs/:id/bank-passbook
-- were saved to uploads/esi-docs/ and recorded in employee_documents, but the
-- upload handler never called registerUpload(), so they have no row in
-- document_vault_inventory. The generic GET /api/files/:category/:filename
-- route requires vault registration and returns VAULT_ITEM_NOT_FOUND (403)
-- for any file not registered, making existing passbook images unfetchable.
--
-- This migration registers all existing esi-docs passbooks. The handler was
-- fixed in the same commit to register new uploads automatically.

INSERT IGNORE INTO document_vault_inventory
  (id, uploaded_by_user, category, stored_filename, original_filename,
   mime_type, file_size_bytes, sha256_hash, access_level, owner_employee_id,
   owner_candidate_id)
SELECT
  UUID(),
  COALESCE(NULLIF(ed.uploaded_by, ''), 'system')   AS uploaded_by_user,
  'esi-docs'                                        AS category,
  SUBSTRING_INDEX(ed.file_url, '/', -1)             AS stored_filename,
  CONCAT('Bank_Passbook_', e.employee_code)         AS original_filename,
  'image/jpeg'                                      AS mime_type,
  0                                                 AS file_size_bytes,
  NULL                                              AS sha256_hash,
  'internal'                                        AS access_level,
  ed.employee_id                                    AS owner_employee_id,
  NULL                                              AS owner_candidate_id
FROM employee_documents ed
JOIN employees e ON e.id = ed.employee_id
WHERE ed.doc_type   = 'bank_passbook'
  AND ed.file_url LIKE '/api/files/esi-docs/%'
  AND SUBSTRING_INDEX(ed.file_url, '/', -1) NOT IN (
    SELECT stored_filename FROM document_vault_inventory
  );
