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

ALTER TABLE statutory_filing_record
  MODIFY COLUMN filing_type
    ENUM('EPF','ESIC','PT','TDS_24Q','TDS_138','LWF') NOT NULL;
