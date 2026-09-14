-- 1237_legacy_document_verified_backfill.sql
--
-- ⚠️ REVIEW REQUIRED BEFORE THIS RUNS ON PRODUCTION. This UPDATE is idempotent
-- (re-running is a no-op once applied) but it IS a data-mutating statement over
-- ~196,479 historical employee_documents rows sourced from db_bill. It must be
-- explicitly approved by a human before this file is added to MIGRATION_MANIFEST
-- in backend/src/db/runPendingMigrations.ts (that is the step that makes it
-- actually apply — this file existing on disk does nothing on its own). Do not
-- treat inclusion in backend/sql/ as pre-authorization to run it.
--
-- What it does: migrateDocumentsFromLegacy.ts::insertBatch() previously hardcoded
-- verified=0 for every document migrated from db_bill, even though these are
-- historical documents verified offline before this system existed — the same
-- documents createLegacyJoiningChecklists.ts already marks status='verified' for.
-- That default was fixed going forward; this is the one-time catch-up for rows
-- already migrated before the fix.
--
-- Scoped to legacy_source IN ('document_master','qual_docoments','esignature') —
-- the three genuine legacy-migration sources. Deliberately excludes
-- legacy_source='manual' (13 rows live): that ENUM value's provenance/intent
-- isn't established by any code comment or migration doc found during review,
-- so those rows are left for individual review via the existing
-- PATCH /:employeeId/:docId/verify endpoint rather than assumed pre-verified.
--
-- Read-only breakdown (run 2026-08-18, before this file existed):
--   document_master: verified=0 -> 196,417 rows, verified=1 -> 11,124 rows already
--   esignature:       verified=0 ->      62 rows
--   qual_docoments:    0 rows currently present (source not yet synced at scale)
--   manual (excluded): verified=0 ->      13 rows
-- So this statement would flip 196,479 rows from verified=0 to verified=1.

UPDATE employee_documents
   SET verified = 1
 WHERE legacy_source IN ('document_master', 'qual_docoments', 'esignature')
   AND verified = 0;
