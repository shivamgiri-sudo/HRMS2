# Post-Lock Roster/Attendance Correction & Reopen Workflow — Design

**Status:** DESIGN ONLY. No schema, service, or route code in this document has been built. Per the 2026-08-13 roster enterprise-controls closure order, this is item #9 — deliberately scoped separately from "roster lifecycle enterprise-complete," and must be designed and reviewed before implementation begins.

**Grounding:** every claim below about what exists today was verified by reading the live source, not assumed. See "What exists today" for file:line citations.

## Framing

`roster-lock-guard.ts` (built earlier in this round) closes the ordinary write paths — manual assignment, both bulk-upload paths, weekly generation, governance sync, shift-swap, manager realignment — against touching a roster date once `attendance_daily_record.is_locked = 1`. Its own docstring says why: *"a legitimate post-lock correction needs a separate, explicitly-authorized correction/reopen workflow, not the ordinary write path."* That workflow does not exist yet. This document designs it.

## Critical existing gap this design must resolve, not ignore

**A live, single-actor, unaudited, reason-free unlock endpoint already defeats the lock roster-lock-guard.ts was just built to enforce.**

`POST /api/wfm/attendance-engine/:employeeId/:date/unlock` (`backend/src/modules/wfm/attendance-engine.routes.ts:1013-1063`), gated only to `admin|wfm|super_admin`, runs:

```sql
UPDATE attendance_daily_record SET is_locked = 0, updated_at = NOW()
WHERE employee_id = ? AND record_date = ?
```

with:
- no reason/justification field at all,
- a single actor — no maker/checker, no second approver,
- no check against the owning `salary_prep_run`'s status (can unlock a date whose payroll is already `FINALIZED`/`disbursed`),
- **no audit log call of any kind** — confirmed no `logSensitiveAction`/`writeAuditLog`/`audit_action_log` reference anywhere in the file, only a `console.log`.

Any of the three roles that can reach this endpoint today can silently reopen a locked, payroll-consumed date, make no record of why, and nothing downstream would ever know. This is flagged here rather than fixed here: per this repo's standing rule, existing routes are not modified without a separate, explicit per-change approval. **The workflow below must supersede this endpoint's capability, and the endpoint itself should be locked down (removed or reduced to a break-glass path with the same controls as everything else here) as part of implementing this design — not left running in parallel with it.**

## What exists today (verified, not assumed)

