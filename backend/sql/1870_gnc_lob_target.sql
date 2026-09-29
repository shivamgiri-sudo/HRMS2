-- GNC LOB monthly revenue targets (editable from Process Performance V2 > GNC > Targets).
--
-- Before this, no GNC target source existed anywhere in the app (gnc_sale.target is
-- a sparse per-row int that is NOT a quota -- see gnc-sale-dashboard.service.ts), so
-- the GNC dashboards showed no Target / Achievement %. These targets are supplied by
-- the business and are edited, never inferred:
--   Inbound        Rs 1,30,000 per agent per month  x 7 agents  = Rs  9,10,000
--   Chat           Rs 1,80,000 per agent per month  x 5 agents  = Rs  9,00,000
--   Abandon Cart   Rs 53,76,000 per month (fixed for the LOB)
--
-- Effective-dated: a row applies from its effective_month until a later row for the same
-- LOB supersedes it, so changing a target next month never rewrites history.
-- Every edit is written to the central audit_action_log by the API (module process-performance).
-- Additive only (CREATE TABLE IF NOT EXISTS + INSERT IGNORE); safe to re-run.

CREATE TABLE IF NOT EXISTS gnc_lob_target (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lob              VARCHAR(40)  NOT NULL,                       -- gnc_sale.campaign: Inbound | Chat | Abandon Cart
  effective_month  CHAR(7)      NOT NULL,                       -- YYYY-MM, applies from this month onwards
  target_basis     ENUM('per_agent','fixed') NOT NULL,
  per_agent_target DECIMAL(14,2) NULL,                          -- Rs per agent per month (basis = per_agent)
  agent_count      INT UNSIGNED NULL,                           -- agents the target is set for (per_agent: required; fixed: optional split)
  fixed_target     DECIMAL(14,2) NULL,                          -- Rs per month for the whole LOB (basis = fixed)
  created_by       VARCHAR(100) NULL,
  updated_by       VARCHAR(100) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gnc_lob_target (lob, effective_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the three targets the business supplied, effective from September 2026.
INSERT IGNORE INTO gnc_lob_target (lob, effective_month, target_basis, per_agent_target, agent_count, fixed_target, created_by, updated_by)
VALUES
  ('Inbound',      '2026-09', 'per_agent', 130000.00, 7, NULL,       'seed', 'seed'),
  ('Chat',         '2026-09', 'per_agent', 180000.00, 5, NULL,       'seed', 'seed'),
  ('Abandon Cart', '2026-09', 'fixed',     NULL,      NULL, 5376000.00, 'seed', 'seed');
