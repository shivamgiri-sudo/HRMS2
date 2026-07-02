# MAS-CallNet HRMS: Detailed Test Cases Matrix

**Date**: 2026-06-01  
**Purpose**: Feature × Role × Test Scenario mapping for comprehensive testing

---

## Test Case Format

Each test case includes:
- **Feature**: What's being tested
- **Role**: Who can access it
- **Preconditions**: Setup required
- **Steps**: Exact actions to perform
- **Expected Result**: What should happen
- **Actual Result**: (To be filled during testing)
- **Status**: PASS / FAIL / BLOCKED
- **Priority**: P0 / P1 / P2 / P3

---

## 1. AUTHENTICATION & ACCOUNT CONTROL (P0)

### TC-AUTH-001: Standard Login (All Roles)
**Feature**: Login  
**Role**: All  
**Preconditions**: Valid credentials exist  
**Steps**:
1. Navigate to `/auth`
2. Enter email: `admin@shivu.ai`
3. Enter password: `admin123`
4. Click "Sign In"
**Expected**: Redirect to `/` (dashboard), session token created  
**Priority**: P0

### TC-AUTH-002: Invalid Credentials
**Feature**: Login  
**Role**: All  
**Preconditions**: None  
**Steps**:
1. Navigate to `/auth`
2. Enter email: `admin@shivu.ai`
3. Enter password: `wrong123`
4. Click "Sign In"
**Expected**: Error message "Invalid credentials", stay on login page  
**Priority**: P0

### TC-AUTH-003: Forgot Password (Public)
**Feature**: Password Reset  
**Role**: Public (no auth)  
**Preconditions**: Valid email exists in system  
**Steps**:
1. Navigate to `/auth`
2. Click "Forgot Password?"
3. Enter email: `hr@shivu.ai`
4. Click "Send Reset Link"
5. Check email inbox
6. Click reset link in email
7. Redirected to `/reset-password`
8. Enter new password (min 6 chars)
9. Confirm password (must match)
10. Click "Update Password"
**Expected**: Success message, redirect to dashboard  
**Priority**: P0

### TC-AUTH-004: Reset Password - Invalid Link
**Feature**: Password Reset  
**Role**: Public  
**Preconditions**: None  
**Steps**:
1. Navigate to `/reset-password` without reset token
**Expected**: "Invalid or Expired Link" message, "Back to Login" button  
**Priority**: P1

### TC-AUTH-005: Admin-Initiated Password Reset
**Feature**: Account Control  
**Role**: Admin  
**Preconditions**: Admin logged in, target user exists  
**Steps**:
1. Login as admin
2. POST `/api/account-control/reset-request` with `userId: <target-user-id>`
3. Check audit log
**Expected**: Reset request logged, admin action tracked in audit  
**Priority**: P1

### TC-AUTH-006: Force Password Change
**Feature**: Account Control  
**Role**: Admin  
**Preconditions**: Admin logged in  
**Steps**:
1. POST `/api/account-control/force-change` with `userId`, `reason`
2. Target user next login → forced to change password
**Expected**: Target user cannot proceed until password changed  
**Priority**: P1

### TC-AUTH-007: Account Lock (Admin)
**Feature**: Account Control  
**Role**: Admin  
**Preconditions**: Admin logged in, target user active  
**Steps**:
1. POST `/api/account-control/lock` with `userId`, `reason`
2. Target user attempts login
**Expected**: Lock successful, target user login fails with "Account locked"  
**Priority**: P0

### TC-AUTH-008: Account Unlock (Admin)
**Feature**: Account Control  
**Role**: Admin  
**Preconditions**: Target user locked  
**Steps**:
1. POST `/api/account-control/unlock` with `userId`
2. Target user attempts login
**Expected**: Unlock successful, target user can login  
**Priority**: P0

### TC-AUTH-009: Account Disable (Admin)
**Feature**: Account Control  
**Role**: Admin  
**Preconditions**: Admin logged in  
**Steps**:
1. POST `/api/account-control/disable` with `userId`, `reason`
2. Check user status in employee table
**Expected**: User status = disabled, cannot login  
**Priority**: P1

### TC-AUTH-010: Session Revoke (Admin)
**Feature**: Account Control  
**Role**: Admin  
**Preconditions**: Target user logged in (active session)  
**Steps**:
1. POST `/api/account-control/revoke-session` with `userId`
2. Check target user session
**Expected**: Target user logged out immediately, session terminated  
**Priority**: P1

### TC-AUTH-011: Account Audit Log (Admin/HR)
**Feature**: Audit Log  
**Role**: Admin, HR  
**Preconditions**: Some account actions performed  
**Steps**:
1. GET `/api/account-control/audit-log/:userId`
2. Review log entries
**Expected**: All actions visible (reset, lock, unlock, disable, revoke) with timestamp, actor, IP  
**Priority**: P1

---

## 2. ATS: RECRUITMENT JOURNEY (P1)

### TC-ATS-001: Candidate Registration (Public)
**Feature**: Candidate Registration  
**Role**: Public (no auth)  
**Preconditions**: None  
**Steps**:
1. Navigate to `/ats/candidate-registration` (public URL)
2. Fill form: Name, Email, Phone, Position Applied
3. Upload resume (optional)
4. Click "Submit"
**Expected**: Candidate record created, confirmation message, email sent  
**Priority**: P1

### TC-ATS-002: Duplicate Email Validation
**Feature**: Candidate Registration  
**Role**: Public  
**Preconditions**: Email already exists  
**Steps**:
1. Fill form with existing email
2. Click "Submit"
**Expected**: Error "Email already registered", form stays  
**Priority**: P1

### TC-ATS-003: Walk-in Queue View (HR/Recruiter)
**Feature**: Walk-in Queue  
**Role**: HR, Recruiter  
**Preconditions**: Some walk-in candidates exist  
**Steps**:
1. Login as HR
2. Navigate to `/ats/walkin-queue`
3. View candidate list
**Expected**: All walk-in candidates visible, sorted by arrival time  
**Priority**: P1

