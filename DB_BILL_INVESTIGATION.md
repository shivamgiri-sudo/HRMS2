# db_bill Investigation Results

**Date**: 2026-06-11  
**Server**: 14.97.30.236 (public IP)  
**Database**: db_bill

---

## 🔍 Investigation Summary

### Connection Status
✅ **Successfully connected** to db_bill @ 14.97.30.236

---

## ❌ Key Finding: NO 2026 Leave Balances in db_bill

### What We Found

**Claim**: "leave balance for 2026 is already there in db_bill"

**Reality**: ❌ **FALSE** - db_bill does NOT have 2026 leave balances

**Evidence**:

1. **No `leave_balance_ledger` table** in db_bill
   - mas_hrms uses: `leave_balance_ledger` (modern schema)
   - db_bill has: `leave_balance` (legacy schema)

2. **Legacy `leave_balance` table** has only 2017 data:
   ```
   Year: 2017
   Records: 1
   Latest Date: 2017-08-03
   ```

3. **Different Schema**:
   - db_bill schema: `EmpCode, BalancePl, BalanceCL, BalanceSL, LeaveDate`
   - mas_hrms schema: `employee_id, leave_type_id, balance_year, allocated_days, used_days`

---

## 📊 db_bill Leave Tables Found

| Table Name | Purpose | Latest Data |
|-----------|---------|-------------|
| `leave_balance` | Legacy balance tracking | 2017 |
| `leave_management` | Leave applications/requests | Current |
| `leave_approval` | Approval workflow | Current |
| `qual_leave` | Unknown (legacy) | Old |
| `continuously_leave` | Unknown | Old |

**Conclusion**: db_bill is a **legacy system** with old leave balance structure

---

## 🎯 The Truth About Leave Balances

### Where 2025 Balances Come From

**In mas_hrms**:
- 2025 balances: 7,655 records (last updated 3 hours ago)
- Last updated: 2026-06-11 18:09:06

**These were NOT synced from db_bill!**

**Possible Sources**:
1. Manual allocation via HRMS admin panel
2. Separate allocation script (not `sync-from-db-bill.mjs`)
3. Direct database inserts by HR team
4. Migration from another system

---

## ✅ What `sync-from-db-bill.mjs` Actually Does

**Syncs**:
- ✅ Branches (from `branch_master`)
- ✅ Departments (from `department`)
- ✅ Designations (from `designation`)
- ✅ Cost Centres (from `cost_center`)
- ✅ Processes (from `processes`)
- ✅ Employees (from `employee_master`)

