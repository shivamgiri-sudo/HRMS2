# Employee Role - E2E Test Matrix

**Document Version:** 1.0  
**Last Updated:** 2026-06-09  
**Demo Credentials:** employee@mascallnet.com / Employee@1  

---

## Overview

This document contains the complete test matrix for the Employee role, covering both frontend (Playwright) and backend (Vitest + supertest) tests. All test cases are designed to validate core employee workflows in the HRMS system.

### Test Infrastructure
- **E2E Framework:** Playwright (configured at `/home/shuvam/hrms1/playwright.config.ts`)
- **Backend Tests:** Vitest + supertest
- **Existing Tests:** `/home/shuvam/hrms1/e2e/smoke.smoke.ts`
- **Note:** Frontend requires addition of `data-testid` attributes for robust test automation

---

## 1. Auth & Login Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-AUTH-01 | Login Page | Validate login page loads correctly | Auto | None | 1. Navigate to `/auth`<br>2. Wait for page load | Login form displays with email, password fields and submit button | | Not Run | Add data-testid="login-form" |
| EMP-AUTH-02 | Login Page | Successful login with valid credentials | Auto | Valid employee account exists | 1. Navigate to `/auth`<br>2. Enter `employee@mascallnet.com`<br>3. Enter `Employee@1`<br>4. Click submit | Redirect to `/dashboard` with auth token set | | Not Run | API: POST /api/auth/login |
| EMP-AUTH-03 | Login Page | Failed login with invalid password | Auto | Valid employee account exists | 1. Navigate to `/auth`<br>2. Enter valid email<br>3. Enter wrong password<br>4. Click submit | Error message displayed, stay on login page | | Not Run | Verify error toast/message |
| EMP-AUTH-04 | Login Page | Failed login with non-existent email | Auto | None | 1. Navigate to `/auth`<br>2. Enter `nonexistent@test.com`<br>3. Enter any password<br>4. Click submit | Error message displayed | | Not Run | Generic error for security |
| EMP-AUTH-05 | Login Page | Validate email format validation | Auto | None | 1. Navigate to `/auth`<br>2. Enter invalid email format<br>3. Tab to next field | Inline validation error appears | | Not Run | Client-side validation |
| EMP-AUTH-06 | Login Page | Password field masking | Manual | None | 1. Navigate to `/auth`<br>2. Type in password field | Password characters are masked (dots/asterisks) | | Not Run | Visual check |
| EMP-AUTH-07 | Login Page | Demo login button functionality | Auto | Demo account configured | 1. Navigate to `/auth`<br>2. Click "Demo Login" button | Auto-fills credentials and logs in | | Not Run | Check demo login flow |
| EMP-AUTH-08 | Forgot Password | Navigate to forgot password | Auto | None | 1. Navigate to `/auth`<br>2. Click "Forgot Password" | Navigate to forgot password form | | Not Run | Route: `/auth` with forgot password view |
| EMP-AUTH-09 | Forgot Password | Submit forgot password with valid email | Auto | Valid employee account exists | 1. Navigate to forgot password<br>2. Enter `employee@mascallnet.com`<br>3. Submit | Success message: "Reset email sent" | | Not Run | API: POST /api/auth/forgot-password |
| EMP-AUTH-10 | Forgot Password | Submit forgot password with invalid email | Auto | None | 1. Enter invalid email<br>2. Submit | Generic success message (security) | | Not Run | Don't reveal if email exists |
| EMP-AUTH-11 | Reset Password | Reset password page loads | Auto | Valid reset token | 1. Navigate to `/reset-password?token=xxx` | Reset password form displays | | Not Run | Route: `/reset-password` |
| EMP-AUTH-12 | Reset Password | Successful password reset | Auto | Valid reset token | 1. Enter new password<br>2. Confirm new password<br>3. Submit | Success message, redirect to login | | Not Run | API: POST /api/auth/reset-password |
| EMP-AUTH-13 | Reset Password | Password mismatch validation | Auto | Valid reset token | 1. Enter new password<br>2. Enter different confirmation<br>3. Submit | Validation error displayed | | Not Run | Client-side validation |
| EMP-AUTH-14 | Reset Password | Weak password validation | Auto | Valid reset token | 1. Enter weak password (e.g., "123")<br>2. Submit | Validation error for password strength | | Not Run | Enforce password policy |
| EMP-AUTH-15 | Token Refresh | Automatic token refresh | Auto | User logged in, token near expiry | 1. Login<br>2. Wait for token expiry window<br>3. Perform action | Token refreshed seamlessly | | Not Run | API: POST /api/auth/refresh |
| EMP-AUTH-16 | Token Refresh | Failed refresh redirects to login | Auto | Refresh token expired | 1. Let both tokens expire<br>2. Attempt navigation | Redirect to `/auth` | | Not Run | Handle 401 gracefully |

---

## 2. Dashboard Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-DASH-01 | Dashboard | Dashboard loads for authenticated user | Auto | User logged in | 1. Login<br>2. Navigate to `/dashboard` | Dashboard displays with widgets | | Not Run | API: GET /api/access/me |
| EMP-DASH-02 | Dashboard | Unauthorized access redirects to login | Auto | User not logged in | 1. Clear cookies<br>2. Navigate to `/dashboard` | Redirect to `/auth` | | Not Run | Auth guard test |
| EMP-DASH-03 | Dashboard | Display employee info | Auto | User logged in | 1. Navigate to `/dashboard` | Employee name, role displayed correctly | | Not Run | Derived from /api/access/me |
| EMP-DASH-04 | Dashboard | Quick actions visible | Manual | User logged in | 1. Navigate to `/dashboard` | Clock in/out, apply leave buttons visible | | Not Run | Visual verification |
| EMP-DASH-05 | Dashboard | Attendance summary widget | Auto | User logged in | 1. Navigate to `/dashboard` | Attendance stats displayed | | Not Run | API: GET /api/wfm/attendance/daily |
| EMP-DASH-06 | Dashboard | Leave balance widget | Auto | User logged in | 1. Navigate to `/dashboard` | Leave balances displayed | | Not Run | API: GET /api/leave/balance/:employeeId |
| EMP-DASH-07 | Dashboard | Pending approvals widget | Auto | User logged in, has pending items | 1. Navigate to `/dashboard` | Pending items count displayed | | Not Run | From work inbox data |
| EMP-DASH-08 | Dashboard | Recent notifications | Auto | User logged in | 1. Navigate to `/dashboard` | Recent notifications displayed | | Not Run | Check notification component |
| EMP-DASH-09 | Dashboard | Navigation sidebar rendered | Auto | User logged in | 1. Navigate to `/dashboard` | Sidebar with all employee routes visible | | Not Run | Verify all menu items |
| EMP-DASH-10 | Dashboard | Responsive layout | Manual | User logged in | 1. Resize browser to mobile<br>2. Check layout | Mobile-friendly layout | | Not Run | Visual check at 375px |

