-- Payments taken from a Tally export into HRMS. tally_import_voucher.voucher_key is UNIQUE: a Tally voucher
-- (its GUID, else date|type|number|amount) can be recorded once, whatever file or batch it arrives in.
CREATE TABLE IF NOT EXISTS tally_import_batch (
  id          CHAR(36)     NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  uploaded_by CHAR(36)     NULL,
  status      ENUM('previewed','applied') NOT NULL DEFAULT 'previewed',
  summary     TEXT NULL,
  payment_rows LONGTEXT NULL,
  purchase_rows LONGTEXT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at  DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_tally_batch_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tally_import_voucher (
  id           CHAR(36)      NOT NULL,
  voucher_key  VARCHAR(190)  NOT NULL,
  batch_id     CHAR(36)      NOT NULL,
  voucher_no   VARCHAR(120)  NULL,
  party        VARCHAR(255)  NULL,
  amount       DECIMAL(14,2) NOT NULL,
  imported_by  CHAR(36)      NULL,
  imported_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tally_import_voucher (voucher_key),
  KEY idx_tally_import_batch (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1972_tally_payment_import.sql applied' AS migration_status;
-- Rollback: DROP TABLE tally_import_voucher; DROP TABLE tally_import_batch;
