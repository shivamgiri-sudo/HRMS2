-- 102_biometric_tables.sql
-- Biometric device registry, enrollment mapping, and raw punch log.
-- Raw biometric templates are NEVER stored (DPDP Act 2023 compliance).
-- Only device reference IDs, timestamps, and attendance outcomes are stored.

USE mas_hrms;

-- Device registry (which biometric machines exist and where)
CREATE TABLE IF NOT EXISTS biometric_device_master (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  device_uid    VARCHAR(100)  NOT NULL UNIQUE,
  device_name   VARCHAR(255)  NOT NULL,
  location      VARCHAR(255)  NULL,
  branch_id     CHAR(36)      NULL,
  device_type   ENUM('fingerprint','face','card','fingerprint_face') NOT NULL DEFAULT 'fingerprint',
  ip_address    VARCHAR(50)   NULL,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  source_system VARCHAR(50)   NOT NULL DEFAULT 'ncosec',
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL,
  INDEX idx_bio_device_uid (device_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Maps HRMS employee to Cosec UserID (enrollment reference, NOT biometric template)
CREATE TABLE IF NOT EXISTS employee_biometric_enrollment (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id       CHAR(36)     NOT NULL,
  cosec_user_id     VARCHAR(100) NOT NULL,
  cosec_user_name   VARCHAR(255) NULL,
  device_id         CHAR(36)     NULL,
  enrolled_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enrolled_by       CHAR(36)     NULL,
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  last_sync_at      DATETIME     NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id)   REFERENCES biometric_device_master(id) ON DELETE SET NULL,
  UNIQUE KEY uq_emp_cosec   (employee_id, cosec_user_id),
  INDEX idx_bio_cosec_uid   (cosec_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Raw punch events from Cosec (first-in and last-out per day)
CREATE TABLE IF NOT EXISTS biometric_attendance_log (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id          CHAR(36)     NOT NULL,
  cosec_user_id        VARCHAR(100) NOT NULL,
  punch_date           DATE         NOT NULL,
  first_punch_in       DATETIME     NULL,
  last_punch_out       DATETIME     NULL,
  raw_minutes          INT          NOT NULL DEFAULT 0,
  source_system        VARCHAR(50)  NOT NULL DEFAULT 'ncosec',
  migrated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attendance_record_id CHAR(36)     NULL,
  FOREIGN KEY (employee_id)          REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (attendance_record_id) REFERENCES attendance_daily_record(id) ON DELETE SET NULL,
  UNIQUE KEY uq_bio_emp_date (employee_id, punch_date),
  INDEX idx_bio_log_date    (punch_date),
  INDEX idx_bio_log_emp     (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
