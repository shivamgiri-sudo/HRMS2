-- Migration 2185: GS1 per-item roll-up columns (GS1-01..05 dashboard rebuild).
--
-- The GS1 Email and Data Card uploads are raw per-ticket / per-task logs that the importers
-- collapse into one row per analyst per day. The collapse threw away the per-item fields the
-- dashboard now needs: Email "Status" (closure / pending), Email "SLA" bucket labels, Email
-- "Type Of Query", Data Card completion and "Category", and both sheets' "Duration". These
-- columns keep those as per-day counts so the dashboard can show status mix, SLA bucket
-- distribution and average handling time without storing every raw row.
--
-- tat_known_count separates "no TAT signal in the source" from "0% within TAT": within_tat
-- defaulted to 0 when the source TAT column was blank, so 0 was ambiguous. Rows written before
-- this migration keep NULL here and the dashboard treats within_tat = 0 with NULL count as
-- unknown (shown as N/A), without rewriting existing data.
--
-- Purely additive and nullable; existing rows read as "not captured" until re-uploaded.

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gs1_email_daily_actual' AND COLUMN_NAME = 'status_counts') = 0,
  'ALTER TABLE gs1_email_daily_actual ADD COLUMN status_counts JSON NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gs1_email_daily_actual' AND COLUMN_NAME = 'sla_bucket_counts') = 0,
  'ALTER TABLE gs1_email_daily_actual ADD COLUMN sla_bucket_counts JSON NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gs1_email_daily_actual' AND COLUMN_NAME = 'query_type_counts') = 0,
  'ALTER TABLE gs1_email_daily_actual ADD COLUMN query_type_counts JSON NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gs1_email_daily_actual' AND COLUMN_NAME = 'duration_known_count') = 0,
  'ALTER TABLE gs1_email_daily_actual ADD COLUMN duration_known_count INT NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gs1_datakart_daily_actual' AND COLUMN_NAME = 'completed_count') = 0,
  'ALTER TABLE gs1_datakart_daily_actual ADD COLUMN completed_count INT NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gs1_datakart_daily_actual' AND COLUMN_NAME = 'category_counts') = 0,
  'ALTER TABLE gs1_datakart_daily_actual ADD COLUMN category_counts JSON NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gs1_datakart_daily_actual' AND COLUMN_NAME = 'tat_known_count') = 0,
  'ALTER TABLE gs1_datakart_daily_actual ADD COLUMN tat_known_count INT NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gs1_datakart_daily_actual' AND COLUMN_NAME = 'duration_known_count') = 0,
  'ALTER TABLE gs1_datakart_daily_actual ADD COLUMN duration_known_count INT NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
