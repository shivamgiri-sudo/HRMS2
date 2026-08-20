# WFM Roster Builder — Subsystem 1: Tabular Builder & Bulk Upload

Status: Approved design, pending implementation plan
Date: 2026-08-20
Author: Claude (with shivam.giri@teammas.in)

## Background

The user asked for a large roster-management feature: manual roster building UI,
bulk upload, a draft → process-manager-review → WFM-approval workflow with audit
logging, employee notifications on publish, attendance-calendar integration
(planned-vs-biometric arrival), and roster-driven shrinkage/unplanned-leave
calculation.

This was too large for one spec, so it was decomposed into four sequential
subsystems, each with its own design → spec → plan → build cycle:

1. **Roster Builder & Tabular View** (this document)
2. Draft → Process Manager Review → WFM Approval workflow (audit log, impact-diff)
3. Publish → Employee Notification + Attendance Calendar integration
4. Shrinkage / Unplanned-leave calculation derived from roster

Build order is 1 → 2 → 3 → 4; each depends on the previous subsystem's data
model / state.

## Codebase survey findings (informing this design)

- `/wfm/roster-import` (`RosterImportPage.tsx`) already does bulk `.xlsx/.xls/.csv`
  upload → preview pivot grid → commit into `wfm_roster_assignment`. Its
  "Push Reminder" button calls a route that doesn't exist server-side and fails
  silently (`.catch(()=>{})`) — pre-existing bug, not in scope here, noted for
  awareness only.
- `NativeWFMRoster.tsx` filters only by process + cycle; no date-range,
  branch, or cost-centre filter; no per-cell manual edit grid. No general
  employee × date-range × process(cost-centre) × branch tabular view exists
  anywhere in the codebase today — confirmed net-new UI work.
- **Two separate roster-assignment tables exist**: `wfm_roster_assignment`
  (live, ~413k rows, written by all 5 existing engines: manual WFM
  assignment, auto-roster, roster-master builder, bulk upload/import,
  roster-swap) and `roster_daily_assignment` (used only by a separate
  governance/cycle notification path in `roster.notifications.ts`).
  **Decision: this subsystem reads/writes `wfm_roster_assignment` only.**
  `roster_daily_assignment` is left untouched; reconciling the two tables is
  an explicitly separate, unscoped problem.
- Reusable infrastructure to build on, not duplicate:
  - `backend/src/modules/roster/roster-lock-guard.ts` — shared mutation gate
    (`isRosterDateLocked`, `checkAssignmentDateNotLocked`,
    `checkEmployeeDateNotLocked`), already called by all 5 existing write
    paths. New writes must call through it too.
  - `backend/src/modules/roster/roster-change-log.ts` (`logRosterChange`) —
    existing who/old-value/new-value/reason audit pattern, best-effort
    (non-blocking) writes to `roster_change_log`.
  - `WorkforcePageGate` / `useWorkforceAccess()` (`src/hooks/useUserRole.ts`,
    `src/components/security/WorkforcePageGate.tsx`) — the real, working
    page-gate mechanism (confirmed the plain `roles={...}` prop on
    `ProtectedRoute` is dead code whenever a route has a mapped page code,
    which all WFM routes do).
  - Shift catalog: `wfm_shift_template` / `wfm_shift_master` /
    `wfm_shift_alias`.
- Notification systems: `work_item`/`work_inbox_item` is the only live,
  actually-delivering pipe WFM uses today (including the newest
  `ROSTER_PUBLISH_PENDING` trigger). `notification.gateway.ts` is explicitly
  inert ("no delivery function registered"); `portal_notification` is unused
  by WFM. This matters for subsystem 3, not subsystem 1, but is recorded here
  since it was discovered during this survey.
- `wfm_roster_plan` (the plan-level approve/reject lifecycle with remarks) has
  **zero rows in production** — never exercised live. Not reused directly by
  this subsystem, but its `approve()`/`reject()` pattern with
  `triggerRosterPublishPending(...)` is the reference implementation for
  subsystem 2/3's notify-on-approve step.

## Decisions

- **New page, zero edits to existing pages.** `/wfm/roster-builder` is a new
  route/page. `RosterImportPage.tsx` and `NativeWFMRoster.tsx` are not
  modified — consistent with the "no edits to existing pages/services without
  approval" rule and avoids shared-tree clobber risk on files others may be
  editing concurrently. Shared logic (pivot grid rendering, upload/preview
  flow) is extracted into new shared components imported by both the new page
  and, optionally, the old pages later — extraction happens by adding new
  files, not by editing the old ones in this phase.