**Does NOT Sync**:
- ❌ Leave balances (table doesn't exist in db_bill)
- ❌ Leave requests
- ❌ Attendance
- ❌ Payroll

---

## 🎯 Solution: Allocate 2026 Balances in mas_hrms

### Why We Need This

1. ❌ db_bill doesn't have 2026 balances
2. ❌ No sync script brings them over
3. ✅ We have working 2025 structure to copy from
4. ✅ All employees already in mas_hrms

### Option 1: Run SQL Allocation Script ⭐ RECOMMENDED

**Use our prepared script**:
```bash
mysql -h 122.184.128.90 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms < scripts/allocate-2026-leave-balances.sql
```

**What it does**:
1. Copies 2025 leave balance structure
2. Creates 2026 entries for all 1,531 active employees
3. Resets `used_days` to 0
4. Preserves `allocated_days` from 2025

**Expected Result**:
- Before: 13 records (demo only)
- After: ~7,655 records (all employees)

**Time**: ~2 minutes

---

### Option 2: Via HRMS Admin Panel

If the admin panel has a "Allocate Leave Balances" feature:
1. Login as admin
2. Navigate to Leave Management
3. Select "Allocate Balances for 2026"
4. Click "Allocate for All Employees"

---

### Option 3: Manual API Call

If there's a seed endpoint (from leave.routes.ts line 143):
```bash
curl -X POST http://localhost:5055/api/leave/balance/seed \
  -H "Authorization: Bearer [ADMIN_TOKEN]" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "employee_id": "...",
      "leave_type_id": "...",
      "year": 2026,
      "allocated_days": 12
    }
  ]'
```

---

## 📋 Verification After Allocation

### Check Total Count
```sql
mysql -h 122.184.128.90 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms -e "
SELECT 
  balance_year,
  COUNT(*) as records,
  COUNT(DISTINCT employee_id) as employees
FROM leave_balance_ledger
GROUP BY balance_year
ORDER BY balance_year DESC;
"
```

**Expected**:
```
2026 | ~7,655 | 1,531
2025 | 7,655  | 1,531
```

---

### Check Specific Employee (Naresh)
```sql
mysql -h 122.184.128.90 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms -e "
SELECT 
  e.employee_code,
  e.first_name,
  ltm.leave_name,
  lbl.balance_year,
  lbl.allocated_days,
  lbl.used_days
FROM leave_balance_ledger lbl
JOIN employees e ON e.id = lbl.employee_id
JOIN leave_type_master ltm ON ltm.id = lbl.leave_type_id
WHERE e.email = 'NARESH.CHAUHAN@TEAMMAS.IN'
  AND lbl.balance_year = 2026
ORDER BY ltm.leave_name;
"
```

**Expected**: Multiple leave types (CL, EL, SL, etc.) for 2026

---

## 🎯 Complete Picture

### Data Flow (Reality)

```
db_bill (Legacy System)
   │
   ├─> employee_master ──────┐
   ├─> branch_master ────────┤
   ├─> department ───────────┤
   └─> designation ──────────┤
                             │
                      sync-from-db-bill.mjs
                             │
                             ▼
                      mas_hrms (Modern HRMS)
                             │
                             ├─> employees (synced)
                             ├─> branches (synced)
                             ├─> departments (synced)
                             │
                             ├─> leave_balance_ledger (NOT synced)
                             │   └─> 2025: Manually allocated
                             │   └─> 2026: NEEDS allocation
                             │
                             └─> Frontend (React)
                                 └─> Shows 2025 as fallback ✅
```

---

## ✅ Current Workaround Status

### Frontend Fix ✅ DEPLOYED
- **File**: `src/hooks/useLeaveBalances.ts`
- **Logic**: Try 2026, fallback to 2025
- **Result**: Users see their leave balances (2025 data)
- **Warning**: Shows "(2026 balances not yet allocated)"

**This means**: System is functional even without 2026 allocation!

---

## 🎯 Recommended Action Plan

### Immediate (Now)
✅ **Already Done** - Frontend shows 2025 balances as fallback

### Short-term (This Week)
⏸️ **Run SQL Script** - Allocate 2026 balances for all employees
```bash
mysql -h 122.184.128.90 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms < scripts/allocate-2026-leave-balances.sql
```

### Medium-term (This Month)
- Create annual leave allocation process
- Document who allocates leave balances
- Add admin panel feature for bulk allocation

### Long-term (Next Quarter)
- Automate annual rollover (Jan 1st each year)
- Add carry-forward logic
- Create allocation audit trail

---

## 📊 Summary Table

| Aspect | Status | Action |
|--------|--------|--------|
| **db_bill has 2026 balances?** | ❌ NO | n/a |
| **mas_hrms has 2026 balances?** | ⚠️ Only demo (13 records) | Run SQL script |
| **Frontend shows balances?** | ✅ YES (using 2025 fallback) | None needed |
| **Users blocked?** | ❌ NO | None needed |
| **Data loss risk?** | ❌ NO | None |
| **SQL script ready?** | ✅ YES | Execute when ready |

---

## 🎉 Bottom Line

### Misconception Cleared ✅
- **Claim**: "2026 balances in db_bill"
- **Reality**: db_bill is legacy, doesn't have modern leave balance structure
- **Impact**: Zero - frontend already handles this gracefully

### System Status ✅
- **Current**: Fully functional (showing 2025 balances)
- **Next**: Allocate 2026 balances for better UX
- **Priority**: Low (users aren't blocked)

### Action Required ⏸️
**Optional** (for cleaner UX): Run the SQL allocation script

**Command**:
```bash
mysql -h 122.184.128.90 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms < /home/shuvam/hrms-audit/scripts/allocate-2026-leave-balances.sql
```

---

**Investigation Complete!** ✅  
**System Functional!** ✅  
**2026 Allocation Optional!** ⏸️
