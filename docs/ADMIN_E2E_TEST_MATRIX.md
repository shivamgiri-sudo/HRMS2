# Admin E2E Test Matrix

## Document Information
- **Version**: 1.0.0
- **Date**: June 10, 2026
- **Purpose**: Comprehensive E2E test scenarios for Admin role security audit
- **Total Tests**: 150+ scenarios

---

## Test Matrix Columns

| Column | Description |
|--------|-------------|
| **Test ID** | Unique identifier for the test case |
| **Module** | Functional module being tested |
| **Journey Step** | Specific step in the user journey |
| **Admin Type** | Type of admin executing the test (Global / Branch / Multi-branch / No-scope) |
| **Test Action** | Specific action being performed |
| **Expected Result** | Expected outcome of the test |
| **Security Check** | Security validation being performed |
| **Frontend Test File** | Playwright/Cypress test file path |
| **Backend Test File** | Jest/PHPUnit API test file path |
| **Status** | Current test status (Pending/Pass/Fail) |
| **Notes** | Additional context or findings |

---

## 1. Login & Access Context (10 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| AUTH-001 | Auth | Login | Global Admin | Login with valid credentials | JWT token returned with scope_type="all" | Token contains correct scope | `tests/e2e/auth/login.spec.ts` | `tests/api/auth/login.test.ts` | Pending | |
| AUTH-002 | Auth | Login | Branch Admin | Login with valid credentials | JWT token returned with branch scope | Token contains branch_id | `tests/e2e/auth/login.spec.ts` | `tests/api/auth/login.test.ts` | Pending | |
| AUTH-003 | Auth | Login | Multi-Branch Admin | Login with valid credentials | JWT token returned with multiple branches | Token contains branch array | `tests/e2e/auth/login.spec.ts` | `tests/api/auth/login.test.ts` | Pending | |
| AUTH-004 | Auth | Login | No-Scope Admin | Login with valid credentials | JWT token returned with empty scope | Token has no scope assignments | `tests/e2e/auth/login.spec.ts` | `tests/api/auth/login.test.ts` | Pending | |
| AUTH-005 | Auth | Access Context | Global Admin | Load user context after login | Can access all branches | Global scope verified | `tests/e2e/auth/context.spec.ts` | `tests/api/auth/me.test.ts` | Pending | |
| AUTH-006 | Auth | Access Context | Branch Admin | Load user context after login | Can access only assigned branch | Branch scope enforced | `tests/e2e/auth/context.spec.ts` | `tests/api/auth/me.test.ts` | Pending | |
| AUTH-007 | Auth | Access Context | Multi-Branch Admin | Load user context after login | Can access all assigned branches | Multi-branch scope verified | `tests/e2e/auth/context.spec.ts` | `tests/api/auth/me.test.ts` | Pending | |
| AUTH-008 | Auth | Token Refresh | All Admin Types | Refresh JWT before expiry | New token with same scope | Scope preserved in refresh | `tests/e2e/auth/refresh.spec.ts` | `tests/api/auth/refresh.test.ts` | Pending | |
| AUTH-009 | Auth | Invalid Credentials | All Admin Types | Login with wrong password | 401 Unauthorized | No token returned | `tests/e2e/auth/login.spec.ts` | `tests/api/auth/login.test.ts` | Pending | |
| AUTH-010 | Auth | Session Expiry | All Admin Types | Access with expired token | 401 Token expired | Session properly invalidated | `tests/e2e/auth/session.spec.ts` | `tests/api/auth/verify.test.ts` | Pending | |

---

## 2. Dashboard (8 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| DASH-001 | Dashboard | View KPI Cards | Global Admin | View dashboard KPIs | Shows counts for all branches | Global scope applied | `tests/e2e/dashboard/view.spec.ts` | `tests/api/dashboard/kpis.test.ts` | Pending | |
| DASH-002 | Dashboard | View KPI Cards | Branch Admin | View dashboard KPIs | Shows counts for assigned branch only | Branch scope applied | `tests/e2e/dashboard/view.spec.ts` | `tests/api/dashboard/kpis.test.ts` | Pending | |
| DASH-003 | Dashboard | View KPI Cards | Multi-Branch Admin | View dashboard KPIs | Shows counts for assigned branches | Multi-branch scope applied | `tests/e2e/dashboard/view.spec.ts` | `tests/api/dashboard/kpis.test.ts` | Pending | |
| DASH-004 | Dashboard | KPI Drilldown | Global Admin | Click on employee count KPI | Drilldown shows all employees | Scope matches KPI | `tests/e2e/dashboard/drilldown.spec.ts` | `tests/api/dashboard/details.test.ts` | Pending | |
| DASH-005 | Dashboard | KPI Drilldown | Branch Admin | Click on employee count KPI | Drilldown shows only branch employees | Scope matches KPI | `tests/e2e/dashboard/drilldown.spec.ts` | `tests/api/dashboard/details.test.ts` | Pending | |
| DASH-006 | Dashboard | Branch Filter | Branch Admin | Change branch filter | Filter shows only accessible branches | Branch list scoped | `tests/e2e/dashboard/filter.spec.ts` | `tests/api/branches/list.test.ts` | Pending | |
| DASH-007 | Dashboard | Widget Access | No-Scope Admin | Attempt to view dashboard | Shows empty state or limited widgets | Default deny applied | `tests/e2e/dashboard/access.spec.ts` | `tests/api/dashboard/kpis.test.ts` | Pending | |
| DASH-008 | Dashboard | Data Refresh | Branch Admin | Refresh dashboard data | Data stays within branch scope | Scope preserved on refresh | `tests/e2e/dashboard/refresh.spec.ts` | `tests/api/dashboard/kpis.test.ts` | Pending | |

