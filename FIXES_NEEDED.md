# HRMS Issues to Fix

**Date**: 2026-06-11  
**Current Branch**: main (0cfcc7d)  
**Database**: mas_hrms @ 192.168.10.6

---

## Issues Reported

### 1. ✅ Dashboard shows email instead of name
**Issue**: Home page greeting shows "Good evening, naresh.chauhan@teammas.in" instead of employee name

**Status**: ✅ **FIXED**

**Changes Made**:
- Created `/src/hooks/useEmployeeProfile.ts` - New hook to fetch employee profile data
- Updated `/src/pages/Index.tsx`:
  - Import `useEmployeeProfile` hook
  - Modified `getUserFirstName()` to use `employeeProfile.first_name` instead of `user.email`
  - Fallback hierarchy: first_name → full_name → email username

**Result**: Dashboard now displays actual employee name from `/api/employees/me`

---

### 2. ⏸️ DOB not reflecting in user profile
**Issue**: Date of Birth field is empty in profile page

**Investigation Needed**:
- ✅ Frontend: Profile.tsx correctly displays `employee.date_of_birth`
- ✅ Backend: `/api/employees/me` includes `date_of_birth` in SELECT
- ❓ Database: Need to verify if `employees.date_of_birth` column has data

**Next Steps**:
```sql
-- Check if DOB data exists
SELECT employee_code, first_name, date_of_birth 
FROM employees 
WHERE active_status = 1 AND date_of_birth IS NOT NULL 
LIMIT 10;

-- Check specific employee
SELECT * FROM employees WHERE email = 'naresh.chauhan@teammas.in';
```

**Possible Causes**:
1. Database column is NULL for most employees
2. Date format mismatch (MySQL DATE vs frontend date-input format)
3. Sync script from db_bill not including DOB

---

### 3. ⏸️ Leave balance not reflecting
**Issue**: Leave balance section not showing data

**Investigation Needed**:
- ✅ Frontend: `LeaveBalanceCard.tsx` uses `useLeaveBalances(employeeId)`
- ✅ Backend API: `/api/leave/balance/:employeeId`
- ❓ Database: Check if `leave_balance_ledger` table has data

**Next Steps**:
```sql
-- Check leave balance data
SELECT COUNT(*) FROM leave_balance_ledger;

-- Check for specific employee
SELECT lbl.*, lt.name as leave_type_name
FROM leave_balance_ledger lbl
LEFT JOIN leave_types lt ON lt.id = lbl.leave_type_id
WHERE lbl.employee_id = (SELECT id FROM employees WHERE email = 'naresh.chauhan@teammas.in' LIMIT 1);

-- Check leave types configured
SELECT * FROM leave_types WHERE active_status = 1;
```

**Possible Causes**:
1. No leave balances allocated in database
2. `leave_balance_ledger` table empty
3. Leave types not configured
4. Employee ID mismatch

---

### 4. ⏸️ Employee photo section missing
**Issue**: Employee photo/avatar not displayed on dashboard or profile

**Investigation Needed**:
- ✅ Frontend: Profile uses `Avatar` component with `avatar_url`
- ✅ Backend: `/api/employees/me` returns `photo_url as avatar_url`
- ❓ Database: Check if `employees.photo_url` has values
- ❓ File Storage: Check if photos exist at the path

**Next Steps**:
```sql
-- Check photo URLs
SELECT employee_code, first_name, photo_url 
FROM employees 
WHERE photo_url IS NOT NULL 
LIMIT 10;
```

**Possible Fixes**:
1. Add photo upload functionality
2. Default avatar based on initials (already implemented as fallback)
3. Sync photos from db_bill if available

---

### 5. ⏸️ Pages not loading after clicking
**Issue**: Some pages fail to load or show errors

**Investigation Needed**:
- Check browser console for errors
- Check backend logs for API failures
- Test each navigation link

**Next Steps**:
1. Test all menu items:
   - Dashboard ✅
   - Profile ⏸️
   - Attendance ⏸️
   - Leave ⏸️
   - Payroll ⏸️
   - Assets ⏸️
   - Performance ⏸️
