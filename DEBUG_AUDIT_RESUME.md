# DEBUG AUDIT RESUME
**Last SHA:** 2202dc1  
**Session Date:** 2026-06-12  
**Status:** Backend fixes complete, tests passing. Frontend install in progress.

---

## BASELINE RESULTS (Before Fixes)

### Backend
| Check | Result |
|-------|--------|
| `npm install` | ✅ OK |
| `tsc --noEmit` (typecheck) | ✅ 0 errors |
| `tsc` (build) | ✅ 0 errors |
| `vitest run` | ✅ 79/79 files pass, 1278/1282 tests pass (4 skipped) |

### Database
| Check | Result |
|-------|--------|
| Connection `192.168.10.6:3306 / mas_hrms` | ✅ Connected |
| Active employees | 1531 |
| Total tables | 368 |
| `employment_status` values | `'active'` (lowercase) in live DB |

### Root Cause of Initial Test Failures
`.env` `DB_PASSWORD=qwersdfg!@#hjk` — dotenv treated `#` as comment, password was silently truncated to `qwersdfg!@`. Fixed by quoting: `DB_PASSWORD="qwersdfg!@#hjk"`.

---

## BUGS FIXED

### Bug 1 — `branch_master.state_code` does not exist (column is `state`)
**Files Fixed:**
- `backend/src/modules/payroll/payrollCalculate.service.ts:219` — `bm.state_code` → `bm.state AS state_code`
- `backend/src/modules/payroll-compliance/payrollCalculate.service.ts:165` — same fix
- `backend/src/modules/payroll-compliance/payrollCompliance.routes.ts:144,148` — `b.state_code` → `b.state AS state_code`, `ORDER BY b.state`

**Impact:** PT slab lookup was returning NULL for all employees → wrong professional tax on every payslip.

### Bug 2 — `employment_status = 'Active'` (capital A) but live DB stores `'active'` (lowercase)
**Files Fixed:**
- `backend/src/modules/payroll/payrollCalculate.service.ts:225` — changed to `LOWER(...) = 'active'`
- `backend/src/modules/compliance/compliance.service.ts:103` — same
- `backend/src/modules/payroll/payroll.service.ts:73` — same
- `backend/src/modules/portal/portal.attrition.service.ts:36` — same
- `backend/src/modules/rta/rta.routes.ts:267` — same
- `backend/src/modules/wfm/attendance-engine.service.ts:399` — same
- `backend/src/modules/employees/employee.routes.ts:77` — same
- `backend/src/modules/reporting/reporting.service.ts:51` — same
- `backend/src/modules/workforce-mandate/workforce.mandate.service.ts:200,267,323` — same

**Impact:** Payroll calculation found 0 employees. Attrition reports, RTA board, attendance engine, compliance all returned wrong/zero results.

### Bug 3 — `.env` DB password truncated by dotenv (# treated as comment)
**File Fixed:** `backend/.env` — quoted password: `DB_PASSWORD="qwersdfg!@#hjk"`

**Impact:** All integration tests were failing with "Access denied" from DB.

---

## TEST RESULTS (After Fixes)

```
Backend vitest run:
  Test Files  79 passed (79)
  Tests       1278 passed | 4 skipped (1282)
  Duration    ~19s
  
Backend tsc --noEmit: 0 errors
Backend tsc (build):  0 errors
```

---

## PENDING

- [ ] Frontend `npm install` (in progress)
- [ ] Frontend `tsc --noEmit` (typecheck)
- [ ] Frontend `npm run build`
- [ ] Deep audit: ATS, payslip, leave, WFM routes end-to-end
- [ ] Role-access security matrix validation
- [ ] Create full docs (PROJECT_DEBUG_AUDIT_REPORT.md, ROUTE_API_DB_UI_MATRIX.md, BUG_FIX_TEST_MATRIX.md, ROLE_ACCESS_SECURITY_MATRIX.md)
- [ ] Commit all fixes

---

## NEXT EXACT COMMAND

```bash
cd /c/tmp/HRMS1-debug-20260612
npx tsc --noEmit
npm run build
```

Then commit:
```bash
cd /c/tmp/HRMS1-debug-20260612
git add backend/src/modules/payroll/payrollCalculate.service.ts \
        backend/src/modules/payroll-compliance/payrollCalculate.service.ts \
        backend/src/modules/payroll-compliance/payrollCompliance.routes.ts \
        backend/src/modules/compliance/compliance.service.ts \
        backend/src/modules/payroll/payroll.service.ts \
        backend/src/modules/portal/portal.attrition.service.ts \
        backend/src/modules/rta/rta.routes.ts \
        backend/src/modules/wfm/attendance-engine.service.ts \
        backend/src/modules/employees/employee.routes.ts \
        backend/src/modules/reporting/reporting.service.ts \
        backend/src/modules/workforce-mandate/workforce.mandate.service.ts \
        backend/.env
git commit -m "fix: payroll state_code column and employment_status case sensitivity"
```