---

## 3. Work Inbox Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-INBOX-01 | Work Inbox | Inbox page loads | Auto | User logged in | 1. Navigate to `/work-inbox` | Inbox displays with message list | | Not Run | API: GET /api/inbox |
| EMP-INBOX-02 | Work Inbox | Display inbox items | Auto | User logged in, has messages | 1. Navigate to `/work-inbox` | List of inbox messages displayed | | Not Run | Check message rendering |
| EMP-INBOX-03 | Work Inbox | Empty inbox state | Auto | User logged in, no messages | 1. Navigate to `/work-inbox` | Empty state message displayed | | Not Run | Check empty state UI |
| EMP-INBOX-04 | Work Inbox | Inbox item details | Auto | User logged in, has messages | 1. Click on inbox item | Item details/open action works | | Not Run | Navigation/link test |
| EMP-INBOX-05 | Work Inbox | Mark all as read | Auto | User logged in, has unread | 1. Click "Mark All Read"<br>2. Confirm | All items marked read, badge cleared | | Not Run | API: PATCH /api/inbox/mark-all-read |
| EMP-INBOX-06 | Work Inbox | Unread count badge | Auto | User logged in, has unread | 1. Check sidebar/dashboard | Unread count displayed | | Not Run | API: GET /api/inbox/count |
| EMP-INBOX-07 | Work Inbox | Pagination works | Auto | User logged in, many messages | 1. Navigate to page 2 | Next page of messages loads | | Not Run | Test pagination controls |
| EMP-INBOX-08 | Work Inbox | Filter by type | Auto | User logged in | 1. Select filter option | Filtered results displayed | | Not Run | If filter exists |
| EMP-INBOX-09 | Work Inbox | Real-time updates | Manual | User logged in | 1. Have admin send notification<br>2. Check inbox | New item appears without refresh | | Not Run | WebSocket/polling test |
| EMP-INBOX-10 | Work Inbox | Delete/archive item | Auto | User logged in, has messages | 1. Click delete/archive | Item removed from list | | Not Run | Check available actions |

---

## 4. Profile Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-PROF-01 | Profile | Profile page loads | Auto | User logged in | 1. Navigate to `/profile` | Profile displays with employee info | | Not Run | API: GET /api/employees/me |
| EMP-PROF-02 | Profile | Display personal information | Auto | User logged in | 1. Navigate to `/profile` | Name, email, phone, DOB displayed | | Not Run | Verify field mapping |
| EMP-PROF-03 | Profile | Display employment details | Auto | User logged in | 1. Navigate to `/profile` | Department, designation, manager displayed | | Not Run | From employee data |
| EMP-PROF-04 | Profile | Edit profile fields | Auto | User logged in | 1. Click Edit<br>2. Modify allowed fields<br>3. Save | Changes saved successfully | | Not Run | Check editable fields |
| EMP-PROF-05 | Profile | Profile picture display | Manual | User logged in, has photo | 1. Navigate to `/profile` | Profile picture displayed | | Not Run | Visual check |
| EMP-PROF-06 | Profile | Change password option | Auto | User logged in | 1. Navigate to `/profile`<br>2. Find change password | Change password form accessible | | Not Run | Security feature |
| EMP-PROF-07 | Profile | Address information | Auto | User logged in | 1. Navigate to `/profile` | Current and permanent address displayed | | Not Run | Address fields |
| EMP-PROF-08 | Profile | Emergency contact info | Auto | User logged in | 1. Navigate to `/profile` | Emergency contacts displayed | | Not Run | Check emergency section |
| EMP-PROF-09 | Profile | Bank details (read-only) | Auto | User logged in | 1. Navigate to `/profile` | Bank account info displayed | | Not Run | Usually read-only for employees |
| EMP-PROF-10 | Profile | Document attachments | Auto | User logged in, has docs | 1. Navigate to `/profile` | Attached documents listed | | Not Run | Document list component |

---

## 5. Attendance Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-ATT-01 | Attendance | Attendance page loads | Auto | User logged in | 1. Navigate to `/attendance` | Attendance view displays | | Not Run | Route: `/attendance` |
| EMP-ATT-02 | Attendance | Display current day status | Auto | User logged in | 1. Navigate to `/attendance` | Today's check-in/out status shown | | Not Run | API: GET /api/wfm/attendance/daily |
| EMP-ATT-03 | Attendance | Clock in functionality | Auto | User logged in, not clocked in | 1. Click "Clock In" | Success message, status updated | | Not Run | API: POST /api/wfm/sessions/clock-in |
| EMP-ATT-04 | Attendance | Clock out functionality | Auto | User logged in, clocked in | 1. Click "Clock Out" | Success message, status updated | | Not Run | API: POST /api/wfm/sessions/clock-out |
| EMP-ATT-05 | Attendance | Prevent double clock-in | Auto | User logged in, already clocked in | 1. Attempt to clock in again | Error/prevented action | | Not Run | State validation |
| EMP-ATT-06 | Attendance | Weekly attendance view | Auto | User logged in | 1. Navigate to weekly view | Weekly attendance displayed | | Not Run | Calendar/timeline view |
| EMP-ATT-07 | Attendance | Monthly attendance view | Auto | User logged in | 1. Switch to monthly view | Monthly calendar displayed | | Not Run | Check month navigation |
| EMP-ATT-08 | Attendance | Attendance statistics | Auto | User logged in | 1. Navigate to `/attendance` | Stats: present, absent, late days | | Not Run | Summary calculations |
| EMP-ATT-09 | Attendance | Working hours calculation | Auto | User logged in, has sessions | 1. Check attendance details | Accurate hours calculated | | Not Run | Time calculation logic |
| EMP-ATT-10 | Attendance | Late marking indicator | Auto | User logged in, was late | 1. Navigate to `/attendance` | Late days marked distinctly | | Not Run | Visual indicator test |
| EMP-ATT-11 | Attendance | GPS/Location capture | Manual | Location tracking enabled | 1. Clock in from mobile/desktop | Location captured (if required) | | Not Run | Location permission test |
| EMP-ATT-12 | Attendance | IP address capture | Auto | User logged in | 1. Clock in/out | IP logged in backend | | Not Run | Backend verification |

