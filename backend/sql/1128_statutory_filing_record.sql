-- 1128_statutory_filing_record.sql
--
-- Creates the table behind /api/payroll/statutory-filing, which has never
-- existed, so every endpoint on that router has always returned 500.
--
-- WHY IT NEVER EXISTED
--
-- payroll-statutory-filing.routes.ts creates the table lazily on first use via
-- ensureTable(), and that DDL cannot execute. MySQL 8.0 requires a functional
-- key part to be wrapped in its own parentheses; the shipped definition wrote
--
--   UNIQUE KEY uk_sfr_month_type_state (filing_month, filing_type, COALESCE(state_code, ''))
--
-- which is ER_PARSE_ERROR, proven against production 8.0.42 by running the exact
-- DDL as a TEMPORARY table. The call site is `await ensureTable().catch(() => {})`,
-- so the parse error was swallowed, and the query that followed failed on a table
-- that was never created. The initialise endpoint compounded it: its per-row
-- INSERT sits in `catch { skipped++ }`, so a completely absent table reported
-- created=0, skipped=6 — a success shape for an operation that did nothing.
--
-- Nothing was lost. There is no data to migrate: the table has never held a row.
--
-- WHAT THIS TRACKS
--
-- One row per statutory filing obligation per month: EPF and ESIC (15th of the
-- following month), PT (10th), TDS 24Q/138 (7th), LWF (15th), with challan
-- number, challan date, amount and filed/pending/overdue status. It is the
-- compliance trail for filings the company is legally required to make, which is
-- why it is worth fixing rather than deleting.
--
-- THE FIX
--
-- The functional key part is parenthesised, which 8.0.13+ accepts. COALESCE is
-- kept rather than switching state_code to NOT NULL DEFAULT '': the routes insert
-- national filings without naming state_code at all, so it must stay nullable,
-- and the expression is what stops two rows for the same month+type when the
-- state is NULL (a plain UNIQUE key does not collide NULLs, so INSERT IGNORE
-- would not dedupe). Both variants were verified to create, and the dedupe
-- behaviour was confirmed by inserting the same national filing twice.
--
-- Idempotent: IF NOT EXISTS, and additive — it creates a new empty table and
-- touches nothing else.

CREATE TABLE IF NOT EXISTS statutory_filing_record (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()),
  filing_month    VARCHAR(7)    NOT NULL,
  filing_type     ENUM('EPF','ESIC','PT','TDS_24Q','TDS_138','LWF') NOT NULL,
  state_code      VARCHAR(10)   NULL,
  due_date        DATE          NOT NULL,
  amount_due      DECIMAL(14,2) NULL,
  challan_number  VARCHAR(100)  NULL,
  challan_date    DATE          NULL,
  filed_at        DATETIME      NULL,
  filed_by        VARCHAR(36)   NULL,
  remarks         TEXT          NULL,
  status          ENUM('pending','filed','overdue') NOT NULL DEFAULT 'pending',
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sfr_month_type_state (filing_month, filing_type, ((COALESCE(state_code, '')))),
  KEY idx_sfr_month  (filing_month),
  KEY idx_sfr_status (status),
  KEY idx_sfr_due    (due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
