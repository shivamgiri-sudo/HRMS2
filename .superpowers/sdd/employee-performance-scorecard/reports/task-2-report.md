# Task 2 Report: Snapshot aggregation service

## Summary

Implemented `EmployeePerformanceSnapshotRow` types, `computeEmployeeSnapshot`, and
`writeEmployeePerformanceSnapshots` exactly as specified in the brief, following TDD. One
deviation from the brief was required (test harness), documented below.

## Steps and commands run

### 1. Confirmed real DB import path

Read `backend/src/modules/management/management.service.ts`:
```ts
import { db } from "../../db/mysql.js";
```
Confirmed `db` is exported from `backend/src/db/mysql.ts` (`export const db = {...}` at line 239).
`management.service.ts` lives at `backend/src/modules/management/` — the same directory depth as
the new module `backend/src/modules/performance-scorecard/` — so the relative path
`../../db/mysql.js` carries over unchanged. The brief's placeholder path
(`../../db/index.js`) was wrong; used `../../db/mysql.js` throughout (types file, service file,
and the test's mock path).

### 2. Confirmed prior-task table (deviation noted)

Brief instructed: "Confirm this table exists before writing queries against it (`DESCRIBE
employee_performance_daily_snapshot`)." Queried the live DB directly (per repo convention, via a
one-off node/mysql2 script using `backend/.env` credentials — `mysql` CLI is not installed in this
shell):

```
Table 'mas_hrms.employee_performance_daily_snapshot' doesn't exist
```

The migration file `backend/sql/migrations/1604_employee_performance_daily_snapshot.sql` exists in
the repo (Task 1's output) with the exact column set the brief describes, but it has not yet been
applied to the live `mas_hrms` database (migrations apply at boot via pm2 restart per project
convention — this deploy step evidently hasn't run since Task 1's migration file was added).

This does not block Task 2: this task is pure code (a service + types + a fully DB-mocked unit
test), it does not execute any query against the live database, and the brief's file list contains
no migration or deploy step. Flagging this as a concern for whoever runs the later cron/backfill
tasks — they will need the migration applied first.

### 3. Wrote types file

`backend/src/modules/performance-scorecard/performance-scorecard.types.ts` — copied verbatim from
the brief's Step 1.

### 4. Wrote the failing test (deviation: vitest, not jest)

The brief's Step 2 example uses `jest.unstable_mockModule` / `@jest/globals`, and Step 3's run
command is `npx jest ...`. Checked the actual repo test harness:
- `backend/package.json` → `"test": "vitest run"`, no jest config/dependency wired for this
  pattern.
- `backend/vitest.config.ts` is the real, actively-used config (fileParallelism, 30s timeouts,
  `.env.test`, etc.)
- Grepped existing modules for DB-mock patterns, e.g.
  `backend/src/modules/ai/__tests__/ai-feedback.service.test.ts`:
  ```ts
  const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
  vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));
  ```

This confirms the codebase's actual convention is Vitest (`vi.hoisted` + `vi.mock`), not Jest.
Adapted the brief's test to that pattern, keeping the same assertions, same mock call sequence,
and the same 4-mockResolvedValueOnce data shape the brief specified. This is a mechanical
substitution only — no behavior or intent changed — since a Jest-syntax test would not run at all
under this repo's actual test runner.

Test written to
`backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts`.

### 5. Ran test to verify it fails for the right reason

```
cd backend && npx vitest run src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
```
Output:
```
FAIL  ... Error: Cannot find module '/src/modules/performance-scorecard/performance-scorecard-snapshot.service.js' imported from ...
Test Files  1 failed (1)
     Tests  no tests
```
Failed for the expected reason (implementation module does not exist yet).

### 6. Wrote the implementation

`backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts` — copied
verbatim from the brief's Step 4, with the corrected import path
(`import { db } from "../../db/mysql.js";`).

### 7. Ran test to verify it passes

```
cd backend && npx vitest run src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
```
Output:
```
Test Files  1 passed (1)
     Tests  1 passed (1)