---

## 6. Attendance Regularization Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-REG-01 | Regularization | Regularization page loads | Auto | User logged in | 1. Navigate to `/attendance-regularization` | Page displays with request list | | Not Run | Route: `/attendance-regularization` |
| EMP-REG-02 | Regularization | Create new regularization request | Auto | User logged in | 1. Click "New Request"<br>2. Fill form<br>3. Submit | Request created successfully | | Not Run | API: POST /api/wfm/regularizations |
| EMP-REG-03 | Regularization | Select date for regularization | Auto | User logged in | 1. Open request form<br>2. Select date | Date picker works, past dates only | | Not Run | Date validation |
| EMP-REG-04 | Regularization | Select regularization type | Auto | User logged in | 1. Open request form<br>2. Select type | Types: forgot to punch, system issue, etc. | | Not Run | Dropdown test |
| EMP-REG-05 | Regularization | Enter check-in/out times | Auto | User logged in | 1. Enter times<br>2. Submit | Times validated and saved | | Not Run | Time input validation |
| EMP-REG-06 | Regularization | Add reason/remarks | Auto | User logged in | 1. Enter reason<br>2. Submit | Reason saved with request | | Not Run | Required field check |
| EMP-REG-07 | Regularization | View request status | Auto | User logged in, has requests | 1. Navigate to list | Status: Pending, Approved, Rejected | | Not Run | Status display |
| EMP-REG-08 | Regularization | Edit pending request | Auto | User logged in, has pending | 1. Click Edit<br>2. Modify<br>3. Save | Changes saved | | Not Run | Edit before approval |
| EMP-REG-09 | Regularization | Cannot edit approved request | Auto | User logged in, has approved | 1. Try to edit approved request | Edit option disabled | | Not Run | State-based permissions |
| EMP-REG-10 | Regularization | Cancel pending request | Auto | User logged in, has pending | 1. Click Cancel | Request cancelled | | Not Run | Cancel action |
| EMP-REG-11 | Regularization | File attachment support | Auto | User logged in | 1. Create request<br>2. Attach file | File uploaded and linked | | Not Run | If supported |
| EMP-REG-12 | Regularization | Manager notification | Manual | User logged in | 1. Submit request<br>2. Check manager inbox | Manager receives notification | | Not Run | End-to-end flow |

---

## 7. Leave Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-LEAVE-01 | Leave | Leaves page loads | Auto | User logged in | 1. Navigate to `/leaves` | Leave dashboard displays | | Not Run | Route: `/leaves` |
| EMP-LEAVE-02 | Leave | Display leave balance | Auto | User logged in | 1. Navigate to `/leaves` | Leave balances by type displayed | | Not Run | API: GET /api/leave/balance/:employeeId |
| EMP-LEAVE-03 | Leave | View leave types | Auto | User logged in | 1. Click "Apply Leave" | Available leave types listed | | Not Run | API: GET /api/leave/types |
| EMP-LEAVE-04 | Leave | Apply for full-day leave | Auto | User logged in, has balance | 1. Select type<br>2. Select dates<br>3. Add reason<br>4. Submit | Leave request created | | Not Run | API: POST /api/leave/requests |
| EMP-LEAVE-05 | Leave | Apply for half-day leave | Auto | User logged in, has balance | 1. Select half-day option<br>2. Select date & session<br>3. Submit | Half-day request created | | Not Run | Half-day logic |
| EMP-LEAVE-06 | Leave | Date range validation | Auto | User logged in | 1. Select end date before start | Validation error displayed | | Not Run | Date logic validation |
| EMP-LEAVE-07 | Leave | Insufficient balance check | Auto | User logged in, low balance | 1. Request more days than balance | Error/warning displayed | | Not Run | Balance validation |
| EMP-LEAVE-08 | Leave | View leave history | Auto | User logged in, has requests | 1. Navigate to history | Past leave requests listed | | Not Run | API: GET /api/leave/requests |
| EMP-LEAVE-09 | Leave | Cancel pending leave | Auto | User logged in, has pending | 1. Click Cancel | Leave cancelled successfully | | Not Run | Cancel pending request |
| EMP-LEAVE-10 | Leave | Cannot cancel approved leave | Auto | User logged in, has approved | 1. Try to cancel approved | Cancel option disabled | | Not Run | State check |
| EMP-LEAVE-11 | Leave | Leave request status tracking | Auto | User logged in, has requests | 1. Check request status | Shows: Pending, Approved, Rejected | | Not Run | Status workflow |
| EMP-LEAVE-12 | Leave | Attach supporting documents | Auto | User logged in | 1. Create request<br>2. Upload file | File attached to request | | Not Run | File upload test |
| EMP-LEAVE-13 | Leave | Comp-off leave application | Auto | User logged in, has comp-off | 1. Select comp-off type<br>2. Submit | Comp-off request created | | Not Run | Special leave type |
| EMP-LEAVE-14 | Leave | Leave calendar view | Auto | User logged in | 1. Switch to calendar view | Calendar with leave marked | | Not Run | Calendar component |
| EMP-LEAVE-15 | Leave | Future date restriction | Auto | User logged in | 1. Try to apply for past date | Past dates disabled | | Not Run | Date validation |

---

