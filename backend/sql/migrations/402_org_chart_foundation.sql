-- 402_org_chart_foundation.sql
-- PeopleOS Org Navigator: org chart snapshot, audit, override and data-quality tables
-- Phase 1: Read-only org chart APIs with data-quality validation
-- IMPORTANT: Additive only, no modifications to existing tables

USE mas_hrms;

-- ── Org Chart Snapshot (optional cache for large org charts) ────────────────
CREATE TABLE IF NOT EXISTS org_chart_snapshot (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  scope_type      VARCHAR(50)  NOT NULL, -- 'my-chain', 'my-team', 'process', 'branch', 'company'
  scope_id        VARCHAR(100),          -- branch_id, process_id, employee_id, or NULL for 'company'
  snapshot_data   JSON         NOT NULL, -- complete tree structure
  node_count      INT          NOT NULL DEFAULT 0,
  generated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_by    CHAR(36),              -- user_id who triggered rebuild
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  INDEX idx_org_chart_snapshot_scope (scope_type, scope_id),
  INDEX idx_org_chart_snapshot_generated (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Org Chart Access Log (audit every chart view and export) ────────────────
CREATE TABLE IF NOT EXISTS org_chart_access_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id         CHAR(36)     NOT NULL,
  employee_id     CHAR(36),              -- resolved employee_id from user_id
  scope_type      VARCHAR(50),           -- 'my-chain', 'my-team', 'process', 'branch', 'company'
  scope_id        VARCHAR(100),          -- branch_id, process_id, etc.
  action_type     VARCHAR(50)  NOT NULL, -- 'view', 'export', 'search', 'node_detail'
  filters_applied JSON,                  -- { branch_id, process_id, department_id, designation_id, status }
  search_query    VARCHAR(500),          -- search keyword if action_type='search'
  export_format   VARCHAR(20),           -- 'xlsx', 'pdf' if action_type='export'
  ip_address      VARCHAR(100),          -- requester IP
  user_agent      VARCHAR(500),          -- browser/client info
  accessed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_org_chart_access_user (user_id),
  INDEX idx_org_chart_access_employee (employee_id),
  INDEX idx_org_chart_access_action (action_type),
  INDEX idx_org_chart_access_timestamp (accessed_at),
  FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Org Chart Override (hide employees or custom positioning) ───────────────
CREATE TABLE IF NOT EXISTS org_chart_override (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  override_type   VARCHAR(50)  NOT NULL, -- 'hide_from_chart', 'custom_position', 'custom_label'
  override_value  JSON,                  -- type-specific config
  reason          TEXT,                  -- why this override exists
  created_by      CHAR(36)     NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  INDEX idx_org_chart_override_employee (employee_id),
  INDEX idx_org_chart_override_type (override_type),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES auth_user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Org Chart Data Quality Issues (missing manager, circular mapping, etc.) ─
CREATE TABLE IF NOT EXISTS org_chart_data_issue (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36),              -- NULL for company-wide issues
  issue_type      VARCHAR(50)  NOT NULL, -- 'missing_manager', 'circular_mapping', 'inactive_manager',
                                         -- 'cross_branch_manager', 'process_mismatch', 'unmapped_employee',
                                         -- 'duplicate_reporting', 'orphan_manager', 'no_designation'
  severity        ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  issue_detail    JSON         NOT NULL, -- { affected_employees: [...], chain: [...], suggested_fix: '...' }
  suggested_fix   TEXT,                  -- human-readable recommendation
  detected_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at     DATETIME,              -- when issue was fixed
  resolved_by     CHAR(36),              -- user_id who resolved
  resolution_note TEXT,                  -- how it was resolved
  active_status   TINYINT(1)   NOT NULL DEFAULT 1, -- 0 = resolved or ignored
  INDEX idx_org_chart_issue_employee (employee_id),
  INDEX idx_org_chart_issue_type (issue_type),
  INDEX idx_org_chart_issue_severity (severity),
  INDEX idx_org_chart_issue_active (active_status, detected_at),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES auth_user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Seed initial validation (optional: run on first load) ───────────────────
-- This will be triggered by GET /api/org-chart/data-quality endpoint
