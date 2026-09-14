-- Full & Final settlement disbursement — its own bank-transfer batch, separate from monthly
-- salary. Owner ruling 2026-09-12:
--   Q6: "The final settlement gets its own bank transfer batch, separate from monthly salary,
--       but using the same bank-file machinery and approvals."
--   Q7: "A leaver without a signed NOC must not appear in the bank file." — applied here as a
--       HARD requirement (not the salary-transfer kill switch from 1760's sibling change),
--       because every row in this table is, by definition, a leaver.
--
-- WHY NEW TABLES, NOT A REUSE OF salary_transfer_batch/salary_transfer_batch_item
--   salary_transfer_batch_item's core integrity guarantee — "no duplicate open transfer for
--   this employee" — is a generated column keyed on (run_id, employee_id, open_flag). F&F has
--   no run_id: full_final_calculation is one row per exit_request, not per monthly payroll run.
--   Faking a run_id, or widening that unique key, would either invent a value with no meaning
--   or weaken a constraint that protects real salary disbursement. Mirrors the same shape and
--   the same generated-column trick, keyed on full_final_calculation_id instead — one open F&F
--   transfer per settlement, which is the actual invariant that matters here.
--
--   Conflating F&F and monthly salary in one ledger would also break every existing
--   reconciliation/report query built on the assumption that salary_transfer_batch_item.run_id
--   maps to a salary_prep_run — a settlement disbursement running through that path would
--   either need a fabricated run or corrupt that assumption for every other reader.
--
--   Precedent: payroll_arrears_payment (1692) is the established pattern in this codebase for
--   "a genuinely distinct disbursement type gets its own ledger, not a repurposed one."
--
-- Additive only. No existing table is altered.

CREATE TABLE IF NOT EXISTS fnf_transfer_batch (
  id CHAR(36) NOT NULL PRIMARY KEY,
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
  UNIQUE KEY uq_fnf_transfer_batch_number (batch_number),
  KEY idx_fnf_transfer_batch_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fnf_transfer_batch_item (
  id CHAR(36) NOT NULL PRIMARY KEY,
  batch_id CHAR(36) NOT NULL,
  -- The settlement this line pays, not the exit_request — full_final_calculation is the row
  -- that actually carries net_payable, and exit_request_id is already UNIQUE on that table, so
  -- either key identifies the same settlement uniquely. full_final_calculation_id is used
  -- directly so this table needs no join through exit_request to find its own amount of record.
  full_final_calculation_id CHAR(36) NOT NULL,
  exit_request_id CHAR(36) NOT NULL,
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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Same generated-column trick as salary_transfer_batch_item.open_flag, keyed on the
  -- settlement instead of (run_id, employee_id): NULL for every terminal/rejected row (MySQL
  -- unique indexes treat each NULL as distinct), exactly 1 for a row currently
  -- exported-awaiting-result or already confirmed. DB-enforced "no duplicate open transfer for
  -- this settlement" instead of an application race.
  open_flag TINYINT GENERATED ALWAYS AS (CASE WHEN status IN ('exported','confirmed') THEN 1 ELSE NULL END) STORED,
  UNIQUE KEY uq_fnf_transfer_open (full_final_calculation_id, open_flag),
  KEY idx_fnf_transfer_item_batch (batch_id),
  KEY idx_fnf_transfer_item_employee (employee_id),
  KEY idx_fnf_transfer_item_ffc (full_final_calculation_id),
  KEY idx_fnf_transfer_item_status (status),
  CONSTRAINT fk_fnf_transfer_item_batch FOREIGN KEY (batch_id) REFERENCES fnf_transfer_batch(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Re-uploading the same Transfer Number Update File must be a no-op, not a second round of
-- confirmations — same reasoning and same shape as salary_transfer_import (1754).
CREATE TABLE IF NOT EXISTS fnf_transfer_import (
  id CHAR(36) NOT NULL PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  file_sha256 CHAR(64) NOT NULL,
  row_count INT NOT NULL,
  matched_count INT NOT NULL,
  unmatched_count INT NOT NULL,
  uploaded_by CHAR(36) NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fnf_transfer_import_checksum (file_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