- **Shift assignment is catalog-based, not free text.** WFM picks a named
  shift template (time, break, night flag) per employee/day from
  `wfm_shift_template`/`wfm_shift_master`. No arbitrary time entry.
- **Access is WFM-team only.** Process Managers get no edit rights in this
  subsystem (they get comment/suggest rights starting in subsystem 2). Gated
  by a new page code `WFM_ROSTER_BUILDER`, granted only to WFM roles, using
  the existing `WorkforcePageGate` mechanism.
- **Filter/display format**: Process filter always shows
  `"Process Name (Cost Centre Name)"`. Additional filters: date range, Branch,
  Employee search.
- **Forward-compatible status field.** `wfm_roster_assignment` gets a new
  column `builder_status ENUM('draft','live') DEFAULT 'live'`. All 413k
  existing rows and all 4 other existing write paths are unaffected (default
  `'live'`). New rows written by this page default to `'draft'`; a "Publish"
  action in this subsystem flips a row to `'live'` (no review gate yet — that
  arrives in subsystem 2, which will extend this same enum to real
  draft/submitted/reviewed/approved/published states without needing to
  rework subsystem 1's writes).

## Architecture

One page, two tab-modes:

- **Grid mode** — filter bar (date range, Process(Cost Centre), Branch,
  Employee search) over a new `RosterPivotGrid` shared component
  (employee-rows × date-columns), generalized out of `RosterImportPage`'s
  existing pivot-grid rendering so both pages share code rather than forking
  it. Click a cell → shift-template picker modal.
- **Bulk Upload mode** — embeds a new `RosterBulkUploadPanel` shared
  component, extracted from `RosterImportPage`'s existing
  upload → preview → commit flow, reused (not copied) by both pages.

Both modes call the same new backend service, which calls
`roster-lock-guard.ts` before every mutation, then `logRosterChange` after,
exactly matching the pattern already used by the other 5 write paths.

## Backend

- New route file `backend/src/modules/wfm/roster-builder.routes.ts`, mounted
  at `/api/wfm/roster-builder`, guarded by `requireAuth` +
  `requireRole('wfm','admin','super_admin')`.
- New `roster-builder.service.ts`:
  - **Read**: filtered query joining `wfm_roster_assignment` →
    `employees` → `process` → `cost_centre` → `branch`, by date range +
    process + branch + employee search.
  - **Write (single cell / bulk-assign)**: `checkAssignmentDateNotLocked` /
    `checkEmployeeDateNotLocked` → upsert into `wfm_roster_assignment` with
    `builder_status='draft'` → `logRosterChange`.
  - **Publish**: flips `builder_status` to `'live'` for selected rows, still
    behind the lock-guard, still logged.
- Migration: new SQL file adding `builder_status` column with the stated
  default, following the same collation-safety pattern called out in
  `1500_wfm_roster_import_engine.sql`'s header (explicit `COLLATE
  utf8mb4_unicode_ci` on any FK-adjacent column) so this migration doesn't
  repeat that rollback bug.

## Error handling

- Locked date/employee → same "attendance locked" error message the guard
  already produces for other engines (consistent UX, no new copy to write).
  the same `logSourceFailure` pattern.
- Bulk upload panel inherits `RosterImportPage`'s existing row-level
  error/warning display — no new error UI invented.

## Testing

- Backend integration test for the new route: auth rejection, lock-guard
  rejection, successful write + change-log row, publish transition —
  following the existing pattern in
  `roster-publish-pending-work-inbox.test.ts`.
- Frontend component test for filter-combination rendering and cell-edit
  modal.

## Explicitly out of scope (deferred to later subsystems)

- Process-manager review/comments and impact-diff highlighting (subsystem 2)
- WFM bulk-approve and full draft/submitted/reviewed/approved/published
  state machine (subsystem 2)
- Employee-facing publish notifications (subsystem 3)
- Attendance-calendar day-cell integration, planned-vs-biometric arrival
  (subsystem 3)
- Roster-driven shrinkage/unplanned calculation (subsystem 4)
- Reconciling `roster_daily_assignment` with `wfm_roster_assignment`
  (unscoped — flagged only)
- Fixing the pre-existing "Push Reminder" dead-route bug on
  `RosterImportPage` (flagged only, not part of this work)

## Open items to verify before writing the implementation plan

- Confirm `1500_wfm_roster_import_engine.sql` has actually applied cleanly on
  the target DB (per its own header note about a prior collation-triggered
  rollback) before adding another column to `wfm_roster_assignment`.
- Confirm the exact backend RBAC check that populates `roleQuery.data.pages`
  (likely under `backend/src/modules/access/`) to know exactly where the new
  `WFM_ROSTER_BUILDER` page code needs to be registered.
