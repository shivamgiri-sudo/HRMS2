### Task 1 — Backend: harden `mismatch-review.routes.ts`

File: `backend/src/modules/wfm/mismatch-review.routes.ts`

Six defects, all confirmed against the live DB:

**1a. Dead payroll-lock guard (correctness, highest priority).**
The pre-update SELECT at ~line 96 reads:

    SELECT id, attendance_status, lwp_value, mismatch_flag, employee_id, record_date
    FROM attendance_daily_record WHERE id = ? LIMIT 1

It does not select `is_locked`. Three lines later `if (rec.is_locked)` tests `undefined`, so the
409 "Record is locked by payroll" refusal has **never** been reachable, while the handler goes on to
write `attendance_status` and `lwp_value`. Add `is_locked` to the SELECT column list.
Currently 0 locked rows sit in the queue, so there is no live exposure — it fires wrong the moment
payroll locks any of these months. Write a test that fails without the column and passes with it.

**1b. Unbounded list -> full table scan.**
`GET /` applies no default date window. Live `EXPLAIN`: `type: ALL, key: NULL, Using temporary;
Using filesort`, 124,954 rows examined; measured **9.9s warm** for page 1 plus **1.6s** for the
count, over a **49,826-row** queue spanning 2026-01-12..2026-08-26.
Default to `record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)` when no `fromDate` is supplied —
same shape as `attendance-exceptions.routes.ts`, which is the good example in this codebase.

**1c. `ORDER BY` forces the filesort.**
`ORDER BY adr.record_date DESC, e.employee_code` sorts on a **joined** column, which defeats every
index. Change to `ORDER BY adr.record_date DESC, adr.employee_id` — `idx_adr_date_employee`
(`record_date, employee_id`) already exists, so this removes the temporary+filesort. Do not add an
index; the right one is already there.

**1d. No row-level scope enforcement.**
The router has zero `resolveUserBusinessScope`. `branchId`/`processId` are optional *filters*, not
enforced scope, so a branch-scoped `wfm` user sees all 49,826 rows org-wide.
Add scoping exactly as `attendance-exceptions.routes.ts` does it: `resolveUserBusinessScope` +
`buildEmployeeScopeCondition` against the LEFT-JOINed `employees` row, applied identically to the
list query, the count query, and the summary query so the three cannot drift.

**1e. Roles disagree with the page gate.**
Live `role_page_access` grants `WFM_LIVE_TRACKER` (can_view=1, active) to: `super_admin`,
`branch_head`, `branch_wfm`, `manager`, `process_manager`, `wfm`. The API accepts
`wfm, hr, admin, super_admin`. Only `wfm`/`super_admin` are in both sets.
Widen the **read** roles (`GET /`, `GET /summary`) to the union:
`wfm, branch_wfm, hr, admin, super_admin, ceo, payroll, manager, process_manager, branch_head`
— matching the VIEW_ROLES list in `attendance-exceptions.routes.ts`. This is only safe **because**
1d lands in the same task; scoping still restricts what each of them sees.
Leave the **write** role list on `PATCH /:id/resolve` as `wfm, hr, admin, super_admin` — resolving a
mismatch rewrites `attendance_status` and `lwp_value`, which payroll reads.

**1f. Summary window disagrees with the list.**
`GET /summary` is hard-coded to 60 days while the list is unbounded, so the tiles (27,700 /
19,121 / 54) and the list header (49,826) contradict each other on load. Make `/summary` accept and
honour the same `fromDate`/`toDate`/scope inputs as the list, with the same 30-day default.

**1g. Server-side search.**
Add an optional `search` query param matching `e.employee_code` or the employee's name, so the UI
can stop filtering client-side (see Task 3b).

Tests: `backend/src/__tests__/mismatch-review.routes.contract.test.ts` (new). Cover 1a (locked
record returns 409), 1d (a branch-scoped caller does not see another branch's row), 1e (a
`branch_head` caller gets 200 not 403), and 1f (summary honours the passed window).
Run: `cd backend && npx vitest run src/__tests__/mismatch-review.routes.contract.test.ts`

