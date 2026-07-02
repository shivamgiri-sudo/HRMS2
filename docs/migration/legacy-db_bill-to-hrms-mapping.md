# Legacy DB_BILL to MAS-CallNet HRMS Migration Mapping

**Source Database**: `db_bill` (400 tables, MySQL)  
**Target Database**: `mas_hrms` (MAS-CallNet HRMS)  
**Analysis Date**: 2026-06-01

---

## Executive Summary

Legacy `db_bill` database has **400 tables** with highly denormalized structure. Core employee data spread across:
- **masjclrentry** (165 cols) - Main active employee master (JCLR register)
- **employee_master** (112 cols) - Core employee demographics
- **salary_master** (88 cols) - Salary structure + monthly payroll

**Key Issues**:
1. All fields stored as `VARCHAR` (no type safety)
2. No foreign keys between tables
3. Heavy data duplication across tables
4. Mix of operational + transactional data in single tables
5. 162 employee-related tables with overlapping data

**Migration Strategy**: Map core entities only, normalize structure, establish referential integrity.

---

## Core Entity Mapping

### 1. Employee Master (masjclrentry → employees)

| Legacy Field (masjclrentry) | Type | HRMS Field (employees) | Type | Notes |
|---|---|---|---|---|
| **Identity** |
| `id` | int(10) PK | - | - | New UUID in HRMS |
| `EmpCode` | varchar(50) | `employee_code` | varchar(20) | Format: MAS00001 |
| `EmpCodeNo` | int(11) | - | - | Not needed |
| `userid` | varchar(20) | - | - | Separate auth table |
| `BioCode` | varchar(50) | `biometric_code` | varchar(50) | Maps 1:1 |
| **Personal Info** |
| `Title` | varchar(50) | - | - | Can store in JSON metadata |
| `EmpName` | varchar(100) | `full_name` | varchar(255) | Direct map |
| `Father` | varchar(100) | `father_name` | varchar(255) | Direct map |
| `Husband` | varchar(100) | - | - | Store in emergency contacts |
| `Gendar` | varchar(50) | `gender` | enum | Normalize to enum |
| `BloodGruop` | varchar(10) | `blood_group` | varchar(10) | Direct map |
| `MaritalStatus` | varchar(50) | `marital_status` | enum | Normalize to enum |
| `Qualification` | varchar(100) | `highest_qualification` | varchar(255) | Direct map |
| `DOB` | date | `date_of_birth` | date | Direct map |
| `DOJ` | date | `date_of_joining` | date | Direct map |
| `DOL` | date | `date_of_exit` | date | Maps to lifecycle |
| **Contact** |
| `Adrress1` | varchar(255) | `permanent_address_line1` | varchar(255) | Direct map |
| `Adrress2` | varchar(255) | `permanent_address_line2` | varchar(255) | Direct map |
| `City` | varchar(100) | `permanent_city` | varchar(100) | Direct map |
| `State` | varchar(100) | `permanent_state` | varchar(100) | Direct map |
| `PinCode` | varchar(20) | `permanent_pincode` | varchar(10) | Direct map |
| `City1` | varchar(100) | `current_city` | varchar(100) | Current address |
| `State1` | varchar(100) | `current_state` | varchar(100) | Current address |
| `PinCode1` | varchar(20) | `current_pincode` | varchar(10) | Current address |
| `Mobile` | varchar(20) | `phone` | varchar(20) | Primary mobile |
| `Mobile1` | varchar(20) | - | - | Store in emergency contacts |
| `EmailId` | varchar(100) | `email` | varchar(255) | Personal email |
| `OfficeEmailId` | varchar(100) | `official_email` | varchar(255) | Work email |
| **Org Structure** |
| `EmpType` | varchar(50) | `employment_type` | enum | Normalize: ONROLL → full_time |
| `BranchName` | varchar(100) | `branch_id` | uuid FK | Link to branch_master |
| `SubLocation` | varchar(255) | `sub_location` | varchar(255) | Direct map |
| `EmpLocation` | varchar(50) | `work_location_type` | enum | OnSite/WFH |
| `Dept` | varchar(100) | `department` | varchar(100) | Direct map |
| `Desgination` | varchar(100) | `designation` | varchar(100) | Maps to designation_master |
| `Stream` | varchar(255) | - | - | Custom field |
| `Process` | varchar(255) | `process_id` | uuid FK | Link to process_master |
| `Profile` | varchar(100) | - | - | Custom field |
| `ClientName` | varchar(100) | `client_id` | uuid FK | Link to client_master |
| `CostCenter` | varchar(100) | `cost_centre_id` | uuid FK | Link to cost_centre_master |
| `Band` | varchar(10) | `band` | varchar(20) | Direct map |
| **Documents** |
| `PassportNo` | varchar(50) | - | - | Store in employee_document |
| `PanNo` | varchar(50) | `pan_number` | varchar(20) | Direct map |
| `AdharId` | varchar(50) | `aadhaar_number` | varchar(20) | Direct map |
| `EPFNo` | varchar(50) | `pf_number` | varchar(50) | Direct map |
| `ESICNo` | varchar(50) | `esic_number` | varchar(50) | Direct map |
| `UAN` | varchar(100) | `uan_number` | varchar(20) | Direct map |
| `dlNo` | varchar(100) | - | - | Store in employee_document |
| `CancelledChequeImage` | varchar(100) | - | - | Store in employee_document |
| **Banking** |
| `AcNo` | varchar(100) | `bank_account_number` | varchar(50) | Direct map |
| `AcBank` | varchar(100) | `bank_name` | varchar(255) | Direct map |
| `AcBranch` | varchar(100) | `bank_branch` | varchar(255) | Direct map |
| `IFSCCode` | varchar(100) | `bank_ifsc_code` | varchar(20) | Direct map |
| `AccHolder` | varchar(100) | `bank_account_holder_name` | varchar(255) | Direct map |
| `AccType` | varchar(100) | `bank_account_type` | enum | Savings/Current |
| `SalaryPaymentMode` | varchar(100) | `payment_mode` | enum | Bank/Cash/Cheque |
| **Nominee** |
| `NomineeName` | varchar(100) | - | - | Store in employee_nominee |
| `NomineeRelation` | varchar(100) | - | - | Store in employee_nominee |
| `NomineeDob` | date | - | - | Store in employee_nominee |
| **Salary Components (VARCHAR → numeric)** |
| `CTC` | varchar(20) | - | - | Calculated in salary structure |
| `bs` | varchar(100) | - | - | Maps to salary_component (Basic) |
| `hra` | varchar(100) | - | - | Maps to salary_component (HRA) |
| `conv` | varchar(100) | - | - | Maps to salary_component (Conveyance) |
| `da` | varchar(100) | - | - | Maps to salary_component (DA) |
| `sa` | varchar(100) | - | - | Maps to salary_component (Special) |
| `Bonus` | varchar(100) | - | - | Maps to salary_component (Bonus) |
| `Gross` | varchar(100) | - | - | Calculated |
| `ESIC` | varchar(100) | - | - | Calculated in payroll |
| `EPF` | varchar(100) | - | - | Calculated in payroll |
| `NetInhand` | varchar(100) | - | - | Calculated in payroll |
| **Status & Lifecycle** |
| `Status` | varchar(10) | `status` | enum | Active/Inactive/Left |
| `ResignationDate` | varchar(100) | - | - | Maps to exit_management |
| `left_type` | varchar(45) | - | - | Maps to exit_management |
| `LeftReason` | varchar(500) | - | - | Maps to exit_management |
| `Approve` | varchar(50) | - | - | Approval workflow data |
| `ApproveDate` | datetime | - | - | Approval workflow data |
| **Metadata** |
| `EntryDate` | datetime | - | - | Audit trail |
| `CreateDate` | datetime | `created_at` | timestamp | Direct map |
| `lastUpdated` | datetime | `updated_at` | timestamp | Direct map |
| `UpdatedBy` | varchar(100) | - | - | Audit trail |

