# Exit Flow Redesign — Faster, Smoother, Compliant
**Date:** 2026-09-23  
**Status:** Approved

---

## 1. Problem Statement

The current exit flow has 8 FSM states and 11+ manual clicks before a case closes:
- Two approval gates (manager + HR) for voluntary resignation
- Manual "Generate clearance tasks" button
- F&F requires 4 separate actions (create → verify → approve → paid)
- No auto-advancement when conditions are met
- No email notifications for approvals or clearance tasks

This spec redesigns the flow to 4 active states with auto-triggers, removes the HR acceptance gate for voluntary exits, and adds email + WhatsApp notifications at every key handoff.

---

## 2. New FSM

### 2.1 States

| State | Meaning |
|---|---|
| `submitted` | Employee submitted resignation |
| `returned` | Manager rejected with reason; employee must correct and resubmit |
| `notice_active` | Manager approved; notice period running; clearance tasks active |
| `exited` | Auto: LWD reached AND all tasks cleared |
| `closed` | F&F paid |
| `revoked` | Employee revoked resignation (allowed from `submitted` or `notice_active`, before `exited`) |
| `terminated` | Involuntary exit created by HR (termination / absconding / contract_end / abandonment) |

### 2.2 Voluntary Flow

```
Employee submits
  → [submitted]
  → Manager notified (email + WhatsApp + in-app)
  → Manager: Approve → [notice_active]
             Reject (reason required) → [returned] → Employee corrects + resubmits → [submitted]
  → On notice_active: 8 clearance tasks auto-created; each owner notified (email + WhatsApp)
  → LWD = submission_date + notice_period_days (fixed at submission, shown immediately)
  → Nightly job: LWD reached AND all tasks cleared → [exited] (auto)
  → Payroll HR / Payroll Head / Super Admin: Approve F&F → Mark Paid → [closed]
```

Employee can revoke from `submitted` or `notice_active` at any time before `exited`.

### 2.3 Involuntary Flow

```
HR creates exit (termination / absconding / contract_end / abandonment)
  → [terminated] immediately (no manager gate)
  → 8 clearance tasks auto-created; each owner notified (email + WhatsApp)
  → LWD:
      absconding / abandonment → creation date (no notice)
      termination / contract_end → HR-specified date
  → Nightly job: LWD reached AND all tasks cleared → [exited] (auto)
  → F&F → [closed]
      absconding / abandonment: F&F with zero earned leave (configurable)
```

---

## 3. Key Changes from Current Flow

| Current | New |
|---|---|
| 8 FSM states | 4 active states (+ 3 terminal) |
| HR acceptance gate (voluntary) | Removed — manager-only gate |
| Manual "Generate clearance tasks" | Auto on `notice_active` / `terminated` |
| Manual "Move to notice serving" | Removed — auto on manager approval |
| Manual "Move to exited" | Removed — nightly auto-advance job |
| F&F: 4 steps | F&F: 2 steps (approve → paid) |
| No push-back from manager | Manager can reject with reason → `returned` |
| Employee cannot revoke after submission | Employee can revoke until `exited` |
| No email notifications | Email + WhatsApp at every handoff |

---

## 4. LWD Calculation

**Fixed at submission time.** Formula:

```
LWD = submission_date + notice_period_days
```

Where `notice_period_days` comes from the employee's contract/designation notice period (from `employee_designations` or HR override field on the submission form).

Manager approval does **not** shift LWD.  
HR may override LWD post-acceptance (with audit reason) — stored as `lwd_override` with `lwd_override_reason`.

---

## 5. Clearance Tasks

### 5.1 Auto-generation

Trigger: status transitions to `notice_active` or `terminated`.  
8 tasks created (one per area) with `status = pending`, notifying the area owner.  
Idempotent — second call does nothing if tasks already exist.

### 5.2 Role Gate

Kept from spec v2 (`CLEARANCE_ROLE_MAP`). Only `cleared` and `waived` are role-gated.  
`waived` requires a non-blank `clearing_reason`.

### 5.3 Audit Columns (from spec v2)

`exit_clearance_task` gains: `cleared_by_name`, `cleared_by_role`, `clearing_reason`.

---

## 6. F&F — 2 Steps

Old: create → verify → approve → paid (4 actions, 4 actors)  
New: approve → paid (2 actions)

| Step | Who | Action |
|---|---|---|
| Approve | Branch Payroll HR / Payroll Head / Super Admin | Reviews computed F&F, clicks "Approve" |
| Mark Paid | Same roles | Enters payment reference, clicks "Mark Paid" |

`is_ff_provisional` flag removed from the new flow — the computed F&F is ready to approve directly.  
Old `verified_by` / `verified_at` columns retained in the table for backward-compat but no longer required as a gate.

Auto-compute runs when F&F record is created (salary components, leave encashment, advances, notice recovery).

---

## 7. Notifications

### 7.1 Channels

Dispatched via the existing `communication` module (`dispatch.service.ts`). Both email and WhatsApp sent for every event. In-app notification also created.

### 7.2 Event Map

| Event | Recipients | Subject / Message |
|---|---|---|
| Resignation submitted | Direct manager | "Resignation submitted — [Employee Name], LWD: [date]" |
| Manager approved | Employee | "Your resignation has been acknowledged. LWD: [date]" |
| Manager rejected (returned) | Employee | "Your resignation was returned: [reason]. Please resubmit after correction." |
| Clearance task assigned | Each task owner | "Clearance task assigned: [area] for [Employee Name], LWD: [date]" |
| Task cleared/waived | Employee + HR | "[Area] clearance completed by [Name]" |
| All tasks cleared | HR + Payroll | "All clearance tasks done for [Employee Name] — pending LWD" |
| Auto-exited (LWD reached) | HR + Payroll + Employee | "[Employee Name] has exited. Please initiate F&F." |
| F&F approved | Employee | "Your Full & Final settlement has been approved." |
| F&F paid | Employee | "Your Full & Final payment has been processed. Ref: [ref]" |
| Resignation revoked | Manager + HR | "[Employee Name] has revoked their resignation." |
| Involuntary exit created | Employee + Manager | "Notice of [exit_sub_type] raised. LWD: [date]. Please contact HR." |

