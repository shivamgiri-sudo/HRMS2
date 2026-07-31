-- Quarterly salary TDS statement under the Income-tax Act, 2025.
--
-- WHY
-- ---
-- The Income-tax Act, 2025 commenced on 1 April 2026 and renumbered the TDS
-- forms. The quarterly salary TDS statement, Form 24Q under the 1961 Act, is
-- Form 138 from tax year 2026-27. The rates did not change; the form did.
--
-- statutory_filing_record.filing_type is an ENUM created inline by
-- payroll-statutory-filing.routes.ts, so a CREATE TABLE IF NOT EXISTS will not
-- widen it on a database where the table already exists. This migration does.
--
-- ADDITIVE ON PURPOSE
-- -------------------
-- TDS_24Q is retained rather than renamed. Rows already filed under the 1961
-- Act were Form 24Q filings and must keep saying so — a filing record is
-- evidence of what was submitted, not a label to be rewritten when the statute
-- changes. New periods select TDS_138 via quarterlyTdsFilingType(); both remain
-- valid values.
--
-- The ENUM is widened, never narrowed, so every existing row stays legal and
-- this is safe to re-run.

-- GUARDED BECAUSE THE TABLE MAY NOT EXIST YET
-- ------------------------------------------
-- statutory_filing_record is created lazily, inline, by
-- payroll-statutory-filing.routes.ts on first use — so on a database where that
-- route has never run, the table is absent and a bare ALTER fails with
-- ER_NO_SUCH_TABLE. That is not hypothetical: production has no such table
-- today. An unguarded ALTER would abort the migration run and, with
-- STOP_ON_FIRST_FAILURE, block every migration queued behind it.
--
-- Where the table is absent this is a no-op, and correctly so: the inline
-- CREATE TABLE already declares the widened ENUM including TDS_138, so a
-- database that creates the table later gets the right shape without this file.
-- Where the table does exist and predates the 2025 Act, the ENUM is widened.
-- Either way the outcome is the same column definition.

SET @stmt = (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'statutory_filing_record') > 0,
    'ALTER TABLE statutory_filing_record MODIFY COLUMN filing_type ENUM(''EPF'',''ESIC'',''PT'',''TDS_24Q'',''TDS_138'',''LWF'') NOT NULL',
    'DO 0'
  )
);
PREPARE s FROM @stmt;
EXECUTE s;
DEALLOCATE PREPARE s;
