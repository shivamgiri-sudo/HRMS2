# Task 1 Report: employee_performance_daily_snapshot migration

## Summary
Created the foundation table `employee_performance_daily_snapshot` for the Employee
Performance Scorecard feature and registered it in the backend migration manifest.
Nothing else in the codebase references this table — this is groundwork only, as
specified.

## Deviation from the brief (numbering + file location)

The brief assumed migration 1557 (`1557_branch_sal_code_from_db_bill.sql`) was the
highest existing entry and instructed me to add `1558_employee_performance_daily_snapshot.sql`.

On re-reading `backend/src/db/runPendingMigrations.ts` before editing (as the brief's
"Important" section requires, since this repo has concurrent sessions editing the
same tree), I found the manifest already had entries through
`migrations/1603_loan_negative_pending_cleanup.sql` — numbers 1558-1603 had been
registered by other sessions since the brief was written, including
`migrations/1558_helpdesk_ticket_raised_by.sql` which already claims 1558.

Per the brief's explicit instruction for this situation, I used the next free
number instead of the hardcoded 1558: **1604**.

I also filed the new SQL file under `backend/sql/migrations/` rather than the
brief's literal `backend/sql/` root path. Every manifest entry from 1558 onward
(1558, 1560-1565, 1600-1603) uses the `migrations/` subfolder, so I followed that
established recent convention rather than the brief's literal path, to keep the
new file consistent with its neighbors. `SQL_DIR` resolves to `backend/sql`, and
the manifest already supports both plain-filename and `migrations/`-prefixed
entries (confirmed by reading `runPendingMigrations.ts`), so either location
would have worked functionally.

Files actually produced:
- `backend/sql/migrations/1604_employee_performance_daily_snapshot.sql` (new)
- `backend/src/db/runPendingMigrations.ts` (modified — one new manifest entry appended after `migrations/1603_loan_negative_pending_cleanup.sql`)

## Step 1: Verify employees.id collation

Ran (read-only) against the live DB using the backend's own `.env` credentials
(`DB_HOST=122.184.128.90`, `DB_NAME=mas_hrms`, via `mysql2/promise`) with a
throwaway script placed at `backend/scripts/_tmp_show_emp_collation.mjs` and
deleted immediately after use:

```sql
SHOW CREATE TABLE employees;
```

Result (relevant column):
```
`id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid())
...
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

Confirmed: `employees.id` is `char(36) COLLATE utf8mb4_unicode_ci`, exactly matching
the brief's example value. No changes to the given SQL's collation were needed —
used `utf8mb4_unicode_ci` verbatim on both `employee_id` and the table-level COLLATE.

(Note: the backend's actual env var is `DB_PASSWORD`, not `DB_PASS` as I first
assumed from the brief's `.env` grep pattern — first connection attempt failed
with `ER_ACCESS_DENIED_ERROR` using an empty password until corrected.)

## Step 2: Migration file

`backend/sql/migrations/1604_employee_performance_daily_snapshot.sql` — the exact
DDL from the brief, verbatim, with the collation confirmed unchanged
(`utf8mb4_unicode_ci`) and a header comment noting the collation verification date.
No columns added or renamed beyond the 15 listed in the brief's Interfaces section.

## Step 3: Registration

Re-read the manifest tail immediately before editing (confirmed still ending at
`migrations/1603_loan_negative_pending_cleanup.sql`, line 792, right before
`];`), then inserted one new entry immediately after it, following the exact same
object/comment-annotation shape used throughout the file (e.g. the `1252_kpi_role_template_metrics.sql`
entry) — a manifest-array string literal followed by a `//` comment describing
the migration's purpose, scope, and any notable decisions.

## Step 4: Verify migration applies

Ran the repo's deploy-convention preflight:

```
cd backend && npm run preflight
```

Full output:
```
> mcn-hrms-backend@1.0.0 preflight
> node scripts/deploy-preflight.mjs && npx tsx scripts/migration-target-table-check.ts

manifest entries : 601
applied (success): 649
pending          : 0

OK — safe to restart.
[table-check] 1 pending migration(s) of 622 total
[table-check] migrations/1604_employee_performance_daily_snapshot.sql: PASS (0 target table(s) all present or self-created)

[table-check] PASS — all 1 pending migration(s) target tables that exist or are self-created.
```

Interpretation: `migrations/1604_employee_performance_daily_snapshot.sql` is
correctly recognized as the one pending migration and passes the target-table
structural check (self-created table, no dependency gaps). It has NOT been
executed against the live DB yet — per this repo's convention (memory:
"migrations DO run at boot"), it will apply automatically on the next backend
pm2 restart. This matches the brief's Step 4 expectation ("listed as applied,
no errors" — read here as "listed as the (structurally valid) pending migration,
no errors", since preflight is explicitly described in the brief as validating
without a full restart, and no restart was authorized or performed as part of
this task).

## Step 5: Commit

Verified via `git fetch origin` + `git log origin/main -3` before staging, and
`git status --porcelain` to confirm the working tree had other sessions'
unrelated dirty files (bank-payment-readiness.routes.ts, noc.service.ts,
reimbursements.routes.ts, AttendanceRegularization.tsx,
PaymentDisbursalCenter.tsx, and untracked test/tsconfig files) — none of these
were staged or touched.

Staged and committed only the two task files by explicit path:

```
git add backend/sql/migrations/1604_employee_performance_daily_snapshot.sql backend/src/db/runPendingMigrations.ts
git commit -m "feat: add employee_performance_daily_snapshot table (migration 1604)

Foundation table for the Employee Performance Scorecard feature (Task 1).
Numbered 1604 instead of the brief's 1558 — live manifest already had
1558-1603 registered by other concurrent sessions by the time this ran."
```

Commit: `65675a84520f7f1048f7c077f66dff3671e6d23c`

Verified via `git show --stat HEAD`:
```
 .../1604_employee_performance_daily_snapshot.sql   | 24 ++++++++++++++++++++++
 backend/src/db/runPendingMigrations.ts             |  1 +
 2 files changed, 25 insertions(+)
```
— exactly the two intended files, nothing else swept in.

### Push status
`git push origin HEAD:main` was attempted and timed out twice in the foreground
(120s and 180s) with no error output, then was re-launched in the background
(no index lock present; `git status` showed no stuck lock file). If the push
notification has not yet resolved by the time this report is read, check the
background task output before assuming push failure — the commit itself is
confirmed good locally regardless.

## Concerns
- Migration is registered but not yet applied to the live DB — it will only
  take effect after a backend restart (pm2), per this repo's established
  migration-at-boot behavior. No restart was performed or requested as part of
  this task.
- Push to `origin/main` was slow/timed out in the foreground; confirm it
  landed (`git merge-base --is-ancestor 65675a84520f7f1048f7c077f66dff3671e6d23c origin/main`)
  before treating this as fully shipped upstream.
