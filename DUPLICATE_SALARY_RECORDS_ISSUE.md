# Duplicate Salary Records Issue

**Date**: 2026-06-12  
**Status**: ⚠️ **IDENTIFIED - Cleanup Pending**

---

## 🔍 **Issue Description**

**Problem**: Some employees have **TWO salary entries** for the same month in mas_hrms.

**Example** (MAS00175 - March 2026):
| Entry | Gross Salary | Net Salary | Source |
|-------|--------------|------------|--------|
| Entry 1 | ₹38,480 | ₹37,080 | Old system (incorrect) |
| Entry 2 | ₹80,096 | ₹75,932 | db_bill sync (correct) |

**Impact**: 
- Employees see TWO payslips for same month
- Confusion about which salary is correct
- Database data inconsistency

---

## 🐛 **Root Cause**

### **Timeline of Events**:

1. **June 11, 2026**: Old HRMS system had some salary records (incomplete, incorrect values)
2. **June 12, 2026**: Created auto-sync system from db_bill → mas_hrms
3. **June 12, 2026**: Auto-sync added NEW records from db_bill (correct values)
4. **Result**: BOTH old + new records exist for same employee/month

### **Why Duplicates Exist**:

**Sync script checks for duplicates** by:
```javascript
const existingId = await this.salaryRecordExists(employeeId, runId);
if (existingId) {
    console.log('Record already exists, skipping');
    return;
}
```

**BUT** this check happens AFTER the sync starts. The old records existed in mas_hrms BEFORE the sync system was created, so they weren't from db_bill initially.

---

## 📊 **Affected Data**

### **Statistics**:
- **Affected Employees**: 14 employees
- **Duplicate Month Entries**: 14 (all for March 2026)
- **Records to Clean**: 14 old records

### **Sample of Affected Employees**:

| Employee Code | Month | Old Gross (Delete) | New Gross (Keep) | Difference |
|---------------|-------|--------------------|------------------|------------|
| 24852C | 2026-03 | ₹6,720 | ₹11,178 | +₹4,458 |
| MAS00001 | 2026-03 | ₹126,215 | ₹166,262 | +₹40,047 |
| MAS00175 | 2026-03 | ₹38,480 | ₹80,096 | +₹41,616 |
| MAS00176 | 2026-03 | ₹57,809 | ₹95,672 | +₹37,863 |
| MAS00182 | 2026-03 | ₹39,493 | ₹65,535 | +₹26,042 |
| MAS00183 | 2026-03 | ₹83,200 | ₹68,500 | -₹14,700 (!) |
| MAS01816 | 2026-03 | ₹47,554 | ₹75,342 | +₹27,788 |
| MAS01963 | 2026-03 | ₹46,444 | ₹117,613 | +₹71,169 |
| MAS02477 | 2026-03 | ₹77,821 | ₹99,598 | +₹21,777 |
| MAS03492 | 2026-03 | ₹24,069 | ₹50,416 | +₹26,347 |
| MAS07197 | 2026-03 | ₹62,400 | ₹65,581 | +₹3,181 |
| MAS07279 | 2026-03 | ₹28,873 | ₹47,727 | +₹18,854 |
| MAS08107 | 2026-03 | ₹13,218 | ₹28,335 | +₹15,117 |
| MAS08226 | 2026-03 | ₹27,210 | ₹57,814 | +₹30,604 |

**Note**: MAS00183 shows DECREASE - need to verify which is correct!

---

## 🔧 **Solution**

### **Cleanup Strategy**:

1. **Keep**: Record with HIGHER gross salary (from db_bill sync)
2. **Delete**: Record with LOWER gross salary (old system)
3. **Exception**: MAS00183 (verify manually - new salary is lower)

### **Cleanup Steps**:

```sql
-- 1. Identify duplicates
SELECT employee_code, run_month, COUNT(*) as cnt
FROM salary_prep_line spl
JOIN salary_prep_run spr ON spr.id = spl.run_id
GROUP BY employee_code, run_month
HAVING COUNT(*) > 1;

-- 2. For each duplicate, keep HIGHER salary, delete LOWER
-- (Done per employee to ensure accuracy)

-- 3. Delete components first
DELETE FROM salary_prep_line_component
WHERE line_id = '<old_record_id>';

-- 4. Delete salary line
DELETE FROM salary_prep_line
WHERE id = '<old_record_id>';
```

---

## ⚠️ **Special Case: MAS00183**

**Issue**: New salary (₹68,500) is LOWER than old salary (₹83,200)

**Investigation Needed**:
```sql
-- Check db_bill for MAS00183 March 2026
SELECT * FROM db_bill.salary_data
WHERE EmpCode = 'MAS00183'
AND SalayDate >= '2026-03-01' AND SalayDate < '2026-04-01';
```

