-- =============================================================================
-- MAS-CallNet HRMS: Customization System Schema
-- Version: 1.0
-- Date: 2026-06-02
-- Purpose: Multi-dimensional customization for masters, policies, workflows, UI
-- =============================================================================

USE mas_hrms;

-- =============================================================================
-- 1. Customization Dimensions
-- =============================================================================

CREATE TABLE IF NOT EXISTS customization_dimension (
  id VARCHAR(36) PRIMARY KEY,
  dimension_key VARCHAR(50) UNIQUE NOT NULL COMMENT 'branch, process, department, designation, role, employee',
  dimension_name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active TINYINT(1) DEFAULT 1,
  priority INT DEFAULT 0 COMMENT 'Higher priority = applies first',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_active (is_active),
  INDEX idx_priority (priority DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT 'Customization dimensions (branch, process, department, etc.)';

-- Seed dimensions
INSERT INTO customization_dimension (id, dimension_key, dimension_name, priority) VALUES
(UUID(), 'employee', 'Employee', 1),
(UUID(), 'role', 'Role', 2),
(UUID(), 'designation', 'Designation', 3),
(UUID(), 'department', 'Department', 4),
(UUID(), 'process', 'Process', 5),
(UUID(), 'branch', 'Branch', 6)
ON DUPLICATE KEY UPDATE priority = VALUES(priority);

-- =============================================================================
-- 2. Customization Rules
-- =============================================================================

CREATE TABLE IF NOT EXISTS customization_rule (
  id VARCHAR(36) PRIMARY KEY,
  rule_name VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL COMMENT 'leave_type, attendance_policy, approval_workflow, etc.',
  entity_id VARCHAR(36) COMMENT 'Specific entity (optional)',

  -- Dimension filters (multi-select)
  branch_ids JSON COMMENT '["branch-uuid-1", "branch-uuid-2"]',
  process_ids JSON,
  department_ids JSON,
  designation_ids JSON,
  role_ids JSON,
  employee_ids JSON,

  -- Customization payload
  config_type VARCHAR(50) NOT NULL COMMENT 'override, merge, extend, disable',
  config_data JSON NOT NULL COMMENT 'Actual customization values',

  -- Metadata
  priority INT DEFAULT 0 COMMENT 'Rule precedence (higher = applies last = wins)',
  is_active TINYINT(1) DEFAULT 1,
  effective_from DATE COMMENT 'Start date',
  effective_to DATE COMMENT 'End date',
  created_by VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_active (is_active, effective_from, effective_to),
  INDEX idx_priority (priority DESC),
  INDEX idx_created (created_at DESC),

  CONSTRAINT chk_config_type CHECK (config_type IN ('override', 'merge', 'extend', 'disable'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT 'Customization rules for multi-dimensional configuration';

-- =============================================================================
-- 3. Customization Application Log
-- =============================================================================

CREATE TABLE IF NOT EXISTS customization_application_log (
  id VARCHAR(36) PRIMARY KEY,
  rule_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(36),

  -- Context at time of application
  branch_id VARCHAR(36),
  process_id VARCHAR(36),
  department_id VARCHAR(36),
  designation_id VARCHAR(36),
  role_id VARCHAR(36),

  -- Applied config
  applied_config JSON NOT NULL COMMENT 'Final config after rule applied',
  application_source VARCHAR(50) COMMENT 'api, cron, manual',

  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_employee (employee_id),
  INDEX idx_rule (rule_id),
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_applied (applied_at DESC),

  FOREIGN KEY (rule_id) REFERENCES customization_rule(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT 'Audit log of customization rule applications';

-- =============================================================================
-- 4. Customization Cache (Performance Optimization)
-- =============================================================================

CREATE TABLE IF NOT EXISTS customization_cache (
  id VARCHAR(36) PRIMARY KEY,
  cache_key VARCHAR(255) UNIQUE NOT NULL COMMENT 'employeeId:entityType:entityId hash',
  employee_id VARCHAR(36) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(36),

  -- Cached effective config
  effective_config JSON NOT NULL,

  -- Metadata
  cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL COMMENT 'TTL for cache entry',
  hit_count INT DEFAULT 0 COMMENT 'Cache hit counter',

  INDEX idx_cache_key (cache_key),
  INDEX idx_employee (employee_id),
  INDEX idx_expires (expires_at),
  INDEX idx_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT 'Performance cache for effective customization configs';

-- =============================================================================
-- 5. Sample Customization Rules
-- =============================================================================

-- Example 1: Mumbai Branch - Extended Casual Leave (skip if no Mumbai branch or CL leave type)
-- INSERT INTO customization_rule (
--   id, rule_name, entity_type, entity_id,
--   branch_ids, config_type, config_data, priority, is_active
-- ) VALUES (
--   UUID(),
--   'Mumbai Branch - Extended CL',
--   'leave_type',
--   (SELECT id FROM leave_type_master WHERE leave_code = 'CL' LIMIT 1),
--   JSON_ARRAY((SELECT id FROM branch_master WHERE branch_name = 'Mumbai' LIMIT 1)),
--   'override',
--   JSON_OBJECT('max_days_per_year', 15),
--   10,
--   1
-- ) ON DUPLICATE KEY UPDATE updated_at = NOW();

-- Example 2: Sales Department - Travel Allowance (skip if no Sales dept)
-- INSERT INTO customization_rule (
--   id, rule_name, entity_type,
--   department_ids, config_type, config_data, priority, is_active
-- ) VALUES (
--   UUID(),
--   'Sales Department - Travel Allowance',
--   'salary_component',
--   JSON_ARRAY((SELECT id FROM department_master WHERE dept_name = 'Sales' LIMIT 1)),
--   'extend',
--   JSON_OBJECT(
--     'additional_components', JSON_ARRAY(
--       JSON_OBJECT(
--         'component_code', 'TRAVEL_ALLOW',
--         'component_name', 'Travel Allowance',
--         'component_type', 'earning',
--         'calculation_type', 'fixed',
--         'fixed_amount', 5000
--       )
--     )
--   ),
--   10,
--   1
-- ) ON DUPLICATE KEY UPDATE updated_at = NOW();

-- Example 3: BPO Process - Flexible Attendance (skip if no BPO process)
-- INSERT INTO customization_rule (
--   id, rule_name, entity_type,
--   process_ids, config_type, config_data, priority, is_active
-- ) VALUES (
--   UUID(),
--   'BPO Process - Flexible Attendance',
--   'attendance_policy',
--   JSON_ARRAY((SELECT id FROM process_master WHERE process_name LIKE '%BPO%' LIMIT 1)),
--   'merge',
--   JSON_OBJECT(
--     'allow_self_regularization', TRUE,
--     'grace_period_minutes', 15,
--     'late_deduction_threshold', 30
--   ),
--   10,
--   1
-- ) ON DUPLICATE KEY UPDATE updated_at = NOW();

-- =============================================================================
-- 6. Utility Functions (Skipped - requires SUPER privilege)
-- =============================================================================

-- Note: matches_customization_context() function implementation moved to application layer
-- (customization-engine.ts) due to SUPER privilege requirement for CREATE FUNCTION

-- =============================================================================
-- 7. Indexes for Performance
-- =============================================================================

-- Additional composite indexes
ALTER TABLE customization_rule ADD INDEX idx_entity_active (entity_type, is_active, priority DESC);
ALTER TABLE customization_application_log ADD INDEX idx_employee_entity (employee_id, entity_type);
ALTER TABLE customization_cache ADD INDEX idx_employee_expires (employee_id, expires_at);

-- =============================================================================
-- 8. Data Integrity Views
-- =============================================================================

-- View: Active Rules
CREATE OR REPLACE VIEW v_active_customization_rules AS
SELECT
  id, rule_name, entity_type, entity_id,
  branch_ids, process_ids, department_ids, designation_ids, role_ids, employee_ids,
  config_type, config_data, priority,
  effective_from, effective_to,
  created_by, created_at, updated_at
FROM customization_rule
WHERE is_active = 1
  AND (effective_from IS NULL OR effective_from <= CURDATE())
  AND (effective_to IS NULL OR effective_to >= CURDATE())
ORDER BY priority DESC;

-- View: Cache Stats
CREATE OR REPLACE VIEW v_customization_cache_stats AS
SELECT
  entity_type,
  COUNT(*) AS total_cached,
  SUM(hit_count) AS total_hits,
  AVG(hit_count) AS avg_hits_per_entry,
  MIN(cached_at) AS oldest_cache,
  MAX(cached_at) AS newest_cache
FROM customization_cache
WHERE expires_at > NOW()
GROUP BY entity_type;

-- View: Application Log Summary
CREATE OR REPLACE VIEW v_customization_application_summary AS
SELECT
  entity_type,
  COUNT(DISTINCT employee_id) AS unique_employees,
  COUNT(*) AS total_applications,
  DATE(applied_at) AS application_date
FROM customization_application_log
WHERE applied_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY entity_type, DATE(applied_at)
ORDER BY application_date DESC, entity_type;

-- =============================================================================
-- 9. Cleanup Procedures (Skipped - requires SUPER privilege)
-- =============================================================================

-- Note: Cleanup procedures moved to application layer (cron jobs)
-- Manual cleanup:
-- DELETE FROM customization_cache WHERE expires_at < NOW();
-- DELETE FROM customization_application_log WHERE applied_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- =============================================================================
-- 10. Scheduled Maintenance (Skipped - requires EVENT privilege)
-- =============================================================================

-- Note: Scheduled cleanup moved to application layer (cron jobs)

-- =============================================================================
-- Migration Complete
-- =============================================================================

SELECT 'Customization system schema created successfully' AS status;
SELECT COUNT(*) AS dimensions FROM customization_dimension;
SELECT COUNT(*) AS rules FROM customization_rule;
