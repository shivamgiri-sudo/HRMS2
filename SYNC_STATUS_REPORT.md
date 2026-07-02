# HRMS-db-bill-sync Status Report

**Date**: 2026-06-11 21:52 IST  
**Database**: mas_hrms @ 122.184.128.90

---

## 🔍 Investigation Results

### ❓ Is HRMS-db-bill-sync Task Running?

**Answer**: ⚠️ **UNKNOWN** - Cannot verify on this machine (Linux)

**Why**: 
- RESUME.md mentions: "Windows scheduled task `HRMS-db-bill-sync`"
- This task would be on a **Windows server**, not this Linux machine
- No process running `sync-from-db-bill.mjs` on this system

---

## ✅ What IS Working

### 1. Employee Sync Status
```
Last Employee Updated: 2026-06-11 21:14:08 (30 minutes ago)
Last Employee Created:  2026-06-11 16:31:43 (5 hours ago)
Total Active Employees: 1,531
```

**Conclusion**: ✅ **Employee sync IS working** - data is fresh!

---

### 2. Leave Balance Sync Status

```sql
Balance Year | Records | Employees | Last Updated
-------------|---------|-----------|------------------
2025         | 7,655   | 1,531     | 2026-06-11 18:09:06 (3 hours ago)
2026         | 13      | 5 (demo)  | 2026-06-01 13:18:19 (10 days ago)
```

**Analysis**:
- ✅ 2025 balances: Updated 3 hours ago (7,655 records for all 1,531 employees)
- ❌ 2026 balances: Only 13 demo records, last updated 10 days ago

---

## 📋 What Sync Script Does

**File**: `/home/shuvam/hrms-audit/scripts/sync-from-db-bill.mjs`

**Syncs From**: db_bill @ 192.168.10.22:3306

**Syncs To**: mas_hrms @ 192.168.10.6:3306

**What It Syncs**:
1. ✅ Branches
2. ✅ Departments  
3. ✅ Designations
4. ✅ Cost Centres
5. ✅ Processes
6. ✅ Employees (including bank & statutory details)

**What It DOESN'T Sync**:
- ❌ Leave balances
- ❌ Leave requests
- ❌ Attendance logs
- ❌ Payroll data
- ❌ Assets
- ❌ Performance reviews

---

## 🔑 Key Findings

### 1. Leave Balances Are NOT Auto-Synced ⚠️

**You said**: "leave balance for 2026 is already there in db_bill"

**Reality**:
- `sync-from-db-bill.mjs` **does NOT sync leave balances**
- 2026 balances in db_bill are **NOT being synced** to mas_hrms
- Only 13 demo records exist for 2026 in mas_hrms

**Why**:
- The sync script was designed only for master data + employees
- Leave balances need a separate sync mechanism

---

### 2. 2025 Balances ARE Being Updated ✅

**Evidence**:
- Last update: 18:09:06 (3 hours ago)
- All 1,531 employees have 2025 balances

**This means**: There IS a process updating leave balances, but:
- It's not the `sync-from-db-bill.mjs` script
- It might be a different script or manual process
- It's only updating 2025, not 2026

---

## 🎯 Action Items

### Option 1: Extend Existing Sync Script ⭐ RECOMMENDED

**Add leave balance sync to**: `scripts/sync-from-db-bill.mjs`

