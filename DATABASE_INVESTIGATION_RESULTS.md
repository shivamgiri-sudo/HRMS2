# HRMS Database Investigation Results

**Date**: 2026-06-11  
**Database Host**: 122.184.128.90  
**Database User**: shivam_user  
**Primary DB**: mas_hrms

---

## ✅ Database Connection SUCCESS

Successfully connected to:
- `mas_hrms` - Primary HRMS database
- `Shivamgiri` - Supporting database
- `db_audit` - Audit database
- `db_external` - External database
- `dialer_db` - Dialer database

---

## 📊 Data Statistics (mas_hrms)

| Metric | Count | Status |
|--------|-------|--------|
| **Total Active Employees** | 1,531 | ✅ Good |
| **Employees with DOB** | 1,518 (99%) | ✅ Good |
| **Employees with Photos** | 0 (0%) | ❌ **ISSUE** |
| **Leave Balances (Total)** | 7,668 | ✅ Good |
| **Leave Balances (2026)** | 13 | ❌ **ISSUE** |
| **Leave Balances (2025)** | 7,655 | ✅ Good |
| **Leave Types Configured** | 11 | ✅ Good |

---

## 🔍 Specific Employee Test: Naresh Chauhan

```sql
SELECT id, employee_code, first_name, email, date_of_birth, photo_url, user_id 
FROM employees 
WHERE email LIKE '%naresh.chauhan%';
```

**Results**:
```
ID: 0000bf5c-5e8b-11f1-adb1-00155d0ab410
Employee Code: MAS00175
Name: NARESH KUMAR CHAUHAN
Email: NARESH.CHAUHAN@TEAMMAS.IN
DOB: ✅ 1978-08-25 (EXISTS!)
Photo: ❌ NULL
User ID: ✅ 67a1f32f-6364-11f1-adb1-00155d0ab410 (LINKED)
```

**Leave Balances for 2026**: ❌ **NONE** (only demo employees have 2026 balances)

---

## 🐛 ROOT CAUSES IDENTIFIED

### 1. ✅ Dashboard Name Display - FIXED
**Issue**: Showing email instead of name  
**Root Cause**: Frontend was using `user.email` instead of employee profile data  
**Status**: ✅ **FIXED** - Now uses `useEmployeeProfile()` hook

---

### 2. ❌ DOB Not Showing in Profile
**Issue**: DOB field appears empty despite data existing  
**Root Cause**: **FALSE ALARM** - DOB EXISTS in database (1978-08-25)

**Actual Problem**: Frontend date display or API response format issue

**Investigation**:
1. ✅ Database has DOB: `1978-08-25`
2. ✅ Backend `/api/employees/me` includes `date_of_birth` in SELECT
3. ❓ Need to check if API is returning it correctly
4. ❓ Need to check if frontend is displaying it correctly

**Fix Needed**: Test the `/api/employees/me` endpoint response in browser

---

### 3. ❌ Leave Balance Not Showing
**Issue**: Leave balance widget shows "No leave balances set up yet"  
**Root Cause**: **Only 2025 balances exist, not 2026**

**Current State**:
- 2025 balances: 7,655 records ✅
- 2026 balances: 13 records (only demo employees) ❌
- Frontend requests `currentYear` (2026) by default
- Most real employees have NO 2026 allocation yet

**Who Has 2026 Balances**:
```
emp-admin-001    (Demo Admin)
emp-employee-001 (Demo Employee)
emp-hr-001       (Demo HR)
emp-manager-001  (Demo Manager)
emp-tl-001       (Demo TL)
```

**Fix Options**:
1. **Immediate**: Modify frontend to try 2026, fallback to 2025
2. **Short-term**: Bulk allocate 2026 balances for all employees
3. **Long-term**: Create annual leave allocation cron job

---

### 4. ❌ Employee Photos Missing
**Issue**: No photos displayed anywhere  
**Root Cause**: **ALL photo_url columns are NULL (0 out of 1,531)**

**Current State**:
- Database column exists: `employees.photo_url`
- All values: `NULL`
- Frontend has Avatar component with initials fallback (working)

**Fix Options**:
1. **Immediate**: Keep initials fallback (already working)
2. **Short-term**: Add photo upload feature
3. **Long-term**: Integrate with external photo service or AD

---

### 5. ❓ Pages Not Loading - NEEDS TESTING
**Issue**: Some pages fail to load after clicking  
**Status**: Cannot verify without browser testing

**Next Steps**:
1. Open http://localhost:8080 in browser
2. Login with valid credentials
3. Test each menu item
4. Check browser console for errors
5. Report specific failing pages

---

## 🔧 Database Schema Corrections

### Table Name Mismatches Found & Fixed

| Expected (in code) | Actual (in DB) | Status |
|-------------------|----------------|--------|
| `leave_types` | `leave_type_master` | ⚠️ Check backend code |

**Backend Uses Correct Names**: ✅ Verified that `leave.service.ts` uses `leave_type_master`

---

## 📋 Action Items

### Priority 1: Leave Balance Display (15 min)

**Option A: Frontend Fallback (Quick Fix)**
```typescript
// In useLeaveBalances.ts
const currentYear = new Date().getFullYear();
const fallbackYear = currentYear - 1;

// Try current year first, then previous year
let balances = await fetchBalances(employeeId, currentYear);
if (!balances || balances.length === 0) {
  balances = await fetchBalances(employeeId, fallbackYear);
}
```

