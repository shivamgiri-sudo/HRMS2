# HRMS2 Incentive Workflow Runtime Validation

## Purpose
Production runtime validation checklist for incentive upload, multi-step approval chain, and payroll run integration.

---

## Backend Routes
- `/api/incentives/*`

---

## Pre-conditions
- Backend running at http://localhost:5056
- Valid tokens for: WFM/payroll_hr, branch_head, operations_head, finance_head, and super_admin
- `incentive_upload_batch`, `incentive_approval_step`, and `incentive_payroll_register` tables exist in `mas_hrms`
- A payroll run exists for the test month/process

---

## Test Cases

| # | Test | Steps | Expected Result | Actual Result | Status |
|---|------|--------|-----------------|---------------|--------|
| T-01 | GET /api/incentives/masters | Fetch incentive types | HTTP 200 — returns list of incentive master types (e.g., attendance bonus, performance incentive) | — | PENDING |
| T-02 | POST /api/incentives/batches | WFM/payroll_hr creates batch | HTTP 201 — batch created with `salary_month`, `process_id`, `batch_status = draft` | — | PENDING |
| T-03 | POST /api/incentives/batches/:id/lines/import | Import incentive lines (employee_id, amount) | HTTP 200 — lines imported, row count returned | — | PENDING |
| T-04 | GET /api/incentives/batches/:id/lines | Fetch imported lines | HTTP 200 — returns all imported lines for batch | — | PENDING |
| T-05 | POST /api/incentives/batches/:id/submit | Submit batch for approval | HTTP 200 — `batch_status = submitted` | — | PENDING |
| T-06 | POST /api/incentives/batches/:id/approval-chain/init | Initialize approval chain | HTTP 200 — approval steps created for branch_head, operations_head, finance_head | — | PENDING |
| T-07 | GET /api/incentives/batches/:id/approval-steps | Fetch approval steps | HTTP 200 — steps returned with `step_number`, `role_required`, `status` | — | PENDING |
| T-08 | POST /api/incentives/batches/:id/step-approve (step 1) | branch_head approves step 1 | HTTP 200 — step 1 `status = approved`; step 2 becomes active | — | PENDING |
| T-09 | POST /api/incentives/batches/:id/step-approve (step 2) | operations_head approves step 2 | HTTP 200 — step 2 `status = approved`; step 3 becomes active | — | PENDING |
| T-10 | POST /api/incentives/batches/:id/step-approve (step 3) | finance_head approves step 3 | HTTP 200 — step 3 `status = approved`; `batch_status = fully_approved` | — | PENDING |
| T-11 | POST /api/incentives/batches/:id/step-reject | Test rejection path | HTTP 200 — step rejected, `batch_status = rejected` or returned to previous step per configuration | — | PENDING |
| T-12 | POST /api/incentives/apply-to-run | Apply approved batch to payroll run | HTTP 200 — incentive amounts applied to payroll run; register rows created | — | PENDING |
| T-13 | Confirm payroll register updated | Query `incentive_payroll_register` after T-12 | Rows present with correct `batch_id`, `employee_id`, `amount` | — | PENDING |

---

## SQL Verification Queries

```sql
-- Verify batch status and metadata
SELECT id, batch_status, salary_month, process_id
FROM incentive_upload_batch
ORDER BY created_at DESC
LIMIT 5;

-- Verify approval steps
SELECT step_number, role_required, status
FROM incentive_approval_step
WHERE batch_id = '<id>';

-- Verify payroll register rows
SELECT COUNT(*)
FROM incentive_payroll_register
WHERE batch_id = '<id>';
```

---

## Summary Table

| Test | Status |
|------|--------|
| T-01: GET incentive masters | PENDING |
| T-02: Create batch → status = draft | PENDING |
| T-03: Import incentive lines | PENDING |
| T-04: Fetch imported lines | PENDING |
| T-05: Submit batch → status = submitted | PENDING |
| T-06: Initialize approval chain (3 steps) | PENDING |
| T-07: Fetch approval steps | PENDING |
| T-08: branch_head approves step 1 | PENDING |
| T-09: operations_head approves step 2 | PENDING |
| T-10: finance_head approves step 3 → fully_approved | PENDING |
| T-11: Rejection path works | PENDING |
| T-12: Apply to payroll run | PENDING |
| T-13: Payroll register updated with incentive rows | PENDING |

---

**Validated by:** ___________________  
**Date:** ___________________  
**Environment:** ___________________
