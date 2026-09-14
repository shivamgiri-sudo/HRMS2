-- 351_sanitize_internal_sign_links.sql
-- Removes legacy internal signing links from persisted transaction rows.

UPDATE employee_document_esign_transaction
   SET provider_url = NULL
 WHERE provider_url LIKE '%/api/public/employee-documents/esign/%';

UPDATE employee_document_esign_transaction
   SET response_payload = JSON_REMOVE(
     COALESCE(response_payload, JSON_OBJECT()),
     '$.signLink',
     '$.sign_link'
   )
 WHERE JSON_VALID(response_payload)
   AND (
     JSON_CONTAINS_PATH(response_payload, 'one', '$.signLink')
     OR JSON_CONTAINS_PATH(response_payload, 'one', '$.sign_link')
   );
