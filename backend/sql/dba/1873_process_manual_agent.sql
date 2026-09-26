-- Agents added by hand on the Process Details page (Housing Owner and Housing Premium), without re-uploading the roster.
--
-- The dashboards read their agent roster from the upload tables (owner_agent_details / pre_agent_details). An agent added here is
-- merged into that roster at read time -- the uploaded tables are never modified, and an uploaded agent with the same name always wins.
-- A manual agent takes part in every roster-driven figure (headline, TL/AM/Center totals, agent tables, TQ/MQ/BQ, targets) from
-- effective_from onwards, and can carry its own target override like any other agent.
--
-- Run by someone with CREATE on db_masmis (the application user only has SELECT/INSERT/UPDATE/DELETE there), so this file is deliberately
-- NOT registered in runPendingMigrations.ts. Every add / edit / remove is written to audit_action_log (mas_hrms) by the API.
-- Additive only (CREATE TABLE IF NOT EXISTS); safe to re-run. No seed rows.

CREATE TABLE IF NOT EXISTS db_masmis.process_manual_agent (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_key      VARCHAR(40)  NOT NULL,                       -- housing_owner | housing_premium
  agent_name       VARCHAR(255) NOT NULL,                       -- whitespace-normalised; same spelling as on the sale / CDR uploads
  emp_id           VARCHAR(50)  NULL,
  tl_name          VARCHAR(255) NOT NULL,
  group_name       VARCHAR(255) NOT NULL,                       -- AM (Housing Owner) / Center (Housing Premium)
  status           VARCHAR(20)  NOT NULL DEFAULT 'Active',      -- Active | InActive (only Active agents count in targets)
  doj              DATE NULL,
  monthly_target   DECIMAL(14,2) NOT NULL DEFAULT 0,            -- baseline monthly target (a target override can still replace it)
  effective_from   CHAR(7)      NOT NULL,                       -- YYYY-MM, the agent exists from this month onwards
  created_by       VARCHAR(100) NULL,
  updated_by       VARCHAR(100) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_manual_agent (process_key, agent_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