| Concept | Reality |
|---|---|
| Lock signal | `attendance_daily_record.is_locked`, set in bulk by `freezeAttendance()` (`payroll-governance.service.ts:973-1019`) — one run-scoped operation across a branch/process and date range, not per employee/date. Also flips `salary_prep_run.attendance_snapshot_locked=1` and writes ONE `payroll_calculation_audit` row (`ATTENDANCE_FREEZE`) for the whole run, not per affected date. |
| Lock enforcement on roster writes | `roster-lock-guard.ts`, wired into all 8 known `wfm_roster_assignment` mutation sites (manual assignment, both bulk-upload paths, weekly generation, governance sync inserts/updates/delete, shift-swap, manager realignment/override — confirmed exhaustive via grep, no 9th site found). |
| Existing amendment trail for roster assignments | `roster-change-log.ts`'s `logRosterChange()` → `roster_change_log` (`020_roster_governance.sql`). Single-actor (one `changed_by`), best-effort (swallows its own insert failures), and **silently skips logging entirely when `cycle_id IS NULL`**. Not maker/checker, not reason-coded beyond free text, not linked to lock state. Three other roster engines each keep their own separate audit shape (`roster_decision_audit`, `wfm_roster_event_log`) — this design does not attempt to unify those; it adds a fourth, purpose-built table for corrections specifically. |
| Linkage between a roster/attendance row and the payroll run that consumed it | **None.** `salary_prep_run`/`salary_prep_line` (`007_payroll.sql:70-110`) store aggregated day-counts only, no FK to specific `attendance_daily_record` or `wfm_roster_assignment` row IDs. The only connection is `is_locked` + the date falling inside a run's `run_month`. `salary_prep_run.status` is a free `VARCHAR(50)`; the closed/settled set is centralized in `run-status.ts`'s `CLOSED_RUN_STATUSES = {"locked","disbursed","finalized"}`, compared case-insensitively via `isRunClosed()` because production genuinely stores mixed-case values (that file's own comment records an incident where casing let 51 already-finalized runs stay open to recomputation). |
| Maker/checker precedent already in this codebase | `budget-topup.service.ts:285-342`'s `review()` — the pattern to copy. Its load-bearing line: an explicit actor-identity check (`String(request.requested_by) === actorId` → throw), applied to BOTH approve and reject, inside a `FOR UPDATE` transaction, with a mandatory reason field enforced on reject. The identical shape recurs in `branch-budget.service.ts:1933-1970` (3-stage) and `grn.service.ts:494-514`, each with its own contract test asserting the self-approval rejection. **Do not** model this on `payroll.routes.ts:2380-2423`'s validate/reject pair — that one checks role only, not actor identity, so the same person can validate their own calculation; it looks similar but is the wrong precedent. |
| Prior art for a correction/reopen table specifically | None. No `roster_correction`, `attendance_correction`, `roster_reopen`, or similar table anywhere in `backend/sql/*.sql`, and no such migration was ever added and removed (checked via `git log --diff-filter=AD` on the whole migration directory). This is genuinely new schema, not a resurrection of abandoned work. |

## Design

### Principles (restating the user's own framing, now grounded in the above)

1. **Adjustment, not overwrite.** A correction records what changed and why, on top of the existing row/log — it does not silently rewrite `wfm_roster_assignment` or `attendance_daily_record` in place with no trace, the way today's raw `/unlock` does.
2. **Maker/checker, actor-identity enforced.** Follow `budget-topup.service.ts`'s pattern exactly: the approver must be a *different person* than the requester, checked by user ID, not role — a lone `admin` cannot both request and approve their own reopen.
3. **Reason-coded.** A fixed set of reason categories (e.g. `PAYROLL_DISPUTE`, `MISSED_PUNCH_RESOLVED_LATE`, `SYSTEM_ERROR_CORRECTION`, `MANAGER_ERROR`, `OTHER`) plus a mandatory free-text explanation — not a bare string, so the eventual coverage/audit reporting (mirroring `minimum-rest-policy-coverage-report.ts`'s own posture) can categorize without text-mining.
4. **Payroll-closure-aware.** Before any reopen is even requestable, check whether the owning `salary_prep_run` (resolved via `run_month` matching the target date, same lookup `isRunClosed()`/`CLOSED_RUN_STATUSES` already codifies) is closed. A closed run does not forbid a correction outright — real corrections to finalized payroll happen — but it changes the workflow: closed-run reopens require an *additional* Payroll sign-off step beyond WFM/manager approval, since the correction may need to flow into an F&F/arrears adjustment rather than just a re-generated roster day.
5. **Fully audited, not best-effort.** Unlike `roster_change_log`'s swallow-on-failure posture, a correction request's own row IS the audit trail — if the INSERT fails, the request never existed, which is the correct failure mode for something whose entire purpose is being provable later. No `cycle_id IS NULL` carve-out: every correction gets a row regardless of whether the underlying assignment came from a cycle-based engine or not.
6. **Time-boxed reopen.** A reopen is not a permanent unlock — it grants a correction window (e.g. 24-72 hours, configurable) for the specific employee/date, after which the date re-locks automatically unless a further reopen is requested. This bounds the blast radius of a single approval and removes the need to remember to "re-lock" manually.

### Proposed schema (draft — not yet reviewed for migration certification)

```
roster_correction_request
  id                    CHAR(36) PK
  employee_id           CHAR(36) NOT NULL
  roster_date           DATE NOT NULL
  correction_type       ENUM('roster_assignment','attendance_record','both') NOT NULL
  reason_code           ENUM('PAYROLL_DISPUTE','MISSED_PUNCH_RESOLVED_LATE',
                              'SYSTEM_ERROR_CORRECTION','MANAGER_ERROR','OTHER') NOT NULL
  reason_detail         TEXT NOT NULL  -- mandatory, no bare-minimum placeholder accepted
  requested_by          CHAR(36) NOT NULL
  requested_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  status                ENUM('pending_wfm_approval','pending_payroll_approval',
                              'approved_reopened','rejected','expired','applied') NOT NULL
  owning_run_id         CHAR(36) NULL       -- resolved salary_prep_run.id if the date falls in a closed run, else NULL
  owning_run_was_closed  TINYINT(1) NOT NULL DEFAULT 0  -- snapshot at request time, so later run-status changes don't rewrite history
  wfm_approved_by        CHAR(36) NULL
  wfm_approved_at        TIMESTAMP NULL
  payroll_approved_by    CHAR(36) NULL      -- required only when owning_run_was_closed = 1
  payroll_approved_at    TIMESTAMP NULL
  rejected_by            CHAR(36) NULL
  rejected_at            TIMESTAMP NULL
  rejection_reason       TEXT NULL
  reopen_window_expires_at TIMESTAMP NULL   -- set on approval; roster-lock-guard consults this, not a bare is_locked flip
  applied_change_summary JSON NULL          -- what was actually changed once the correction was made, filled on status='applied'
  created_at / updated_at TIMESTAMP ...
  INDEX (employee_id, roster_date, status)
  INDEX (owning_run_id)
```

Deliberately no `is_locked` column touched directly by this table. Instead, `roster-lock-guard.ts`'s check becomes:

```
locked = attendance_daily_record.is_locked = 1
         AND NOT EXISTS (an approved roster_correction_request for this employee/date
                          with reopen_window_expires_at > NOW())
```

This is additive to the existing guard — no change to `attendance_daily_record` itself, no change to `freezeAttendance()`, and the existing 8 write-path call sites need no change to their own logic, only to what `checkEmployeeDateNotLocked`/`checkAssignmentDateNotLocked` consult internally.

### Workflow states

```
pending_wfm_approval
  → (WFM/manager approves, run not closed)     → approved_reopened
  → (WFM/manager approves, run IS closed)      → pending_payroll_approval
  → (WFM/manager rejects)                      → rejected

pending_payroll_approval
  → (Payroll approves)                         → approved_reopened
  → (Payroll rejects)                          → rejected

approved_reopened
  → (window expires with no write made)        → expired
  → (a correcting write is actually made,
     logged via logRosterChange + this table's
     applied_change_summary)                   → applied
```

Every transition requires `String(actor_id) !== String(requested_by)` (or, for the second approval stage, `!== wfm_approved_by` too — a chain of three distinct people for a closed-run reopen: requester, WFM approver, Payroll approver), mirroring `budget-topup.service.ts:302-309` exactly, including applying the same check symmetrically to rejection.

### API surface (sketch, not final)

- `POST /api/roster/corrections` — create a request (any role with the existing roster-write permission for that employee's scope)
- `GET /api/roster/corrections?status=&employeeId=&fromDate=&toDate=` — queue view, scoped by role same as other WFM queues
- `POST /api/roster/corrections/:id/approve` — WFM/manager stage
- `POST /api/roster/corrections/:id/approve-payroll` — Payroll stage, only reachable/required when `owning_run_was_closed=1`
- `POST /api/roster/corrections/:id/reject` — either stage, reason mandatory
- The actual correcting write still goes through the *existing* write paths (manual assignment, etc.) — this workflow only ever grants a time-boxed exception to the lock guard, it does not reimplement roster-write logic itself. `applied_change_summary` is populated by whichever write path consumes the open window, via the same `logRosterChange` call already in place, extended to check for and reference an open `roster_correction_request`.

### Disposition of the existing raw `/unlock` endpoint

Recommend: once this workflow ships, `attendance-engine.routes.ts:1013-1063`'s unlock endpoint either
(a) is removed and replaced by "approve a `roster_correction_request`" as the only reopen path, or
(b) if an emergency break-glass path is genuinely still wanted, it gets the same reason-mandatory + audit-logged + time-boxed treatment as everything else here, not left as a bare `UPDATE`.
This is a recommendation for the implementation phase, not something this document changes — the endpoint is untouched today.

## What this document does not do

- No migration file. No service code. No route code. No RBAC grants.
- Does not resolve which roles specifically sit in "WFM/manager approval" vs. "Payroll approval" for every org structure — that needs the same kind of role-mapping confirmation this program's other closure items required before activation.
- Does not address `roster_change_log`'s `cycle_id IS NULL` gap directly — a correction request's own row is the audit trail regardless, so it doesn't depend on that table being complete, but that gap remains open for the *ordinary* (non-correction) write paths and is a separate, smaller fix.
- Does not change `freezeAttendance()`'s bulk, run-scoped locking behavior — reopen is deliberately per-employee/per-date, not a run-wide unlock.

## Relationship to the rest of the closure order

This was explicitly scoped by the user as separate from "roster lifecycle enterprise-complete" — implementation should not begin until this design has been reviewed, and should follow the same activation sequence already established for the rest of this program: code → migration certification → migration apply → configuration (role mapping, reason-code list, reopen window duration) → coverage/audit reporting → UAT → sign-off → runtime activation.
