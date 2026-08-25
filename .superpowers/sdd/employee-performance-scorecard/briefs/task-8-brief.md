# Task 8 Brief: Page catalog + RBAC seed for the Command Center page

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 8)

## IMPORTANT: use the corrected role list

Do NOT use the plan document's original role list (`admin, hr, wfm, ceo, super_admin, branch_head, process_manager`). A security review during this same plan (Task 5/Task 7) established the correct role set for this feature is:
`manager, process_manager, assistant_manager, branch_head, branch_manager, team_leader, tl, hr, hr_admin, ho_hr, branch_hr, process_hr, ceo, coo, management, super_admin`
(`admin` and `wfm` are deliberately excluded — see `backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts`'s documented 2026-08-22 incident, and `backend/src/shared/dashboardAccessRegistry.ts`'s `PERFORMANCE_SCORECARD.allowedRoleKeys` for the authoritative current list — read that file yourself and use whatever role list is there NOW, don't hardcode from this brief in case it's since been adjusted.)

## Task

**Files:**
- Create: `backend/sql/migrations/<next-available-number>_performance_scorecard_page_catalog.sql` (determine the next available migration number yourself — do not assume 1559, check the current highest-numbered file in `backend/sql/migrations/`)

**Interfaces:**
- Produces: `page_catalog` row with `page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'` and `role_page_access` rows for the corrected role list above — consumed by `WorkforcePageGate` in a later frontend task.

- [ ] **Step 1: Inspect the existing `page_catalog`/`role_page_access` row shape**

Run against the live DB (read-only): `SELECT * FROM page_catalog WHERE page_code = 'PIP_MANAGEMENT';` and `SELECT * FROM role_page_access WHERE page_code = 'PIP_MANAGEMENT';` — note the EXACT column list, types, and any NOT NULL columns without defaults, since your INSERT must supply real values for those.

- [ ] **Step 2: Read the current `PERFORMANCE_SCORECARD.allowedRoleKeys` list**

`grep -n "PERFORMANCE_SCORECARD" backend/src/shared/dashboardAccessRegistry.ts` and read the surrounding lines to get the current, authoritative role list — use this exact list for the `role_page_access` seed rows (it should match what's described above, but confirm from the live file, not from memory of this brief).

- [ ] **Step 3: Determine the next migration number**

`ls backend/sql/migrations/ | sort -t_ -k1 -n | tail -5` (or equivalent) to find the highest-numbered file, and use the next number.

- [ ] **Step 4: Write the migration**

Base the exact column list and INSERT shape on what Step 1 found (this is illustrative structure only — replace column names/values with what you actually observed):
```sql
-- backend/sql/migrations/<N>_performance_scorecard_page_catalog.sql
INSERT INTO page_catalog (id, page_code, page_name, module, created_at, updated_at)
SELECT UUID(), 'PERFORMANCE_SCORECARD_COMMAND_CENTER', 'Performance Scorecard', 'performance', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_edit, created_at, updated_at)
SELECT UUID(), roles.role_key, 'PERFORMANCE_SCORECARD_COMMAND_CENTER', 1, 0, NOW(), NOW()
FROM (
  SELECT 'manager' AS role_key UNION SELECT 'process_manager' UNION SELECT 'assistant_manager'
  UNION SELECT 'branch_head' UNION SELECT 'branch_manager' UNION SELECT 'team_leader' UNION SELECT 'tl'
  UNION SELECT 'hr' UNION SELECT 'hr_admin' UNION SELECT 'ho_hr' UNION SELECT 'branch_hr' UNION SELECT 'process_hr'
  UNION SELECT 'ceo' UNION SELECT 'coo' UNION SELECT 'management' UNION SELECT 'super_admin'
) roles
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access WHERE role_key = roles.role_key AND page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'
);
```
Adjust column names/types to match Step 1's real findings exactly — do not run this illustrative SQL unmodified if the real schema differs.

- [ ] **Step 5: Register the migration**

Follow the same registration pattern in `backend/src/db/runPendingMigrations.ts` used by the highest existing entry (find it fresh — other sessions add entries constantly).

- [ ] **Step 6: Verify**

Run: `cd backend && npm run preflight`
Expected: your new migration listed as applied/pending with no errors. If it actually applies (this repo applies pending migrations at boot per its convention — check whether preflight applies it or just validates), run `SELECT COUNT(*) FROM role_page_access WHERE page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER';` and confirm it matches the number of roles in your list (16, if using the list above — but use whatever count Step 2 actually gives you).

- [ ] **Step 7: Commit**

```bash
git add backend/sql/migrations/<N>_performance_scorecard_page_catalog.sql backend/src/db/runPendingMigrations.ts
git commit -m "feat: seed page_catalog/role_page_access for Performance Scorecard Command Center"
```
Stage only these 2 explicit files.

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-8-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line verification summary
- Any concerns

## Important

- Do NOT push to GitHub. Commit locally to `main` only.
- This repo has concurrent sessions editing the shared tree, especially `runPendingMigrations.ts` (many sessions add migrations to it constantly — expect the migration number and manifest tail to have moved since this brief was written). `git fetch` + re-check `git log` before committing; stage only your explicit files.
- Use the CURRENT, live role list from `dashboardAccessRegistry.ts` (Step 2), not a hardcoded copy from this brief, in case it has changed.
- Do not touch any file outside this task's file list.
- If you have questions before starting, ask them instead of guessing.