---

## 3. Employees (15 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| EMP-001 | Employee | List Employees | Global Admin | View employee list | Shows all employees | buildScopeWhereClause | `tests/e2e/employees/list.spec.ts` | `tests/api/employees/list.test.ts` | Pending | |
| EMP-002 | Employee | List Employees | Branch Admin | View employee list | Shows only branch employees | Branch scope enforced | `tests/e2e/employees/list.spec.ts` | `tests/api/employees/list.test.ts` | Pending | |
| EMP-003 | Employee | List Employees | Multi-Branch Admin | View employee list | Shows multi-branch employees | Multi-branch scope enforced | `tests/e2e/employees/list.spec.ts` | `tests/api/employees/list.test.ts` | Pending | |
| EMP-004 | Employee | Search Employees | Branch Admin | Search by name | Results filtered by branch | Search respects scope | `tests/e2e/employees/search.spec.ts` | `tests/api/employees/search.test.ts` | Pending | |
| EMP-005 | Employee | Employee Detail | Global Admin | View any employee | Can view all employee details | hasScopedAccess check | `tests/e2e/employees/detail.spec.ts` | `tests/api/employees/detail.test.ts` | Pending | |
| EMP-006 | Employee | Employee Detail | Branch Admin | View same-branch employee | Can view employee details | hasScopedAccess allows | `tests/e2e/employees/detail.spec.ts` | `tests/api/employees/detail.test.ts` | Pending | |
| EMP-007 | Employee | Employee Detail | Branch Admin | View cross-branch employee | 403 Access Denied | hasScopedAccess blocks | `tests/e2e/employees/detail.spec.ts` | `tests/api/employees/detail.test.ts` | Pending | Critical |
| EMP-008 | Employee | Create Employee | Branch Admin | Create in assigned branch | Employee created successfully | Branch validation passed | `tests/e2e/employees/create.spec.ts` | `tests/api/employees/create.test.ts` | Pending | |
| EMP-009 | Employee | Create Employee | Branch Admin | Create in other branch | 403 Cannot create in branch | Branch validation failed | `tests/e2e/employees/create.spec.ts` | `tests/api/employees/create.test.ts` | Pending | Critical |
| EMP-010 | Employee | Update Employee | Branch Admin | Update same-branch employee | Update successful | hasScopedAccess + validation | `tests/e2e/employees/update.spec.ts` | `tests/api/employees/update.test.ts` | Pending | |
| EMP-011 | Employee | Update Employee | Branch Admin | Update cross-branch employee | 403 Access Denied | hasScopedAccess blocks | `tests/e2e/employees/update.spec.ts` | `tests/api/employees/update.test.ts` | Pending | Critical |
| EMP-012 | Employee | Update Employee | Branch Admin | Transfer to other branch | 403 Cannot transfer | Target branch validation | `tests/e2e/employees/transfer.spec.ts` | `tests/api/employees/update.test.ts` | Pending | Critical |
| EMP-013 | Employee | Export Employees | Branch Admin | Export employee list | Export contains only branch data | Export scope enforced | `tests/e2e/employees/export.spec.ts` | `tests/api/employees/export.test.ts` | Pending | |
| EMP-014 | Employee | Bulk Operations | Branch Admin | Bulk update employees | Only branch employees affected | Bulk scope enforced | `tests/e2e/employees/bulk.spec.ts` | `tests/api/employees/bulk.test.ts` | Pending | |
| EMP-015 | Employee | List Employees | No-Scope Admin | View employee list | Empty list or 403 | Default deny enforced | `tests/e2e/employees/list.spec.ts` | `tests/api/employees/list.test.ts` | Pending | |

---

## 4. Onboarding (10 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| ONB-001 | Onboarding | List Requests | Branch Admin | View onboarding list | Shows branch onboarding only | Scope enforced | `tests/e2e/onboarding/list.spec.ts` | `tests/api/onboarding/list.test.ts` | Pending | |
| ONB-002 | Onboarding | View Detail | Branch Admin | View onboarding request | Can view branch requests | hasScopedAccess | `tests/e2e/onboarding/detail.spec.ts` | `tests/api/onboarding/detail.test.ts` | Pending | |
| ONB-003 | Onboarding | View Detail | Branch Admin | View cross-branch request | 403 Access Denied | Scope blocks access | `tests/e2e/onboarding/detail.spec.ts` | `tests/api/onboarding/detail.test.ts` | Pending | |
| ONB-004 | Onboarding | Create Request | Branch Admin | Create for branch | Request created successfully | Branch validation | `tests/e2e/onboarding/create.spec.ts` | `tests/api/onboarding/create.test.ts` | Pending | |
| ONB-005 | Onboarding | Create Request | Branch Admin | Create for other branch | 403 Invalid branch | Branch validation fails | `tests/e2e/onboarding/create.spec.ts` | `tests/api/onboarding/create.test.ts` | Pending | |
| ONB-006 | Onboarding | View Tasks | Branch Admin | View onboarding tasks | Shows branch tasks only | Task scope enforced | `tests/e2e/onboarding/tasks.spec.ts` | `tests/api/onboarding/tasks.test.ts` | Pending | |
| ONB-007 | Onboarding | Update Task | Branch Admin | Complete onboarding task | Task updated | hasScopedAccess | `tests/e2e/onboarding/tasks.spec.ts` | `tests/api/onboarding/tasks.test.ts` | Pending | |
| ONB-008 | Onboarding | Provisioning | Branch Admin | View provisioning tasks | Branch tasks only | Provisioning scope | `tests/e2e/onboarding/provisioning.spec.ts` | `tests/api/onboarding/provisioning.test.ts` | Pending | |
| ONB-009 | Onboarding | Export | Branch Admin | Export onboarding data | Branch data only | Export scope | `tests/e2e/onboarding/export.spec.ts` | `tests/api/onboarding/export.test.ts` | Pending | |
| ONB-010 | Onboarding | Progress Tracking | Branch Admin | View progress dashboard | Branch progress only | KPI scope | `tests/e2e/onboarding/progress.spec.ts` | `tests/api/onboarding/progress.test.ts` | Pending | |

