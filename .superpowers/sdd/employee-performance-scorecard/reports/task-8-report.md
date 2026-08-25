# Task 8 Report: Page catalog + RBAC seed for the Command Center page

## Status: DONE

## What was done

1. **Step 1 — live schema inspection** (read-only, `mas_hrms` via MySQL 8.4 client, host 122.184.128.90):
   - `page_catalog`: `id CHAR(36) PK DEFAULT (uuid())`, `page_code VARCHAR(100) UNIQUE NOT NULL`, `page_name VARCHAR(255) NOT NULL`, `page_path VARCHAR(255) NULL`, `module VARCHAR(100) NULL`, `description TEXT NULL`, `active_status TINYINT(1) NOT NULL DEFAULT 1`, `created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`. No `updated_at` column exists.
   - `role_page_access`: `id CHAR(36) PK DEFAULT (uuid())`, `role_key VARCHAR(100) NOT NULL`, `page_code VARCHAR(100) NOT NULL`, `can_view/can_create/can_edit/can_delete/can_export TINYINT(1) NOT NULL DEFAULT 0`, `active_status TINYINT(1) NOT NULL DEFAULT 1`, `created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`. No `updated_at` column either.
   - This differs from the brief's illustrative SQL (`can_edit` column exists but no `updated_at`, and there are also `can_create`/`can_delete`/`can_export`/`active_status`/`page_path`/`module`/`description` columns not in the illustrative snippet). The migration was written against the real column list, not the illustrative one.

2. **Step 2 — live role list**: read `backend/src/shared/dashboardAccessRegistry.ts` fresh. `PERFORMANCE_SCORECARD.allowedRoleKeys` (line 209) is:
   `manager, process_manager, assistant_manager, branch_head, branch_manager, team_leader, tl, hr, hr_admin, ho_hr, branch_hr, process_hr, ceo, coo, management, super_admin` (16 roles). This matches the brief's corrected list exactly, with `admin` and `wfm` correctly absent. Used this list verbatim.

3. **Step 3 — migration number**: highest file on disk was `1606_normalize_component_names_fix_total_deductions.sql` (untracked, belongs to a concurrent session, not yet registered in the manifest). Used the next free number: **1607**.

4. **Step 4 — migration written**: `backend/sql/migrations/1607_performance_scorecard_page_catalog.sql`
   - Inserts one `page_catalog` row for `page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'` (`page_name` = "Performance Scorecard Command Center", `page_path` = `/performance-scorecard/command-center`, `module` = `performance`), guarded by `WHERE NOT EXISTS`.
   - Inserts 16 `role_page_access` rows (one per role in the list above) with `can_view = 1`, all other permission flags left at the table default of `0`, `active_status = 1`, guarded by `WHERE NOT EXISTS` per role.
   - Purely additive, idempotent, does not touch any existing table's data.

5. **Step 5 — registered** in `backend/src/db/runPendingMigrations.ts`, appended after the `1605_deactivate_dangling_payroll_disbursal_grant.sql` entry (the tail of the manifest array at the time of writing — note `1606` exists as an untracked file from a concurrent session and was not yet registered), following the same `"migrations/NNNN_name.sql", // <detailed comment>` pattern as the most recent entries.

6. **Step 6 — verification**: `cd backend && npm run preflight`
   - `deploy-preflight.mjs`: `manifest entries: 601, applied (success): 649, pending: 0` → `OK — safe to restart.`
   - `migration-target-table-check.ts`: reported `1607_performance_scorecard_page_catalog.sql: PASS (2 target table(s) all present or self-created)` among 3 pending migrations (`1604`, `1605`, `1607` — none of these three have been applied to the live DB yet; they apply at the next backend restart per this repo's convention, same as prior entries).
   - Since the migration has not yet been applied (no restart triggered by this task), the post-apply row-count check (`SELECT COUNT(*) FROM role_page_access WHERE page_code = ...`) was not run — there is nothing to count yet. This is expected per the brief's own conditional ("If it actually applies... run..."); no restart was performed as part of this task.

7. **Step 7 — commit**: staged only the 2 explicit files (`git status --porcelain -- <files>` confirmed nothing else was picked up), committed as `8a418a5d`. `git show --stat HEAD` confirms exactly 2 files changed: the new migration file and `runPendingMigrations.ts`. Not pushed.

## Concerns

- The real `page_catalog`/`role_page_access` schema differs materially from the brief's illustrative SQL (extra columns, no `updated_at`); the migration follows the real schema, not the illustrative snippet, as instructed.
- `1606_normalize_component_names_fix_total_deductions.sql` exists on disk (another concurrent session's in-flight work) but is not yet in the manifest; it was left untouched, and `1607` was chosen to avoid any numbering collision with it.
- The seeded RBAC rows are not yet live in the DB (migration is pending, applies at next backend restart, per repo convention) — this is expected and matches how other recent entries (1604, 1605) are also still pending.
