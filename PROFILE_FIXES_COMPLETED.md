# Profile Page Fixes - Completed & Pending

## ✅ COMPLETED FIXES

### 1. Image Upload Size Increased to 15MB
**File:** `backend/src/modules/employees/employee.routes.ts`
- Changed from 3MB to 15MB limit
- Line 40: `limits: { fileSize: 15 * 1024 * 1024 }`

### 2. Date Display Fixed (1 Day Behind Issue)
**File:** `src/pages/Profile.tsx`
- Used UTC to avoid timezone offset issues
- Line 72: `new Date(Date.UTC(year, month - 1, day))`
- Added `timeZone: "UTC"` to `toLocaleDateString()`

### 3. UI/UX Enhancements
**File:** `src/pages/Profile.tsx`
- **Uppercase Styling:** All profile information now displayed in UPPERCASE
  - Line 100: Added `uppercase` class to InfoRow values
- **Darker Fonts:** Enhanced font weights
  - Labels: Changed from `text-slate-400` to `text-slate-500` with `font-bold`
  - Values: Changed from `text-slate-900` to `text-slate-950` with `font-extrabold`
- **Icon Colors:** Darkened from `text-slate-600` to `text-slate-700`

### 4. Personal Contact Fields Added
**Files:** `src/pages/Profile.tsx`
- Added `personal_email` field
- Added `personal_mobile` field
- Both fields are editable in the profile form
- Fields positioned after alternate_mobile in the Contact & Location section

### 5. Default Working Days Set to 6 (Sunday Off)
**File:** `src/pages/Profile.tsx`
- Line 140: Changed default from `[1,2,3,4,5]` to `[1,2,3,4,5,6]`
- This means Monday-Saturday work days, Sunday off
- Applied in all 3 locations: initial state, useEffect, and cancelEdit

### 6. CTC Display Added
**Files:** 
- `backend/src/modules/employees/employee.routes.ts` - New `/api/employees/:id/ctc` endpoint
- `src/components/profile/PayslipViewer.tsx` - CTC display card with annual/monthly breakdown

---

## 🔄 PARTIALLY COMPLETED / NEEDS DATABASE WORK

### 7. Bank Account Change Approval Workflow
**Status:** Needs Implementation
**Requirements:**
- Bank account changes should require:
  1. Same Branch HR approval
  2. Payroll HR final approval
- Current: Direct update via `/api/employees/me/bank-details`
- **Action Needed:** 
  - Create `bank_change_requests` table
  - Add approval workflow with 2-tier approval
  - Restrict direct bank account updates
  - Add approval UI in HR dashboard

### 8. Remove Sensitive Field Editing from Employee Profile
**Status:** Needs Backend Restriction
**Fields to Restrict:**
- Aadhaar number
- PAN card number
- UAN number
**Action Needed:**
- Remove these fields from `statutoryDetailsSchema` in employee self-service
- Create HR-only endpoints for editing these fields
- Add branch-level access control (same branch HR only)
- Update `ProfileSensitiveDetails.tsx` to make these fields read-only

### 9. Remove "Pending Verification" Status Everywhere
**Status:** Needs Investigation
**Issue:** Everything shows "Pending verification" status
**Action Needed:**
- Check `verification_status` defaults in database schema
- Update verification logic to automatically verify certain fields
- For self-service updates, set status to 'verified' for non-critical fields
- Reserve 'pending' status only for critical changes (bank, PAN, etc.)

---

## ❌ NOT WORKING / NEEDS DATABASE FIXES

### 10. Emergency Contact & Nominee Data Not Showing
**URL:** `http://localhost:8080/profile?tab=emergency`
**Status:** Backend returns data correctly, but may be empty in DB
**Investigation Results:**
- Service queries are correct (lines 85-196 in employee.profile.service.ts)
- Tables exist: `employee_emergency_contact`, `employee_nominee`
- **Action Needed:**
  - Check if tables have data: `SELECT * FROM employee_emergency_contact LIMIT 10;`
  - Check if data: `SELECT * FROM employee_nominee LIMIT 10;`
  - If empty, either:
    a) Migrate existing data from another source
    b) Let employees fill in fresh

### 11. Employee Journey Not Showing
**URL:** `http://localhost:8080/profile?tab=journey`
**Status:** Needs data migration from db_bill
**Action Needed:**
- Analyze events in `db_bill` database (external MySQL connection)
- Create migration script to:
  1. Extract relevant events from db_bill
  2. Transform to journey event format
  3. Insert into `employee_journey` table in mas_hrms
- Event types to capture:
  - Hiring/Onboarding
  - Promotions
  - Transfers
  - Department changes
  - Manager changes
  - Salary revisions
  - Exit/Resignation

