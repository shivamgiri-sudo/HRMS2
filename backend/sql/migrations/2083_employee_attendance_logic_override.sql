-- Personal attendance-source override. One row per employee that is decided differently from
-- their process / designation rules (apr_eligibility_config): APR, COSEC, or APR validated by COSEC.
-- The Attendance Rules page is the only writer. Additive and idempotent: one CREATE TABLE IF NOT EXISTS,
-- no FOREIGN KEY, nothing is altered or deleted. With no rows the engine behaves exactly as before.
CREATE TABLE IF NOT EXISTS employee_attendance_logic_override (
  employee_id      CHAR(36)     NOT NULL,
  attendance_logic ENUM('apr','cosec','apr_validated_by_cosec') NOT NULL,
  reason           VARCHAR(500) NOT NULL,
  set_by           CHAR(36)     NULL,
  active_status    TINYINT      NOT NULL DEFAULT 1,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id),
  KEY idx_ealo_active (active_status)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-employee attendance source override (Attendance Rules page). Beats every apr_eligibility_config row and any scoped dialler rule.';

SELECT 'Migration 2083 applied: employee_attendance_logic_override' AS migration_status;
