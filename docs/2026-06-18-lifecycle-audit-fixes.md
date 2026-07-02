# ATS → Onboarding → Employee → Exit Lifecycle Audit — 2026-06-18

## Summary

Full end-to-end audit and fix of the MAS HRMS employee lifecycle across 28 identified gaps.

---

## Gaps Fixed

### TIER 1 — Critical

| Gap | Description | Files |
|-----|-------------|-------|
| GAP-01 | Walkin queue empty — wrong column `role_applied` vs `applied_for_role`, `token_number` NULL | `queue.enhanced.service.ts`, `ats.service.ts` |
| GAP-02 | `rotational_shift` TINYINT receiving string "Yes"/"No" | `NativeATSCandidateRegistration.tsx`, `ats.validation.ts` |
| GAP-03 | Recruiter email/mobile not showing — wrong column `official_email` vs `office_email` | `ats-form-config.service.ts`, `NativeATSCandidateRegistration.tsx` |
| GAP-04 | OCR resume extractor broken — Tesseract race condition | `NativeATSCandidateRegistration.tsx` |
| GAP-05 | Backend startup hangs on DB connection timeout | `runPendingMigrations.ts`, `server.ts` (SKIP_MIGRATIONS + 8s timeout) |
| GAP-07 | Interview selection does not auto-generate onboarding token | `interview.service.ts` — token generated even without email |

### TIER 2 — High

| Gap | Description | Files |
|-----|-------------|-------|
| GAP-08 | `ats_onboarding_request` UNIQUE key verified on `candidate_id` | DB verified ✅ |
| GAP-09 | S10 ReviewSubmit allowed submit without bank/qualifications | `S10_ReviewSubmit.tsx` — pre-flight check + red banner |
| GAP-10 | S6 Qualifications allowed zero entries | `S6_Qualifications.tsx` — minimum 1 required, per-row error |
| GAP-11 | Token expiry not re-validated on each POST | `onboarding-full.service.ts` — `validateOnboardingToken()` at top of all handlers |
| GAP-12 | Three status fields out of sync | `onboarding-full.service.ts` — `syncOnboardingStatus()` helper |
| GAP-13 | HR cannot see BGV scores when reviewing | `NativeHROnboardingRequests.tsx` — BGV panel added |
| GAP-15 | Offer rejection had no candidate notification | `ats.onboarding.service.ts` — rejection email wired |
| GAP-16 | Branch head approval emails were TODO stubs | `branch-head-approval.service.ts` — emails wired |

### TIER 3 — Medium

| Gap | Description | Files |
|-----|-------------|-------|
| GAP-17 | Leave balance not initialized on employee join | `onboarding-full.service.ts` — `INSERT IGNORE INTO leave_balance_ledger` for all active types |
| GAP-18 | Salary assignment not auto-created from ATS | `onboarding-full.service.ts` — `INSERT INTO employee_salary_assignment` with first available structure |
| GAP-19 | Exit → F&F settlement not auto-triggered | `exit.service.ts` — F&F record (status=draft) created on exit |
| GAP-21 | No exit notification to manager | `exit.service.ts` — `notifyManagerOfResignation()` fire-and-forget |

### TIER 4 — Quality

| Gap | Description | Files |
|-----|-------------|-------|
| GAP-27 | UAN/ESIC format not validated | `S4_StatutoryIds.tsx` — UAN 12-digit, ESIC 17-digit regex |

---

## New Features Added

### `date_of_salary` — Unpaid Training Period Support

`ats_employment_offer.date_of_salary` is now used as `salary_start_date` in the `employees` table when set, falling back to `date_of_joining`. This allows processes where training is unpaid after joining.

**Files:** `onboarding-full.service.ts` (`approveOffer()`), `NativeHROnboardingRequests.tsx` (helper text)

---

## DB Verifications (run 2026-06-18)

| Table | Check | Result |
|-------|-------|--------|
| `leave_balance_ledger` | UNIQUE KEY `uq_emp_leave_year (employee_id, leave_type_id, balance_year)` | ✅ Confirmed |
| `salary_structure_master` | Active structures count | ✅ 1,257 |
| `full_final_calculation` | UNIQUE KEY `uq_ff_exit (exit_request_id)`, status enum = `draft/verified/approved/paid` | ✅ Confirmed |
| `ats_onboarding_request` | UNIQUE KEY on `candidate_id` | ✅ Confirmed |

---

## Bug Fixes (post-audit)

### Attendance History — dates all same
- `MyAttendanceHistory` was fetching `/api/wfm/attendance/daily` with no `employeeId` or date range
- Fixed: passes `employeeId` + `fromDate`/`toDate` (last 30 days); uses `date+"T00:00:00"` to avoid UTC shift

### Attendance page calendar broken
- `AttendanceCalendar` was receiving `user.id` (auth UUID) instead of `currentEmployee.id` (employee UUID)
- Fixed: now passes `currentEmployee.id` and only renders after employee record loads

---

## Test Onboarding Token (demo)

```
http://localhost:5173/onboard-full?token=16bf024d-824f-4a07-bba7-4439fb53a898-e2536e82-91a5-44cf-adf3-f48c3bcb3f2b
```
Candidate: shivam shiv giri — expires 2026-06-25

---

## Backend Startup

```bash
cd backend && SKIP_MIGRATIONS=true NODE_ENV=development npx tsx src/server.ts
```
