# Employee Rejoin v3 — Design

Status: approved by owner 2026-10-03. Replaces the Reactivation flow in
`backend/src/modules/employees/employee-reactivation.routes.ts`.

## Problem

- Reactivation sets `employment_status='Active'` and clears `date_of_exit`, but leaves the old
  `exit_request` at `exited`. Payroll's end-date resolver
  (`payroll/employment-end-date.ts`) reads that row first, so a rejoined employee is likely
  prorated/zeroed from the old LWD. **Unverified on prod** — confirm via read-only ops
  workflow before shipping (build step 8).
- No rehire eligibility check: terminated / misconduct leavers can be reactivated by HR.
- `date_of_joining` is overwritten, losing the first stint (tenure, leave, PF/ESIC history).
- Approval is two-step (branch head, then HR) with no history shown to the approver.
- A returning leaver at ATS/joining creates a duplicate employee instead of a rejoin.

## Decisions

| Topic | Decision |
|---|---|
| Who raises | HR or the reporting manager (manager: only former reports / own scope) |
| Who approves | Branch head only; approval is final and triggers automatic activation |
| Absconded | Can rejoin, via the same path, with extra gates |
| Stints | Two stints, same employee id/code, unpaid gap, `date_of_joining` kept |
| Gap cap | > 30 days: refuse, require fresh ATS onboarding |

## Eligibility (computed status: blocked | review | eligible; not persisted)

Computed from `exit_request` at exit time, re-checked at raise and at approval.

**Blocked** (no override except super_admin "lift block" with written reason + audit):
- `exit_sub_type = termination`
- `exit_reason_category` in (`termination_misconduct`, `performance_action`)
- HR disciplinary flag set (new; reason, date, document; settable any time, including post-exit)

**Review** (allowed; flagged red on the dossier):
- absconding / abandonment — branch head must acknowledge and give remarks >= 20 chars; a second
  absconding is blocked; blocked automatically if a disciplinary flag or termination exists for
  that exit
- open NOC/clearance case, unreturned assets, F&F already paid, previous rejoin
- legacy exits with no usable signal (unknown never means eligible)

**Eligible:** resignation, mutual_separation, retirement, contract_end within the 30-day cap.
`did_not_join` is not a rejoin (new ATS joining).

Legacy backfill: nothing to backfill. `exit_request.rehire_status` is dropped; eligibility is
computed from live facts (exit rows, status text such as "Terminated - Misconduct", flags).

## Branch head dossier (one aggregated endpoint)

Auto-pulled when the request opens; nothing typed in.

1. Header: identity, process, branch, tenure, exit date/type/reason, proposed rejoin date
2. Verdict strip: Strong / Average / Weak + 3-5 plain-language reasons (advisory)
3. Attendance: present %, absent, LOP, regularizations, 12-month chart
   (`attendance_daily_record`, `attendance_regularization`)
4. Late coming: marks by month, average minutes late, worst month
5. KPI: monthly trend, best/worst, share of months at/above target
   (`kpi_score_summary`, `kpi_daily_actual`)
6. Leave: by type, planned vs unplanned, weekend-adjacent pattern
   (`leave_request`, `leave_balance_ledger`)
7. Learning: certifications, completion % (LMS tables)
8. Conduct: disciplinary flag, warnings, prior rejoin, earlier absconding episode
9. Exit file: reason, notice served, NOC/clearance outcome, assets, F&F status/amount
10. Payroll footprint: average net, last salary, pending recoveries
11. Timeline: joining, transfers, promotions, warnings, exit, request (`db_audit` + lifecycle tables)
12. Requester note: reason and proposed salary

Verdict thresholds are config values, starting at: attendance >= 90%, KPI at target in >= 60% of
months, fewer than 5 late marks a month. Page ends with Approve / Reject, both with remarks.

## Activation (single transaction on branch head approval)

1. Re-check eligibility; refuse with reason if changed
2. Close old `exit_request` as `rejoined`
3. Close any open NOC/clearance case as superseded
4. Insert new `employment_stint`
5. Employee Active, `date_of_exit = NULL`, `date_of_joining` unchanged
6. Re-provision login via the existing provisioning job
7. Restore leave balance if gap <= 30 days, else start fresh
8. Audit row; notify requester, HR, payroll

## Payroll

- Pay old stint through old LWD, new stint from rejoin date; gap unpaid and not LOP
- Split-month payslip behind a feature flag, off by default
- F&F already paid for the rejoin month: raise a recovery flag to payroll, never auto-deduct
- End-date resolver ignores `rejoined` exit rows and resolves from the active stint
- Attendance: days between old LWD and rejoin are "not employed", excluded from LOP and the
  heal worker

## Automation

- Branch head nudge day 2 and day 4; escalate after 5 days; shown in pending list
- ATS/joining duplicate match (Aadhaar, PAN, phone) against a former employee redirects to a
  rejoin request; a blocked leaver stops the joining and alerts HR
- Request with a past proposed date flagged for the requester to update
- Scope: branch head sees own branch only; reuse `isOrgWideUser` and existing scope helpers

## Reporting

Attrition counts the first exit once; rejoins appear as a separate rehire metric.

## Build order

1. Migration: `employment_stint`, side table `employee_rehire_control` (disciplinary flag fields and
   block lift; no ALTER on hot tables employees/exit_request, per tests/migration-hot-table-guard.test.ts),
   rejoin audit table, `rejoined` exit status
2. Eligibility + activation service
3. Dossier API (12 sections, verdict)
4. Branch head dossier page
5. HR/manager raise form with live eligibility panel
6. Payroll resolver + split month (flagged)
7. ATS duplicate catch, reminders, escalation
8. Read-only prod verification of stale-exit bug, backfill, live audit with a real login

## Testing

- Contract tests: blocked types cannot be raised or approved; gap > 30 refused; activation
  closes old exit and inserts stint atomically; resolver ignores `rejoined`
- Payroll: split-month totals against db_bill with flag on; unchanged with flag off
- Live audit with a real login per role (HR, manager, branch head) before reporting done
- No test writes on prod

## Out of scope

Gratuity/tenure policy beyond the 30-day continuity rule; a full disciplinary case module
(only the flag is added).
