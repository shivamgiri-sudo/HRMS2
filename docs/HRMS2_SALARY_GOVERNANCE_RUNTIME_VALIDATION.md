# HRMS2 Salary Governance Runtime Validation

## Purpose
Production runtime validation checklist for salary governance gate — ensuring CTC assignments require valid slab or approved proposal.

---

## Pre-conditions
- Backend running at http://localhost:5056
- Valid tokens available: `super_admin` and non-super_admin role
- Salary structure, slab, and employee records exist in `mas_hrms`
- Test IDs ready: `TEST_STRUCTURE_ID`, `TEST_EMPLOYEE_ID`, `TEST_SLAB_ID`, `TEST_SLAB_CTC`

---

## Run Command

```bash
cd backend && \
  HRMS_API_URL=http://localhost:5056 \
  HRMS_TEST_TOKEN=<token> \
  TEST_STRUCTURE_ID=<id> \
  TEST_EMPLOYEE_ID=<id> \
  TEST_SLAB_ID=<id> \
  TEST_SLAB_CTC=<ctc> \
  npx ts-node --esm scripts/test-salary-bypass-gate.ts
```

---

## Negative Tests — Expected: HTTP 400 SALARY_BYPASS_BLOCKED

| # | Test | Input | Expected | Actual | Status |
|---|------|-------|----------|--------|--------|
| NEG-1 | Custom CTC with no slab or proposal | `salary_slab_id: null`, `salary_proposal_id: null`, `ctc_annual: <custom>` | HTTP 400 — `SALARY_BYPASS_BLOCKED` | — | PENDING |
| NEG-2 | Valid slab but mismatched CTC (+5000) | `salary_slab_id: <TEST_SLAB_ID>`, `ctc_annual: TEST_SLAB_CTC + 5000` | HTTP 400 — `SALARY_BYPASS_BLOCKED` | — | PENDING |
| NEG-3 | Non-existent proposal UUID | `salary_proposal_id: "00000000-0000-0000-0000-000000000000"` | HTTP 400 — `SALARY_BYPASS_BLOCKED` | — | PENDING |

---

## Positive Tests — Expected: HTTP 201 Success

| # | Test | Input | Expected | Actual | Status |
|---|------|-------|----------|--------|--------|
| POS-1 | Valid slab + matching CTC | `salary_slab_id: <TEST_SLAB_ID>`, `ctc_annual: TEST_SLAB_CTC` | HTTP 201 — assignment created | — | PENDING |
| POS-2 | Approved proposal + matching CTC | `salary_proposal_id: <approved_proposal_id>`, `ctc_annual: proposal_ctc` | HTTP 201 — assignment created | — | PENDING |
| POS-3 | Migration mode — super_admin token | `governance_mode: migration`, super_admin token | HTTP 201 — migration assignment created | — | PENDING |
| POS-3b | Migration mode — non-super_admin token | `governance_mode: migration`, non-super_admin token | HTTP 400 — `SALARY_BYPASS_BLOCKED` | — | PENDING |

---

## SQL Verification Queries (Run After Positive Tests)

```sql
-- Verify salary assignments created
SELECT id, governance_mode, salary_slab_id, salary_proposal_id, assigned_by
FROM employee_salary_assignment
WHERE employee_id = '<id>'
ORDER BY created_at DESC
LIMIT 3;

-- Verify salary register entries
SELECT id, governance_mode, approved_ctc_annual, locked_status
FROM salary_register
ORDER BY created_at DESC
LIMIT 5;

-- Verify audit trail
SELECT action_type, created_at
FROM sensitive_action_log
WHERE module_key = 'payroll'
ORDER BY created_at DESC
LIMIT 10;
```

---

## Summary Table

| Test | Status |
|------|--------|
| NEG-1: Custom CTC no slab/proposal → 400 SALARY_BYPASS_BLOCKED | PENDING |
| NEG-2: Valid slab, mismatched CTC → 400 SALARY_BYPASS_BLOCKED | PENDING |
| NEG-3: Non-existent proposal → 400 SALARY_BYPASS_BLOCKED | PENDING |
| POS-1: Valid slab + matching CTC → 201 | PENDING |
| POS-2: Approved proposal + matching CTC → 201 | PENDING |
| POS-3: Migration mode super_admin → 201 | PENDING |
| POS-3b: Migration mode non-super_admin → 400 | PENDING |
| SQL: employee_salary_assignment rows verified | PENDING |
| SQL: salary_register rows verified | PENDING |
| SQL: sensitive_action_log audit entries verified | PENDING |

---

**Validated by:** ___________________  
**Date:** ___________________  
**Environment:** ___________________
