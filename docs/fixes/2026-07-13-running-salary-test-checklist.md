# Running Salary Integration - Test Checklist

**Fix Date:** 2026-07-13  
**Component:** PayslipViewer (`src/components/profile/PayslipViewer.tsx`)  
**Build Status:** ✅ Passed (17.57s, 0 errors)

## Pre-deployment Testing

### 1. Running Salary Display (Current Month, No Payslip)

**Scenario:** Employee logs in on July 13, 2026 (mid-month, before payroll processing)

**Test Steps:**
1. Navigate to Profile → My Payslips
2. Ensure year selector is set to "2026"
3. Verify running salary card is visible at the top

**Expected Results:**
- [ ] "Earned Till Date — 13 Jul" card appears with blue gradient background
- [ ] Shows earned net till date amount (e.g., ₹18,450.00)
- [ ] Shows gross till date in subtitle (e.g., "Gross till date: ₹22,000.00")
- [ ] Shows "Earned days" metric (e.g., 9)
- [ ] Shows "Projected month-end" estimate (e.g., ₹42,000.00)
- [ ] Blue alert banner appears: "Live Salary Tracking Active"
- [ ] Summary cards show:
  - "Earned gross (till date)" instead of "Latest gross salary"
  - "Earned net (till date)" instead of "Net salary"
- [ ] Amounts match backend API response from `/api/payroll/running-summary/me`

**API Verification:**
```bash
# Test endpoint manually
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5000/api/payroll/running-summary/me?month=2026-07"
```

Expected response structure:
```json
{
  "success": true,
  "data": {
    "earned_payable_days": 9,
    "eligible_weekoff_till_date": 1,
    "eligible_holiday_till_date": 0,
    "earned_salary_till_date": 22000.00,
    "earned_net_till_date": 18450.00,
    "projected_payable_days": 26,
    "projected_salary": 63000.00,
    "projected_net": 55000.00,
    "pf_employee": 2400.00,
    "esic_employee": 165.00,
    "professional_tax": 200.00
  },
  "run_month": "2026-07-01"
}
```

---

### 2. Finalized Payslip Display (Past Month)

**Scenario:** Employee views June 2026 payslip (already processed)

**Test Steps:**
1. Navigate to Profile → My Payslips
2. Ensure year selector is set to "2026"
3. Check if June payslip exists in history table

**Expected Results:**
- [ ] NO "Earned Till Date" card (should not appear)
- [ ] NO "Live Salary Tracking" alert banner
- [ ] Summary cards show:
  - "Latest gross salary" (not "till date")
  - "Net salary" (not "till date")
- [ ] June payslip appears in history table
- [ ] Can expand June row to see earnings/deductions breakdown
- [ ] Can download June payslip as PDF

---

### 3. Salary Visibility Toggle

**Scenario:** Employee toggles salary visibility with running salary active

**Test Steps:**
1. Navigate to Profile → My Payslips (current month, running salary visible)
2. Click "View salary" button
3. Click "Hide salary" button

**Expected Results:**
- [ ] Initial state: all amounts blurred
- [ ] After "View salary": all amounts visible (including running salary card)
- [ ] After "Hide salary": all amounts blurred again
- [ ] Toggle affects:
  - Earned till date amount
  - Gross till date amount
  - Projected month-end amount
  - Summary card amounts
- [ ] Button text changes correctly (View salary ↔ Hide salary)

---

### 4. Year Selector Transition

**Scenario:** Employee switches between years

**Test Steps:**
1. Navigate to Profile → My Payslips
2. Year selector shows "2026" (current year)
3. Change to "2025"
4. Change back to "2026"

**Expected Results:**
- [ ] When on 2026 (current year):
  - Running salary card appears (if no July payslip)
  - Live tracking banner appears
  - Summary cards show "till date" labels
- [ ] When on 2025 (past year):
  - NO running salary card
  - NO live tracking banner
  - Summary cards show standard labels
  - Only finalized payslips from 2025 appear
- [ ] Salary visibility resets to hidden on year change

---

### 5. Mid-Month Payroll Processing

**Scenario:** Payroll is processed on July 25 while employee is viewing page

**Test Steps:**
1. Navigate to Profile → My Payslips on July 25 (before processing)
2. Verify running salary is visible
3. HR processes July payroll and generates payslips
4. Refresh the page or navigate away and back

**Expected Results:**
- [ ] Before processing: running salary card visible
- [ ] After processing + refresh:
  - Running salary card disappears
  - July finalized payslip appears in history table
  - Summary cards switch to finalized amounts
  - "Live Salary Tracking" banner disappears

---

### 6. No Attendance Data Scenario

**Scenario:** Employee has no attendance records for current month

**Test Steps:**
1. Test with a new employee who just joined
2. Navigate to Profile → My Payslips

**Expected Results:**
- [ ] Running salary API returns zero values
- [ ] "Earned Till Date" card shows ₹0.00
- [ ] Earned days shows 0
- [ ] Projected month-end shows ₹0.00
- [ ] No errors in console
- [ ] No blank/broken UI elements

---

### 7. Multiple Payslips for Same Month

**Scenario:** There are multiple payroll runs for the same month (e.g., correction run)

**Test Steps:**
1. HR creates multiple payroll runs for July 2026
2. Employee navigates to Profile → My Payslips

**Expected Results:**
- [ ] Running salary card does NOT appear (payslip exists)
- [ ] Both payslip runs appear in history table
- [ ] Each run distinguished by "Run 1", "Run 2" label
- [ ] Latest run is shown at the top

---

