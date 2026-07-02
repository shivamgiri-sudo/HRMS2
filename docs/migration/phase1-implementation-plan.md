# Phase 1: Core Migration Implementation Plan

**Duration**: Weeks 1-3  
**Goal**: Migrate core employee data + salary structures to make HRMS payroll-ready  
**Start Date**: 2026-06-01

---

## Pre-Migration Setup

### 1. Database Backup
```bash
# Backup legacy db_bill
mysqldump -u root -p db_bill > db_bill_backup_$(date +%Y%m%d).sql

# Backup current mas_hrms (if any data exists)
mysqldump -u root -p mas_hrms > mas_hrms_pre_migration_$(date +%Y%m%d).sql
```

### 2. Create Migration Database
```sql
CREATE DATABASE mas_hrms_migration;
USE mas_hrms_migration;

-- Migration tracking table
CREATE TABLE migration_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phase VARCHAR(50),
  entity VARCHAR(100),
  legacy_id VARCHAR(50),
  new_id VARCHAR(36),
  status ENUM('pending', 'success', 'failed', 'skipped'),
  error_message TEXT,
  migrated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_entity_legacy (entity, legacy_id),
  INDEX idx_status (status)
);

-- Data quality issues
CREATE TABLE migration_issues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity VARCHAR(100),
  legacy_id VARCHAR(50),
  issue_type VARCHAR(50),
  severity ENUM('critical', 'high', 'medium', 'low'),
  description TEXT,
  resolution VARCHAR(255),
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Week 1: Master Data Migration

### Task 1.1: Branch Master (Day 1)

**Source**: `masjclrentry.BranchName` (distinct values)  
**Target**: `branch_master`

**Migration Script**:
```sql
-- Extract unique branches
INSERT INTO mas_hrms.branch_master (id, branch_name, branch_code, is_active, created_at)
SELECT 
  UUID() as id,
  TRIM(BranchName) as branch_name,
  UPPER(REPLACE(TRIM(BranchName), ' ', '_')) as branch_code,
  1 as is_active,
  NOW() as created_at
FROM (
  SELECT DISTINCT BranchName 
  FROM db_bill.masjclrentry 
  WHERE BranchName IS NOT NULL 
    AND BranchName != ''
    AND Status = 'Active'
) branches
ORDER BY BranchName;

-- Log migration
INSERT INTO mas_hrms_migration.migration_log (phase, entity, status)
VALUES ('Phase1', 'branch_master', 'success');
```

**Validation**:
```sql
-- Count check
SELECT 'Legacy' as source, COUNT(DISTINCT BranchName) as count 
FROM db_bill.masjclrentry WHERE Status='Active'
UNION ALL
SELECT 'HRMS' as source, COUNT(*) as count 
FROM mas_hrms.branch_master WHERE is_active=1;

-- Should match
```

---

### Task 1.2: Client Master (Day 1)

**Source**: `masjclrentry.ClientName`  
**Target**: `client_master`

**Migration Script**:
```sql
INSERT INTO mas_hrms.client_master (id, client_name, client_code, is_active, created_at)
SELECT 
  UUID() as id,
  TRIM(ClientName) as client_name,
  UPPER(REPLACE(TRIM(ClientName), ' ', '_')) as client_code,
  1 as is_active,
  NOW() as created_at
FROM (
  SELECT DISTINCT ClientName 
  FROM db_bill.masjclrentry 
  WHERE ClientName IS NOT NULL 
    AND ClientName != ''
    AND Status = 'Active'
) clients
ORDER BY ClientName;

INSERT INTO mas_hrms_migration.migration_log (phase, entity, status)
VALUES ('Phase1', 'client_master', 'success');
```

---

### Task 1.3: Process Master (Day 2)

**Source**: `masjclrentry.Process`  
**Target**: `process_master`

**Migration Script**:
```sql
INSERT INTO mas_hrms.process_master (id, process_name, process_code, client_id, is_active, created_at)
SELECT 
  UUID() as id,
  TRIM(m.Process) as process_name,
  UPPER(REPLACE(TRIM(m.Process), ' ', '_')) as process_code,
  c.id as client_id,
  1 as is_active,
  NOW() as created_at
