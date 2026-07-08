-- Migration 370: Bulk EPF/PF Creation Automation
-- Creates: pf_establishment_master, pf_policy_master, pf_creation_batch,
--          pf_creation_batch_item, pf_creation_audit_log, pf_export_template
-- Extends: employee_epf_compliance_profile (pf_applicable, pf_establishment_id, pf_wage)

USE mas_hrms;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. PF Establishment Master
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pf_establishment_master (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  establishment_code  VARCHAR(50)  NOT NULL UNIQUE,
  establishment_name  VARCHAR(255) NOT NULL,
  branch_id           CHAR(36)     NULL,
  legal_entity        VARCHAR(255) NULL,
  address             TEXT         NULL,
  region_office       VARCHAR(255) NULL,
  active_status       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pf_est_branch (branch_id),
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. PF Policy Master
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pf_policy_master (
  id                          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  policy_name                 VARCHAR(255) NOT NULL,
  establishment_id            CHAR(36)     NOT NULL,
  effective_from              DATE         NOT NULL,
  effective_to                DATE         NULL,
  pf_applicable               TINYINT(1)   NOT NULL DEFAULT 1,
  wage_ceiling_rule           VARCHAR(80)  NOT NULL DEFAULT 'statutory_15000',
  eps_rule                    VARCHAR(80)  NOT NULL DEFAULT 'standard',
  employer_contribution_rule  VARCHAR(80)  NOT NULL DEFAULT 'standard_12',
  employee_contribution_rule  VARCHAR(80)  NOT NULL DEFAULT 'standard_12',
  voluntary_pf_allowed        TINYINT(1)   NOT NULL DEFAULT 0,
  active_status               TINYINT(1)   NOT NULL DEFAULT 1,
  created_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pf_policy_est (establishment_id),
  FOREIGN KEY (establishment_id) REFERENCES pf_establishment_master(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. PF Creation Batch
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pf_creation_batch (
  id                        CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  batch_number              VARCHAR(80)  NOT NULL UNIQUE,
  establishment_id          CHAR(36)     NULL,
  branch_id                 CHAR(36)     NULL,
  status                    VARCHAR(40)  NOT NULL DEFAULT 'draft',
  total_items               INT          NOT NULL DEFAULT 0,
  valid_items               INT          NOT NULL DEFAULT 0,
  error_items               INT          NOT NULL DEFAULT 0,
  exported_at               DATETIME     NULL,
  export_file_path          VARCHAR(500) NULL,
  export_template_id        CHAR(36)     NULL,
  uploaded_at               DATETIME     NULL,
  acknowledgement_file_path VARCHAR(500) NULL,
  created_by                CHAR(36)     NOT NULL,
  reviewed_by               CHAR(36)     NULL,
  reviewed_at               DATETIME     NULL,
  created_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pf_batch_status (status),
  INDEX idx_pf_batch_branch (branch_id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. PF Creation Batch Items
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pf_creation_batch_item (
  id                      CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  batch_id                CHAR(36)     NOT NULL,
  employee_id             CHAR(36)     NOT NULL,
  epf_profile_id          CHAR(36)     NULL,
  item_status             VARCHAR(40)  NOT NULL DEFAULT 'draft',
  validation_errors       JSON         NULL,
  validation_warnings     JSON         NULL,
  error_count             INT          NOT NULL DEFAULT 0,
  uan_at_export           VARCHAR(30)  NULL,
  epfo_response_code      VARCHAR(80)  NULL,
  epfo_response_message   TEXT         NULL,
  epfo_uan_assigned       VARCHAR(30)  NULL,
  epfo_member_id_assigned VARCHAR(50)  NULL,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pf_batch_employee (batch_id, employee_id),
  INDEX idx_pf_item_status (item_status),
  INDEX idx_pf_item_employee (employee_id),
  FOREIGN KEY (batch_id) REFERENCES pf_creation_batch(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. PF Creation Audit Log
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pf_creation_audit_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  batch_id        CHAR(36)     NULL,
  batch_item_id   CHAR(36)     NULL,
  employee_id     CHAR(36)     NULL,
  action_type     VARCHAR(80)  NOT NULL,
  actor_user_id   CHAR(36)     NULL,
  actor_type      VARCHAR(20)  NOT NULL DEFAULT 'system',
  remarks         TEXT         NULL,
  old_value       JSON         NULL,
  new_value       JSON         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pf_crt_audit_batch (batch_id),
  INDEX idx_pf_crt_audit_emp (employee_id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. PF Export Template (versioned, not hardcoded)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pf_export_template (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_name     VARCHAR(255) NOT NULL,
  template_code     VARCHAR(80)  NOT NULL,
  establishment_id  CHAR(36)     NULL,
  version           VARCHAR(20)  NOT NULL DEFAULT 'v1',
  columns           JSON         NOT NULL COMMENT 'Ordered column definitions [{key, label, source_field, transform}]',
  file_format       VARCHAR(20)  NOT NULL DEFAULT 'xlsx',
  active_status     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pf_tpl_code_ver (template_code, version)
);

-- Seed default EPFO member registration template (configurable)
INSERT INTO pf_export_template (id, template_name, template_code, version, columns, file_format) VALUES
(UUID(), 'EPFO Member Registration - Standard', 'EPFO_MEMBER_REG', 'v1',
 JSON_ARRAY(
   JSON_OBJECT('key','member_name','label','Member Name','source_field','employee_name'),
   JSON_OBJECT('key','relationship','label','Relationship (F/H)','source_field','relationship_type'),
   JSON_OBJECT('key','father_husband_name','label','Father/Husband Name','source_field','father_or_spouse_name'),
   JSON_OBJECT('key','date_of_birth','label','Date of Birth','source_field','date_of_birth','transform','DD/MM/YYYY'),
   JSON_OBJECT('key','gender','label','Gender (M/F/T)','source_field','gender','transform','gender_short'),
   JSON_OBJECT('key','mobile_number','label','Mobile Number','source_field','mobile_number'),
   JSON_OBJECT('key','email','label','Email ID','source_field','personal_email'),
   JSON_OBJECT('key','date_of_joining','label','Date of Joining','source_field','joining_date','transform','DD/MM/YYYY'),
   JSON_OBJECT('key','uan','label','UAN (if existing)','source_field','uan_masked'),
   JSON_OBJECT('key','previous_pf_member','label','Previous PF Member (Y/N)','source_field','previous_pf_member','transform','yn_flag'),
   JSON_OBJECT('key','previous_pf_account','label','Previous PF Account No','source_field','previous_pf_account_number'),
   JSON_OBJECT('key','international_worker','label','International Worker (Y/N)','source_field','international_worker','transform','yn_flag'),
   JSON_OBJECT('key','eps_eligible','label','EPS Eligible (Y/N)','source_field','previous_eps_member','transform','yn_flag'),
   JSON_OBJECT('key','basic_wage','label','Basic Wages','source_field','basic_wage')
 ),
 'xlsx');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. Extend employee_epf_compliance_profile
-- ═══════════════════════════════════════════════════════════════════════════════

DROP PROCEDURE IF EXISTS _370_add_col;
DELIMITER $$
CREATE PROCEDURE _370_add_col(
  IN tbl VARCHAR(64),
  IN col VARCHAR(64),
  IN col_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = tbl
       AND COLUMN_NAME = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', col_def);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL _370_add_col('employee_epf_compliance_profile', 'pf_applicable', "TINYINT(1) NOT NULL DEFAULT 1 AFTER excluded_employee");
CALL _370_add_col('employee_epf_compliance_profile', 'pf_establishment_id', "CHAR(36) NULL AFTER pf_applicable");
CALL _370_add_col('employee_epf_compliance_profile', 'pf_wage', "DECIMAL(12,2) NULL AFTER basic_wage");

DROP PROCEDURE IF EXISTS _370_add_col;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. Page catalog and role access
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT IGNORE INTO page_catalog (id, page_code, page_name, module, description, active_status)
VALUES
  (UUID(), 'PAYROLL_PF_CREATION_QUEUE', 'PF Creation Queue', 'payroll', 'Bulk PF creation workflow queue', 1),
  (UUID(), 'PAYROLL_PF_BATCHES', 'PF Creation Batches', 'payroll', 'PF batch listing and management', 1);

INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), role_key, page_code, 1, 1, 1, 0, 1, 1
  FROM (
    SELECT 'super_admin' AS role_key UNION ALL
    SELECT 'admin' UNION ALL
    SELECT 'payroll_hr' UNION ALL
    SELECT 'payroll'
  ) roles
 CROSS JOIN (
    SELECT 'PAYROLL_PF_CREATION_QUEUE' AS page_code UNION ALL
    SELECT 'PAYROLL_PF_BATCHES'
  ) pages;

SELECT 'Migration 370: PF creation automation tables created' AS status;
