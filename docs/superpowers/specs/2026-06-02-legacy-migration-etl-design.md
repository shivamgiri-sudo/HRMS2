# Legacy Data Migration ETL — Design Spec
**Date:** 2026-06-02  
**Author:** Tausif Ansari  
**Status:** Approved  

---

## 1. Goal

Migrate all data from two legacy MySQL tables (`employee_master`, `leave_management`) on the legacy production server into the `mas_hrms` MySQL database on Railway. Every legacy field must be preserved — fields without an existing target table are accommodated by new additive tables or ALTER statements in a new migration file `052_legacy_migration_tables.sql`.

---

## 2. Architecture

### 2.1 Delivery

A single TypeScript CLI script:  
**`backend/scripts/migrate-legacy.ts`**

- Invoked manually from the backend directory: `npx ts-node scripts/migrate-legacy.ts`
- Opens two MySQL connections: `SRC` (legacy server) and `DST` (`mas_hrms`)
- Fully idempotent — safe to re-run; uses `INSERT IGNORE` / `ON DUPLICATE KEY UPDATE`
- Prints a phase-by-phase summary on completion
- Never writes back to the legacy server (read-only on `SRC`)

### 2.2 Source Connection (Placeholder)

```
host:     <LEGACY_HOST>       // user fills in: 122.184.128.90
user:     <LEGACY_USER>       // user fills in: root
password: <LEGACY_PASSWORD>   // user fills in: (provided separately)
database: <LEGACY_DB>         // user fills in: source DB name
```

### 2.3 Execution Phases (sequential)

```
PHASE 0  Connect & validate    → verify both connections, check source tables exist
PHASE 1  Seed masters          → branch_master, department_master, process_master, designation_master
PHASE 2  Seed leave types      → DL, PTRL, MTRL (not in default leave_type_master seed)
PHASE 3  Migrate employees     → employees core + bank + statutory + salary snapshot + client mapping + legacy meta
PHASE 4  Migrate leave         → leave_request + leave_approval_log
PHASE 5  Summary report        → counts: inserted / skipped / errors per entity
```

---

## 3. New Database Objects (052_legacy_migration_tables.sql)

All additive. No existing tables modified except two `ALTER TABLE` additions to `employees`.

### 3.1 ALTER TABLE employees (add columns)

| Column | Type | Notes |
|---|---|---|
| `biometric_code` | VARCHAR(50) | Legacy `BiometricCode` |
| `band` | VARCHAR(10) | Legacy `Band` (D/M etc.) |
| `stream` | VARCHAR(100) | Legacy `Stream` |
| `profile_type` | VARCHAR(50) | Legacy `Profile` (VOICE / NON-VOICE) |
| `source_type` | VARCHAR(100) | Legacy `SourceType` |
| `source` | VARCHAR(100) | Legacy `Source` |
| `legacy_emp_id` | INT | Legacy `Id` — traceability FK back to source row |

### 3.2 New Table: `employee_statutory_info`

Stores EPF/ESI/UAN/PAN/Aadhaar per employee.

| Column | Type |
|---|---|
| id | CHAR(36) UUID PK |
| employee_id | CHAR(36) FK → employees.id |
| epf_number | VARCHAR(100) |
| esi_number | VARCHAR(100) |
| uan_number | VARCHAR(50) |
| pan_number | VARCHAR(20) |
| aadhaar_id | VARCHAR(50) (masked at rest) |
| pf_eligible | TINYINT(1) |
| esi_eligible | TINYINT(1) |
| epf_date | DATE |
| created_at | DATETIME |
| updated_at | DATETIME |

### 3.3 New Table: `employee_salary_snapshot`

Point-in-time salary structure from legacy. Payroll module will use `statutory_config` and proper salary structures — this table is the historical record only.

