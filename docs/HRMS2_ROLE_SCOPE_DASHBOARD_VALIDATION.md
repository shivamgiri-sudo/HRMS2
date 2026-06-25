# HRMS2 Role Scope and Dashboard Runtime Validation

**Date:** 2026-06-25  
**Status:** PENDING — to be executed against running backend with test users per role

---

## Test Users Required

Create or confirm one test user per role in `auth_user` + `user_roles`:

| Role | Expected dashboard | Branch scope |
|---|---|---|
| super_admin | CEO/Super Admin dashboard | All branches |
| admin | Admin dashboard | All branches |
| hr | HR dashboard | Assigned branch |
| branch_hr | Branch HR dashboard | Own branch only |
| payroll_hr | Payroll dashboard | All branches |
| branch_head | Branch Head dashboard | Own branch only |
| operations_head | Operations dashboard | Own process/branch |
| payroll_head | Payroll Head dashboard | All branches |
| finance_head | Finance dashboard | All branches |
| wfm | WFM dashboard | Assigned branches |
| it | IT Provisioning dashboard | All branches |
| branch_admin | Branch Admin view | Own branch only |
| manager | Manager dashboard | Own team only |
| employee | Employee self-service | Own data only |

---

## Test Matrix Per Role

For each role, verify all items below. Status: PENDING for all.

### super_admin

| Check | Expected | Result |
|---|---|---|
| Dashboard opens | CEO/full dashboard with all metrics | PENDING |
| Can access /admin/users | Yes | PENDING |
| Can access /payroll | Yes | PENDING |
| Can access salary assignment | Yes (migration-mode allowed) | PENDING |
| Can access all branches in drilldown | Yes | PENDING |
| Work inbox shows all pending | All tasks across branches | PENDING |

---

### admin

| Check | Expected | Result |
|---|---|---|
| Dashboard opens | Admin dashboard | PENDING |
| Can access /admin/users | Yes | PENDING |
| Cannot access super_admin-only routes | Blocked 403 | PENDING |
| Branch filter shows all branches | Yes | PENDING |

---

### hr / branch_hr

| Check | Expected | Result |
|---|---|---|
| Dashboard opens | HR dashboard | PENDING |
| Cannot access payroll salary assignment | Blocked (not payroll_hr role) | PENDING |
| branch_hr: branch filter scoped to own branch | Yes — other branches hidden | PENDING |
| Can access ATS candidate list | Yes (in branch scope) | PENDING |
| Cannot see other branch employee PII | Blocked by row-scope | PENDING |

---

### payroll_hr / payroll_head

| Check | Expected | Result |
|---|---|---|
| Dashboard opens | Payroll dashboard | PENDING |
| Can access /payroll/salary-assignments | Yes | PENDING |
| Salary assignment requires slab/proposal | Yes (governance gate active) | PENDING |
| Cannot access super_admin pages | Blocked | PENDING |

---

### finance_head

| Check | Expected | Result |
|---|---|---|
| Dashboard opens | Finance dashboard | PENDING |
| Can approve incentive batches | Yes (step-approve) | PENDING |
| Can configure salary slabs | Yes (attendance_billing_config if applicable) | PENDING |
| Cannot access employee PII for other branches | Blocked | PENDING |

---

### branch_head

| Check | Expected | Result |
|---|---|---|
| Dashboard opens | Branch dashboard | PENDING |
| Metrics show own branch only | Yes | PENDING |
| Can approve ATS branch-head step | Yes | PENDING |
| Cannot see other branch data | Blocked | PENDING |

---

### wfm

| Check | Expected | Result |
|---|---|---|
| Dashboard opens | WFM dashboard | PENDING |
| Can manage roster for assigned branches | Yes | PENDING |
| Cannot access payroll or finance | Blocked | PENDING |

---

### manager

| Check | Expected | Result |
|---|---|---|
| Dashboard opens | Team Manager view | PENDING |
| Work inbox shows own team's pending | Yes | PENDING |
| Cannot access HR-only pages | Blocked | PENDING |
| Can approve regularization for own team | Yes | PENDING |

---

### employee

| Check | Expected | Result |
|---|---|---|
| Dashboard opens | Employee self-service | PENDING |
| Can view own payslip | Yes | PENDING |
| Cannot view other employees | Blocked | PENDING |
| Can submit resignation | Yes | PENDING |
| Can submit leave request | Yes | PENDING |
| Cannot access admin pages | Blocked (404/403) | PENDING |
| Work inbox shows own pending tasks | Yes | PENDING |

---

## API Scope Verification

```bash
# Test branch-scoped endpoint with wrong-branch employee token:
curl http://localhost:5056/api/employees?branchId=<other-branch-id> \
  -H "Authorization: Bearer <branch_hr-token>"
# Expected: empty list or 403 — NOT the other branch's employees

# Test payroll endpoint with non-payroll role:
curl -X POST http://localhost:5056/api/payroll/salary-assignments \
  -H "Authorization: Bearer <manager-token>" \
  -H "Content-Type: application/json" \
  -d '{"employeeId":"<id>","structureId":"<id>","ctcAnnual":100000,"effectiveFrom":"2026-07-01"}'
# Expected: 403 Forbidden (not 400 SALARY_BYPASS_BLOCKED — role blocked before governance check)
```

---

## Summary Table

| Role | Dashboard | Branch Scope | Unauthorized Blocked | Work Inbox Scoped | Pass/Fail |
|---|---|---|---|---|---|
| super_admin | PENDING | PENDING | PENDING | PENDING | PENDING |
| admin | PENDING | PENDING | PENDING | PENDING | PENDING |
| hr | PENDING | PENDING | PENDING | PENDING | PENDING |
| branch_hr | PENDING | PENDING | PENDING | PENDING | PENDING |
| payroll_hr | PENDING | PENDING | PENDING | PENDING | PENDING |
| branch_head | PENDING | PENDING | PENDING | PENDING | PENDING |
| operations_head | PENDING | PENDING | PENDING | PENDING | PENDING |
| payroll_head | PENDING | PENDING | PENDING | PENDING | PENDING |
| finance_head | PENDING | PENDING | PENDING | PENDING | PENDING |
| wfm | PENDING | PENDING | PENDING | PENDING | PENDING |
| it | PENDING | PENDING | PENDING | PENDING | PENDING |
| branch_admin | PENDING | PENDING | PENDING | PENDING | PENDING |
| manager | PENDING | PENDING | PENDING | PENDING | PENDING |
| employee | PENDING | PENDING | PENDING | PENDING | PENDING |

**Overall status: PENDING**
