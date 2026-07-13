# Running Salary Integration into Payslip Viewer

**Date:** 2026-07-13  
**Issue:** Running month salary amount was not reflecting in payslip viewer  
**Status:** ✅ Fixed

## Problem Analysis

The system had **two separate flows** for salary visibility:

1. **Finalized Payslips** (past months): Displayed in PayslipViewer component via `/api/payroll/payslip/my`
2. **Running Salary** (current month, live tracking): Available via `/api/payroll/running-summary/me` but only accessible through a separate page `/payroll/running-breakdown`

### Root Cause

The **PayslipViewer component** (`src/components/profile/PayslipViewer.tsx`) only queried finalized payroll records from `salary_payslip` and `salary_prep_line` tables. It did NOT fetch or display running salary data for the current month before payroll finalization.

This meant:
- Employees could not see their earned salary till date in the main payslip view
- They had to navigate to a separate "Running Payroll Breakdown" page
- The payslip appeared empty for the current month until HR processed payroll

## Solution Implemented

### 1. Integrated Running Salary API Call

Added a new query in `PayslipViewer.tsx` to fetch running salary data:

```typescript
// Fetch running salary for the current month if it hasn't been finalized
const currentMonthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
const hasCurrentMonthPayslip = payrollRecords?.some((r) => r.run_month?.startsWith(currentMonthKey));

const { data: runningSalary } = useQuery({
  queryKey: ["running-salary", employeeId, currentMonthKey],
  queryFn: async () => {
    if (!employeeId) return null;
    const res = await hrmsApi.get<{ success: boolean; data: any }>(
      `/api/payroll/running-summary/me?month=${currentMonthKey}`
    );
    return res.data ?? null;
  },
  enabled: !!employeeId && parseInt(selectedYear) === currentDate.getFullYear() && !hasCurrentMonthPayslip,
});
```

**Logic:**
- Only fetches running salary when viewing the current year
- Only if the current month's payslip hasn't been finalized yet
- Uses the employee self-service endpoint `/api/payroll/running-summary/me`

### 2. Updated Summary Cards Display Logic

Modified the summary card logic to show running salary when available:

```typescript
// Use running salary for current month if available, otherwise show latest finalized payslip
const displayGross = (runningSalary && !hasCurrentMonthPayslip)
  ? Number(runningSalary.earned_salary_till_date ?? 0)
  : Number(latestRecord?.gross_salary ?? 0);
  
const displayDeductions = (runningSalary && !hasCurrentMonthPayslip)
  ? Number(runningSalary.pf_employee ?? 0) + Number(runningSalary.esic_employee ?? 0) + Number(runningSalary.professional_tax ?? 0)
  : Number(latestRecord?.total_deductions ?? 0);
  
const displayNet = (runningSalary && !hasCurrentMonthPayslip)
  ? Number(runningSalary.earned_net_till_date ?? 0)
  : Number(latestRecord?.net_salary ?? 0);
```

**Labels Change Dynamically:**
- Current month (running): "Earned gross (till date)" / "Earned net (till date)"
- Past months (finalized): "Latest gross salary" / "Net salary"

### 3. Added "Earned Till Date" Card

Created a prominent card that appears only when showing running salary:

```typescript
{/* Running Salary for Current Month (if not yet finalized) */}
{runningSalary && parseInt(selectedYear) === currentDate.getFullYear() && !hasCurrentMonthPayslip && (
  <Card className="rounded-3xl border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50 shadow-md">
    <CardContent className="p-5">
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-blue-800">
            <CalendarCheck className="size-4" />
            Earned Till Date — {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </div>
          <p className="mt-2 text-3xl font-black tabular-nums text-blue-900">
            {renderSensitive(formatCurrency(runningSalary.earned_net_till_date || 0))}
          </p>
          <p className="mt-1 text-xs text-blue-700">
            Gross till date: {renderSensitive(formatCurrency(runningSalary.earned_salary_till_date || 0))}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-white/60 p-2.5">
            <p className="text-muted-foreground">Earned days</p>
            <p className="mt-1 font-bold text-blue-900">{runningSalary.earned_payable_days || 0}</p>
          </div>
          <div className="rounded-lg bg-white/60 p-2.5">
            <p className="text-muted-foreground">Projected month-end</p>
            <p className="mt-1 font-bold text-blue-900">{renderSensitive(formatCurrency(runningSalary.projected_net || 0))}</p>
          </div>
        </div>
        <p className="text-xs text-blue-600 italic">
          This is a live estimate based on today's attendance. Final payslip will be available after payroll processing.
        </p>
      </div>
    </CardContent>
  </Card>
)}
```

**Features:**
- Shows earned net till date (primary metric)
- Shows gross till date
- Shows earned payable days
- Shows projected month-end net salary
- Clear disclaimer that it's a live estimate

### 4. Added Live Tracking Indicator Alert

Added a prominent alert banner when viewing running salary:

