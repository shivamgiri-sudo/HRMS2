# WFM Roster Builder — Subsystem 1: Tabular Builder & Bulk Upload

Status: Approved design (revision 2 — rescoped after discovering the
existing cycle/review/ack engine), pending implementation plan
Date: 2026-08-20
Author: Claude (with shivam.giri@teammas.in)

## Background

The user asked for a large roster-management feature: manual roster building
UI, bulk upload, a draft → process-manager-review → WFM-approval workflow
with audit logging, employee notifications on publish, attendance-calendar
integration (planned-vs-biometric arrival), and roster-driven
shrinkage/unplanned-leave calculation.

This was too large for one spec, so it was decomposed into four sequential
subsystems, each with its own design → spec → plan → build cycle:

1. **Roster Builder & Tabular View** (this document)
2. Process Manager Review → WFM Approval — surfacing/completing the existing
   lifecycle, not building a new one (see revision note below)
3. Publish notifications + Attendance Calendar integration
4. Shrinkage / Unplanned-leave calculation derived from roster

Build order is 1 → 2 → 3 → 4.

## Revision 2 — why this spec changed after being approved once already

Two rounds of deeper codebase survey (not just the initial page-level survey)
found that most of what subsystems 2 and part of 3 would have built **already
exists, fully wired, and has simply never been exercised in production**:

- `wfm_roster_assignment.final_roster_status` already implements the exact
  review lifecycle: `generated → pending_employee_ack → acknowledged` /
  `rejected_by_employee → pending_manager_action → realigned_by_manager` /
  `force_approved_by_manager` / `escalated_to_hr` → `approved_final →
  published_to_rta`. Added by `backend/sql/228_wfm_roster_assignment_lifecycle.sql`,
  with a 5-day-old bugfix in `backend/sql/1222_roster_manager_rejected_enum.sql`.
- The manager review queue is a real page: `src/pages/NativeRosterManagerQueue.tsx`
  → `WeekOffReviewSection`, with real Realign/Force-Approve/Escalate/Reject
  actions hitting real routes in `backend/src/modules/wfm/wfm.routes.ts`
  (lines 758-1055), each scope-checked, lock-guarded
  (`checkAssignmentDateNotLocked`), and audit-inserted.
- Employee acknowledgement is a real feature in `src/pages/NativeMyRoster.tsx`
  (Acknowledge/Reject buttons → `POST /api/wfm/my-weekoff/:id/acknowledge|reject`).
- **Cycle publish already does subsystem 3's employee-notification job**:
  `wfm.routes.ts`'s publish handler (~line 1370) flips assignments to
  `pending_employee_ack` and INSERTs `work_inbox_item` rows
  (`type='ROSTER_ACK_PENDING'`, `action_url='/my-roster'`) — the live,
  actually-delivering notification pipe (see "Notification systems" below).
- RTA consumption already refuses to read anything except
  `approved_final`/`force_approved_by_manager`/`realigned_by_manager`/
  `published_to_rta` (`backend/src/modules/rta/rta.routes.ts`, `GET
  /final-roster-state`).
- Cycle creation (`roster.governance.service.ts::createCycle`, `POST
  /api/roster-gov/cycles`) and the `weekly_roster_cycle.status` lifecycle
  (`draft→submitted→reviewed→published→acknowledged→active→variance_review→
  attendance_locked→payroll_input_ready→closed`) that `NativeWFMRoster.tsx`'s
  stepper displays are real and backed, not vestigial.
- Manual single-cell assignment (`roster.service.ts::assignEmployee`, called
  by `wfm.routes.ts:754`-ish route) already does lock-check, rest-policy
  validation, shift-versioning, and audit via `logSensitiveAction` — this is
  already a production-quality write path.

**But none of it has ever actually run**: all 413,386 rows in
`wfm_roster_assignment` sit at the default `final_roster_status='generated'`
/ `employee_ack_status='pending'` / `manager_action_status=NULL`;
`roster_decision_audit` has **zero rows total**, from any writer, ever; only
**3** `weekly_roster_cycle` rows exist, and only **1,354 / 413,386**
assignments are cycle-linked at all (the other 412,032 come from the legacy
plan_id-based bulk path and are deliberately left cycle-less — see
`wfm.routes.ts:1105-1114`'s comment; not retrofitted, not touched by this
work).

**Root cause, in one sentence: there is no UI that actually drives roster
work through a cycle.** Everything downstream of "a cycle exists with real
assignments in it" already works. This spec is rescoped accordingly.

### What this means for the 4-subsystem decomposition

- **Subsystem 1 (this doc)** is now a genuinely thin layer: a tabular
  grid/filter/bulk-upload UI that calls the *existing* `createCycle` /
  `assignEmployee` / publish endpoints, plus one small additive backend
  change (see Decisions) to make manually-built assignments cycle-linked.
  No new backend service layer, no new status column, no new audit table.
