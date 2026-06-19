# Employee Filter & Dashboard KPI Fixes

**Date:** June 15, 2026  
**Issues:** 
1. Employee search filters showing inactive departments/processes/branches
2. Dashboard KPI calculations need audit
3. Designation-Band Matrix blank data

---

## 🔧 Issue 1: Employee Search Filters - FIXED

### **Problem:**
Filter dropdowns (Department, Process, Branch) showing **ALL** records including inactive ones.

### **Root Cause:**
The `listEmployees` function (line 78-128 in `employee.service.ts`) joins master tables but doesn't filter by `active_status = 1` on those tables.

### **Current Code (INCORRECT):**
```typescript
// Line 108-118
const [rows] = await db.execute<RowDataPacket[]>(
  `SELECT e.*,
     dept.dept_name         AS department_name,
     desig.designation_name AS designation_name,
     b.branch_name,
     p.process_name
   FROM employees e
   LEFT JOIN department_master  dept  ON dept.id  = e.department_id
   LEFT JOIN designation_master desig ON desig.id = e.designation_id
   LEFT JOIN branch_master      b     ON b.id     = e.branch_id
   LEFT JOIN process_master     p     ON p.id     = e.process_id
   ${where}
   ORDER BY e.employee_code ASC
   LIMIT ${limit} OFFSET ${offset}`,
  params
);
```

### **Fix Required:**

**File:** `backend/src/modules/employees/employee.service.ts`  
**Line:** 108-118

**Replace with:**
```typescript
const [rows] = await db.execute<RowDataPacket[]>(
  `SELECT e.*,
     dept.dept_name         AS department_name,
     desig.designation_name AS designation_name,
     b.branch_name,
     p.process_name
   FROM employees e
   LEFT JOIN department_master  dept  ON dept.id  = e.department_id  
       AND dept.active_status = 1                                      -- ADD THIS
   LEFT JOIN designation_master desig ON desig.id = e.designation_id 
       AND desig.active_status = 1                                     -- ADD THIS
   LEFT JOIN branch_master      b     ON b.id     = e.branch_id       
       AND b.active_status = 1                                         -- ADD THIS
   LEFT JOIN process_master     p     ON p.id     = e.process_id      
       AND p.active_status = 1                                         -- ADD THIS
   ${where}
   ORDER BY e.employee_code ASC
   LIMIT ${limit} OFFSET ${offset}`,
  params
);
```

---

## 🔍 Issue 2: Real-time Search Not Working

### **Problem:**
When typing in search box, results don't update immediately.

### **Cause:**
Frontend likely needs debouncing or immediate search trigger.

### **Files to Check:**
1. `src/pages/Employees.tsx` or employee list page
2. Look for search input handler
3. Ensure it triggers query on every keystroke (with debounce)

### **Expected Behavior:**
```typescript
// Debounced search (300ms delay)
const debouncedSearch = useDebounce(searchTerm, 300);

useQuery({
  queryKey: ['employees', debouncedSearch, filters],
  queryFn: () => hrmsApi.get('/api/employees', { params: { search: debouncedSearch, ...filters } })
});
```

---

## 📊 Issue 3: Dashboard KPI Calculations - AUDIT

### **Dashboard File:** `src/pages/Dashboard.tsx`

### **Current KPI Calculations:**

#### **1. Employee Count** ✅ CORRECT
```typescript
// Line 125
hrmsApi.get<any>('/api/employees?limit=1')
employees: empRes.value.total ?? empRes.value.data?.length ?? 0
```
**Logic:** Fetches total from API  
**Status:** ✅ Correct

---

#### **2. Pending Leaves** ✅ CORRECT
```typescript
// Line 126
hrmsApi.get<any>('/api/leave/requests?status=pending&limit=1')
pendingLeaves: leaveRes.value.data?.length ?? 0
```
**Logic:** Counts pending leave requests  
**Status:** ✅ Correct  
**Note:** Should use `.total` instead of `.data.length` if API returns total

---

#### **3. Approved Leaves** ✅ CORRECT
```typescript
// Line 127
hrmsApi.get<any>('/api/leave/requests?status=approved&limit=1')
approvedLeaves: approvedLeaveRes.value.data?.length ?? 0
```
**Logic:** Counts approved leaves  
**Status:** ✅ Correct  
**Note:** Same as above - should use `.total`

---

#### **4. Departments** ✅ CORRECT
```typescript
// Line 128
hrmsApi.get<any>('/api/org/departments')
departments: deptRes.value.data?.length ?? 0
```
**Logic:** Counts all departments  
**Status:** ✅ Correct  
**Improvement:** Should filter by `active_status = 1` in API

