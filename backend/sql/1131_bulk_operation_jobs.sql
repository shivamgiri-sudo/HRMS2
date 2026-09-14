-- 1131_bulk_operation_jobs.sql
--
-- Creates the table behind the client portal's bulk operations, which has never
-- existed. createBulkJob() is called from client.routes.ts and its INSERT is not
-- wrapped, so POST of a bulk job has always returned 500.
--
-- Unlike most of the missing-table defects found alongside this one, nothing
-- here fails silently: the request errors outright. The feature has simply never
-- worked.
--
-- SHAPE
--
-- Every column is determined by the code, not inferred:
--   - createBulkJob() INSERTs job_type, entity_type, total_records, file_url,
--     created_by, and returns result.insertId - so the primary key must be a
--     numeric AUTO_INCREMENT, not a UUID.
--   - updateBulkJobProgress() writes processed_records, success_count,
--     error_count, error_log, and sets status to 'COMPLETED' or 'PROCESSING'.
--   - getBulkJobs() does SELECT * ... ORDER BY created_at DESC.
--   - the exported BulkOperationJob interface names id, job_type, entity_type,
--     status, total_records, processed_records, success_count, error_count,
--     error_log, created_by, created_at and completed_at.
--
-- status is VARCHAR rather than ENUM. The interface types it as `string`, and
-- only two of its values appear in code ('PROCESSING', 'COMPLETED'); an ENUM
-- would silently reject any third value a later change introduces, which is the
-- failure mode this table already suffers from in another form. DEFAULT
-- 'PENDING' because the INSERT does not supply one.
--
-- error_log is TEXT: the caller passes it through JSON.stringify.
--
-- NOTE for whoever owns this feature: completed_at is declared on the interface
-- and selected by SELECT *, but nothing ever writes it - updateBulkJobProgress()
-- sets status = 'COMPLETED' without stamping it. The column is created here so
-- the shape matches the interface, but it will stay NULL until that is changed.
-- Left alone deliberately: that is existing behaviour, not part of creating the
-- table.
--
-- COLLATE is explicit, per the collation guard - MySQL 8 would otherwise apply
-- utf8mb4_0900_ai_ci while mas_hrms is utf8mb4_unicode_ci, leaving the table
-- unable to text-join to employees.
--
-- Idempotent and additive: a new empty table, nothing else touched.

CREATE TABLE IF NOT EXISTS bulk_operation_jobs (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_type           VARCHAR(50)  NOT NULL,
  entity_type        VARCHAR(50)  NOT NULL,
  status             VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  total_records      INT          NOT NULL DEFAULT 0,
  processed_records  INT          NOT NULL DEFAULT 0,
  success_count      INT          NOT NULL DEFAULT 0,
  error_count        INT          NOT NULL DEFAULT 0,
  error_log          TEXT         NULL,
  file_url           VARCHAR(500) NULL,
  created_by         VARCHAR(36)  NOT NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at       DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_boj_created (created_at),
  KEY idx_boj_status  (status),
  KEY idx_boj_creator (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
