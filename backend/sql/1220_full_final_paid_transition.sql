-- Migration 1220: record who paid a full & final settlement, and when
--
-- WHY
-- full_final_calculation.status is enum('draft','verified','approved','paid'), but 'paid' has
-- never been reachable: ff.service.ts's only status write is `SET status = 'approved'`.
-- Verified live 2026-08-15 — the table holds rows in 'draft' and nothing has ever been 'paid'.
--
-- Two things break as a result:
--   1. FF_PAID_BUT_EMPLOYEE_ACTIVE, a check the system labels P0, queries `status = 'paid'`.
--      It therefore cannot fail, and reported a clean pass on a control that had never once
--      been evaluated. (That check now reports SOURCE_MISSING instead — a separate change —
--      but the honest fix is to make the state reachable.)
--   2. Nothing anywhere records that a settlement was actually disbursed. approved_by /
--      approved_at exist; there is no paid_by, paid_at, or payment reference. The state was
--      not merely unwritten, it was unrecordable.
--
-- WHAT THIS DOES
-- Adds the three columns needed to record the payment, and nothing else. No status value is
-- changed, no row is touched, no behaviour changes on apply. All three are nullable, so every
-- existing row is valid as-is.
--
--   ff_paid_by          who recorded the payment (auth_user.id, matching approved_by's shape)
--   ff_paid_at          when
--   ff_payment_reference the bank/UTR/cheque reference — the evidence that it happened
--
-- DELIBERATELY NOT IN THIS FILE: the workflow itself. Who may mark a settlement paid, and
-- whether a payment reference is mandatory, are policy decisions for the payroll/finance
-- owner, not something a migration should encode. This file only makes the state recordable;
-- ff.service.ts's markFfPaid enforces the rules, and those rules are reviewable in one place.
--
-- Columns are guarded individually through information_schema + PREPARE rather than one
-- multi-column ALTER: MySQL 8.0.42 rejects MariaDB's `ADD COLUMN IF NOT EXISTS` with
-- ER_PARSE_ERROR, and a multi-column ALTER is all-or-nothing (509_portal_client_master_fixes
-- lost its tail exactly that way). Idempotent — re-running is a no-op.

-- ff_paid_by ------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'full_final_calculation'
     AND COLUMN_NAME = 'ff_paid_by'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE full_final_calculation ADD COLUMN ff_paid_by CHAR(36) NULL',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ff_paid_at ------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'full_final_calculation'
     AND COLUMN_NAME = 'ff_paid_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE full_final_calculation ADD COLUMN ff_paid_at DATETIME NULL',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ff_payment_reference --------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'full_final_calculation'
     AND COLUMN_NAME = 'ff_payment_reference'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE full_final_calculation ADD COLUMN ff_payment_reference VARCHAR(100) NULL',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