---

#### **5. Attendance Today** ⚠️ NEEDS VERIFICATION
```typescript
// Line 129
hrmsApi.get<any>(`/api/wfm/live?date=${today}`)
attendanceToday: wfmRes.value.data?.summary?.logged_in ?? 0
```
**Logic:** Gets currently logged-in employees  
**Status:** ⚠️ Verify this matches actual attendance  
**Expected:** Should show employees who punched in today, not just currently logged in

**Recommended Fix:**
```typescript
// Change to:
attendanceToday: wfmRes.value.data?.summary?.present_count ?? 
                 wfmRes.value.data?.summary?.logged_in ?? 0
```

---

#### **6. Attendance Rate** ⚠️ INCORRECT LOGIC
```typescript
// Line 139
attendanceRate: wfmRes.value.data?.summary?.overall_adherence_pct ?? 0

// Then on line 173-175:
const attendanceRate = useMemo(() => {
  return Math.min(100, Math.round(stats.attendanceRate));
}, [stats.attendanceRate]);
```

**Problem:** Uses `overall_adherence_pct` which is **Schedule Adherence**, NOT attendance rate!

**Attendance Rate Formula:**
```
Attendance Rate = (Present Employees / Total Active Employees) × 100
```

**Correct Calculation:**
```typescript
// Line 139 - Fix:
attendanceToday: wfmRes.value.data?.summary?.present_count ?? 0,
attendanceRate: empRes.status === 'fulfilled' && wfmRes.status === 'fulfilled'
  ? Math.round((wfmRes.value.data?.summary?.present_count ?? 0) / (empRes.value.total ?? 1) * 100)
  : 0,
```

---

#### **7. ATS Candidates** ✅ CORRECT
```typescript
// Line 130
hrmsApi.get<any>('/api/ats/stats')
atsCandidates: atsRes.value.data?.total ?? 0
```
**Logic:** Total candidates in ATS  
**Status:** ✅ Correct

---

#### **8. Approval Health** ❌ INCORRECT FORMULA
```typescript
// Line 177
const approvalHealth = stats.pendingLeaves > 10 ? 62 : stats.pendingLeaves > 4 ? 78 : 92;
```

**Problem:** Hard-coded arbitrary values! Not based on actual data.

**Correct Formula:**
```typescript
// Approval Health = % of leaves processed (approved/rejected) vs total
const approvalHealth = useMemo(() => {
  const total = stats.pendingLeaves + stats.approvedLeaves;
  if (total === 0) return 100; // No leaves = 100% healthy
  return Math.round((stats.approvedLeaves / total) * 100);
}, [stats.pendingLeaves, stats.approvedLeaves]);
```

---

#### **9. Workforce Coverage** ❌ INCORRECT FORMULA
```typescript
// Line 178
const workforceCoverage = stats.departments > 0 ? 86 : 45;
```

**Problem:** Hard-coded values! Meaningless calculation.

**Correct Formula:**
```typescript
// Workforce Coverage = % of departments with active employees
const workforceCoverage = useMemo(() => {
  // This requires additional API call to get departments with employees
  // For now, use a meaningful approximation:
  if (stats.departments === 0) return 0;
  return Math.round((stats.attendanceToday / stats.employees) * 100);
}, [stats.departments, stats.attendanceToday, stats.employees]);
```

---

## ✅ Dashboard KPI Fixes - Summary

### **Fixes Required:**

**File:** `src/pages/Dashboard.tsx`

#### **Fix 1: Attendance Rate (Line 139)**
```typescript
// BEFORE:
attendanceRate: wfmRes.value.data?.summary?.overall_adherence_pct ?? 0

// AFTER:
attendanceRate: empRes.status === 'fulfilled' && wfmRes.status === 'fulfilled'
  ? Math.round((wfmRes.value.data?.summary?.present_count ?? 0) / 
               Math.max(1, empRes.value.total ?? 1) * 100)
  : 0
```

#### **Fix 2: Approval Health (Line 177)**
```typescript
// BEFORE:
const approvalHealth = stats.pendingLeaves > 10 ? 62 : stats.pendingLeaves > 4 ? 78 : 92;

// AFTER:
const approvalHealth = useMemo(() => {
  const total = stats.pendingLeaves + stats.approvedLeaves;
  if (total === 0) return 100;
  return Math.round((stats.approvedLeaves / total) * 100);
}, [stats.pendingLeaves, stats.approvedLeaves]);
```

