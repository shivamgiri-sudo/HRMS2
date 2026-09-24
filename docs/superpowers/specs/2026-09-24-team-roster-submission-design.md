# Team Roster submission workflow - design note (2026-09-24)

Reporting managers fill blank roster dates and propose changes to already-rostered dates for their
whole reporting tree. A submission is approved by the submitter's reporting manager, then by WFM;
only the WFM approval writes `wfm_roster_assignment`.

## Owner decisions (fixed)
1. Approval = reporting manager first, then WFM final. No reporting manager (or an inactive one) => straight to WFM.
2. A manager may fill BLANK dates and propose CHANGES to rostered dates (a reason of 8+ characters is required for a change).
3. Cell values: Shift (a template of the employee's own process), Week off, Training, Unscheduled.
4. Team = the manager's whole reporting tree (multi-level), reporting_manager_id and legacy manager_id, active people only.
5. Nothing touches the main roster table until the final WFM approval.
6. Visible to anyone with reports, whatever their role name (64 of 78 real managers hold only `employee`).

## Data model (migration 1859, additive, no FKs, collations copied from parent columns)
- `roster_team_submission`: header, status (draft, pending_manager, pending_wfm, applied, partially_applied, rejected, cancelled),
  approver snapshot (`manager_approver_employee_id`, NULL = step skipped), both decisions, `submission_no` RTS-YYYY-NNNNNN.
  `draft_owner_key` is UNIQUE and set only while `draft`, so there is one open draft per submitter.
- `roster_team_submission_line`: one proposed cell; `kind` FILL_BLANK | CHANGE; `old_*` snapshot (id, type, week-off flag,
  template, times: imported rows have no template) so a stale change is detected; warnings; per-line result and reason.
- `roster_team_pending_cell`: PRIMARY KEY (employee_id, roster_date). Inserted at Submit inside the transaction, so two
  overlapping submits collide in the database (409 listing "pending with <submitter>"). Deleted on reject / cancel / apply.
- `roster_team_submission_audit`: the timeline shown in the drill-down drawer.
- 1860: page code `WFM_TEAM_ROSTER`.

## Flow
1. Draft: `PUT /draft/lines` upserts cells (date >= today IST, in tree, template of the employee's process, max 31-day span,
   max 5000 lines). Drafts do not lock cells. Each line snapshots the stored row it targets.
2. Submit (`POST /draft/submit`): re-validates every line (blank still blank / change still equals snapshot / reason / template),
   hard blocks = attendance locked, approved full leave over a working shift; warnings = off-day policy (Phase 3), half-day leave,
   minimum rest. Locks the cells, snapshots the approver, status pending_manager or pending_wfm, audit, best-effort inbox item.
3. Manager step: only the named approver (or admin/super_admin). Approve -> pending_wfm. Reject (8+ char remarks) -> rejected, cells released.
4. WFM step: WFM role whose branch/process scope covers EVERY employee on the submission (admin/super_admin global).
   Reject as above. Approve -> `applySubmission`: one transaction per employee inside `withEmployeeRosterLock`, each line re-checked
   (lock, leave, stale/filled cell, rest policy BLOCK or missing). Applied rows mirror roster import: `assignment_type`, `is_week_off`,
   times, `lifecycle_state` DRAFT, then `pending_employee_ack` + a ROSTER_ACK_PENDING inbox item; `process_id`/`lob_id` via
   `stampRows`; `manager_employee_id` from the reporting manager; `roster_change_log` (when the row has a cycle) and `audit_action_log`.
   Any skipped line => `partially_applied`; the submitter is notified with the counts.
5. Nobody approves their own submission (user id or employee row, admins included). The submitter can cancel while pending and can
   copy a rejected / cancelled submission back into a fresh draft.

## Decisions where the brief was silent
- Team walk is level-by-level (two indexed lookups per level, visited set, depth 15 / 5000 members) rather than WITH RECURSIVE,
  so it needs no untested SQL feature and never scans all employees.
- WFM approval requires every employee on the submission to be in scope (no silent partial scope); mixed-branch submissions go to admin.
- A crash mid-apply is resumable: only `pending` lines are processed on retry.
- Page gating: page code granted to `employee`; the nav item is `managerGated` (needs is_manager or a WFM role); API and page enforce the tree.
- Endpoints beyond the brief: `GET /draft`, `PUT /draft/note`, `DELETE /draft`, `POST /submissions/:id/copy-to-draft`.