**Pseudo-code**:
```javascript
async function syncLeaveBalances(src, tgt) {
  log('Syncing leave balances from db_bill...');
  
  // Get 2026 balances from db_bill
  const [srcBalances] = await src.execute(`
    SELECT * FROM leave_balance_ledger 
    WHERE balance_year = 2026
  `);
  
  // Upsert into mas_hrms
  for (const bal of srcBalances) {
    await tgt.execute(`
      INSERT INTO leave_balance_ledger 
      (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        allocated_days = VALUES(allocated_days),
        updated_at = NOW()
    `, [bal.id, bal.employee_id, bal.leave_type_id, bal.balance_year, 
        bal.allocated_days, bal.used_days, bal.adjusted_days]);
  }
  
  log(`Synced ${srcBalances.length} leave balance records`);
}
```

---

### Option 2: Create Separate Leave Sync Script

**File**: `scripts/sync-leave-balances-from-db-bill.mjs`

**Schedule**: Run once when 2026 starts, then periodically

**Schedule on Windows Task Scheduler**:
- Daily at 6 AM
- Or after employee sync completes

---

### Option 3: Use SQL Script (One-Time)

**If db_bill 2026 data is complete**:

1. Export from db_bill:
```bash
mysqldump -h 192.168.10.22 -u shivam_user -p'qwersdfg!@#hjk' db_bill leave_balance_ledger \
  --where="balance_year=2026" > leave_2026_export.sql
```

2. Import to mas_hrms:
```bash
mysql -h 192.168.10.6 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms < leave_2026_export.sql
```

---

## 📊 Database Connection Status

### Public IP (122.184.128.90)
✅ **Connected Successfully**
- mas_hrms accessible
- Can query and modify data
- Used for investigation

### Internal IPs (Not Accessible from This Machine)
❌ **Cannot Connect** (network/firewall)
- 192.168.10.6 (mas_hrms target)
- 192.168.10.22 (db_bill source)

**Note**: These IPs work from the Windows server where sync runs

---

## 🔍 Verification Queries

### Check if 2026 balances exist in mas_hrms
```sql
mysql -h 122.184.128.90 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms -e "
SELECT 
  COUNT(*) as total_2026_balances,
  COUNT(DISTINCT employee_id) as employees_with_2026
FROM leave_balance_ledger 
WHERE balance_year = 2026;
"
```

**Current Result**: 13 records, 5 employees (demo only)

---

### Check specific employee (Naresh)
```sql
mysql -h 122.184.128.90 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms -e "
SELECT lbl.*, ltm.leave_name
FROM leave_balance_ledger lbl
JOIN leave_type_master ltm ON ltm.id = lbl.leave_type_id
WHERE lbl.employee_id = '0000bf5c-5e8b-11f1-adb1-00155d0ab410'
  AND lbl.balance_year IN (2025, 2026);
"
```

**Expected**: 
- 2025: Multiple records ✅
- 2026: No records ❌

---

## 🎯 Summary & Recommendation

### Current State
- ✅ Employee sync: Working (last updated 30 min ago)
- ✅ 2025 leave balances: Working (7,655 records)
- ❌ 2026 leave balances: NOT syncing (only 13 demo records)

### Root Cause
- **Sync script doesn't include leave balances**
- **Even if db_bill has 2026 data, it's not being copied**

### Immediate Solution
Since we already have the frontend fix that falls back to 2025:
- ✅ Users will see their 2025 balances (better than nothing)
- ✅ Warning message shows: "(2026 balances not yet allocated)"

### Long-term Solution
1. **Check db_bill** on internal network:
   ```sql
   SELECT COUNT(*) FROM leave_balance_ledger WHERE balance_year = 2026;
   ```

2. **If 2026 data exists in db_bill**: Extend sync script to include it

3. **If 2026 data NOT in db_bill**: Run allocation script:
   ```bash
   mysql -h 122.184.128.90 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms < scripts/allocate-2026-leave-balances.sql
   ```

---

## ✅ What You Need To Do

### Step 1: Check db_bill (from Windows server)
```sql
USE db_bill;
SELECT balance_year, COUNT(*) 
FROM leave_balance_ledger 
GROUP BY balance_year;
```

### Step 2A: If 2026 exists in db_bill
- Modify `sync-from-db-bill.mjs` to include leave balances
- Or create separate leave sync script
- Schedule it on Windows Task Scheduler

### Step 2B: If 2026 NOT in db_bill  
- Run the allocation script we created:
```bash
mysql -h 122.184.128.90 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms < scripts/allocate-2026-leave-balances.sql
```

---

**Status**: 🔍 **Investigation Complete**  
**Next**: Check db_bill for 2026 data, then choose sync or allocation approach
