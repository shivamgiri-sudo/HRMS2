-- Migration: 1032_apr_eligibility_config.sql
-- Purpose:  Create apr_eligibility_config table to replace the hard-coded
--           department/designation string matching seeded in 174_apr_attendance_rule.sql.
--           The APR backend service continues to read the hard-coded values until
--           Phase 2 wires it to this table.
-- Safety:   CREATE TABLE IF NOT EXISTS + INSERT IGNORE only.
--           No existing tables or data are modified.
--           NOT EXECUTED AUTOMATICALLY — run manually on staging first.
-- Created:  2026-07-31

CREATE TABLE IF NOT EXISTS apr_eligibility_config (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  rule_name            VARCHAR(200) NOT NULL,
  -- NULL patterns mean "match all" (no filter applied for that dimension)
  dept_name_pattern    VARCHAR(200) NULL
    COMMENT 'SQL LIKE pattern for department name. NULL = all departments.',
  designation_pattern  VARCHAR(200) NULL
    COMMENT 'SQL LIKE pattern for designation name. NULL = all designations.',
  process_id           CHAR(36)     NULL
    COMMENT 'Specific process to apply this rule to. NULL = all processes.',
  full_day_minutes     INT          NOT NULL DEFAULT 480
    COMMENT 'Minutes required for a full-day attendance mark.',
  half_day_minutes     INT          NOT NULL DEFAULT 240
    COMMENT 'Minimum minutes for a half-day attendance mark (below = absent).',
  grace_minutes        INT          NOT NULL DEFAULT 0
    COMMENT 'Grace minutes before late-mark is applied.',
  effective_from       DATE         NOT NULL DEFAULT (CURDATE()),
  effective_to         DATE         NULL
    COMMENT 'NULL = no expiry.',
  active_status        TINYINT(1)   NOT NULL DEFAULT 1,
  notes                TEXT         NULL,
  created_by           CHAR(36)     NULL,
  updated_by           CHAR(36)     NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_apr_active (active_status, effective_from),
  INDEX idx_apr_process (process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the rule that was previously hard-coded in 174_apr_attendance_rule.sql:
--   "APR-based rule for Operations+Executive employees: >=480min=Present,
--    240-479min=Half Day, <240min=Absent. Engine detects APR employees by
--    dept LIKE %operation% AND designation LIKE %executive%."
INSERT IGNORE INTO apr_eligibility_config
  (id, rule_name, dept_name_pattern, designation_pattern,
   full_day_minutes, half_day_minutes, grace_minutes,
   effective_from, notes)
VALUES (
  UUID(),
  'Operations Executive APR Rule',
  '%operation%',
  '%executive%',
  480,
  240,
  0,
  '2024-04-01',
  'Migrated from hard-coded seed in 174_apr_attendance_rule.sql. APR service reads this table from Phase 2 onwards.'
);

-- Verification:
-- SELECT * FROM apr_eligibility_config;
