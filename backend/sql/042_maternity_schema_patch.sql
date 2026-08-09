-- backend/sql/042_maternity_schema_patch.sql
-- Maternity Benefit Act compliance patch
-- Fixes: ML entitlement days, maternity_benefit_record schema gaps,
--        leave_request FK to maternity record, creche_facility table
USE mas_hrms;

-- 1. Fix ML max_days_per_year: 90 days → 182 days (26 weeks per MBA 1961)
UPDATE leave_type_master
SET max_days_per_year = 182
WHERE leave_code = 'ML' AND max_days_per_year = 90;

-- 2. Add missing columns to maternity_benefit_record
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='maternity_benefit_record' AND COLUMN_NAME='record_type');
SET @sql = IF(@col = 0,
  "ALTER TABLE maternity_benefit_record
     ADD COLUMN record_type ENUM('delivery','adoption','miscarriage','surrogacy')
         NOT NULL DEFAULT 'delivery' AFTER employee_id,
     ADD COLUMN child_birth_order TINYINT NOT NULL DEFAULT 1
         COMMENT '1=first child, 2=second, 3=third+ (affects entitlement weeks)' AFTER record_type,
     ADD COLUMN entitled_weeks TINYINT NOT NULL DEFAULT 26
         COMMENT 'Computed: 26 for 1st/2nd delivery, 12 for 3rd+, 8 adoption, 6 miscarriage' AFTER child_birth_order,
     ADD COLUMN leave_request_id CHAR(36) NULL
         COMMENT 'Auto-created leave_request when status moves to approved' AFTER notes,
     ADD COLUMN nursing_break_granted TINYINT(1) NOT NULL DEFAULT 0
         COMMENT 'Two nursing breaks of 15 min per day for 15 months post-delivery' AFTER leave_request_id,
     ADD COLUMN nursing_break_end_date DATE NULL AFTER nursing_break_granted,
     ADD COLUMN work_from_home_option TINYINT(1) NOT NULL DEFAULT 0
         COMMENT 'MBA 2017: WFH option per employer policy' AFTER nursing_break_end_date,
     ADD INDEX idx_mat_leave_req (leave_request_id),
     ADD INDEX idx_mat_type (record_type, status)",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. Backfill entitled_weeks for existing records based on current paid_weeks
UPDATE maternity_benefit_record
SET entitled_weeks = paid_weeks
WHERE entitled_weeks = 26 AND paid_weeks != 26;

-- 4. creche_facility table (MBA 2017 — mandatory for 50+ women employees)
CREATE TABLE IF NOT EXISTS creche_facility (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_id        CHAR(36)     NOT NULL,
  facility_type    ENUM('on_premises','employer_funded_offsite','contracted') NOT NULL,
  facility_name    VARCHAR(255) NULL,
  address          TEXT         NULL,
  capacity         INT          NOT NULL DEFAULT 0,
  current_enrolled INT          NOT NULL DEFAULT 0,
  subsidy_per_child_monthly DECIMAL(10,2) NULL,
  operational_since DATE        NULL,
  status           ENUM('active','inactive','planned') NOT NULL DEFAULT 'active',
  notes            TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_creche_branch (branch_id),
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Maternity schema patch 042 applied.' AS status;
