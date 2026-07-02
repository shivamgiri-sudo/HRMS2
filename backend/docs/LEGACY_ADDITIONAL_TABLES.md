# Legacy Database - Additional Critical Tables

**Database:** db_bill (14.97.30.236:3306)  
**Date:** 2026-06-07  
**Priority:** Tables updated in last 30 days

---

## 🔥 **HIGH PRIORITY TABLES (Recently Updated)**

### 1. **leave_management** (31,235 rows)
**Last Updated:** 2026-06-06 20:24:28  
**Purpose:** Employee leave applications and balances

**Key Fields:**
- `EmpCode` - Employee code (link to masjclrentry)
- `LeaveFrom`, `LeaveTo` - Leave dates
- `LeaveType` - Type of leave
- `Status` - Approval status
- **Leave Balances:** `CL`, `ML`, `DL`, `EL`, `PTRL`, `MTRL`, `LWP`
- `LeaveApproveBy`, `LeaveApproveDate` - Approval tracking
- `CreateDate` - Application date

**Sync to HRMS:**
→ `leave_requests` table  
→ `leave_balances` table  
**Impact:** Critical for leave management module

---

### 2. **LoanMaster** (258 rows)
**Last Updated:** 2026-06-06 15:13:13  
**Purpose:** Employee loans and advances

**Key Fields:**
- `EmpCode`, `EmpName` - Employee details
- `Type` - Loan type
- `Amount` - Loan amount
- `StartDate`, `EndDate` - Loan period
- `Installments`, `DeductionPerMonth` - Repayment schedule
- `GuarantorName`, `GuarantorEmpCode` - Guarantor details
- `DeductedAmount`, `PendingAmount` - Repayment tracking
- `ApproveFirst`, `ApproveSecond` - Approval workflow
- `TransationStatus` - Active/Completed status

**Sync to HRMS:**
→ New table: `employee_loans`  
**Impact:** Important for payroll deductions

---

### 3. **BranchWiseAttandanceIssue** (136,211 rows)
**Last Updated:** 2026-06-06 20:42:03  
**Purpose:** Attendance issues/corrections

**Sample Query:**
```sql
DESCRIBE BranchWiseAttandanceIssue;
```

**Sync to HRMS:**
→ `wfm_attendance_corrections` or `wfm_regularizations`  
**Impact:** Critical for attendance module

---

### 4. **upload_incentive_breakup** (83,124 rows)
**Last Updated:** 2026-06-06 15:40:09  
**Purpose:** Incentive/bonus breakup data

**Sync to HRMS:**
→ Payroll incentives module  
**Impact:** Important for payroll calculations

---

### 5. **upload_deduction** (12,650 rows)
**Last Updated:** 2026-06-06 09:55:14  
**Purpose:** Payroll deductions (loans, advances, penalties)

**Sync to HRMS:**
→ `payroll_deductions` table  
**Impact:** Critical for payroll processing

---

### 6. **provision_master_month_deductions** (10,296 rows)
**Last Updated:** 2026-06-05 13:30:21  
**Purpose:** Monthly provision/deduction tracking

**Sync to HRMS:**
→ Payroll provisions  
**Impact:** Important for month-end payroll

---

### 7. **od_apply_master** (3,105 rows)
**Last Updated:** 2026-06-04 18:42:20  
**Purpose:** On-Duty (OD) applications

**Sync to HRMS:**
→ `wfm_on_duty_requests` table  
**Impact:** Attendance management

---

### 8. **ProcessAttendanceMaster** (2,704 rows)
**Last Updated:** 2026-06-06 16:59:25  
**Purpose:** Process-wise attendance tracking

**Sync to HRMS:**
→ Attendance analytics  
**Impact:** Medium - reporting purposes

---

### 9. **mas_docoments** (263,773 rows)
**Last Updated:** 2026-06-06 19:33:53  
**Purpose:** Employee document storage/tracking

**Sync to HRMS:**
→ `employee_documents` table  
**Impact:** High - compliance/document management

---

### 10. **user_log** (231,763 rows)
**Last Updated:** 2026-06-07 09:39:46  
**Purpose:** User activity logs

**Sync to HRMS:**
→ Audit logs (optional)  
**Impact:** Low - audit trail only

---

## 📊 **Sync Priority Ranking**

| Rank | Table | Rows | Impact | Urgency |
|------|-------|------|--------|---------|
| 1 | `leave_management` | 31,235 | 🔴 High | Immediate |
| 2 | `LoanMaster` | 258 | 🔴 High | Immediate |
| 3 | `upload_deduction` | 12,650 | 🔴 High | Immediate |
| 4 | `BranchWiseAttandanceIssue` | 136,211 | 🟡 Medium | Soon |
| 5 | `mas_docoments` | 263,773 | 🟡 Medium | Soon |
| 6 | `upload_incentive_breakup` | 83,124 | 🟡 Medium | Later |
| 7 | `od_apply_master` | 3,105 | 🟢 Low | Optional |
| 8 | `provision_master_month_deductions` | 10,296 | 🟢 Low | Optional |

---

## 🔄 **Recommended Sync Strategy**

### **Phase 1: Immediate (This Week)**

