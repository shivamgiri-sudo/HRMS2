-- Migration 333: Ensure cost_centre_master table exists
-- Some deployment paths may not have created it yet.
-- All new; no existing tables modified.

CREATE TABLE IF NOT EXISTS cost_centre_master (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cc_code      VARCHAR(50)  NOT NULL UNIQUE,
  cc_name      VARCHAR(100) NOT NULL,
  branch_id    CHAR(36)     NULL,
  process_id   CHAR(36)     NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ccm_branch  (branch_id),
  INDEX idx_ccm_process (process_id)
);

SELECT '333_cost_centre_master_ensure.sql applied' AS migration_status;
