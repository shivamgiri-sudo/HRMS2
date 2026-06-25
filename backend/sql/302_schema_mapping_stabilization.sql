-- Migration 302: Schema stabilization for production recovery
-- Safe stored-procedure pattern for MySQL 8.0

DROP PROCEDURE IF EXISTS mig302;
DELIMITER $$
CREATE PROCEDURE mig302()
BEGIN
  -- candidate_workflow_state table for status machine
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='candidate_workflow_state') THEN
    CREATE TABLE candidate_workflow_state (
      id VARCHAR(36) PRIMARY KEY,
      candidate_id VARCHAR(36) NOT NULL,
      current_state VARCHAR(80) NOT NULL DEFAULT 'candidate_created',
      previous_state VARCHAR(80),
      changed_by_user_id VARCHAR(36),
      changed_at DATETIME DEFAULT NOW(),
      remarks TEXT,
      INDEX idx_cws_cand (candidate_id),
      INDEX idx_cws_state (current_state)
    );
  END IF;

  -- candidate_status_audit_log
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='candidate_status_audit_log') THEN
    CREATE TABLE candidate_status_audit_log (
      id VARCHAR(36) PRIMARY KEY,
      candidate_id VARCHAR(36) NOT NULL,
      from_state VARCHAR(80),
      to_state VARCHAR(80) NOT NULL,
      changed_by_user_id VARCHAR(36),
      remarks TEXT,
      created_at DATETIME DEFAULT NOW(),
      INDEX idx_csal_cand (candidate_id)
    );
  END IF;

  -- jclr_entries table
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='jclr_entries') THEN
    CREATE TABLE jclr_entries (
      id VARCHAR(36) PRIMARY KEY,
      candidate_id VARCHAR(36) NOT NULL UNIQUE,
      employee_location VARCHAR(100),
      kpi_applicable TINYINT(1) DEFAULT 0,
      billable_status VARCHAR(20),
      reporting_manager_id VARCHAR(36),
      employee_type VARCHAR(50),
      employment_type VARCHAR(50),
      epf_declaration TINYINT(1) DEFAULT 0,
      joining_date DATE,
      salary_start_date DATE,
      department VARCHAR(100),
      designation VARCHAR(100),
      process_id VARCHAR(36),
      cost_centre VARCHAR(100),
      band_grade VARCHAR(50),
      branch_id VARCHAR(36),
      shift_id VARCHAR(36),
      jclr_submitted_by VARCHAR(36),
      jclr_submitted_at DATETIME,
      bm_approved_by VARCHAR(36),
      bm_approved_at DATETIME,
      bm_remarks TEXT,
      status VARCHAR(30) DEFAULT 'pending',
      created_at DATETIME DEFAULT NOW(),
      updated_at DATETIME DEFAULT NOW() ON UPDATE NOW(),
      INDEX idx_jclr_cand (candidate_id),
      INDEX idx_jclr_status (status)
    );
  END IF;

  -- salary_component_assignments
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='salary_component_assignments') THEN
    CREATE TABLE salary_component_assignments (
      id VARCHAR(36) PRIMARY KEY,
      candidate_id VARCHAR(36),
      employee_id VARCHAR(36),
      effective_date DATE NOT NULL,
      salary_slab VARCHAR(50),
      basic DECIMAL(10,2),
      hra DECIMAL(10,2),
      conveyance DECIMAL(10,2),
      special_allowance DECIMAL(10,2),
      gross DECIMAL(10,2),
      pf_applicable TINYINT(1) DEFAULT 0,
      esi_applicable TINYINT(1) DEFAULT 0,
      employer_pf DECIMAL(10,2),
      employer_esi DECIMAL(10,2),
      ctc DECIMAL(10,2),
      net_estimate DECIMAL(10,2),
      assigned_by VARCHAR(36),
      assigned_at DATETIME DEFAULT NOW(),
      approval_reference VARCHAR(100),
      status VARCHAR(20) DEFAULT 'active',
      created_at DATETIME DEFAULT NOW(),
      INDEX idx_sca_cand (candidate_id),
      INDEX idx_sca_emp (employee_id)
    );
  END IF;

  -- employee_code_generation_log (safe add — migration 138 may have created it already)
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employee_code_generation_log') THEN
    CREATE TABLE employee_code_generation_log (
      id VARCHAR(36) PRIMARY KEY,
      candidate_id VARCHAR(36) NOT NULL,
      employee_code VARCHAR(30),
      gate_checklist JSON,
      blocked_by JSON,
      generated_by VARCHAR(36),
      generated_at DATETIME,
      status VARCHAR(20) DEFAULT 'pending',
      created_at DATETIME DEFAULT NOW(),
      INDEX idx_ecgl_cand (candidate_id),
      INDEX idx_ecgl_code (employee_code)
    );
  END IF;

  -- ats_payroll_hr_validation extra status columns if missing
  IF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_payroll_hr_validation') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_payroll_hr_validation' AND COLUMN_NAME='jclr_status') THEN
      ALTER TABLE ats_payroll_hr_validation ADD COLUMN jclr_status VARCHAR(30) DEFAULT 'pending';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_payroll_hr_validation' AND COLUMN_NAME='salary_component_status') THEN
      ALTER TABLE ats_payroll_hr_validation ADD COLUMN salary_component_status VARCHAR(30) DEFAULT 'pending';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_payroll_hr_validation' AND COLUMN_NAME='employee_code_status') THEN
      ALTER TABLE ats_payroll_hr_validation ADD COLUMN employee_code_status VARCHAR(30) DEFAULT 'pending';
    END IF;
  END IF;

END$$
DELIMITER ;
CALL mig302();
DROP PROCEDURE IF EXISTS mig302;