### TC-ATS-004: Mark Candidate Interviewed (HR)
**Feature**: Walk-in Queue  
**Role**: HR  
**Preconditions**: Walk-in candidate in queue  
**Steps**:
1. Navigate to `/ats/walkin-queue`
2. Select candidate
3. Click "Mark Interviewed"
4. Enter VOC (Voice of Customer) notes
5. Select next stage (Selected/Rejected/Hold)
6. Save
**Expected**: Candidate status updated, moved out of queue  
**Priority**: P1

### TC-ATS-005: Candidate Master Search (HR)
**Feature**: Candidate Master  
**Role**: HR, Recruiter  
**Preconditions**: Multiple candidates exist  
**Steps**:
1. Navigate to `/ats/candidate-master`
2. Search by name: "John"
3. Filter by status: "Selected"
4. Filter by position: "Agent"
**Expected**: Filtered candidates visible, search responsive  
**Priority**: P1

### TC-ATS-006: Edit Candidate (HR)
**Feature**: Candidate Master  
**Role**: HR  
**Preconditions**: Candidate exists  
**Steps**:
1. Navigate to `/ats/candidate-master`
2. Click candidate row → Edit
3. Update phone number
4. Save
**Expected**: Candidate updated, changes reflected immediately  
**Priority**: P1

### TC-ATS-007: Delete Candidate (HR)
**Feature**: Candidate Master  
**Role**: HR  
**Preconditions**: Candidate exists  
**Steps**:
1. Navigate to `/ats/candidate-master`
2. Click candidate row → Delete
3. Confirm deletion
**Expected**: Candidate soft-deleted (not visible in list, but DB record retained)  
**Priority**: P2

### TC-ATS-008: Recruiter Workspace - My Candidates (Recruiter)
**Feature**: Recruiter Workspace  
**Role**: Recruiter  
**Preconditions**: Candidates assigned to recruiter  
**Steps**:
1. Login as recruiter
2. Navigate to `/ats/recruiter-workspace`
3. View "My Candidates" tab
**Expected**: Only assigned candidates visible, not all candidates  
**Priority**: P1

### TC-ATS-009: Move Candidate Stage (Recruiter)
**Feature**: Recruiter Workspace  
**Role**: Recruiter  
**Preconditions**: Candidate in "Screening" stage  
**Steps**:
1. Navigate to `/ats/recruiter-workspace`
2. Drag candidate card to "Interview" column
3. Confirm move
**Expected**: Candidate stage updated, stage log created  
**Priority**: P1

### TC-ATS-010: Add Interview Notes (Recruiter)
**Feature**: Recruiter Workspace  
**Role**: Recruiter  
**Preconditions**: Candidate interviewed  
**Steps**:
1. Open candidate detail
2. Click "Add Notes"
3. Enter interview feedback
4. Save
**Expected**: Notes saved, visible in activity timeline  
**Priority**: P1

### TC-ATS-011: Create Offer Letter (HR)
**Feature**: Offer Management  
**Role**: HR  
**Preconditions**: Candidate selected (stage = "Offer")  
**Steps**:
1. Navigate to `/ats/extensions` (offers section)
2. Click "Create Offer"
3. Select candidate
4. Enter CTC, joining date, designation
5. Generate offer letter (template-based)
6. Send offer via email
**Expected**: Offer created, email sent to candidate  
**Priority**: P1

### TC-ATS-012: Candidate Accepts Offer (Public)
**Feature**: Offer Management  
**Role**: Public (candidate with offer link)  
**Preconditions**: Offer sent to candidate email  
**Steps**:
1. Candidate clicks offer link in email
2. Redirected to offer acceptance page
3. Review offer details
4. Click "Accept Offer"
5. Digital signature/confirmation
**Expected**: Offer status = "Accepted", HR notified  
**Priority**: P1

### TC-ATS-013: Candidate Rejects Offer (Public)
**Feature**: Offer Management  
**Role**: Public  
**Preconditions**: Offer sent  
**Steps**:
1. Click offer link
2. Click "Reject Offer"
3. Enter reason (optional)
4. Confirm
**Expected**: Offer status = "Rejected", HR notified  
**Priority**: P1

### TC-ATS-014: Onboarding Bridge - Convert to Employee (HR)
**Feature**: Onboarding Bridge  
**Role**: HR  
**Preconditions**: Candidate accepted offer  
**Steps**:
1. Navigate to `/ats/onboarding-bridge`
2. Select candidate with accepted offer
3. Click "Convert to Employee"
4. System auto-generates employee code (MAS00001+)
5. Create employee record
6. Link onboarding tasks
7. Confirm
**Expected**: Employee record created, candidate marked as "Joined", onboarding checklist initiated  
**Priority**: P0

### TC-ATS-015: ATS Dashboard - Funnel View (HR)
**Feature**: ATS Dashboard  
**Role**: HR, Recruiter  
**Preconditions**: Multiple candidates in different stages  
**Steps**:
1. Navigate to `/ats/dashboard`
2. View candidate funnel chart
**Expected**: Count per stage visible (Screening: 50, Interview: 30, Offer: 10, Joined: 5)  
**Priority**: P2

### TC-ATS-016: Source Effectiveness Report (HR)
**Feature**: Sourcing Analysis  
**Role**: HR  
**Preconditions**: Candidates from multiple sources  
**Steps**:
1. Navigate to `/ats/sourcing-analysis`
2. View source breakdown (Walk-in, Referral, Portal, LinkedIn)
3. Filter by date range (last 3 months)
**Expected**: Source-wise candidate count, conversion rate, cost-per-hire visible  
**Priority**: P2

---

## 3. EMPLOYEE MANAGEMENT (P0)

### TC-EMP-001: View All Employees (Admin/HR)
**Feature**: Employee List  
**Role**: Admin, HR  
**Preconditions**: Multiple employees exist  
**Steps**:
1. Login as admin
2. Navigate to `/employees`
3. View employee list
**Expected**: ALL employees visible (not filtered by team)  
**Priority**: P0

### TC-EMP-002: View Team Employees Only (Manager)
**Feature**: Employee List  
**Role**: Manager  
**Preconditions**: Manager has reportees  
**Steps**:
1. Login as manager
2. Navigate to `/employees`
3. View employee list
**Expected**: ONLY reportees visible (manager.id = employee.reporting_manager_id)  
**Priority**: P0