| Column | Type | Legacy field |
|---|---|---|
| id | CHAR(36) UUID PK | |
| employee_id | CHAR(36) FK | |
| snapshot_date | DATE | date of migration |
| basic | DECIMAL(12,2) | `bs` |
| hra | DECIMAL(12,2) | `hra` |
| conveyance | DECIMAL(12,2) | `conv` |
| da | DECIMAL(12,2) | `da` |
| portfolio_allowance | DECIMAL(12,2) | `portf` |
| medical_allowance | DECIMAL(12,2) | `ma` |
| lta | DECIMAL(12,2) | `lta` |
| mobile_allowance | DECIMAL(12,2) | `mob` |
| special_allowance | DECIMAL(12,2) | `sa` |
| other_allowance | DECIMAL(12,2) | `oa` |
| bonus | DECIMAL(12,2) | `Bonus` |
| gross | DECIMAL(12,2) | `Gross` |
| net_in_hand | DECIMAL(12,2) | `NetInHand` |
| ctc_offered | DECIMAL(12,2) | `CTCOffered` |
| package | DECIMAL(12,2) | `package` |
| epf_employee | DECIMAL(12,2) | `EPF` |
| esic_employee | DECIMAL(12,2) | `ESIC` |
| epf_employer | DECIMAL(12,2) | `EPFCO` |
| esic_employer | DECIMAL(12,2) | `ESICCO` |
| professional_tax | DECIMAL(12,2) | `ProfessionalTax` |
| gratuity | DECIMAL(12,2) | `Gratuity` |
| admin_charges | DECIMAL(12,2) | `AdminCharges` |
| pli | DECIMAL(12,2) | `PLI` |
| pay_mode | VARCHAR(50) | `PayMode` |
| salary_payment_mode | VARCHAR(50) | `SalaryPaymentMode` |
| created_at | DATETIME | |

### 3.4 New Table: `employee_client_mapping`

Maps employee to their assigned client/cost-centre.

| Column | Type | Legacy field |
|---|---|---|
| id | CHAR(36) UUID PK | |
| employee_id | CHAR(36) FK | |
| client_name | VARCHAR(255) | `ClientName` |
| cost_center | VARCHAR(255) | `CostCenter` |
| emp_for | VARCHAR(50) | `EmpFor` (InHouse/Client) |
| effective_from | DATE | = `date_of_joining` |
| active_status | TINYINT(1) | 1 |
| created_at | DATETIME | |

### 3.5 New Table: `employee_kpi_assignment`

| Column | Type | Legacy field |
|---|---|---|
| id | CHAR(36) UUID PK | |
| employee_id | CHAR(36) FK | |
| legacy_kpi_id | VARCHAR(50) | `KPIId` |
| assign_date | DATE | `AssignDate` |
| created_at | DATETIME | |

### 3.6 New Table: `employee_legacy_meta`

Catch-all for admin reference fields not mapped elsewhere.

| Column | Type | Legacy field |
|---|---|---|
| id | CHAR(36) UUID PK | |
| employee_id | CHAR(36) FK | |
| offer_no | VARCHAR(100) | `OfferNo` |
| box_file_no | VARCHAR(100) | `BoxFileNo` |
| appoint_print_date | DATE | `AppointPrintDate` |
| document_done | VARCHAR(10) | `documentDone` |
| account_flag | VARCHAR(10) | `AccountFlag` |
| ac_validation_date | DATE | `AcValidationDate` |
| ac_validated_by | VARCHAR(255) | `AcValidatedBy` |
| ac_rejection_remarks | TEXT | `AcRejectionRemarks` |
| updated_by | VARCHAR(255) | `UpdatedBy` |
| official_email | VARCHAR(255) | `OfficialEmailID` |
| relationship_type | VARCHAR(50) | `RType` (Father/Mother) |
| father_name | VARCHAR(255) | `Fname` |
| permanent_address | TEXT | `PAddress` + `PCity` + `PState` + `PpinCode` |
| temporary_address | TEXT | `TAddress` + `TCity` + `TState` + `TPinCode` |
| acc_holder_name | VARCHAR(255) | `AccHolder` |
| land_line_p | VARCHAR(50) | `PLandLine` |
| land_line_t | VARCHAR(50) | `TLandLine` |
| blood_group | VARCHAR(10) | `BloodG` |
| qualification | VARCHAR(255) | `Qualification` |
| marital_status | VARCHAR(50) | `MaritalStatus` |
| passport_no | VARCHAR(100) | `PassPortNo` |
| dl_no | VARCHAR(100) | `dlNo` |
| created_at | DATETIME | |

