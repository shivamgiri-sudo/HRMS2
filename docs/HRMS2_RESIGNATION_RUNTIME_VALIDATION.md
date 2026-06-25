# HRMS2 Resignation Self-Service Runtime Validation

**Date:** 2026-06-25  
**Backend:** `/api/exit/resignation/*`  
**Frontend routes:** `/exit/resignation`, `/exit/resignation-command-center`  
**Status:** PENDING — to be executed against running backend with live DB

---

## Prerequisites

- Migrations 303/305/306 applied (305 creates `exit_retention_action` table)
- Active employee with valid JWT token
- Manager user in correct branch/process scope
- HR user with exit access role

---

## Test 1 — Employee submits resignation

```bash
curl -X POST http://localhost:5056/api/exit/resignation \
  -H "Authorization: Bearer <employee-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "resignation_reason": "Better opportunity",
    "notice_period_days": 30,
    "last_working_day": "2026-07-25"
  }'
```

**Expected:** 201, exit_request created with status `submitted`  
**Result:** _(pending)_

---

## Test 2 — Employee views own resignation status

```bash
curl http://localhost:5056/api/exit/resignation/my \
  -H "Authorization: Bearer <employee-token>"
```

**Expected:** 200, returns own exit request with current status  
**Result:** _(pending)_

---

## Test 3 — Manager discussion recorded

```bash
curl -X POST http://localhost:5056/api/exit/resignation/<exitId>/manager-discussion \
  -H "Authorization: Bearer <manager-token>" \
  -H "Content-Type: application/json" \
  -d '{"discussion_notes":"Discussed reasons, employee confirmed intention"}'
```

**Expected:** 200, status moves to `manager_discussion`  
**Result:** _(pending)_

---

## Test 4 — HR discussion recorded

```bash
curl -X POST http://localhost:5056/api/exit/resignation/<exitId>/hr-discussion \
  -H "Authorization: Bearer <hr-token>" \
  -H "Content-Type: application/json" \
  -d '{"discussion_notes":"HR retention discussion completed"}'
```

**Expected:** 200  
**Result:** _(pending)_

---

## Test 5 — Retention offer recorded

```bash
curl -X POST http://localhost:5056/api/exit/resignation/<exitId>/retention-offer \
  -H "Authorization: Bearer <hr-token>" \
  -H "Content-Type: application/json" \
  -d '{"offer_details":"Salary revision + role change offered","outcome":"pending"}'
```

**Expected:** 200, `exit_retention_action` row created  
**SQL verify:**
```sql
SELECT * FROM exit_retention_action WHERE exit_request_id = '<exitId>' ORDER BY performed_at DESC LIMIT 5;
```
**Result:** _(pending)_

---

## Test 6 — Employee withdraws resignation (if within allowed window)

```bash
curl -X POST http://localhost:5056/api/exit/resignation/<exitId>/withdraw \
  -H "Authorization: Bearer <employee-token>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Accepted retention offer"}'
```

**Expected:** 200, status = `withdrawn`; exit cleared  
**Result:** _(pending)_

---

## Test 7 — Accept resignation (manager/HR)

```bash
curl -X POST http://localhost:5056/api/exit/resignation/<exitId>/accept \
  -H "Authorization: Bearer <hr-token>" \
  -H "Content-Type: application/json" \
  -d '{"acceptance_notes":"Accepted. Last working day confirmed."}'
```

**Expected:** 200, status = `accepted`  
**Result:** _(pending)_

---

## Test 8 — Notice period tracking

```bash
curl http://localhost:5056/api/exit/resignation/<exitId> \
  -H "Authorization: Bearer <hr-token>"
```

**Expected:** Returns notice_start_date, last_working_day, days_remaining  
**Result:** _(pending)_

---

## Test 9 — Clearance task list

```bash
curl http://localhost:5056/api/exit/<exitId>/clearance \
  -H "Authorization: Bearer <hr-token>"
```

**Expected:** List of clearance tasks (IT, Finance, Admin, etc.) with status  
**Result:** _(pending)_

---

## Test 10 — Work item created in work inbox

```bash
curl http://localhost:5056/api/inbox/my-pending \
  -H "Authorization: Bearer <manager-token>"
```

**Expected:** Resignation-related work item appears for manager  
**Result:** _(pending)_

---

## Test 11 — Audit timeline

```bash
curl http://localhost:5056/api/inbox/timeline/exit_request/<exitId> \
  -H "Authorization: Bearer <hr-token>"
```

**Expected:** Timeline entries for each state change  
**Result:** _(pending)_

---

## Test 12 — Command center (HR view)

Frontend route: `/exit/resignation-command-center`  
**Expected:** Lists all active resignations with status, notice period, risk indicators  
**Result:** _(pending)_

---

## SQL Verification

```sql
-- Active resignation requests
SELECT id, employee_id, status, resignation_reason, last_working_day, created_at
FROM exit_request WHERE status != 'closed' ORDER BY created_at DESC LIMIT 10;

-- Retention actions for a specific exit
SELECT action_type, action_summary, outcome, performed_at
FROM exit_retention_action WHERE exit_request_id = '<exitId>' ORDER BY performed_at;

-- Audit log
SELECT action_type, entity_id, change_summary, created_at
FROM sensitive_action_log WHERE entity_type = 'exit_request'
ORDER BY created_at DESC LIMIT 10;
```

---

## Summary Table

| Test | Description | Expected | Result | Pass/Fail |
|---|---|---|---|---|
| T1 | Employee submits resignation | 201, status=submitted | PENDING | PENDING |
| T2 | Employee views status | 200, own request | PENDING | PENDING |
| T3 | Manager discussion | status=manager_discussion | PENDING | PENDING |
| T4 | HR discussion | 200 | PENDING | PENDING |
| T5 | Retention offer | exit_retention_action row created | PENDING | PENDING |
| T6 | Employee withdraw | status=withdrawn | PENDING | PENDING |
| T7 | Accept resignation | status=accepted | PENDING | PENDING |
| T8 | Notice period tracking | days_remaining present | PENDING | PENDING |
| T9 | Clearance tasks | list returned | PENDING | PENDING |
| T10 | Work inbox item | task appears for manager | PENDING | PENDING |
| T11 | Audit timeline | entries per state change | PENDING | PENDING |
| T12 | Command center | all active resignations listed | PENDING | PENDING |

**Overall status: PENDING**
