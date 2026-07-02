-- Phase 125: Process-wise + Role-wise KPI Engine and HRMS launch readiness
-- Safe/idempotent migration. No destructive changes.

CREATE TABLE IF NOT EXISTS kpi_process_template (
  id VARCHAR(36) PRIMARY KEY,
  template_name VARCHAR(150) NOT NULL,
  process_id VARCHAR(36) NOT NULL,
  branch_id VARCHAR(36) NULL,
  process_type VARCHAR(80) NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  status ENUM('draft','active','inactive','archived') DEFAULT 'draft',
  created_by VARCHAR(36) NULL,
  approved_by VARCHAR(36) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_kpi_process_template_process (process_id, branch_id, status, effective_from, effective_to)
);

CREATE TABLE IF NOT EXISTS kpi_role_template (
  id VARCHAR(36) PRIMARY KEY,
  process_template_id VARCHAR(36) NOT NULL,
  role_code VARCHAR(80) NOT NULL,
  role_name VARCHAR(120) NULL,
  eligibility_rule_json JSON NULL,
  new_joiner_rule_json JSON NULL,
  transfer_rule_json JSON NULL,
  status ENUM('draft','active','inactive') DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kpi_role_template (process_template_id, role_code),
  INDEX idx_kpi_role_template_role (role_code, status)
);

CREATE TABLE IF NOT EXISTS kpi_role_template_metric (
  id VARCHAR(36) PRIMARY KEY,
  role_template_id VARCHAR(36) NOT NULL,
  metric_id VARCHAR(36) NOT NULL,
  target_type ENUM('fixed','client_sla','historical_baseline','dynamic','range','higher_better','lower_better','boolean','fatal','threshold','manual','calculated') DEFAULT 'higher_better',
  target_value DECIMAL(12,2) NULL,
  min_value DECIMAL(12,2) NULL,
  max_value DECIMAL(12,2) NULL,
  weightage DECIMAL(5,2) NOT NULL DEFAULT 0,
  scoring_rule_json JSON NULL,
  fatal_rule_json JSON NULL,
  threshold_rule_json JSON NULL,
  display_order INT DEFAULT 0,
  active_status TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kpi_role_metric (role_template_id, metric_id),
  INDEX idx_kpi_role_metric_template (role_template_id, active_status)
);

CREATE TABLE IF NOT EXISTS kpi_data_source_mapping (
  id VARCHAR(36) PRIMARY KEY,
  metric_id VARCHAR(36) NOT NULL,
  process_id VARCHAR(36) NULL,
  role_code VARCHAR(80) NULL,
  source_type ENUM('sql','api','manual','upload','calculated') NOT NULL DEFAULT 'manual',
  source_database VARCHAR(120) NULL,
  source_table VARCHAR(120) NULL,
  source_field VARCHAR(120) NULL,
  join_key VARCHAR(120) NULL,
  formula_sql TEXT NULL,
  api_endpoint VARCHAR(255) NULL,
  upload_template_code VARCHAR(120) NULL,
  refresh_frequency ENUM('daily','weekly','monthly','manual') DEFAULT 'monthly',
  active_status TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_kpi_source_metric (metric_id, process_id, role_code, active_status)
);

CREATE TABLE IF NOT EXISTS kpi_employee_assignment (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  process_id VARCHAR(36) NOT NULL,
  role_template_id VARCHAR(36) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  assignment_type ENUM('auto','manual','override','transfer_split') DEFAULT 'auto',
  created_by VARCHAR(36) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kpi_employee_assignment (employee_id, process_id, role_template_id, effective_from),
  INDEX idx_kpi_employee_assignment_emp (employee_id, effective_from, effective_to)
);