---

## 5. Movement (8 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| MOV-001 | Movement | List Movements | Branch Admin | View movement list | Shows branch movements | Scope enforced | `tests/e2e/movement/list.spec.ts` | `tests/api/movement/list.test.ts` | Pending | |
| MOV-002 | Movement | Create Transfer | Branch Admin | Transfer within branch | Transfer created | Source validation | `tests/e2e/movement/create.spec.ts` | `tests/api/movement/create.test.ts` | Pending | |
| MOV-003 | Movement | Create Transfer | Branch Admin | Transfer to other branch | 403 Invalid target | Target validation | `tests/e2e/movement/create.spec.ts` | `tests/api/movement/create.test.ts` | Pending | Critical |
| MOV-004 | Movement | Create Transfer | Multi-Branch Admin | Transfer between assigned branches | Transfer created | Both branches validated | `tests/e2e/movement/create.spec.ts` | `tests/api/movement/create.test.ts` | Pending | |
| MOV-005 | Movement | Approve Movement | Branch Admin | Approve movement | Approval successful | hasScopedAccess | `tests/e2e/movement/approve.spec.ts` | `tests/api/movement/approve.test.ts` | Pending | |
| MOV-006 | Movement | Cost Centre Change | Branch Admin | Change cost centre | Change successful | Branch validation | `tests/e2e/movement/cost-centre.spec.ts` | `tests/api/movement/cost-centre.test.ts` | Pending | |
| MOV-007 | Movement | View History | Branch Admin | View movement history | Branch history only | History scope | `tests/e2e/movement/history.spec.ts` | `tests/api/movement/history.test.ts` | Pending | |
| MOV-008 | Movement | Export | Branch Admin | Export movements | Branch data only | Export scope | `tests/e2e/movement/export.spec.ts` | `tests/api/movement/export.test.ts` | Pending | |

---

## 6. Attendance (10 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| ATT-001 | Attendance | List Records | Branch Admin | View attendance | Shows branch employees | Scope via employee | `tests/e2e/attendance/list.spec.ts` | `tests/api/attendance/list.test.ts` | Pending | |
| ATT-002 | Attendance | View Detail | Branch Admin | View attendance record | Can view branch records | hasScopedAccess | `tests/e2e/attendance/detail.spec.ts` | `tests/api/attendance/detail.test.ts` | Pending | |
| ATT-003 | Attendance | Regularization List | Branch Admin | View regularization requests | Branch requests only | Scope enforced | `tests/e2e/attendance/regularization.spec.ts` | `tests/api/attendance/regularization.test.ts` | Pending | |
| ATT-004 | Attendance | Approve Regularization | Branch Admin | Approve request | Approval successful | hasScopedAccess | `tests/e2e/attendance/regularization.spec.ts` | `tests/api/attendance/regularization.test.ts` | Pending | |
| ATT-005 | Attendance | Biometric Logs | Branch Admin | View biometric logs | Branch logs only | Scope enforced | `tests/e2e/attendance/biometric.spec.ts` | `tests/api/attendance/biometric.test.ts` | Pending | |
| ATT-006 | Attendance | Shift Assignment | Branch Admin | Assign shifts | Branch employees only | Scope enforced | `tests/e2e/attendance/shifts.spec.ts` | `tests/api/attendance/shifts.test.ts` | Pending | |
| ATT-007 | Attendance | Attendance Policy | Branch Admin | View branch policy | Branch policy shown | Policy scope | `tests/e2e/attendance/policy.spec.ts` | `tests/api/attendance/policy.test.ts` | Pending | |
| ATT-008 | Attendance | Summary Report | Branch Admin | View summary | Branch summary only | KPI scope | `tests/e2e/attendance/summary.spec.ts` | `tests/api/attendance/summary.test.ts` | Pending | |
| ATT-009 | Attendance | Export | Branch Admin | Export attendance | Branch data only | Export scope | `tests/e2e/attendance/export.spec.ts` | `tests/api/attendance/export.test.ts` | Pending | |
| ATT-010 | Attendance | Absenteeism Report | Branch Admin | View report | Branch data only | Report scope | `tests/e2e/attendance/reports.spec.ts` | `tests/api/attendance/reports.test.ts` | Pending | |

