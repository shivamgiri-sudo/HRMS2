-- Housing Owner's own "Incentive" sheet -- found while auditing the same
-- real workbook downloaded this session for Sale Raw/Call Logs
-- ("Housing Owner Jul'26.xlsb", the shared MIS staging folder's own copy),
-- not covered by db_masmis.CR_housing_owner or anything else found on
-- this host: per-agent monthly target/achievement/incentive payout data,
-- 96 real agent rows.
--
-- The source is significantly corrupted: 68 of 96 rows have at least one
-- broken-formula cell (stored as literal Excel error byte codes -- "0x17"
-- = #REF!, "0x2a" = #N/A -- rather than a value), mostly in the financial
-- breakdown columns, not the agent identity. Per the user's explicit
-- decision (asked directly rather than guessed), only the clean cells are
-- imported: every real agent row is kept, but any individual cell that is
-- an error code is stored as NULL rather than the literal error text or a
-- guessed value. Agent Name is clean in all 96 real rows and is this
-- table's identity, together with the workbook's own reporting period
-- (this file has no per-row date -- it is a single monthly snapshot, and
-- its own header row's month label is unreliable: it says "Mar" despite
-- being inside a workbook named "Jul'26", so the file's own period is
-- used instead, not the stale label).
--
-- Two sibling client-facing sheets ("Client Incetive", "Incentive Client
-- Format") were checked and found far more corrupted (most rows have
-- errors in half their columns, including the Band/TL Name identity-
-- adjacent fields) -- skipped in favour of this internal sheet, which is
-- the cleaner source for the same underlying figures.
CREATE TABLE IF NOT EXISTS housing_owner_incentive_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_period VARCHAR(7) NOT NULL COMMENT 'YYYY-MM, from the workbook''s own filename, not its unreliable in-sheet month label',
  agent_name VARCHAR(255) NOT NULL,
  band VARCHAR(50) NULL,
  partner_name VARCHAR(100) NULL,
  team_leader VARCHAR(255) NULL,
  total_target_no_gst DECIMAL(14,2) NULL,
  total_revenue_no_gst DECIMAL(14,2) NULL,
  achievement_pct DECIMAL(8,4) NULL,
  stage VARCHAR(50) NULL,
  status VARCHAR(50) NULL,
  target_with_gst DECIMAL(14,2) NULL,
  sale_value_with_gst DECIMAL(14,2) NULL,
  achieved_pct DECIMAL(8,4) NULL,
  monthly_incentive DECIMAL(14,2) NULL,
  week1_target DECIMAL(14,2) NULL,
  week1_achievement DECIMAL(14,2) NULL,
  week1_achi_pct DECIMAL(8,4) NULL,
  week1_min_earning DECIMAL(14,2) NULL,
  week2_target DECIMAL(14,2) NULL,
  week2_achievement DECIMAL(14,2) NULL,
  week2_achi_pct DECIMAL(8,4) NULL,
  week2_min_earning DECIMAL(14,2) NULL,
  week3_target DECIMAL(14,2) NULL,
  week3_achievement DECIMAL(14,2) NULL,
  week3_achi_pct DECIMAL(8,4) NULL,
  week3_min_earning DECIMAL(14,2) NULL,
  final_incentive DECIMAL(14,2) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_housing_owner_incentive_raw (process_id, agent_name, report_period, source_reference),
  KEY idx_housing_owner_incentive_raw_period (process_id, report_period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'HOUSING_OWNER_INCENTIVE';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'HOUSING_OWNER_INCENTIVE', 'Housing Owner — Incentive', 'housing_owner_incentive_raw',
   'Per-agent monthly target/achievement/incentive payout, per Housing Owner''s own Incentive sheet (no DB backing exists; source is partially corrupted -- broken cells are dropped, not guessed).',
   JSON_ARRAY('Agent Name', 'Report_Period'),
   JSON_ARRAY('Band', 'Partner Name', 'Team leader', 'Total Target Without GST', 'Total Revenue without GST', 'Achievement %', 'Stage', 'Status', 'Target With GST', 'Sale Value with GST', 'Achieved %', 'Monthly incentive', 'Final'),
   JSON_OBJECT('Agent Name', 'Aditi MCN', 'Report_Period', '2026-07', 'Band', 'Band B', 'Partner Name', 'MascallNet', 'Team leader', 'Sameer AM', 'Total Target Without GST', 160000, 'Status', 'Active'),
   1);
