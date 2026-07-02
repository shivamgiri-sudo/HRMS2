# Legacy Database Schema Analysis

**Database:** db_bill (MySQL 5.5.44)  
**Host:** 14.97.30.236:3306  
**Connection:** ✅ Verified

---

## Critical Employee Master Table: NewJclrMaster

**Rows:** 19 active employees  
**Columns:** 161 fields

### Core Identity Fields
- `id` (PK, auto_increment)
- `EmpCode` - Employee code (varchar 50)
- `EmpCodeNo` - Numeric employee ID (int)
- `userid` - Login username (varchar 20)
- `BioCode` - Biometric/attendance ID (varchar 50)

### Personal Information
- `EmpName` - Full name (varchar 100)
- `Title`, `Gendar`, `MaritalStatus`
- `Father`, `Husband` - Parent/spouse names
- `DOB`, `DOJ`, `DOL` - Birth/Joining/Leaving dates
- `Age`, `BloodGruop`, `Qualification`

### Contact & Address
- `Mobile`, `Mobile1`, `LandLine`, `LandLine1`
- `EmailId`, `OfficeEmailId`
- `Adrress1`, `Adrress2`, `City`, `City1`, `State`, `State1`
- `PinCode`, `PinCode1`

### Government IDs
- `PanNo` - PAN card
- `AdharId` - Aadhaar number
- `PassportNo` - Passport
- `EPFNo`, `NewEpfNo` - EPF numbers
- `ESICNo` - ESIC number
- `UAN` - Universal Account Number
- `dlNo` - Driving license

### Organization Details
- `BranchName` - Branch/location
- `SubLocation`, `EmpLocation`, `Home_Branch`
- `Dept` - Department
- `Desgination` - Designation (typo in original)
- `Stream`, `Process`, `Profile`
- `ClientName`, `CostCenter`
- `work_status`, `Type_Of_Employee`, `Emp_Location_Type`

### Employment Status
- `Status` - Active/inactive (default '1')
- `DOJ`, `DOL` - Dates of joining/leaving
- `ResignationDate`
- `LeftReason`, `ReasonofLeaving`
- `Approve`, `ApproveDate`, `Approve1`, `ApproveDate1`

### Compensation (Salary Components)
- `CTC` - Cost to company
- `package`, `Gross`, `NetInhand`
- `bs` - Basic salary
- `hra` - House rent allowance
- `conv` - Conveyance
- `da` - Dearness allowance
- `ma` - Medical allowance
- `lta` - Leave travel allowance
- `mob`, `moballow` - Mobile allowance
- `sa` - Special allowance
- `oa` - Other allowance
- `portf`, `portfolio` - Portfolio/variable
- `Bonus`, `AdminCharges`, `PLI`

### Deductions
- `EPF`, `EPFCO` - Employee/employer PF
- `ESIC`, `ESICCO` - Employee/employer ESI
- `Gratuity`
- `ProfessionalTax`

### Banking
- `AcNo` - Account number
- `AcBank`, `AcBranch`
- `IFSCCode`
- `AccHolder`, `AccType`
- `PayMode`, `SalaryPaymentMode`
- `CancelledChequeImage`
- `AccountFlag`, `AcValidationDate`, `AcValidatedBy`, `AcRejectionRemarks`

### F&F (Full & Final Settlement)
- `FnfStatus`, `FnfDoc`
- `ChequeNo`, `ChequeDate`, `ChequeAmount`, `ReleasingChequeDate`

### Nomination
- `NomineeName`, `NomineeRelation`, `NomineeDob`
- `nom1`, `nom2`

### Documents & Compliance
- `documentDone` - Document verification status
- `OfferNo` - Offer letter number
- `AuthenticationCode`
- `EsignatureValidateStatus`, `EsignatureValidateRemarks`
- `BoxFileNo` - Physical file reference

### Recruitment
- `Source`, `SourceType`
- `Interview_Id`
- `Billable_Status`

### Qualifications & Experience
- `Qualification`, `Qualification_Details`
- `Passed_Out_Year`, `Passed_Out_State`, `Passed_Out_City`, `Passed_Out_Percent`
- `Experience`, `Experience_Year`, `Experience_Doc`

### Family Details
- `Family_Annual_Income`
- `Count_Of_Dependents`

### Reporting
- `Reporting_Manager_Name`
- `Reporting_Manager_Mobile_No`