**Option B: Bulk Allocate 2026 (Proper Fix)**
```sql
-- Create 2026 balances by copying 2025 structure
INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
SELECT 
  UUID(), 
  employee_id, 
  leave_type_id, 
  2026, 
  allocated_days, 
  0 as used_days, 
  0 as adjusted_days
FROM leave_balance_ledger 
WHERE balance_year = 2025 
  AND employee_id IN (SELECT id FROM employees WHERE active_status = 1)
ON DUPLICATE KEY UPDATE allocated_days = VALUES(allocated_days);
```

---

### Priority 2: DOB Display Verification (5 min)

**Test API Response**:
```bash
# Login to get token first via browser
# Then test:
curl http://localhost:5055/api/employees/me \
  -H "Authorization: Bearer [YOUR_TOKEN]" | jq '.data.date_of_birth'
```

**Expected**: `"1978-08-25"`  
**If NULL**: Backend issue  
**If Exists**: Frontend display issue

---

### Priority 3: Photo Upload Feature (2 hours)

**Backend Changes**:
1. Add `POST /api/employees/me/photo` endpoint
2. Accept multipart/form-data file upload
3. Save to `/uploads/employee-photos/`
4. Update `employees.photo_url` with path

**Frontend Changes**:
1. Add photo upload button in Profile page
2. Use `<input type="file" accept="image/*">`
3. Show upload progress
4. Refresh profile after upload

---

### Priority 4: Page Navigation Testing (30 min)

**Test Checklist**:
```
[ ] Dashboard - Shows name correctly ✅
[ ] Profile - Personal Info tab
[ ] Profile - Leaves tab
[ ] Profile - Attendance tab
[ ] Profile - Payslips tab
[ ] Profile - Documents tab
[ ] Profile - Assets tab
[ ] Profile - Reviews tab
[ ] Leave Requests - List
[ ] Leave Requests - Apply New
[ ] Attendance - My Attendance
[ ] Attendance - Regularization
[ ] Payroll - Payslips
[ ] Assets - My Assets
```

---

## 🎯 Immediate Fixes to Deploy

### Fix 1: Leave Balance Year Fallback

**File**: `/src/hooks/useLeaveBalances.ts`

```typescript
export function useLeaveBalances(employeeId: string | undefined) {
  const currentYear = new Date().getFullYear();

  return useQuery({
    queryKey: ["leave-balances", employeeId, currentYear],
    queryFn: async () => {
      if (!employeeId) return [];

      // Try current year first
      let res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/leave/balance/${employeeId}?year=${currentYear}`
      );
      let rows = res.data ?? [];

      // Fallback to previous year if no balances found
      if (rows.length === 0) {
        res = await hrmsApi.get<{ success: boolean; data: any[] }>(
          `/api/leave/balance/${employeeId}?year=${currentYear - 1}`
        );
        rows = res.data ?? [];
      }

      return rows.map((row: any): LeaveBalance => ({
        id: row.id ?? row.leave_type_id,
        leave_type: {
          name: row.leave_name ?? row.leave_code ?? "Unknown",
          is_paid: row.paid_leave != null ? Boolean(row.paid_leave) : null,
        },
        total_days: Number(row.allocated_days ?? 0),
        used_days: Number(row.used_days ?? 0),
        year: Number(row.balance_year ?? currentYear),
      }));
    },
    enabled: !!employeeId,
  });
}
```

---

### Fix 2: Show Year in Leave Balance Card

**File**: `/src/components/profile/LeaveBalanceCard.tsx`

Update the card description to show which year's data is displayed:

```typescript
const displayYear = balances && balances.length > 0 ? balances[0].year : currentYear;

<CardDescription>
  Your available leave days for {displayYear}
  {displayYear < currentYear && (
    <span className="text-amber-600 ml-2">
      (2026 balances not yet allocated)
    </span>
  )}
</CardDescription>
```

---

## 📝 SQL Scripts for Admin

### Script 1: Allocate 2026 Leave Balances (RUN THIS!)

```sql
-- Copy 2025 structure to create 2026 balances for all active employees
INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days, created_at)
SELECT 
  UUID(), 
  lbl.employee_id, 
  lbl.leave_type_id, 
  2026, 
  lbl.allocated_days, 
  0, 
  0,
  NOW()
FROM leave_balance_ledger lbl
INNER JOIN employees e ON e.id = lbl.employee_id
WHERE lbl.balance_year = 2025 
  AND e.active_status = 1
  AND NOT EXISTS (
    SELECT 1 FROM leave_balance_ledger lbl2 
    WHERE lbl2.employee_id = lbl.employee_id 
      AND lbl2.leave_type_id = lbl.leave_type_id 
      AND lbl2.balance_year = 2026
  );

-- Verify
SELECT 
  balance_year, 
  COUNT(*) as records,
  COUNT(DISTINCT employee_id) as unique_employees
FROM leave_balance_ledger
GROUP BY balance_year
ORDER BY balance_year DESC;
```

---

## ✅ Summary

### Working ✅
1. Database connection to mas_hrms
2. Employee data (1,531 active employees)
3. DOB data (99% populated)
4. Leave types configured (11 types)
5. 2025 leave balances (7,655 records)
6. Dashboard name display (fixed)

### Broken ❌
1. 2026 leave balances (only 13 demo records)
2. Employee photos (all NULL)
3. Unknown page navigation issues (needs browser testing)

### Next Steps 🎯
1. **Deploy Fix 1**: Leave balance year fallback (5 min)
2. **Run SQL Script 1**: Allocate 2026 balances (2 min)
3. **Test in Browser**: Verify fixes and find remaining issues (15 min)
4. **Plan Photo Upload**: Design and implement feature (2 hours)

---

**Ready to test!** 🚀
