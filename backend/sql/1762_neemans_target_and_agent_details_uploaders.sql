-- No CREATE TABLE here. Registers upload_template_master entries for 2 new
-- Neemans upload types, per explicit user request to round out the Neemans
-- process alongside the existing sql/1746 trio (Sale Raw/Allocation/APR).
-- Both target tables confirmed ALREADY LIVE on db_masmis via SHOW COLUMNS:
-- neemans_month_targets (2 rows, month UNIQUE key -- upsert by month, see
-- neemans-month-target-bulk.service.ts) and nms_Agent_Details (22 rows, no
-- unique key -- plain insert-only, same convention as every other table in
-- this family). Neither has a known real Excel export to mirror (small
-- internal admin/roster sheets, not system-generated reports), so these
-- required/optional_columns are a best-effort guess pending a real sample,
-- same caveat documented in each service file's own header comment.
--
-- DELETE-then-INSERT, same idempotent pattern as sql/1746/1747/1761 (no
-- assumption of a UNIQUE index on upload_type_code).
DELETE FROM upload_template_master WHERE upload_type_code IN (
  'NEEMANS_MONTH_TARGET_MASMIS', 'NEEMANS_AGENT_DETAILS_MASMIS'
);

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'NEEMANS_MONTH_TARGET_MASMIS', 'Neemans — Monthly Target (writes to db_masmis.neemans_month_targets)', 'db_masmis.neemans_month_targets',
   'Neemans'' monthly revenue target -- upserts into the same live table My Dashboards already uses. One row per month (month is the upsert key).',
   JSON_ARRAY('Month', 'Target'),
   JSON_ARRAY(),
   JSON_OBJECT('Month', '2026-07', 'Target', '7000000'),
   1),
  (UUID(), 'NEEMANS_AGENT_DETAILS_MASMIS', 'Neemans — Agent Details (writes to db_masmis.nms_Agent_Details)', 'db_masmis.nms_Agent_Details',
   'Neemans'' agent roster -- writes into the same live table My Dashboards already uses. Insert-only, no dedup key (matches the live table).',
   JSON_ARRAY('Emp ID', 'Name'),
   JSON_ARRAY('DialDesk ID', 'LOB', 'TL', 'DOJ', 'FHD', 'Status', 'DOL', 'Monthly Target'),
   JSON_OBJECT('Emp ID', 'MAS62995', 'Name', 'Jiya', 'LOB', 'Cart', 'TL', 'Sachin Rawat'),
   1);