---

## 7. Leave (10 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| LEAV-001 | Leave | List Requests | Branch Admin | View leave requests | Branch requests only | Scope enforced | `tests/e2e/leave/list.spec.ts` | `tests/api/leave/list.test.ts` | Pending | |
| LEAV-002 | Leave | View Calendar | Branch Admin | View leave calendar | Branch employees only | Calendar scope | `tests/e2e/leave/calendar.spec.ts` | `tests/api/leave/calendar.test.ts` | Pending | |
| LEAV-003 | Leave | Approve Request | Branch Admin | Approve leave | Approval successful | hasScopedAccess | `tests/e2e/leave/approve.spec.ts` | `tests/api/leave/approve.test.ts` | Pending | |
| LEAV-004 | Leave | View Balance | Branch Admin | View leave balance | Branch employees only | Balance scope | `tests/e2e/leave/balance.spec.ts` | `tests/api/leave/balance.test.ts` | Pending | |
| LEAV-005 | Leave | Leave Policy | Branch Admin | View branch policy | Branch policy shown | Policy scope | `tests/e2e/leave/policy.spec.ts` | `tests/api/leave/policy.test.ts` | Pending | |
| LEAV-006 | Leave | Leave Types | Branch Admin | View leave types | Branch types only | Type scope | `tests/e2e/leave/types.spec.ts` | `tests/api/leave/types.test.ts` | Pending | |
| LEAV-007 | Leave | Comp-off Requests | Branch Admin | View comp-off requests | Branch requests only | Scope enforced | `tests/e2e/leave/compoff.spec.ts` | `tests/api/leave/compoff.test.ts` | Pending | |
| LEAV-008 | Leave | Leave Analytics | Branch Admin | View analytics | Branch analytics only | Analytics scope | `tests/e2e/leave/analytics.spec.ts` | `tests/api/leave/analytics.test.ts` | Pending | |
| LEAV-009 | Leave | Utilization Report | Branch Admin | View utilization | Branch data only | Report scope | `tests/e2e/leave/utilization.spec.ts` | `tests/api/leave/utilization.test.ts` | Pending | |
| LEAV-010 | Leave | Export | Branch Admin | Export leave data | Branch data only | Export scope | `tests/e2e/leave/export.spec.ts` | `tests/api/leave/export.test.ts` | Pending | |

---

## 8. Roster/WFM (10 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| WFM-001 | WFM | List Roster Plans | Branch Admin | View roster plans | Branch plans only | Scope enforced | `tests/e2e/wfm/list.spec.ts` | `tests/api/wfm/list.test.ts` | Pending | |
| WFM-002 | WFM | View Roster Detail | Branch Admin | View roster assignments | Branch assignments | hasScopedAccess | `tests/e2e/wfm/detail.spec.ts` | `tests/api/wfm/detail.test.ts` | Pending | |
| WFM-003 | WFM | Create Roster | Branch Admin | Create roster plan | Created for branch | Branch validation | `tests/e2e/wfm/create.spec.ts` | `tests/api/wfm/create.test.ts` | Pending | |
| WFM-004 | WFM | Update Roster | Branch Admin | Update roster plan | Update successful | hasScopedAccess | `tests/e2e/wfm/update.spec.ts` | `tests/api/wfm/update.test.ts` | Pending | |
| WFM-005 | WFM | Shift Templates | Branch Admin | View shift templates | Branch templates | Scope enforced | `tests/e2e/wfm/templates.spec.ts` | `tests/api/wfm/templates.test.ts` | Pending | |
| WFM-006 | WFM | Shift Swap | Branch Admin | View shift swaps | Branch swaps only | Swap scope | `tests/e2e/wfm/swaps.spec.ts` | `tests/api/wfm/swaps.test.ts` | Pending | |
| WFM-007 | WFM | Coverage Report | Branch Admin | View coverage | Branch coverage | KPI scope | `tests/e2e/wfm/coverage.spec.ts` | `tests/api/wfm/coverage.test.ts` | Pending | |
| WFM-008 | WFM | Adherence Report | Branch Admin | View adherence | Branch adherence | Report scope | `tests/e2e/wfm/adherence.spec.ts` | `tests/api/wfm/adherence.test.ts` | Pending | |
| WFM-009 | WFM | Export Roster | Branch Admin | Export roster | Branch data only | Export scope | `tests/e2e/wfm/export.spec.ts` | `tests/api/wfm/export.test.ts` | Pending | |
| WFM-010 | WFM | Roster Approval | Branch Admin | Approve roster | Approval successful | hasScopedAccess | `tests/e2e/wfm/approve.spec.ts` | `tests/api/wfm/approve.test.ts` | Pending | |

---

