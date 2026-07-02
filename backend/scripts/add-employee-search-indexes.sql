-- ===============================================
-- Employee Search Performance Optimization
-- Adds indexes to speed up employee directory filters
-- Note: Errors on existing indexes are safe to ignore
-- ===============================================

-- Index for employee_code lookups (exact match and LIKE)
CREATE INDEX idx_employees_employee_code ON employees(employee_code);

-- Index for email searches (official_email, office_email, email)
CREATE INDEX idx_employees_official_email ON employees(official_email);
CREATE INDEX idx_employees_email ON employees(email);

-- Index for mobile searches
CREATE INDEX idx_employees_mobile ON employees(mobile);

-- Composite index for active_status + employment_status (most common filter combination)
CREATE INDEX idx_employees_status_composite ON employees(active_status, employment_status);

-- Index for name searches (first_name, last_name)
CREATE INDEX idx_employees_first_name ON employees(first_name);
CREATE INDEX idx_employees_last_name ON employees(last_name);

-- Foreign key indexes for JOIN performance
CREATE INDEX idx_employees_department_id ON employees(department_id);
CREATE INDEX idx_employees_branch_id ON employees(branch_id);
CREATE INDEX idx_employees_process_id ON employees(process_id);
CREATE INDEX idx_employees_designation_id ON employees(designation_id);
CREATE INDEX idx_employees_reporting_manager_id ON employees(reporting_manager_id);

-- Master table indexes for JOIN performance
CREATE INDEX idx_department_master_active ON department_master(active_status);
CREATE INDEX idx_designation_master_active ON designation_master(active_status);
CREATE INDEX idx_branch_master_active ON branch_master(active_status);
CREATE INDEX idx_process_master_active ON process_master(active_status);

-- Composite index for pagination optimization (ORDER BY employee_code)
CREATE INDEX idx_employees_code_active ON employees(employee_code, active_status);

-- Analyze tables to update statistics after index creation
ANALYZE TABLE employees;
ANALYZE TABLE department_master;
ANALYZE TABLE designation_master;
ANALYZE TABLE branch_master;
ANALYZE TABLE process_master;