2. Check for:
   - 404 errors (missing API endpoints)
   - 500 errors (backend crashes)
   - CORS issues
   - Auth token expiry

---

### 6. ⏸️ Pages not pulling data from mas_hrms
**Issue**: Some pages still querying wrong database or not showing data

**Investigation Needed**:
- ✅ Backend using `mas_hrms` (verified in RESUME.md)
- ✅ All services import from `db/mysql.js`
- ❓ Check which specific pages/tables have issues

**Tables to Verify**:
```sql
-- Core tables that should have data
SELECT 'employees' as tbl, COUNT(*) as cnt FROM employees WHERE active_status = 1
UNION ALL SELECT 'leave_requests', COUNT(*) FROM leave_requests
UNION ALL SELECT 'leave_balance_ledger', COUNT(*) FROM leave_balance_ledger
UNION ALL SELECT 'attendance_logs', COUNT(*) FROM attendance_logs
UNION ALL SELECT 'payroll_runs', COUNT(*) FROM payroll_runs
UNION ALL SELECT 'assets', COUNT(*) FROM assets
UNION ALL SELECT 'performance_reviews', COUNT(*) FROM performance_reviews;
```

---

## Action Plan

### Priority 1: Data Verification (30 min)
1. Connect to mas_hrms database
2. Check employee table data completeness:
   - DOB column population rate
   - photo_url population rate
   - Email vs name availability
3. Check leave_balance_ledger table
4. Check leave_types configuration
5. Document findings

### Priority 2: Frontend Fixes (30 min)
- ✅ Dashboard name display
- ⏸️ Profile photo fallback (already has initials)
- ⏸️ Empty state messages for missing data
- ⏸️ Error boundaries for failing pages

### Priority 3: Backend Data Population (1-2 hours)
1. If DOB missing: Add to db_bill sync script
2. If leave balances missing: Create leave allocation script
3. If photos missing: Add photo upload or default generation

### Priority 4: Page Navigation Testing (1 hour)
1. Test all routes systematically
2. Fix broken API calls
3. Add loading states
4. Add error handling

---

## Database Schema Verification

**Expected Tables** (from migrations):
- `employees` ✅
- `leave_types` ❓
- `leave_balance_ledger` ❓
- `leave_requests` ❓
- `attendance_logs` ❓
- `payroll_runs` ❓
- `assets` ❓
- `performance_reviews` ❓

**To Check**:
```bash
mysql -h 192.168.10.6 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms -e "SHOW TABLES;"
```

---

## Testing Checklist

### Dashboard
- [x] Greeting shows employee name (not email)
- [ ] Employee photo/avatar displays
- [ ] Leave balance widget shows data
- [ ] Quick actions work
- [ ] Recent activity loads

### Profile Page
- [ ] Personal info section loads
- [ ] DOB field populated
- [ ] Photo/avatar displays
- [ ] Edit functionality works
- [ ] Leave balance card shows data
- [ ] Leave request form submits
- [ ] Attendance history loads
- [ ] Payslips load
- [ ] Documents load

### Navigation
- [ ] All menu items clickable
- [ ] No 404 errors
- [ ] No console errors
- [ ] Loading states show properly
- [ ] Error states show helpful messages

---

**Next Command**:
```bash
# Test database connection and check data
mysql -h 192.168.10.6 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms -e "
SELECT 
  (SELECT COUNT(*) FROM employees WHERE active_status = 1) as total_employees,
  (SELECT COUNT(*) FROM employees WHERE active_status = 1 AND date_of_birth IS NOT NULL) as employees_with_dob,
  (SELECT COUNT(*) FROM employees WHERE active_status = 1 AND photo_url IS NOT NULL) as employees_with_photo,
  (SELECT COUNT(*) FROM leave_balance_ledger) as leave_balances,
  (SELECT COUNT(*) FROM leave_types WHERE active_status = 1) as leave_types_configured;
"
```