### 8. Console Error Monitoring

**Scenario:** Check for JavaScript errors during normal operation

**Test Steps:**
1. Open browser DevTools → Console
2. Navigate to Profile → My Payslips
3. Toggle salary visibility
4. Switch year selector
5. Expand/collapse payslip rows

**Expected Results:**
- [ ] No errors in console
- [ ] No failed network requests
- [ ] No React hydration warnings
- [ ] No TypeScript errors

---

### 9. Performance & Loading States

**Scenario:** Check loading behavior and performance

**Test Steps:**
1. Clear browser cache
2. Navigate to Profile → My Payslips
3. Observe loading states

**Expected Results:**
- [ ] CTC card loads first (separate query)
- [ ] Skeleton loaders appear for payslip history
- [ ] Running salary card appears after API response
- [ ] No layout shift (CLS) when running salary loads
- [ ] Total load time < 2 seconds (normal connection)

---

### 10. Mobile Responsiveness

**Scenario:** Test on mobile viewport

**Test Steps:**
1. Open DevTools → Device Toolbar
2. Select "iPhone 12 Pro" or "Galaxy S20"
3. Navigate to Profile → My Payslips

**Expected Results:**
- [ ] Running salary card is fully visible
- [ ] Earned days / Projected month-end grid stacks properly
- [ ] Summary cards stack vertically on mobile
- [ ] Alert banner text wraps correctly
- [ ] No horizontal scrolling required
- [ ] Touch targets are appropriately sized

---

## Backend API Testing

### Endpoint: GET /api/payroll/running-summary/me

**Test Cases:**

1. **Valid current month request**
   ```bash
   GET /api/payroll/running-summary/me?month=2026-07
   ```
   Expected: 200 OK with running salary data

2. **Past month request**
   ```bash
   GET /api/payroll/running-summary/me?month=2026-06
   ```
   Expected: 200 OK with past month data

3. **Missing month parameter**
   ```bash
   GET /api/payroll/running-summary/me
   ```
   Expected: 200 OK (defaults to current month)

4. **Invalid month format**
   ```bash
   GET /api/payroll/running-summary/me?month=2026-13
   ```
   Expected: 400 Bad Request or fallback to current month

5. **Unauthenticated request**
   ```bash
   GET /api/payroll/running-summary/me
   # (no auth token)
   ```
   Expected: 401 Unauthorized

6. **Employee with no salary assignment**
   ```bash
   GET /api/payroll/running-summary/me
   # (employee has no active employee_salary_assignment)
   ```
   Expected: Zero values or 404

---

## Regression Testing

Ensure existing functionality still works:

- [ ] Can download past payslips as PDF
- [ ] CTC card displays correctly
- [ ] Year selector works for all years
- [ ] Payslip history table sorting is correct
- [ ] Earnings/deductions expand/collapse works
- [ ] Status badges display correctly (Paid, Processed, Draft)
- [ ] New payslip alert appears when appropriate
- [ ] "Dismiss" on new payslip alert works
- [ ] Salary structure breakdown card shows correctly

---

## Edge Cases

### 1. Employee on Leave (Full Month)
- [ ] Running salary shows zero earned days
- [ ] Projected salary is zero or minimal
- [ ] No errors thrown

### 2. Employee Mid-Month Join
- [ ] Earned days reflects only days since joining
- [ ] Projected salary is pro-rated correctly
- [ ] salary_start_date is respected

### 3. Employee Resignation (Mid-Month)
- [ ] Running salary stops at last working day
- [ ] F&F settlement not included in running salary
- [ ] Projected salary reflects resignation date

### 4. Maternity Leave
- [ ] Running salary shows full pay (as per MBA 1961)
- [ ] LWP not deducted for maternity leave days

### 5. Holiday Work
- [ ] Holiday work payout included in earned amount
- [ ] Projected salary includes future holidays

---

## Sign-off Checklist

- [ ] All test scenarios passed
- [ ] No console errors
- [ ] Build successful (npm run build)
- [ ] TypeScript compilation passed (npm run typecheck)
- [ ] Mobile responsive design verified
- [ ] API endpoints tested manually
- [ ] Documentation updated
- [ ] Git commit created with clear message

---

## Known Limitations

1. **Real-time Updates:** Running salary is not live-updated on the page. User must refresh to see latest attendance reflected.
2. **Timezone:** Uses browser timezone for "today" calculation. May cause 1-day discrepancy for users in different timezones.
3. **Caching:** React Query caches running salary for 5 minutes (default staleTime). May show slightly outdated data.

---

## Rollback Plan

If critical issues found in production:

1. **Quick rollback:** Revert commit
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

2. **Feature flag approach:** Add conditional rendering
   ```typescript
   const RUNNING_SALARY_ENABLED = false; // toggle off
   {RUNNING_SALARY_ENABLED && runningSalary && ...}
   ```

3. **Backend only:** Disable API endpoint
   ```typescript
   // In running-salary.routes.ts
   return res.status(503).json({ 
     success: false, 
     message: "Running salary temporarily unavailable" 
   });
   ```

---

## Post-Deployment Monitoring

Monitor these metrics for 48 hours post-deployment:

- [ ] API response time for `/api/payroll/running-summary/me` (should be < 500ms)
- [ ] Error rate on running salary endpoint (should be < 0.1%)
- [ ] Frontend error logs (Sentry/LogRocket)
- [ ] User feedback on support channels
- [ ] Database query performance (attendance_daily_record queries)

---

**Tested By:** _________________  
**Date:** _________________  
**Sign-off:** _________________