---

## 4. Field Mapping: `employee_master` → `mas_hrms`

### 4.1 Core → `employees`

| Legacy field | Target column | Transform |
|---|---|---|
| `EmpCode` | `employee_code` | direct (UNIQUE key, idempotency anchor) |
| `Id` | `legacy_emp_id` | direct int |
| `EmpName` | `first_name` / `last_name` | split on first space |
| `Gender` | `gender` | `MALE→Male`, `FEMALE→Female` |
| `DOB` | `date_of_birth` | parse M/D/YYYY → MySQL DATE |
| `DOJ` | `date_of_joining` | parse M/D/YYYY → MySQL DATE |
| `EmailId` | `email` | direct |
| `PMobNo` | `mobile` | direct |
| `EmpType` | `employment_type` | direct |
| `Status=null` | `employment_status='Active'`, `active_status=1` | |
| `Status='L'` | `employment_status='Resigned'`, `active_status=0` | |
| `LeftDate` | `date_of_exit` | parse; null if `0000-00-00` |
| `Location` | `branch_id` | lookup `branch_master` by seeded code |
| `Depart` | `department_id` | lookup `department_master` |
| `Process` | `process_id` | lookup `process_master` |
| `Desig` | `designation_id` | lookup `designation_master` |
| `BiometricCode` | `biometric_code` | direct |
| `Band` | `band` | direct |
| `Stream` | `stream` | direct |
| `Profile` | `profile_type` | direct |
| `SourceType` | `source_type` | direct |
| `Source` | `source` | direct |

### 4.2 Bank → `employee_bank_detail`

| Legacy field | Target column |
|---|---|
| `AcNo` | `account_number` (stored as VARBINARY — encrypted by existing schema) |
| `AcBank` | `bank_name` |
| `IFSCCode` | `ifsc_code` |
| `AccType` | `account_type` |
| `AccHolder` | — (informational, stored in `employee_legacy_meta`) |

### 4.3 Statutory → `employee_statutory_info`

| Legacy field | Target column |
|---|---|
| `EpfNo` | `epf_number` |
| `EsiNo` | `esi_number` |
| `UAN` | `uan_number` (scientific notation cleaned: `1.00143E+11 → 100143000000`) |
| `panno` | `pan_number` |
| `AadharID` | `aadhaar_id` |
| `pfelig` | `pf_eligible` |
| `esielig` | `esi_eligible` |
| `EpfDate` | `epf_date` |

### 4.4 Salary → `employee_salary_snapshot`

All `bs`, `hra`, `conv`, `da`, `portf`, `sa`, `oa`, `mob`, `ma`, `lta`, `Bonus`, `Gross`, `NetInHand`, `CTCOffered`, `package`, `EPF`, `ESIC`, `EPFCO`, `ESICCO`, `ProfessionalTax`, `Gratuity`, `AdminCharges`, `PLI`, `PayMode`, `SalaryPaymentMode`.

### 4.5 Client → `employee_client_mapping`

`ClientName`, `CostCenter`, `EmpFor`

### 4.6 KPI → `employee_kpi_assignment`

`KPIId`, `AssignDate`

### 4.7 Legacy Meta → `employee_legacy_meta`

All remaining fields: `Fname`, `RType`, addresses, `BloodG`, `Qualification`, `MaritalStatus`, `PassPortNo`, `dlNo`, `OfferNo`, `BoxFileNo`, `AppointPrintDate`, `documentDone`, `AccountFlag`, `AcValidationDate`, `AcValidatedBy`, `AcRejectionRemarks`, `UpdatedBy`, `OfficialEmailID`.

