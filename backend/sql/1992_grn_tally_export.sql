-- 1992_grn_tally_export.sql
-- Daily export of fully approved GRNs to a folder the Tally connector reads.
-- grn_tally_export has one row per GRN that has been exported (UNIQUE), so a GRN can never be
-- written to a second file. grn_tally_export_batch has one row per file.

CREATE TABLE IF NOT EXISTS grn_tally_export_batch (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  file_name       VARCHAR(255)  NOT NULL,
  target_dir      VARCHAR(500)  NOT NULL,
  voucher_count   INT           NOT NULL DEFAULT 0,
  total_amount    DECIMAL(16,2) NOT NULL DEFAULT 0,
  exception_count INT           NOT NULL DEFAULT 0,
  status          ENUM('claimed','written','failed') NOT NULL DEFAULT 'claimed' COMMENT 'claimed = GRNs reserved, file not yet in place; written = file in the folder; failed = reservation released',
  trigger_source  VARCHAR(20)   NOT NULL DEFAULT 'worker',
  created_by      CHAR(36)      NULL,
  error_message   VARCHAR(500)  NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  written_at      DATETIME      NULL,
  INDEX idx_gte_batch_created (created_at),
  INDEX idx_gte_batch_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grn_tally_export (
  grn_request_id  CHAR(36)      NOT NULL PRIMARY KEY,
  grn_number      VARCHAR(80)   NOT NULL,
  batch_id        CHAR(36)      NOT NULL,
  amount          DECIMAL(16,2) NOT NULL DEFAULT 0,
  exported_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gte_batch (batch_id),
  INDEX idx_gte_number (grn_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1992_grn_tally_export.sql applied' AS migration_status;
-- Rollback: DROP TABLE grn_tally_export; DROP TABLE grn_tally_export_batch;