## 9. ATS (10 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| ATS-001 | ATS | List Job Openings | Branch Admin | View job openings | Branch openings only | Scope enforced | `tests/e2e/ats/jobs.spec.ts` | `tests/api/ats/jobs.test.ts` | Pending | |
| ATS-002 | ATS | Create Job Opening | Branch Admin | Create job posting | Created for branch | Branch validation | `tests/e2e/ats/jobs.spec.ts` | `tests/api/ats/jobs.test.ts` | Pending | |
| ATS-003 | ATS | List Candidates | Branch Admin | View candidates | Branch candidates | Scope enforced | `tests/e2e/ats/candidates.spec.ts` | `tests/api/ats/candidates.test.ts` | Pending | |
| ATS-004 | ATS | View Candidate | Branch Admin | View candidate detail | Can view branch candidates | hasScopedAccess | `tests/e2e/ats/candidates.spec.ts` | `tests/api/ats/candidates.test.ts` | Pending | |
| ATS-005 | ATS | Interview Schedule | Branch Admin | View interviews | Branch interviews | Scope enforced | `tests/e2e/ats/interviews.spec.ts` | `tests/api/ats/interviews.test.ts` | Pending | |
| ATS-006 | ATS | Pipeline View | Branch Admin | View recruitment pipeline | Branch pipeline only | KPI scope | `tests/e2e/ats/pipeline.spec.ts` | `tests/api/ats/pipeline.test.ts` | Pending | |
| ATS-007 | ATS | Time-to-Hire Report | Branch Admin | View report | Branch data only | Report scope | `tests/e2e/ats/reports.spec.ts` | `tests/api/ats/reports.test.ts` | Pending | |
| ATS-008 | ATS | Candidate Export | Branch Admin | Export candidates | Branch data only | Export scope | `tests/e2e/ats/export.spec.ts` | `tests/api/ats/export.test.ts` | Pending | |
| ATS-009 | ATS | Interview Feedback | Branch Admin | View feedback | Branch feedback | Scope enforced | `tests/e2e/ats/feedback.spec.ts` | `tests/api/ats/feedback.test.ts` | Pending | |
| ATS-010 | ATS | Offer Management | Branch Admin | Manage offers | Branch offers only | Scope enforced | `tests/e2e/ats/offers.spec.ts` | `tests/api/ats/offers.test.ts` | Pending | |

---

## 10. Payroll (8 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| PAY-001 | Payroll | List Payroll Runs | Branch Admin | View payroll runs | Branch runs only | Scope enforced | `tests/e2e/payroll/list.spec.ts` | `tests/api/payroll/list.test.ts` | Pending | |
| PAY-002 | Payroll | View Payroll Detail | Branch Admin | View payroll details | Branch details only | hasScopedAccess | `tests/e2e/payroll/detail.spec.ts` | `tests/api/payroll/detail.test.ts` | Pending | |
| PAY-003 | Payroll | Create Payroll Run | Branch Admin | Create payroll run | Created for branch | Branch validation | `tests/e2e/payroll/create.spec.ts` | `tests/api/payroll/create.test.ts` | Pending | |
| PAY-004 | Payroll | View Payslips | Branch Admin | View payslips | Branch payslips | Scope enforced | `tests/e2e/payroll/payslips.spec.ts` | `tests/api/payroll/payslips.test.ts` | Pending | |
| PAY-005 | Payroll | Salary Register | Branch Admin | View salary register | Branch register only | Scope enforced | `tests/e2e/payroll/register.spec.ts` | `tests/api/payroll/register.test.ts` | Pending | |
| PAY-006 | Payroll | Payroll Summary | Branch Admin | View summary | Branch summary | KPI scope | `tests/e2e/payroll/summary.spec.ts` | `tests/api/payroll/summary.test.ts` | Pending | |
| PAY-007 | Payroll | Cost Analysis | Branch Admin | View cost analysis | Branch costs only | Report scope | `tests/e2e/payroll/analysis.spec.ts` | `tests/api/payroll/analysis.test.ts` | Pending | |
| PAY-008 | Payroll | Export Payroll | Branch Admin | Export payroll data | Branch data only | Export scope | `tests/e2e/payroll/export.spec.ts` | `tests/api/payroll/export.test.ts` | Pending | |

---

## 11. Exit Management (8 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| EXIT-001 | Exit | List Exit Requests | Branch Admin | View exit requests | Branch requests only | Scope enforced | `tests/e2e/exit/list.spec.ts` | `tests/api/exit/list.test.ts` | Pending | |
| EXIT-002 | Exit | Create Exit Request | Branch Admin | Initiate exit | Created for branch | Branch validation | `tests/e2e/exit/create.spec.ts` | `tests/api/exit/create.test.ts` | Pending | |
| EXIT-003 | Exit | View Exit Process | Branch Admin | View process details | Branch processes | hasScopedAccess | `tests/e2e/exit/process.spec.ts` | `tests/api/exit/process.test.ts` | Pending | |
| EXIT-004 | Exit | Clearance | Branch Admin | View clearance | Branch clearance | Scope enforced | `tests/e2e/exit/clearance.spec.ts` | `tests/api/exit/clearance.test.ts` | Pending | |
| EXIT-005 | Exit | F&F Settlement | Branch Admin | View settlement | Branch settlements | Scope enforced | `tests/e2e/exit/fnf.spec.ts` | `tests/api/exit/fnf.test.ts` | Pending | |
| EXIT-006 | Exit | Exit Interview | Branch Admin | View interview | Branch interviews | Scope enforced | `tests/e2e/exit/interview.spec.ts` | `tests/api/exit/interview.test.ts` | Pending | |
| EXIT-007 | Exit | Analytics | Branch Admin | View exit analytics | Branch analytics | KPI scope | `tests/e2e/exit/analytics.spec.ts` | `tests/api/exit/analytics.test.ts` | Pending | |
| EXIT-008 | Exit | Attrition Report | Branch Admin | View attrition | Branch attrition | Report scope | `tests/e2e/exit/attrition.spec.ts` | `tests/api/exit/attrition.test.ts` | Pending | |

