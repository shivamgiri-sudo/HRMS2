-- 1141_payroll_bank_exception.sql
--
-- Creates payroll_bank_exception, the workflow overlay behind the Bank Payment Readiness page
-- (/payroll/bank-readiness). One row per employee whose bank record currently blocks payment,
-- recording WHO OWNS the exception, its workflow status and any note.
--
-- WHAT IT DELIBERATELY DOES NOT STORE
--   The readiness class itself. MISSING / INVALID / CONFLICT / PENDING_APPROVAL / BLOCKED /
--   READY are recomputed from live data on every request by bank-payment-readiness.service.ts.
--   Storing a snapshot would let this table keep asserting "MISSING" after HR fixed the record,
--   and the page would show two different answers depending on which half you read — the exact
--   failure shape salary_prep_run.total_employees already has in this database, where it is
--   wrong in both directions and has misled work here before. The overlay is the only thing a
--   human authors, so the overlay is the only thing persisted.
--
--   It also stores no account number, masked or otherwise. The account lives in
--   employee_bank_detail; a second copy here would be a second thing to encrypt, rotate and
--   scrub, for a table whose purpose is workflow state.
--
-- COLLATION IS EXPLICIT AND THAT MATTERS
--   employee_id is joined against employees.id, which is char(36) utf8mb4_unicode_ci. The
--   server default on this instance is utf8mb4_0900_ai_ci, so a CREATE TABLE without an explicit
--   COLLATE produces a table whose first join to employees fails with errno 3780 /
--   ER_CANT_AGGREGATE_2COLLATIONS. Verified live 2026-08-13: employees, auth_user and
--   employee_bank_detail are all utf8mb4_unicode_ci. Same trap 1135_mira_fix_draft.sql documents.
--
-- NO FOREIGN KEYS
--   Matches the surrounding style (work_item, payroll_bank_* siblings index rather than
--   constrain). An FK to employees would also make this table a participant in employee
--   deletion, which it has no business blocking — an orphaned exception row is harmless and is
--   filtered out by the join in loadOverlay() anyway.
--
-- UNIQUE KEY ON employee_id
--   The PATCH endpoint is an INSERT ... ON DUPLICATE KEY UPDATE keyed on it, so without this
--   constraint every PATCH would append a new row and the page would show the first one written
--   rather than the latest. Not optional.
--
-- Additive: creates one new empty table, touches nothing existing. CREATE TABLE IF NOT EXISTS,
-- so re-running is a no-op.

CREATE TABLE IF NOT EXISTS payroll_bank_exception (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  employee_id      CHAR(36)     NOT NULL,
  owner_user_id    CHAR(36)     NULL COMMENT 'auth_user.id of the person accountable for clearing this exception',
  workflow_status  VARCHAR(30)  NOT NULL DEFAULT 'open'
                   COMMENT 'open | in_progress | awaiting_employee | resolved | waived — VARCHAR not ENUM so a sixth state does not need a migration',
  notes            TEXT         NULL,
  created_by       CHAR(36)     NULL,
  updated_by       CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_bank_exception_employee (employee_id),
  KEY idx_payroll_bank_exception_owner  (owner_user_id),
  KEY idx_payroll_bank_exception_status (workflow_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1141_payroll_bank_exception.sql applied' AS migration_status;

-- Rollback:
--   DROP TABLE IF EXISTS payroll_bank_exception;
--   (safe — the table holds only workflow annotations; no payment or bank data lives here)
