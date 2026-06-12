# BUG FIX TEST MATRIX
**Date:** 2026-06-12

| # | Bug | File(s) | Fix Applied | Test Evidence | Status |
|---|-----|---------|-------------|---------------|--------|
| 1 | `branch_master.state_code` → `state` | `payroll/payrollCalculate.service.ts`, `payroll-compliance/payrollCalculate.service.ts`, `payroll-compliance/payrollCompliance.routes.ts` | `bm.state AS state_code` in SELECT, `ORDER BY b.state` | `tsc --noEmit` 0 errors; vitest 1278 pass | ✅ FIXED |
| 2 | `employment_status = 'Active'` (9 files) | `compliance.service.ts`, `payroll.service.ts`, `portal.attrition.service.ts`, `rta.routes.ts`, `attendance-engine.service.ts`, `employee.routes.ts`, `reporting.service.ts`, `workforce.mandate.service.ts`, `payrollCalculate.service.ts` | `LOWER(employment_status) = 'active'` | vitest 1278/1282 pass | ✅ FIXED |
| 3 | dotenv truncates `#` in password | `backend/.env` | Quoted `DB_PASSWORD="qwersdfg!@#hjk"` | 1278 tests pass (was all failing) | ✅ FIXED |
| 4 | `payslip.service.ts` INSERT uses non-existent `run_id` column (needs `prep_line_id`/`run_month`) | `payroll/payslip.service.ts:64-73`, `getPayslip:94-118`, `acknowledgePayslip:128-148` | Rewrote INSERT/JOIN to use `prep_line_id` and `run_month`; fixed acknowledgePayslip to re-derive `run_id` from JOIN | 1278/1282 tests pass, 0 TS errors | ✅ FIXED |
| 5 | Frontend `npm install` not completing | build environment | Running in background | Pending | ⏳ IN PROGRESS |
| 6 | Frontend typecheck | frontend | Pending install | Pending | ⏳ PENDING |
| 7 | Frontend build | frontend | Pending install | Pending | ⏳ PENDING |

---

## BACKEND TEST SUMMARY

```
Test Files  79 passed (79)
Tests       1278 passed | 4 skipped (1282)
Duration    ~19s
TypeScript  0 errors
Build       0 errors
```

### Skipped Tests (4 — expected)
These 4 tests are `it.skip()` in the source — not failures:
- Implementation stubs for future test cases

---

## BASELINE vs AFTER

| Metric | Before Fixes | After Fixes |
|--------|-------------|-------------|
| Tests passing | 0 (all "Access denied") | 1278/1282 |
| TypeScript errors | 0 | 0 |
| Build errors | 0 | 0 |
| `state_code` bugs | 4 locations | 0 |
| `employment_status` case bugs | 9 locations | 0 |
