USE mas_hrms;

-- =====================================================
-- Roster Capacity Management Enhancement
-- File: 061_roster_capacity.sql
-- Description: Process-specific week-off capacity rules,
--              auto-approval logic, FCFS allocation
-- =====================================================

-- =====================================================
-- 1. PROCESS WEEK-OFF CAPACITY CONFIG
-- =====================================================
CREATE TABLE IF NOT EXISTS process_weekoff_capacity (
  id VARCHAR(36) PRIMARY KEY,
  process_id VARCHAR(36) NOT NULL,
  day_of_week INT NOT NULL COMMENT '0=Sunday, 1=Monday, ... 6=Saturday',
  max_weekoff_count INT NOT NULL COMMENT 'Max employees who can take this day off',
  max_weekoff_percentage DECIMAL(5,2) NULL COMMENT 'Max % of process strength',
  auto_approve_enabled TINYINT(1) DEFAULT 0,
  auto_approve_threshold INT NULL COMMENT 'Auto-approve until this many slots filled',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_day (process_id, day_of_week),
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE CASCADE,
  UNIQUE KEY uk_process_day (process_id, day_of_week),
  CHECK (day_of_week BETWEEN 0 AND 6),
  CHECK (max_weekoff_count >= 0),
  CHECK (max_weekoff_percentage IS NULL OR max_weekoff_percentage BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. WEEK-OFF ALLOCATION LOG
-- =====================================================
CREATE TABLE IF NOT EXISTS weekoff_allocation_log (
  id VARCHAR(36) PRIMARY KEY,
  process_id VARCHAR(36) NOT NULL,
  day_of_week INT NOT NULL,
  allocation_date DATE NOT NULL,
  employee_id VARCHAR(36) NOT NULL,
  preference_id VARCHAR(36) NULL,
  allocation_sequence INT NOT NULL COMMENT 'FCFS sequence number',
  allocation_status ENUM('allocated', 'waitlisted', 'denied') DEFAULT 'allocated',
  auto_approved TINYINT(1) DEFAULT 0,
  allocated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_process_date (process_id, allocation_date),
  INDEX idx_employee (employee_id),
  INDEX idx_sequence (process_id, day_of_week, allocation_sequence),
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (preference_id) REFERENCES week_off_preference(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. WEEK-OFF PREFERENCE NOTIFICATION
-- =====================================================
CREATE TABLE IF NOT EXISTS weekoff_preference_notification (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  preference_id VARCHAR(36) NOT NULL,
  notification_type ENUM('approved', 'denied', 'waitlisted', 'capacity_full') NOT NULL,
  message TEXT NOT NULL,
  roster_date DATE NULL COMMENT 'Date when preference could not be fulfilled',
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee_read (employee_id, is_read),
  INDEX idx_preference (preference_id),
  INDEX idx_created (created_at),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (preference_id) REFERENCES week_off_preference(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 4. UPDATE week_off_preference TABLE
-- =====================================================
SET @alter_sql = (
  SELECT IF(
    NOT EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = 'mas_hrms'
      AND TABLE_NAME = 'week_off_preference'
      AND COLUMN_NAME = 'submission_order'
    ),
    'ALTER TABLE week_off_preference ADD COLUMN submission_order INT NULL COMMENT ''FCFS submission sequence per process''',
    'SELECT ''Column submission_order already exists'' AS msg'
  )
);
PREPARE stmt FROM @alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @alter_sql = (
  SELECT IF(
    NOT EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = 'mas_hrms'
      AND TABLE_NAME = 'week_off_preference'
      AND COLUMN_NAME = 'auto_approved'
    ),
    'ALTER TABLE week_off_preference ADD COLUMN auto_approved TINYINT(1) DEFAULT 0',
    'SELECT ''Column auto_approved already exists'' AS msg'
  )
);
PREPARE stmt FROM @alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @alter_sql = (
  SELECT IF(
    NOT EXISTS(
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = 'mas_hrms'
      AND TABLE_NAME = 'week_off_preference'
      AND INDEX_NAME = 'idx_submission_order'
    ),
    'ALTER TABLE week_off_preference ADD INDEX idx_submission_order (employee_id, submission_order)',
    'SELECT ''Index idx_submission_order already exists'' AS msg'
  )
);
PREPARE stmt FROM @alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================
-- Sample Data: Default Capacity for All Processes
-- =====================================================
INSERT INTO process_weekoff_capacity (id, process_id, day_of_week, max_weekoff_count, max_weekoff_percentage, auto_approve_enabled, auto_approve_threshold)
SELECT
  UUID(),
  p.id,
  dow.day_num,
  5, -- Default: 5 employees max per day
  20.0, -- Default: 20% of process strength
  CASE WHEN dow.day_num IN (0, 6) THEN 1 ELSE 0 END, -- Auto-approve Sunday/Saturday
  CASE WHEN dow.day_num IN (0, 6) THEN 3 ELSE NULL END -- Auto-approve first 3 for weekends
FROM process_master p
CROSS JOIN (
  SELECT 0 AS day_num UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
  UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6
) dow
WHERE NOT EXISTS (
  SELECT 1 FROM process_weekoff_capacity pwc
  WHERE pwc.process_id = p.id AND pwc.day_of_week = dow.day_num
);

-- =====================================================
-- END OF SCHEMA
-- =====================================================