**1. Leave Management Sync**
```sql
-- Create sync map
INSERT INTO legacy_sync_map (hrms_domain, legacy_source_table, active_status)
VALUES ('leave', 'leave_management', 1);

-- Field mapping
EmpCode → employee_code (lookup)
LeaveFrom → start_date
LeaveTo → end_date
LeaveType → leave_type_code
Status → status
CL, ML, DL, EL → balance fields
```

**2. Loan Master Sync**
```sql
-- Create employee_loans table first
CREATE TABLE employee_loans (
  id CHAR(36) PRIMARY KEY,
  employee_code VARCHAR(50),
  loan_type VARCHAR(100),
  amount DECIMAL(10,2),
  start_date DATE,
  end_date DATE,
  installments INT,
  deduction_per_month DECIMAL(10,2),
  deducted_amount DECIMAL(10,2),
  pending_amount DECIMAL(10,2),
  status VARCHAR(20),
  legacy_loan_id INT,
  created_at DATETIME,
  updated_at DATETIME
);

-- Sync from LoanMaster
```

**3. Payroll Deductions Sync**
```sql
-- Link upload_deduction to payroll runs
-- Map to payroll_deduction_lines table
```

---

### **Phase 2: Soon (Next Week)**

**4. Attendance Issues**
- Sync `BranchWiseAttandanceIssue` → `wfm_regularizations`
- Map to attendance correction system

**5. Document Tracking**
- Sync `mas_docoments` → `employee_documents`
- Track document types and status

---

### **Phase 3: Later (As Needed)**

**6. Incentives**
- Sync `upload_incentive_breakup` when payroll module stabilizes

**7. On-Duty**
- Sync `od_apply_master` when WFM module needs it

---

## 🛠️ **Implementation Steps**

### **Step 1: Analyze Table Schemas**
```bash
# Run for each priority table
mysql -h 14.97.30.236 -u shivam_user -p db_bill -e "
  DESCRIBE leave_management;
  SELECT * FROM leave_management LIMIT 5;
"
```

### **Step 2: Create HRMS Target Tables**
```sql
-- Example: employee_loans
CREATE TABLE employee_loans (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36),
  loan_type VARCHAR(100),
  amount DECIMAL(10,2),
  -- ... rest of fields
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
```

### **Step 3: Create Sync Handlers**
```typescript
// backend/src/workers/domains/leave-sync-handler.ts
export class LeaveSyncHandler {
  async fetchChanges(lastSync: Date) {
    // Fetch from leave_management WHERE CreateDate > lastSync
  }
  
  async transform(legacyRecord) {
    // Map fields to HRMS schema
  }
  
  async syncToHRMS(records) {
    // Upsert to leave_requests table
  }
}
```

### **Step 4: Add to Sync Worker**
```typescript
// backend/src/workers/legacy-sync-worker.ts
import { leaveSyncHandler } from './domains/leave-sync-handler.js';
import { loanSyncHandler } from './domains/loan-sync-handler.js';

// Add to sync cycle
await leaveSyncHandler.sync();
await loanSyncHandler.sync();
```

---

## 📋 **Data Quality Checks**

### **Leave Management**
```sql
-- Check for orphaned records
SELECT COUNT(*) FROM db_bill.leave_management
WHERE EmpCode NOT IN (SELECT EmpCode FROM db_bill.masjclrentry);

-- Check status values
SELECT DISTINCT Status, COUNT(*) FROM db_bill.leave_management GROUP BY Status;
```

### **Loan Master**
```sql
-- Check active loans
SELECT COUNT(*) FROM db_bill.LoanMaster
WHERE TransationStatus = 'Active' OR TransationStatus IS NULL;

-- Check pending amounts
SELECT SUM(CAST(PendingAmount AS DECIMAL(10,2))) as total_pending
FROM db_bill.LoanMaster
WHERE TransationStatus = 'Active';
```

---

## ⚠️ **Important Notes**

1. **Leave Balances:**
   - Legacy has CL, ML, DL, EL columns
   - HRMS might have different leave type codes
   - Need mapping table: legacy leave type → HRMS leave type

2. **Loan Deductions:**
   - Must integrate with payroll processing
   - Deduction schedule needs to be respected
   - Active loans must continue deducting

3. **Historical Data:**
   - Some tables have 100K+ rows
   - Consider syncing only last 6-12 months initially
   - Archive older data separately

4. **Update Frequency:**
   - Leave applications: Daily sync
   - Loans: Weekly sync (less frequent changes)
   - Deductions: Before payroll processing

---

## 🚀 **Next Steps**

1. ✅ **Employees synced** (35,806 records) - DONE
2. ⏳ **Leave management sync** - HIGH PRIORITY
3. ⏳ **Loan master sync** - HIGH PRIORITY
4. ⏳ **Payroll deductions sync** - CRITICAL for payroll
5. ⏳ **Attendance issues sync** - Medium priority

**Estimated Time:**
- Leave sync: 2-3 days
- Loan sync: 1-2 days
- Deduction sync: 1-2 days
- Testing: 1 week

**Total: 2-3 weeks for complete legacy data migration**

---

**Last Updated:** 2026-06-07  
**Status:** ⏳ Pending - Next phase after employee sync