FROM (
  SELECT DISTINCT Process, ClientName 
  FROM db_bill.masjclrentry 
  WHERE Process IS NOT NULL 
    AND Process != ''
    AND Status = 'Active'
) m
LEFT JOIN mas_hrms.client_master c ON TRIM(m.ClientName) = c.client_name
ORDER BY m.Process;
```

---

### Task 1.4: Designation Master (Day 2)

**Source**: `masjclrentry.Desgination` (typo in legacy!)  
**Target**: `designation_master`

**Migration Script**:
```sql
INSERT INTO mas_hrms.designation_master (id, designation_name, designation_code, level, is_active, created_at)
SELECT 
  UUID() as id,
  TRIM(Desgination) as designation_name,
  UPPER(REPLACE(TRIM(Desgination), ' ', '_')) as designation_code,
  NULL as level,  -- To be filled manually
  1 as is_active,
  NOW() as created_at
FROM (
  SELECT DISTINCT Desgination 
  FROM db_bill.masjclrentry 
  WHERE Desgination IS NOT NULL 
    AND Desgination != ''
    AND Status = 'Active'
) desig
ORDER BY Desgination;
```

---

### Task 1.5: Cost Centre Master (Day 3)

**Source**: `masjclrentry.CostCenter`  
**Target**: `cost_centre_master`

**Migration Script**:
```sql
INSERT INTO mas_hrms.cost_centre_master (id, cost_centre_name, cost_centre_code, is_active, created_at)
SELECT 
  UUID() as id,
  TRIM(CostCenter) as cost_centre_name,
  UPPER(REPLACE(TRIM(CostCenter), ' ', '_')) as cost_centre_code,
  1 as is_active,
  NOW() as created_at
FROM (
  SELECT DISTINCT CostCenter 
  FROM db_bill.masjclrentry 
  WHERE CostCenter IS NOT NULL 
    AND CostCenter != ''
    AND Status = 'Active'
) cc
ORDER BY CostCenter;
```

---

## Week 2: Employee Master Migration

### Task 2.1: Data Quality Check (Day 4)

**Pre-flight checks before migration**:

```sql
-- Check 1: Employees with no EmpCode
SELECT COUNT(*) as no_empcode
FROM db_bill.masjclrentry
WHERE (EmpCode IS NULL OR EmpCode = '') AND Status = 'Active';
-- Action: Flag for manual review

-- Check 2: Duplicate EmpCode
SELECT EmpCode, COUNT(*) as count
FROM db_bill.masjclrentry
WHERE Status = 'Active'
GROUP BY EmpCode
HAVING COUNT(*) > 1;
-- Action: Deduplicate (keep latest by CreateDate)

-- Check 3: Invalid DOJ (future dates or before 1970)
SELECT EmpCode, EmpName, DOJ
FROM db_bill.masjclrentry
WHERE Status = 'Active'
  AND (DOJ > CURDATE() OR DOJ < '1970-01-01');
-- Action: Set to NULL, flag for correction

-- Check 4: Missing bank details
SELECT COUNT(*) as no_bank
FROM db_bill.masjclrentry
WHERE Status = 'Active'
  AND (AcNo IS NULL OR AcNo = '' OR IFSCCode IS NULL OR IFSCCode = '');
-- Action: Flag for collection before payroll

-- Check 5: Missing PF/ESIC numbers
SELECT COUNT(*) as no_statutory
FROM db_bill.masjclrentry
WHERE Status = 'Active'
  AND CTC < 21000  -- ESIC eligible
  AND (ESICNo IS NULL OR ESICNo = '');
-- Action: Flag for registration

-- Log all issues
INSERT INTO mas_hrms_migration.migration_issues (entity, legacy_id, issue_type, severity, description)
SELECT 'employee', EmpCode, 'missing_bank', 'critical', 
       CONCAT('No bank details for ', EmpName)