---

## 12. Assets (6 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| AST-001 | Assets | List Assets | Branch Admin | View assets | Branch assets only | Scope enforced | `tests/e2e/assets/list.spec.ts` | `tests/api/assets/list.test.ts` | Pending | |
| AST-002 | Assets | View Allocation | Branch Admin | View allocations | Branch allocations | Scope enforced | `tests/e2e/assets/allocations.spec.ts` | `tests/api/assets/allocations.test.ts` | Pending | |
| AST-003 | Assets | Create Asset | Branch Admin | Create asset | Created for branch | Branch validation | `tests/e2e/assets/create.spec.ts` | `tests/api/assets/create.test.ts` | Pending | |
| AST-004 | Assets | Asset Movement | Branch Admin | Move asset | Within branch scope | Movement validation | `tests/e2e/assets/movement.spec.ts` | `tests/api/assets/movement.test.ts` | Pending | |
| AST-005 | Assets | Inventory Report | Branch Admin | View inventory | Branch inventory | KPI scope | `tests/e2e/assets/inventory.spec.ts` | `tests/api/assets/inventory.test.ts` | Pending | |
| AST-006 | Assets | Export | Branch Admin | Export assets | Branch data only | Export scope | `tests/e2e/assets/export.spec.ts` | `tests/api/assets/export.test.ts` | Pending | |

---

## 13. Reports (6 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| RPT-001 | Reports | List Reports | Branch Admin | View reports | Accessible reports | Scope enforced | `tests/e2e/reports/list.spec.ts` | `tests/api/reports/list.test.ts` | Pending | |
| RPT-002 | Reports | View Report | Branch Admin | View report definition | Can access branch reports | hasScopedAccess | `tests/e2e/reports/view.spec.ts` | `tests/api/reports/view.test.ts` | Pending | |
| RPT-003 | Reports | Run Report | Branch Admin | Execute report | Branch data only | Query scope | `tests/e2e/reports/run.spec.ts` | `tests/api/reports/run.test.ts` | Pending | |
| RPT-004 | Reports | Create Report | Branch Admin | Create custom report | Created with branch scope | Branch validation | `tests/e2e/reports/create.spec.ts` | `tests/api/reports/create.test.ts` | Pending | |
| RPT-005 | Reports | Scheduled Reports | Branch Admin | View scheduled reports | Branch reports only | Scope enforced | `tests/e2e/reports/scheduled.spec.ts` | `tests/api/reports/scheduled.test.ts` | Pending | |
| RPT-006 | Reports | Export Results | Branch Admin | Export report results | Branch data only | Export scope | `tests/e2e/reports/export.spec.ts` | `tests/api/reports/export.test.ts` | Pending | |

---

## 14. Work Inbox (6 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| INB-001 | Inbox | Pending Approvals | Branch Admin | View pending approvals | Branch requests only | Scope enforced | `tests/e2e/inbox/pending.spec.ts` | `tests/api/inbox/pending.test.ts` | Pending | |
| INB-002 | Inbox | Approve Request | Branch Admin | Approve pending request | Approval successful | hasScopedAccess | `tests/e2e/inbox/approve.spec.ts` | `tests/api/inbox/approve.test.ts` | Pending | |
| INB-003 | Inbox | Notifications | Branch Admin | View notifications | Branch notifications | Scope enforced | `tests/e2e/inbox/notifications.spec.ts` | `tests/api/inbox/notifications.test.ts` | Pending | |
| INB-004 | Inbox | Delegations | Branch Admin | View delegations | Branch delegations | Scope enforced | `tests/e2e/inbox/delegations.spec.ts` | `tests/api/inbox/delegations.test.ts` | Pending | |
| INB-005 | Inbox | Inbox Counts | Branch Admin | View notification counts | Branch counts only | KPI scope | `tests/e2e/inbox/counts.spec.ts` | `tests/api/inbox/counts.test.ts` | Pending | |
| INB-006 | Inbox | Mark as Read | Branch Admin | Mark notification read | Update successful | hasScopedAccess | `tests/e2e/inbox/actions.spec.ts` | `tests/api/inbox/actions.test.ts` | Pending | |

---

