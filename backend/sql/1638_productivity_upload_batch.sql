-- 1638 — Upload_Batch identity and per-row rejection tracking for the WFM manual upload pipeline
-- (requirements.md Requirement 17).
--
-- NOT YET EXECUTED. Purely additive: two new tables, nothing altered, nothing read by production
-- code yet (the upload route is Phase 4). Needs owner approval before it runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- `apr.upload_batch_id` has 0 distinct values across all 46,163 rows -- every one of the 3,810
-- existing manual uploads landed with zero audit trail of who uploaded which file. This table is
-- that audit trail, for the NEW upload path this feature introduces (`apr_manual_upload`,
-- criterion 17.3) rather than the old unattributed write into `apr` (criterion 17.10, closed in a
-- later phase by a trigger).
--
-- WHAT productivity_upload_batch IS
-- One row per submitted file: which Dialler_Source, branch, process and date range it declares,
-- the file's name and a SHA-256 content digest, who uploaded it and when, the row-count
-- accounting (criterion 17.11: accepted + rejected = submitted), and supersession pointers
-- (criterion 17.7: a re-upload supersedes the prior batch's rows without deleting them).
--
-- WHAT productivity_upload_rejection IS
-- One row per rejected row, naming the row number, the employee code it named (if any) and the
-- rejection reason (criterion 17.2: "a reason for each rejected row" is a row, not a truncated
-- blob appended to the batch).
--
-- ROLLBACK
--   DROP TABLE productivity_upload_rejection;
--   DROP TABLE productivity_upload_batch;

CREATE TABLE IF NOT EXISTS productivity_upload_batch (
  id                    CHAR(36)     NOT NULL,
  batch_reference       VARCHAR(100) NOT NULL,
  dialler_source_id     CHAR(36)     NOT NULL,
  branch_id             CHAR(36)     NOT NULL,
  process_id            CHAR(36)     NOT NULL,
  date_from             DATE         NOT NULL,
  date_to               DATE         NOT NULL,
  file_name             VARCHAR(255) NOT NULL,
  content_digest        CHAR(64)     NOT NULL,
  uploaded_by           CHAR(36)     NOT NULL,
  submitted_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_row_count   INT UNSIGNED NOT NULL DEFAULT 0,
  accepted_row_count    INT UNSIGNED NOT NULL DEFAULT 0,
  rejected_row_count    INT UNSIGNED NOT NULL DEFAULT 0,
  mapping_version_used  SMALLINT UNSIGNED NULL,
  supersedes_batch_id   CHAR(36)     NULL,
  superseded_by_batch_id CHAR(36)    NULL,
  superseded_at         DATETIME     NULL,
  status                ENUM('pending','accepted','rejected','superseded') NOT NULL DEFAULT 'pending',
  PRIMARY KEY (id),
  UNIQUE KEY uq_pub_batch_reference (batch_reference),
  KEY idx_pub_source_branch_dates (dialler_source_id, branch_id, date_from, date_to),
  KEY idx_pub_status (status)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='One row per submitted WFM manual productivity upload (requirements.md Requirement 17). Not written by anything until Phase 4s route.';

CREATE TABLE IF NOT EXISTS productivity_upload_rejection (
  id             CHAR(36)     NOT NULL,
  batch_id       CHAR(36)     NOT NULL,
  row_number     INT UNSIGNED NOT NULL,
  employee_code  VARCHAR(50)  NULL,
  reason         VARCHAR(500) NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pur_batch (batch_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='One row per rejected upload row, naming the reason (criterion 17.2). Not written by anything until Phase 4s route.';

SELECT '1638 applied: productivity_upload_batch + productivity_upload_rejection' AS migration_status;
