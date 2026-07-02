# Leave System - Complete Analysis

## STEP 1: Database Schema Analysis

### Actual Tables and Columns

#### leave_request table (ACTUAL TABLE NAME - SINGULAR)
```sql
DESC leave_request;
```

Columns:
- id (char 36)
- employee_id (char 36)
- leave_type_id (char 36)
- **from_date** (date) ← NOT start_date
- **to_date** (date) ← NOT end_date
- **total_days** (decimal 6,2) ← NOT leave_days, NOT days_count
- reason (text)
- status (varchar 50)
- applied_at (datetime)
- created_at (datetime)
- approval_level (enum)
- exception_type (varchar 50)
- document_url (varchar 500)
- leave_type_code (varchar 20)
- start_date (date) ← ALIAS field
- end_date (date) ← ALIAS field
- requested_at (datetime)
- approved_at (datetime)
- approved_by (varchar 100)
- rejection_reason (text)

**KEY FIELDS:**
- Date columns: `from_date`, `to_date` (PRIMARY)
- Days column: `total_days` (PRIMARY)
- Also has: `start_date`, `end_date` (ALIAS/LEGACY)

#### leave_balance_ledger table
```sql
DESC leave_balance_ledger;
```

Columns:
- id (char 36)
- employee_id (char 36)
- leave_type_id (char 36)
- balance_year (int)
- allocated_days (decimal)
- used_days (decimal)
- adjusted_days (decimal)
- updated_at (datetime)

#### leave_type_master table
Columns:
- id (char 36)
- leave_code (varchar)
- leave_name (varchar)
- max_days_per_year (int)
- carry_forward (tinyint)
- requires_approval (tinyint)
- paid_leave (tinyint)
- active_status (tinyint)

---

## STEP 2: Current Backend Code Analysis

### leave.service.ts - getBalance function (Lines 373-419)

**PROBLEM IDENTIFIED:**
Line 411-422 tries to UPDATE leave_balance_ledger with:
```typescript
await db.execute(
  `UPDATE leave_balance_ledger lbl
   SET used_days = (
     SELECT COALESCE(SUM(lr.leave_days), 0)  ← WRONG COLUMN
     FROM leave_requests lr                   ← WRONG TABLE NAME
     WHERE lr.employee_id = lbl.employee_id
       AND lr.leave_type_id = lbl.leave_type_id
       AND lr.status = 'approved'
       AND YEAR(lr.start_date) = lbl.balance_year  ← WRONG COLUMN
   )
   WHERE lbl.employee_id = ? AND lbl.balance_year = ?`,
  [employeeId, year]
);
```

