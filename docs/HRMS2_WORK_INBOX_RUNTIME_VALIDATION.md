# HRMS2 Work Inbox Runtime Validation

## Purpose
Production runtime validation checklist for the Work Inbox — unified task queue with KPI tiles, module tabs, risk filter, and inline action sheet.

---

## Route
- **Frontend:** `/work-inbox`
- **Backend:** `/api/inbox/*`

---

## Pre-conditions
- Backend running at http://localhost:5056
- Valid tokens for different roles (HR Admin, Branch Head, Operations Manager, etc.)
- Pending tasks exist in `work_inbox_task` for the test user
- At least one task per module category (ATS, payroll, exit)

---

## Test Cases

| # | Test | Steps | Expected Result | Actual Result | Status |
|---|------|--------|-----------------|---------------|--------|
| T-01 | GET /api/inbox/my-pending | Call with valid token | HTTP 200 — returns only tasks assigned to logged-in user, scoped to their role and branch | — | PENDING |
| T-02 | KPI tiles — counts correct | Observe KPI strip on /work-inbox | Tiles display counts for: pending, overdue, due_soon, completed — values match SQL counts | — | PENDING |
| T-03 | Module tab filtering | Click each module tab (ATS, payroll, exit, etc.) | Task list filters to show only tasks in selected category | — | PENDING |
| T-04 | Risk filter | Apply risk filter: high, medium, low | Task list shows only tasks matching selected risk level | — | PENDING |
| T-05 | TaskCard fields | Inspect each visible TaskCard | Each card shows: task type, aging in days, deadline, branch/process, assignee | — | PENDING |
| T-06 | ActionSheet opens | Click a TaskCard | ActionSheet/drawer opens with task details and available actions | — | PENDING |
| T-07 | GET /api/inbox/timeline/:refType/:refId | Call with valid refType and refId | HTTP 200 — returns ordered timeline events for that entity | — | PENDING |
| T-08 | Remarks field required | Attempt to close a task where remarks are configured as required, without entering remarks | Submit blocked — validation error shown | — | PENDING |
| T-09 | Act & Close | Complete required fields and submit Act & Close | HTTP 200 — task status updated to completed; card removed from pending list | — | PENDING |
| T-10 | Audit log written | Check audit tables after T-09 | Row exists in `sensitive_action_log` or `work_inbox_action_log` with actor, action, timestamp | — | PENDING |

---

## SQL Verification Queries

```sql
-- Count pending tasks for user
SELECT COUNT(*)
FROM work_inbox_task
WHERE assigned_to = '<user_id>'
  AND status = 'pending';

-- List upcoming tasks by due date
SELECT *
FROM work_inbox_task
WHERE assigned_to = '<user_id>'
ORDER BY due_date ASC
LIMIT 10;
```

---

## Summary Table

| Test | Status |
|------|--------|
| T-01: my-pending returns role + branch scoped tasks | PENDING |
| T-02: KPI tiles show correct counts | PENDING |
| T-03: Module tabs filter correctly | PENDING |
| T-04: Risk filter works | PENDING |
| T-05: TaskCard shows all required fields | PENDING |
| T-06: ActionSheet opens on task click | PENDING |
| T-07: Timeline loads for entity | PENDING |
| T-08: Remarks required validation blocks submission | PENDING |
| T-09: Act & Close updates status and removes card | PENDING |
| T-10: Audit log written after close | PENDING |

---

**Validated by:** ___________________  
**Date:** ___________________  
**Environment:** ___________________