FROM db_bill.masjclrentry
WHERE Status = 'Active'
  AND (AcNo IS NULL OR AcNo = '' OR IFSCCode IS NULL OR IFSCCode = '');
```

---

### Task 2.2: Employee Master Migration (Day 5-7)

**Source**: `masjclrentry` (165 cols)  
**Target**: `employees` (~50 cols)

**Migration Script**:
```sql
INSERT INTO mas_hrms.employees (
  id, employee_code, full_name, father_name,
  gender, blood_group, marital_status, highest_qualification,
  date_of_birth, date_of_joining, date_of_exit,
  phone, email, official_email,
  permanent_address_line1, permanent_address_line2, permanent_city, permanent_state, permanent_pincode,
  current_city, current_state, current_pincode,
  employment_type, status, work_location_type,
  branch_id, department, designation, process_id, client_id, cost_centre_id, band,
  pan_number, aadhaar_number, pf_number, esic_number, uan_number,
  bank_account_number, bank_name, bank_branch, bank_ifsc_code, bank_account_holder_name, bank_account_type, payment_mode,
  biometric_code,
  created_at, updated_at
)
SELECT 
  UUID() as id,
  TRIM(m.EmpCode) as employee_code,
  TRIM(m.EmpName) as full_name,
  TRIM(m.Father) as father_name,
  
  -- Normalize gender
  CASE 
    WHEN UPPER(TRIM(m.Gendar)) IN ('MALE', 'M') THEN 'male'
    WHEN UPPER(TRIM(m.Gendar)) IN ('FEMALE', 'F') THEN 'female'
    ELSE 'other'
  END as gender,
  
  TRIM(m.BloodGruop) as blood_group,
  
  -- Normalize marital status
  CASE 
    WHEN UPPER(TRIM(m.MaritalStatus)) IN ('MARRIED', 'M') THEN 'married'
    WHEN UPPER(TRIM(m.MaritalStatus)) IN ('UNMARRIED', 'SINGLE', 'S') THEN 'single'
    ELSE NULL
  END as marital_status,
  
  TRIM(m.Qualification) as highest_qualification,
  
  -- Dates: validate and convert
  CASE 
    WHEN m.DOB IS NULL OR m.DOB = '0000-00-00' OR m.DOB > CURDATE() THEN NULL
    ELSE m.DOB 
  END as date_of_birth,
  
  CASE 
    WHEN m.DOJ IS NULL OR m.DOJ = '0000-00-00' OR m.DOJ > CURDATE() THEN NULL
    ELSE m.DOJ 
  END as date_of_joining,
  
  CASE 
    WHEN m.DOL IS NULL OR m.DOL = '0000-00-00' THEN NULL
    ELSE m.DOL 
  END as date_of_exit,
  
  -- Contact
  TRIM(m.Mobile) as phone,
  TRIM(m.EmailId) as email,
  TRIM(m.OfficeEmailId) as official_email,
  
  -- Permanent address
  TRIM(m.Adrress1) as permanent_address_line1,
  TRIM(m.Adrress2) as permanent_address_line2,
  TRIM(m.City) as permanent_city,
  TRIM(m.State) as permanent_state,
  TRIM(m.PinCode) as permanent_pincode,
  
  -- Current address
  TRIM(m.City1) as current_city,
  TRIM(m.State1) as current_state,
  TRIM(m.PinCode1) as current_pincode,
  
  -- Employment
  CASE 
    WHEN UPPER(TRIM(m.EmpType)) = 'ONROLL' THEN 'full_time'
    WHEN UPPER(TRIM(m.EmpType)) = 'CONTRACTOR' THEN 'contract'
    WHEN UPPER(TRIM(m.EmpType)) = 'CONSULTANT' THEN 'consultant'
    ELSE 'full_time'
  END as employment_type,
  
  CASE 
    WHEN UPPER(TRIM(m.Status)) = 'ACTIVE' THEN 'active'
    WHEN UPPER(TRIM(m.Status)) IN ('LEFT', 'RESIGNED') THEN 'exited'
    ELSE 'inactive'
  END as status,
  
  CASE 
    WHEN UPPER(TRIM(m.EmpLocation)) = 'ONSITE' THEN 'onsite'
    WHEN UPPER(TRIM(m.EmpLocation)) = 'WFH' THEN 'remote'
    ELSE 'hybrid'
  END as work_location_type,
  
  -- Org structure: lookup FKs
  b.id as branch_id,
  TRIM(m.Dept) as department,
  TRIM(m.Desgination) as designation,
  p.id as process_id,
  c.id as client_id,
  cc.id as cost_centre_id,
  TRIM(m.Band) as band,
  
  -- Documents
  TRIM(m.PanNo) as pan_number,
  TRIM(m.AdharId) as aadhaar_number,
  TRIM(COALESCE(m.NewEpfNo, m.EPFNo)) as pf_number,
  TRIM(m.ESICNo) as esic_number,
  TRIM(m.UAN) as uan_number,
  
  -- Banking
  TRIM(m.AcNo) as bank_account_number,
  TRIM(m.AcBank) as bank_name,
  TRIM(m.AcBranch) as bank_branch,
  TRIM(m.IFSCCode) as bank_ifsc_code,
  TRIM(m.AccHolder) as bank_account_holder_name,
  CASE 
    WHEN UPPER(TRIM(m.AccType)) = 'SAVINGS' THEN 'savings'
    WHEN UPPER(TRIM(m.AccType)) = 'CURRENT' THEN 'current'
    ELSE 'savings'
  END as bank_account_type,
  CASE 
    WHEN UPPER(TRIM(m.SalaryPaymentMode)) = 'BANK' THEN 'bank_transfer'
    WHEN UPPER(TRIM(m.SalaryPaymentMode)) = 'CHEQUE' THEN 'cheque'
    WHEN UPPER(TRIM(m.SalaryPaymentMode)) = 'CASH' THEN 'cash'
    ELSE 'bank_transfer'
  END as payment_mode,
  
  TRIM(m.BioCode) as biometric_code,
  
  -- Audit
  COALESCE(m.CreateDate, NOW()) as created_at,
  COALESCE(m.lastUpdated, NOW()) as updated_at

