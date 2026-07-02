# HRMS2 TAT and Escalation Runtime Validation

## Purpose
Production runtime validation checklist for TAT (Turnaround Time) matrix, task instances, escalation rules, and dashboard.

---

## Backend Routes
- `/api/governance/tat/*`

---

## Pre-conditions
- Backend running at http://localhost:5056
- Valid HR Admin or Super Admin token available
- `tat_matrix`, `tat_task_instance`, and `tat_escalation_matrix` tables exist in `mas_hrms`

---

## Test Cases

| # | Test | Steps | Expected Result | Actual Result | Status |
|---|------|--------|-----------------|---------------|--------|
| T-01 | GET /api/governance/tat/matrix | Fetch TAT matrix | HTTP 200 — returns array of TAT rules | — | PENDING |
| T-02a | POST /api/governance/tat/matrix — BIOMETRIC_SETUP | Create rule: `task_type: BIOMETRIC_SETUP`, `tat_hours: 24` | HTTP 201 — rule created | — | PENDING |
| T-02b | POST /api/governance/tat/matrix — DOMAIN_EMAIL_CREATION | Create rule: `task_type: DOMAIN_EMAIL_CREATION`, `tat_hours: 48` | HTTP 201 — rule created | — | PENDING |
| T-02c | POST /api/governance/tat/matrix — APPOINTMENT_LETTER | Create rule: `task_type: APPOINTMENT_LETTER`, `tat_hours: 72` | HTTP 201 — rule created | — | PENDING |
| T-02d | POST /api/governance/tat/matrix — BGV_COMPLETION | Create rule: `task_type: BGV_COMPLETION`, `tat_hours: 120` | HTTP 201 — rule created | — | PENDING |
| T-02e | POST /api/governance/tat/matrix — PAYROLL_HR_VALIDATION | Create rule: `task_type: PAYROLL_HR_VALIDATION`, `tat_hours: 24` | HTTP 201 — rule created | — | PENDING |
| T-02f | POST /api/governance/tat/matrix — JCLR_COMPLETION | Create rule: `task_type: JCLR_COMPLETION`, `tat_hours: 48` | HTTP 201 — rule created | — | PENDING |
| T-03 | GET /api/governance/tat/escalation-matrix | Fetch escalation rules | HTTP 200 — returns escalation rules array | — | PENDING |
| T-04 | POST /api/governance/tat/tasks | Create a task instance linked to a TAT rule | HTTP 201 — task instance created with `due_at` computed from TAT rule | — | PENDING |
| T-05 | GET /api/governance/tat/tasks | List task instances | HTTP 200 — instances returned with `due_soon` and `breach` status flags | — | PENDING |
| T-06 | POST /api/governance/tat/tasks/recalculate | Trigger TAT recalculation | HTTP 200 — all task statuses recalculated; overdue instances flagged | — | PENDING |
| T-07 | GET /api/governance/tat/dashboard | Fetch TAT dashboard summary | HTTP 200 — summary includes counts of on_time, due_soon, breached, completed | — | PENDING |
| T-08 | POST /api/governance/tat/tasks/:id/complete | Mark a task instance as complete | HTTP 200 — task `status = completed`, `completed_at` set | — | PENDING |

---

## SQL Verification Queries

```sql
-- Verify TAT matrix rules
SELECT task_type, tat_hours
FROM tat_matrix
LIMIT 20;

-- Verify task instances and status
SELECT id, task_type, status, due_at, breach_at
FROM tat_task_instance
ORDER BY created_at DESC
LIMIT 10;

-- Verify escalation matrix
SELECT *
FROM tat_escalation_matrix
LIMIT 10;
```

---

## Summary Table

| Test | Status |
|------|--------|
| T-01: GET TAT matrix | PENDING |
| T-02a: Create BIOMETRIC_SETUP rule (24h) | PENDING |
| T-02b: Create DOMAIN_EMAIL_CREATION rule (48h) | PENDING |
| T-02c: Create APPOINTMENT_LETTER rule (72h) | PENDING |
| T-02d: Create BGV_COMPLETION rule (120h) | PENDING |
| T-02e: Create PAYROLL_HR_VALIDATION rule (24h) | PENDING |
| T-02f: Create JCLR_COMPLETION rule (48h) | PENDING |
| T-03: GET escalation matrix | PENDING |
| T-04: Create task instance with computed due_at | PENDING |
| T-05: List tasks with due_soon and breach flags | PENDING |
| T-06: Recalculate TAT statuses | PENDING |
| T-07: Dashboard summary returns correct counts | PENDING |
| T-08: Mark task complete → status = completed | PENDING |

---

**Validated by:** ___________________  
**Date:** ___________________  
**Environment:** ___________________
