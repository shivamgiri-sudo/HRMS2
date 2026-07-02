-- ===============================================
-- Add Missing Employee Search Indexes
-- Only creates indexes that don't already exist
-- ===============================================

-- Email index (official_email already exists)
CREATE INDEX idx_employees_email ON employees(email);

-- Mobile index
CREATE INDEX idx_employees_mobile ON employees(mobile);

-- Foreign key indexes that are missing
CREATE INDEX idx_employees_department_id ON employees(department_id);
CREATE INDEX idx_employees_designation_id ON employees(designation_id);
CREATE INDEX idx_employees_reporting_manager_id ON employees(reporting_manager_id);

-- Master table indexes
CREATE INDEX idx_department_master_active ON department_master(active_status);
CREATE INDEX idx_designation_master_active ON designation_master(active_status);
CREATE INDEX idx_branch_master_active ON branch_master(active_status);
CREATE INDEX idx_process_master_active ON process_master(active_status);

-- Analyze tables
ANALYZE TABLE employees;
ANALYZE TABLE department_master;
ANALYZE TABLE designation_master;
ANALYZE TABLE branch_master;
ANALYZE TABLE process_master;