FROM db_bill.masjclrentry m
LEFT JOIN mas_hrms.branch_master b ON TRIM(m.BranchName) = b.branch_name
LEFT JOIN mas_hrms.process_master p ON TRIM(m.Process) = p.process_name
LEFT JOIN mas_hrms.client_master c ON TRIM(m.ClientName) = c.client_name
LEFT JOIN mas_hrms.cost_centre_master cc ON TRIM(m.CostCenter) = cc.cost_centre_name

WHERE m.Status = 'Active'
  AND m.EmpCode IS NOT NULL
  AND m.EmpCode != ''
  
-- Deduplicate: keep latest record per EmpCode
AND m.id = (
  SELECT MAX(id) 
  FROM db_bill.masjclrentry m2 
  WHERE m2.EmpCode = m.EmpCode
)

ORDER BY m.EmpCode;

-- Log migration
INSERT INTO mas_hrms_migration.migration_log (phase, entity, legacy_id, new_id, status)
SELECT 'Phase1', 'employees', m.EmpCode, e.id, 'success'
FROM db_bill.masjclrentry m
JOIN mas_hrms.employees e ON m.EmpCode = e.employee_code
WHERE m.Status = 'Active';
```

---

### Task 2.3: Validation (Day 8)

```sql
-- Count match
SELECT 'Legacy Active' as source, COUNT(*) as count 
FROM db_bill.masjclrentry 
WHERE Status='Active' AND EmpCode != '';

SELECT 'HRMS' as source, COUNT(*) as count 
FROM mas_hrms.employees;

