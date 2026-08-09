# API Route Gap Matrix

**Status:** `NOT FINAL — PENDING_SERVER_CI_EXECUTION`

This matrix must NOT be marked "MVP Complete" until `docs/MVP_VALIDATION_PENDING_STATUS.md` is updated to GO and smoke test evidence is attached.

---

## WFM Auto Roster — MVP Routes

| Method | Path | Handler File | Role(s) | Migration | Smoke | Status |
|--------|------|-------------|---------|-----------|-------|--------|
| GET | /api/wfm/planning-rules | wfm.routes.ts | wfm, hr, manager | 232 | ⏸ | PENDING |
| POST | /api/wfm/planning-rules | wfm.routes.ts | wfm | 232 | ⏸ | PENDING |
| PATCH | /api/wfm/planning-rules/:id | wfm.routes.ts | wfm | 232 | ⏸ | PENDING |
| DELETE | /api/wfm/planning-rules/:id | wfm.routes.ts | wfm | 232 | ⏸ | PENDING |
| GET | /api/wfm/slot-requirements | wfm.routes.ts | wfm, hr, manager | 233 | ⏸ | PENDING |
| POST | /api/wfm/slot-requirements | wfm.routes.ts | wfm | 233 | ⏸ | PENDING |
| PATCH | /api/wfm/slot-requirements/:id | wfm.routes.ts | wfm | 233 | ⏸ | PENDING |
| DELETE | /api/wfm/slot-requirements/:id | wfm.routes.ts | wfm | 233 | ⏸ | PENDING |
| GET | /api/wfm/weekoff/day-rules | wfm.routes.ts | wfm, hr, manager | 234 | ⏸ | PENDING |
| POST | /api/wfm/weekoff/day-rules | wfm.routes.ts | wfm | 234 | ⏸ | PENDING |
| DELETE | /api/wfm/weekoff/day-rules/:id | wfm.routes.ts | wfm | 234 | ⏸ | PENDING |
| POST | /api/wfm/roster/acknowledge | wfm.regularization.secure.routes.ts | employee | 228 | ⏸ | PENDING |
| GET | /api/wfm/roster/pending-acknowledgement | wfm.regularization.secure.routes.ts | employee | 228 | ⏸ | PENDING |
| GET | /api/wfm/manager/pending-reviews | wfm.routes.ts | manager | 229 | ⏸ | PENDING |
| POST | /api/wfm/manager/realign | wfm.routes.ts | manager (scoped) | 229 | ⏸ | PENDING |
| POST | /api/wfm/manager/force-approve | wfm.routes.ts | manager (scoped) | 229 | ⏸ | PENDING |
| POST | /api/wfm/manager/escalate | wfm.routes.ts | manager (scoped) | 229 | ⏸ | PENDING |
| POST | /api/wfm/manager/reject-request | wfm.routes.ts | manager (scoped) | 229 | ⏸ | PENDING |
| GET | /api/rta/final-roster-state | rta routes | hr, wfm, rta | 230 | ⏸ | PENDING |

---

## Attendance Dispute — Phase 3 Routes

| Method | Path | Handler File | Role(s) | Migration | Smoke | Status |
|--------|------|-------------|---------|-----------|-------|--------|
| GET | /api/attendance/disputes | attendance.dispute.routes.ts | all (scoped) | 237 | ⏸ | PENDING |
| GET | /api/attendance/disputes/:id | attendance.dispute.routes.ts | all (scoped) | 237 | ⏸ | PENDING |
| POST | /api/attendance/disputes/:id/manager-action | attendance.dispute.routes.ts | manager (scoped) | 237 | ⏸ | PENDING |
| POST | /api/attendance/disputes/:id/hr-action | attendance.dispute.routes.ts | hr, wfm | 237 | ⏸ | PENDING |
| POST | /api/attendance/disputes/:id/payroll-action | attendance.dispute.routes.ts | payroll_head, super_admin | 237 | ⏸ | PENDING |

---

## Payroll Head Manual Override — Phase 4 Routes

| Method | Path | Handler File | Role(s) | Migration | Smoke | Status |
|--------|------|-------------|---------|-----------|-------|--------|
| POST | /api/attendance/manual-overrides | attendance.manual-override.routes.ts | payroll_head | 238 | ⏸ | PENDING |
| GET | /api/attendance/manual-overrides | attendance.manual-override.routes.ts | payroll_head, admin, super_admin | 238 | ⏸ | PENDING |
| GET | /api/attendance/manual-overrides/:id | attendance.manual-override.routes.ts | payroll_head, admin, super_admin | 238 | ⏸ | PENDING |
| POST | /api/attendance/manual-overrides/:id/approve | attendance.manual-override.routes.ts | super_admin (locked), payroll_head (unlocked) | 238 | ⏸ | PENDING |
| POST | /api/attendance/manual-overrides/:id/reject | attendance.manual-override.routes.ts | payroll_head, super_admin | 238 | ⏸ | PENDING |