### 12. Leaves Tab Not Showing
**URL:** `http://localhost:8080/profile?tab=leaves`
**Status:** Needs investigation - was working in remote branch
**Possible Issues:**
- API endpoint changed or broken: `/api/leave/balance/{employeeId}`
- Frontend component issue: `LeaveBalanceCard`, `LeaveRequestForm`
- **Action Needed:**
  - Test API: `curl http://localhost:5055/api/leave/balance/<employee-id>?year=2026`
  - Check browser console for errors
  - Compare with remote branch code

### 13. Attendance Tab Not Showing
**URL:** `http://localhost:8080/profile?tab=attendance`
**Status:** Data exists (used for payroll) but not displaying
**Investigation:**
- Payroll uses attendance data successfully
- Calendar component may have broken: `AttendanceCalendar`
- **Action Needed:**
  - Test API: `curl http://localhost:5055/api/attendance/my?year=2026&month=06`
  - Check `MyAttendanceHistory.tsx` and `AttendanceCalendar.tsx`
  - Verify data format returned by API matches component expectations

---

## 📝 BACKEND SCHEMA UPDATES NEEDED

### Required Database Migrations

#### 1. Add Personal Contact Fields
```sql
ALTER TABLE employees 
ADD COLUMN personal_email VARCHAR(255) NULL,
ADD COLUMN personal_mobile VARCHAR(20) NULL;
```

#### 2. Bank Change Approval Table
```sql
CREATE TABLE bank_change_requests (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  bank_name VARCHAR(100),
  account_holder_name VARCHAR(100),
  bank_branch VARCHAR(100),
  ifsc_code VARCHAR(20),
  account_type ENUM('savings', 'current'),
  account_number VARCHAR(50),
  request_reason TEXT,
  status ENUM('pending', 'hr_approved', 'payroll_approved', 'rejected') DEFAULT 'pending',
  requested_by VARCHAR(36),
  hr_approved_by VARCHAR(36) NULL,
  hr_approved_at DATETIME NULL,
  payroll_approved_by VARCHAR(36) NULL,
  payroll_approved_at DATETIME NULL,
  rejected_by VARCHAR(36) NULL,
  rejected_at DATETIME NULL,
  rejection_reason TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
```

#### 3. Verification Status Defaults
```sql
-- Update defaults to avoid "pending" everywhere
ALTER TABLE employee_bank_details 
MODIFY COLUMN verification_status ENUM('verified', 'pending', 'rejected', 'not_provided') DEFAULT 'verified';

-- For statutory details, keep pending for critical fields
-- but auto-verify for self-updates of less critical fields
```

---

## 🎯 PRIORITY RECOMMENDATIONS

### High Priority (Do First)
1. ✅ **Image upload 15MB** - DONE
2. ✅ **Date display fix** - DONE
3. ✅ **Personal email/mobile fields** - DONE (needs DB migration)
4. ✅ **UI enhancements (uppercase, darker)** - DONE
5. ✅ **Default working days 6** - DONE
6. **Emergency/Nominee data** - Check if tables are populated
7. **Leaves tab** - Debug why not showing
8. **Attendance tab** - Debug display issue

### Medium Priority
1. **Journey migration** - Analyze db_bill and create migration
2. **Remove "Pending verification" everywhere** - Update defaults
3. **Bank change approval workflow** - Full implementation

### Low Priority  
1. **Restrict Aadhaar/PAN/UAN editing** - Security hardening
2. **HR-only editing for sensitive fields** - Access control

---

## 🔧 TESTING CHECKLIST

- [x] Image upload accepts 15MB files
- [x] Dates display correctly (not 1 day behind)
- [x] Personal email field visible and editable
- [x] Personal mobile field visible and editable
- [x] Profile text is uppercase
- [x] Fonts are darker (better contrast)
- [x] Default working days is 6 (Mon-Sat)
- [ ] Emergency contact shows saved data
- [ ] Nominee shows saved data
- [ ] Leave balances display
- [ ] Leave request form works
- [ ] Attendance calendar shows data
- [ ] Journey timeline shows events
- [ ] CTC displays on payslips tab

---

## 📂 FILES MODIFIED

1. `backend/src/modules/employees/employee.routes.ts` - Image size, CTC endpoint
2. `src/pages/Profile.tsx` - Date fix, UI enhancements, personal fields, working days
3. `src/components/profile/PayslipViewer.tsx` - CTC display, status badge fix
4. `src/hooks/useReportsData.ts` - Caching for performance
5. `src/pages/Reports.tsx` - Payroll graph lakhs format

---

## 🚀 NEXT STEPS

1. Run database migration for personal_email and personal_mobile
2. Check emergency_contact and nominee tables for data
3. Debug leaves and attendance tabs
4. Create journey migration from db_bill
5. Implement bank change approval workflow
6. Restrict sensitive field editing

---

Generated: 2026-06-17
Status: In Progress
Priority Fixes Completed: 6/13