-- Sample comparison
SELECT 
  m.EmpCode as legacy_code,
  e.employee_code as hrms_code,
  m.EmpName as legacy_name,
  e.full_name as hrms_name,
  m.DOJ as legacy_doj,
  e.date_of_joining as hrms_doj
FROM db_bill.masjclrentry m
JOIN mas_hrms.employees e ON m.EmpCode = e.employee_code
WHERE m.Status = 'Active'
LIMIT 10;
```

---

## Week 3: Salary Structures Migration

### Task 3.1: Create Salary Components (Day 9)

```sql
-- Standard components
INSERT INTO mas_hrms.salary_component_master (id, component_code, component_name, component_type, is_statutory, calculation_type, is_active)
VALUES
  (UUID(), 'BASIC', 'Basic Salary', 'earning', 0, 'fixed', 1),
  (UUID(), 'HRA', 'House Rent Allowance', 'earning', 0, 'fixed', 1),
  (UUID(), 'CONV', 'Conveyance Allowance', 'earning', 0, 'fixed', 1),
  (UUID(), 'DA', 'Dearness Allowance', 'earning', 0, 'fixed', 1),
  (UUID(), 'SPECIAL', 'Special Allowance', 'earning', 0, 'fixed', 1),
  (UUID(), 'MA', 'Medical Allowance', 'earning', 0, 'fixed', 1),
  (UUID(), 'LTA', 'Leave Travel Allowance', 'earning', 0, 'fixed', 1),
  (UUID(), 'MOBILE', 'Mobile Allowance', 'earning', 0, 'fixed', 1),
  (UUID(), 'BONUS', 'Bonus', 'earning', 0, 'fixed', 1),
  (UUID(), 'EPF', 'Employee PF', 'deduction', 1, 'percentage', 1),
  (UUID(), 'ESIC', 'Employee ESIC', 'deduction', 1, 'percentage', 1),
  (UUID(), 'PT', 'Professional Tax', 'deduction', 1, 'slab', 1);
```

---

### Task 3.2: Migrate Salary Structures (Day 10-12)

**Strategy**: Extract latest salary structure per employee from `salary_master`

```sql
-- Create salary structures
INSERT INTO mas_hrms.salary_structure (id, employee_id, effective_from, is_active, created_at)
SELECT 
  UUID() as id,
  e.id as employee_id,
  COALESCE(STR_TO_DATE(CONCAT(s.FinanceYear, '-', s.FinanceMonth, '-01'), '%Y-%m-%d'), e.date_of_joining) as effective_from,
  1 as is_active,
  NOW() as created_at
FROM (
  -- Get latest salary record per employee
  SELECT 
    EmpCode,
    FinanceYear,
    FinanceMonth,
    MAX(Id) as latest_id
  FROM db_bill.salary_master
  GROUP BY EmpCode
) latest
JOIN db_bill.salary_master s ON s.Id = latest.latest_id
JOIN mas_hrms.employees e ON e.employee_code = s.EmpCode;

-- Migrate salary components for each structure
INSERT INTO mas_hrms.salary_structure_component (id, structure_id, component_id, amount, created_at)
SELECT 
  UUID() as id,
  ss.id as structure_id,
  sc.id as component_id,
  CAST(COALESCE(
    CASE sc.component_code
      WHEN 'BASIC' THEN NULLIF(TRIM(s.Basic), '')
      WHEN 'HRA' THEN NULLIF(TRIM(s.HRA), '')
      WHEN 'CONV' THEN NULLIF(TRIM(s.Conv), '')
      WHEN 'SPECIAL' THEN NULLIF(TRIM(s.SpecialAllowance), '')
      WHEN 'MA' THEN NULLIF(TRIM(s.MedicalAllowance), '')
      WHEN 'LTA' THEN NULLIF(TRIM(s.LTA), '')
      WHEN 'BONUS' THEN NULLIF(TRIM(s.Bonus), '')
    END, '0') AS DECIMAL(10,2)) as amount,
  NOW() as created_at