## 15. Admin Settings (10 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| ADM-001 | Admin | Access Control | Global Admin | View role-page access | Full access control view | Global scope | `tests/e2e/admin/access-control.spec.ts` | `tests/api/admin/access-control.test.ts` | Pending | |
| ADM-002 | Admin | Access Control | Branch Admin | View access control | 403 - Insufficient privileges | Role level check | `tests/e2e/admin/access-control.spec.ts` | `tests/api/admin/access-control.test.ts` | Pending | |
| ADM-003 | Admin | User Management | Global Admin | Manage users | Full user management | Global scope | `tests/e2e/admin/users.spec.ts` | `tests/api/admin/users.test.ts` | Pending | |
| ADM-004 | Admin | User Management | Branch Admin | Manage users | Branch users only | Branch scope | `tests/e2e/admin/users.spec.ts` | `tests/api/admin/users.test.ts` | Pending | |
| ADM-005 | Admin | Role Management | Global Admin | Manage roles | Full role management | Global scope | `tests/e2e/admin/roles.spec.ts` | `tests/api/admin/roles.test.ts` | Pending | |
| ADM-006 | Admin | Org Masters | Branch Admin | View org masters | Branch data only | Scope enforced | `tests/e2e/admin/org-masters.spec.ts` | `tests/api/admin/org-masters.test.ts` | Pending | |
| ADM-007 | Admin | Process Config | Branch Admin | View process config | Branch processes | Scope enforced | `tests/e2e/admin/process-config.spec.ts` | `tests/api/admin/process-config.test.ts` | Pending | |
| ADM-008 | Admin | Email Templates | Global Admin | Manage templates | Full access | Global scope | `tests/e2e/admin/email-templates.spec.ts` | `tests/api/admin/email-templates.test.ts` | Pending | |
| ADM-009 | Admin | Audit Logs | Global Admin | View audit logs | All logs | Global scope | `tests/e2e/admin/audit-logs.spec.ts` | `tests/api/admin/audit-logs.test.ts` | Pending | |
| ADM-010 | Admin | Audit Logs | Branch Admin | View audit logs | Branch logs only | Scope enforced | `tests/e2e/admin/audit-logs.spec.ts` | `tests/api/admin/audit-logs.test.ts` | Pending | |

---

## 16. Unauthorized Routes (10 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| UNAUTH-001 | Routes | Direct URL Access | Branch Admin | Access /admin/access-control | 403 Unauthorized page | Route guard | `tests/e2e/routes/unauthorized.spec.ts` | N/A | Pending | |
| UNAUTH-002 | Routes | Direct URL Access | No-Scope Admin | Access /employees | 403 or empty state | Route guard | `tests/e2e/routes/unauthorized.spec.ts` | N/A | Pending | |
| UNAUTH-003 | Routes | Page Access | Branch Admin | Access payroll without permission | 403 page | Page access code | `tests/e2e/routes/page-access.spec.ts` | N/A | Pending | |
| UNAUTH-004 | Routes | API Access | Unauthenticated | Call /api/employees | 401 Unauthorized | JWT validation | N/A | `tests/api/auth/unauthorized.test.ts` | Pending | |
| UNAUTH-005 | Routes | Expired Token | All | Access with expired token | Redirect to login | Token expiry | `tests/e2e/routes/session.spec.ts` | `tests/api/auth/expired.test.ts` | Pending | |
| UNAUTH-006 | Routes | Invalid Token | All | Access with tampered token | 401 Unauthorized | Token signature | `tests/e2e/routes/session.spec.ts` | `tests/api/auth/invalid.test.ts` | Pending | |
| UNAUTH-007 | Routes | Missing Permissions | Branch Admin | Access /reports without REPORTS_VIEW | 403 page | Permission check | `tests/e2e/routes/permissions.spec.ts` | N/A | Pending | |
| UNAUTH-008 | Routes | Cross-Module Access | Branch Admin | Access ATS without ATS_VIEW | 403 page | Module permission | `tests/e2e/routes/permissions.spec.ts` | N/A | Pending | |
| UNAUTH-009 | Routes | API Direct Call | Branch Admin | POST /api/admin/roles | 403 Forbidden | API permission | N/A | `tests/api/admin/unauthorized.test.ts` | Pending | |
| UNAUTH-010 | Routes | Rate Limiting | All | Exceed API rate limit | 429 Too Many Requests | Rate limiter | N/A | `tests/api/ratelimit.test.ts` | Pending | |

---

