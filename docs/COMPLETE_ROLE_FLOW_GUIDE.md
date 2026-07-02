# MAS Callnet PeopleOS — Complete Role Flow Guide

## Every Role · Every Screen · Every API · Every Database Table

**Prepared for:** CEO, HR Team, Engineering  
**Date:** 3rd June 2026  
**Purpose:** Trace every user action from button click to frontend page to API call to Express route to SQL query to database table to response displayed to user.

---

## How to Read This Document

Each activity follows this format:

```
### [Role N] — [Role Name]

#### Activity: [Name]
- **Frontend:** `path/to/page.tsx` → [what user does]
- **API Call:** `METHOD /api/endpoint` — body: `{...}` or query: `?param=value`
- **Backend Route:** `backend/src/modules/X/X.routes.ts:NN` → handler name
- **SQL:** `SELECT/INSERT/UPDATE ... FROM table WHERE ...`
- **DB Table(s):** `table_name` — columns affected
- **Result:** What the user sees / what happens next
```

---

## Table of Contents

1. [Walk-in Candidate (No Auth)](#role-1--walk-in-candidate-no-auth)
2. [Recruiter](#role-2--recruiter)
3. [HR Admin](#role-3--hr-admin)
4. [Employee (Self-Service)](#role-4--employee-self-service)
5. [Manager / Team Lead / Branch Head](#role-5--manager--team-lead--branch-head)
6. [WFM](#role-6--wfm)
7. [Finance / Payroll](#role-7--financepayroll)
8. [QA / Quality](#role-8--qaquality)
9. [CEO / Leadership](#role-9--ceoleadership)
10. [Client Portal User](#role-10--client-portal-user)
11. [Trainer / LMS Coordinator](#role-11--trainerlms-coordinator)
12. [Super Admin / System Admin](#role-12--super-admin--system-admin)
13. [Process Manager](#role-13--process-manager)
14. [Built-in Business Logic](#built-in-business-logic)

---

## SHARED: Authentication Flow (All Roles Except Walk-in Candidate and Client Portal)

#### Activity: Login
- **Frontend:** `src/pages/Auth.tsx` → User enters email/employee code and password, clicks "Sign In"
- **API Call:** `POST /api/auth/login` — body: `{ "identifier": "email or employee_code", "password": "..." }`
- **Backend Route:** `backend/src/modules/auth/auth.routes.ts:11` → inline handler
- **SQL:**
  ```sql
  SELECT au.id, au.email, au.password_hash, au.is_blocked
    FROM auth_user au WHERE au.email = ?
  UNION
  SELECT au.id, au.email, au.password_hash, au.is_blocked
    FROM auth_user au JOIN employees e ON e.user_id = au.id
   WHERE e.employee_code = ?
  LIMIT 1
  ```
  Then on success:
  ```sql
  UPDATE auth_user SET last_login_at = NOW() WHERE id = ?
  INSERT INTO auth_refresh_token (id, user_id, token_hash, expires_at) VALUES (UUID(), ?, ?, ?)
  ```
- **DB Table(s):** `auth_user` — read password_hash, is_blocked; update last_login_at. `auth_refresh_token` — insert new token.
- **Result:** Returns `{ accessToken, refreshToken, user: { id, email, isBlocked } }`. Frontend stores JWT, redirects to dashboard.

#### Activity: Fetch RBAC (immediately after login)
- **Frontend:** `src/hooks/useUserRole.ts` → called on mount
- **API Call:** `GET /api/access/me` — header: `Authorization: Bearer <JWT>`
- **Backend Route:** `backend/src/modules/access/access.routes.ts:25` → getAccessMe()
- **SQL:**
  ```sql
  SELECT ur.role_key FROM user_roles ur WHERE ur.user_id = ? AND ur.active_status = 1
  SELECT rpa.page_code, rpa.can_view, rpa.can_create, rpa.can_edit, rpa.can_delete, rpa.can_export
    FROM role_page_access rpa WHERE rpa.role_key IN (...)
  SELECT * FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1
  ```
- **DB Table(s):** `user_roles`, `role_page_access`, `employees`
- **Result:** Returns user identity, roles array, scopes, page permissions. Sidebar renders only permitted pages.

#### Activity: Token Refresh
- **Frontend:** Axios interceptor on 401 response
- **API Call:** `POST /api/auth/refresh` — body: `{ "refreshToken": "..." }`
- **Backend Route:** `backend/src/modules/auth/auth.routes.ts:45` → inline handler
- **SQL:**
  ```sql
  SELECT rt.user_id, au.email FROM auth_refresh_token rt
    JOIN auth_user au ON au.id = rt.user_id
   WHERE rt.token_hash = ? AND rt.revoked = 0 AND rt.expires_at > NOW() LIMIT 1
  ```
- **DB Table(s):** `auth_refresh_token`, `auth_user`
- **Result:** Returns new `accessToken`. Session continues seamlessly.

---

## [ROLE 1] — Walk-in Candidate (No Auth)

### Activity: Open Candidate Registration Form
- **Frontend:** `src/pages/ats/CandidateWebForm.tsx` → Candidate navigates to public URL (shared by recruiter)
- **API Call:** None — form is static/client-rendered
- **Backend Route:** N/A (public page load)
- **SQL:** None
- **DB Table(s):** None
- **Result:** Registration form renders with fields: name, mobile, email, gender, DOB, process, branch, shift preferences, education, experience.

### Activity: Fill and Submit Registration
- **Frontend:** `src/pages/ats/CandidateWebForm.tsx` → Candidate fills all fields and clicks "Submit"
- **API Call:** `POST /api/ats/candidates` — body:
  ```json
  {
    "fullName": "John Doe", "mobile": "9876543210", "email": "john@mail.com",
    "gender": "male", "dateOfBirth": "1998-05-15",
    "appliedForProcess": "Customer Support", "appliedForBranch": "Delhi",
    "sourcingChannel": "Walk-In", "walkInDate": "2026-06-03",
    "education": "Graduate", "experience": "1 year",
    "rotationalShift": true, "nightShiftOk": true,
    "idProofAvailable": true, "educationProofAvailable": true
  }
  ```
- **Backend Route:** `backend/src/modules/ats/ats.routes.ts:16` → `c.createCandidate` (PUBLIC, no auth)
- **SQL:**
  ```sql
  SELECT id FROM ats_candidate WHERE mobile = ? LIMIT 1
  INSERT INTO ats_candidate
    (id, candidate_code, full_name, mobile, email, gender, date_of_birth,
     applied_for_process, applied_for_branch, sourcing_channel, referred_by,
     walk_in_date, remarks, created_by, address, education, experience,
     rotational_shift, preferred_shift, night_shift_ok, leaves_in_3months,
     owns_two_wheeler, id_proof_available, education_proof_available,
     recruiter_name, profile_status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ```
- **DB Table(s):** `ats_candidate` — insert new row with `current_stage = 'New'`, `active_status = 1`
- **Result:** Returns `{ success: true, data: { id, candidate_code, ... }, message: "Candidate registered" }`. Candidate sees confirmation screen.

### Activity: File Upload (Resume / Selfie)
- **Frontend:** `src/pages/ats/CandidateWebForm.tsx` → File input for resume/selfie attached to form
- **API Call:** `POST /api/files/upload?category=candidate-documents` — multipart/form-data with field "file"
- **Backend Route:** `backend/src/modules/files/files.routes.ts:59` → multer middleware + inline handler
- **SQL:** None directly (file saved to disk; metadata may be stored separately if linked)
- **DB Table(s):** File stored at `/uploads/candidate-documents/<uuid>.ext`. URL returned for later association.
- **Result:** Returns `{ success: true, url: "/api/files/candidate-documents/<uuid>.pdf" }`. URL saved to candidate record via subsequent PATCH.

---

## [ROLE 2] — Recruiter

### Activity: Login
- **Frontend:** `src/pages/Auth.tsx` → Same as shared authentication flow above
- **API Call:** `POST /api/auth/login`
- **Backend Route:** `backend/src/modules/auth/auth.routes.ts:11`
- **SQL:** (See Shared Authentication Flow)
- **DB Table(s):** `auth_user`, `auth_refresh_token`
- **Result:** JWT issued; redirect to recruiter dashboard. Role: `recruiter`

### Activity: View Candidate Queue
- **Frontend:** `src/pages/ats/NativeATSCandidateQueue.tsx` → Opens candidate listing page
- **API Call:** `GET /api/ats/candidates?stage=New&page=1&limit=20`
- **Backend Route:** `backend/src/modules/ats/ats.routes.ts:22` → `c.listCandidates`
- **SQL:**
  ```sql
  SELECT * FROM ats_candidate
   WHERE active_status = 1 AND current_stage = ?
   ORDER BY created_at DESC LIMIT 20 OFFSET 0
  SELECT COUNT(*) AS total FROM ats_candidate WHERE active_status = 1 AND current_stage = ?
  ```
- **DB Table(s):** `ats_candidate` — read
- **Result:** Paginated list of candidates at 'New' stage with name, mobile, process, branch, date.

### Activity: View Waiting Queue (Walk-In)
- **Frontend:** `src/pages/ats/NativeATSWaitingQueue.tsx` → Opens walk-in waiting queue
- **API Call:** `GET /api/ats/waiting-queue`
- **Backend Route:** `backend/src/modules/ats/ats.routes.ts:65` → inline handler
- **SQL:**
  ```sql
  SELECT c.* FROM ats_candidate c
   WHERE c.current_stage IN ('New','Screening') AND c.active_status = 1
   ORDER BY c.walk_in_date DESC, c.created_at DESC
   LIMIT 100
  ```
- **DB Table(s):** `ats_candidate` — read
- **Result:** List of walk-in candidates waiting for screening/interview, sorted by arrival date.

### Activity: Move Candidate Stage
- **Frontend:** `src/pages/ats/CandidateDetail.tsx` → Recruiter clicks "Move to Screening" / "Move to Interview" / "Select" / "Reject"
- **API Call:** `POST /api/ats/candidates/:id/move-stage` — body: `{ "toStage": "Screening", "remarks": "Good communication" }`
- **Backend Route:** `backend/src/modules/ats/ats.routes.ts:25` → `c.moveStage`
- **SQL:**
  ```sql
  UPDATE ats_candidate SET current_stage = ?, updated_at = NOW() WHERE id = ?
  INSERT INTO ats_candidate_stage_log (id, candidate_id, from_stage, to_stage, remarks, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
  ```
  If `toStage = 'Selected'`: triggers `sendSelectedEmail()` + `sendOnboardingToken()` (async, non-blocking).
  If `toStage = 'Rejected'`: triggers `sendRejectedEmail()`.
- **DB Table(s):** `ats_candidate` — update current_stage. `ats_candidate_stage_log` — insert log. `ats_email_log` — async email record.
- **Result:** Candidate card updates to new stage. Email sent to candidate if Selected/Rejected.

### Activity: View Candidate Details
- **Frontend:** `src/pages/ats/CandidateDetail.tsx` → Click on candidate row
- **API Call:** `GET /api/ats/candidates/:id`
- **Backend Route:** `backend/src/modules/ats/ats.routes.ts:23` → `c.getCandidate`
- **SQL:**
  ```sql
  SELECT * FROM ats_candidate WHERE id = ? LIMIT 1
  ```
- **DB Table(s):** `ats_candidate` — read single row
- **Result:** Full candidate profile displayed: personal info, education, experience, shift preferences, current stage, documents.

### Activity: Send Onboarding Link
- **Frontend:** `src/pages/ats/CandidateDetail.tsx` → Click "Send Onboarding Link" button
- **API Call:** `POST /api/ats/onboarding/send-token/:candidateId`
- **Backend Route:** `backend/src/modules/ats/ats.onboarding.routes.ts:39` → `sendOnboardingToken()`
- **SQL:**
  ```sql
  SELECT * FROM ats_candidate WHERE id = ? LIMIT 1
  INSERT INTO ats_onboarding_bridge (id, candidate_id, onboarding_token, onboarding_token_expires_at, ...)
    VALUES (?, ?, ?, ?, ...) ON DUPLICATE KEY UPDATE onboarding_token = VALUES(onboarding_token), ...
  ```
- **DB Table(s):** `ats_candidate`, `ats_onboarding_bridge` — insert/update token
- **Result:** Onboarding token generated, link sent to candidate's email/phone. Recruiter sees confirmation.

### Activity: View ATS Stats
- **Frontend:** `src/pages/ats/NativeATSDashboard.tsx` → Dashboard loads
- **API Call:** `GET /api/ats/stats?fromDate=2026-06-01&toDate=2026-06-30`
- **Backend Route:** `backend/src/modules/ats/ats.routes.ts:47` → `c.getDashboardStats`
- **SQL:**
  ```sql
  SELECT current_stage, COUNT(*) AS count FROM ats_candidate
   WHERE active_status = 1 AND walk_in_date BETWEEN ? AND ?
   GROUP BY current_stage
  ```
- **DB Table(s):** `ats_candidate` — aggregated read
- **Result:** Dashboard shows counts per stage: New, Screening, Interview, Selected, Rejected, Onboarding.

### Activity: Reject Candidate
- **Frontend:** `src/pages/ats/CandidateDetail.tsx` → Click "Reject" button, enter remarks
- **API Call:** `POST /api/ats/candidates/:id/move-stage` — body: `{ "toStage": "Rejected", "remarks": "Failed interview" }`
- **Backend Route:** `backend/src/modules/ats/ats.routes.ts:25` → `c.moveStage`
- **SQL:** Same as "Move Candidate Stage" above with `toStage = 'Rejected'`
- **DB Table(s):** `ats_candidate`, `ats_candidate_stage_log`, `ats_email_log`
- **Result:** Candidate marked as Rejected. Rejection email sent automatically.

---

## [ROLE 3] — HR Admin

### Activity: Login + RBAC
- **Frontend:** `src/pages/Auth.tsx` → Login with HR credentials
- **API Call:** `POST /api/auth/login` then `GET /api/access/me`
- **Backend Route:** `backend/src/modules/auth/auth.routes.ts:11`, `backend/src/modules/access/access.routes.ts:25`
- **SQL:** (See Shared Authentication Flow)
- **DB Table(s):** `auth_user`, `auth_refresh_token`, `user_roles`, `role_page_access`, `employees`
- **Result:** Full HR Admin sidebar rendered with all HR modules accessible.

### Activity: Create Employee
- **Frontend:** `src/pages/employees/EmployeeCreate.tsx` → Fill employee form and submit
- **API Call:** `POST /api/employees` — body:
  ```json
  {
    "first_name": "Priya", "last_name": "Sharma", "email": "priya@mascallnet.com",
    "employee_code": "MAS001", "date_of_joining": "2026-06-01",
    "branch_id": "uuid", "department_id": "uuid", "designation_id": "uuid",
    "process_id": "uuid", "employment_status": "active"
  }
  ```
- **Backend Route:** `backend/src/modules/employees/employee.routes.ts:41` → `c.createEmployee`
- **SQL:**
  ```sql
  INSERT INTO employees (id, first_name, last_name, email, employee_code, date_of_joining,
    branch_id, department_id, designation_id, process_id, employment_status, active_status, ...)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ...)
  ```
- **DB Table(s):** `employees` — insert new row
- **Result:** Employee created with system-generated ID. Returns full employee object. Employee appears in listing.

### Activity: Bulk Import Employees
- **Frontend:** `src/pages/employees/BulkImport.tsx` → Upload CSV file
- **API Call:** `POST /api/employees/bulk-import` — multipart/form-data with CSV
- **Backend Route:** `backend/src/modules/employees/employee.routes.ts` → bulk import handler
- **SQL:**
  ```sql
  INSERT INTO employees (id, first_name, last_name, email, employee_code, ...) VALUES (?, ?, ?, ?, ?, ...)
  -- Repeated for each row in CSV
  ```
- **DB Table(s):** `employees` — bulk insert
- **Result:** CSV parsed, employees created row by row with validation. Returns success/failure counts.

### Activity: Edit Employee Profile
- **Frontend:** `src/pages/employees/EmployeeProfile.tsx` → Edit fields, click "Save"
- **API Call:** `PATCH /api/employees/:id` — body: `{ "designation_id": "new-uuid", "department_id": "new-uuid" }`
- **Backend Route:** `backend/src/modules/employees/employee.routes.ts:43` → `c.updateEmployee`
- **SQL:**
  ```sql
  UPDATE employees SET designation_id = ?, department_id = ?, updated_at = NOW() WHERE id = ?
  ```
- **DB Table(s):** `employees` — update specific columns
- **Result:** Employee record updated. Profile page reflects changes immediately.

### Activity: Upload Document
- **Frontend:** `src/pages/employees/EmployeeDocuments.tsx` → Select file, choose category, upload
- **API Call:** `POST /api/files/upload?category=employee-documents` — multipart/form-data with field "file"
- **Backend Route:** `backend/src/modules/files/files.routes.ts:59` → multer + inline handler
- **SQL:** File saved to disk. Metadata insert:
  ```sql
  INSERT INTO employee_documents (id, employee_id, document_type, file_url, uploaded_by, ...)
    VALUES (?, ?, ?, ?, ?, ...)
  ```
- **DB Table(s):** `employee_documents` — insert metadata. Physical file at `/uploads/employee-documents/<uuid>.ext`
- **Result:** Document uploaded and linked to employee. Appears in documents tab.

### Activity: Assign Asset to Employee
- **Frontend:** `src/pages/assets/AssetAssign.tsx` → Select asset, select employee, click "Assign"
- **API Call:** `POST /api/assets-mgmt/:id/assign` — body: `{ "employee_id": "uuid", "notes": "Laptop issued" }`
- **Backend Route:** `backend/src/modules/assets/assets.routes.ts:54` → `assetsService.assign()`
- **SQL:**
  ```sql
  INSERT INTO asset_assignment (id, asset_id, employee_id, assigned_by, assigned_at, notes, status)
    VALUES (?, ?, ?, ?, NOW(), ?, 'assigned')
  UPDATE asset_master SET current_status = 'assigned', current_employee_id = ?, updated_at = NOW() WHERE id = ?
  ```
- **DB Table(s):** `asset_assignment` — insert. `asset_master` — update status.
- **Result:** Asset linked to employee. Audit trail created. Asset status changes to "assigned".

### Activity: Generate Letter (Offer/Appointment/Experience)
- **Frontend:** `src/pages/employees/LetterGeneration.tsx` → Select template, select employee, click "Generate"
- **API Call:** `POST /api/communication/templates/render` — body: `{ "template_id": "uuid", "variables": { "employee_name": "Priya", ... } }`
- **Backend Route:** `backend/src/modules/communication/communication.routes.ts:19` → `c.renderTemplate`
- **SQL:**
  ```sql
  SELECT * FROM communication_template WHERE id = ? AND active_status = 1 LIMIT 1
  ```
- **DB Table(s):** `communication_template` — read template body with placeholders
- **Result:** Letter rendered with employee data substituted into template. PDF generated for download/email.

### Activity: Create Leave Type
- **Frontend:** `src/pages/settings/LeaveTypeSettings.tsx` → Fill form: code, name, max days, carry forward, etc.
- **API Call:** `POST /api/leave/types` — body: `{ "leaveCode": "CL", "leaveName": "Casual Leave", "maxDaysPerYear": 12, "carryForward": false, "requiresApproval": true, "paidLeave": true }`
- **Backend Route:** `backend/src/modules/leave/leave.routes.ts:18` → `leaveController.createLeaveType` (requireRole: admin, hr)
- **SQL:**
  ```sql
  SELECT id FROM leave_type_master WHERE leave_code = ? LIMIT 1
  INSERT INTO leave_type_master (id, leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  ```
- **DB Table(s):** `leave_type_master` — insert
- **Result:** New leave type available system-wide for all employees.

### Activity: Attendance Regularization (Admin Override)
- **Frontend:** `src/pages/wfm/AttendanceCorrection.tsx` → Select employee + date, set new status
- **API Call:** `PATCH /api/attendance-engine/daily/:employeeId/:date` — body:
  ```json
  { "attendanceStatus": "present", "lwpValue": 0, "overrideReason": "Biometric failed but was present", "isLocked": true }
  ```
- **Backend Route:** `backend/src/modules/wfm/attendance-engine.routes.ts:117` → correction handler (requireRole: admin, hr, wfm)
- **SQL:**
  ```sql
  UPDATE attendance_daily_record
    SET attendance_status = ?, lwp_value = ?, override_reason = ?, is_locked = ?,
        corrected_by = ?, corrected_at = NOW()
    WHERE employee_id = ? AND record_date = ?
  ```
- **DB Table(s):** `attendance_daily_record` — update with correction + lock
- **Result:** Attendance record corrected and locked. Cannot be overwritten by engine re-processing.

### Activity: Add Org Master (Branch / Department / Designation)
- **Frontend:** `src/pages/settings/OrgMasters.tsx` → Click "Add Branch", fill form, submit
- **API Call:** `POST /api/org/branches` — body: `{ "branch_name": "Mumbai", "branch_code": "MUM01", "city": "Mumbai" }`
- **Backend Route:** `backend/src/modules/org/org.routes.ts:32` → buildCrud POST handler (requireRole: admin, hr)
- **SQL:**
  ```sql
  INSERT INTO branch_master (id, branch_name, branch_code, city, active_status) VALUES (?, ?, ?, ?, 1)
  ```
- **DB Table(s):** `branch_master` (or `department_master`, `designation_master` depending on entity)
- **Result:** New org entity created. Available in all dropdown selections immediately.

### Activity: Assign Role to User
- **Frontend:** `src/pages/settings/AccessControl.tsx` → Select user, select role, click "Assign"
- **API Call:** `POST /api/access/roles/assign` — body: `{ "user_id": "uuid", "role_key": "hr" }`
- **Backend Route:** `backend/src/modules/access/access.routes.ts:55` → assignRole() (requireRole: admin)
- **SQL:**
  ```sql
  SELECT role_key FROM workforce_role_catalog WHERE role_key = ? AND active_status = 1 LIMIT 1
  INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE active_status = 1
  INSERT INTO sensitive_action_log (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, ip_address, acted_at)
    VALUES (?, ?, 'ROLE_ASSIGNED', 'ACCESS_CONTROL', 'user', ?, ?, ?, NOW())
  ```
- **DB Table(s):** `workforce_role_catalog` — validate. `user_roles` — upsert. `sensitive_action_log` — audit.
- **Result:** User now has the assigned role. Takes effect on next API call / page refresh.

### Activity: View Audit Log
- **Frontend:** `src/pages/settings/AuditLog.tsx` → View list with filters
- **API Call:** `GET /api/access/audit-log?module_key=ACCESS_CONTROL&limit=50`
- **Backend Route:** `backend/src/modules/access/access.routes.ts:71` → querySensitiveActionLog() (requireRole: admin)
- **SQL:**
  ```sql
  SELECT id, actor_user_id, action_type, module_key, entity_type, entity_id, ip_address, change_summary, acted_at
    FROM sensitive_action_log
   WHERE module_key = ?
   ORDER BY acted_at DESC LIMIT 50
  ```
- **DB Table(s):** `sensitive_action_log` — read
- **Result:** Paginated audit trail showing who did what, when, from which IP. Filterable by module, actor, action type.

---

## [ROLE 4] — Employee (Self-Service)

### Activity: Login
- **Frontend:** `src/pages/Auth.tsx` → Standard login
- **API Call:** `POST /api/auth/login` then `GET /api/access/me`
- **Backend Route:** (See Shared Authentication Flow)
- **DB Table(s):** `auth_user`, `auth_refresh_token`, `user_roles`, `role_page_access`, `employees`
- **Result:** Employee dashboard with self-service modules: leave, attendance, payslip, helpdesk, roster.

### Activity: Dashboard (My Profile Summary)
- **Frontend:** `src/pages/employees/EmployeeDashboard.tsx` → Loads on login
- **API Call:** `GET /api/employees/me`
- **Backend Route:** `backend/src/modules/employees/employee.routes.ts:16` → inline handler
- **SQL:**
  ```sql
  SELECT * FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1
  ```
- **DB Table(s):** `employees` — read own record
- **Result:** Employee sees name, designation, branch, process, DOJ, employee code.

### Activity: Apply Leave
- **Frontend:** `src/pages/leave/ApplyLeave.tsx` → Select leave type, dates, reason, submit
- **API Call:** `POST /api/leave/requests` — body:
  ```json
  { "employeeId": "uuid", "leaveTypeId": "uuid", "fromDate": "2026-06-10", "toDate": "2026-06-11", "totalDays": 2, "reason": "Family function" }
  ```
- **Backend Route:** `backend/src/modules/leave/leave.routes.ts:83` → `leaveController.submitRequest`
- **SQL:**
  ```sql
  INSERT INTO leave_request (id, employee_id, leave_type_id, from_date, to_date, total_days, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  ```
- **DB Table(s):** `leave_request` — insert with `status = 'pending'`
- **Result:** Leave request submitted. Status shows "Pending". Manager receives notification.

### Activity: View Leave Balance
- **Frontend:** `src/pages/leave/LeaveBalance.tsx` → Loads balances for current year
- **API Call:** `GET /api/leave/balance/:employeeId?year=2026`
- **Backend Route:** `backend/src/modules/leave/leave.routes.ts:86` → `leaveController.getBalance`
- **SQL:**
  ```sql
  SELECT lbl.*, ltm.leave_name, ltm.leave_code
    FROM leave_balance_ledger lbl
    JOIN leave_type_master ltm ON ltm.id = lbl.leave_type_id
   WHERE lbl.employee_id = ? AND lbl.balance_year = ?
  ```
- **DB Table(s):** `leave_balance_ledger`, `leave_type_master` — read
- **Result:** Table showing each leave type with allocated, used, adjusted, remaining days.

### Activity: Attendance History
- **Frontend:** `src/pages/wfm/MyAttendance.tsx` → View monthly attendance
- **API Call:** `GET /api/attendance-engine/daily?employeeId=uuid&fromDate=2026-06-01&toDate=2026-06-30`
- **Backend Route:** `backend/src/modules/wfm/attendance-engine.routes.ts:95` → listRecords handler
- **SQL:**
  ```sql
  SELECT * FROM attendance_daily_record
   WHERE employee_id = ? AND record_date BETWEEN ? AND ?
   ORDER BY record_date DESC
  ```
- **DB Table(s):** `attendance_daily_record` — read
- **Result:** Calendar/list view showing daily status: present, half_day, absent, leave_approved, holiday, week_off.

### Activity: Clock In
- **Frontend:** `src/pages/wfm/ClockInOut.tsx` → Click "Clock In" button (captures geolocation)
- **API Call:** `POST /api/attendance-engine/clock-in` — body:
  ```json
  { "employee_id": "uuid", "work_mode": "office", "latitude": 28.6139, "longitude": 77.2090, "location_name": "Delhi Office" }
  ```
- **Backend Route:** `backend/src/modules/wfm/attendance-engine.routes.ts:160` → inline handler
- **SQL:**
  ```sql
  SELECT id FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1
  INSERT INTO attendance_daily_record
    (id, employee_id, record_date, clock_in_time, work_mode, clock_in_lat, clock_in_lng, clock_in_location, attendance_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'present')
  ```
- **DB Table(s):** `attendance_daily_record` — check existing, then insert
- **Result:** Clock-in recorded with timestamp and location. Button switches to "Clock Out".

### Activity: Clock Out
- **Frontend:** `src/pages/wfm/ClockInOut.tsx` → Click "Clock Out" button
- **API Call:** `POST /api/attendance-engine/clock-out` — body: `{ "record_id": "uuid", "latitude": 28.6139, "longitude": 77.2090 }`
- **Backend Route:** `backend/src/modules/wfm/attendance-engine.routes.ts:187` → inline handler
- **SQL:**
  ```sql
  UPDATE attendance_daily_record
    SET clock_out_time = ?, clock_out_lat = ?, clock_out_lng = ?, clock_out_location = ?
    WHERE id = ?
  ```
- **DB Table(s):** `attendance_daily_record` — update clock_out fields
- **Result:** Clock-out time recorded. Total hours calculated. Day marked as complete.

### Activity: Regularization Request
- **Frontend:** `src/pages/wfm/Regularization.tsx` → Select date, enter reason, submit
- **API Call:** `POST /api/wfm/regularizations` — body:
  ```json
  { "employee_id": "uuid", "date": "2026-06-02", "requested_status": "present", "reason": "Biometric not working" }
  ```
- **Backend Route:** `backend/src/modules/wfm/wfm.routes.ts:40` → `wfmController.submitRegularization`
- **SQL:**
  ```sql
  INSERT INTO attendance_regularization (id, employee_id, date, requested_status, reason, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  ```
- **DB Table(s):** `attendance_regularization` — insert
- **Result:** Regularization request submitted with "pending" status. Awaits manager/HR approval.

### Activity: View Payslip
- **Frontend:** `src/pages/payroll/MyPayslip.tsx` → Select month/run
- **API Call:** `GET /api/payroll/payslip/:runId/:employeeId`
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:87` → inline handler (self-access allowed)
- **SQL:**
  ```sql
  SELECT * FROM employee_payslip WHERE run_id = ? AND employee_id = ? LIMIT 1
  SELECT * FROM employee_payslip_line WHERE payslip_id = ?
  ```
- **DB Table(s):** `employee_payslip`, `employee_payslip_line` — read
- **Result:** Payslip displayed with earnings, deductions, net pay, employer contributions.

### Activity: Tax Declaration
- **Frontend:** `src/pages/payroll/TaxDeclaration.tsx` → Enter investment declarations under sections
- **API Call:** `POST /api/payroll/tax-declaration/:employeeId/:year` — body:
  ```json
  { "section_80c": 150000, "section_80d": 25000, "hra_claimed": 180000, "regime": "old" }
  ```
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:146` → inline handler (self-access enforced)
- **SQL:**
  ```sql
  INSERT INTO employee_tax_declaration (id, employee_id, financial_year, declarations, submitted_by)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE declarations = VALUES(declarations), updated_at = NOW()
  ```
- **DB Table(s):** `employee_tax_declaration` — upsert
- **Result:** Tax declaration saved. TDS projection recalculated for remaining months.

### Activity: Set Goals (KPI Self-Assessment)
- **Frontend:** `src/pages/kpi/MyGoals.tsx` → View assigned metrics and targets
- **API Call:** `GET /api/kpi/assignments/employee/:employeeId`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:29` → `c.getEmployeeTemplate`
- **SQL:**
  ```sql
  SELECT kta.*, ktm.metric_name, ktm.target_value
    FROM kpi_template_assignment kta
    JOIN kpi_template_metric ktm ON ktm.template_id = kta.template_id
   WHERE kta.employee_id = ?
  ```
- **DB Table(s):** `kpi_template_assignment`, `kpi_template_metric` — read
- **Result:** Employee sees their assigned KPI template with metrics and targets.

### Activity: Acknowledge Review
- **Frontend:** `src/pages/kpi/ReviewAcknowledge.tsx` → Read review, click "Acknowledge"
- **API Call:** `POST /api/kpi/scores` — body: `{ "employeeId": "uuid", "metricId": "uuid", "period": "2026-05", "score": 85, "remarks": "Acknowledged" }`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:33` → `c.recordScore`
- **SQL:**
  ```sql
  INSERT INTO kpi_score (id, employee_id, metric_id, period, score, remarks, scored_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  ```
- **DB Table(s):** `kpi_score` — insert
- **Result:** Score acknowledged and recorded. Visible in performance summary.

### Activity: Raise Helpdesk Ticket
- **Frontend:** `src/pages/helpdesk/CreateTicket.tsx` → Select category, describe issue, submit
- **API Call:** `POST /api/helpdesk/tickets` — body: `{ "category": "IT", "subject": "Laptop not working", "description": "Screen flickering since morning" }`
- **Backend Route:** `backend/src/modules/helpdesk/helpdesk.routes.ts:29` → inline handler (employee_id derived from JWT)
- **SQL:**
  ```sql
  INSERT INTO helpdesk_ticket (id, employee_id, category, subject, description, status, priority)
    VALUES (?, ?, ?, ?, ?, 'open', 'medium')
  ```
- **DB Table(s):** `helpdesk_ticket` — insert
- **Result:** Ticket created with auto-generated ID. Status: "open". Employee can track progress.

### Activity: View Roster
- **Frontend:** `src/pages/wfm/MyRoster.tsx` → View weekly/monthly roster
- **API Call:** `GET /api/roster/assignments?employeeId=uuid&fromDate=2026-06-03&toDate=2026-06-09`
- **Backend Route:** `backend/src/modules/wfm/roster.routes.ts:31` → `c.listAssignments`
- **SQL:**
  ```sql
  SELECT ra.*, s.shift_name, s.start_time, s.end_time
    FROM roster_assignment ra
    LEFT JOIN shift_master s ON s.id = ra.shift_id
   WHERE ra.employee_id = ? AND ra.roster_date BETWEEN ? AND ?
   ORDER BY ra.roster_date
  ```
- **DB Table(s):** `roster_assignment`, `shift_master` — read
- **Result:** Weekly roster shown with shift timings, week-off days, process assignment.

### Activity: Submit Shift Preference
- **Frontend:** `src/pages/wfm/ShiftPreference.tsx` → Select preferred shift, week-off, flexibility level
- **API Call:** `POST /api/wfm/roster-preferences` — body:
  ```json
  { "preferredShiftId": "uuid", "preferredWeekOff": "Sunday", "flexibility": "flexible", "effectiveFrom": "2026-06-10" }
  ```
- **Backend Route:** `backend/src/modules/wfm/wfm.routes.ts:61` → inline handler (employee derived from JWT)
- **SQL:**
  ```sql
  INSERT INTO roster_preference (id, employee_id, preferred_shift_id, preferred_week_off, flexibility, effective_from, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  ```
- **DB Table(s):** `roster_preference` — insert
- **Result:** Preference submitted. Awaits WFM/manager approval. Status: "pending".

### Activity: View Assets (My Assets)
- **Frontend:** `src/pages/assets/MyAssets.tsx` → View assigned assets
- **API Call:** `GET /api/assets-mgmt/employee/:employeeId`
- **Backend Route:** `backend/src/modules/assets/assets.routes.ts:27` → inline handler (self-access check)
- **SQL:**
  ```sql
  SELECT am.*, aa.assigned_at, aa.notes
    FROM asset_assignment aa
    JOIN asset_master am ON am.id = aa.asset_id
   WHERE aa.employee_id = ? AND aa.status = 'assigned'
  ```
- **DB Table(s):** `asset_assignment`, `asset_master` — read
- **Result:** List of currently assigned assets: laptop, ID card, headset, etc.

---

## [ROLE 5] — Manager / Team Lead / Branch Head

### Activity: Login + Dashboard
- **Frontend:** `src/pages/Auth.tsx` → Login; redirected to Manager Dashboard
- **API Call:** `POST /api/auth/login`, `GET /api/access/me`, `GET /api/employees/stats`
- **Backend Route:** `backend/src/modules/employees/employee.routes.ts:29` → stats handler
- **SQL:**
  ```sql
  SELECT COUNT(*) AS total_employees,
         COUNT(CASE WHEN employment_status = 'active' THEN 1 END) AS active_employees,
         COUNT(CASE WHEN DATEDIFF(NOW(), date_of_joining) <= 90 THEN 1 END) AS new_joiners_90d
    FROM employees WHERE active_status = 1
  ```
- **DB Table(s):** `employees` — aggregated read
- **Result:** Dashboard with team headcount, new joiners, pending approvals summary.

### Activity: Approve/Reject Team Leaves
- **Frontend:** `src/pages/leave/LeaveApprovals.tsx` → View pending requests, click "Approve" or "Reject"
- **API Call:** `PATCH /api/leave/requests/:id/review` — body: `{ "status": "approved", "remarks": "Approved" }`
- **Backend Route:** `backend/src/modules/leave/leave.routes.ts:85` → `leaveController.reviewRequest`
- **SQL:**
  ```sql
  UPDATE leave_request SET status = ? WHERE id = ?
  INSERT INTO leave_approval_log (id, leave_request_id, action, action_by, remarks)
    VALUES (UUID(), ?, ?, ?, ?)
  ```
- **DB Table(s):** `leave_request` — update status. `leave_approval_log` — insert audit trail.
- **Result:** Leave approved/rejected. Employee notified. Balance updated if approved.

### Activity: View Team Attendance
- **Frontend:** `src/pages/wfm/TeamAttendance.tsx` → View today's attendance for team
- **API Call:** `GET /api/attendance-engine/daily?processId=uuid&fromDate=2026-06-03&toDate=2026-06-03`
- **Backend Route:** `backend/src/modules/wfm/attendance-engine.routes.ts:95` → listRecords handler
- **SQL:**
  ```sql
  SELECT adr.*, e.full_name, e.employee_code
    FROM attendance_daily_record adr
    JOIN employees e ON e.id = adr.employee_id
   WHERE e.process_id = ? AND adr.record_date BETWEEN ? AND ?
   ORDER BY e.full_name
  ```
- **DB Table(s):** `attendance_daily_record`, `employees` — read
- **Result:** Team attendance grid showing present/absent/half-day for each member.

### Activity: KPI Dashboard
- **Frontend:** `src/pages/kpi/TeamKPI.tsx` → View team performance
- **API Call:** `GET /api/kpi/leaderboard?processId=uuid&period=2026-05`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:37` → `c.getLeaderboard`
- **SQL:**
  ```sql
  SELECT ks.employee_id, e.full_name, AVG(ks.score) AS avg_score
    FROM kpi_score ks
    JOIN employees e ON e.id = ks.employee_id
   WHERE ks.period = ? AND e.process_id = ?
   GROUP BY ks.employee_id
   ORDER BY avg_score DESC
  ```
- **DB Table(s):** `kpi_score`, `employees` — aggregated read
- **Result:** Leaderboard showing top performers with average scores.

### Activity: View Team Goals
- **Frontend:** `src/pages/kpi/TeamGoals.tsx` → View all team members' assignments
- **API Call:** `GET /api/kpi/family-summary/:processId/:period`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:40` → inline handler (requireRole: admin, hr, manager)
- **SQL:**
  ```sql
  SELECT km.category AS family, AVG(ks.score) AS avg_score, COUNT(DISTINCT ks.employee_id) AS employee_count
    FROM kpi_score ks
    JOIN kpi_metric_master km ON km.id = ks.metric_id
    JOIN employees e ON e.id = ks.employee_id
   WHERE e.process_id = ? AND ks.period = ?
   GROUP BY km.category
  ```
- **DB Table(s):** `kpi_score`, `kpi_metric_master`, `employees`
- **Result:** Family-level summary of team performance (Quality, Productivity, Compliance, etc.).

### Activity: Submit Performance Review
- **Frontend:** `src/pages/kpi/PerformanceReview.tsx` → Rate employee on metrics, add remarks
- **API Call:** `POST /api/kpi/scores/bulk` — body:
  ```json
  { "scores": [{ "employeeId": "uuid", "metricId": "uuid", "period": "2026-05", "score": 90, "remarks": "Excellent" }] }
  ```
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:32` → `c.bulkRecordScores`
- **SQL:**
  ```sql
  INSERT INTO kpi_score (id, employee_id, metric_id, period, score, remarks, scored_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  -- Repeated for each score
  ```
- **DB Table(s):** `kpi_score` — bulk insert
- **Result:** Performance scores recorded for the period. Available in employee summary.

### Activity: Live Tracker
- **Frontend:** `src/pages/wfm/LiveTracker.tsx` → Real-time view of agent status
- **API Call:** `GET /api/wfm/live?date=2026-06-03&processName=Customer%20Support`
- **Backend Route:** `backend/src/modules/wfm/wfm.routes.ts:45` → getLiveTracker()
- **SQL:**
  ```sql
  SELECT e.full_name, e.employee_code, ra.shift_id, s.shift_name,
         adr.clock_in_time, adr.clock_out_time, adr.attendance_status
    FROM roster_assignment ra
    JOIN employees e ON e.id = ra.employee_id
    LEFT JOIN shift_master s ON s.id = ra.shift_id
    LEFT JOIN attendance_daily_record adr ON adr.employee_id = e.id AND adr.record_date = ?
   WHERE ra.roster_date = ? AND e.process_id IN (SELECT id FROM process_master WHERE process_name = ?)
  ```
- **DB Table(s):** `roster_assignment`, `employees`, `shift_master`, `attendance_daily_record`
- **Result:** Real-time board showing who is logged in, on break, absent, with shift adherence.

### Activity: View/Acknowledge Roster
- **Frontend:** `src/pages/wfm/MyRoster.tsx` → View published roster, click "Acknowledge"
- **API Call:** `GET /api/roster/assignments?employeeId=uuid&fromDate=...&toDate=...`
- **Backend Route:** `backend/src/modules/wfm/roster.routes.ts:31` → `c.listAssignments`
- **SQL:** Same as Employee View Roster
- **DB Table(s):** `roster_assignment` — read
- **Result:** Manager sees own roster and can acknowledge published schedule.

### Activity: Approve Offer Letter (Branch Head)
- **Frontend:** `src/pages/ats/PendingApprovals.tsx` → View pending offers, click "Approve"
- **API Call:** `POST /api/ats/onboarding/offers/:id/approve` — body: `{ "remarks": "Good candidate" }`
- **Backend Route:** `backend/src/modules/ats/ats.onboarding.routes.ts:110` → `approveOffer()` (requireRole: branch_head, admin)
- **SQL:**
  ```sql
  UPDATE ats_onboarding_request SET offer_status = 'approved', approved_by = ?, approved_at = NOW(), remarks = ?
    WHERE id = ?
  ```
- **DB Table(s):** `ats_onboarding_request` — update
- **Result:** Offer approved. HR can now generate and send offer letter to candidate.

### Activity: View Team Helpdesk Tickets
- **Frontend:** `src/pages/helpdesk/TeamTickets.tsx` → View tickets from team members
- **API Call:** `GET /api/helpdesk/tickets`
- **Backend Route:** `backend/src/modules/helpdesk/helpdesk.routes.ts:18` → inline handler (role check)
- **SQL:**
  ```sql
  SELECT ht.*, e.full_name FROM helpdesk_ticket ht
    JOIN employees e ON e.id = ht.employee_id
   ORDER BY ht.created_at DESC LIMIT 50
  ```
- **DB Table(s):** `helpdesk_ticket`, `employees` — read
- **Result:** All team tickets with status, category, assignee, priority.

### Activity: Attrition Summary
- **Frontend:** `src/pages/exit/AttritionSummary.tsx` → View exit trends
- **API Call:** `GET /api/exit/stats`
- **Backend Route:** `backend/src/modules/exit/exit.routes.ts:20` → `exitController.getExitStats` (requireRole: admin, hr, manager)
- **SQL:**
  ```sql
  SELECT COUNT(*) AS total_exits, exit_type, MONTH(resignation_date) AS month
    FROM exit_request WHERE active_status = 1
    GROUP BY exit_type, MONTH(resignation_date)
  ```
- **DB Table(s):** `exit_request` — aggregated read
- **Result:** Attrition dashboard with monthly trends, exit types (voluntary/involuntary), process-wise breakdown.

---

## [ROLE 6] — WFM

### Activity: Login
- **Frontend:** `src/pages/Auth.tsx` → Login with WFM credentials (role_key: `wfm`)
- **API Call:** `POST /api/auth/login`, `GET /api/access/me`
- **Backend Route:** (See Shared Authentication Flow)
- **Result:** WFM dashboard with shifts, roster, attendance, live tracker modules.

### Activity: Create Shift Template
- **Frontend:** `src/pages/wfm/ShiftManagement.tsx` → Click "Add Shift", fill timings
- **API Call:** `POST /api/wfm/shifts` — body:
  ```json
  { "shift_name": "Morning", "start_time": "09:00", "end_time": "18:00", "break_minutes": 60, "grace_minutes": 15 }
  ```
- **Backend Route:** `backend/src/modules/wfm/wfm.routes.ts:29` → `wfmController.createShift`
- **SQL:**
  ```sql
  INSERT INTO shift_master (id, shift_name, start_time, end_time, break_minutes, grace_minutes, active_status)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  ```
- **DB Table(s):** `shift_master` — insert
- **Result:** New shift template available for roster planning.

### Activity: Build Roster (Create Plan)
- **Frontend:** `src/pages/wfm/RosterPlanner.tsx` → Define plan: process, branch, dates, headcount
- **API Call:** `POST /api/roster/plans` — body:
  ```json
  { "planName": "June W1 Customer Support", "processId": "uuid", "branchId": "uuid", "fromDate": "2026-06-03", "toDate": "2026-06-09", "requiredHeadcount": 25 }
  ```
- **Backend Route:** `backend/src/modules/wfm/roster.routes.ts:25` → `c.createPlan`
- **SQL:**
  ```sql
  INSERT INTO roster_plan (id, plan_name, process_id, branch_id, from_date, to_date, required_headcount, plan_status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)
  ```
- **DB Table(s):** `roster_plan` — insert with status 'draft'
- **Result:** Roster plan created in draft state. Ready for employee assignments.

### Activity: Set Capacity (Assign Employees to Roster)
- **Frontend:** `src/pages/wfm/RosterPlanner.tsx` → Drag-drop employees to shifts/days
- **API Call:** `POST /api/roster/assignments` — body:
  ```json
  { "employeeId": "uuid", "rosterDate": "2026-06-03", "shiftId": "uuid", "planId": "uuid", "shiftStartTime": "09:00", "shiftEndTime": "18:00" }
  ```
- **Backend Route:** `backend/src/modules/wfm/roster.routes.ts:30` → `c.assignEmployee`
- **SQL:**
  ```sql
  INSERT INTO roster_assignment (id, employee_id, roster_date, shift_id, plan_id, shift_start_time, shift_end_time, roster_status, publish_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Rostered', 'draft')
  ```
- **DB Table(s):** `roster_assignment` — insert
- **Result:** Employee slotted into roster for that date/shift. Visible in planner grid.

### Activity: Publish Roster
- **Frontend:** `src/pages/wfm/RosterPlanner.tsx` → Click "Publish Plan"
- **API Call:** `PATCH /api/roster/plans/:id/publish`
- **Backend Route:** `backend/src/modules/wfm/roster.routes.ts:27` → `c.publishPlan`
- **SQL:**
  ```sql
  UPDATE roster_plan SET plan_status = 'published', published_at = NOW(), published_by = ? WHERE id = ?
  UPDATE roster_assignment SET publish_status = 'published' WHERE plan_id = ?
  ```
- **DB Table(s):** `roster_plan` — update status. `roster_assignment` — update publish_status.
- **Result:** Roster published. All assigned employees can now see their schedule and acknowledge.

### Activity: Live Tracker / RTA Board
- **Frontend:** `src/pages/wfm/LiveTracker.tsx` → Real-time adherence view
- **API Call:** `GET /api/wfm/live?date=2026-06-03&processName=Customer%20Support`
- **Backend Route:** `backend/src/modules/wfm/wfm.routes.ts:45` → getLiveTracker()
- **SQL:** (See Manager Live Tracker — same query)
- **DB Table(s):** `roster_assignment`, `employees`, `shift_master`, `attendance_daily_record`
- **Result:** Real-time adherence board: logged in, on break, not logged in, adherent/non-adherent counts.

### Activity: Attendance Correction
- **Frontend:** `src/pages/wfm/AttendanceCorrection.tsx` → Override attendance status for a date
- **API Call:** `PATCH /api/attendance-engine/daily/:employeeId/:date` — body:
  ```json
  { "attendanceStatus": "half_day", "lwpValue": 0.5, "overrideReason": "Left early due to emergency", "isLocked": true }
  ```
- **Backend Route:** `backend/src/modules/wfm/attendance-engine.routes.ts:117` → correction handler (requireRole: admin, hr, wfm)
- **SQL:**
  ```sql
  UPDATE attendance_daily_record
    SET attendance_status = ?, lwp_value = ?, override_reason = ?, is_locked = ?, corrected_by = ?, corrected_at = NOW()
   WHERE employee_id = ? AND record_date = ?
  ```
- **DB Table(s):** `attendance_daily_record` — update
- **Result:** Attendance corrected and locked. Locked records excluded from re-processing.

### Activity: Handle Shift Swap (Approve Roster Preference)
- **Frontend:** `src/pages/wfm/PendingPreferences.tsx` → View pending shift preferences, approve/reject
- **API Call:** `PATCH /api/wfm/roster-preferences/:id/approve`
- **Backend Route:** `backend/src/modules/wfm/wfm.routes.ts:82` → inline handler (requireRole: admin, hr, manager, wfm)
- **SQL:**
  ```sql
  UPDATE roster_preference SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?
  ```
- **DB Table(s):** `roster_preference` — update
- **Result:** Preference approved. WFM team accounts for it in next roster cycle.

### Activity: Shrinkage Report
- **Frontend:** `src/pages/wfm/ShrinkageReport.tsx` → View shrinkage metrics
- **API Call:** `GET /api/attendance-engine/summary/:employeeId/:month` (aggregated across team)
- **Backend Route:** `backend/src/modules/wfm/attendance-engine.routes.ts:154` → getMonthlySummary handler
- **SQL:**
  ```sql
  SELECT attendance_status, COUNT(*) AS count, SUM(lwp_value) AS total_lwp
    FROM attendance_daily_record
   WHERE employee_id = ? AND record_date LIKE ?
   GROUP BY attendance_status
  ```
- **DB Table(s):** `attendance_daily_record` — aggregated read
- **Result:** Monthly shrinkage metrics: planned vs actual headcount, absent/leave/half-day rates.

### Activity: Capacity Planning
- **Frontend:** `src/pages/wfm/CapacityPlanning.tsx` → View demand vs supply
- **API Call:** `GET /api/roster/plans?processId=uuid&fromDate=2026-06-03&toDate=2026-06-09`
- **Backend Route:** `backend/src/modules/wfm/roster.routes.ts:26` → `c.listPlans`
- **SQL:**
  ```sql
  SELECT rp.*, COUNT(ra.id) AS assigned_count
    FROM roster_plan rp
    LEFT JOIN roster_assignment ra ON ra.plan_id = rp.id
   WHERE rp.process_id = ? AND rp.from_date >= ? AND rp.to_date <= ?
   GROUP BY rp.id
  ```
- **DB Table(s):** `roster_plan`, `roster_assignment` — aggregated read
- **Result:** Capacity planning view: required headcount vs assigned vs available.

---

## [ROLE 7] — Finance/Payroll

### Activity: Login
- **Frontend:** `src/pages/Auth.tsx` → Login (role_key: `finance` or `payroll`)
- **API Call:** `POST /api/auth/login`, `GET /api/access/me`
- **Backend Route:** (See Shared Authentication Flow)
- **Result:** Payroll dashboard with structures, runs, payslips, statutory modules.

### Activity: View Salary Structures
- **Frontend:** `src/pages/payroll/SalaryStructures.tsx` → View all structures
- **API Call:** `GET /api/payroll/structures`
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:24` → `c.listStructures`
- **SQL:**
  ```sql
  SELECT * FROM salary_structure WHERE active_status = 1 ORDER BY structure_name
  ```
- **DB Table(s):** `salary_structure` — read
- **Result:** List of salary structures (CTC-based, Grade-based) with their component breakdowns.

### Activity: Create/Update Salary Structure
- **Frontend:** `src/pages/payroll/SalaryStructures.tsx` → Click "Add Structure", fill components
- **API Call:** `POST /api/payroll/structures` — body:
  ```json
  { "structure_name": "Standard CTC", "components": [{ "component_id": "uuid", "calc_type": "percentage", "calc_value": 40 }] }
  ```
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:25` → `c.createStructure` (requireRole: admin, hr, finance, payroll)
- **SQL:**
  ```sql
  INSERT INTO salary_structure (id, structure_name, active_status) VALUES (?, ?, 1)
  INSERT INTO salary_structure_component (id, structure_id, component_id, calc_type, calc_value)
    VALUES (?, ?, ?, ?, ?)
  ```
- **DB Table(s):** `salary_structure`, `salary_structure_component` — insert
- **Result:** Salary structure created. Can be assigned to employees.

### Activity: Run Payroll (Create Run)
- **Frontend:** `src/pages/payroll/PayrollRuns.tsx` → Click "New Run", select month
- **API Call:** `POST /api/payroll/runs` — body: `{ "run_month": "2026-06", "description": "June 2026 Payroll" }`
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:41` → `c.createRun` (requireRole: admin, finance, payroll)
- **SQL:**
  ```sql
  INSERT INTO salary_prep_run (id, run_month, description, status, created_by)
    VALUES (?, ?, ?, 'draft', ?)
  ```
- **DB Table(s):** `salary_prep_run` — insert with status 'draft'
- **Result:** Payroll run created in draft. Ready for calculation.

### Activity: Calculate Payroll
- **Frontend:** `src/pages/payroll/PayrollRuns.tsx` → Click "Calculate" on a draft run
- **API Call:** `POST /api/payroll/runs/:id/calculate`
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:45` → calculatePayrollRun() (requireRole: admin, finance, payroll)
- **SQL:**
  ```sql
  SELECT e.id, e.employee_code, e.full_name, esa.ctc, esa.structure_id, esa.effective_from
    FROM employees e
    JOIN employee_salary_assignment esa ON esa.employee_id = e.id
   WHERE e.active_status = 1 AND e.employment_status = 'active'
  -- For each employee:
  INSERT INTO salary_prep_line (id, run_id, employee_id, gross_salary, basic, hra, special_allowance,
    pf_employee, pf_employer, esi_employee, esi_employer, professional_tax, tds, net_salary, lwp_days, lwp_deduction)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ```
  Also inserts into `sensitive_action_log`:
  ```sql
  INSERT INTO sensitive_action_log (...) VALUES (?, ?, 'PAYROLL_RUN_CALCULATED', 'payroll', ...)
  ```
- **DB Table(s):** `salary_prep_run`, `salary_prep_line`, `employees`, `employee_salary_assignment`, `attendance_daily_record`, `statutory_config`, `sensitive_action_log`
- **Result:** All salary lines calculated. Each employee's gross, deductions, net computed. Run ready for review.

### Activity: Generate Payslips
- **Frontend:** `src/pages/payroll/PayrollRuns.tsx` → Click "Generate Payslips" for a calculated run
- **API Call:** `POST /api/payroll/payslip/:runId/generate` — body: `{ "employeeId": "uuid" }`
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:103` → payslipService.generatePayslip() (requireRole: admin, hr, finance, payroll)
- **SQL:**
  ```sql
  INSERT INTO employee_payslip (id, run_id, employee_id, month, gross_salary, net_salary, generated_by, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
  INSERT INTO employee_payslip_line (id, payslip_id, component_name, component_type, amount)
    VALUES (?, ?, ?, ?, ?)
  ```
- **DB Table(s):** `employee_payslip`, `employee_payslip_line` — insert
- **Result:** Payslip generated. Employee can view via self-service portal.

### Activity: View Payslip (Finance View)
- **Frontend:** `src/pages/payroll/PayslipView.tsx` → Select employee and run
- **API Call:** `GET /api/payroll/payslip/:runId/:employeeId`
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:87` → inline handler
- **SQL:**
  ```sql
  SELECT * FROM employee_payslip WHERE run_id = ? AND employee_id = ? LIMIT 1
  SELECT * FROM employee_payslip_line WHERE payslip_id = ?
  ```
- **DB Table(s):** `employee_payslip`, `employee_payslip_line` — read
- **Result:** Detailed payslip with all earnings and deductions.

### Activity: NEFT Export (Bank Disbursement)
- **Frontend:** `src/pages/payroll/Disbursement.tsx` → Click "Record Disbursement"
- **API Call:** `POST /api/payroll/disbursements` — body:
  ```json
  { "run_id": "uuid", "bank_ref": "NEFT/2026/06/001", "total_amount": 5000000, "employee_count": 150 }
  ```
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:212` → inline handler (requireRole: admin, finance, payroll)
- **SQL:**
  ```sql
  SELECT id FROM salary_prep_run WHERE id = ? LIMIT 1
  INSERT INTO payroll_disbursement (id, run_id, bank_ref, total_amount, employee_count, disbursed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  ```
- **DB Table(s):** `payroll_disbursement` — insert
- **Result:** Disbursement recorded. Can be marked "completed" or "failed" via PATCH.

### Activity: ECR (PF) Export
- **Frontend:** `src/pages/payroll/StatutoryExports.tsx` → Generate ECR file
- **API Call:** `GET /api/payroll/uan/:employeeId` (for each employee in run)
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:166` → inline handler
- **SQL:**
  ```sql
  SELECT * FROM employee_uan WHERE employee_id = ? LIMIT 1
  ```
- **DB Table(s):** `employee_uan` — read UAN/member_id for ECR generation
- **Result:** ECR data compiled for PF filing. Downloaded as text file for EPFO portal upload.

### Activity: ESIC Challan
- **Frontend:** `src/pages/payroll/StatutoryExports.tsx` → Generate ESIC challan
- **API Call:** `GET /api/payroll/runs/:id/lines` (to get ESI amounts per employee)
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:44` → `c.listLines`
- **SQL:**
  ```sql
  SELECT spl.employee_id, spl.esi_employee, spl.esi_employer, e.full_name, e.employee_code
    FROM salary_prep_line spl
    JOIN employees e ON e.id = spl.employee_id
   WHERE spl.run_id = ?
  ```
- **DB Table(s):** `salary_prep_line`, `employees` — read
- **Result:** ESIC challan data compiled with employee/employer contributions for filing.

### Activity: Statutory Config
- **Frontend:** `src/pages/payroll/StatutoryConfig.tsx` → View/edit statutory parameters
- **API Call:** `GET /api/payroll/statutory-config`
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:82` → `c.getStatutoryConfig` (requireRole: admin, finance, payroll)
- **SQL:**
  ```sql
  SELECT * FROM statutory_config WHERE active_status = 1 ORDER BY config_key
  ```
- **DB Table(s):** `statutory_config` — read
- **Result:** Current PF/ESI/PT/TDS rates and thresholds displayed for review.

### Activity: F&F Settlement
- **Frontend:** `src/pages/exit/FullAndFinal.tsx` → Select exit request, calculate F&F
- **API Call:** `POST /api/exit/ff/:exitRequestId` — body:
  ```json
  { "earned_salary": 45000, "leave_encashment": 12000, "gratuity": 0, "notice_recovery": -15000, "net_payable": 42000 }
  ```
- **Backend Route:** `backend/src/modules/exit/exit.routes.ts:88` → ffService.createFF() (requireRole: admin, hr, finance, payroll)
- **SQL:**
  ```sql
  INSERT INTO exit_ff_calculation (id, exit_request_id, earned_salary, leave_encashment, gratuity,
    notice_recovery, net_payable, is_ff_provisional, calculated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  ```
  Also logs to `sensitive_action_log`.
- **DB Table(s):** `exit_ff_calculation` — insert. `sensitive_action_log` — audit.
- **Result:** F&F calculated and saved as provisional. Requires admin approval to finalize.

### Activity: Payroll Stats
- **Frontend:** `src/pages/payroll/PayrollDashboard.tsx` → Overview metrics
- **API Call:** `GET /api/payroll/runs` (recent runs with totals)
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:40` → `c.listRuns`
- **SQL:**
  ```sql
  SELECT spr.*, COUNT(spl.id) AS line_count, SUM(spl.net_salary) AS total_net
    FROM salary_prep_run spr
    LEFT JOIN salary_prep_line spl ON spl.run_id = spr.id
   GROUP BY spr.id
   ORDER BY spr.run_month DESC
  ```
- **DB Table(s):** `salary_prep_run`, `salary_prep_line` — aggregated read
- **Result:** Dashboard showing recent payroll runs with totals, status, employee counts.

---

## [ROLE 8] — QA/Quality

### Activity: Login
- **Frontend:** `src/pages/Auth.tsx` → Login (role_key: `qa` or `quality`)
- **API Call:** `POST /api/auth/login`, `GET /api/access/me`
- **Backend Route:** (See Shared Authentication Flow)
- **Result:** Quality dashboard access with KPI and performance modules.

### Activity: Quality Dashboard
- **Frontend:** `src/pages/quality/QualityDashboard.tsx` → View overall quality scores
- **API Call:** `GET /api/kpi/family-summary/:processId/:period`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:40` → inline handler (requireRole: admin, hr, manager)
- **SQL:**
  ```sql
  SELECT km.category AS family, AVG(ks.score) AS avg_score, COUNT(DISTINCT ks.employee_id) AS employee_count
    FROM kpi_score ks
    JOIN kpi_metric_master km ON km.id = ks.metric_id
    JOIN employees e ON e.id = ks.employee_id
   WHERE e.process_id = ? AND ks.period = ?
   GROUP BY km.category
  ```
- **DB Table(s):** `kpi_score`, `kpi_metric_master`, `employees`
- **Result:** Quality scores aggregated by family: CSAT, FCR, AHT, Quality Audit scores.

### Activity: Operations KPI
- **Frontend:** `src/pages/kpi/OperationsKPI.tsx` → View operational metrics
- **API Call:** `GET /api/kpi/process-config/:processId`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:50` → inline handler (requireRole: admin, hr, manager)
- **SQL:**
  ```sql
  SELECT kpc.*, km.metric_name, km.metric_code, km.category AS metric_type, km.unit,
         ktm.target_value AS template_default
    FROM kpi_process_config kpc
    JOIN kpi_metric_master km ON km.id = kpc.metric_id
    LEFT JOIN kpi_template_metric ktm ON ktm.metric_id = kpc.metric_id
   WHERE kpc.process_id = ?
   ORDER BY km.metric_name
  ```
- **DB Table(s):** `kpi_process_config`, `kpi_metric_master`, `kpi_template_metric`
- **Result:** Process-level KPI configuration with targets, thresholds, weightages.

### Activity: Team Performance Scores
- **Frontend:** `src/pages/kpi/TeamPerformance.tsx` → View individual agent scores
- **API Call:** `GET /api/kpi/leaderboard?processId=uuid&period=2026-05`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:37` → `c.getLeaderboard`
- **SQL:**
  ```sql
  SELECT ks.employee_id, e.full_name, e.employee_code, AVG(ks.score) AS avg_score
    FROM kpi_score ks
    JOIN employees e ON e.id = ks.employee_id
   WHERE ks.period = ?
   GROUP BY ks.employee_id
   ORDER BY avg_score DESC
  ```
- **DB Table(s):** `kpi_score`, `employees`
- **Result:** Ranked list of agents by performance score for the period.

### Activity: Management Dashboard
- **Frontend:** `src/pages/quality/ManagementDashboard.tsx` → High-level quality summary
- **API Call:** `GET /api/kpi/summary/:employeeId/:templateId/:period`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:36` → `c.getEmployeeSummary`
- **SQL:**
  ```sql
  SELECT ks.metric_id, km.metric_name, ks.score, ks.period
    FROM kpi_score ks
    JOIN kpi_metric_master km ON km.id = ks.metric_id
   WHERE ks.employee_id = ? AND ks.period = ?
  ```
- **DB Table(s):** `kpi_score`, `kpi_metric_master`
- **Result:** Detailed performance breakdown per metric for management review.

### Activity: Process Reports
- **Frontend:** `src/pages/quality/ProcessReports.tsx` → Export quality data
- **API Call:** `GET /api/kpi/family-summary/:processId/:period` (multiple processes)
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:40`
- **SQL:** Same as Quality Dashboard but iterated across processes
- **DB Table(s):** `kpi_score`, `kpi_metric_master`, `employees`, `process_master`
- **Result:** Exportable report with process-wise quality metrics comparison.

---

## [ROLE 9] — CEO/Leadership

### Activity: Login
- **Frontend:** `src/pages/Auth.tsx` → Login (role_key: `ceo` or equivalent leadership role)
- **API Call:** `POST /api/auth/login`, `GET /api/access/me`
- **Backend Route:** (See Shared Authentication Flow)
- **Result:** Executive dashboard with all strategic modules visible.

### Activity: Headcount Summary
- **Frontend:** `src/pages/dashboard/ExecutiveDashboard.tsx` → Top-level headcount widget
- **API Call:** `GET /api/employees/stats`
- **Backend Route:** `backend/src/modules/employees/employee.routes.ts:29` → stats handler
- **SQL:**
  ```sql
  SELECT COUNT(*) AS total_employees,
         COUNT(CASE WHEN employment_status = 'active' THEN 1 END) AS active_employees,
         COUNT(CASE WHEN DATEDIFF(NOW(), date_of_joining) <= 90 THEN 1 END) AS new_joiners_90d
    FROM employees WHERE active_status = 1
  ```
- **DB Table(s):** `employees`
- **Result:** Organization headcount: total, active, new joiners in last 90 days.

### Activity: Attrition
- **Frontend:** `src/pages/exit/AttritionDashboard.tsx` → Organization-level attrition
- **API Call:** `GET /api/exit/stats`
- **Backend Route:** `backend/src/modules/exit/exit.routes.ts:20` → `exitController.getExitStats`
- **SQL:**
  ```sql
  SELECT COUNT(*) AS total_exits, exit_type, MONTH(resignation_date) AS month,
         e.process_id, pm.process_name
    FROM exit_request er
    JOIN employees e ON e.id = er.employee_id
    LEFT JOIN process_master pm ON pm.id = e.process_id
   WHERE er.active_status = 1
   GROUP BY exit_type, MONTH(resignation_date), e.process_id
  ```
- **DB Table(s):** `exit_request`, `employees`, `process_master`
- **Result:** Attrition trends: monthly, process-wise, voluntary vs involuntary.

### Activity: Hiring Pipeline
- **Frontend:** `src/pages/ats/HiringPipeline.tsx` → ATS funnel summary
- **API Call:** `GET /api/ats/stats`
- **Backend Route:** `backend/src/modules/ats/ats.routes.ts:47` → `c.getDashboardStats`
- **SQL:**
  ```sql
  SELECT current_stage, COUNT(*) AS count FROM ats_candidate WHERE active_status = 1 GROUP BY current_stage
  ```
- **DB Table(s):** `ats_candidate`
- **Result:** Hiring funnel: applications, screening, interviews, offers, rejections.

### Activity: Payroll Cost
- **Frontend:** `src/pages/dashboard/ExecutiveDashboard.tsx` → Payroll cost widget
- **API Call:** `GET /api/payroll/runs`
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:40` → `c.listRuns`
- **SQL:**
  ```sql
  SELECT spr.run_month, SUM(spl.gross_salary) AS total_gross, SUM(spl.net_salary) AS total_net,
         COUNT(spl.id) AS employee_count
    FROM salary_prep_run spr
    JOIN salary_prep_line spl ON spl.run_id = spr.id
   WHERE spr.status IN ('calculated', 'locked', 'disbursed')
   GROUP BY spr.run_month
   ORDER BY spr.run_month DESC LIMIT 12
  ```
- **DB Table(s):** `salary_prep_run`, `salary_prep_line`
- **Result:** Monthly payroll cost trend for the last 12 months.

### Activity: Performance Command Center
- **Frontend:** `src/pages/kpi/CommandCenter.tsx` → All-process performance summary
- **API Call:** `GET /api/kpi/leaderboard?period=2026-05`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:37` → `c.getLeaderboard`
- **SQL:**
  ```sql
  SELECT e.process_id, pm.process_name, AVG(ks.score) AS avg_score
    FROM kpi_score ks
    JOIN employees e ON e.id = ks.employee_id
    JOIN process_master pm ON pm.id = e.process_id
   WHERE ks.period = ?
   GROUP BY e.process_id
   ORDER BY avg_score DESC
  ```
- **DB Table(s):** `kpi_score`, `employees`, `process_master`
- **Result:** Process-level performance ranking.

### Activity: Compliance Dashboard
- **Frontend:** `src/pages/payroll/ComplianceDashboard.tsx` → PF/ESI/PT filing status
- **API Call:** `GET /api/payroll/statutory-config`, `GET /api/payroll/disbursements/:runId`
- **Backend Route:** `backend/src/modules/payroll/payroll.routes.ts:82`, `backend/src/modules/payroll/payroll.routes.ts:252`
- **SQL:**
  ```sql
  SELECT * FROM statutory_config WHERE active_status = 1
  SELECT * FROM payroll_disbursement WHERE run_id = ? ORDER BY created_at DESC
  ```
- **DB Table(s):** `statutory_config`, `payroll_disbursement`
- **Result:** Compliance status: PF filed, ESIC paid, PT deposited, with dates and amounts.

### Activity: Advanced Reports
- **Frontend:** `src/pages/reports/AdvancedReports.tsx` → Custom report builder
- **API Call:** Multiple — `GET /api/employees/stats`, `GET /api/exit/stats`, `GET /api/ats/stats`, payroll runs
- **Backend Route:** Various routes combined
- **SQL:** Combination of queries from employees, exit, ATS, payroll modules
- **DB Table(s):** Multiple tables aggregated
- **Result:** Custom cross-module reports: cost-per-hire, attrition rate, revenue-per-employee.

### Activity: Engagement Leaderboard
- **Frontend:** `src/pages/kpi/EngagementLeaderboard.tsx` → Branch/process engagement metrics
- **API Call:** `GET /api/kpi/leaderboard?period=2026-05`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:37` → `c.getLeaderboard`
- **SQL:** Same as leaderboard query with branch grouping
- **DB Table(s):** `kpi_score`, `employees`, `branch_master`
- **Result:** Branch-wise engagement and performance rankings.

### Activity: Workforce Command Center
- **Frontend:** `src/pages/wfm/WorkforceCommandCenter.tsx` → Live workforce status
- **API Call:** `GET /api/wfm/live`, `GET /api/employees/stats`, `GET /api/roster/plans`
- **Backend Route:** Multiple WFM + employee routes
- **SQL:** Combined live tracker + headcount + roster coverage queries
- **DB Table(s):** `attendance_daily_record`, `roster_assignment`, `employees`, `roster_plan`
- **Result:** Real-time workforce overview: logged in, planned, shrinkage, utilization.

---

## [ROLE 10] — Client Portal User

### Activity: Portal Login (OTP)
- **Frontend:** `src/pages/portal/ClientLogin.tsx` → Enter email, receive OTP, enter OTP
- **API Call:**
  1. `POST /api/portal/auth/request-otp` — body: `{ "email": "client@acme.com" }`
  2. `POST /api/portal/auth/verify-otp` — body: `{ "email": "client@acme.com", "otp": "123456" }`
- **Backend Route:** `backend/src/modules/portal/portal.routes.ts:13-14` → `c.requestOtp`, `c.verifyOtp`
- **SQL:**
  ```sql
  -- Request OTP:
  SELECT id, email, full_name FROM portal_client_user WHERE email = ? AND active_status = 1 LIMIT 1
  INSERT INTO portal_otp (id, client_user_id, otp_hash, expires_at) VALUES (?, ?, ?, ?)

  -- Verify OTP:
  SELECT * FROM portal_otp WHERE client_user_id = ? AND otp_hash = ? AND expires_at > NOW() AND used = 0 LIMIT 1
  UPDATE portal_otp SET used = 1 WHERE id = ?
  SELECT pcu.*, pcpm.process_id FROM portal_client_user pcu
    JOIN portal_client_process_map pcpm ON pcpm.client_user_id = pcu.id
   WHERE pcu.id = ?
  ```
- **DB Table(s):** `portal_client_user`, `portal_otp`, `portal_client_process_map`
- **Result:** Portal JWT issued with process access list. Client sees only their mapped processes.

### Activity: KPI Scorecard
- **Frontend:** `src/pages/portal/KPIScorecard.tsx` → View process performance metrics
- **API Call:** `GET /api/portal/processes/:id/kpis?period=2026-05`
- **Backend Route:** `backend/src/modules/portal/portal.routes.ts:98` → `c.getKpis`
- **SQL:**
  ```sql
  SELECT kpc.metric_id, km.metric_name, kpc.target_value,
         AVG(ks.score) AS actual_value, kpc.weightage
    FROM kpi_process_config kpc
    JOIN kpi_metric_master km ON km.id = kpc.metric_id
    LEFT JOIN kpi_score ks ON ks.metric_id = kpc.metric_id AND ks.period = ?
    JOIN employees e ON e.id = ks.employee_id AND e.process_id = ?
   WHERE kpc.process_id = ?
   GROUP BY kpc.metric_id
  ```
- **DB Table(s):** `kpi_process_config`, `kpi_metric_master`, `kpi_score`, `employees`
- **Result:** KPI scorecard showing target vs actual for each metric. No individual employee data exposed.

### Activity: Headcount
- **Frontend:** `src/pages/portal/ClientOverview.tsx` → Process headcount
- **API Call:** `GET /api/portal/overview`
- **Backend Route:** `backend/src/modules/portal/portal.routes.ts:97` → `c.getOverview`
- **SQL:**
  ```sql
  SELECT pm.id, pm.process_name, COUNT(e.id) AS headcount
    FROM process_master pm
    LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
   WHERE pm.id IN (?)
   GROUP BY pm.id
  ```
  Also inserts access log:
  ```sql
  INSERT INTO portal_access_log (id, client_user_id, page, ip_address) VALUES (?, ?, ?, ?)
  ```
- **DB Table(s):** `process_master`, `employees`, `portal_access_log`
- **Result:** Process headcount summary. No individual employee details.

### Activity: SLA/Quality Metrics
- **Frontend:** `src/pages/portal/QualityMetrics.tsx` → SLA adherence and quality scores
- **API Call:** `GET /api/portal/processes/:id/kpis?period=2026-05`
- **Backend Route:** `backend/src/modules/portal/portal.routes.ts:98` → `c.getKpis`
- **SQL:** Same as KPI Scorecard
- **DB Table(s):** `kpi_process_config`, `kpi_metric_master`, `kpi_score`
- **Result:** SLA metrics: response time, resolution rate, quality scores — aggregate only.

### Activity: Attrition
- **Frontend:** `src/pages/portal/Attrition.tsx` → Process attrition metrics
- **API Call:** `GET /api/portal/processes/:id/attrition`
- **Backend Route:** `backend/src/modules/portal/portal.routes.ts:102` → `c.getAttrition`
- **SQL:**
  ```sql
  SELECT COUNT(*) AS exits, MONTH(er.resignation_date) AS month
    FROM exit_request er
    JOIN employees e ON e.id = er.employee_id
   WHERE e.process_id = ? AND er.active_status = 1
   GROUP BY MONTH(er.resignation_date)
  ```
- **DB Table(s):** `exit_request`, `employees`
- **Result:** Monthly attrition for the client's process only. No reason/PII exposed.

### Activity: Add Commentary
- **Frontend:** `src/pages/portal/Commentary.tsx` → Post comment/note on process performance
- **API Call:** `POST /api/portal/commentary/:id/reply` — body: `{ "text": "Need improvement on AHT" }`
- **Backend Route:** `backend/src/modules/portal/portal.routes.ts:105` → `c.replyCommentary`
- **SQL:**
  ```sql
  INSERT INTO management_commentary_reply (id, commentary_id, reply_text, replied_by, replied_by_type)
    VALUES (?, ?, ?, ?, 'client')
  ```
- **DB Table(s):** `management_commentary_reply`
- **Result:** Client commentary added. Visible to internal ops team and client.

### Activity: Roster Coverage
- **Frontend:** `src/pages/portal/RosterCoverage.tsx` → Planned vs actual staffing
- **API Call:** `GET /api/portal/processes/:id/glide-paths`
- **Backend Route:** `backend/src/modules/portal/portal.routes.ts:99` → `c.getGlidePaths`
- **SQL:**
  ```sql
  SELECT * FROM portal_glide_commitment
   WHERE process_id = ? AND active_status = 1
   ORDER BY period DESC
  ```
- **DB Table(s):** `portal_glide_commitment`
- **Result:** Glide path showing committed vs actual headcount/coverage over time.

### Activity: Export Report
- **Frontend:** `src/pages/portal/Reports.tsx` → Download PDF/Excel report
- **API Call:** `GET /api/portal/processes/:id/kpis?period=2026-05` (data fetched, exported client-side)
- **Backend Route:** Same KPI endpoint
- **SQL:** Same as KPI queries
- **DB Table(s):** Same
- **Result:** Report exported as PDF/Excel with process metrics, scorecards, trends.

---

## [ROLE 11] — Trainer / LMS Coordinator

### Activity: Login
- **Frontend:** `src/pages/Auth.tsx` → Login (role_key: `trainer` or `lms_coordinator`)
- **API Call:** `POST /api/auth/login`, `GET /api/access/me`
- **Backend Route:** (See Shared Authentication Flow)
- **Result:** Dashboard with LMS integration, learner mappings, sync status modules.

### Activity: Open LMS Deep-Link
- **Frontend:** `src/pages/lms/LMSLaunch.tsx` → Click "Open LMS" button
- **API Call:** `GET /api/lms/launch-urls/:employeeId`
- **Backend Route:** `backend/src/modules/lms/lms.routes.ts:16` → inline handler
- **SQL:** None (URLs are static configuration)
- **DB Table(s):** None
- **Result:** Returns deep-link URLs:
  - Learner: `https://mcnlms.teammas.in/lms`
  - Coordinator: `https://mcnlms.teammas.in/coordinator`
  - Admin: `https://mcnlms.teammas.in/admin`
  Opens in new tab via SSO/redirect.

### Activity: View Learner Mappings
- **Frontend:** `src/pages/lms/LearnerMappings.tsx` → View employee-to-LMS learner map
- **API Call:** `GET /api/lms/mapping`
- **Backend Route:** `backend/src/modules/lms/lms.routes.ts:59` → lmsService.listMappings() (requireRole: admin, hr)
- **SQL:**
  ```sql
  SELECT m.*, e.full_name, e.employee_code
    FROM lms_employee_mapping m
    LEFT JOIN employees e ON e.id = m.employee_id
   WHERE m.is_active = 1
   ORDER BY e.full_name
  ```
- **DB Table(s):** `lms_employee_mapping`, `employees`
- **Result:** Table of all employee-to-LMS learner mappings with names and codes.

### Activity: Add/Update Mapping
- **Frontend:** `src/pages/lms/LearnerMappings.tsx` → Click "Add Mapping", fill form
- **API Call:** `POST /api/lms/mapping` — body: `{ "employee_id": "uuid", "lms_learner_id": "LRN-001", "email": "priya@mascallnet.com" }`
- **Backend Route:** `backend/src/modules/lms/lms.routes.ts:63` → lmsService.upsertMapping() (requireRole: admin, hr)
- **SQL:**
  ```sql
  INSERT INTO lms_employee_mapping (id, employee_id, lms_learner_id, email)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE lms_learner_id = VALUES(lms_learner_id), email = VALUES(email)
  ```
- **DB Table(s):** `lms_employee_mapping` — upsert
- **Result:** Mapping created or updated. Employee linked to LMS learner ID.

### Activity: Sync Log
- **Frontend:** `src/pages/lms/SyncAuditLog.tsx` → View synchronization history
- **API Call:** `GET /api/lms/sync-log`
- **Backend Route:** `backend/src/modules/lms/lms.routes.ts:72` → lmsService.getSyncLog() (requireRole: admin, hr)
- **SQL:**
  ```sql
  SELECT * FROM lms_sync_audit_log ORDER BY created_at DESC LIMIT 100
  ```
- **DB Table(s):** `lms_sync_audit_log`
- **Result:** Last 100 sync events: timestamp, sync_type, records_synced, errors, duration.

### Activity: Learner Progress
- **Frontend:** `src/pages/lms/LearnerProgress.tsx` → View employee's learning progress
- **API Call:** `GET /api/lms/progress/:employeeId`
- **Backend Route:** `backend/src/modules/lms/lms.routes.ts:33` → lmsService.getProgress()
- **SQL:**
  ```sql
  SELECT * FROM lms_learning_progress_snapshot WHERE employee_id = ? ORDER BY synced_at DESC
  ```
- **DB Table(s):** `lms_learning_progress_snapshot`
- **Result:** Progress snapshots: course name, completion %, score, last synced time.

### Activity: Certifications
- **Frontend:** `src/pages/lms/Certifications.tsx` → View employee certifications
- **API Call:** `GET /api/lms/certifications/:employeeId`
- **Backend Route:** `backend/src/modules/lms/lms.routes.ts:46` → lmsService.getCertifications()
- **SQL:**
  ```sql
  SELECT * FROM lms_certification_snapshot WHERE employee_id = ? ORDER BY issued_date DESC
  ```
- **DB Table(s):** `lms_certification_snapshot`
- **Result:** List of certifications: name, issued_date, expiry, score, status.

### Activity: LMS Management Dashboard
- **Frontend:** `src/pages/lms/LMSManagementDashboard.tsx` → Aggregate training metrics
- **API Call:** `GET /api/lms/mapping` + `GET /api/lms/progress/:employeeId` (multiple)
- **Backend Route:** `backend/src/modules/lms/lms.routes.ts:59`, `backend/src/modules/lms/lms.routes.ts:33`
- **SQL:** Combined mapping + progress queries
- **DB Table(s):** `lms_employee_mapping`, `lms_learning_progress_snapshot`, `lms_certification_snapshot`
- **Result:** Dashboard: total learners mapped, average completion, certification rate, sync health.

### Activity: Send Communication (Training Notification)
- **Frontend:** `src/pages/communication/SendMessage.tsx` → Select template, choose recipients, send
- **API Call:** `POST /api/communication/dispatch/send` — body:
  ```json
  { "channel": "email", "template_id": "uuid", "recipients": [{ "email": "priya@mascallnet.com" }], "variables": { "training_name": "Product Training" } }
  ```
- **Backend Route:** `backend/src/modules/communication/communication.routes.ts:26` → `c.send` (requireRole: admin, hr, process_manager, assistant_manager, team_leader)
- **SQL:**
  ```sql
  SELECT * FROM communication_template WHERE id = ? LIMIT 1
  INSERT INTO communication_dispatch_log (id, channel, template_id, recipient, status, sent_at)
    VALUES (?, ?, ?, ?, 'sent', NOW())
  ```
- **DB Table(s):** `communication_template`, `communication_dispatch_log`
- **Result:** Communication sent via configured provider (email/SMS/WhatsApp). Dispatch logged.

---

## [ROLE 12] — Super Admin / System Admin

### Activity: Login
- **Frontend:** `src/pages/Auth.tsx` → Login (role_key: `admin`)
- **API Call:** `POST /api/auth/login`, `GET /api/access/me`
- **Backend Route:** (See Shared Authentication Flow)
- **Result:** Full system access. All modules visible.

### Activity: Org Masters CRUD
- **Frontend:** `src/pages/settings/OrgMasters.tsx` → Manage branches, departments, designations, LOBs, campaigns, cost centres, grade bands, locations, policies
- **API Call:** CRUD operations:
  - `GET /api/org/branches` / `POST /api/org/branches` / `PUT /api/org/branches/:id` / `DELETE /api/org/branches/:id`
  - Same pattern for `/departments`, `/designations`, `/lobs`, `/campaigns`, `/cost-centres`, `/grade-bands`, `/locations`, `/policies`
- **Backend Route:** `backend/src/modules/org/org.routes.ts:56-64` → buildCrud() generated handlers
- **SQL:**
  ```sql
  -- List: SELECT * FROM branch_master WHERE active_status = 1 ORDER BY branch_name
  -- Create: INSERT INTO branch_master (id, branch_name, branch_code, ...) VALUES (?, ?, ?, ...)
  -- Update: UPDATE branch_master SET branch_name = ?, ... WHERE id = ?
  -- Delete (admin only): UPDATE branch_master SET active_status = 0 WHERE id = ?
  ```
- **DB Table(s):** `branch_master`, `department_master`, `designation_master`, `lob_master`, `campaign_master`, `cost_centre_master`, `grade_band_master`, `location_master`, `policy_master`
- **Result:** Organization master data maintained. Used in all dropdowns across the system.

### Activity: Leave Types CRUD
- **Frontend:** `src/pages/settings/LeaveTypeSettings.tsx` → Full leave type management
- **API Call:**
  - `GET /api/leave/types`
  - `POST /api/leave/types` (create)
  - `PUT /api/leave/types/:id` (update)
  - `DELETE /api/leave/types/:id` (soft-delete, admin only)
- **Backend Route:**
  - `backend/src/modules/leave/leave.routes.ts:17` (GET)
  - `backend/src/modules/leave/leave.routes.ts:18` (POST, requireRole: admin, hr)
  - `backend/src/modules/leave/leave.routes.ts:21` (PUT, requireRole: admin, hr)
  - `backend/src/modules/leave/leave.routes.ts:66` (DELETE, requireRole: admin)
- **SQL:**
  ```sql
  -- List: SELECT * FROM leave_type_master WHERE active_status = 1 ORDER BY leave_name ASC
  -- Create: INSERT INTO leave_type_master (id, leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave) VALUES (?, ?, ?, ?, ?, ?, ?)
  -- Update: UPDATE leave_type_master SET leave_name = ?, max_days_per_year = ?, ... WHERE id = ? AND active_status = 1
  -- Delete: UPDATE leave_type_master SET active_status = 0, updated_at = NOW() WHERE id = ? AND active_status = 1
  ```
- **DB Table(s):** `leave_type_master`
- **Result:** Leave types configured organization-wide.

### Activity: Access Control — Assign/Revoke Roles
- **Frontend:** `src/pages/settings/AccessControl.tsx` → Assign or revoke roles for any user
- **API Call:**
  - `POST /api/access/roles/assign` — body: `{ "user_id": "uuid", "role_key": "finance" }`
  - `POST /api/access/roles/revoke` — body: `{ "user_id": "uuid", "role_key": "finance" }`
- **Backend Route:**
  - `backend/src/modules/access/access.routes.ts:55` (assign, requireRole: admin)
  - `backend/src/modules/access/access.routes.ts:63` (revoke, requireRole: admin)
- **SQL:**
  ```sql
  -- Assign:
  SELECT role_key FROM workforce_role_catalog WHERE role_key = ? AND active_status = 1 LIMIT 1
  INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE active_status = 1
  INSERT INTO sensitive_action_log (...) VALUES (?, ?, 'ROLE_ASSIGNED', 'ACCESS_CONTROL', 'user', ?, ?, ?, NOW())

  -- Revoke:
  UPDATE user_roles SET active_status = 0 WHERE user_id = ? AND role_key = ?
  INSERT INTO sensitive_action_log (...) VALUES (?, ?, 'ROLE_REVOKED', 'ACCESS_CONTROL', 'user', ?, ?, ?, NOW())
  ```
- **DB Table(s):** `workforce_role_catalog`, `user_roles`, `sensitive_action_log`
- **Result:** Role assigned/revoked immediately. Audit trail created.

### Activity: Page Access Matrix
- **Frontend:** `src/pages/settings/PageAccessMatrix.tsx` → View and configure which roles can access which pages
- **API Call:** `GET /api/access/page-access`
- **Backend Route:** `backend/src/modules/access/access.routes.ts:81` → inline handler (requireRole: admin)
- **SQL:**
  ```sql
  SELECT role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status
    FROM role_page_access
   ORDER BY role_key, page_code
  ```
- **DB Table(s):** `role_page_access`
- **Result:** Full matrix of role-to-page permissions displayed for configuration.

### Activity: Configure Communication Providers
- **Frontend:** `src/pages/settings/CommunicationConfig.tsx` → Configure email/SMS/WhatsApp providers
- **API Call:**
  - `GET /api/communication/config/:channel` (view current config)
  - `PUT /api/communication/config/:channel` (save config)
  - `POST /api/communication/config/:channel/enable` (enable)
  - `POST /api/communication/config/:channel/disable` (disable)
  - `POST /api/communication/config/:channel/test` (test send)
- **Backend Route:** `backend/src/modules/communication/communication.routes.ts:39-87` → provider config handlers (requireRole: admin)
- **SQL:**
  ```sql
  -- Get config:
  SELECT * FROM communication_provider_config WHERE channel = ? LIMIT 1
  -- Save:
  INSERT INTO communication_provider_config (id, channel, provider_type, config_json, enabled, updated_by)
    VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE provider_type = VALUES(provider_type), ...
  -- Test result:
  UPDATE communication_provider_config SET last_test_success = ?, last_test_message = ?, last_test_at = NOW() WHERE channel = ?
  ```
- **DB Table(s):** `communication_provider_config`
- **Result:** Provider configured and tested. Channel ready for dispatch.

### Activity: Process Config
- **Frontend:** `src/pages/settings/ProcessConfig.tsx` → Configure KPI targets per process
- **API Call:** `POST /api/kpi/process-config/:processId` — body: `{ "metric_id": "uuid", "target_value": 85, "weightage": 100 }`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:64` → inline handler (requireRole: admin, hr)
- **SQL:**
  ```sql
  INSERT INTO kpi_process_config (id, process_id, metric_id, target_value, min_threshold, max_achievement, weightage, created_by)
    VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE target_value=VALUES(target_value), min_threshold=VALUES(min_threshold), ...
  ```
- **DB Table(s):** `kpi_process_config`
- **Result:** KPI target configured for the process. Used in scorecards and Client Portal.

### Activity: Attendance Rules
- **Frontend:** `src/pages/wfm/AttendanceRules.tsx` → Configure attendance calculation rules
- **API Call:** `POST /api/attendance-engine/rules` — body:
  ```json
  {
    "rule_name": "Delhi Customer Support", "scope_type": "process",
    "process_id": "uuid", "attendance_source": "dialler",
    "full_day_minutes": 480, "half_day_minutes": 240, "grace_minutes": 15,
    "effective_from": "2026-06-01"
  }
  ```
- **Backend Route:** `backend/src/modules/wfm/attendance-engine.routes.ts:36` → inline handler (requireRole: admin)
- **SQL:**
  ```sql
  INSERT INTO attendance_rule_config
    (id, rule_name, scope_type, designation_id, process_id, branch_id,
     attendance_source, full_day_minutes, half_day_minutes, grace_minutes,
     effective_from, effective_to, notes, created_by, active_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ```
- **DB Table(s):** `attendance_rule_config`
- **Result:** Attendance rule created. Engine uses it for daily processing of attendance records.

### Activity: Migration Console
- **Frontend:** `src/pages/settings/MigrationConsole.tsx` → Import/export data, run migrations
- **API Call:** Various migration endpoints (module-specific)
- **Backend Route:** Integration hub routes
- **SQL:** Bulk INSERT/SELECT operations per migration type
- **DB Table(s):** Target tables of migration
- **Result:** Data migrated from source systems to MySQL. Audit trail maintained.

### Activity: RBAC Reconciliation
- **Frontend:** `src/pages/settings/RBACReconciliation.tsx` → View MySQL vs Supabase role mismatches
- **API Call:** `GET /api/access/rbac-reconciliation`
- **Backend Route:** `backend/src/modules/access/access.routes.ts:35` → getRbacReconciliation() (requireRole: admin)
- **SQL:**
  ```sql
  SELECT user_id, role_key FROM user_roles WHERE active_status = 1 ORDER BY user_id
  ```
- **DB Table(s):** `user_roles`
- **Result:** Reconciliation report: total MySQL users, mismatches (if any remain from Supabase migration).

### Activity: Org Settings
- **Frontend:** `src/pages/settings/OrgSettings.tsx` → Company-level configuration
- **API Call:** Various org configuration endpoints
- **Backend Route:** `backend/src/modules/org/org.routes.ts` and related
- **SQL:** CRUD on configuration tables
- **DB Table(s):** Various configuration tables
- **Result:** Organization-level settings applied system-wide.

### Activity: Customization Rules
- **Frontend:** `src/pages/settings/CustomizationRules.tsx` → Process/branch-specific policy overrides
- **API Call:** Custom configuration endpoints
- **Backend Route:** Customization module routes
- **SQL:**
  ```sql
  INSERT INTO customization_rule (id, entity_type, entity_id, scope_type, scope_id, config_override)
    VALUES (?, ?, ?, ?, ?, ?)
  ```
- **DB Table(s):** `customization_rule`
- **Result:** Branch/process-specific policy overrides applied (e.g., different leave quotas per branch).

### Activity: Audit Log
- **Frontend:** `src/pages/settings/AuditLog.tsx` → Full system audit trail
- **API Call:** `GET /api/access/audit-log?limit=100`
- **Backend Route:** `backend/src/modules/access/access.routes.ts:71` → querySensitiveActionLog() (requireRole: admin)
- **SQL:**
  ```sql
  SELECT id, actor_user_id, action_type, module_key, entity_type, entity_id, ip_address, change_summary, acted_at
    FROM sensitive_action_log
   ORDER BY acted_at DESC LIMIT 100
  ```
- **DB Table(s):** `sensitive_action_log`
- **Result:** Complete audit trail of all sensitive actions across the system.

---

## [ROLE 13] — Process Manager

### Activity: Login
- **Frontend:** `src/pages/Auth.tsx` → Login (role_key: `process_manager`)
- **API Call:** `POST /api/auth/login`, `GET /api/access/me`
- **Backend Route:** (See Shared Authentication Flow)
- **Result:** Process management dashboard with roster, KPI, headcount, quality modules.

### Activity: View Process Headcount
- **Frontend:** `src/pages/process/ProcessDashboard.tsx` → View headcount for managed process
- **API Call:** `GET /api/employees?process_id=uuid`
- **Backend Route:** `backend/src/modules/employees/employee.routes.ts:40` → `c.listEmployees`
- **SQL:**
  ```sql
  SELECT * FROM employees WHERE process_id = ? AND active_status = 1 AND employment_status = 'active'
   ORDER BY full_name
  ```
- **DB Table(s):** `employees`
- **Result:** List of all active employees in the process with designation, branch, DOJ.

### Activity: Publish Roster
- **Frontend:** `src/pages/wfm/RosterPlanner.tsx` → Click "Publish" on process roster plan
- **API Call:** `PATCH /api/roster/plans/:id/publish`
- **Backend Route:** `backend/src/modules/wfm/roster.routes.ts:27` → `c.publishPlan`
- **SQL:**
  ```sql
  UPDATE roster_plan SET plan_status = 'published', published_at = NOW(), published_by = ? WHERE id = ?
  UPDATE roster_assignment SET publish_status = 'published' WHERE plan_id = ?
  ```
- **DB Table(s):** `roster_plan`, `roster_assignment`
- **Result:** Process roster published. Employees see their schedules. Publication authority is process-scoped.

### Activity: View KPI Targets
- **Frontend:** `src/pages/kpi/ProcessKPI.tsx` → View configured KPI targets
- **API Call:** `GET /api/kpi/process-config/:processId`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:50` → inline handler (requireRole: admin, hr, manager)
- **SQL:**
  ```sql
  SELECT kpc.*, km.metric_name, km.metric_code, km.category AS metric_type, km.unit
    FROM kpi_process_config kpc
    JOIN kpi_metric_master km ON km.id = kpc.metric_id
   WHERE kpc.process_id = ?
   ORDER BY km.metric_name
  ```
- **DB Table(s):** `kpi_process_config`, `kpi_metric_master`
- **Result:** Process KPI targets with metric names, targets, thresholds, weightages.

### Activity: Update Process Config
- **Frontend:** `src/pages/kpi/ProcessKPI.tsx` → Edit metric target, save
- **API Call:** `POST /api/kpi/process-config/:processId` — body: `{ "metric_id": "uuid", "target_value": 90, "weightage": 80 }`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:64` → inline handler (requireRole: admin, hr)
- **SQL:**
  ```sql
  INSERT INTO kpi_process_config (id, process_id, metric_id, target_value, min_threshold, max_achievement, weightage, created_by)
    VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE target_value=VALUES(target_value), ...
  ```
- **DB Table(s):** `kpi_process_config`
- **Result:** KPI target updated. Reflected in scorecards and client portal.

### Activity: Attrition (Process-Level)
- **Frontend:** `src/pages/exit/ProcessAttrition.tsx` → View exits from managed process
- **API Call:** `GET /api/exit/stats`
- **Backend Route:** `backend/src/modules/exit/exit.routes.ts:20` → `exitController.getExitStats`
- **SQL:**
  ```sql
  SELECT COUNT(*) AS total_exits, exit_type, MONTH(resignation_date) AS month
    FROM exit_request er
    JOIN employees e ON e.id = er.employee_id
   WHERE e.process_id = ? AND er.active_status = 1
   GROUP BY exit_type, MONTH(resignation_date)
  ```
- **DB Table(s):** `exit_request`, `employees`
- **Result:** Process attrition trends: monthly exits, voluntary/involuntary split.

### Activity: Quality/Operations Performance
- **Frontend:** `src/pages/kpi/ProcessPerformance.tsx` → View team performance scores
- **API Call:** `GET /api/kpi/family-summary/:processId/:period`
- **Backend Route:** `backend/src/modules/kpi/kpi.routes.ts:40` → inline handler
- **SQL:**
  ```sql
  SELECT km.category AS family, AVG(ks.score) AS avg_score, COUNT(DISTINCT ks.employee_id) AS employee_count
    FROM kpi_score ks
    JOIN kpi_metric_master km ON km.id = ks.metric_id
    JOIN employees e ON e.id = ks.employee_id
   WHERE e.process_id = ? AND ks.period = ?
   GROUP BY km.category
  ```
- **DB Table(s):** `kpi_score`, `kpi_metric_master`, `employees`
- **Result:** Quality/Operations performance summary by metric family.

### Activity: Acknowledge Roster
- **Frontend:** `src/pages/wfm/MyRoster.tsx` → View own roster, click "Acknowledge"
- **API Call:** `GET /api/roster/assignments?employeeId=uuid&fromDate=...&toDate=...`
- **Backend Route:** `backend/src/modules/wfm/roster.routes.ts:31` → `c.listAssignments`
- **SQL:** Same as Employee View Roster
- **DB Table(s):** `roster_assignment`
- **Result:** Process Manager sees and acknowledges own published roster.

### Activity: Hiring Demand (View ATS for Process)
- **Frontend:** `src/pages/ats/HiringDemand.tsx` → View candidates applying for process
- **API Call:** `GET /api/ats/candidates?process=Customer%20Support&page=1&limit=20`
- **Backend Route:** `backend/src/modules/ats/ats.routes.ts:22` → `c.listCandidates`
- **SQL:**
  ```sql
  SELECT * FROM ats_candidate
   WHERE active_status = 1 AND applied_for_process = ?
   ORDER BY created_at DESC LIMIT 20 OFFSET 0
  ```
- **DB Table(s):** `ats_candidate`
- **Result:** Candidates in the hiring pipeline for the managed process.

---

## Built-in Business Logic

### 1. ATS Stage Flow

```
Applied → Screening → Interview → Selected/Rejected → Onboarding Bridge → Employee Created
```

**Detailed Flow:**
1. Walk-in candidate submits registration form (`POST /api/ats/candidates`) → `ats_candidate` created with `current_stage = 'New'`
2. Recruiter moves to Screening (`POST /api/ats/candidates/:id/move-stage` with `toStage: 'Screening'`) → stage log inserted
3. Recruiter moves to Interview → stage log inserted
4. Recruiter moves to Selected → triggers:
   - `sendSelectedEmail()` to candidate
   - `sendOnboardingToken()` → creates `ats_onboarding_bridge` record with token
   - Stage log inserted
5. OR Recruiter moves to Rejected → triggers `sendRejectedEmail()`
6. Candidate receives onboarding link → visits `/onboarding?token=XXX`
7. Candidate registers account via `POST /api/auth/register` with `onboardingToken`
   - Validates token against `ats_onboarding_bridge.onboarding_token`
   - Creates `auth_user` record
   - Links `ats_candidate.user_id` to new auth user
8. HR generates offer via `POST /api/ats/onboarding/requests/:id/offer`
9. Branch Head approves offer via `POST /api/ats/onboarding/offers/:id/approve`
10. HR converts candidate to employee via `POST /api/ats/convert/:candidateId`
    - Creates `employees` record from candidate data
    - Links employee to auth user
    - Seeds leave balances
    - Creates journey log entry

**Key Tables:** `ats_candidate`, `ats_candidate_stage_log`, `ats_onboarding_bridge`, `ats_onboarding_request`, `auth_user`, `employees`

---

### 2. Leave Approval Chain

```
Submit → Pending → Manager Approves → Approved
                → Manager Rejects → Rejected
         OR HR Admin bypass → Approved/Rejected directly
```

**Detailed Flow:**
1. Employee submits leave: `POST /api/leave/requests` → `leave_request` created with `status = 'pending'`
2. Manager/HR reviews: `PATCH /api/leave/requests/:id/review` with `{ status: 'approved'|'rejected', remarks }`
   - `leave_request.status` updated
   - `leave_approval_log` entry created (who approved, when, remarks)
3. On approval:
   - `leave_balance_ledger.used_days` incremented
   - Attendance engine marks dates as `leave_approved` (LWP = 0 for paid leave)
4. HR Admin can bypass the normal chain — direct approve/reject with `requireRole("admin", "hr")`

**Key Tables:** `leave_request`, `leave_approval_log`, `leave_balance_ledger`, `leave_type_master`, `attendance_daily_record`

---

### 3. Roster Governance

```
Demand → Draft → PM Publishes → Employee Acknowledges → WFM Locks → Payroll-ready
```

**Detailed Flow:**
1. WFM creates roster plan: `POST /api/roster/plans` → `roster_plan` with `plan_status = 'draft'`
2. WFM assigns employees to slots: `POST /api/roster/assignments` → `roster_assignment` with `publish_status = 'draft'`
3. Process Manager publishes: `PATCH /api/roster/plans/:id/publish`
   - `roster_plan.plan_status` → `'published'`
   - All `roster_assignment.publish_status` for plan → `'published'`
   - `published_at` and `published_by` recorded
4. Employees view and acknowledge their published roster
5. Post-publication changes require:
   - Override reason recorded in `roster_assignment` correction fields
   - Audit trail maintained
6. WFM locks attendance records: `PATCH /api/attendance-engine/daily/:emp/:date` with `isLocked: true`
   - Locked records cannot be modified by engine re-processing
   - Become authoritative input for payroll LWP calculation
7. Payroll reads locked attendance records during `calculatePayrollRun()` for LWP deduction

**Key Tables:** `roster_plan`, `roster_assignment`, `shift_master`, `attendance_daily_record`, `roster_preference`

---

### 4. Attendance Engine

```
Clock-in/out → Engine processes → attendance_daily_record populated → LWP calculated → Payroll input
```

**Detailed Flow:**
1. Employee clocks in: `POST /api/attendance-engine/clock-in`
   - Creates `attendance_daily_record` with `clock_in_time`, geo coordinates, `attendance_status = 'present'`
2. Employee clocks out: `POST /api/attendance-engine/clock-out`
   - Updates `clock_out_time` and geo coordinates
3. Attendance Engine runs (cron or manual via `POST /api/attendance-engine/process`):
   - Resolves applicable rule: `attendance_rule_config` matched by designation/process/branch + date
   - Calculates total minutes worked from clock-in/clock-out or dialler data
   - Determines status:
     - `>= full_day_minutes + grace_minutes` → `present` (LWP = 0)
     - `>= half_day_minutes` → `half_day` (LWP = 0.5)
     - `< half_day_minutes` or no clock-in → `absent` (LWP = 1.0)
   - Updates `attendance_daily_record.attendance_status` and `lwp_value`
4. WFM can override: `PATCH /api/attendance-engine/daily/:emp/:date` with corrected status + lock
5. Leave-approved dates: engine checks `leave_request` for approved leaves → marks as `leave_approved` (LWP = 0 for paid)
6. Payroll reads: `SUM(lwp_value)` for the month → `lwp_days` in `salary_prep_line` → LWP deduction applied

**Key Tables:** `attendance_daily_record`, `attendance_rule_config`, `attendance_regularization`, `leave_request`, `salary_prep_line`

---

### 5. Payroll Flow

```
Salary Structure → Payroll Run (Draft) → Calculate → Lock → Generate Payslips → NEFT Export → Disbursed
```

**Detailed Flow:**
1. Admin creates salary structure: `POST /api/payroll/structures`
   - `salary_structure` + `salary_structure_component` records created
2. Admin assigns salary to employee: `POST /api/payroll/salary-assignments`
   - `employee_salary_assignment` created with CTC, structure_id, effective_from
3. Finance creates payroll run: `POST /api/payroll/runs`
   - `salary_prep_run` created with `status = 'draft'`
4. Finance triggers calculation: `POST /api/payroll/runs/:id/calculate`
   - For each active employee with salary assignment:
     - Reads `employee_salary_assignment` for CTC/structure
     - Reads `attendance_daily_record` for LWP days in month
     - Reads `statutory_config` for PF/ESI/PT rates
     - Reads `employee_tax_declaration` for TDS projection
     - Computes: Basic, HRA, Special Allowance, PF (employee + employer), ESI, PT, TDS
     - Applies LWP deduction: `(gross / paid_days) * lwp_days`
     - Net = Gross - PF_emp - ESI_emp - PT - TDS - LWP_deduction
   - Inserts `salary_prep_line` per employee
   - Logs to `sensitive_action_log`
5. Finance reviews and locks: `PATCH /api/payroll/runs/:id/status` with `status: 'locked'`
6. Finance generates payslips: `POST /api/payroll/payslip/:runId/generate`
   - Creates `employee_payslip` + `employee_payslip_line` records
7. Finance records disbursement: `POST /api/payroll/disbursements`
   - `payroll_disbursement` record with bank_ref, amount, employee_count
8. Finance marks complete: `PATCH /api/payroll/disbursements/:id` with `status: 'completed'`

**Key Tables:** `salary_structure`, `salary_structure_component`, `employee_salary_assignment`, `salary_prep_run`, `salary_prep_line`, `statutory_config`, `employee_payslip`, `employee_payslip_line`, `payroll_disbursement`, `employee_tax_declaration`, `attendance_daily_record`

---

### 6. Communication Dispatch

```
Template selected → Recipients resolved → Provider loaded from DB (DB-first factory) → Send via Email/SMS/WA → dispatch_log updated
```

**Detailed Flow:**
1. User selects template: `GET /api/communication/templates` → picks one
2. User specifies recipients and variables: `POST /api/communication/dispatch/send`
   ```json
   { "channel": "email", "template_id": "uuid", "recipients": [...], "variables": {...} }
   ```
3. Backend resolves template body from `communication_template` table
4. Variables substituted into template placeholders
5. Provider factory loads config from DB:
   ```sql
   SELECT * FROM communication_provider_config WHERE channel = ? AND enabled = 1 LIMIT 1
   ```
6. Provider instance created (Nodemailer for email, Twilio/MSG91 for SMS, WhatsApp API)
7. Message dispatched via provider
8. Dispatch log written:
   ```sql
   INSERT INTO communication_dispatch_log (id, channel, template_id, recipient, status, provider_type, sent_at, error_message)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
   ```
9. On failure: status = 'failed', error_message populated. Retry available via `POST /api/communication/dispatch/retry/:id`

**Key Tables:** `communication_template`, `communication_provider_config`, `communication_dispatch_log`

---

### 7. File Storage

```
Upload via POST /api/files/upload?category=X → multer saves to /uploads/X/uuid.ext → metadata registered → served via GET /api/files/X/uuid.ext
```

**Detailed Flow:**
1. User uploads file: `POST /api/files/upload?category=employee-documents`
   - Multipart form-data with field "file"
   - `requireRole("admin", "hr")` enforced for employee document uploads
2. Multer middleware processes:
   - Validates extension against allowlist: `.pdf, .jpg, .jpeg, .png, .webp, .doc, .docx, .xls, .xlsx, .csv, .txt`
   - File size limit: 10 MB
   - Saves to disk: `/uploads/<category>/<uuid>.<ext>`
   - Category sanitized: only `[a-zA-Z0-9_-]` chars allowed
3. Response returned:
   ```json
   { "success": true, "url": "/api/files/<category>/<uuid>.ext", "originalName": "resume.pdf", "size": 123456 }
   ```
4. Metadata linked to entity (e.g., employee_documents table insert)
5. File served via static route: `GET /api/files/<category>/<filename>`
   - Express static middleware serves from `/uploads/` directory
   - Auth required for protected categories

**Key Tables:** `employee_documents` (metadata), physical storage at `backend/uploads/`

---

### 8. RBAC (Role-Based Access Control)

```
Login → JWT → GET /api/access/me → user_roles + role_page_access queried → pages array controls sidebar visibility → WorkforcePageGate blocks restricted pages
```

**Detailed Flow:**
1. User logs in: `POST /api/auth/login` → JWT issued with `{ sub: userId, email }`
2. Frontend calls `GET /api/access/me` with Bearer token
3. Backend resolves:
   ```sql
   -- Get user's roles
   SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1
   -- Get page permissions for those roles
   SELECT page_code, can_view, can_create, can_edit, can_delete, can_export
     FROM role_page_access WHERE role_key IN (?) AND active_status = 1
   -- Get employee record
   SELECT id, employee_code, full_name FROM employees WHERE user_id = ? AND active_status = 1
   ```
4. Response structure (`AccessMeResponse`):
   ```json
   {
     "userId": "uuid", "email": "user@email.com",
     "employeeId": "uuid", "employeeCode": "MAS001", "employeeName": "Priya Sharma",
     "roles": ["hr", "admin"],
     "scopes": [{ "role_key": "hr", "scope_type": "branch", "branch_id": "uuid" }],
     "pages": [{ "page_code": "EMPLOYEES", "can_view": true, "can_create": true, ... }]
   }
   ```
5. Frontend sidebar uses `pages` array to show/hide menu items
6. `WorkforcePageGate` component wraps protected pages — checks `can_view` before rendering
7. Backend enforces at route level:
   - `requireAuth` middleware validates JWT signature and expiry
   - `requireRole("admin", "hr")` middleware checks `user_roles` table
   - Row-level access via `getEmployeeForUser()` + `hasRole()` helpers
8. All role changes logged to `sensitive_action_log` for audit

**Key Tables:** `auth_user`, `user_roles`, `workforce_role_catalog`, `role_page_access`, `role_assignment_scope`, `sensitive_action_log`

**Role Catalog (workforce_role_catalog):**
| role_key | role_name |
|----------|-----------|
| admin | Super Admin |
| hr | HR Admin |
| recruiter | Recruiter |
| finance | Finance |
| payroll | Payroll |
| wfm | WFM |
| manager | Manager |
| team_leader | Team Leader |
| branch_head | Branch Head |
| process_manager | Process Manager |
| trainer | Trainer |
| qa | QA/Quality |
| ceo | CEO/Leadership |
| employee | Employee |
| client | Client Portal |

---

## Summary of Database Tables Referenced

| Module | Tables |
|--------|--------|
| Auth | `auth_user`, `auth_refresh_token` |
| RBAC | `user_roles`, `workforce_role_catalog`, `role_page_access`, `role_assignment_scope`, `sensitive_action_log` |
| Employees | `employees`, `employee_documents`, `employee_journey_log` |
| ATS | `ats_candidate`, `ats_candidate_stage_log`, `ats_onboarding_bridge`, `ats_onboarding_request`, `ats_email_log` |
| Leave | `leave_type_master`, `leave_request`, `leave_approval_log`, `leave_balance_ledger`, `leave_holiday` |
| WFM/Attendance | `shift_master`, `attendance_daily_record`, `attendance_regularization`, `attendance_rule_config` |
| Roster | `roster_plan`, `roster_assignment`, `roster_preference` |
| Payroll | `salary_structure`, `salary_structure_component`, `employee_salary_assignment`, `salary_prep_run`, `salary_prep_line`, `employee_payslip`, `employee_payslip_line`, `payroll_disbursement`, `statutory_config`, `employee_tax_declaration`, `employee_uan`, `salary_band_master` |
| KPI | `kpi_metric_master`, `kpi_template_metric`, `kpi_template_assignment`, `kpi_score`, `kpi_process_config` |
| Assets | `asset_master`, `asset_assignment`, `asset_service_log` |
| Exit | `exit_request`, `exit_ff_calculation` |
| Helpdesk | `helpdesk_ticket`, `helpdesk_ticket_comment`, `helpdesk_grievance` |
| Communication | `communication_template`, `communication_dispatch_log`, `communication_provider_config`, `notification_preference` |
| LMS Integration | `lms_employee_mapping`, `lms_learning_progress_snapshot`, `lms_certification_snapshot`, `lms_sync_audit_log` |
| Portal | `portal_client_user`, `portal_otp`, `portal_client_process_map`, `portal_access_log`, `portal_glide_commitment`, `management_commentary`, `management_commentary_reply`, `portal_snapshot` |
| Org Masters | `branch_master`, `department_master`, `designation_master`, `lob_master`, `campaign_master`, `cost_centre_master`, `grade_band_master`, `location_master`, `process_master`, `policy_master` |
| Customization | `customization_rule` |

---

## API Route File Index

| File | Line Range | Module |
|------|-----------|--------|
| `backend/src/modules/auth/auth.routes.ts` | 1-55 | Authentication (login, register, refresh) |
| `backend/src/modules/auth/auth.service.ts` | 1-150 | Auth logic (bcrypt, JWT, token management) |
| `backend/src/modules/ats/ats.routes.ts` | 1-79 | ATS (candidates, stages, walk-in queue) |
| `backend/src/modules/ats/ats.onboarding.routes.ts` | 1-129 | Onboarding (token, profile, offer, approval) |
| `backend/src/modules/employees/employee.routes.ts` | 1-110 | Employees (CRUD, stats, journey, stat-card) |
| `backend/src/modules/leave/leave.routes.ts` | 1-112 | Leave (types, requests, balance, holidays) |
| `backend/src/modules/payroll/payroll.routes.ts` | 1-340+ | Payroll (structures, runs, payslips, tax, UAN, disbursements) |
| `backend/src/modules/wfm/wfm.routes.ts` | 1-91 | WFM (shifts, sessions, regularizations, live tracker, preferences) |
| `backend/src/modules/wfm/roster.routes.ts` | 1-35 | Roster (plans, assignments, CSV upload) |
| `backend/src/modules/wfm/attendance-engine.routes.ts` | 1-203 | Attendance Engine (rules, processing, clock-in/out, corrections) |
| `backend/src/modules/kpi/kpi.routes.ts` | 1-79 | KPI (metrics, templates, scores, leaderboard, process config) |
| `backend/src/modules/lms/lms.routes.ts` | 1-76 | LMS Integration (launch URLs, progress, certifications, mapping, sync) |
| `backend/src/modules/org/org.routes.ts` | 1-70+ | Org Masters (branches, departments, designations, etc.) |
| `backend/src/modules/access/access.routes.ts` | 1-88 | Access Control (RBAC, roles, audit, page access) |
| `backend/src/modules/communication/communication.routes.ts` | 1-115+ | Communication (templates, dispatch, config, test) |
| `backend/src/modules/portal/portal.routes.ts` | 1-107 | Client Portal (OTP auth, overview, KPIs, attrition, commentary) |
| `backend/src/modules/exit/exit.routes.ts` | 1-128 | Exit (requests, status, F&F, approval) |
| `backend/src/modules/assets/assets.routes.ts` | 1-80+ | Assets (CRUD, assign, return, service log) |
| `backend/src/modules/helpdesk/helpdesk.routes.ts` | 1-109 | Helpdesk (tickets, comments, grievances) |
| `backend/src/modules/files/files.routes.ts` | 1-80+ | File Upload (multer, category-based storage) |

---

*End of Document*