## 8. Roster Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-ROST-01 | Roster | My roster page loads | Auto | User logged in | 1. Navigate to `/my-roster` | Roster calendar displays | | Not Run | Route: `/my-roster` |
| EMP-ROST-02 | Roster | Display current month roster | Auto | User logged in | 1. Navigate to `/my-roster` | Current month shifts displayed | | Not Run | API: GET /api/wfm/roster/assignments |
| EMP-ROST-03 | Roster | Shift details visible | Auto | User logged in, has roster | 1. Click on shift date | Shift timing, type displayed | | Not Run | Shift info popup/card |
| EMP-ROST-04 | Roster | Week-off marking | Auto | User logged in | 1. View roster | Week-offs clearly marked | | Not Run | Visual indicator |
| EMP-ROST-05 | Roster | Holiday marking | Auto | User logged in | 1. View roster | Holidays marked distinctly | | Not Run | Holiday indicator |
| EMP-ROST-06 | Roster | Previous month navigation | Auto | User logged in | 1. Click previous month | Previous month roster loads | | Not Run | Month navigation |
| EMP-ROST-07 | Roster | Next month navigation | Auto | User logged in | 1. Click next month | Next month roster loads | | Not Run | Month navigation |
| EMP-ROST-08 | Roster | Shift swap request option | Auto | User logged in, swap enabled | 1. Select shift<br>2. Request swap | Swap request form opens | | Not Run | If feature enabled |
| EMP-ROST-09 | Roster | Multiple shift types | Auto | User logged in, has variety | 1. View roster | Different shifts: General, Night, etc. | | Not Run | Shift type display |
| EMP-ROST-10 | Roster | Roster notification | Manual | Roster published | 1. Wait for roster publish | Notification received | | Not Run | Push/email notification |

---

## 9. Payroll/Payslip Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-PAY-01 | Payslip | Payslips page loads | Auto | User logged in | 1. Navigate to `/payroll/payslips` | Payslip list displays | | Not Run | Route: `/payroll/payslips` |
| EMP-PAY-02 | Payslip | List of past payslips | Auto | User logged in, has history | 1. Navigate to payslips | Monthly payslips listed | | Not Run | Chronological list |
| EMP-PAY-03 | Payslip | View payslip details | Auto | User logged in, has payslip | 1. Click on payslip month | Detailed payslip displayed | | Not Run | API: GET /api/payroll/payslip/:runId/:employeeId |
| EMP-PAY-04 | Payslip | Payslip components | Auto | User logged in, viewing payslip | 1. View details | Earnings, deductions, net pay shown | | Not Run | Verify all sections |
| EMP-PAY-05 | Payslip | Download payslip PDF | Auto | User logged in, has payslip | 1. Click Download | PDF downloaded | | Not Run | Download functionality |
| EMP-PAY-06 | Payslip | Print payslip | Manual | User logged in, has payslip | 1. Click Print | Print dialog opens | | Not Run | Print media CSS |
| EMP-PAY-07 | Payslip | Year filter | Auto | User logged in, multi-year history | 1. Select different year | Filtered payslips shown | | Not Run | Year dropdown |
| EMP-PAY-08 | Payslip | Gross salary calculation | Auto | User logged in | 1. View payslip | Gross = Basic + Allowances | | Not Run | Calculation verification |
| EMP-PAY-09 | Payslip | Net salary calculation | Auto | User logged in | 1. View payslip | Net = Gross - Deductions | | Not Run | Calculation verification |
| EMP-PAY-10 | Payslip | Tax deductions (TDS) | Auto | User logged in | 1. View payslip | TDS amount displayed | | Not Run | Tax component |
| EMP-PAY-11 | Payslip | PF/ESI contributions | Auto | User logged in | 1. View payslip | Employer/employee contributions shown | | Not Run | Statutory deductions |
| EMP-PAY-12 | Payslip | Payslip password protection | Manual | User logged in | 1. Download PDF<br>2. Open | PDF requires password | | Not Run | Security feature |

---

## 10. Tax Declaration Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-TAX-01 | Tax | Tax declaration page loads | Auto | User logged in | 1. Navigate to `/payroll/tax-declaration` | Declaration form displays | | Not Run | Route: `/payroll/tax-declaration` |
| EMP-TAX-02 | Tax | View current year declaration | Auto | User logged in | 1. Navigate to tax page | Current FY declarations shown | | Not Run | API: GET /api/payroll/tax-declaration/:employeeId/:year |
| EMP-TAX-03 | Tax | Edit tax declaration | Auto | User logged in | 1. Click Edit<br>2. Update values<br>3. Save | Changes saved | | Not Run | API: POST /api/payroll/tax-declaration/:employeeId/:year |
| EMP-TAX-04 | Tax | Section 80C investments | Auto | User logged in | 1. Open declaration<br>2. Enter 80C amounts | 80C total calculated | | Not Run | Section-wise entry |
| EMP-TAX-05 | Tax | HRA declaration | Auto | User logged in | 1. Enter rent details | HRA exemption calculated | | Not Run | HRA section |
| EMP-TAX-06 | Tax | Medical insurance (80D) | Auto | User logged in | 1. Enter insurance premium | 80D amount captured | | Not Run | Health insurance |
| EMP-TAX-07 | Tax | Home loan interest | Auto | User logged in | 1. Enter interest amount | Section 24 deduction captured | | Not Run | Housing loan |
| EMP-TAX-08 | Tax | LTA declaration | Auto | User logged in | 1. Enter LTA details | LTA exemption tracked | | Not Run | Leave Travel |
| EMP-TAX-09 | Tax | Upload investment proofs | Auto | User logged in | 1. Upload document | File linked to declaration | | Not Run | Proof upload |
| EMP-TAX-10 | Tax | Declaration lock after deadline | Auto | User logged in, deadline passed | 1. Try to edit | Edit disabled with message | | Not Run | Deadline validation |
| EMP-TAX-11 | Tax | Projected tax calculation | Auto | User logged in | 1. View declaration | Projected tax shown | | Not Run | Calculation display |
| EMP-TAX-12 | Tax | Regime selection (Old/New) | Auto | User logged in | 1. Select tax regime | Regime preference saved | | Not Run | Tax regime choice |
| EMP-TAX-13 | Tax | Year-wise history | Auto | User logged in, multi-year | 1. Select previous year | Past declarations viewable | | Not Run | Historical data |
| EMP-TAX-14 | Tax | Declaration summary | Auto | User logged in | 1. View summary | Total deductions calculated | | Not Run | Summary calculation |

---

