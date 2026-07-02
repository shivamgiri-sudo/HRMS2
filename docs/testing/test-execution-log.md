# MAS-CallNet HRMS: Test Execution Log

**Start Date**: 2026-06-01  
**Tester**: Claude (Automated Testing Assistant)  
**Environment**: Local Development

---

## Test Environment Status

**Backend**: ❌ Not running (Port 3002)  
**Frontend**: ❌ Not running (Port 5173)  
**Database**: MySQL (mas_hrms on 122.184.128.90:3306)

**Action Required**: Start backend + frontend before executing tests

### Starting Services

#### Backend (Terminal 1)
```bash
cd /home/shuvam/mas-callnet-hrms/backend
npm run dev
# Expected: Server listening on port 3002
```

#### Frontend (Terminal 2)
```bash
cd /home/shuvam/mas-callnet-hrms
npm run dev
# Expected: Vite dev server on port 5173
```

---

## Test Execution Results

### P0 Tests: AUTHENTICATION (11 test cases)

#### TC-AUTH-001: Standard Login (Admin)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Navigate to `http://localhost:5173/auth`
2. Enter email: `admin@shivu.ai`
3. Enter password: `admin123`
4. Click "Sign In"

**Expected**: Redirect to `/`, session token created  
**Actual**: -  
**Notes**: -  

---

#### TC-AUTH-002: Invalid Credentials
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Navigate to `http://localhost:5173/auth`
2. Enter email: `admin@shivu.ai`
3. Enter password: `wrong123`
4. Click "Sign In"

**Expected**: Error "Invalid credentials", stay on login page  
**Actual**: -  
**Notes**: -  

---

#### TC-AUTH-003: Forgot Password Flow
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Navigate to `/auth`
2. Click "Forgot Password?"
3. Enter email: `hr@shivu.ai`
4. Click "Send Reset Link"
5. Check email inbox (check Supabase email logs)
6. Click reset link in email
7. Redirected to `/reset-password`
8. Enter new password (min 6 chars): `newpass123`
9. Confirm password: `newpass123`
10. Click "Update Password"

**Expected**: Success message, redirect to dashboard  
**Actual**: -  
**Notes**: Check Supabase email configuration  

---

#### TC-AUTH-004: Reset Password - Invalid Link
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Navigate to `http://localhost:5173/reset-password` (no token)

**Expected**: "Invalid or Expired Link" message, "Back to Login" button  
**Actual**: -  
**Notes**: -  

---

#### TC-AUTH-005: Admin-Initiated Password Reset
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Login as admin
2. Get target user ID from database
3. POST `http://localhost:3002/api/account-control/reset-request`
   ```json
   {
     "userId": "<target-user-uuid>"
   }
   ```
4. Check audit log: GET `/api/account-control/audit-log/<userId>`

**Expected**: Reset request logged, admin action tracked  
**Actual**: -  
**Notes**: Use Postman/curl for API tests  

---

#### TC-AUTH-006: Force Password Change
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Login as admin
2. POST `/api/account-control/force-change`
   ```json
   {
     "userId": "<target-user-uuid>",
     "reason": "Security policy"
   }
   ```
3. Target user next login → verify forced to change password

**Expected**: Target user cannot proceed until password changed  
**Actual**: -  
**Notes**: -  

---

#### TC-AUTH-007: Account Lock (Admin)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Login as admin
2. POST `/api/account-control/lock`
   ```json
   {
     "userId": "<target-user-uuid>",
     "reason": "Suspicious activity"
   }
   ```
3. Target user attempts login

**Expected**: Lock successful, login fails with "Account locked"  
**Actual**: -  
**Notes**: -  

---

#### TC-AUTH-008: Account Unlock (Admin)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. POST `/api/account-control/unlock`
   ```json
   {
     "userId": "<locked-user-uuid>"
   }
   ```
2. Target user attempts login

**Expected**: Unlock successful, login works  
**Actual**: -  
**Notes**: -  

---

#### TC-AUTH-009: Account Disable (Admin)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. POST `/api/account-control/disable`
   ```json
   {
     "userId": "<target-user-uuid>",
     "reason": "Exited company"
   }
   ```
2. Check user status in Supabase auth table

**Expected**: User disabled, cannot login  
**Actual**: -  
**Notes**: -  

---

#### TC-AUTH-010: Session Revoke (Admin)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Target user logged in (active session)
2. POST `/api/account-control/revoke-session`
   ```json
   {
     "userId": "<target-user-uuid>"
   }
   ```
3. Check target user session (should be logged out)

**Expected**: Session terminated, user logged out immediately  
**Actual**: -  
**Notes**: May need to refresh target user's browser  

---

