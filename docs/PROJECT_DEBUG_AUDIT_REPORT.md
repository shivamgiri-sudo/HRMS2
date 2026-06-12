# PROJECT DEBUG AUDIT REPORT
**Date:** 2026-06-12  
**Repo:** https://github.com/shivamgiri-sudo/HRMS1.git  
**Clone:** /c/tmp/HRMS1-debug-20260612  
**Base SHA:** 2202dc1

---

## ENVIRONMENT

- DB: MySQL `mas_hrms` @ `192.168.10.6:3306` (user: `shivam_user`)
- Backend: Express + TypeScript @ `localhost:5055`
- Frontend: React 18 + Vite + TypeScript
- Node: v24.15.0

---

## CONFIRMED BUGS & FIXES

### BUG-001 — `branch_master` has no `state_code` column (has `state`)
| Field | Value |
|-------|-------|
| **Severity** | HIGH — Silent wrong data |
| **Root Cause** | `branch_master` schema defines column as `state VARCHAR(100)`, not `state_code`. Professional tax slab lookup depends on `state_code` from `branch_master`. Query returned NULL for every employee. |
| **Affected Files** | `payroll/payrollCalculate.service.ts:219`, `payroll-compliance/payrollCalculate.service.ts:165`, `payroll-compliance/payrollCompliance.routes.ts:144,148` |
| **Fix** | `bm.state_code` → `bm.state AS state_code` in SELECT; `ORDER BY b.state` in PT register query |
| **Verified** | Live DB `SHOW COLUMNS FROM branch_master` confirms `state` not `state_code` |

### BUG-002 — `employment_status` case mismatch (capital 'A' vs lowercase 'a')
| Field | Value |
|-------|-------|
| **Severity** | CRITICAL — Payroll processes 0 employees |
| **Root Cause** | Live DB stores `employment_status = 'active'` (lowercase) for 1531 active employees. Several service files used `= 'Active'` (capital A). MySQL collation is case-sensitive for this column. |
| **Evidence** | `SELECT employment_status, COUNT(*) FROM employees GROUP BY employment_status` → `active: 1531`, `Resigned: 29635`, `inactive: 31433` |
| **Affected Files** | 9 files across payroll, compliance, RTA, WFM, reporting, portal, workforce-mandate modules |
| **Fix** | Replaced all direct comparisons with `LOWER(e.employment_status) = 'active'` |
| **Verified** | Backend tests 1278/1282 pass after fix |

### BUG-003 — dotenv password truncation (`#` treated as comment)
| Field | Value |
|-------|-------|
| **Severity** | CRITICAL — All DB integration tests fail |
| **Root Cause** | `DB_PASSWORD=qwersdfg!@#hjk` — dotenv treats `#` as start of comment, silently truncates to `qwersdfg!@`. Tests connected with wrong password → "Access denied" from MySQL. |
| **Affected File** | `backend/.env` |
| **Fix** | Quoted the value: `DB_PASSWORD="qwersdfg!@#hjk"` |
| **Verified** | 1278 tests now pass (was 0 passing before fix) |

---

## DATABASE VERIFICATION

### Tables Confirmed Present in Live DB (spot-checked)
| Table | Status |
|-------|--------|
| `salary_prep_run` | ✅ exists, columns correct |
| `salary_prep_line` | ✅ exists — extra cols `tds_amount`, `lwp_deduction`, `advance_recovery`, `gross_before_lwp`, `basic`, `hra`, `special_allowance` confirmed via ALTER migrations |
| `ats_candidate` | ✅ exists, `created_by` and `user_id` confirmed |
| `auth_user` | ✅ exists, `is_blocked`, `must_change_password` confirmed |
| `employees` | ✅ exists, both `manager_id` AND `reporting_manager_id` confirmed |
| `leave_request` | ✅ exists, `applied_at` confirmed |
| `salary_payslip` | ✅ exists, `generated_by`, `acknowledged_at`, `payslip_ref` confirmed |
| `pt_slab_master` | ✅ exists, `state_code` confirmed (correct on this table) |
| `kpi_score_detail` | ✅ exists |
| `attendance_daily_record` | ✅ exists |
| `performance_feedback_cycle` | ✅ exists |
| `work_inbox_item` | ✅ exists |

### employment_status Values (live data)
| Value | Count |
|-------|-------|
| `active` (lowercase) | 1531 |
| `Resigned` | 29635 |
| `inactive` (lowercase) | 31433 |

---

## SCHEMA vs CODE MISMATCHES (Verified Clean After Fixes)

| Column | Table | Schema | Code (Before Fix) | Fixed |
|--------|-------|--------|-------------------|-------|
| `state` | `branch_master` | `state VARCHAR(100)` | `bm.state_code` | ✅ |
| `employment_status` values | `employees` | `'active'` (live data) | `= 'Active'` | ✅ |

### BUG-004 — `payslip.service.ts` uses non-existent `run_id` column
| Field | Value |
|-------|-------|
| **Severity** | HIGH — All payslip generate/fetch calls would fail at runtime |
| **Root Cause** | `salary_payslip` table schema (migration 007) uses `prep_line_id` + `run_month`. Service had `INSERT ... (run_id, ...)` and `JOIN ON sp.run_id = spl.run_id` — `run_id` column does not exist. |
| **Affected File** | `payroll/payslip.service.ts` — `generatePayslip` (lines 64-74), `getPayslip` (lines 94-118), `acknowledgePayslip` (lines 128-148) |
| **Fix** | INSERT uses `(prep_line_id, employee_id, run_month, ...)` correctly; JOIN changed to `spl.id = sp.prep_line_id`; acknowledgePayslip re-fetches run_id via prep_line JOIN |
| **Verified** | 1278/1282 tests pass, 0 TS errors |

---

## AUDIT RESULTS — ATS, Leave, WFM

| Area | Finding | Severity |
|------|---------|----------|
| ATS recruiter queue | `recruiterName` override gated by `admin`/`hr` role only; parameterized correctly — no injection | OK |
| ATS `getMyPendingCandidates` | Uses `WHERE recruiter_assigned_name = ?` — parameterized | OK |
| Leave `leave_approval_log` INSERT | Parameters correctly ordered: `(leave_request_id=id, action=status, action_by=reviewerId, remarks)` | OK |
| WFM `wfm_roster_assignment` INSERT | `shift_start_time`/`shift_end_time` exist in live DB (added by migration 012) | OK |

---

## PENDING AUDIT ITEMS

- [x] ATS stage flow: verified clean — recruiter scope properly enforced
- [x] Payslip service: fixed (BUG-004 above)
- [x] Leave approval flow: verified clean — parameters correctly ordered
- [x] WFM roster: verified clean — columns exist in live DB
- [ ] Frontend typecheck/build (npm install completing)
- [ ] Push commits to remote (after all checks pass)