### Statutory
- `pfelig` - PF eligibility
- `esielig` - ESI eligibility
- `EpfDate` - EPF joining date

### System Fields
- `EmpCodeDate` - Code assignment date
- `AssignDate`
- `EntryDate`
- `CreateDate` (timestamp, CURRENT_TIMESTAMP)
- `lastUpdated`
- `UpdatedBy`
- `manual_update`, `manual_update_time`
- `DownloadCount`
- `Pwd` - Password (likely MD5/plain - SECURITY RISK)

### NOC (No Objection Certificate)
- `NocValidateRemarks`, `NocValidateDate`, `NocValidateBy`

### Miscellaneous
- `KPI`, `Band`
- `EmpFor`
- `RType`
- `mno`
- `dispens`
- `remarks`

---

## Supporting JCLR Tables

### mas_Jclrentrydata (215 rows)
Training/certification tracking:
- `BioCode`, `BranchName`, `EmpName`
- `CostCenter`, `DepartMent`, `Degination`
- `TrainningStatus`, `CertifiedDate`
- `AllocateInBatch`
- `EntryDate`

### mas_jclr (0 rows)
Empty legacy table with minimal fields:
- `EmpCode`, `BioCode`, `Title`, `EmpType`, `EmpName`
- `FatherName`, `HusbandName`

### masjclrentry (unknown structure)
### masjclrentry_15_april2024 (unknown structure)
Likely backups or historical snapshots.

---

## Top Tables by Size

| Table | Rows | Type |
|-------|------|------|
| login_log | 3.2M | Audit logs |
| email_error_log | 2.6M | Error logs |
| **Attandence** | **1.4M** | **Attendance records** |
| Attandence_old | 774K | Backup |
| emp_onboard_trigger_services_log | 530K | Onboarding logs |
| dashboard_target_revenue | 411K | Business data |
| dashboard_data_revenue | 340K | Business data |
| WorkHomeAttandence | 277K | WFH attendance |
| mas_docoments | 264K | Document storage |
| allocation_master | 238K | Allocation records |

---

## Sync Strategy Recommendations

### Priority 1: Employee Master
**Table:** `NewJclrMaster` (19 rows)  
**Sync to:** `employees` table in mas_hrms  
**Key:** `EmpCode` → `employee_code`  
**Timestamp:** `lastUpdated`, `CreateDate`

**Critical mappings:**
- `EmpCode` → `employee_code`
- `BioCode` → biometric ID field
- `EmpName` → `first_name` + `last_name` (split required)
- `Mobile` → `mobile`
- `EmailId`, `OfficeEmailId` → `email`
- `PanNo` → `pan_number`
- `AdharId` → `aadhaar_last4` (last 4 digits only)
- `DOB`, `DOJ`, `DOL` → date fields
- `Status` → `active_status`

### Priority 2: Attendance
**Table:** `Attandence` (1.4M rows)  
**Sync to:** `wfm_attendance` table  
**Incremental:** Based on date/timestamp column

### Priority 3: Banking & Payroll
**From:** NewJclrMaster salary fields  
**To:** `payroll_salary_assignments`, `payroll_structure_lines`

---

## Data Quality Issues Found

1. **Typos in column names:**
   - `Desgination` → should be "Designation"
   - `Gendar` → should be "Gender"
   - `Adrress` → should be "Address"
   - `BloodGruop` → should be "BloodGroup"

2. **Inconsistent naming:**
   - `EmpName` vs `EmpType`
   - `Adrress1` vs `Adrress2` (both typos)
   - `City` vs `City1` (unclear purpose)

3. **Security concerns:**
   - `Pwd` field stores passwords (likely plaintext/MD5)
   - Full Aadhaar stored (should be masked)

4. **Redundant fields:**
   - Duplicate date fields (`DOL` vs `ResignationDate`)
   - Multiple approval fields
   - Overlapping salary component fields

---

## Next Steps

1. ✅ Connection verified to 14.97.30.236:3306
2. ⏳ Create MySQL-based sync adapter (replace SQL Server Change Tracking)
3. ⏳ Map NewJclrMaster → employees table
4. ⏳ Test incremental sync with timestamp-based detection
5. ⏳ Configure sync map for Employee domain
6. ⏳ Enable sync worker

**Estimated sync volume:** ~20 employees (manageable for initial test)