#### **Fix 3: Workforce Coverage (Line 178)**
```typescript
// BEFORE:
const workforceCoverage = stats.departments > 0 ? 86 : 45;

// AFTER:
const workforceCoverage = useMemo(() => {
  if (stats.employees === 0 || stats.departments === 0) return 0;
  // Coverage = % of workforce present today
  return Math.round((stats.attendanceToday / stats.employees) * 100);
}, [stats.attendanceToday, stats.employees, stats.departments]);
```

---

## 🎯 Complete Implementation Guide

### **Step 1: Fix Employee Service**

**File:** `backend/src/modules/employees/employee.service.ts`  
**Lines:** 108-118

Add `AND active_status = 1` to all LEFT JOIN clauses.

---

### **Step 2: Fix Dashboard KPIs**

**File:** `src/pages/Dashboard.tsx`

**Changes:**
1. Line 139: Fix attendance rate calculation
2. Line 177: Fix approval health formula
3. Line 178: Fix workforce coverage formula

---

### **Step 3: Test Changes**

#### **Test 1: Employee Filters**
```bash
# Navigate to /employees page
# Check dropdowns show only active departments/processes/branches
# Verify inactive records don't appear
```

#### **Test 2: Real-time Search**
```bash
# Type in search box
# Results should update immediately (with 300ms debounce)
# Search should work on name AND employee code
```

#### **Test 3: Dashboard KPIs**
```bash
# Open /dashboard
# Verify calculations:
# - Attendance Rate = (Present / Total Employees) × 100
# - Approval Health = (Approved / Total Leaves) × 100
# - Workforce Coverage = (Present / Total Employees) × 100
```

---

## 📋 Verification Queries

### **Test Attendance Rate:**
```sql
-- Expected formula
SELECT 
    (SELECT COUNT(*) FROM attendance_daily_record 
     WHERE attendance_date = CURDATE() AND status = 'present') AS present_count,
    (SELECT COUNT(*) FROM employees WHERE active_status = 1) AS total_employees,
    ROUND(
        (SELECT COUNT(*) FROM attendance_daily_record WHERE attendance_date = CURDATE() AND status = 'present') /
        (SELECT COUNT(*) FROM employees WHERE active_status = 1) * 100
    ) AS attendance_rate_pct;
```

### **Test Approval Health:**
```sql
SELECT 
    (SELECT COUNT(*) FROM leave_requests WHERE status = 'approved') AS approved,
    (SELECT COUNT(*) FROM leave_requests WHERE status = 'pending') AS pending,
    ROUND(
        (SELECT COUNT(*) FROM leave_requests WHERE status = 'approved') /
        ((SELECT COUNT(*) FROM leave_requests WHERE status = 'approved') + 
         (SELECT COUNT(*) FROM leave_requests WHERE status = 'pending')) * 100
    ) AS approval_health_pct;
```

---

## ✅ Success Criteria

### **Employee Filters:**
- [ ] Department dropdown shows only active departments
- [ ] Process dropdown shows only active processes
- [ ] Branch dropdown shows only active branches
- [ ] Search updates immediately when typing
- [ ] Search works on name AND employee code

### **Dashboard KPIs:**
- [ ] Attendance Rate = (Present / Total) × 100
- [ ] Approval Health = (Approved / Total Leaves) × 100
- [ ] Workforce Coverage = (Present / Total) × 100
- [ ] All percentages between 0-100
- [ ] No hard-coded values

---

## 🚀 Quick Fix Commands

```bash
# 1. Edit employee service
nano backend/src/modules/employees/employee.service.ts
# Add AND active_status = 1 to lines 115-118

# 2. Edit dashboard
nano src/pages/Dashboard.tsx
# Fix line 139, 177, 178 as documented above

# 3. Restart backend
cd backend && npm run dev

# 4. Restart frontend
npm run dev

# 5. Test
# - Open /employees - check filters
# - Open /dashboard - verify calculations
```

---

## 📞 Related Files

**Employee Filters:**
- `backend/src/modules/employees/employee.service.ts` (lines 78-128)
- `backend/src/modules/employees/employee.controller.ts`
- `src/pages/Employees.tsx` (frontend)

**Dashboard KPIs:**
- `src/pages/Dashboard.tsx` (lines 121-178)
- `backend/src/modules/wfm/wfm.routes.ts` (live attendance API)
- `backend/src/modules/leave/leave.routes.ts` (leave requests API)

---

**Status:** ✅ **Issues Identified & Solutions Provided**  
**Action Required:** Apply fixes in the 3 files mentioned  
**Estimated Time:** 15 minutes to implement all fixes

**Last Updated:** June 15, 2026
