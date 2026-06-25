# HRMS2 DPDP Withdrawal Runtime Validation

## Purpose
Production runtime validation checklist for the DPDP (Digital Personal Data Protection) consent withdrawal workflow — employee submission through HR review and approval/rejection.

---

## Routes
- **Employee:** `/privacy/dpdp-withdrawal`
- **HR Admin:** `/compliance/dpdp-withdrawal-admin`
- **Backend:** `/api/privacy/dpdp-withdrawal/*`

---

## Pre-conditions
- Backend running at http://localhost:5056
- Valid employee token and HR Admin token available
- `dpdp_withdrawal_request` table exists in `mas_hrms`

---

## Test Cases

| # | Test | Steps | Expected Result | Actual Result | Status |
|---|------|--------|-----------------|---------------|--------|
| T-01 | POST /api/privacy/dpdp-withdrawal/request | Employee submits withdrawal with scope (e.g., `marketing_emails`, `profiling`) | HTTP 201 — request created, `status = pending`, `processing_hold = true`, scope captured | — | PENDING |
| T-02 | GET /api/privacy/dpdp-withdrawal/my-requests | Employee fetches own requests | HTTP 200 — returns array containing T-01 request; no other employees' records visible | — | PENDING |
| T-03 | GET /api/privacy/dpdp-withdrawal | HR Admin fetches all pending requests | HTTP 200 — returns all pending requests including T-01 | — | PENDING |
| T-04 | POST /api/privacy/dpdp-withdrawal/:id/start-review | HR Admin starts review on T-01 request | HTTP 200 — `status = under_review` | — | PENDING |
| T-05 | POST /api/privacy/dpdp-withdrawal/:id/approve | HR Admin approves the withdrawal | HTTP 200 — `status = approved`, `processing_hold = false` or hold lifted per scope | — | PENDING |
| T-06 | POST /api/privacy/dpdp-withdrawal/:id/reject | HR Admin rejects a request with reason | HTTP 200 — `status = rejected`, rejection reason stored | — | PENDING |
| T-07 | Confirm audit log written | Check audit records after T-05 or T-06 | Audit row present with actor, action, and timestamp | — | PENDING |
| T-08 | Confirm work item created (if applicable) | Check work inbox or task queue after T-01 | Work item or inbox task created for HR review (if workflow integration enabled) | — | PENDING |

---

## SQL Verification Query

```sql
SELECT id, status, processing_hold, scope
FROM dpdp_withdrawal_request
WHERE id = '<id>';
```

**Expected after T-01:** `status = pending`, `processing_hold = true`  
**Expected after T-05:** `status = approved`, `processing_hold = false`  
**Expected after T-06:** `status = rejected`

---

## Summary Table

| Test | Status |
|------|--------|
| T-01: Employee submits withdrawal → processing_hold = true | PENDING |
| T-02: Employee sees own requests only | PENDING |
| T-03: HR sees all pending requests | PENDING |
| T-04: HR starts review → status = under_review | PENDING |
| T-05: HR approves → status = approved, hold released | PENDING |
| T-06: HR rejects with reason → status = rejected | PENDING |
| T-07: Audit log written | PENDING |
| T-08: Work item created for HR review | PENDING |

---

**Validated by:** ___________________  
**Date:** ___________________  
**Environment:** ___________________