CREATE TABLE IF NOT EXISTS kpi_score_period (
  id VARCHAR(36) PRIMARY KEY,
  period_type ENUM('daily','weekly','monthly','quarterly') NOT NULL DEFAULT 'monthly',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status ENUM('open','calculated','reviewed','locked') DEFAULT 'open',
  locked_by VARCHAR(36) NULL,
  locked_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kpi_score_period (period_type, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS kpi_score_detail (
  id VARCHAR(36) PRIMARY KEY,
  period_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36) NOT NULL,
  process_id VARCHAR(36) NOT NULL,
  role_code VARCHAR(80) NOT NULL,
  metric_id VARCHAR(36) NOT NULL,
  target_value DECIMAL(12,2) NULL,
  actual_value DECIMAL(12,2) NULL,
  metric_score DECIMAL(8,2) NULL,
  weighted_score DECIMAL(8,2) NULL,
  source_reference_json JSON NULL,
  calculation_note VARCHAR(255) NULL,
  status ENUM('draft','calculated','reviewed','locked','missing_source','fatal_breached','threshold_failed') DEFAULT 'draft',
  calculated_at TIMESTAMP NULL,
  UNIQUE KEY uq_kpi_score_detail (period_id, employee_id, metric_id),
  INDEX idx_kpi_score_detail_emp (employee_id, process_id, role_code, status)
);

CREATE TABLE IF NOT EXISTS kpi_score_summary (
  id VARCHAR(36) PRIMARY KEY,
  period_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36) NOT NULL,
  process_id VARCHAR(36) NOT NULL,
  role_code VARCHAR(80) NOT NULL,
  final_score DECIMAL(8,2) NULL,
  rating VARCHAR(40) NULL,
  rank_in_team INT NULL,
  rank_in_process INT NULL,
  rank_in_branch INT NULL,
  status ENUM('draft','reviewed','locked') DEFAULT 'draft',
  reviewed_by VARCHAR(36) NULL,
  reviewed_at TIMESTAMP NULL,
  locked_at TIMESTAMP NULL,
  UNIQUE KEY uq_kpi_score_summary (period_id, employee_id, process_id, role_code),
  INDEX idx_kpi_score_summary_process (process_id, role_code, final_score)
);

CREATE TABLE IF NOT EXISTS kpi_manual_adjustment (
  id VARCHAR(36) PRIMARY KEY,
  period_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36) NOT NULL,
  metric_id VARCHAR(36) NOT NULL,
  old_actual_value DECIMAL(12,2) NULL,
  new_actual_value DECIMAL(12,2) NOT NULL,
  reason TEXT NOT NULL,
  requested_by VARCHAR(36) NOT NULL,
  approved_by VARCHAR(36) NULL,
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP NULL,
  INDEX idx_kpi_manual_adjustment_status (status, employee_id, metric_id)
);

CREATE TABLE IF NOT EXISTS kpi_review_action (
  id VARCHAR(36) PRIMARY KEY,
  period_id VARCHAR(36) NULL,
  employee_id VARCHAR(36) NOT NULL,
  action_type ENUM('coaching','pip','warning','appreciation','training','manager_review','no_action') NOT NULL,
  action_status ENUM('open','in_progress','closed','cancelled') DEFAULT 'open',
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  owner_user_id VARCHAR(36) NULL,
  due_date DATE NULL,
  created_by VARCHAR(36) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_kpi_review_action_employee (employee_id, action_status, due_date)
);

CREATE TABLE IF NOT EXISTS kpi_formula_catalog (
  id VARCHAR(36) PRIMARY KEY,
  formula_code VARCHAR(120) NOT NULL UNIQUE,
  formula_name VARCHAR(180) NOT NULL,
  formula_expression TEXT NOT NULL,
  description TEXT NULL,
  active_status TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kpi_calculation_audit (
  id VARCHAR(36) PRIMARY KEY,
  event_type VARCHAR(120) NOT NULL,
  period_id VARCHAR(36) NULL,
  employee_id VARCHAR(36) NULL,
  metric_id VARCHAR(36) NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  status VARCHAR(60) NULL,
  message TEXT NULL,
  actor_user_id VARCHAR(36) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_kpi_calc_audit_event (event_type, employee_id, created_at)
);

CREATE TABLE IF NOT EXISTS hrms_launch_invite_log (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NULL,
  email VARCHAR(180) NULL,
  invite_status ENUM('pending','sent','failed','skipped') DEFAULT 'pending',
  message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_launch_invite_employee (employee_id, invite_status)
);

CREATE TABLE IF NOT EXISTS hrms_launch_bootstrap_log (
  id VARCHAR(36) PRIMARY KEY,
  run_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36) NULL,
  employee_code VARCHAR(80) NULL,
  status ENUM('created','updated','skipped','failed') NOT NULL,
  message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_launch_bootstrap_run (run_id, status)
);