**Missing in Legacy**:
- `reporting_manager_id` → Add during migration
- `lob_id` → Add during migration  
- `probation_period_months` → Add during migration
- `notice_period_days` → Add during migration

---

### 2. Salary Master (salary_master → salary structures)

**Legacy Structure**: One row per employee per month with all components as VARCHAR

**HRMS Structure**: Normalized to:
- `salary_structure` (master assignment)
- `salary_component_master` (component definitions)
- `salary_structure_component` (assignment link)
- `salary_prep_run` (monthly payroll)
- `salary_prep_line` (employee payroll detail)

| Legacy Field | Type | HRMS Table | Notes |
|---|---|---|---|
| `EmpCode` | varchar(100) | salary_structure.employee_id | FK to employees |
| `SalDate` | varchar(100) | salary_prep_run.cycle_month | Extract YYYY-MM |
| `Basic` | varchar(100) | component (code: BASIC) | Convert to decimal |
| `HRA` | varchar(100) | component (code: HRA) | Convert to decimal |
| `Bonus` | varchar(100) | component (code: BONUS) | Convert to decimal |
| `Conv` | varchar(100) | component (code: CONV) | Convert to decimal |
| `SpecialAllowance` | varchar(100) | component (code: SPECIAL) | Convert to decimal |
| `Gross` | varchar(100) | - | Calculated |
| `ESIC` | varchar(100) | - | Calculated in payroll |
| `EPF` | varchar(100) | - | Calculated in payroll |
| `IncomeTax` | varchar(100) | - | Calculated via TDS |
| `AdvTaken` | varchar(100) | salary_advance_log | Migrate to advances |
| `LoanTaken` | varchar(100) | salary_advance_log | Migrate to loans |
| `Incentive` | varchar(100) | - | Ad-hoc component |
| `Arrear` | varchar(100) | - | Arrear processing |
| `MobileDedcution` | varchar(100) | - | Deduction component |
| `AssetRecovery` | varchar(100) | - | Deduction component |
| `ProTaxDeduction` | varchar(100) | - | PT calculation |
| `LeaveDeduction` | varchar(100) | - | LOP calculation |
| `NetSalary` | varchar(100) | - | Calculated |