FROM db_bill.salary_master s
JOIN mas_hrms.employees e ON e.employee_code = s.EmpCode
JOIN mas_hrms.salary_structure ss ON ss.employee_id = e.id AND ss.is_active = 1
CROSS JOIN mas_hrms.salary_component_master sc
WHERE sc.component_type = 'earning'
  AND sc.component_code IN ('BASIC', 'HRA', 'CONV', 'SPECIAL', 'MA', 'LTA', 'BONUS')
  -- Only include if amount > 0
  AND CAST(COALESCE(
    CASE sc.component_code
      WHEN 'BASIC' THEN NULLIF(TRIM(s.Basic), '')
      WHEN 'HRA' THEN NULLIF(TRIM(s.HRA), '')
      WHEN 'CONV' THEN NULLIF(TRIM(s.Conv), '')
      WHEN 'SPECIAL' THEN NULLIF(TRIM(s.SpecialAllowance), '')
      WHEN 'MA' THEN NULLIF(TRIM(s.MedicalAllowance), '')
      WHEN 'LTA' THEN NULLIF(TRIM(s.LTA), '')
      WHEN 'BONUS' THEN NULLIF(TRIM(s.Bonus), '')
    END, '0') AS DECIMAL(10,2)) > 0;
```

---

### Task 3.3: Validation (Day 13)

```sql
-- Verify all active employees have salary structure
SELECT e.employee_code, e.full_name
FROM mas_hrms.employees e
LEFT JOIN mas_hrms.salary_structure ss ON e.id = ss.employee_id AND ss.is_active = 1
WHERE e.status = 'active'
  AND ss.id IS NULL;
-- Should be empty

-- Sample salary comparison
SELECT 
  e.employee_code,
  e.full_name,
  CAST(s.Basic AS DECIMAL(10,2)) as legacy_basic,
  ssc.amount as hrms_basic,
  CAST(s.Gross AS DECIMAL(10,2)) as legacy_gross,
  (SELECT SUM(amount) FROM mas_hrms.salary_structure_component 
   WHERE structure_id = ss.id) as hrms_gross
FROM db_bill.salary_master s
JOIN mas_hrms.employees e ON e.employee_code = s.EmpCode
JOIN mas_hrms.salary_structure ss ON ss.employee_id = e.id AND ss.is_active = 1
JOIN mas_hrms.salary_structure_component ssc ON ssc.structure_id = ss.id
JOIN mas_hrms.salary_component_master sc ON sc.id = ssc.component_id AND sc.component_code = 'BASIC'
WHERE e.status = 'active'
LIMIT 20;
```

---

## Post-Migration Checklist

- [ ] All active employees migrated (count match)
- [ ] All master tables populated (branch, client, process, designation, cost centre)
- [ ] All employees have branch/client/process FKs
- [ ] All employees have bank details (or flagged as missing)
- [ ] All employees have statutory numbers (or flagged as missing)
- [ ] All active employees have salary structures
- [ ] Sample salary calculations validated
- [ ] Migration logs show 100% success rate
- [ ] Migration issues reviewed and resolved
- [ ] Legacy database kept read-only

---

## Rollback Plan

If critical issues found:

```sql
-- Rollback employee migration
DELETE FROM mas_hrms.employees WHERE created_at > '[MIGRATION_START_TIMESTAMP]';

-- Rollback masters
DELETE FROM mas_hrms.branch_master WHERE created_at > '[MIGRATION_START_TIMESTAMP]';
DELETE FROM mas_hrms.client_master WHERE created_at > '[MIGRATION_START_TIMESTAMP]';
-- ... other masters

-- Check migration_log for details
SELECT * FROM mas_hrms_migration.migration_log WHERE phase = 'Phase1' AND status = 'failed';
```

---

## Next Steps (Phase 2)

After Phase 1 complete:
- Build Training Module (Week 4-5)
- Test first payroll run with migrated data
- Collect missing bank/statutory details
- User acceptance testing