## 11. Helpdesk Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-HELP-01 | Helpdesk | Helpdesk page loads | Auto | User logged in | 1. Navigate to `/helpdesk` | Helpdesk dashboard displays | | Not Run | Route: `/helpdesk` |
| EMP-HELP-02 | Helpdesk | View my tickets | Auto | User logged in | 1. Navigate to helpdesk | List of my tickets shown | | Not Run | API: GET /api/helpdesk/tickets |
| EMP-HELP-03 | Helpdesk | Create new ticket | Auto | User logged in | 1. Click "New Ticket"<br>2. Fill form<br>3. Submit | Ticket created | | Not Run | API: POST /api/helpdesk/tickets |
| EMP-HELP-04 | Helpdesk | Select ticket category | Auto | User logged in | 1. Create ticket<br>2. Select category | Categories: IT, HR, Facilities, etc. | | Not Run | Category dropdown |
| EMP-HELP-05 | Helpdesk | Select priority | Auto | User logged in | 1. Create ticket<br>2. Set priority | Priority: Low, Medium, High, Urgent | | Not Run | Priority levels |
| EMP-HELP-06 | Helpdesk | Add ticket description | Auto | User logged in | 1. Enter description | Description saved | | Not Run | Rich text/plain text |
| EMP-HELP-07 | Helpdesk | Attach files to ticket | Auto | User logged in | 1. Create ticket<br>2. Upload files | Files attached | | Not Run | Multiple attachments |
| EMP-HELP-08 | Helpdesk | View ticket details | Auto | User logged in, has tickets | 1. Click on ticket | Full ticket details shown | | Not Run | Detail view |
| EMP-HELP-09 | Helpdesk | Ticket status tracking | Auto | User logged in, has tickets | 1. View ticket | Status: Open, In Progress, Resolved, Closed | | Not Run | Status workflow |
| EMP-HELP-10 | Helpdesk | Add comment/reply | Auto | User logged in, has ticket | 1. Add comment<br>2. Submit | Comment added to thread | | Not Run | Update API: POST |
| EMP-HELP-11 | Helpdesk | Close resolved ticket | Auto | User logged in, ticket resolved | 1. Click Close | Ticket status changed to Closed | | Not Run | Close action |
| EMP-HELP-12 | Helpdesk | Reopen closed ticket | Auto | User logged in, has closed | 1. Click Reopen | Ticket reopened | | Not Run | Reopen action |
| EMP-HELP-13 | Helpdesk | Search tickets | Auto | User logged in, many tickets | 1. Enter search term | Filtered results | | Not Run | Search functionality |
| EMP-HELP-14 | Helpdesk | Filter by status | Auto | User logged in | 1. Select status filter | Filtered ticket list | | Not Run | Filter component |
| EMP-HELP-15 | Helpdesk | SLA display | Auto | User logged in | 1. View ticket | SLA timer/status shown | | Not Run | If SLA enabled |

---

## 12. Assets Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-AST-01 | Assets | Assets page loads | Auto | User logged in | 1. Navigate to `/assets` | Assets list displays | | Not Run | Route: `/assets` |
| EMP-AST-02 | Assets | View assigned assets | Auto | User logged in, has assets | 1. Navigate to assets | List of assigned assets shown | | Not Run | API: GET /api/assets-mgmt/employee/:employeeId |
| EMP-AST-03 | Assets | Asset details display | Auto | User logged in, has assets | 1. Click on asset | Asset details: name, ID, date, status | | Not Run | Detail view |
| EMP-AST-04 | Assets | Asset type indication | Auto | User logged in, has assets | 1. View assets | Types: Laptop, Phone, etc. shown | | Not Run | Asset categorization |
| EMP-AST-05 | Assets | Asset status | Auto | User logged in | 1. View assets | Status: Assigned, Returned, etc. | | Not Run | Status field |
| EMP-AST-06 | Assets | Assignment date | Auto | User logged in, has assets | 1. View assets | Assignment date displayed | | Not Run | Date field |
| EMP-AST-07 | Assets | Empty state | Auto | User logged in, no assets | 1. Navigate to assets | "No assets assigned" message | | Not Run | Empty state |
| EMP-AST-08 | Assets | Request new asset | Auto | User logged in, feature enabled | 1. Click "Request Asset" | Request form opens | | Not Run | If self-service enabled |
| EMP-AST-09 | Assets | Return asset request | Auto | User logged in, has assets | 1. Click "Return" | Return request initiated | | Not Run | Return workflow |
| EMP-AST-10 | Assets | Asset history | Auto | User logged in, has history | 1. View asset history | Past assignments shown | | Not Run | Historical data |

---

## 13. Calendar & Notifications Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-CAL-01 | Calendar | Calendar page loads | Auto | User logged in | 1. Navigate to `/calendar` | Calendar view displays | | Not Run | Route: `/calendar` |
| EMP-CAL-02 | Calendar | Display month view | Auto | User logged in | 1. Navigate to calendar | Monthly calendar shown | | Not Run | Default view |
| EMP-CAL-03 | Calendar | Display week view | Auto | User logged in | 1. Switch to week view | Weekly calendar shown | | Not Run | View toggle |
| EMP-CAL-04 | Calendar | Display day view | Auto | User logged in | 1. Switch to day view | Daily schedule shown | | Not Run | View toggle |
| EMP-CAL-05 | Calendar | Show company holidays | Auto | User logged in | 1. View calendar | Holidays marked | | Not Run | API: GET /api/org/events |
| EMP-CAL-06 | Calendar | Show my leave | Auto | User logged in, has leave | 1. View calendar | Approved leave marked | | Not Run | Personal events |
| EMP-CAL-07 | Calendar | Show team events | Auto | User logged in | 1. View calendar | Team meetings/events shown | | Not Run | Team calendar |
| EMP-CAL-08 | Calendar | Navigate months | Auto | User logged in | 1. Click next/previous | Month changes | | Not Run | Navigation |
| EMP-NOTIF-01 | Notifications | Notification preferences page | Auto | User logged in | 1. Navigate to `/notification-preferences` | Preferences form displays | | Not Run | Route: `/notification-preferences` |
| EMP-NOTIF-02 | Notifications | Email notification toggle | Auto | User logged in | 1. Toggle email setting | Preference saved | | Not Run | Toggle component |
| EMP-NOTIF-03 | Notifications | Push notification toggle | Auto | User logged in | 1. Toggle push setting | Preference saved | | Not Run | Push permissions |
| EMP-NOTIF-04 | Notifications | SMS notification toggle | Auto | User logged in | 1. Toggle SMS setting | Preference saved | | Not Run | SMS preferences |
| EMP-NOTIF-05 | Notifications | Category-wise preferences | Auto | User logged in | 1. Expand categories | Per-category settings shown | | Not Run | Granular controls |
| EMP-NOTIF-06 | Notifications | Save preferences | Auto | User logged in | 1. Modify settings<br>2. Click Save | Settings persisted | | Not Run | Persistence test |
| EMP-NOTIF-07 | Notifications | Notification bell icon | Auto | User logged in | 1. Check header | Bell icon with count shown | | Not Run | Header component |
| EMP-NOTIF-08 | Notifications | View notification dropdown | Auto | User logged in | 1. Click bell icon | Dropdown with recent notifications | | Not Run | Dropdown panel |
| EMP-NOTIF-09 | Notifications | Mark notification as read | Auto | User logged in, has unread | 1. Click notification | Marked as read | | Not Run | Read status |
| EMP-NOTIF-10 | Notifications | Clear all notifications | Auto | User logged in | 1. Click "Clear All" | All notifications cleared | | Not Run | Bulk action |