**Possible Reasons**:
1. Salary reduction (demotion, policy change)
2. Deduction applied (loan, advance recovery)
3. Partial month (joined/left mid-month)
4. Data error in db_bill

**Action**: Verify with HR before cleanup

---

## 🛠️ **Cleanup Script**

**File**: `/home/shuvam/hrms-audit/scripts/cleanup-duplicate-salary-records.sql`

**Usage**:
```bash
# Run cleanup (after sync completes)
mysql -h 122.184.128.90 -u shivam_user -p mas_hrms < cleanup-duplicate-salary-records.sql
```

**What it does**:
1. Identifies all duplicates
2. Keeps record with HIGHER gross salary
3. Deletes components of old record
4. Deletes old salary_prep_line record
5. Verifies no duplicates remain
6. Generates summary report

---

## 📋 **Manual Cleanup (Alternative)**

If script fails, manual cleanup per employee:

```sql
-- Example: MAS00175
SET @employee = 'MAS00175';
SET @month = '2026-03';

-- Find IDs
SELECT spl.id, spl.gross_salary
FROM salary_prep_line spl
JOIN salary_prep_run spr ON spr.id = spl.run_id
WHERE spl.employee_code = @employee
AND spr.run_month = @month
ORDER BY spl.gross_salary;

-- Delete lower salary record
SET @old_id = '<id_from_above>';

DELETE FROM salary_prep_line_component WHERE line_id = @old_id;
DELETE FROM salary_prep_line WHERE id = @old_id;
```

---

## 🔍 **Prevention**

### **Why This Won't Happen Again**:

1. **Sync checks for existing records** before inserting
2. **Old system data** no longer being added
3. **db_bill is single source** going forward
4. **Auto-sync runs daily** with duplicate detection

### **Future Improvements**:

1. Add UNIQUE constraint on (employee_id, run_id) in salary_prep_line
2. Enhance sync script to detect and merge duplicates
3. Add data validation before sync
4. Create pre-sync backup

---

## 📊 **Verification After Cleanup**

### **Checklist**:

- [ ] No duplicates remain:
  ```sql
  SELECT employee_code, run_month, COUNT(*)
  FROM salary_prep_line spl
  JOIN salary_prep_run spr ON spr.id = spl.run_id
  GROUP BY employee_code, run_month
  HAVING COUNT(*) > 1;
  ```
  Should return 0 rows.

- [ ] All employees have components:
  ```sql
  SELECT employee_code, run_month,
         (SELECT COUNT(*) FROM salary_prep_line_component WHERE line_id = spl.id) as comp_count
  FROM salary_prep_line spl
  JOIN salary_prep_run spr ON spr.id = spl.run_id
  WHERE comp_count = 0;
  ```
  Should return 0 rows.

- [ ] Test payslip viewing for affected employees

- [ ] Verify PDF download works

---

## 🎯 **Action Plan**

### **Immediate (Today)**:

1. ✅ Identify all duplicates (Done - 14 found)
2. ⏳ Wait for full sync to complete
3. ⏳ Run cleanup script
4. ⏳ Verify no duplicates remain
5. ⏳ Test with affected employees

### **Short-term (This Week)**:

1. Verify MAS00183 salary discrepancy with HR
2. Add UNIQUE constraint to prevent future duplicates
3. Update sync script to handle pre-existing records
4. Test full payslip flow for affected employees
5. Document cleanup results

### **Long-term (This Month)**:

1. Add pre-sync validation
2. Create automated duplicate detection
3. Enhance error handling
4. Add alerting for data issues

---

## 📞 **Support**

### **If Issues After Cleanup**:

**Issue 1: Employee can't see payslip**
- Check if their record was accidentally deleted
- Verify employee_id and run_id are correct
- Re-run sync for that employee

**Issue 2: Wrong salary showing**
- Verify which record was kept
- Check db_bill for correct value
- Re-sync if needed

**Issue 3: Multiple records still showing**
- Re-run cleanup script
- Check for lock wait timeouts
- Manual cleanup per employee

---

## 📚 **Related Documentation**

- **DB_BILL_SALARY_SYNC_COMPLETE.md** - Sync system docs
- **AUTO_SYNC_SETUP_SUMMARY.md** - Auto-sync configuration
- **MIGRATION_PLAN_MAS_HRMS_SOURCE_OF_TRUTH.md** - Migration plan

---

**Status**: ⚠️ **Cleanup Pending** (waiting for sync to complete)

**Next Step**: Run cleanup script after full sync completes

**Expected Result**: 14 old records deleted, 14 correct records remain, 0 duplicates

---

**Generated**: 2026-06-12  
**Affected Employees**: 14  
**Records to Delete**: 14 old records (lower salaries)  
**Cleanup Script**: `/home/shuvam/hrms-audit/scripts/cleanup-duplicate-salary-records.sql`