```typescript
{/* Live running salary indicator */}
{runningSalary && !hasCurrentMonthPayslip && parseInt(selectedYear) === currentDate.getFullYear() && (
  <Alert className="rounded-2xl border-blue-300 bg-blue-50/50">
    <TrendingUp className="h-4 w-4 text-blue-600" />
    <AlertTitle className="text-blue-900">Live Salary Tracking Active</AlertTitle>
    <AlertDescription className="text-blue-700">
      You're viewing real-time earned salary for {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}.
      The amounts shown above reflect your attendance till today. Final payslip will appear here after month-end processing.
    </AlertDescription>
  </Alert>
)}
```

## User Experience Flow

### Scenario 1: Employee Views Payslip on July 13, 2026 (Mid-Month)

**Before Fix:**
- Opens "My Payslips" page
- Sees payslips for June, May, April... but nothing for July
- Has to navigate to separate "Running Payroll Breakdown" page to see current month earnings

**After Fix:**
- Opens "My Payslips" page
- Sees **"Earned Till Date — 13 Jul"** card at the top showing live earnings
- Summary cards show "Earned gross (till date)" and "Earned net (till date)"
- Blue alert banner explains: "Live Salary Tracking Active"
- Can see earned days, projected month-end, and deduction breakdown
- All data updates daily as attendance is marked

### Scenario 2: Employee Views Payslip on August 5, 2026 (After Payroll Processing)

**After Fix:**
- Opens "My Payslips" page
- July payslip is now finalized and appears in the history table
- "Earned Till Date" card disappears (replaced by finalized payslip data)
- Summary cards show finalized amounts from July payslip
- Can download July payslip as PDF

## Technical Details

### Backend APIs Used

1. **Finalized Payslips:**
   - Endpoint: `GET /api/payroll/payslip/my?year=2026`
   - Returns: Array of finalized payslip records from `salary_payslip` table

2. **Running Salary:**
   - Endpoint: `GET /api/payroll/running-summary/me?month=2026-07`
   - Returns: Live-calculated salary data from `computeRunningSalary()` service
   - Service file: `backend/src/modules/payroll/running-salary.service.ts`

### Data Flow

```
Employee opens Payslip Viewer
  ↓
Query finalized payslips for selected year
  ↓
Check if current month payslip exists
  ↓
If NO → Fetch running salary from /running-summary/me
  ↓
Display "Earned Till Date" card + live tracking banner
  ↓
Show running salary in summary cards
```

### Running Salary Calculation Logic

The `computeRunningSalary()` service:
1. Fetches employee CTC, salary structure, and statutory config
2. Queries `attendance_daily_record` for completed attendance till today
3. Calculates earned payable days (present + paid leave + eligible week-offs + holidays)
4. Pro-rates gross salary: `(monthlyGross / activeCalendarDays) * earnedPayableDays`
5. Calculates prorated deductions (PF, ESIC, PT) on earned gross
6. Projects end-of-month salary based on roster + future holidays
7. Returns both earned till date AND projected month-end values

## Files Modified

1. **src/components/profile/PayslipViewer.tsx**
   - Added `runningSalary` query
   - Added `hasCurrentMonthPayslip` check
   - Added `displayGross`, `displayDeductions`, `displayNet` computed values
   - Added "Earned Till Date" card component
   - Added "Live Salary Tracking" alert banner
   - Updated summary card labels to be dynamic

## Testing Checklist

- [ ] Employee can see running salary for current month before payroll processing
- [ ] Running salary card disappears after payroll is finalized
- [ ] Summary cards show correct labels (till date vs final)
- [ ] Salary visibility toggle works with running salary data
- [ ] Year selector switches between running salary (current year) and finalized payslips
- [ ] Backend API `/api/payroll/running-summary/me` returns correct data
- [ ] Projected month-end salary is displayed correctly
- [ ] Deductions breakdown shows PF, ESIC, PT from running salary
- [ ] Alert banner appears only when viewing running salary
- [ ] Performance: no unnecessary API calls when payslip is finalized

## Benefits

1. **Single Source of Truth:** Employees see all salary data in one place
2. **Real-time Visibility:** No need to wait till month-end to see earnings
3. **Transparency:** Clear distinction between live estimate and finalized payslip
4. **Reduced Support Queries:** Employees can self-service check their earned salary
5. **Better UX:** Seamless transition from running salary to finalized payslip

## Related Files

- Backend service: `backend/src/modules/payroll/running-salary.service.ts`
- Backend routes: `backend/src/modules/payroll/running-salary.routes.ts`
- Backend mounting: `backend/src/app.ts` (line 288: `app.use("/api/payroll", runningSalaryRouter)`)
- Separate page: `src/pages/payroll/RunningPayrollBreakdown.tsx` (still available for management/detailed view)

## Future Enhancements

1. Add day-by-day attendance breakdown in the "Earned Till Date" card
2. Show week-off eligibility status (earned vs rostered)
3. Add comparison with previous month's running salary (same date)
4. Add push notification when running salary crosses threshold
5. Add export running salary as interim statement (not official payslip)