---

## 5. Field Mapping: `leave_management` → `mas_hrms`

### 5.1 Core → `leave_request`

| Legacy field | Target column | Transform |
|---|---|---|
| `EmpCode` | `employee_id` | lookup `employees.id` by `employee_code` |
| `LeaveType` | `leave_type_id` | lookup `leave_type_master` by `leave_code` |
| `LeaveFrom` | `from_date` | parse datetime → DATE |
| `LeaveTo` | `to_date` | parse datetime → DATE |
| `CL+ML+EL+DL+PTRL+MTRL+LWP` sum | `total_days` | sum non-null int fields |
| `LeaveFor` | stored in `reason` prefix | "Full Day / Half Day" |
| `Purpose` | `reason` | appended to LeaveFor |
| `Status='Approved'` | `status='approved'` | lowercase normalise |
| `Status='Pending'` | `status='pending'` | |
| `Status='Rejected'` | `status='rejected'` | |
| `CreateDate` | `applied_at` | direct |

### 5.2 Approval → `leave_approval_log`

If `LeaveApproveBy` is not null: insert one row with `action='approved'`, `action_by` = system-placeholder UUID, `action_at = LeaveApproveDate`, `remarks = NULL`.

### 5.3 Additional Leave Type Seeding

Legacy has `DL` (Duty Leave), `PTRL` (Paternity Leave already as PL), `MTRL` (Maternity Leave already as ML). Script seeds missing codes:

| Code | Name |
|---|---|
| `DL` | Duty Leave |
| `PTRL` | Paternity Leave (legacy code) |
| `MTRL` | Maternity Leave (legacy code) |

---

## 6. Master Auto-Seeding Logic (Phase 1)

For each master table, the script:
1. Fetches all distinct values from the source column
2. Generates a `code` = `UPPER(REPLACE(value, ' ', '_'))` (e.g., `"HEAD OFFICE"` → `"HEAD_OFFICE"`)
3. Inserts with `INSERT IGNORE` (no update if already exists by code)
4. Builds an in-memory `Map<string, string>` (legacy value → UUID) for FK resolution in Phase 3

Masters seeded: `branch_master` (from `Location`), `department_master` (from `Depart`), `process_master` (from `Process`), `designation_master` (from `Desig`).

---

## 7. Idempotency & Safety Rules

- **Employees:** `ON DUPLICATE KEY UPDATE updated_at = NOW()` on `employee_code` unique key. Sub-tables (bank, statutory, salary, etc.) use `employee_id` unique constraint with `INSERT IGNORE`.
- **Leave requests:** Idempotency key = `(employee_id, from_date, to_date, leave_type_id)` — `INSERT IGNORE`.
- **Masters:** `INSERT IGNORE` on unique code.
- **No deletions** anywhere in the script.
- **Read-only** on `SRC` connection (connection opened without write grants needed).
- **Transaction** per employee: if any sub-insert fails, that employee's row is rolled back and logged; migration continues.

---

## 8. Files to Create / Modify

| File | Action |
|---|---|
| `backend/sql/052_legacy_migration_tables.sql` | CREATE — new tables + ALTER TABLE employees |
| `backend/scripts/migrate-legacy.ts` | CREATE — ETL script with placeholder credentials |
| `backend/scripts/migrate-legacy.config.ts` | CREATE — connection config with placeholders |
| `backend/src/modules/migration/migration.service.ts` | UPDATE — add `getLegacyMigrationStatus()` helper |
| `backend/src/modules/migration/migration.routes.ts` | UPDATE — add `GET /migration/legacy-status` |

---

## 9. Out of Scope

- Supabase Auth user creation for migrated employees (separate phase)
- Attendance / biometric history migration (separate source table, separate spec)
- Full payroll activation using migrated salary snapshots (payroll module gate still applies)
- LMS learner mapping (LMS integration spec covers this)
