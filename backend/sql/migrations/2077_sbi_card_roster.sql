-- Migration 2077: SBI Card Collections -- agent roster (dialer id -> person, team, team leader)
-- Purpose: the day-end export names agents by DIALER ID only (AGENT1_ID ... AGENT6_ID). The roster ("TEAM_LIST" sheet of the Agent MIS
-- workbook) maps each dialer id to the person, the team (HIGHBAL / LOWBAL) and the team leader, so attempts and outcomes can be read per
-- agent, per team and per team leader, and so high-balance accounts can be checked against the agents who are meant to work them.
-- One row per dialer id, refreshed by re-uploading (upsert). Additive and idempotent: one new table and one upload template.

CREATE TABLE IF NOT EXISTS sbi_card_roster (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  dialer_id VARCHAR(20) NOT NULL,
  employee_id VARCHAR(30) NULL,
  agent_name VARCHAR(150) NULL,
  gh VARCHAR(30) NULL,
  team VARCHAR(50) NULL,
  team_leader VARCHAR(150) NULL,
  mode VARCHAR(30) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sbi_card_roster (process_id, dialer_id),
  KEY idx_sbi_card_roster_team (process_id, team)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'SBI_CARD_ROSTER';
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'SBI_CARD_ROSTER', 'SBI Card -- Agent roster (dialer id, team, team leader)', 'sbi_card_roster',
   'SBI Card Collections agent roster: the TEAM_LIST sheet of the Agent MIS workbook. One row per DIALER ID with the employee, name, team (HIGHBAL / LOWBAL) and team leader. Column order and header spelling may vary; the upload log records what was assumed. Re-uploading refreshes the row for each dialer id.',
   JSON_ARRAY(),
   JSON_ARRAY('DIALER ID', 'Employee ID', 'Name', 'GH', 'TEAM', 'TEAM LEADER', 'MODE'),
   JSON_OBJECT('DIALER ID', '1026', 'Employee ID', '600008659', 'Name', 'Riya Kumari', 'GH', '600008659', 'TEAM', 'HIGHBAL', 'TEAM LEADER', 'Sourabh Kumar'),
   1);