**ERRORS:**
1. ❌ Table name: `leave_requests` (doesn't exist) → Should be `leave_request`
2. ❌ Column: `leave_days` (doesn't exist) → Should be `total_days`
3. ❌ Column: `start_date` → Should use `from_date`

**RESULT:** 500 Error: "Table 'mas_hrms.leave_requests' doesn't exist"

---

## STEP 3: Frontend Component Analysis

### src/hooks/useLeaveBalances.ts (Lines 1-40)

**What it expects:**
```typescript
export interface LeaveBalance {
  id: string;
  leave_type: { name: string; is_paid: boolean | null };
  total_days: number;     ← Maps from allocated_days
  used_days: number;      ← Direct mapping
  year: number;           ← Maps from balance_year
}
```

**API Call:**
```typescript
const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
  `/api/leave/balance/${employeeId}?year=${currentYear}`
);
```

**Mapping Logic:**
```typescript
return rows.map((row: any): LeaveBalance => ({
  id: row.id ?? row.leave_type_id,
  leave_type: {
    name: row.leave_name ?? row.leave_code ?? row.leave_type_id ?? "Unknown",
    is_paid: row.paid_leave != null ? Boolean(row.paid_leave) : null,
  },
  total_days: Number(row.allocated_days ?? row.total_days ?? 0),  ← Frontend expects this
  used_days: Number(row.used_days ?? 0),                          ← Frontend expects this
  year: Number(row.balance_year ?? currentYear),
}));
```

---

### src/components/profile/LeaveBalanceCard.tsx (Lines 1-84)

**What it displays:**
```typescript
const remaining = balance.total_days - balance.used_days;  // Line 46
const usedPercentage = balance.total_days > 0 
  ? (balance.used_days / balance.total_days) * 100 
  : 0;

// Display (Line 68):
Total: {balance.total_days} days/year
```

**Requirement:** 
- Needs accurate `total_days` (from allocated_days)
- Needs accurate `used_days` (calculated from approved leave_request records)

---

### src/components/profile/LeaveRequestForm.tsx (Lines 89-105)

**Current Code:**
```typescript
// Lines 78-85: Fetches leave requests to calculate used days
const { data: approvedRequests } = useQuery({
  queryKey: ["leave-used-days", employeeId, currentYear],
  queryFn: async () => {
    const res = await hrmsApi.get<{success:boolean;data:any}>("/api/leave/requests");
    return res.data ?? [];
  },
});

// Lines 89-105: Calculates balance manually
const leaveBalances = useMemo(() => {
  const balances: Record<string, { total: number; used: number; remaining: number }> = {};
  leaveTypes.forEach((type) => {
    const used = approvedRequests
      ?.filter((r) => r.leave_type_id === type.id)
      .reduce((sum, r) => sum + r.days_count, 0) || 0;  ← WRONG FIELD
    balances[type.id] = {
      total: type.days_per_year,
      used,
      remaining: type.days_per_year - used,
    };
  });
  return balances;
}, [leaveTypes, approvedRequests, unpaidLeaveType]);
```

**PROBLEM:**
- Uses `r.days_count` but API returns `total_days`
- Calculates manually instead of using `/api/leave/balance` API

---

### src/components/profile/LeaveRequestHistory.tsx (Lines 13-22)

**Interface Definition:**
```typescript
interface LeaveRequest {
  id: string;
  start_date: string;      ← Expects this
  end_date: string;        ← Expects this
  days_count: number;      ← Expects this
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  created_at: string;
  leave_types: { name: string } | null;  ← Expects nested object
}
```

**MISMATCHES with Backend:**
1. ❌ `start_date` → Backend returns `from_date`
2. ❌ `end_date` → Backend returns `to_date`
3. ❌ `days_count` → Backend returns `total_days`
4. ❌ `leave_types.name` → Backend returns `leave_type_name` (flat string, not nested)

---

## STEP 4: Backend API Response Analysis

### GET /api/leave/requests?employeeId=XXX

**What backend returns (from leave.service.ts line 342-366):**
```sql
SELECT lr.*,
  CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
  e.first_name, e.last_name,
  e.avatar_url,
  dept.dept_name AS department_name,
  lt.leave_name  AS leave_type_name,  ← Returns as flat field
  CONCAT(rev.first_name, ' ', COALESCE(rev.last_name, '')) AS reviewer_name
FROM leave_request lr
...
```

**Fields returned:**
- `from_date`, `to_date`, `total_days`
- `leave_type_name` (string, not object)
- `status`, `reason`, etc.

---

## STEP 5: Current Data State

### Sample data from leave_balance_ledger:
```
employee_id                              | leave_type_id | balance_year | allocated_days | used_days | adjusted_days
0000bf5c-5e8b-11f1-adb1-00155d0ab410    | 80e07731...   | 2026         | 18.00          | 9.00      | 0.00
0000bf5c-5e8b-11f1-adb1-00155d0ab410    | 80e058a3...   | 2026         | 3.50           | 1.00      | 0.00
```

**✅ Data exists in database**
**✅ `used_days` column has values**

---

## STEP 6: Issues Summary

### Critical Issues (Causing 500 Error):

1. **Backend - leave.service.ts Line 411-422**
   - ❌ Uses `leave_requests` table (doesn't exist)
   - ❌ Uses `leave_days` column (doesn't exist)
   - ❌ Uses `start_date` column (should be `from_date`)
   - 🔥 **THIS CAUSES THE 500 ERROR**

### Data Mismatch Issues:

2. **LeaveRequestForm.tsx Lines 89-105**
   - ❌ Uses `r.days_count` (should be `r.total_days`)
   - ❌ Calculates manually instead of using API
   - Shows incorrect "available balance"

3. **LeaveRequestHistory.tsx**
   - ❌ Interface expects `start_date`, `end_date`, `days_count`
   - ❌ Backend returns `from_date`, `to_date`, `total_days`
   - ❌ Expects `leave_types.name` object
   - ❌ Backend returns `leave_type_name` string
   - Shows no history data

---

## STEP 7: Root Cause Analysis

### Why leave balance is not reflecting:

1. **Primary Cause:** Backend crashes with 500 error when trying to fetch balance
   - Query uses wrong table name `leave_requests`
   - Frontend shows loading state forever or error

2. **Secondary Issue:** Even if backend worked, field name mismatches would cause:
   - Incorrect calculations in LeaveRequestForm
   - Empty history in LeaveRequestHistory

---

## STEP 8: Correct Implementation Plan

### Fix Priority Order:

1. **CRITICAL - Backend Service (leave.service.ts)**
   - Change `leave_requests` → `leave_request`
   - Change `leave_days` → `total_days`
   - Change `start_date` → `from_date`

2. **HIGH - LeaveRequestForm.tsx**
   - Change `r.days_count` → `r.total_days`
   - OR better: Use `/api/leave/balance` API directly

3. **MEDIUM - LeaveRequestHistory.tsx**
   - Change interface to match backend response
   - `start_date` → `from_date`
   - `end_date` → `to_date`
   - `days_count` → `total_days`
   - `leave_types.name` → `leave_type_name`

---

## STEP 9: Testing Checklist

After fixes:
- [ ] Backend API returns 200 (not 500)
- [ ] LeaveBalanceCard shows cards with numbers
- [ ] LeaveRequestForm shows correct "X/Y" remaining
- [ ] LeaveRequestHistory shows past requests
- [ ] Total days/year matches allocated_days

---

## STEP 10: Database Schema Reference

### Correct Field Names to Use:

**leave_request table:**
- ✅ `from_date` (primary)
- ✅ `to_date` (primary)
- ✅ `total_days` (primary)
- ⚠️  `start_date` (alias - exists but use from_date)
- ⚠️  `end_date` (alias - exists but use to_date)

**leave_balance_ledger table:**
- ✅ `allocated_days`
- ✅ `used_days`
- ✅ `balance_year`

**NOT EXIST:**
- ❌ `leave_requests` (table)
- ❌ `leave_days` (column)
- ❌ `days_count` (column)

---

## Analysis Complete ✓

**Next Step:** Apply fixes in order of priority after user approval.