### 7.3 Email Templates

New templates added to `email-templates` module:
- `exit_resignation_submitted` — for manager
- `exit_manager_decision` — approval or rejection variant (param-driven)
- `exit_clearance_assigned` — for each clearance area owner
- `exit_auto_exited` — for HR/payroll trigger
- `exit_ff_approved` — for employee
- `exit_ff_paid` — for employee

---

## 8. Auto-Advance Job

A scheduled cron (daily at 00:30 IST) runs:

```sql
SELECT er.id, er.employee_id, er.last_working_date
FROM exit_requests er
WHERE er.status IN ('notice_active', 'terminated')
  AND er.last_working_date <= CURDATE()
  AND NOT EXISTS (
    SELECT 1 FROM exit_clearance_task ect
    WHERE ect.exit_request_id = er.id
      AND ect.status NOT IN ('cleared', 'waived', 'not_applicable')
  )
```

For each matching row:
1. Transition status → `exited`
2. Write `exit_approval_log` entry (actor = `system`, role = `system`)
3. Dispatch `exit_auto_exited` notification to HR + Payroll + Employee

If LWD is reached but tasks are still open: **no auto-advance**. Command Center shows a "Pending clearance — LWD passed" warning badge.

---

## 9. Migrations

Three additive SQL files (no destructive changes):

### Migration 073 — exit_requests status enum + LWD override columns
```sql
ALTER TABLE exit_requests
  MODIFY COLUMN status ENUM(
    'draft','submitted','returned','notice_active',
    'exited','closed','revoked','terminated',
    'withdrawn','notice_serving','manager_review','accepted'  -- kept for legacy rows
  ) NOT NULL DEFAULT 'submitted',
  ADD COLUMN lwd_override        DATE         NULL AFTER last_working_date,
  ADD COLUMN lwd_override_reason VARCHAR(700) NULL AFTER lwd_override,
  ADD COLUMN return_reason       VARCHAR(700) NULL AFTER lwd_override_reason;
```

### Migration 074 — exit_clearance_task audit columns (from spec v2)
```sql
ALTER TABLE exit_clearance_task
  ADD COLUMN cleared_by_name   VARCHAR(140) NULL AFTER cleared_by,
  ADD COLUMN cleared_by_role   VARCHAR(80)  NULL AFTER cleared_by_name,
  ADD COLUMN clearing_reason   VARCHAR(700) NULL AFTER cleared_by_role;
```

### Migration 075 — full_final_calculation simplify + verify audit (from spec v2)
```sql
ALTER TABLE full_final_calculation
  ADD COLUMN verified_by         CHAR(36)     NULL AFTER is_ff_provisional,
  ADD COLUMN verified_by_name    VARCHAR(140) NULL AFTER verified_by,
  ADD COLUMN verified_at         DATETIME     NULL AFTER verified_by_name,
  ADD COLUMN verification_reason VARCHAR(700) NULL AFTER verified_at;
```

---

## 10. Architecture — Files Touched

| File | Change |
|---|---|
| `exit-intelligence.service.ts` | Branch scoping in `getExitCommandCenter(scope)`; auto-clearance task trigger on status change; remove manual generate endpoint |
| `exit.routes.ts` | New FSM transitions; `CLEARANCE_ROLE_MAP` gate; write audit columns; wire notifications |
| `exit.fsm.ts` (new) | Extract FSM transition table + validator into dedicated file |
| `exit.notifications.ts` (new) | All exit notification dispatch calls |
| `ff.service.ts` | Collapse verify+approve into single `approve` action; auto-compute on creation |
| `communication/notification-event.service.ts` | Add new exit event types |
| `email-templates.service.ts` | Add 6 new exit email templates |
| `backend/cron/exitAutoAdvance.cron.ts` (new) | Nightly auto-exited job |
| `backend/sql/073_exit_fsm_lwd.sql` | Migration A |
| `backend/sql/074_exit_clearance_audit.sql` | Migration B |
| `backend/sql/075_ff_verify_audit.sql` | Migration C |

---

## 11. Test Suite — Files

All contract tests use real DB pool, no mocks, AAA pattern.

| File | Scope |
|---|---|
| `exitFsm.transitions.contract.test.ts` | All voluntary + involuntary state transitions; push-back + resubmit; revoke |
| `exitClearance.contract.test.ts` | Auto-generate; role gate; audit columns; waive without reason → 400 |
| `exitFF.contract.test.ts` | 2-step F&F; auto-compute; approve → paid; role check |
| `exitCommandCenter.scope.contract.test.ts` | Branch scoping for all 4 sub-queries |
| `exitAutoAdvance.contract.test.ts` | Nightly job: advances when LWD past + all clear; does NOT advance when tasks open |
| `exitNotifications.contract.test.ts` | Notification dispatched for each event; correct recipients; email + WhatsApp both fired |

---

## 12. Out of Scope

- Employee self-service portal page for submission (tracked separately)
- Notice period waiver negotiation workflow
- Multi-level manager chains
- Rehire eligibility flag (tracked in employee profile separately)
- LMS clearance integration
