-- TPZ Process (Process Performance V2) access grants.
--
-- Until now the TPZ page was reachable only by a fixed list of roles, and every process on it (Bellavita, Dalmia,
-- Neemans ...) was visible to all of them. These two tables let an admin give ANY user access to the page, narrowed to
-- chosen processes and/or branches, and decide separately whether that user may use the uploaders and download MIS.
--
--   tpz_user_access   one row per user who has TPZ settings. `restrict_to_grants` = 1 narrows a user who would otherwise
--                     see everything through their role (manager, ceo, ...) down to exactly their grants. Default 0 keeps
--                     every existing role-based user exactly as they are today.
--   tpz_access_grant  what the user may open. scope_type:
--                       all      every TPZ process
--                       company  one TPZ process (company_key, e.g. 'bellavita')
--                       branch   every TPZ process mapped to that branch (process_master.branch_id)
--                     can_dashboards / can_upload / can_mis are independent switches per grant.
--
-- Enforcement is in the API (tpz-access.middleware.ts), not only in the UI. ADDITIVE ONLY: two new tables, nothing
-- existing is touched, and until rows exist nobody's access changes.
CREATE TABLE IF NOT EXISTS tpz_user_access (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  restrict_to_grants TINYINT(1) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tpz_access_grant (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  scope_type ENUM('all','company','branch') NOT NULL,
  company_key VARCHAR(40) NULL,
  branch_id CHAR(36) NULL,
  -- 'all' | 'company:<key>' | 'branch:<id>' -- one row per user per scope (NULLs cannot carry a UNIQUE key).
  scope_key VARCHAR(90) NOT NULL,
  can_dashboards TINYINT(1) NOT NULL DEFAULT 1,
  can_upload TINYINT(1) NOT NULL DEFAULT 0,
  can_mis TINYINT(1) NOT NULL DEFAULT 0,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tpz_access_grant_scope (user_id, scope_key),
  KEY idx_tpz_access_grant_user (user_id, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