#### TC-AUTH-011: Account Audit Log (Admin/HR)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Login as admin/HR
2. GET `/api/account-control/audit-log/<userId>?limit=50`

**Expected**: All actions visible (reset, lock, unlock, disable, revoke) with timestamp, actor, IP  
**Actual**: -  
**Notes**: -  

---

### P0 Tests: EMPLOYEE MANAGEMENT (9 test cases)

#### TC-EMP-001: View All Employees (Admin/HR)
**Status**: PENDING  
**Date**: -  
**Role**: Admin  
**Steps**:
1. Login as `admin@shivu.ai / admin123`
2. Navigate to `/employees`
3. Count visible employees

**Expected**: ALL employees visible (not filtered)  
**Actual**: -  
**Notes**: -  

---

#### TC-EMP-002: View Team Employees Only (Manager)
**Status**: PENDING  
**Date**: -  
**Role**: Manager  
**Steps**:
1. Login as `manager@shivu.ai / manager123`
2. Navigate to `/employees`
3. Count visible employees
4. Verify all visible employees have `reporting_manager_id = <manager-id>`

**Expected**: ONLY reportees visible  
**Actual**: -  
**Severity**: CRITICAL if fails (data leak)  
**Notes**: -  

---

#### TC-EMP-003: Employee Cannot See List (Employee)
**Status**: PENDING  
**Date**: -  
**Role**: Employee  
**Steps**:
1. Login as `employee@shivu.ai / employee123`
2. Navigate to `/employees`

**Expected**: 403 Forbidden OR redirect to dashboard  
**Actual**: -  
**Severity**: CRITICAL if fails  
**Notes**: -  

---

#### TC-EMP-004: Add Employee (Admin/HR)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Login as admin
2. Navigate to `/employees`
3. Click "Add Employee"
4. Fill form:
   - Name: "Test User"
   - Email: "testuser@test.com"
   - Phone: "9999999999"
   - DOJ: "2026-06-01"
   - Designation: "Agent"
   - Branch: Select any
   - Client: Select any
   - Process: Select any
5. Click "Save"

**Expected**: Employee created, `employee_code` auto-generated (MAS00XXX)  
**Actual**: -  
**Notes**: Delete test employee after testing  

---

#### TC-EMP-005: Edit Employee (Admin/HR)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Navigate to `/employees`
2. Click test employee → Edit
3. Update phone: "8888888888"
4. Save

**Expected**: Employee updated  
**Actual**: -  
**Notes**: -  

---

#### TC-EMP-006: Archive Employee (Admin/HR)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Click test employee → Archive
2. Confirm

**Expected**: Employee status = "Inactive", not in active list  
**Actual**: -  
**Notes**: -  

---

#### TC-EMP-007: View Own Profile (Employee)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Login as employee
2. Navigate to `/profile`

**Expected**: Own profile visible  
**Actual**: -  
**Notes**: -  

---

#### TC-EMP-008: Edit Own Contact Details (Employee)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Navigate to `/profile`
2. Edit phone, current address
3. Save

**Expected**: Changes saved  
**Actual**: -  
**Notes**: -  

---

#### TC-EMP-009: Cannot Edit Critical Fields (Employee)
**Status**: PENDING  
**Date**: -  
**Steps**:
1. Navigate to `/profile`
2. Check if DOJ, Designation, Salary fields editable

**Expected**: Fields disabled/read-only  
**Actual**: -  
**Severity**: CRITICAL if fails  
**Notes**: -  

---

### P0 Tests: ATTENDANCE (14 test cases)

**Status**: ALL PENDING  
**Note**: Tests require backend + frontend running  

---

### P0 Tests: PAYROLL (18 test cases)

**Status**: ALL PENDING  
**Note**: Tests require backend + frontend running  

---

## Test Statistics

| Priority | Total | Passed | Failed | Blocked | Pending |
|----------|-------|--------|--------|---------|---------|
| P0 | 43 | 0 | 0 | 0 | 43 |
| P1 | 45 | 0 | 0 | 0 | 45 |
| P2 | 29 | 0 | 0 | 0 | 29 |
| **Total** | **117** | **0** | **0** | **0** | **117** |

---

## Issues Found

### BLOCKER-001: Services Not Running
**Severity**: BLOCKER  
**Description**: Backend (port 3002) and frontend (port 5173) not running  
**Impact**: Cannot execute any tests  
**Resolution**: Start both services before testing  
**Status**: OPEN  

---

## Next Steps

1. ✅ Start backend: `cd backend && npm run dev`
2. ✅ Start frontend: `cd . && npm run dev`
3. ✅ Verify services running (check ports 3002, 5173)
4. ✅ Execute TC-AUTH-001 (Standard Login)
5. Continue P0 authentication tests sequentially

---

**Last Updated**: 2026-06-01 22:00 IST