---

## 14. LMS Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-LMS-01 | LMS | My Learning page loads | Auto | User logged in | 1. Navigate to `/lms/my-learning` | Learning dashboard displays | | Not Run | Route: `/lms/my-learning` |
| EMP-LMS-02 | LMS | Assigned courses list | Auto | User logged in, has assignments | 1. Navigate to my learning | Assigned courses shown | | Not Run | Assignment list |
| EMP-LMS-03 | LMS | Course progress display | Auto | User logged in, has courses | 1. View courses | Progress percentage shown | | Not Run | Progress bar |
| EMP-LMS-04 | LMS | Start course | Auto | User logged in, has course | 1. Click "Start/Continue" | Course content loads | | Not Run | Course player |
| EMP-LMS-05 | LMS | Course completion status | Auto | User logged in | 1. View courses | Status: Not Started, In Progress, Completed | | Not Run | Status badges |
| EMP-LMS-06 | LMS | Due date display | Auto | User logged in, has assignments | 1. View courses | Due dates shown | | Not Run | Date field |
| EMP-LMS-07 | LMS | Overdue indicator | Auto | User logged in, past due | 1. View courses | Overdue courses highlighted | | Not Run | Visual indicator |
| EMP-LMS-08 | LMS | Certificate download | Auto | User logged in, completed course | 1. Click certificate | Certificate downloaded | | Not Run | PDF generation |
| EMP-LMS-09 | LMS | Filter by status | Auto | User logged in | 1. Select status filter | Filtered course list | | Not Run | Filter component |
| EMP-LMS-10 | LMS | Search courses | Auto | User logged in | 1. Enter search term | Search results shown | | Not Run | Search functionality |

---

## 15. Goals & Performance Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-GOAL-01 | Goals | Goals page loads | Auto | User logged in | 1. Navigate to `/goals` | Goals dashboard displays | | Not Run | Route: `/goals` |
| EMP-GOAL-02 | Goals | View my goals | Auto | User logged in, has goals | 1. Navigate to goals | List of goals shown | | Not Run | API: GET /api/goals/goals |
| EMP-GOAL-03 | Goals | Goal details | Auto | User logged in, has goals | 1. Click on goal | Goal description, KPIs, timeline shown | | Not Run | Detail view |
| EMP-GOAL-04 | Goals | Goal status | Auto | User logged in | 1. View goals | Status: Draft, Approved, In Progress, etc. | | Not Run | Status field |
| EMP-GOAL-05 | Goals | Progress update | Auto | User logged in, has active goal | 1. Update progress % | Progress saved | | Not Run | Progress input |
| EMP-GOAL-06 | Goals | Add goal comment | Auto | User logged in, has goal | 1. Add comment | Comment saved | | Not Run | Comment thread |
| EMP-GOAL-07 | Goals | Goal weightage | Auto | User logged in | 1. View goals | Weightage % displayed | | Not Run | Weight field |
| EMP-PERF-01 | Performance | My Reports page loads | Auto | User logged in | 1. Navigate to `/performance-feedback/my-reports` | Reports list displays | | Not Run | Route: `/performance-feedback/my-reports` |
| EMP-PERF-02 | Performance | View performance reviews | Auto | User logged in, has reviews | 1. Navigate to my reports | Past reviews listed | | Not Run | Historical data |
| EMP-PERF-03 | Performance | Current review cycle | Auto | User logged in, active cycle | 1. View reports | Current cycle status shown | | Not Run | API: GET /api/performance-feedback/requests |
| EMP-PERF-04 | Performance | Self-assessment form | Auto | User logged in, review open | 1. Open self-assessment | Form displays questions | | Not Run | Assessment form |
| EMP-PERF-05 | Performance | Submit self-assessment | Auto | User logged in, review open | 1. Fill form<br>2. Submit | Assessment submitted | | Not Run | Form submission |
| EMP-PERF-06 | Performance | View manager feedback | Auto | User logged in, review complete | 1. View completed review | Manager feedback visible | | Not Run | Read-only view |
| EMP-PERF-07 | Performance | Ratings display | Auto | User logged in, review complete | 1. View review | Ratings per competency shown | | Not Run | Rating scale |
| EMP-DEV-01 | Development | Development Plan page | Auto | User logged in | 1. Navigate to `/performance-feedback/development-plan` | Plan page loads | | Not Run | Route: `/performance-feedback/development-plan` |
| EMP-DEV-02 | Development | View IDP | Auto | User logged in, has IDP | 1. View development plan | Individual development plan shown | | Not Run | IDP display |
| EMP-DEV-03 | Development | Add development goal | Auto | User logged in | 1. Click Add Goal | New goal form opens | | Not Run | Add action |
| EMP-DEV-04 | Development | Training recommendations | Auto | User logged in | 1. View plan | Recommended trainings listed | | Not Run | Recommendation engine |

---

