-- Migration 2076: SBI Card Collections -- cycle outcome (Resolution / Normalisation / Rollback) figures
-- Purpose: the payout slab is read on Resolution %, Normalisation % and Rollback % of the opening book. SBI Card reports them in its own
-- MIS; this table holds one row per report date per segment (cumulative to that date, i.e. cycle-to-date) so the Payout tab can fill itself.
-- A row carries either counts (and amounts) against an opening base, from which the percentages are derived, or the percentages as
-- SBI states them -- or both; the importer accepts any of those shapes.
-- Additive and idempotent: one new table and one upload template. Nothing existing is touched.

CREATE TABLE IF NOT EXISTS sbi_card_outcome (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  segment VARCHAR(100) NOT NULL DEFAULT 'CD3_HB',
  opening_accounts INT NULL,
  opening_amount DECIMAL(18,2) NULL,
  resolved_accounts INT NULL,
  normalised_accounts INT NULL,
  rollback_accounts INT NULL,
  resolved_amount DECIMAL(18,2) NULL,
  normalised_amount DECIMAL(18,2) NULL,
  rollback_amount DECIMAL(18,2) NULL,
  resolution_pct DECIMAL(7,3) NULL,
  normalisation_pct DECIMAL(7,3) NULL,
  rollback_pct DECIMAL(7,3) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sbi_card_outcome (process_id, report_date, segment),
  KEY idx_sbi_card_outcome_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'SBI_CARD_OUTCOME';
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'SBI_CARD_OUTCOME', 'SBI Card -- Outcome (Resolution / Normalisation / Rollback)', 'sbi_card_outcome',
   'SBI Card Collections cycle outcome, cumulative to the report date, per segment (blank Segment = CD3_HB). Give Opening Accounts with the Resolved / Normalised / Rollback counts (amounts optional), or the three percentages as SBI states them, or both. Feeds the Payout tab. Column order and header spelling may vary; the upload log records what was assumed. Re-uploading the same date + segment refreshes the row.',
   JSON_ARRAY(),
   JSON_ARRAY('Report Date', 'Segment', 'Opening Accounts', 'Opening Amount', 'Resolved Accounts', 'Normalised Accounts', 'Rollback Accounts', 'Resolved Amount', 'Normalised Amount', 'Rollback Amount', 'Resolution %', 'Normalisation %', 'Rollback %'),
   JSON_OBJECT('Report Date', '2026-09-28', 'Segment', 'CD3_HB', 'Opening Accounts', '2353', 'Resolved Accounts', '824', 'Normalised Accounts', '424', 'Rollback Accounts', '235'),
   1);