### TC-EMP-003: Employee Cannot See List (Employee)
**Feature**: Employee List  
**Role**: Employee  
**Preconditions**: Employee logged in  
**Steps**:
1. Login as employee
2. Navigate to `/employees`
**Expected**: 403 Forbidden OR redirect to dashboard  
**Priority**: P0

### TC-EMP-004: Add Employee (Admin/HR)
**Feature**: Employee CRUD  
**Role**: Admin, HR  
**Preconditions**: None  
**Steps**:
1. Navigate to `/employees`
2. Click "Add Employee"
3. Fill form: Name, Email, Phone, DOJ, Designation, Branch, Client, Process
4. Click "Save"
**Expected**: Employee created, employee_code auto-generated (MAS00001+)  
**Priority**: P0

### TC-EMP-005: Edit Employee (Admin/HR)
**Feature**: Employee CRUD  
**Role**: Admin, HR  
**Preconditions**: Employee exists  
**Steps**:
1. Navigate to `/employees`
2. Click employee row → Edit
3. Update phone number
4. Save
**Expected**: Employee updated, changes reflected  
**Priority**: P0

### TC-EMP-006: Archive Employee (Admin/HR)
**Feature**: Employee CRUD  
**Role**: Admin, HR  
**Preconditions**: Employee active  
**Steps**:
1. Navigate to `/employees`
2. Click employee → Archive
3. Confirm
**Expected**: Employee status = "Inactive", not visible in active list  
**Priority**: P1

### TC-EMP-007: View Own Profile (Employee)
**Feature**: Employee Profile  
**Role**: Employee  
**Preconditions**: Employee logged in  
**Steps**:
1. Login as employee
2. Navigate to `/profile`
3. View profile details
**Expected**: Own profile visible, can edit contact/bank details  
**Priority**: P0

### TC-EMP-008: Edit Own Contact Details (Employee)
**Feature**: Employee Profile  
**Role**: Employee  
**Preconditions**: Employee logged in  
**Steps**:
1. Navigate to `/profile`
2. Edit phone number, current address
3. Save
**Expected**: Changes saved, updated in employees table  
**Priority**: P1

### TC-EMP-009: Cannot Edit Critical Fields (Employee)
**Feature**: Employee Profile  
**Role**: Employee  
**Preconditions**: Employee logged in  
**Steps**:
1. Navigate to `/profile`
2. Attempt to edit DOJ, Designation, Salary
**Expected**: Fields disabled/read-only, cannot edit  
**Priority**: P0

---

## 4. ATTENDANCE & WFM (P0)

### TC-ATT-001: Clock-In (Employee)
**Feature**: Attendance Session  
**Role**: Employee  
**Preconditions**: Not clocked in today  
**Steps**:
1. Login as employee
2. Navigate to `/attendance`
3. Click "Clock In"
4. Confirm
**Expected**: Clock-in time recorded, session status = "Active"  
**Priority**: P0

### TC-ATT-002: Take Break (Employee)
**Feature**: Break Logging  
**Role**: Employee  
**Preconditions**: Clocked in  
**Steps**:
1. Click "Start Break"
2. Select break type (Lunch, Tea, etc.)
3. Confirm
**Expected**: Break start time recorded  
**Priority**: P1

### TC-ATT-003: End Break (Employee)
**Feature**: Break Logging  
**Role**: Employee  
**Preconditions**: On break  
**Steps**:
1. Click "End Break"
2. Confirm
**Expected**: Break end time recorded, break duration calculated  
**Priority**: P1

### TC-ATT-004: Clock-Out (Employee)
**Feature**: Attendance Session  
**Role**: Employee  
**Preconditions**: Clocked in, not on break  
**Steps**:
1. Click "Clock Out"
2. Confirm
**Expected**: Clock-out time recorded, session status = "Completed", working hours calculated  
**Priority**: P0

### TC-ATT-005: View Own Attendance (Employee)
**Feature**: Attendance View  
**Role**: Employee  
**Preconditions**: Some attendance records exist  
**Steps**:
1. Navigate to `/attendance`
2. View attendance calendar (monthly view)
**Expected**: Own attendance visible (Present, Absent, Half-day, WFH)  
**Priority**: P1

### TC-ATT-006: View Team Attendance (Manager)
**Feature**: Attendance View  
**Role**: Manager  
**Preconditions**: Manager logged in  
**Steps**:
1. Navigate to `/attendance`
2. View team attendance
**Expected**: ONLY team members' attendance visible, not other teams  
**Priority**: P0

### TC-ATT-007: View All Attendance (HR)
**Feature**: Attendance View  
**Role**: HR  
**Preconditions**: HR logged in  
**Steps**:
1. Navigate to `/attendance`
2. View attendance report
**Expected**: ALL employees' attendance visible  
**Priority**: P0

### TC-ATT-008: Attendance Regularization Request (Employee)
**Feature**: Regularization  
**Role**: Employee  
**Preconditions**: Missed clock-in/out  
**Steps**:
1. Navigate to `/attendance/regularization`
2. Click "Request Regularization"
3. Select date
4. Select reason (Forgot to clock-in, Network issue, etc.)
5. Upload proof (optional)
6. Submit
**Expected**: Regularization request created, status = "Pending", manager notified  
**Priority**: P1

### TC-ATT-009: Approve Regularization (Manager)
**Feature**: Regularization Approval  
**Role**: Manager  
**Preconditions**: Pending regularization request  
**Steps**:
1. Navigate to `/attendance/regularization`
2. View pending requests
3. Select request → Approve
4. Add remarks (optional)
5. Confirm
**Expected**: Regularization approved, attendance record updated  
**Priority**: P1

### TC-ATT-010: Reject Regularization (Manager)
**Feature**: Regularization Approval  
**Role**: Manager  
**Preconditions**: Pending regularization request  
**Steps**:
1. Navigate to `/attendance/regularization`
2. Select request → Reject
3. Add rejection reason
4. Confirm
**Expected**: Regularization rejected, employee notified  
**Priority**: P1

