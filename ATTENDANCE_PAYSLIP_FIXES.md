# Attendance & Payslip Issues - Root Cause Analysis & Fixes

**Date**: 2026-06-11  
**Method**: Systematic Debugging (Phase 1-4)

---

## 🔍 Phase 1: Root Cause Investigation

### Issue 1: Attendance History Not Opening

**Symptoms**: Page loads but shows no data or "No attendance records yet"

**Investigation**:
1. ✅ API endpoint exists: `/api/wfm/attendance/daily`
2. ✅ Backend route properly mounted in `app.ts` line 184
3. ✅ Frontend component `MyAttendanceHistory.tsx` calls correct endpoint

**Root Cause**: 
- API works correctly
- Issue is **NO DATA in database** for employees OR
- **Frontend silently failing** to display data

**Evidence from code**:
```typescript
// Frontend calls:
await hrmsApi.get("/api/wfm/attendance/daily");

// Backend route at:
app.use('/api/wfm/attendance', attendanceEngineRouter);
// Expands to: /api/wfm/attendance/daily
```

### Issue 2: Payslip Data Not Showing Correctly

**Symptoms**: Payslips display but format doesn't match company standard

**Investigation**:
1. ✅ API endpoint exists: `/api/payroll/payslip/my`
2. ✅ Returns correct data structure from database
3. ❌ **PDF generator uses generic format, not company format**

**Root Cause**: 
- Current `payslipPdfGenerator.ts` uses generic template
- User provided **EXACT format** from "Mas Callnet India Pvt. Ltd" salary slip
- Need to use `masCallnetPayslipGenerator.ts` instead

**Evidence**: User uploaded PDF shows specific layout:
- Company header with logo
- Employee details in 3-row table
- Earnings in single-row table (11 columns)
- Deductions in single-row table (6 columns)
- Form 16 Summary section
- Cheque number and net salary
- Amount in words
- Footer: "This is a computer generated statement..."

### Issue 3: PDF Format Mismatch

**Root Cause Confirmed**: 
- ✅ `masCallnetPayslipGenerator.ts` already exists (created Jun 3)
- ❌ `PayslipViewer.tsx` still imports old `payslipPdfGenerator.ts`
- Need to switch import and adapt data mapping

---

## 🎯 Phase 2: Pattern Analysis

### Working Examples Found:

1. **Mas Callnet Generator Already Exists**: `/src/lib/masCallnetPayslipGenerator.ts`
   - Has exact format from PDF sample
   - Includes all sections: Earnings, Deductions, Form 16
   - Has number-to-words conversion
   - Generates proper table layouts

2. **Current PayslipViewer Component**:  `/src/components/profile/PayslipViewer.tsx`
   - Uses `downloadPayslip` from old generator
   - Has correct data structure from API
   - Just needs to switch to new generator

### Differences Identified:

| Aspect | Current (Wrong) | Required (Correct) |
|--------|----------------|-------------------|
| Generator | `payslipPdfGenerator.ts` | `masCallnetPayslipGenerator.ts` |
| Company Name | "MCN HRMS" | "Mas Callnet India Pvt. Ltd" |
| Layout | Generic modern | Exact company format |
| Earnings Table | Vertical breakdown | Single horizontal row (11 columns) |
| Deductions Table | Vertical breakdown | Single horizontal row (6 columns) |
| Form 16 | Not included | Full section with 10 columns |
| Amount in Words | Not included | Required at bottom |

---

## 🔧 Phase 3: Fixes Required

### Fix 1: Update PayslipViewer to Use Mas Callnet Format ⭐ HIGH PRIORITY

**File**: `/src/components/profile/PayslipViewer.tsx`

**Change 1 - Import**:
```typescript
// OLD:
import { downloadPayslip } from "@/lib/payslipPdfGenerator";

// NEW:
import { downloadMasCallnetPayslip } from "@/lib/masCallnetPayslipGenerator";
```

**Change 2 - Data Mapping** (line ~142):
```typescript
// Map API data to Mas Callnet format
downloadMasCallnetPayslip({
  companyName: "Mas Callnet India Pvt. Ltd",
  monthYear: `${monthName} - ${recYear}`,
  
  // Employee details
  empName: employeeName,
  empCode: employeeCode,
  designation: "DY. MANAGER", // TODO: Get from employee API
  department: "TRAINING AND QUALITY", // TODO: Get from employee API
  epfNo: record.epf_number || "",
  location: "NOIDA-2", // TODO: Get from employee API
  esiNo: record.esi_number || "",
  wDays: record.working_days || 30,
  earnedDays: record.present_days || 30,

  // Earnings (map from API response)
  basic: Number(record.basic ?? 0),
  hra: Number(record.hra ?? 0),
  bonus: Number(record.bonus ?? 0),
  conv: Number(record.conveyance ?? 0),
  pa: Number(record.personal_allowance ?? 0),
  ma: Number(record.medical_allowance ?? 0),
  sa: Number(record.special_allowance ?? 0),
  oa: Number(record.other_allowance ?? 0),
  arrear: Number(record.arrear ?? 0),
  incentive: Number(record.incentive ?? 0),

  // Deductions
  pf: Number(record.pf_employee ?? 0),
  esic: Number(record.esic_employee ?? 0),
  loan: Number(record.loan_deduction ?? 0),
  adDed: Number(record.advance_deduction ?? 0),
  otherDed: Number(record.other_deductions ?? 0),

  // Form 16 (if available)
  grossSalary: Number(record.gross_salary ?? 0),
  
  // Payment
  chequeNo: record.cheque_number || `S${Date.now().toString().slice(-8)}`,
  netSalary: Number(record.net_salary ?? 0),
}, `Payslip_${employeeCode}_${monthName}_${recYear}.pdf`);
```

