# Testing Guide - Bug Fixes & New Features

## 🧪 **BUG FIX TESTING**

### Test 1: Attendance History Page

**What was fixed:**
- Error handling added
- Retry button added
- Better error messages

**How to test:**

1. **Normal Operation Test:**
   ```
   1. Login to HRMS
   2. Navigate to Attendance page
   3. Change month selector
   4. Verify attendance history loads
   5. Check if data displays correctly
   ```

2. **Error Handling Test:**
   ```
   1. Stop backend server temporarily:
      cd /home/shuvam/hrms-audit/backend
      # Stop the server
   
   2. Try to load Attendance page
   3. Should see RED error banner with:
      - AlertTriangle icon
      - Clear error message
      - "Retry" button
   
   4. Click "Retry" button
   5. Page should reload
   
   6. Restart backend server
   7. Click "Retry" again
   8. Data should load successfully
   ```

3. **Expected Behavior:**
   - ✅ Loading skeleton shows while fetching
   - ✅ Error message displays clearly (red banner)
   - ✅ Retry button works
   - ✅ Data displays when successful
   - ✅ No silent failures

---

### Test 2: Payslip Display

**What was fixed:**
- INR formatter handles null/undefined
- Color-coded error messages
- Retry button on errors

**How to test:**

1. **Normal Operation Test:**
   ```
   1. Login to HRMS
   2. Navigate to Payroll > Payslip Center
   3. Select a payroll run
   4. View payslips
   5. Check if amounts display correctly:
      - Basic Salary
      - HRA
      - Deductions
      - Net Pay
   ```

2. **Null/Undefined Handling Test:**
   ```
   1. View payslip with missing data
   2. All amounts should show "₹0" instead of crashing
   3. No "NaN" or "undefined" text visible
   ```

3. **Error Messages Test:**
   ```
   1. Try to load payslips when backend is slow/failing
   2. Error message should show:
      - RED banner (for errors)
      - BLUE banner (for info)
      - Retry button visible
   
   3. Click Retry button
   4. Should reload data
   ```

4. **Expected Behavior:**
   - ✅ All amounts show correctly formatted (₹1,00,000)
   - ✅ Null values show as ₹0
   - ✅ Error messages are color-coded
   - ✅ Retry button works
   - ✅ No crashes on invalid data

---

## 🚀 **QUICK TEST SCRIPT**

Run this to test both pages quickly:

```bash
# 1. Start backend
cd /home/shuvam/hrms-audit/backend
npm run dev

# 2. Start frontend (in new terminal)
cd /home/shuvam/hrms-audit
npm run dev

# 3. Open browser
# Navigate to: http://localhost:5173

# 4. Test Attendance:
#    - Go to Attendance page
#    - Change month
#    - Check history loads

# 5. Test Payslip:
#    - Go to Payroll > Payslip Center
#    - Select run
#    - View payslip
#    - Check amounts display

# 6. Test Error Handling:
#    - Stop backend (Ctrl+C)
#    - Try to load pages
#    - Check error messages
#    - Click Retry buttons
#    - Restart backend
#    - Verify Retry works
```

---

## 📊 **EXPECTED RESULTS**

### Attendance Page:
| Scenario | Expected Result |
|----------|----------------|
| Normal load | ✅ Data displays in table |
| API error | ✅ Red error banner shows |
| No data | ✅ Empty state message |
| Retry click | ✅ Page reloads |

### Payslip Page:
| Scenario | Expected Result |
|----------|----------------|
| Normal load | ✅ Amounts formatted correctly |
| Null values | ✅ Shows ₹0 |
| API error | ✅ Red banner with retry |
| Success message | ✅ Blue banner |

---

## 🐛 **IF YOU FIND ISSUES**

**Report format:**
```
Page: [Attendance / Payslip]
Action: [What you did]
Expected: [What should happen]
Actual: [What happened]
Error: [Any error message]
Browser: [Chrome/Firefox/Safari]
```

**Example:**
```
Page: Attendance
Action: Changed month to June 2026
Expected: Attendance history should load
Actual: Blank page, no error
Error: Console shows "Failed to fetch"
Browser: Chrome 120
```

---

## ✅ **TESTING CHECKLIST**

### Attendance Page:
- [ ] Page loads without errors
- [ ] Month selector works
- [ ] History table displays
- [ ] Error message shows on failure
- [ ] Retry button visible on error
- [ ] Retry button works
- [ ] Loading skeleton shows while fetching

### Payslip Page:
- [ ] Payslip Center loads
- [ ] Run selector works
- [ ] Payslips display
- [ ] Amounts formatted correctly (₹)
- [ ] No NaN or undefined visible
- [ ] Error messages color-coded
- [ ] Retry button works
- [ ] Modal opens correctly

---

## 🎯 **SUCCESS CRITERIA**

**Both pages pass if:**
1. ✅ Normal operations work without errors
2. ✅ Error messages display clearly
3. ✅ Retry buttons function correctly
4. ✅ No crashes on invalid data
5. ✅ UI is responsive and clear

---

## 🔍 **DEBUGGING TIPS**

**If Attendance page doesn't load:**
1. Check browser console (F12)
2. Look for network errors
3. Verify API endpoint: `/api/wfm/attendance/daily`
4. Check employee_id is set

**If Payslip shows wrong data:**
1. Check payroll run is selected
2. Verify backend calculations
3. Check database directly:
   ```sql
   SELECT * FROM payroll_lines WHERE payroll_run_id = 'xxx';
   ```

**Common Issues:**
- **404 errors**: Backend not running
- **401 errors**: Not logged in
- **500 errors**: Backend crash (check logs)
- **Blank page**: JavaScript error (check console)

---

## 📞 **NEED HELP?**

If tests fail or you need assistance:
1. Note the exact error message
2. Check browser console
3. Check backend logs
4. Share the error with me

---

## 🎉 **NEXT AFTER TESTING**

Once tests pass, we'll proceed with:
1. ✅ WhatsApp/SMS notifications
2. ✅ Offer letter generation (backend ready!)
3. ✅ Analytics dashboard
4. ✅ Old database integration

**Current Status:**
- Bug fixes: ✅ DEPLOYED
- Testing: 🧪 IN PROGRESS
- Next features: 📋 READY TO BUILD
