-- Upload-batch retention (upload_batch_row is ~18 GB / 70% of mas_hrms).
--
-- Additive only, and deliberately NO ALTER on any existing table: progress is recorded by a row in
-- upload_batch_snapshot (a batch whose snapshot has rows_purged_at set has had its rows deleted), so the hot
-- upload_batch / upload_batch_row tables are never touched by DDL (see CLAUDE.md "Migration Safety").
--
-- The snapshot keeps COUNTS and the error breakdown only. It does NOT keep sample data rows: raw/normalized
-- rows can carry salary, bank, UAN and identity data, and the point of the retention is that it is gone.

CREATE TABLE IF NOT EXISTS upload_batch_snapshot (
  id                 CHAR(36)     NOT NULL,              -- = upload_batch.id
  upload_batch_no    VARCHAR(50)  NOT NULL,
  upload_type_code   VARCHAR(100) NOT NULL,
  original_file_name VARCHAR(255) NULL,
  batch_status       VARCHAR(50)  NOT NULL,
  total_rows         INT          NOT NULL DEFAULT 0,
  valid_rows         INT          NOT NULL DEFAULT 0,
  error_rows         INT          NOT NULL DEFAULT 0,
  imported_rows      INT          NOT NULL DEFAULT 0,
  status_breakdown   JSON         NULL,                  -- {"imported": 1200, "error": 3, ...} from upload_batch_row
  error_breakdown    JSON         NULL,                  -- top error messages with counts (no row data)
  sample_errors      JSON         NULL,                  -- first N {row_no, errors}; error text only, never row data
  rows_at_purge      INT          NOT NULL DEFAULT 0,    -- how many upload_batch_row rows existed when purged
  rows_deleted       INT          NOT NULL DEFAULT 0,
  rows_purged_at     DATETIME     NULL,                  -- set only after every row of the batch is gone
  batch_created_at   DATETIME     NULL,
  snapshot_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ubs_type_status (upload_type_code, batch_status),
  KEY idx_ubs_batch_no (upload_batch_no),
  KEY idx_ubs_purged (rows_purged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per upload type retention. The row with upload_type_code = '*' is the default for any type not listed.
CREATE TABLE IF NOT EXISTS upload_batch_retention_policy (
  upload_type_code VARCHAR(100) NOT NULL,
  retain_days      INT          NOT NULL DEFAULT 7,   -- finished batches (imported / completed / imported_with_errors)
  retain_failed_days INT        NOT NULL DEFAULT 30,  -- rejected / failed / validation_failed (kept longer to debug)
  enabled          TINYINT      NOT NULL DEFAULT 1,
  note             VARCHAR(200) NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (upload_type_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default 7 days; money / statutory / master-data uploads are kept 14 days (30 failed -> 60).
INSERT IGNORE INTO upload_batch_retention_policy (upload_type_code, retain_days, retain_failed_days, note) VALUES
  ('*',                    7, 30, 'default for every upload type'),
  ('INCENTIVE_BULK',      14, 60, 'money'),
  ('DEDUCTION_BULK',      14, 60, 'money'),
  ('HOUSING_OWNER_INCENTIVE', 14, 60, 'money'),
  ('PF_UAN_UPDATE',       14, 60, 'statutory'),
  ('EMPLOYEE_MASTER',     14, 60, 'employee master data'),
  ('EMPLOYEE_LOB_MAPPING', 14, 60, 'employee master data');
