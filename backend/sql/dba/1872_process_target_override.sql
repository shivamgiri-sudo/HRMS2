-- Editable targets at top-group, TL and agent level for the roster-driven process dashboards
-- (Process Details page): Housing Owner (group = AM) and Housing Premium (group = Center).
--
-- Until now these targets could only come from the roster upload (owner_agent_details.monthly_target /
-- pre_agent_details.target): agent targets were as uploaded and a TL's / AM's target was the sum of their
-- agents'. This table lets the business change a target at any of the three levels without re-uploading the
-- roster. The uploaded roster stays the baseline and is never modified.
--
--   level 'agent'          : that agent's monthly target
--   level 'tl'             : the TL's total monthly target (spread over the TL's agents, see the service)
--   level 'am' / 'center'  : the AM's (Owner) / Center's (Premium) total monthly target (spread over their TLs / agents)
--
-- Effective-dated by month: a row applies from effective_month until a later row for the same
-- (process, level, entity) replaces it, so a change made from October never rewrites September.
-- Every edit is written to the central audit_action_log by the API (module process-performance).
-- Run by someone with CREATE on db_masmis (the application user only has SELECT/INSERT/UPDATE/DELETE there), so this file is
-- deliberately NOT registered in runPendingMigrations.ts. The audit log stays in mas_hrms (audit_action_log).
-- Additive only (CREATE TABLE IF NOT EXISTS); safe to re-run. No seed rows.

CREATE TABLE IF NOT EXISTS db_masmis.process_target_override (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_key      VARCHAR(40)  NOT NULL,                       -- housing_owner | housing_premium
  level            ENUM('agent','tl','am','center') NOT NULL,
  entity_name      VARCHAR(255) NOT NULL,                       -- agent / TL / AM / Center name exactly as on the roster (whitespace-normalised)
  effective_month  CHAR(7)      NOT NULL,                       -- YYYY-MM, applies from this month onwards
  monthly_target   DECIMAL(14,2) NOT NULL,
  created_by       VARCHAR(100) NULL,
  updated_by       VARCHAR(100) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_target_override (process_key, level, entity_name, effective_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