- **Subsystem 2** shrinks from "build a review/approval/audit workflow" to
  three real, still-open gaps: (a) get real cycles flowing through the
  existing manager queue at all — a consequence of subsystem 1 shipping, not
  new code; (b) surface `manager_action_by`/`manager_action_at`/
  `manager_action_reason` in `NativeRosterManagerQueue.tsx` (written by every
  manager-action route today, never rendered); (c) find and fix why
  `roster_decision_audit` has zero rows despite three separate writers
  (`roster-generation.service.ts`, `wfm.routes.ts`'s four manager-action
  handlers, `roster.governance.service.ts`) having insert code — this
  predates and is independent of anything new being built.
- **Subsystem 3** shrinks to: attendance-calendar day-cell integration
  (planned-vs-biometric arrival) — genuinely new — since the
  publish-notification half is already live once subsystem 1 makes cycles
  real.
- **Subsystem 4** (shrinkage calc) is unaffected in scope, but should read
  shift data off cycle-linked assignments (`shift_template_id`,
  `scheduled_minutes`) going forward, consistent with the rest of this
  engine, and reuse the already-fixed `aon.executor.ts` shrinkage formula
  rather than inventing a new one (per revision 1's finding, unchanged).

The prior "Note on a prior overlapping plan" section from revision 1 (the
2026-08-19 operating-model plan, marked superseded) still stands — see
`docs/superpowers/plans/2026-08-19-wfm-roster-operating-model.md`'s header
note.

## Decisions

- **New page, zero edits to existing pages** (unchanged from revision 1).
  `/wfm/roster-builder` is a new route/page. `RosterImportPage.tsx` and
  `NativeWFMRoster.tsx` are not modified. Shared rendering logic (pivot grid,
  upload/preview flow) is extracted into new shared components imported by
  both the new page and, optionally, the old pages later.
- **Backend is a thin controller over existing services, not a new engine.**
  New route file calls straight into:
  - `roster.governance.service.ts::createCycle` to create/select a
    `weekly_roster_cycle` for the chosen process + week.
  - `roster.service.ts::assignEmployee` for each cell write (already does
    lock-check, rest-policy validation, shift-versioning, audit).
  - The existing publish handler (`wfm.routes.ts`'s `POST
    /roster/publish`-equivalent) to move a cycle from draft to
    `pending_employee_ack`, which already fires the `work_inbox_item`
    notification.
  No new `wfm_roster_assignment` status column. No new audit table. No new
  `roster-builder.service.ts` write engine.
- **One small, explicit, additive change to `roster.service.ts::assignEmployee`
  requiring separate sign-off before implementation**: today `AssignInput`
  has no `cycleId` field and the INSERT never sets `wfm_roster_assignment.cycle_id`
  — meaning assignments made through this function today can never enter the
  review/ack lifecycle. The change: add an optional `cycleId?: string | null`
  to `AssignInput`, include it in the existing `insertCols`/`updateClauses`
  arrays (same pattern already used there for `shift_version_id`/
  `scheduled_minutes` — probed via `rosterAssignmentColumns()`, additive,
  backward compatible, `undefined`/`null` preserves exactly today's
  behavior for every other caller). This is the only existing-file edit this
  subsystem proposes, and it is called out as its own reviewable task in the
  implementation plan, not folded silently into a bigger diff.
- **Bulk upload reuses the existing import → preview → commit engine**
  (`RosterImportPage`'s flow, extracted into a shared `RosterBulkUploadPanel`
  component per revision 1), with one addition: the commit step is called
  with a `cycleId` (from the same create/select-cycle step the grid mode
  uses) so bulk-uploaded rows are cycle-linked too, not just manually-built
  ones.
- **Shift assignment is catalog-based, not free text** (unchanged). WFM picks
  a named shift template per employee/day from `wfm_shift_template`/
  `wfm_shift_master`.
- **Access is WFM-team only** (unchanged). New page code `WFM_ROSTER_BUILDER`,
  granted only to WFM roles, via the existing `WorkforcePageGate`/
  `useWorkforceAccess()` mechanism. Backend RBAC registration in
  `backend/src/shared/rbacPageMatrix.ts`, same file that already registers
  `WFM_ROSTER` and `WFM_ROSTER_MANAGER_QUEUE`.
- **Filter/display format** (unchanged): Process filter always shows
  `"Process Name (Cost Centre Name)"`. Additional filters: date range,
  Branch, Employee search.

## Architecture

One page, two tab-modes, both requiring a cycle to be selected or created
first (a lightweight "Process + Week" picker at the top of the page that
calls `createCycle` if none exists for that process/week yet — `createCycle`
is idempotent-safe per its `UNIQUE KEY uq_cycle (process_id, week_start_date)`):

- **Grid mode** — filter bar (date range, Process(Cost Centre), Branch,
  Employee search) over a new `RosterPivotGrid` shared component
  (employee-rows × date-columns), generalized out of `RosterImportPage`'s
  existing pivot-grid rendering. Click a cell → shift-template picker modal →
  calls `assignEmployee` with the active `cycleId`.
- **Bulk Upload mode** — embeds `RosterBulkUploadPanel` (extracted from
  `RosterImportPage`'s existing upload → preview → commit flow), commit step
  passes the active `cycleId` through to the existing commit service.

A "Publish this week's roster" button (visible only once assignments exist
for the active cycle) calls the existing publish endpoint — no new publish
logic.

## Backend

- New route file `backend/src/modules/wfm/roster-builder.routes.ts`, mounted
  at `/api/wfm/roster-builder`, guarded by `requireAuth` +
  `requireRole('wfm','admin','super_admin')`. Endpoints:
  - `GET /cycles?processId=&weekStart=` — find-or-none lookup against
    `weekly_roster_cycle` (thin wrapper, no new table).
  - `POST /cycles` — thin wrapper around `roster.governance.service.ts::createCycle`.
  - `GET /grid?cycleId=&branchId=&employeeSearch=` — filtered read joining
    `wfm_roster_assignment` → `employees` → `process` → `branch` for the
    active cycle, generalizing the existing per-employee query pattern in
    `wfm.routes.ts:1181` (`GET /manager/weekoff-review`) rather than
    inventing a new join.
  - `POST /grid/assign` — thin wrapper around `roster.service.ts::assignEmployee`,
    passing the active `cycleId` (once the additive change above lands).
  - `POST /publish` — thin wrapper around the existing publish handler logic
    (either calls it directly if extractable as a function, or re-implements
    the same two UPDATE statements + `work_inbox_item` INSERT if not — to be
    resolved in the implementation plan after reading whether that logic is
    already a standalone function or inlined in the route handler).
- **No new SQL migration for a status column.** The only schema-adjacent
  change is the additive `assignEmployee` parameter above, which needs no
  migration (the column already exists).

## Error handling

- Locked date/employee → same message `checkAssignmentDateNotLocked`/
  `checkEmployeeDateNotLocked` already produce.
- Insufficient rest → same `InsufficientRestError` (422) `assignEmployee`
  already throws, surfaced as-is in the grid UI.
- Bulk upload panel inherits `RosterImportPage`'s existing row-level
  error/warning display.

## Testing

- Backend integration test for the new route file: cycle find-or-create,
  grid read with filters, assign-through-to-assignEmployee (including that
  lock/rest-policy errors propagate unchanged), publish wrapper. Follows the
  existing test patterns in `wfm.routes.test.ts` and
  `roster-publish-pending-work-inbox.test.ts`.
- A dedicated test for the `assignEmployee` additive change: verify a call
  without `cycleId` behaves byte-identical to today (regression guard for
  every existing caller), and a call with `cycleId` sets
  `wfm_roster_assignment.cycle_id` correctly.
- Frontend component test for filter-combination rendering and cell-edit
  modal.

## Explicitly out of scope (deferred to later subsystems)

- Process-manager review/comments UI polish and audit-trail display
  (subsystem 2 — the underlying review actions already exist)
- Root-causing `roster_decision_audit`'s zero-rows issue (subsystem 2)
- Attendance-calendar day-cell integration, planned-vs-biometric arrival
  (subsystem 3 — the notification half is already live)
- Roster-driven shrinkage/unplanned calculation (subsystem 4)
- Reconciling `roster_daily_assignment` with `wfm_roster_assignment`
  (unscoped — flagged only)
- Retrofitting `cycle_id` onto the 412,032 legacy cycle-less rows (explicitly
  declined already, per `wfm.routes.ts:1105-1114`'s comment — not revisited
  here)
- Fixing the pre-existing "Push Reminder" dead-route bug on
  `RosterImportPage` (flagged only, not part of this work)

## Note on a prior overlapping plan

Unchanged from revision 1: `docs/superpowers/plans/2026-08-19-wfm-roster-operating-model.md`
is marked superseded in place (see its header note), useful elements folded
in as described there.

## Open items to verify before writing the implementation plan

- Read `roster.governance.service.ts::createCycle` in full to confirm its
  exact input shape and return type before the plan calls it.
- Read the full publish route handler in `wfm.routes.ts` to determine
  whether its logic is already an extractable function or needs a thin
  duplicate (see Backend section above).
- Confirm the exact backend RBAC registration point for a new page code
  (`backend/src/shared/rbacPageMatrix.ts`, matching how `WFM_ROSTER` and
  `WFM_ROSTER_MANAGER_QUEUE` are already registered there).
- Confirm how `process` → `cost_centre` is actually joined for the "Process
  Name (Cost Centre Name)" filter display (not yet located in this survey).
