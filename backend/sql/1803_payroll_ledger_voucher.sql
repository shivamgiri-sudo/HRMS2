-- 1803_payroll_ledger_voucher.sql
--
-- WHY
-- Owner-confirmed 2026-09-17: the ~39,099 historical grn_type='salary' GRN rows (2018-2021,
-- ~Rs 39.3 Cr) are closed history and are never journal-posted (see 6260310a). The REAL
-- payroll->ledger posting is a separate, purpose-built path off salary-voucher.service.ts's
-- already-correct Tally voucher model (Gross Salary Dr / Salary+Statutory+TDS Payable Cr,
-- balanced as a plug) — this migration lays the two pieces that path needs:
--
-- 1. A payroll_ledger_voucher row per (run x branch) voucher, giving each one a real UUID to
--    use as journal_entry.source_id — journal_entry has no source_type='payroll' table of its
--    own the way 'grn'/'payment_voucher' do, and every other source_type in this ledger
--    references a REAL row's real primary key (see 1789_journal_entry.sql's own comment on
--    source_id), not a synthesized composite string. The UNIQUE KEY on (run_id, branch_id) is
--    the idempotency guard: one posting per voucher, ever — matching "journal_entry has no
--    UPDATE path" and payroll's own "NOTHING HERE RECALCULATES PAYROLL" philosophy. A wrong
--    posting is corrected with journalService.reverse(), never a second post.
--
-- 2. Two new sub-heads under the EXISTING active "Salary & Workman Compensation" expense head
--    (finance_expense_head_master.head_code='SALARY_WORKMAN_COMP') — that head has zero
--    sub-heads today, which is why every salary-type GRN already fails EXPENSE_LEDGER_NOT_FOUND
--    were it ever posted (it isn't, per above). "Gross Salary" carries the plug debit line;
--    "Employer Statutory Contribution" carries the combined Employer PF + Employer ESIC + EPF
--    Admin Charges debit lines. Both distinct from the old DSC/Agent/BMC/FOS cohort sub-heads
--    1060_sync_expense_heads_from_db_bill.sql seeded for the legacy GRN structure — this is a
--    different shape (Tally voucher lines, not cohort buckets) and reuses only the parent head.

SET @has_table = (
  SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_ledger_voucher'
);
SET @sql = IF(@has_table = 0,
  "CREATE TABLE payroll_ledger_voucher (
     id               CHAR(36)      NOT NULL,
     run_id           CHAR(36)      NOT NULL COMMENT 'salary_prep_run.id',
     branch_id        CHAR(36)      NOT NULL,
     company_code     VARCHAR(20)   NOT NULL,
     voucher_no       VARCHAR(80)   NOT NULL,
     period           VARCHAR(7)    NOT NULL COMMENT 'YYYY-MM',
     total_debit      DECIMAL(18,2) NOT NULL,
     total_credit     DECIMAL(18,2) NOT NULL,
     journal_entry_id CHAR(36)      NOT NULL,
     posted_by        CHAR(36)      NOT NULL,
     posted_at        DATETIME      NOT NULL,
     created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uq_plv_run_branch (run_id, branch_id),
     UNIQUE KEY uq_plv_voucher_no (voucher_no),
     INDEX idx_plv_journal_entry (journal_entry_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  "SELECT 'payroll_ledger_voucher already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- journal_entry.source_type is a real ENUM (1789_journal_entry.sql) and needs 'payroll' added
-- before journalService.post() can write one — same guarded MODIFY COLUMN idiom as
-- 1741_bank_ledger_direct_source_types.sql.
SET @db := DATABASE();
SET @sql := (
  SELECT IF(
    COLUMN_TYPE NOT LIKE '%''payroll''%',
    "ALTER TABLE journal_entry MODIFY COLUMN source_type ENUM('grn','payment_voucher','bank_reconciliation_adjustment','imprest','manual','payroll') NOT NULL",
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'journal_entry' AND COLUMN_NAME = 'source_type'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @head_id = (
  SELECT id FROM finance_expense_head_master WHERE head_name = 'Salary & Workman Compensation' LIMIT 1
);

SET @has_gross_salary_subhead = (
  SELECT COUNT(*) FROM finance_expense_sub_head_master
   WHERE head_id = @head_id AND sub_head_name = 'Gross Salary'
);
INSERT INTO finance_expense_sub_head_master (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), @head_id, 'SALARY_GROSS', 'Gross Salary', 70, 1
 WHERE @head_id IS NOT NULL AND @has_gross_salary_subhead = 0;

SET @has_employer_contrib_subhead = (
  SELECT COUNT(*) FROM finance_expense_sub_head_master
   WHERE head_id = @head_id AND sub_head_name = 'Employer Statutory Contribution'
);
INSERT INTO finance_expense_sub_head_master (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), @head_id, 'SALARY_EMPLOYER_STATUTORY', 'Employer Statutory Contribution', 80, 1
 WHERE @head_id IS NOT NULL AND @has_employer_contrib_subhead = 0;

-- Verification:
-- SHOW TABLES LIKE 'payroll_ledger_voucher';
-- SELECT sub_head_name FROM finance_expense_sub_head_master sh
--   JOIN finance_expense_head_master h ON h.id = sh.head_id
--  WHERE h.head_name = 'Salary & Workman Compensation';  -- expect Gross Salary, Employer Statutory Contribution