### TC-ATT-011: Roster View (Employee)
**Feature**: Roster  
**Role**: Employee  
**Preconditions**: Roster assigned  
**Steps**:
1. Navigate to `/wfm-roster`
2. View weekly roster
**Expected**: Own shift timings + week-off visible  
**Priority**: P1

### TC-ATT-012: Create Roster Plan (HR)
**Feature**: Roster Management  
**Role**: HR  
**Preconditions**: Employees exist, shifts defined  
**Steps**:
1. Navigate to `/wfm-roster`
2. Click "Create Roster Plan"
3. Select week/month
4. Assign shifts to employees
5. Mark week-offs
6. Save
**Expected**: Roster plan created, employees can view their roster  
**Priority**: P1

### TC-ATT-013: Bulk Upload Roster (HR)
**Feature**: Roster Management  
**Role**: HR  
**Preconditions**: Roster CSV prepared  
**Steps**:
1. Navigate to `/wfm-roster`
2. Click "Upload Roster"
3. Select CSV file (columns: employee_code, date, shift_code, is_week_off)
4. Upload
**Expected**: Roster bulk-imported, validation errors shown if any  
**Priority**: P2

### TC-ATT-014: WFM Governance - Shift Master (HR)
**Feature**: Shift Management  
**Role**: HR  
**Preconditions**: None  
**Steps**:
1. Navigate to `/wfm-governance`
2. Click "Shift Master"
3. Add new shift: Name="Morning", Start="09:00", End="18:00", Break="60 min"
4. Save
**Expected**: Shift created, available for roster assignment  
**Priority**: P2

---

## 5. LEAVE MANAGEMENT (P1)

### TC-LEV-001: Apply Leave (Employee)
**Feature**: Leave Request  
**Role**: Employee  
**Preconditions**: Employee has leave balance  
**Steps**:
1. Navigate to `/leaves`
2. Click "Apply Leave"
3. Select leave type (Casual Leave)
4. Select dates (from: 2026-06-05, to: 2026-06-07)
5. Enter reason
6. Attach medical certificate (if sick leave)
7. Submit
**Expected**: Leave request created, status = "Pending", manager notified  
**Priority**: P1

### TC-LEV-002: Half-Day Leave (Employee)
**Feature**: Leave Request  
**Role**: Employee  
**Preconditions**: Leave balance available  
**Steps**:
1. Apply leave, select single date
2. Check "Half Day" option
3. Select session (Morning/Afternoon)
4. Submit
**Expected**: 0.5 days deducted from balance  
**Priority**: P1

### TC-LEV-003: Leave Balance Check (Employee)
**Feature**: Leave Balance  
**Role**: Employee  
**Preconditions**: None  
**Steps**:
1. Navigate to `/leaves`
2. View "Leave Balance" card
**Expected**: Current balance visible per leave type (CL: 5, SL: 3, EL: 10)  
**Priority**: P1

### TC-LEV-004: Approve Leave (Manager)
**Feature**: Leave Approval  
**Role**: Manager  
**Preconditions**: Pending leave request from reportee  
**Steps**:
1. Navigate to `/leaves`
2. View "Pending Approvals" tab
3. Select leave request → Approve
4. Add remarks (optional)
5. Confirm
**Expected**: Leave approved, employee notified, calendar updated  
**Priority**: P1

### TC-LEV-005: Reject Leave (Manager)
**Feature**: Leave Approval  
**Role**: Manager  
**Preconditions**: Pending leave request  
**Steps**:
1. Select leave request → Reject
2. Add rejection reason
3. Confirm
**Expected**: Leave rejected, balance not deducted, employee notified  
**Priority**: P1

### TC-LEV-006: Cancel Pending Leave (Employee)
**Feature**: Leave Management  
**Role**: Employee  
**Preconditions**: Leave request pending  
**Steps**:
1. Navigate to `/leaves`
2. Select pending leave → Cancel
3. Confirm
**Expected**: Leave request cancelled, removed from manager's pending list  
**Priority**: P1

### TC-LEV-007: Cannot Cancel Approved Leave (Employee)
**Feature**: Leave Management  
**Role**: Employee  
**Preconditions**: Leave approved  
**Steps**:
1. Attempt to cancel approved leave
**Expected**: Cancel button disabled OR confirmation required with manager re-approval  
**Priority**: P2

### TC-LEV-008: View Leave Calendar (All Roles)
**Feature**: Leave Calendar  
**Role**: All  
**Preconditions**: Some leaves approved  
**Steps**:
1. Navigate to `/leave-calendar`
2. View monthly calendar
**Expected**: Own leaves + team leaves visible (color-coded by status)  
**Priority**: P2

### TC-LEV-009: Company Holidays (All Roles)
**Feature**: Company Calendar  
**Role**: All  
**Preconditions**: Holidays configured  
**Steps**:
1. Navigate to `/company-calendar`
2. View holiday list (2026)
**Expected**: All national + regional holidays visible with dates  
**Priority**: P2

### TC-LEV-010: Add Holiday (Admin)
**Feature**: Company Calendar  
**Role**: Admin  
**Preconditions**: Admin logged in  
**Steps**:
1. Navigate to `/company-calendar`
2. Click "Add Holiday"
3. Enter: Name="Republic Day", Date="2026-01-26", Type="National"
4. Save
**Expected**: Holiday added, visible to all employees  
**Priority**: P2

---

## 6. PAYROLL (P0)

### TC-PAY-001: Create Payroll Run (HR)
**Feature**: Payroll Run  
**Role**: HR, Admin  
**Preconditions**: Employees with salary structures assigned  
**Steps**:
1. Navigate to `/payroll/runs`
2. Click "Create Payroll Run"
3. Select month (June 2026)
4. Select cycle (Monthly)
5. System fetches working days from attendance
6. System calculates LWP, LOP
7. Preview payroll (employee-wise breakdown)
8. Click "Finalize Payroll"
**Expected**: Payroll run created, salary prep lines generated for all active employees  
**Priority**: P0

