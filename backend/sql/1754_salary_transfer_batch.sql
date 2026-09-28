-- Salary Transfer & Reconciliation — export batches, per-employee line items, and the
-- payslip-unlock link. Additive only: nothing here changes what any existing payroll,
-- payslip or bank-readiness endpoint does until the new /salary-transfer/* routes are used.
--
-- Deliberately NOT the full elaborate schema from the original spec (no separate
-- salary_transfer_event/import tables) — one batch table, one item table, kept small enough
-- to review in one sitting. Every state transition still updates a row with a timestamp
-- rather than overwriting history: a re-export inserts a NEW item row referencing the
-- rejected one via corrected_from_item_id, so the original rejection is never lost.

CREATE TABLE IF NOT EXISTS salary_transfer_batch (
  id CHAR(36) NOT NULL PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  batch_number VARCHAR(40) NOT NULL,
  attempt_kind ENUM('initial','reexport') NOT NULL DEFAULT 'initial',
  row_count INT NOT NULL,
  total_amount DECIMAL(14,2) NOT NULL,
  debit_account_masked VARCHAR(20) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_sha256 CHAR(64) NOT NULL,
  filters_snapshot JSON NULL,
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_salary_transfer_batch_number (batch_number),
  KEY idx_salary_transfer_batch_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salary_transfer_batch_item (
  id CHAR(36) NOT NULL PRIMARY KEY,
  batch_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  employee_code VARCHAR(20) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  pay_mod CHAR(1) NOT NULL,
  account_masked VARCHAR(20) NOT NULL,
  status ENUM('exported','rejected','corrected_ready','confirmed') NOT NULL DEFAULT 'exported',
  rejection_reason VARCHAR(60) NULL,
  rejection_note TEXT NULL,
  rejected_at TIMESTAMP NULL,
  rejected_by CHAR(36) NULL,
  corrected_from_item_id CHAR(36) NULL,
  ecs_number VARCHAR(40) NULL,
  transfer_date DATE NULL,
  confirmed_at TIMESTAMP NULL,
  confirmed_by CHAR(36) NULL,
  payslip_unlocked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Generated column trick: NULL for every terminal/rejected row (MySQL unique indexes treat
  -- each NULL as distinct, so any number of rejected rows are allowed), but exactly 1 for a
  -- row that is currently exported-and-awaiting-result or already confirmed. That makes
  -- "no duplicate open transfer for this employee in this run" a DB-enforced constraint
  -- instead of an application race.
  open_flag TINYINT GENERATED ALWAYS AS (CASE WHEN status IN ('exported','confirmed') THEN 1 ELSE NULL END) STORED,
  UNIQUE KEY uq_salary_transfer_open (run_id, employee_id, open_flag),
  KEY idx_salary_transfer_item_batch (batch_id),
  KEY idx_salary_transfer_item_employee_run (employee_id, run_id),
  KEY idx_salary_transfer_item_status (status),
  CONSTRAINT fk_salary_transfer_item_batch FOREIGN KEY (batch_id) REFERENCES salary_transfer_batch(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salary_transfer_import (
  id CHAR(36) NOT NULL PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  file_sha256 CHAR(64) NOT NULL,
  row_count INT NOT NULL,
  matched_count INT NOT NULL,
  unmatched_count INT NOT NULL,
  uploaded_by CHAR(36) NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Re-uploading the same file must be a no-op, not a second round of confirmations.
  UNIQUE KEY uq_salary_transfer_import_checksum (file_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