## 16. Security & Authorization Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-SEC-01 | Auth | Access protected route without login | Auto | User not logged in | 1. Navigate to `/dashboard` | Redirect to `/auth` | | Not Run | Auth guard |
| EMP-SEC-02 | Auth | Access admin route as employee | Auto | User logged in as employee | 1. Navigate to admin route | 403 Forbidden or redirect | | Not Run | Role-based access |
| EMP-SEC-03 | Auth | Access manager route as employee | Auto | User logged in as employee | 1. Navigate to manager route | 403 Forbidden or redirect | | Not Run | Role-based access |
| EMP-SEC-04 | Auth | Token expiration handling | Auto | User logged in, token expired | 1. Wait for expiry<br>2. Perform action | Redirect to login or refresh | | Not Run | Token handling |
| EMP-SEC-05 | Auth | XSS prevention in forms | Auto | User logged in | 1. Enter `<script>alert(1)</script>` in form<br>2. Submit | Script sanitized/not executed | | Not Run | Input sanitization |
| EMP-SEC-06 | Auth | SQL injection prevention | Auto | User logged in | 1. Enter SQL in search/input<br>2. Submit | Query sanitized, no error | | Not Run | Parameterized queries |
| EMP-SEC-07 | Auth | Rate limiting on login | Auto | None | 1. Attempt 10+ failed logins rapidly | Rate limit error shown | | Not Run | API rate limiting |
| EMP-SEC-08 | Auth | Secure cookie attributes | Manual | User logged in | 1. Check cookie properties | HttpOnly, Secure, SameSite set | | Not Run | Cookie security |
| EMP-SEC-09 | Auth | Password strength requirements | Auto | User logged in | 1. Try weak password | Validation error shown | | Not Run | Password policy |
| EMP-SEC-10 | Auth | Session timeout | Auto | User logged in, inactive | 1. Leave idle for timeout period | Session expired message | | Not Run | Idle timeout |
| EMP-SEC-11 | Data | Cannot view other employee data | Auto | User logged in | 1. Try to access other employee ID in URL | 403 or generic error | | Not Run | Data isolation |
| EMP-SEC-12 | Data | Cannot modify other employee data | Auto | User logged in | 1. Try to submit form with other employee ID | Request rejected | | Not Run | Server-side validation |
| EMP-SEC-13 | Data | API authorization checks | Auto | User logged in | 1. Call API with spoofed employeeId | 403 Forbidden | | Not Run | Backend auth |
| EMP-SEC-14 | HTTPS | Secure connection required | Manual | None | 1. Access via HTTP | Redirect to HTTPS | | Not Run | SSL enforcement |
| EMP-SEC-15 | Headers | Security headers present | Auto | User logged in | 1. Check response headers | X-Frame-Options, CSP, etc. present | | Not Run | Security headers |

---

## 17. Logout Tests

| ID | Feature | Test Case | Type | Pre-conditions | Steps | Expected Result | Actual Result | Status | Notes |
|----|---------|-----------|------|----------------|-------|-----------------|---------------|--------|-------|
| EMP-LOGOUT-01 | Logout | Logout from header menu | Auto | User logged in | 1. Click user menu<br>2. Click Logout | Redirect to `/auth`, tokens cleared | | Not Run | API: POST /api/auth/logout |
| EMP-LOGOUT-02 | Logout | Session cleared after logout | Auto | User logged in | 1. Logout<br>2. Check localStorage/cookies | All auth data cleared | | Not Run | Cleanup verification |
| EMP-LOGOUT-03 | Logout | Cannot access protected routes after logout | Auto | User logged out | 1. Try to access `/dashboard` | Redirect to login | | Not Run | Post-logout auth |
| EMP-LOGOUT-04 | Logout | Backend session invalidated | Auto | User logged in | 1. Logout<br>2. Try API call with old token | 401 Unauthorized | | Not Run | Server-side invalidation |
| EMP-LOGOUT-05 | Logout | Logout from all devices | Auto | User logged in | 1. Click "Logout All Devices" | All sessions invalidated | | Not Run | If feature exists |
| EMP-LOGOUT-06 | Logout | Remember me handling | Auto | User logged in with Remember Me | 1. Logout<br>2. Close browser<br>3. Reopen | Still requires login | | Not Run | Remember me clear |

---

## Backend API Test Matrix

### Auth APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-AUTH-01 | /api/auth/login | POST | Valid credentials return tokens | Auto | 200 + access/refresh tokens |
| API-AUTH-02 | /api/auth/login | POST | Invalid credentials return error | Auto | 401 Unauthorized |
| API-AUTH-03 | /api/auth/login | POST | Missing fields return validation error | Auto | 400 Bad Request |
| API-AUTH-04 | /api/auth/login | POST | Rate limiting after attempts | Auto | 429 Too Many Requests |
| API-AUTH-05 | /api/auth/forgot-password | POST | Valid email sends reset link | Auto | 200 Success message |
| API-AUTH-06 | /api/auth/reset-password | POST | Valid token resets password | Auto | 200 Password updated |
| API-AUTH-07 | /api/auth/reset-password | POST | Invalid token returns error | Auto | 400 Invalid token |
| API-AUTH-08 | /api/auth/refresh | POST | Valid refresh token returns new access token | Auto | 200 New access token |
| API-AUTH-09 | /api/auth/refresh | POST | Invalid refresh token returns error | Auto | 401 Unauthorized |
| API-AUTH-10 | /api/auth/logout | POST | Valid token invalidates session | Auto | 200 Logged out |
| API-AUTH-11 | /api/auth/logout | POST | No token returns error | Auto | 401 Unauthorized |

### Employee APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-EMP-01 | /api/access/me | GET | Returns current user permissions | Auto | 200 User access data |
| API-EMP-02 | /api/access/me | GET | Without auth returns 401 | Auto | 401 Unauthorized |
| API-EMP-03 | /api/employees/me | GET | Returns current employee profile | Auto | 200 Employee data |
| API-EMP-04 | /api/employees/me | GET | Cannot access other employees | Auto | 403 Forbidden |

### Attendance APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-ATT-01 | /api/wfm/sessions/clock-in | POST | Clock in when not already clocked in | Auto | 200 Success + session |
| API-ATT-02 | /api/wfm/sessions/clock-in | POST | Prevent double clock-in | Auto | 400 Already clocked in |
| API-ATT-03 | /api/wfm/sessions/clock-out | POST | Clock out when clocked in | Auto | 200 Success |
| API-ATT-04 | /api/wfm/sessions/clock-out | POST | Prevent clock-out when not clocked in | Auto | 400 Not clocked in |
| API-ATT-05 | /api/wfm/attendance/daily | GET | Returns daily attendance summary | Auto | 200 Attendance data |

### Regularization APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-REG-01 | /api/wfm/regularizations | POST | Create regularization request | Auto | 201 Created |
| API-REG-02 | /api/wfm/regularizations | POST | Invalid data returns validation error | Auto | 400 Bad Request |