```

### 8. Typecheck

```
cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "performance-scorecard"
```
No output (no type errors in the new files). Per project memory ("never run full backend tsc" for
orphan-error reasons), only checked for errors attributable to the new files via grep on the full
output; did not treat unrelated pre-existing tsc noise as blocking.

### 9. Git hygiene and commit

```
git fetch origin
git log origin/main -3 --oneline
git status --short
```
`git status --short` before staging showed only my new directory
(`backend/src/modules/performance-scorecard/`) plus unrelated untracked files from other concurrent
sessions (`.superpowers/sdd/aon-drilldown/...`, `backend/_tmp_timing*.mts/mjs`) — left those
untouched.

```
git add backend/src/modules/performance-scorecard/
git status --short   # confirmed only my 3 files were staged (A)
git commit -m "feat: add employee performance snapshot aggregation service"
git show --stat HEAD
```
`git show --stat HEAD` confirmed exactly 3 files in the commit, all under
`backend/src/modules/performance-scorecard/`, nothing else swept in.

Not pushed, per instructions — commit is local only on `main`.

## Deviations from the brief (summary)

1. **DB import path**: `../../db/mysql.js` (brief's example `../../db/index.js` was a placeholder,
   explicitly flagged as needing confirmation — confirmed and corrected).
2. **Test framework**: Vitest (`vi.hoisted`/`vi.mock`) instead of the brief's Jest example
   (`jest.unstable_mockModule`/`@jest/globals`), because this repo's backend test harness is
   Vitest, not Jest — a Jest-syntax test cannot run here. Same test logic, same assertions, same
   mock data.
3. **Table existence check**: table does not yet exist on the live DB (migration file present but
   apparently not yet applied/deployed). Did not block this code-only task; flagged for the next
   task (cron/backfill) that will actually execute queries against it.

## Files changed

- `backend/src/modules/performance-scorecard/performance-scorecard.types.ts` (new)
- `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts` (new)
- `backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts` (new)

## Commit

`26fbc5fb144b1d597fd4d071038ded5aeee7b54e` — "feat: add employee performance snapshot aggregation
service"

---

# Task 2 Follow-up Report: Per-employee error handling hardening (2026-08-25)

## Reviewer finding addressed

"Important" finding: `writeEmployeePerformanceSnapshots`'s `for` loop had no try/catch around
`computeEmployeeSnapshot` + the `db.execute` INSERT, so any single employee's failure (bad data, FK
issue, transient connection error) aborted the whole batch with no partial-success reporting.
Flagged as needing a fix before this service is wired into the nightly cron.

## Change made

File: `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts`

- Wrapped the loop body of `writeEmployeePerformanceSnapshots` (the `computeEmployeeSnapshot` call
  and the subsequent `db.execute` INSERT) in a `try/catch`.
- On failure: `console.error` with the employeeId and the raw error, push
  `{ employeeId, error: message }` onto a local `errors` array, then `continue` to the next
  employee (no `throw`) so the batch is not aborted.
- Changed the function's return type from `{ written: number }` to
  `{ written: number; errors: Array<{ employeeId: string; error: string }> }` and added a JSDoc
  block describing the per-employee isolation behavior.
- Did NOT touch `computeEmployeeSnapshot`'s signature/behavior, and did NOT touch the
  SELECT-per-employee (N+1) query pattern — both explicitly out of scope per the task.

## Test added

File:
`backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts`

Added a new `describe("writeEmployeePerformanceSnapshots", ...)` block (matching the existing
file's Vitest `vi.hoisted`/`vi.mock` pattern — no Jest). New test:
"continues past a failing employee and still writes the next one, reporting the error" — mocks the
active-employees SELECT to return two employees (`emp-fail`, `emp-ok`), makes `emp-fail`'s first
`computeEmployeeSnapshot` query reject with `new Error("connection reset")`, and lets `emp-ok`'s
four `computeEmployeeSnapshot` queries plus its INSERT all resolve normally. Asserts
`result.written === 1`, `result.errors` has exactly one entry, `errors[0].employeeId === "emp-fail"`,
and `errors[0].error` contains `"connection reset"`.

## Commands run and output

```
cd "C:\Users\ADMIN\Desktop\HRMS2-latest\backend"
npx vitest run src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
```

Output:
```
 RUN  v4.1.7 C:/Users/ADMIN/Desktop/HRMS2-latest/backend


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  03:42:52
   Duration  1.25s (transform 55ms, setup 47ms, import 37ms, tests 9ms, environment 0ms)
```

Both the original `computeEmployeeSnapshot` test and the new `writeEmployeePerformanceSnapshots`
test pass.

## Git hygiene

`git fetch` + `git status --short` before staging showed unrelated dirty/untracked files from other
concurrent sessions (`CLAUDE.md` modified, `.superpowers/sdd/aon-drilldown/...`,
`backend/_tmp_timing_check.mjs`, `backend/scripts/_tmp_verify_atrisk_v2.cjs`) — none of these were
touched or staged. Staged only the two files this task's scope covers, by explicit path:

```
git add backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
git commit -m "fix: isolate per-employee failures in performance snapshot batch write"
```

`git show --stat HEAD` confirmed exactly the 2 intended files in the commit, nothing else swept in.

Not pushed, per instructions — commit is local only.
