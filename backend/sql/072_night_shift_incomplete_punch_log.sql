-- Migration 072: audit table for night shift missing-punch flags
-- Written by cosec_night_shift_guard when a night shift has a clock-in
-- but no clock-out (spill-over day is week_off with zero COSEC punches).
-- HR reviews this table to regularise or confirm absences.

CREATE TABLE IF NOT EXISTS night_shift_incomplete_punch_log (
  id            char(36)     NOT NULL DEFAULT (UUID()),
  employee_id   char(36)     NOT NULL,
  punch_date    date         NOT NULL,
  punch_in_time datetime     NOT NULL,
  reason        varchar(500) NOT NULL,
  reviewed_by   char(36)     NULL,
  reviewed_at   datetime     NULL,
  review_note   varchar(500) NULL,
  created_at    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_emp_date (employee_id, punch_date),
  KEY idx_punch_date (punch_date),
  KEY idx_employee_id (employee_id),
  CONSTRAINT fk_nsipl_emp FOREIGN KEY (employee_id)
    REFERENCES employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
