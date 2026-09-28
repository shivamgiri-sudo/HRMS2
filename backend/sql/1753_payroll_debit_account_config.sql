-- Payroll debit account config — replaces the hardcoded '033005005852' literal that was
-- duplicated in payroll.executor.ts (bankAdvice + neftTransferFile), the company's own
-- ICICI account used to debit every NEFT/bank-advice payment file.
--
-- Single-row config table (id is always 1) rather than a generic key/value settings table,
-- because this value is read on every bank-file export and a dedicated table keeps the read
-- a plain PK lookup. Seeded with the exact value the two executors previously hardcoded, so
-- applying this migration changes nothing about what any existing export produces.
CREATE TABLE IF NOT EXISTS payroll_debit_account_config (
  id INT NOT NULL PRIMARY KEY,
  debit_account_number VARCHAR(34) NOT NULL,
  bank_name VARCHAR(100) NULL,
  updated_by CHAR(36) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_payroll_debit_account_config_single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO payroll_debit_account_config (id, debit_account_number, bank_name)
VALUES (1, '033005005852', 'ICICI Bank')
ON DUPLICATE KEY UPDATE id = id;