### TC-PAY-002: Lock Payroll (HR)
**Feature**: Payroll Run  
**Role**: HR  
**Preconditions**: Payroll run finalized  
**Steps**:
1. Select payroll run → Lock
2. Confirm
**Expected**: Payroll locked, no further edits allowed  
**Priority**: P0

### TC-PAY-003: Unlock Payroll (Admin)
**Feature**: Payroll Run  
**Role**: Admin (not HR)  
**Preconditions**: Payroll locked  
**Steps**:
1. Select payroll run → Unlock
2. Enter reason
3. Confirm
**Expected**: Payroll unlocked, editable again  
**Priority**: P1

### TC-PAY-004: View Payslip (Employee)
**Feature**: Payslip  
**Role**: Employee  
**Preconditions**: Payroll run completed  
**Steps**:
1. Navigate to `/payroll`
2. Select month (June 2026)
3. Click "View Payslip"
**Expected**: Payslip PDF opens with breakup (Earnings, Deductions, Net Pay, YTD)  
**Priority**: P0

### TC-PAY-005: Download Payslip (Employee)
**Feature**: Payslip  
**Role**: Employee  
**Preconditions**: Payslip available  
**Steps**:
1. View payslip
2. Click "Download PDF"
**Expected**: Payslip downloaded as PDF  
**Priority**: P1

### TC-PAY-006: Acknowledge Payslip (Employee)
**Feature**: Payslip  
**Role**: Employee  
**Preconditions**: Payslip not acknowledged  
**Steps**:
1. View payslip
2. Click "Acknowledge"
3. Confirm
**Expected**: Acknowledgment recorded, HR can track who acknowledged  
**Priority**: P1

### TC-PAY-007: Create Salary Structure (HR)
**Feature**: Salary Structure  
**Role**: HR, Admin  
**Preconditions**: None  
**Steps**:
1. Navigate to `/payroll/structures`
2. Click "Create Salary Structure"
3. Enter: Name="Agent L1", Effective Date="2026-01-01"
4. Add components: Basic (50%), HRA (20%), Conveyance (10%), Special (20%)
5. Set gross salary: ₹25,000
6. Save
**Expected**: Salary structure created, available for assignment  
**Priority**: P0

### TC-PAY-008: Assign Salary Structure (HR)
**Feature**: Salary Assignment  
**Role**: HR  
**Preconditions**: Salary structure exists, employee exists  
**Steps**:
1. Navigate to `/payroll/salary-assignments`
2. Select employee
3. Select salary structure
4. Set effective date (2026-06-01)
5. Assign
**Expected**: Salary structure assigned, used in next payroll run  
**Priority**: P0

### TC-PAY-009: Salary Revision (HR)
**Feature**: Salary Assignment  
**Role**: HR  
**Preconditions**: Employee has existing salary structure  
**Steps**:
1. Navigate to `/payroll/salary-assignments`
2. Select employee → Revise
3. Increase Basic from ₹12,500 to ₹15,000
4. Set effective date (2026-07-01)
5. Save
**Expected**: New salary structure assigned from July, old structure archived  
**Priority**: P1

### TC-PAY-010: Request Salary Advance (Employee)
**Feature**: Advances  
**Role**: Employee  
**Preconditions**: Eligible for advance  
**Steps**:
1. Navigate to `/payroll`
2. Click "Request Advance"
3. Enter amount: ₹5,000
4. Enter reason: "Medical emergency"
5. Select repayment months: 5
6. Submit
**Expected**: Advance request created, manager notified  
**Priority**: P1

### TC-PAY-011: Approve Advance (Manager)
**Feature**: Advances  
**Role**: Manager  
**Preconditions**: Pending advance request  
**Steps**:
1. Navigate to advance approval page
2. Review request → Approve
3. Confirm
**Expected**: Advance approved, HR processes advance  
**Priority**: P1

### TC-PAY-012: Process Advance (HR)
**Feature**: Advances  
**Role**: HR  
**Preconditions**: Advance approved by manager  
**Steps**:
1. Navigate to `/payroll/advances`
2. Select approved advance → Process
3. Mark paid (via NEFT/Cash)
4. System creates repayment schedule (₹1,000/month × 5 months)
**Expected**: Advance processed, auto-deduction starts from next payroll  
**Priority**: P1

### TC-PAY-013: PF ECR Export (HR)
**Feature**: Statutory Export  
**Role**: HR  
**Preconditions**: Payroll run completed  
**Steps**:
1. Navigate to `/payroll/runs/:id`
2. Click "Export PF ECR"
3. System generates ECR text file
4. Download
**Expected**: ECR file downloaded, format matches EPFO specification  
**Priority**: P0

### TC-PAY-014: ESIC Challan Export (HR)
**Feature**: Statutory Export  
**Role**: HR  
**Preconditions**: Payroll run completed  
**Steps**:
1. Click "Export ESIC Challan"
2. System generates ESIC CSV
3. Download
**Expected**: ESIC challan downloaded with employee-wise contribution  
**Priority**: P0

### TC-PAY-015: NEFT File Generation (HR)
**Feature**: Bank Transfer  
**Role**: HR  
**Preconditions**: Payroll run finalized  
**Steps**:
1. Click "Export NEFT File"
2. System generates NEFT CSV (columns: account_number, ifsc, amount, name)
3. Download
**Expected**: NEFT file ready for bank upload  
**Priority**: P0

### TC-PAY-016: PT Deduction (HR)
**Feature**: Professional Tax  
**Role**: HR  
**Preconditions**: PT slabs configured  
**Steps**:
1. Navigate to `/payroll/pt-slabs`
2. View state-wise PT slabs
3. Verify PT auto-deducted in payroll
**Expected**: PT deducted based on gross salary slab  
**Priority**: P1

### TC-PAY-017: TDS Declaration (Employee)
**Feature**: Tax Declaration  
**Role**: Employee  
**Preconditions**: None  
**Steps**:
1. Navigate to `/tax-declaration`
2. Select financial year (2026-27)
3. Declare investments: 80C (LIC: ₹50,000), 80D (Medical: ₹15,000), HRA (Rent: ₹60,000)
4. Upload proofs (PDF)
5. Submit
**Expected**: Declaration saved, HR can verify proofs  
**Priority**: P1