---

## Audit Log + CSV Export — Phase 5 Routes

| Method | Path | Handler File | Role(s) | Migration | Smoke | Status |
|--------|------|-------------|---------|-----------|-------|--------|
| GET | /api/access/audit-log | audit.log.routes.ts | admin, super_admin, payroll_head, hr, wfm | 237 (sensitive_action_log cols) | ⏸ | PENDING |
| POST | /api/audit/export | audit.log.routes.ts | admin, super_admin, payroll_head, hr, wfm | 237 | ⏸ | PENDING |

---

## Existing Core Routes (Pre-MVP, Preserved)

These routes are NOT part of the MVP validation scope but must not be broken.

| Method | Path | Module | Status |
|--------|------|--------|--------|
| POST | /api/auth/login | auth | Existing — do not touch |
| GET | /api/employees | employees | Existing — do not touch |
| GET | /api/leave/\* | leave | Existing — do not touch |
| GET | /api/payroll/\* | payroll | Existing — foundation only |
| GET | /api/kpi/\* | kpi | Existing — do not touch |
| GET | /api/portal/\* | portal | Existing — do not touch |
| GET | /api/ats/\* | ats | Existing — do not touch |
| GET | /api/exit/\* | exit | Existing — do not touch |
| GET | /api/rta/\* | rta | Existing — scoped to approved rosters only |
| GET | /api/integration-hub/\* | integration-hub | Existing — do not touch |
| GET | /api/reports/\* | reporting | Existing — do not touch |
| GET | /api/wfm/attendance/\* | attendance engine | Existing — do not touch |
| GET | /api/wfm/biometric-punch/\* | biometric | Existing — do not touch |
| GET | /api/wfm/cosec-sync/\* | cosec | Existing — do not touch |

---

## Route Counts

| Group | Total Routes | Smoke Tested | Smoke Passed | Gap |
|-------|-------------|--------------|--------------|-----|
| WFM Auto Roster | 19 | ⏸ 0 | ⏸ 0 | All pending |
| Attendance Dispute | 5 | ⏸ 0 | ⏸ 0 | All pending |
| Manual Override | 5 | ⏸ 0 | ⏸ 0 | All pending |
| Audit Log | 2 | ⏸ 0 | ⏸ 0 | All pending |
| **MVP Total** | **31** | **0** | **0** | **All pending CI** |

---

## Security Guards Verified Per Route

| Route | Guard | Verified |
|-------|-------|---------|
| /api/wfm/manager/force-approve | hasScopedAccess() — manager can only act on own team | ⏸ pending |
| /api/wfm/manager/escalate | hasScopedAccess() — manager can only act on own team | ⏸ pending |
| /api/wfm/manager/reject-request | hasScopedAccess() — manager can only act on own team | ⏸ pending |
| /api/attendance/disputes/:id/manager-action | payroll_impact disputes blocked for manager approve | ⏸ pending |
| /api/attendance/disputes/:id/hr-action | payroll_impact disputes blocked for HR direct approve | ⏸ pending |
| /api/attendance/manual-overrides (POST) | payroll_head only | ⏸ pending |
| /api/attendance/manual-overrides/:id/approve | locked month → super_admin only | ⏸ pending |
| /api/rta/final-roster-state | only approved statuses (not draft/pending) | ⏸ pending |
| /api/access/audit-log | role-scoped: payroll_head sees payroll/attendance only | ⏸ pending |
| /api/audit/export | role-scoped: same as GET audit-log | ⏸ pending |

---

## How to Update This Matrix After CI Run

1. Run `npm run phase2:smoke` — check output JSON
2. For each passing route: change `⏸ PENDING` → `✅ PASSED` with HTTP status
3. For each failing route: change to `❌ FAILED` with actual vs expected status
4. Update Route Counts table with final numbers
5. Update Status header from `NOT FINAL` to `FINAL — VALIDATED <date>`
6. Commit evidence files: `phase2-describe-output.json`, `phase2-smoke-output.json`

---

**Last Updated:** 2026-06-20  
**Validation Status:** `NOT FINAL — PENDING_SERVER_CI_EXECUTION`  
**Do not mark this as MVP Complete until smoke test evidence is attached.**