## 17. Cross-Branch Tampering (15 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| TAMPER-001 | Tampering | Query Param | Branch Admin | GET /employees?branch_id=OTHER | Returns only authorized branch | Param ignored | `tests/e2e/tampering/query-params.spec.ts` | `tests/api/tampering/query.test.ts` | Pending | Critical |
| TAMPER-002 | Tampering | Query Param | Branch Admin | GET /employees?branch_id=* | 400 Bad Request | Rejected | `tests/e2e/tampering/query-params.spec.ts` | `tests/api/tampering/query.test.ts` | Pending | |
| TAMPER-003 | Tampering | SQL Injection | Branch Admin | GET /employees?branch_id=1 OR 1=1 | 400 Bad Request | SQL injection prevention | `tests/e2e/tampering/sql-injection.spec.ts` | `tests/api/tampering/sql.test.ts` | Pending | |
| TAMPER-004 | Tampering | Request Body | Branch Admin | POST /employees {branch_id: OTHER} | 403 Cannot create | Body validation | `tests/e2e/tampering/request-body.spec.ts` | `tests/api/tampering/body.test.ts` | Pending | Critical |
| TAMPER-005 | Tampering | Request Body | Branch Admin | PUT /employees/1 {branch_id: OTHER} | 403 Cannot transfer | Target validation | `tests/e2e/tampering/request-body.spec.ts` | `tests/api/tampering/body.test.ts` | Pending | Critical |
| TAMPER-006 | Tampering | Request Body | Branch Admin | POST /movements {to_branch_id: ALL} | 403 Invalid target | Target validation | `tests/e2e/tampering/request-body.spec.ts` | `tests/api/tampering/body.test.ts` | Pending | |
| TAMPER-007 | Tampering | Request Body | Branch Admin | POST /bulk {scope: 'all'} | 403 Unauthorized scope | Scope validation | `tests/e2e/tampering/request-body.spec.ts` | `tests/api/tampering/body.test.ts` | Pending | |
| TAMPER-008 | Tampering | Direct ID | Branch Admin | GET /employees/CROSS_BRANCH_ID | 403 Access Denied | hasScopedAccess | `tests/e2e/tampering/direct-id.spec.ts` | `tests/api/tampering/id.test.ts` | Pending | Critical |
| TAMPER-009 | Tampering | Bypass Param | Branch Admin | GET /employees/1?bypass=true | Scope enforced | Param ignored | `tests/e2e/tampering/bypass.spec.ts` | `tests/api/tampering/bypass.test.ts` | Pending | |
| TAMPER-010 | Tampering | Multi-ID | Branch Admin | GET /employees?ids[]=1&ids[]=CROSS | Returns only accessible | ID filtering | `tests/e2e/tampering/multi-id.spec.ts` | `tests/api/tampering/multiid.test.ts` | Pending | |
| TAMPER-011 | Tampering | Export Scope | Branch Admin | POST /employees/export {scope: 'all'} | 403 Cannot export all | Export scope check | `tests/e2e/tampering/export.spec.ts` | `tests/api/tampering/export.test.ts` | Pending | |
| TAMPER-012 | Tampering | Export Data | Branch Admin | Export via modified API call | Same restrictions as UI | API scope check | `tests/e2e/tampering/export.spec.ts` | `tests/api/tampering/export.test.ts` | Pending | |
| TAMPER-013 | Tampering | Batch Operations | Branch Admin | Batch update with cross-branch IDs | Only branch IDs processed | Batch scope check | `tests/e2e/tampering/batch.spec.ts` | `tests/api/tampering/batch.test.ts` | Pending | |
| TAMPER-014 | Tampering | Report Query | Branch Admin | Custom SQL with cross-branch | Scope injected in SQL | SQL scope check | `tests/e2e/tampering/report-sql.spec.ts` | `tests/api/tampering/report.test.ts` | Pending | |
| TAMPER-015 | Tampering | Header Manipulation | Branch Admin | Send X-Branch-ID: OTHER header | Header ignored | Scope from JWT | `tests/e2e/tampering/headers.spec.ts` | `tests/api/tampering/headers.test.ts` | Pending | |

---

## 18. Logout (3 scenarios)

| Test ID | Module | Journey Step | Admin Type | Test Action | Expected Result | Security Check | Frontend Test File | Backend Test File | Status | Notes |
|---------|--------|--------------|------------|-------------|-----------------|----------------|-------------------|-------------------|--------|-------|
| LOGOUT-001 | Auth | Logout | All Admin Types | Click logout | Session invalidated | Token blacklisted | `tests/e2e/auth/logout.spec.ts` | `tests/api/auth/logout.test.ts` | Pending | |
| LOGOUT-002 | Auth | Post-Logout Access | All Admin Types | Access after logout | Redirect to login | Session check | `tests/e2e/auth/logout.spec.ts` | `tests/api/auth/verify.test.ts` | Pending | |
| LOGOUT-003 | Auth | Token Reuse | All Admin Types | Use token after logout | 401 Token invalid | Blacklist check | `tests/e2e/auth/logout.spec.ts` | `tests/api/auth/verify.test.ts` | Pending | |

---

## Summary Statistics

| Category | Total Tests | Pending | Pass | Fail |
|----------|-------------|---------|------|------|
| Login & Access Context | 10 | 10 | 0 | 0 |
| Dashboard | 8 | 8 | 0 | 0 |
| Employees | 15 | 15 | 0 | 0 |
| Onboarding | 10 | 10 | 0 | 0 |
| Movement | 8 | 8 | 0 | 0 |
| Attendance | 10 | 10 | 0 | 0 |
| Leave | 10 | 10 | 0 | 0 |
| Roster/WFM | 10 | 10 | 0 | 0 |
| ATS | 10 | 10 | 0 | 0 |
| Payroll | 8 | 8 | 0 | 0 |
| Exit Management | 8 | 8 | 0 | 0 |
| Assets | 6 | 6 | 0 | 0 |
| Reports | 6 | 6 | 0 | 0 |
| Work Inbox | 6 | 6 | 0 | 0 |
| Admin Settings | 10 | 10 | 0 | 0 |
| Unauthorized Routes | 10 | 10 | 0 | 0 |
| Cross-Branch Tampering | 15 | 15 | 0 | 0 |
| Logout | 3 | 3 | 0 | 0 |
| **TOTAL** | **153** | **153** | **0** | **0** |

---

## Critical Test Priority

### P0 - Must Fix First
1. EMP-007: Cross-branch employee detail access
2. EMP-009: Cross-branch employee creation
3. EMP-011: Cross-branch employee update
4. EMP-012: Unauthorized branch transfer
5. TAMPER-001: Query parameter branch manipulation
6. TAMPER-004: Request body branch manipulation
7. TAMPER-008: Direct ID cross-branch access

### P1 - High Priority
1. All Dashboard KPI tests (DASH-001 to DASH-008)
2. All Unauthorized route tests (UNAUTH-001 to UNAUTH-010)
3. All Cross-Branch tampering tests (TAMPER-002 to TAMPER-015)

### P2 - Standard Priority
1. All remaining module tests
2. Export scope tests
3. Admin settings tests

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-06-10 | QA Team | Initial test matrix |

---

**NEXT**: See [../ADMIN_E2E_RESUME.md](../ADMIN_E2E_RESUME.md) for current audit status.