### TC-PAY-018: Verify Tax Proofs (HR)
**Feature**: Tax Declaration  
**Role**: HR  
**Preconditions**: Employee declared investments  
**Steps**:
1. Navigate to `/tax-declaration/:employeeId`
2. Review uploaded proofs
3. Verify each proof (Approved/Rejected)
4. If rejected, add remarks
5. Save
**Expected**: Verified proofs applied in TDS calculation  
**Priority**: P1

---

## 7. PERFORMANCE MANAGEMENT (P1)

### TC-PERF-001: Set Goals (Employee + Manager)
**Feature**: Goals & KRA  
**Role**: Employee, Manager  
**Preconditions**: Performance cycle active  
**Steps**:
1. Navigate to `/goals-appraisal`
2. Click "Set Goals"
3. Add goal: "Improve AHT to 300 seconds"
4. Assign weightage: 20%
5. Manager reviews + approves
**Expected**: Goal created, tracked quarterly  
**Priority**: P1

### TC-PERF-002: Self-Assessment (Employee)
**Feature**: Goals & KRA  
**Role**: Employee  
**Preconditions**: Quarter ended  
**Steps**:
1. Navigate to `/goals-appraisal`
2. Click "Self-Assessment"
3. Rate each goal (1-5)
4. Add comments
5. Submit
**Expected**: Self-assessment recorded, manager can review  
**Priority**: P1

### TC-PERF-003: Manager Assessment (Manager)
**Feature**: Goals & KRA  
**Role**: Manager  
**Preconditions**: Employee completed self-assessment  
**Steps**:
1. Navigate to `/goals-appraisal`
2. Select employee
3. Rate each goal (1-5)
4. Add coaching notes
5. Assign final rating (S/A/B/C/D)
6. Submit
**Expected**: Manager assessment recorded, performance review complete  
**Priority**: P1

### TC-PERF-004: View Performance History (Employee)
**Feature**: Performance Reviews  
**Role**: Employee  
**Preconditions**: Past reviews exist  
**Steps**:
1. Navigate to `/performance`
2. View review history (quarterly/annual)
**Expected**: Past reviews visible with ratings + manager comments  
**Priority**: P2

### TC-PERF-005: Give Feedback (All Roles)
**Feature**: Feedback  
**Role**: All  
**Preconditions**: None  
**Steps**:
1. Navigate to `/performance-feedback`
2. Click "Give Feedback"
3. Select recipient
4. Select type (Positive/Constructive)
5. Write feedback
6. Submit (Anonymous option available)
**Expected**: Feedback sent, recipient can view in inbox  
**Priority**: P2

---

## 8. QUALITY MANAGEMENT (P2)

### TC-QUAL-001: View Quality Dashboard (QA/Manager)
**Feature**: Quality Dashboard  
**Role**: QA, Manager  
**Preconditions**: Quality audits completed  
**Steps**:
1. Navigate to `/quality-dashboard`
2. View quality scores (employee-wise, team-wise)
3. View defect breakdown (Fatal, Critical, Major, Minor)
**Expected**: Dashboard shows quality metrics + trends  
**Priority**: P2

### TC-QUAL-002: Schedule Coaching (Manager)
**Feature**: Coaching  
**Role**: Manager  
**Preconditions**: Quality defect identified  
**Steps**:
1. Navigate to quality dashboard
2. Select employee with low score
3. Click "Schedule Coaching"
4. Set date, time
5. Attach audit recording
6. Add coaching notes
7. Assign action items
8. Save
**Expected**: Coaching session scheduled, employee notified  
**Priority**: P2

### TC-QUAL-003: TNI Identification (Manager/QA)
**Feature**: Training Needs  
**Role**: Manager, QA  
**Preconditions**: Quality audits show skill gaps  
**Steps**:
1. Navigate to TNI module
2. Identify skill gap (e.g., "Product knowledge weak")
3. Recommend training
4. Assign training
5. Track completion
**Expected**: TNI recorded, training assigned  
**Priority**: P2

---

## 9. ASSETS MANAGEMENT (P2)

### TC-ASSET-001: View Assigned Assets (Employee)
**Feature**: Asset Allocation  
**Role**: Employee  
**Preconditions**: Assets assigned  
**Steps**:
1. Navigate to `/assets`
2. View assigned assets
**Expected**: Own assets visible (laptop, phone, ID card) with serial numbers  
**Priority**: P2

### TC-ASSET-002: Allocate Asset (Admin/HR)
**Feature**: Asset Allocation  
**Role**: Admin, HR  
**Preconditions**: Asset available in inventory  
**Steps**:
1. Navigate to `/assets` (admin view)
2. Click "Allocate Asset"
3. Select employee
4. Select asset (Laptop - Dell Latitude, SN: DEL123)
5. Set allocation date
6. Save
**Expected**: Asset allocated, employee can view in their list  
**Priority**: P2

### TC-ASSET-003: Return Asset (HR)
**Feature**: Asset Allocation  
**Role**: HR  
**Preconditions**: Employee exiting, asset allocated  
**Steps**:
1. Navigate to `/assets`
2. Select employee's asset → Return
3. Check asset condition (Good/Fair/Damaged)
4. Set return date
5. Save
**Expected**: Asset marked as returned, status = "Available" for reallocation  
**Priority**: P2

---

## 10. EXIT MANAGEMENT (P1)

### TC-EXIT-001: Submit Resignation (Employee)
**Feature**: Resignation  
**Role**: Employee  
**Preconditions**: Employee logged in  
**Steps**:
1. Navigate to `/exit-management`
2. Click "Submit Resignation"
3. Select reason (Better Opportunity, Personal, etc.)
4. Set last working date (notice period: 30 days)
5. Upload resignation letter (PDF)
6. Submit
**Expected**: Resignation submitted, manager + HR notified  
**Priority**: P1

### TC-EXIT-002: Manager Acknowledgement (Manager)
**Feature**: Resignation  
**Role**: Manager  
**Preconditions**: Resignation submitted  
**Steps**:
1. Navigate to exit management
2. View pending resignation
3. Acknowledge resignation
4. Add remarks (optional)
5. Confirm
**Expected**: Resignation acknowledged, HR initiates exit process  
**Priority**: P1

