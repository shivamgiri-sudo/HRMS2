-- Make the EMPLOYEE_MASTER template agree with what the importer actually enforces.
--
-- THE MISMATCH
--
-- upload_template_master lists `process_code` and `designation_code` under
-- optional_columns, but employee-master-bulk.service.ts rejects any row missing either:
--
--     if (!r.processCode)     problems.push("process_code is required");
--     if (!r.designationCode) problems.push("designation_code is required");
--
-- The frontend builds its header check from these very columns, so a file without them
-- passes validation, the batch reports "validated", and every row then fails at import.
-- The uploader is told the columns are optional right up to the point where the whole
-- upload is rejected for not having them.
--
-- WHY THE IMPORTER IS THE ONE THAT IS RIGHT
--
-- Both were made mandatory deliberately, and neither can be repaired afterwards:
--   * process: a single batch on 2026-08-19 created 60 active employees with no process;
--     by 2026-08-26 that was 61 of the 128 August joiners, 62 of 63 of them client-facing.
--     An employee with no process belongs to no client, so they vanish from process and
--     client headcount, from P&L allocation by process, and from the client portal.
--   * designation: leaving it optional produced 157 active employees with no designation,
--     all created July-August 2026 through this path. No grade band, no APR eligibility
--     rule, no seat rate, an unlabelled card on the org chart - and nothing to back-fill
--     from, since none appear in db_bill by code, name+DOJ, PAN or mobile.
--
-- So the fix is to tell uploaders the truth in the template, not to relax the importer.
--
-- SAFETY
--
-- Additive and idempotent. It only moves two names between two JSON arrays on one
-- configuration row; it touches no employee data and creates nothing. Re-running it is a
-- no-op because each step is guarded on the column not already being in the target array.
-- Reversible by moving the two names back.

-- 1. Add them to required_columns, only if not already there.
UPDATE upload_template_master
   SET required_columns = JSON_ARRAY_APPEND(required_columns, '$', 'process_code')
 WHERE upload_type_code = 'EMPLOYEE_MASTER'
   AND NOT JSON_CONTAINS(required_columns, '"process_code"', '$');

UPDATE upload_template_master
   SET required_columns = JSON_ARRAY_APPEND(required_columns, '$', 'designation_code')
 WHERE upload_type_code = 'EMPLOYEE_MASTER'
   AND NOT JSON_CONTAINS(required_columns, '"designation_code"', '$');

-- 2. Remove them from optional_columns, so neither appears in both lists.
--    JSON_REMOVE needs the index, and JSON_SEARCH returns a quoted path like '"$[10]"',
--    so the path is unquoted before use. Guarded so a missing entry is skipped rather
--    than removing element 0 by accident.
UPDATE upload_template_master
   SET optional_columns = JSON_REMOVE(
         optional_columns,
         JSON_UNQUOTE(JSON_SEARCH(optional_columns, 'one', 'process_code'))
       )
 WHERE upload_type_code = 'EMPLOYEE_MASTER'
   AND JSON_SEARCH(optional_columns, 'one', 'process_code') IS NOT NULL;

UPDATE upload_template_master
   SET optional_columns = JSON_REMOVE(
         optional_columns,
         JSON_UNQUOTE(JSON_SEARCH(optional_columns, 'one', 'designation_code'))
       )
 WHERE upload_type_code = 'EMPLOYEE_MASTER'
   AND JSON_SEARCH(optional_columns, 'one', 'designation_code') IS NOT NULL;