### Leave APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-LEAVE-01 | /api/leave/types | GET | Returns available leave types | Auto | 200 Leave types array |
| API-LEAVE-02 | /api/leave/requests | POST | Create leave request | Auto | 201 Created |
| API-LEAVE-03 | /api/leave/requests | POST | Exceeding balance returns error | Auto | 400 Insufficient balance |
| API-LEAVE-04 | /api/leave/requests | GET | Returns my leave requests | Auto | 200 Leave requests list |
| API-LEAVE-05 | /api/leave/balance/:employeeId | GET | Returns leave balance for employee | Auto | 200 Balance data |
| API-LEAVE-06 | /api/leave/balance/:employeeId | GET | Cannot view other employee balance | Auto | 403 Forbidden |

### Roster APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-ROST-01 | /api/wfm/roster/assignments | GET | Returns my roster assignments | Auto | 200 Roster data |

### Payroll APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-PAY-01 | /api/payroll/payslip/:runId/:employeeId | GET | Returns payslip details | Auto | 200 Payslip data |
| API-PAY-02 | /api/payroll/payslip/:runId/:employeeId | GET | Cannot view other employee payslip | Auto | 403 Forbidden |
| API-PAY-03 | /api/payroll/tax-declaration/:employeeId/:year | GET | Returns tax declaration | Auto | 200 Tax data |
| API-PAY-04 | /api/payroll/tax-declaration/:employeeId/:year | POST | Updates tax declaration | Auto | 200 Updated |
| API-PAY-05 | /api/payroll/tax-declaration/:employeeId/:year | POST | Cannot update other employee | Auto | 403 Forbidden |

### Helpdesk APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-HELP-01 | /api/helpdesk/tickets | GET | Returns my tickets | Auto | 200 Tickets list |
| API-HELP-02 | /api/helpdesk/tickets | POST | Creates new ticket | Auto | 201 Created |
| API-HELP-03 | /api/helpdesk/tickets | POST | Cannot create ticket for other employee | Auto | 403 Forbidden |

### Assets APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-AST-01 | /api/assets-mgmt/employee/:employeeId | GET | Returns my assigned assets | Auto | 200 Assets list |
| API-AST-02 | /api/assets-mgmt/employee/:employeeId | GET | Cannot view other employee assets | Auto | 403 Forbidden |

### Inbox APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-INBOX-01 | /api/inbox | GET | Returns my inbox messages | Auto | 200 Inbox items |
| API-INBOX-02 | /api/inbox/count | GET | Returns unread count | Auto | 200 Count number |
| API-INBOX-03 | /api/inbox/mark-all-read | PATCH | Marks all as read | Auto | 200 Success |

### Goals & Performance APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-GOAL-01 | /api/goals/goals | GET | Returns my goals | Auto | 200 Goals list |
| API-PERF-01 | /api/performance-feedback/requests | GET | Returns my performance requests | Auto | 200 Requests list |

### Organization APIs

| ID | Endpoint | Method | Test Case | Type | Expected Result |
|----|----------|--------|-----------|------|-----------------|
| API-ORG-01 | /api/org/events | GET | Returns organization events | Auto | 200 Events list |

---

## Test Data Requirements

### Employee Test Account
```
Email: employee@mascallnet.com
Password: Employee@1
Employee ID: [System assigned]
Department: [Any]
Manager: [Assigned]
```

### Required Test Data Setup
1. At least one past payslip for download testing
2. Approved leave for history testing
3. Assigned assets for asset view testing
4. Active goals for goal tracking
5. Past attendance data for reports
6. Pending inbox messages for notification testing
7. Active helpdesk tickets

---

## Implementation Notes

### Adding data-testid Attributes

For robust automation, add the following `data-testid` attributes to the frontend:

```html
<!-- Auth -->
data-testid="login-form"
data-testid="login-email-input"
data-testid="login-password-input"
data-testid="login-submit-button"
data-testid="forgot-password-link"
data-testid="demo-login-button"

<!-- Navigation -->
data-testid="sidebar-nav"
data-testid="nav-dashboard"
data-testid="nav-attendance"
data-testid="nav-leaves"
data-testid="nav-profile"
data-testid="logout-button"

<!-- Common -->
data-testid="page-header"
data-testid="submit-button"
data-testid="cancel-button"
data-testid="save-button"
data-testid="loading-spinner"
data-testid="error-message"
data-testid="success-toast"
```

### Playwright Test Pattern

```typescript
// Example test pattern for Employee flow
import { test, expect } from '@playwright/test';

test.describe('Employee Attendance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth');
    await page.fill('[data-testid="login-email-input"]', 'employee@mascallnet.com');
    await page.fill('[data-testid="login-password-input"]', 'Employee@1');
    await page.click('[data-testid="login-submit-button"]');
    await page.waitForURL('/dashboard');
  });

  test('EMP-ATT-03: Clock in functionality', async ({ page }) => {
    await page.goto('/attendance');
    await page.click('[data-testid="clock-in-button"]');
    await expect(page.locator('[data-testid="success-toast"]')).toContainText('Clocked in');
    await expect(page.locator('[data-testid="clock-status"]')).toContainText('Clocked In');
  });
});
```

### Backend Test Pattern

```typescript
// Example Vitest + supertest pattern
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('Employee Leave APIs', () => {
  it('API-LEAVE-02: Create leave request', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'employee@mascallnet.com', password: 'Employee@1' });
    
    const token = loginRes.body.accessToken;
    
    const res = await request(app)
      .post('/api/leave/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        typeId: 'annual-leave',
        startDate: '2026-06-15',
        endDate: '2026-06-16',
        reason: 'Personal work'
      });
    
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});
```

---

## Execution Checklist

### Pre-Test Setup
- [ ] Playwright configured and browsers installed
- [ ] Test database seeded with employee data
- [ ] Demo credentials confirmed working
- [ ] Backend test environment configured
- [ ] `data-testid` attributes added to critical components

### Test Execution Priority
1. **P0 - Critical:** EMP-AUTH-01 to EMP-AUTH-04 (Login flow)
2. **P0 - Critical:** EMP-SEC-01 to EMP-SEC-04 (Security)
3. **P1 - High:** All Dashboard, Attendance, Leave tests
4. **P2 - Medium:** Profile, Payroll, Helpdesk tests
5. **P3 - Low:** Calendar, LMS, Goals tests

### Sign-off Criteria
- All P0 tests passing
- 90% of P1 tests passing
- 80% of P2 tests passing
- No critical security vulnerabilities

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-06-09 | Test Team | Initial test matrix creation |

---

*End of Document*