---

### 3. Attendance (Multiple legacy tables → wfm_attendance_session)

Legacy has **40+ attendance-related tables**. Key ones:
- `AttendanceMailMaster` - Email tracking
- `attendance_*` prefix tables - Various trackers

**Migration**: Extract clock-in/out data, map to `wfm_attendance_session` with status calculation.

---

### 4. Leave (Multiple legacy tables → leave_*)

Legacy leave tables scattered. HRMS has:
- `leave_type` (policy)
- `leave_balance_ledger` (balances)
- `leave_request` (applications)

**Migration**: Initialize balances based on legacy accrual rules.

---

## Missing in Legacy (Add During Migration)

### Critical Fields Not in db_bill:

1. **Performance Management**:
   - KPI goals
   - Performance review cycles
   - Ratings history
   - Development plans

2. **Learning & Development**:
   - Training history
   - Certifications
   - Skill matrix

3. **Compliance**:
   - Data consent records
   - DPDP compliance tracking
   - Document verification logs

4. **Workflow**:
   - Approval chains
   - Role-based permissions
   - Audit trails

5. **Advanced HR**:
   - Succession planning
   - Talent pool
   - Employee engagement data
   - Gamification/badges

---

## Migration Scripts Required

### Phase 1: Core Master Data
1. **Branch Master** (`BranchName` → `branch_master`)
2. **Client Master** (`ClientName` → `client_master`)
3. **Process Master** (`Process` → `process_master`)
4. **Designation Master** (`Desgination` → `designation_master`)
5. **Cost Centre Master** (`CostCenter` → `cost_centre_master`)

### Phase 2: Employee Data
1. **Employee Master** (masjclrentry → employees)
   - Normalize enums (gender, marital_status, employment_type)
   - Generate UUIDs
   - Link to master tables via FKs

### Phase 3: Salary Structures
1. **Component Master** (Create standard components)
2. **Salary Structures** (Extract from salary_master)
3. **Historical Payroll** (Last 6 months only)

### Phase 4: Transactional Data
1. **Attendance** (Last 3 months)
2. **Leave Balances** (Current year)
3. **Advances/Loans** (Active only)

### Phase 5: Documents
1. **Employee Documents** (Scan uploads)
2. **Verification Status** (Map to lifecycle)

---

## Data Quality Issues to Fix

1. **Type Safety**:
   - All salary amounts stored as VARCHAR → Convert to DECIMAL(10,2)
   - Dates stored as VARCHAR → Convert to DATE
   - Enums stored as VARCHAR → Normalize to ENUM

2. **Duplicate Records**:
   - Same employee in multiple tables with inconsistent data
   - Run deduplication before migration

3. **Null Handling**:
   - Empty strings ('') vs NULL
   - '0000-00-00' dates → NULL

4. **Referential Integrity**:
   - No FKs in legacy → Validate before migration
   - Orphaned records → Flag for manual review

5. **Salary Component Mismatches**:
   - Component names vary (Basic/bs/BasicSalary)
   - Standardize to HRMS component codes

---

## Migration Validation Checklist

- [ ] All active employees (Status='Active') migrated
- [ ] Bank account details migrated for active employees
- [ ] PF/ESIC/UAN numbers migrated
- [ ] Current month salary structure assigned
- [ ] Leave balances initialized
- [ ] Reporting manager hierarchy established
- [ ] Process assignments validated against process_master
- [ ] Branch assignments validated against branch_master
- [ ] No orphaned salary records (employee not in employees table)
- [ ] Attendance data for last 90 days migrated
- [ ] Exit data for employees with DOL migrated to exit_management

---

## Estimated Migration Complexity

| Entity | Records (est.) | Complexity | Priority |
|---|---|---|---|
| Employees | ~5000 | High | P0 |
| Salary Structures | ~5000 | High | P0 |
| Masters (Branch, Client, Process) | ~200 | Medium | P0 |
| Historical Payroll | ~30000 | Medium | P1 |
| Attendance (3 months) | ~450000 | High | P1 |
| Leave Balances | ~5000 | Low | P1 |
| Documents | ~25000 | Medium | P2 |
| Exit Records | ~2000 | Low | P2 |

**Total Migration Time (estimated)**: 2-3 weeks with validation

---

## Post-Migration Tasks

1. **Data Verification**:
   - Run reports comparing legacy vs HRMS employee count
   - Validate salary calculations for sample employees
   - Cross-check bank account numbers

2. **User Acceptance Testing**:
   - Payroll team validates salary structures
   - HR team validates employee records
   - Finance team validates statutory compliance data

3. **Legacy Database Sunset**:
   - Keep db_bill read-only for 6 months
   - Archive after validation period
   - Document decommission date

---

## Contact for Migration Queries

- **Technical**: Development Team
- **Business**: HR Operations Team
- **Data Quality**: Data Governance Team
