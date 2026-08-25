# Task 4 Report: Backfill script

## What was done

Created `backend/scripts/backfill-performance-scorecard-snapshot.ts` exactly as specified in the brief — a CLI script that loops a date range, calls `writeEmployeePerformanceSnapshots(dateStr)` for each day, accumulates `written`/`errors` totals, logs per-day and final results, and exits non-zero if any errors occurred.

Verified the consumed export exists and matches the expected signature:
`backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts:75` — `export async function writeEmployeePerformanceSnapshots(date: string): Promise<{ written: number; errors: Array<{ employeeId: string; error: string }> }>`.

## Step 2: Real dry-run output

Command run: `cd backend && npx tsx scripts/backfill-performance-scorecard-snapshot.ts 2026-08-24 2026-08-24`

This ran against the live `mas_hrms` database (host `122.184.128.90`, per `backend/.env`).

Real console output (tail, the meaningful lines — full log has 1,110 repeated per-employee stack traces omitted here for brevity, all identical in cause):

```
[mysql] ER_NO_SUCH_TABLE: errno=1146 Table 'mas_hrms.employee_performance_daily_snapshot' doesn't exist | sql: INSERT INTO employee_performance_daily_snapshot (...)
[performance-scorecard-snapshot] failed to write snapshot for employeeId=0000bf5c-5e8b-11f1-adb1-00155d0ab410: Error: Table 'mas_hrms.employee_performance_daily_snapshot' doesn't exist
    at ... (backend/src/db/mysql.ts:241)
    ... (repeated once per active employee, 1,110 times total)

2026-08-24: wrote 0 rows, 1110 errors
2026-08-24 errors: [ { employeeId: '0000bf5c-5e8b-11f1-adb1-00155d0ab410', error: "Table 'mas_hrms.employee_performance_daily_snapshot' doesn't exist" }, ... ]
Done. Total written: 0, total errors: 1110
```

Process exited with code 1 (expected — `totalErrors > 0`).

I independently confirmed the active-employee population the script iterated over by querying the same live DB directly:

```
active_status=1 count: 1110
```

This matches the script's own count (1,110 errors, one per active employee) — the script visited every active employee, called the real service, and got a real, honest per-employee failure from the real DB. It did not crash, hang, or silently skip anyone.

## Root cause of the 100% failure rate (informational, not a defect in this script)

`employee_performance_daily_snapshot` does not exist on the live `mas_hrms` database. The table's migration file exists (`backend/sql/migrations/1604_employee_performance_daily_snapshot.sql`) and is recorded in `backend/sql/MIGRATION_MANIFEST.lock.json` (both an "up" and presumably a checksum entry), but per project memory (`hrms2-migrations-dont-run-at-boot.md` — migrations run on `pm2 restart`, and `hrms2-migration-1500-blocks-deploys.md` — a broken WFM FK migration auto-rolls-back any deploy), the live server has apparently not restarted/redeployed since migration 1604 was added, so the table was never actually created on disk even though it's recorded as part of the manifest.

This is a known class of pre-existing infra issue (migrations recorded but not applied — see `hrms2-migrations-recorded-not-applied.md`), not something introduced by or fixable within this task. The backfill script itself is correct: it ran end-to-end, isolated every per-employee failure via the Task 2 error-isolation fix, and reported an honest 0/1110 rather than crashing or hiding the failures.

## Step 3: Commit

Staged only the one file:

```
git add backend/scripts/backfill-performance-scorecard-snapshot.ts
git commit -m "feat: add performance scorecard snapshot backfill script"
```

Commit: `204203254ab0f53f473d1af6a9d505daa93dc1c8`

`git show --stat HEAD` confirmed exactly one file changed (32 insertions), nothing else swept in. `git fetch origin main` + `git log origin/main` were checked immediately before committing; origin/main was unchanged since the start of this task (`5d6d1a42` still tip). Did not push, per instructions.

## Concerns for the plan owner

1. **The live `employee_performance_daily_snapshot` table does not currently exist**, so this script (and the nightly scheduler from the prior task) cannot write anything until migration 1604 is actually applied to the live server — most likely via a deploy/restart cycle, which is itself currently blocked by the unrelated migration 1500 issue tracked in memory. This is a deployment/ops blocker, not a code defect in Task 4's deliverable.
2. Because of (1), the "close to the active employee count" success signal described in the brief could not be demonstrated with `written > 0` — instead the proof is that the script visited all 1,110 active employees and reported an honest, complete failure count matching that population, with zero silent skips or crashes. This satisfies the brief's stated bar ("the point is the script runs end-to-end and reports honestly, not that every employee succeeds") but is worth the plan owner's awareness before Task 13 (the full historical backfill) is attempted — it will fail identically until the table exists live.
