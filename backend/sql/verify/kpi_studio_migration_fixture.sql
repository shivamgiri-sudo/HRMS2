-- Fixture for verifying 1644_kpi_studio_foundation.sql and 1645_kpi_studio_resolution.sql
-- against a throwaway MySQL 8 schema, rather than reading the SQL and hoping.
--
-- Reproduces the PRE-migration shape of the two production tables 1645 touches, read from the
-- live mas_hrms information_schema (not guessed):
--   kpi_employee_resolved.resolved_from = enum('process','cost_centre','designation','department')
--   every string column utf8mb4_unicode_ci, while the SERVER default is utf8mb4_0900_ai_ci
--
-- The server the verification runs on must be started with
-- --collation-server=utf8mb4_0900_ai_ci, so that a COLLATE clause missing from the migration
-- reproduces the production drift (errno 1267 on join) instead of being masked by a
-- conveniently matching server default.
--
-- Also seeds one existing kpi_employee_resolved row, so the enum-widening MODIFY is exercised
-- against real data: a MODIFY that dropped the original enum values would truncate this row
-- to '' and the assertion after it would catch that.

CREATE TABLE IF NOT EXISTS kpi_metric_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci,
  metric_code   VARCHAR(50)  NOT NULL                  COLLATE utf8mb4_unicode_ci,
  metric_name   VARCHAR(255) NOT NULL                  COLLATE utf8mb4_unicode_ci,
  family        ENUM('operations','quality','performance','custom') NOT NULL DEFAULT 'performance' COLLATE utf8mb4_unicode_ci,
  category      ENUM('operations','quality','sales','hr','custom')  NOT NULL COLLATE utf8mb4_unicode_ci,
  unit          VARCHAR(50)  NOT NULL                  COLLATE utf8mb4_unicode_ci,
  direction     ENUM('higher_is_better','lower_is_better') NOT NULL COLLATE utf8mb4_unicode_ci,
  scoring_type  VARCHAR(30)  NULL                      COLLATE utf8mb4_unicode_ci,
  aggregation_method VARCHAR(30) NOT NULL DEFAULT 'average' COLLATE utf8mb4_unicode_ci,
  decimal_places TINYINT UNSIGNED NOT NULL DEFAULT 2,
  display_order INT          NOT NULL DEFAULT 100,
  minimum_sample_size INT UNSIGNED NULL,
  max_achievement_pct DECIMAL(8,2) NOT NULL DEFAULT 120.00,
  role_visibility_json JSON NULL,
  missing_data_behavior VARCHAR(30) NOT NULL DEFAULT 'exclude' COLLATE utf8mb4_unicode_ci,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_metric_code (metric_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kpi_employee_resolved (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci,
  employee_id     CHAR(36)      NOT NULL                  COLLATE utf8mb4_unicode_ci,
  metric_id       CHAR(36)      NOT NULL                  COLLATE utf8mb4_unicode_ci,
  target_value    DECIMAL(12,4) NOT NULL,
  min_threshold   DECIMAL(12,4) NULL,
  max_achievement DECIMAL(12,4) NOT NULL DEFAULT 120.0000,
  weightage       DECIMAL(5,2)  NOT NULL DEFAULT 100.00,
  resolved_from   ENUM('process','cost_centre','designation','department') NOT NULL COLLATE utf8mb4_unicode_ci,
  resolved_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kpi_resolved (employee_id, metric_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employees (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci,
  employee_code  VARCHAR(50)  NOT NULL                  COLLATE utf8mb4_unicode_ci,
  branch_id      CHAR(36)     NULL                      COLLATE utf8mb4_unicode_ci,
  process_id     CHAR(36)     NULL                      COLLATE utf8mb4_unicode_ci,
  designation_id CHAR(36)     NULL                      COLLATE utf8mb4_unicode_ci,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employee_code (employee_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO kpi_metric_master (id, metric_code, metric_name, category, unit, direction)
VALUES ('11111111-1111-1111-1111-111111111111', 'AHT', 'Average Handle Time', 'operations', 'seconds', 'lower_is_better');

INSERT INTO employees (id, employee_code) VALUES ('22222222-2222-2222-2222-222222222222', 'MAS00001');

-- The pre-existing resolved row the enum MODIFY must not damage.
INSERT INTO kpi_employee_resolved (employee_id, metric_id, target_value, resolved_from)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 240.0000, 'process');
