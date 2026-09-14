-- Lets a data source read a date that is stored as text.
--
-- WHY
-- ---
-- Real client tables keep dates as varchar far more often than not. The one that
-- prompted this is db_masmis.bvo_order_export: 3,050,861 order rows whose
-- order_date is "01-01-2025" -- DD-MM-YYYY in a varchar column. That table holds
-- financial_status ('paid' vs 'COD') and total, which is exactly the source for
-- Prepaid % and Net Revenue, two metrics kpi-metric-registry.ts currently marks
-- not_tracked with the note that they are "not computed anywhere".
--
-- Without this the table cannot be used at all, and the failure is silent rather
-- than loud: the query builder compares `order_date >= '2026-08-01'` as STRINGS,
-- so "01-01-2025" sorts after it and a month filter returns a confident, wrong
-- set of rows. Nothing errors. That is the same class of defect as the Excel
-- M/D/YY import that destroyed 900 regularization rows.
--
-- WHAT IT ADDS
-- ------------
-- One nullable column naming the format the text is in. When set, the query
-- builder wraps the column in STR_TO_DATE(col, '<format>') everywhere it uses
-- the date -- the SELECT, both WHERE bounds and the GROUP BY -- so a text date
-- behaves exactly like a real one.
--
-- The value is not free text. It is validated against a fixed list in
-- kpi-studio.sources.ts before it can reach SQL, because a format string is
-- interpolated rather than bound, and the UI offers that same list as a dropdown
-- (this repository's Form Input Rule: a closed set is never an Input).
--
-- SAFETY: additive, nullable, no backfill. A source that leaves it NULL behaves
-- exactly as before. information_schema-guarded, because MariaDB's
-- ADD COLUMN IF NOT EXISTS is a syntax error on MySQL 8.

SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'kpi_studio_data_source'
              AND column_name = 'date_format');
SET @ddl := IF(@c = 0,
  'ALTER TABLE kpi_studio_data_source ADD COLUMN date_format VARCHAR(32) NULL COMMENT ''STR_TO_DATE format when the date column is text, e.g. %d-%m-%Y. NULL means the column is already a real date.'' AFTER date_column',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