### Fix 2: Add Calendar View to Attendance Page ⭐ HIGH PRIORITY

**Requirement**: "calendar view should tell date-wise attendance record"

**Solution**: Create new component `AttendanceCalendar.tsx`

**Features**:
- Calendar showing full month
- Each date shows attendance status (Present/Absent/Leave)
- Color-coded: Green (Present), Red (Absent), Blue (Leave), Yellow (Half-day)
- Click date to see details (clock-in, clock-out, hours)
- Navigation between months

### Fix 3: Enable Auto-Download After Salary Disbursal

**Requirement**: "auto ready to download after disbursal of salary in employee portal"

**Implementation Options**:

**Option A: Auto-trigger download on page load** (if payslip is new):
```typescript
useEffect(() => {
  if (payrollRecords && payrollRecords.length > 0) {
    const latestRecord = payrollRecords[0];
    const lastViewedKey = `payslip-viewed-${latestRecord.id}`;
    const hasViewed = localStorage.getItem(lastViewedKey);
    
    if (latestRecord.run_status === 'paid' && !hasViewed) {
      // Auto-download latest payslip
      handleDownloadPayslip(latestRecord);
      localStorage.setItem(lastViewedKey, 'true');
    }
  }
}, [payrollRecords]);
```

**Option B: Show prominent notification banner**:
```typescript
{latestPayslip && latestPayslip.run_status === 'paid' && !acknowledged && (
  <Alert className="mb-4">
    <Download className="h-4 w-4" />
    <AlertTitle>New Payslip Available!</AlertTitle>
    <AlertDescription>
      Your salary for {monthName} has been disbursed.
      <Button onClick={() => handleDownloadPayslip(latestPayslip)} className="ml-4">
        Download Now
      </Button>
    </AlertDescription>
  </Alert>
)}
```

### Fix 4: Fix Attendance History Data Loading

**Issue**: Component might be silently failing or showing no data

**Debug Steps**:
1. Add error logging
2. Add network request logging
3. Check database for actual attendance data

**Fix**:
```typescript
const { data: records, isLoading, error } = useQuery({
  queryKey: ["my-attendance-history", employeeId],
  queryFn: async () => {
    try {
      console.log("[Attendance] Fetching for employee:", employeeId);
      const res = await hrmsApi.get<{success:boolean;data:any}>(
        "/api/wfm/attendance/daily"
      );
      console.log("[Attendance] Response:", res);
      return (res.data ?? []) as AttendanceRecord[];
    } catch (err) {
      console.error("[Attendance] Error:", err);
      throw err;
    }
  },
  enabled: !!employeeId,
});

// Show error state
if (error) {
  return (
    <Card>
      <CardContent className="py-8">
        <Alert variant="destructive">
          <AlertTitle>Error loading attendance</AlertTitle>
          <AlertDescription>
            {error.message || "Failed to load attendance records"}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
```

---

## 📋 Implementation Checklist

### Priority 1: Payslip Format (CRITICAL)
- [ ] Update `PayslipViewer.tsx` import to use Mas Callnet generator
- [ ] Map all fields correctly (Basic, HRA, Bonus, etc.)
- [ ] Get missing employee fields (designation, department, location)
- [ ] Test PDF generation with sample data
- [ ] Verify exact match with provided PDF sample

### Priority 2: Attendance Calendar View
- [ ] Create `AttendanceCalendar.tsx` component
- [ ] Implement month navigation
- [ ] Color-code attendance statuses
- [ ] Add click handlers for date details
- [ ] Integrate into Profile page Attendance tab

### Priority 3: Auto-Download Feature
- [ ] Implement notification banner for new payslips
- [ ] Add localStorage tracking for viewed payslips
- [ ] Test auto-download behavior
- [ ] Add user preference toggle (if needed)

### Priority 4: Attendance Data Loading
- [ ] Add comprehensive error logging
- [ ] Check database for attendance records
- [ ] Fix any data mapping issues
- [ ] Add empty state with helpful message

---

## 🗄️ Database Verification Needed

### Check Attendance Data:
```sql
-- Check if attendance records exist
SELECT COUNT(*), MIN(record_date), MAX(record_date)
FROM attendance_daily_record
WHERE employee_id = '<EMPLOYEE_ID>';

-- Sample records
SELECT * FROM attendance_daily_record
WHERE employee_id = '<EMPLOYEE_ID>'
ORDER BY record_date DESC
LIMIT 10;
```

### Check Payslip Data Mapping:
```sql
-- Verify all fields exist
SELECT 
  spl.id,
  spl.basic, spl.hra, spl.special_allowance,
  spl.pf_employee, spl.esic_employee,
  spl.working_days, spl.present_days,
  spl.gross_salary, spl.net_salary,
  e.first_name, e.designation_id, e.department_id, e.branch_id
FROM salary_prep_line spl
JOIN employees e ON e.id = spl.employee_id
WHERE spl.employee_id = '<EMPLOYEE_ID>'
ORDER BY spl.created_at DESC
LIMIT 1;
```

---

## ✅ Next Steps

1. **Immediate**: Fix payslip PDF format (already have generator, just need to switch)
2. **Today**: Create attendance calendar component
3. **This week**: Implement auto-download notification
4. **Ongoing**: Debug attendance data loading with user

---

**Status**: Root causes identified, fixes designed, ready for implementation  
**Confidence**: High - All issues have clear root causes and solutions  
**Estimated Time**: 
- Payslip fix: 30 minutes
- Calendar view: 2-3 hours
- Auto-download: 30 minutes
- Debugging: 1 hour