### TC-EXIT-003: Exit Checklist (HR)
**Feature**: Exit Process  
**Role**: HR  
**Preconditions**: Resignation acknowledged  
**Steps**:
1. Navigate to `/exit-management`
2. View exit checklist for employee
3. Track tasks: Asset return, Handover, No-dues, Exit interview
4. Mark each task complete
**Expected**: Exit checklist tracked, tasks completed before relieving  
**Priority**: P1

### TC-EXIT-004: F&F Calculation (HR)
**Feature**: Full & Final  
**Role**: HR  
**Preconditions**: Employee exited  
**Steps**:
1. Navigate to F&F module
2. Select exited employee
3. System calculates: Pending salary (working days), Leave encashment, Bonus, Deductions (notice pay recovery)
4. Review calculation
5. Approve F&F
6. Generate NEFT file
**Expected**: F&F amount calculated, payment processed  
**Priority**: P1

### TC-EXIT-005: Relieving Letter (HR)
**Feature**: Exit Documents  
**Role**: HR  
**Preconditions**: Exit checklist complete, F&F processed  
**Steps**:
1. Navigate to exit management
2. Select employee → Generate Relieving Letter
3. System generates letter (template-based)
4. Download PDF
5. Send to employee email
**Expected**: Relieving letter generated + sent  
**Priority**: P2

---

## 11. CLIENT PORTAL (P2)

### TC-CLIENT-001: Client Login (OTP)
**Feature**: Client Authentication  
**Role**: Client  
**Preconditions**: Client email registered  
**Steps**:
1. Navigate to `/portal-login`
2. Enter email: `demo@mascallnet.com`
3. Click "Send OTP"
4. Check email, copy OTP
5. Enter OTP
6. Click "Verify"
**Expected**: OTP verified, redirected to `/portal` dashboard  
**Priority**: P2

### TC-CLIENT-002: Invalid OTP
**Feature**: Client Authentication  
**Role**: Client  
**Preconditions**: OTP requested  
**Steps**:
1. Enter wrong OTP
2. Click "Verify"
**Expected**: Error "Invalid OTP", stay on login page  
**Priority**: P2

### TC-CLIENT-003: View KPI Scorecards (Client)
**Feature**: Client KPI  
**Role**: Client  
**Preconditions**: Client logged in, process-scoped data exists  
**Steps**:
1. Navigate to `/portal/kpi`
2. View KPI cards (AHT, FCR, CSAT)
3. Verify ONLY assigned process data visible (not other clients' processes)
**Expected**: Process-scoped KPIs visible with target vs actual  
**Priority**: P2

### TC-CLIENT-004: Filter KPI by Date (Client)
**Feature**: Client KPI  
**Role**: Client  
**Preconditions**: Client logged in  
**Steps**:
1. Navigate to `/portal/kpi`
2. Select date range (Last 30 days)
3. View KPIs
**Expected**: KPIs filtered by date range  
**Priority**: P2

### TC-CLIENT-005: View Glidepath Chart (Client)
**Feature**: Glidepath  
**Role**: Client  
**Preconditions**: Client logged in  
**Steps**:
1. Navigate to `/portal/glidepath`
2. View committed vs target chart
**Expected**: Glidepath chart visible (line chart showing trend)  
**Priority**: P2

### TC-CLIENT-006: View Action Plans (Client)
**Feature**: Action Plans  
**Role**: Client  
**Preconditions**: Action items exist  
**Steps**:
1. Navigate to `/portal/action-plans`
2. View action items
3. Filter by status (Planned, In Progress, Done, Delayed)
**Expected**: Action items visible with status + due dates  
**Priority**: P2

### TC-CLIENT-007: Cannot See Employee Data (Client)
**Feature**: Data Isolation  
**Role**: Client  
**Preconditions**: Client logged in  
**Steps**:
1. Attempt to navigate to `/employees`
2. Attempt to call `/api/employees`
**Expected**: 403 Forbidden, cannot access employee data  
**Priority**: P0

---

## 12. COMMUNICATION MODULE (P2)

### TC-COMM-001: Create Email Template (HR)
**Feature**: Template Management  
**Role**: HR, Admin  
**Preconditions**: HR logged in  
**Steps**:
1. Navigate to `/communication/templates`
2. Click "Create Template"
3. Enter name: "Welcome Email"
4. Select category: "Onboarding"
5. Select channel: "Email"
6. Write template with Handlebars variables: "Welcome {{employee.name}} to {{company.name}}"
7. Preview with sample data
8. Save
**Expected**: Template created, available for dispatch  
**Priority**: P2

### TC-COMM-002: Send Message (HR)
**Feature**: Dispatch Center  
**Role**: HR  
**Preconditions**: Template exists  
**Steps**:
1. Navigate to `/communication/dispatch`
2. Select template: "Welcome Email"
3. Select recipients: All new joiners (last 7 days)
4. Select channel: Email
5. Preview message
6. Click "Send"
**Expected**: Messages sent, dispatch log created  
**Priority**: P2

### TC-COMM-003: Bulk Send (HR)
**Feature**: Dispatch Center  
**Role**: HR  
**Preconditions**: Template exists  
**Steps**:
1. Navigate to `/communication/dispatch`
2. Select template: "Payslip Notification"
3. Bulk filter: Branch = "Delhi", Department = "Operations"
4. Send
**Expected**: Messages sent to filtered employees only  
**Priority**: P2

### TC-COMM-004: View Dispatch History (HR)
**Feature**: Dispatch History  
**Role**: HR  
**Preconditions**: Messages sent  
**Steps**:
1. Navigate to `/communication/history`
2. View dispatch logs (date, template, channel, status)
3. Filter by status (Sent, Delivered, Failed)
**Expected**: All dispatch logs visible with status  
**Priority**: P2

### TC-COMM-005: Retry Failed Messages (HR)
**Feature**: Dispatch History  
**Role**: HR  
**Preconditions**: Some messages failed  
**Steps**:
1. Navigate to `/communication/history`
2. Filter status: Failed
3. Select failed messages → Retry
4. Confirm
**Expected**: Failed messages re-sent  
**Priority**: P2

### TC-COMM-006: Notification Preferences (Employee)
**Feature**: Preferences  
**Role**: Employee  
**Preconditions**: Employee logged in  
**Steps**:
1. Navigate to `/communication/preferences`
2. View categories (Onboarding, Payroll, Attendance, etc.)
3. For "Payroll" category: Enable Email, Disable SMS, Enable WhatsApp
4. Save
**Expected**: Preferences saved, future payroll notifications sent via Email + WhatsApp only  
**Priority**: P2

---

## 13. SYSTEM SETTINGS (P1)

### TC-SYS-001: Add Branch (Admin)
**Feature**: Branch Master  
**Role**: Admin  
**Preconditions**: Admin logged in  
**Steps**:
1. Navigate to `/org-masters`
2. Click "Branches" tab → Add
3. Enter: Code="DL01", Name="Delhi Office", Location="Connaught Place", GSTIN="07XXXXX"
4. Save
**Expected**: Branch created, available in employee form dropdowns  
**Priority**: P1

### TC-SYS-002: Edit Client (Admin)
**Feature**: Client Master  
**Role**: Admin  
**Preconditions**: Client exists  
**Steps**:
1. Navigate to `/org-masters` → Clients
2. Select client → Edit
3. Update contact number
4. Save
**Expected**: Client updated  
**Priority**: P1

### TC-SYS-003: Delete Process (Admin)
**Feature**: Process Master  
**Role**: Admin  
**Preconditions**: Process not assigned to any employee  
**Steps**:
1. Navigate to `/org-masters` → Processes
2. Select process → Delete
3. Confirm
**Expected**: Process deleted (or soft-deleted if in use)  
**Priority**: P2

### TC-SYS-004: System Settings Access (Admin Only)
**Feature**: System Settings  
**Role**: Admin  
**Preconditions**: Admin logged in  
**Steps**:
1. Navigate to `/settings`
**Expected**: Settings page loads  
**Priority**: P0

### TC-SYS-005: HR Cannot Access Settings
**Feature**: System Settings  
**Role**: HR  
**Preconditions**: HR logged in  
**Steps**:
1. Navigate to `/settings`
**Expected**: 403 Forbidden OR redirect to dashboard  
**Priority**: P0

---

## 14. REPORTS & ANALYTICS (P2)

### TC-REP-001: Generate Attendance Report (HR)
**Feature**: Reports  
**Role**: HR, Admin  
**Preconditions**: Attendance data exists  
**Steps**:
1. Navigate to `/reports`
2. Select "Attendance Report"
3. Select date range (June 2026)
4. Select branch (Delhi)
5. Generate
**Expected**: Report generated with working days, present days, absent days per employee  
**Priority**: P2

### TC-REP-002: Export Report (HR)
**Feature**: Reports  
**Role**: HR  
**Preconditions**: Report generated  
**Steps**:
1. Click "Export" → CSV
2. Download
**Expected**: Report exported as CSV file  
**Priority**: P2

---

## 15. DPDP COMPLIANCE (P2)

### TC-DPDP-001: View Consent Coverage (HR)
**Feature**: Consent Management  
**Role**: HR, Admin  
**Preconditions**: Consent records exist  
**Steps**:
1. Navigate to `/dpdp-compliance`
2. View consent coverage stats (80% consented)
**Expected**: Stats visible per consent category  
**Priority**: P2

### TC-DPDP-002: Data Access Request (Employee)
**Feature**: Data Rights  
**Role**: Employee  
**Preconditions**: Employee logged in  
**Steps**:
1. Navigate to data rights section
2. Click "Request My Data"
3. Submit
**Expected**: Request logged, HR notified to provide data export  
**Priority**: P2

### TC-DPDP-003: Data Erasure Request (Employee)
**Feature**: Data Rights  
**Role**: Employee  
**Preconditions**: Employee exited  
**Steps**:
1. Submit erasure request
2. HR reviews → Approve (after retention period)
**Expected**: Data deleted after retention period expires  
**Priority**: P2

---

## TEST EXECUTION SUMMARY TEMPLATE

```markdown
## Test Execution Log: [Date]

**Tester**: [Name]  
**Role Tested**: [Admin/HR/Manager/Employee/Client]  
**Environment**: [Local/Staging/Production]

| TC ID | Feature | Status | Notes | Severity |
|-------|---------|--------|-------|----------|
| TC-AUTH-001 | Login | PASS | - | - |
| TC-AUTH-002 | Invalid Login | PASS | - | - |
| TC-AUTH-003 | Forgot Password | FAIL | Email not sent | HIGH |
| TC-EMP-002 | Manager Team View | FAIL | Sees all employees | CRITICAL |
| ... | ... | ... | ... | ... |

**Issues Found**: 12  
**Critical**: 2  
**High**: 5  
**Medium**: 3  
**Low**: 2  

**Blockers**: [List any blockers preventing further testing]
```

---

## TOTAL TEST CASES

| Module | Test Cases | Priority |
|--------|-----------|----------|
| Authentication | 11 | P0 |
| ATS | 16 | P1 |
| Employee | 9 | P0 |
| Attendance | 14 | P0 |
| Leave | 10 | P1 |
| Payroll | 18 | P0 |
| Performance | 5 | P1 |
| Quality | 3 | P2 |
| Assets | 3 | P2 |
| Exit | 5 | P1 |
| Client Portal | 7 | P2 |
| Communication | 6 | P2 |
| System Settings | 5 | P1 |
| Reports | 2 | P2 |
| DPDP | 3 | P2 |
| **TOTAL** | **117** | - |

**Estimated Testing Time**: 10-12 days (full manual testing of all test cases)

---

**Next Steps**:
1. Execute P0 test cases first (Authentication, Employee, Attendance, Payroll)
2. Log all failures in issues tracker
3. Fix critical/high priority issues
4. Execute P1 test cases (ATS, Leave, Performance, Exit)
5. Execute P2 test cases (Quality, Assets, Portal, Reports)
