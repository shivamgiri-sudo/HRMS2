# Task 7 report — AON drill-down reconciliation harness

## Summary

Created `backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts` verbatim per
the brief. It passes 8/8 against the live database. Step 3's mandatory falsification was
performed exactly as specified — but the result is a genuine, verified finding: **weakening
`ACTIVE_EMPLOYEE_SQL` back to the pre-fix `active_status = 1` rule did NOT turn the suite red.**
All 8 tests stayed green. Root cause identified and evidenced below. `workforce-population.ts`
was restored and is confirmed byte-identical to its pre-edit state (md5 match, empty `git diff`).

## DB host used

Per the brief's live-DB-discovery instruction, both candidate hosts were TCP-tested before
running anything:

- `122.184.128.90:3306` (public) — **CONNECTED**
- `192.168.10.6:3306` (LAN) — **TIMEOUT**

`backend/.env` was already pointed at the public host (`DB_HOST=122.184.128.90`, with an
in-file comment "LAN again, flip DB_HOST back to 122.184.128.90"), so no credential changes
were made. All test runs below used this host live, database `mas_hrms`.

## Step 2: run the harness (baseline, unmodified code)

Command:
```
cd backend && npx vitest run src/modules/reporting/__tests__/aon-reconciliation.live.test.ts --reporter=verbose
```

Output:
```
 RUN  v4.1.7 C:/Users/ADMIN/Desktop/HRMS2-latest/.claude/worktrees/aon-analytics-correctness/backend

 ✓ AON reconciliation (live) > the page total never exceeds the agreed active population 219ms
 ✓ AON reconciliation (live) > bucket counts sum to the total 537ms
 ✓ AON reconciliation (live) > no employee is in two buckets 866ms
 ✓ AON reconciliation (live) > no negative AON survives outside In Training 771ms
 ✓ AON reconciliation (live) > In Training means joined-but-unpaid, and nothing else 466ms
 ✓ AON reconciliation (live) > every group's buckets sum to that group's total 840ms
 ✓ AON reconciliation (live) > each filter provably NARROWS the result 3711ms
 ✓ AON reconciliation (live) > a drill-down list is exactly as long as the cell it came from 616ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

Sanity cross-check against the known live facts (13 In Training / 163 / 101 / 93 / 90+, total
1,091, verified earlier today 2026-08-26): a direct query run immediately after returned
total **1,090** and bucket `90+` **720** (one less than the reference numbers in each case, all
others identical: 0-30=163, 31-60=101, 61-90=93, In Training=13). This is consistent with one
employee's status changing between the two checks earlier today, not a harness defect — it
confirms the harness reads real, live, moving data rather than a fixture.

## Step 3: prove the harness can fail (MANDATORY)

1. Backed up `workforce-population.ts` (md5 `fb88354dc706dfefc26d4dc37d483768`) to `/tmp/wp.ts`
   and to the scratchpad.
2. Replaced the body of `ACTIVE_EMPLOYEE_SQL` with the pre-fix rule:
   ```ts
   export const ACTIVE_EMPLOYEE_SQL = (alias: string = A): string =>
     `${alias}.active_status = 1`;
   ```
3. Ran the suite again.

**Result: still 8/8 GREEN — the suite did NOT go red.**

```
 ✓ AON reconciliation (live) > the page total never exceeds the agreed active population 605ms
 ✓ AON reconciliation (live) > bucket counts sum to the total 341ms
 ✓ AON reconciliation (live) > no employee is in two buckets 397ms
 ✓ AON reconciliation (live) > no negative AON survives outside In Training 137ms
 ✓ AON reconciliation (live) > In Training means joined-but-unpaid, and nothing else 282ms
 ✓ AON reconciliation (live) > every group's buckets sum to that group's total 695ms
 ✓ AON reconciliation (live) > each filter provably NARROWS the result 2346ms
 ✓ AON reconciliation (live) > a drill-down list is exactly as long as the cell it came from 373ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

### Root cause (verified against live data, not speculation)

Direct queries against the live DB while the weakened rule was in place:

```
loose (active_status=1 only):              1120
strict (weakened ACTIVE == loose):          1120   <- identical, by construction
strict (real ACTIVE, LOWER(employment_status)): 1090
rows where active_status=1 but employment_status not active: 30
bucket distribution of those 30 rows under the weakened rule: { '31-60': 30 }
```

This shows exactly why each assertion missed the regression:

- **"page total never exceeds the agreed active population"** — this test's own "loose" baseline
  is hardcoded in the test file as `e.active_status = 1`, the *same string* the weakened
  `ACTIVE_EMPLOYEE_SQL` now produces. Once the population rule regresses to that exact rule,
  `strict` and `loose` become the same query, so `strict <= loose` holds trivially (as an
  equality) regardless of whether the regression is present. This assertion cannot detect a
  regression to precisely the pre-fix formula it's meant to guard against — it can only catch a
  regression to something *stricter* than "loose", which is not the direction bugs go.
- **"no negative AON survives outside In Training"** and **"In Training means joined-but-unpaid"**
  — both are tests of `AON_BUCKET_SQL` / `AON_DAYS_SQL` (Task 3's GREATEST-clamp fix), not of
  `ACTIVE_EMPLOYEE_SQL` (Task 1's fix). Bucket assignment is computed independently of the
  active-population predicate. The 30 stale-flagged employees this weakening re-admits are all
  `employment_status='resigned'` with an old `date_of_joining`/`salary_start_date` — none of them
  is mid-training or has a future reference date, so they land in an ordinary tenure bucket
  (`31-60`, confirmed above) and trip neither invariant.
- **Bucket-sum, no-double-bucket, group-reconciliation, narrows, drill-down-length** — these are
  all *internal consistency* invariants: they use the same `ACTIVE` substitution on both sides of
  the comparison (e.g. bucket sum vs total both filtered by the same `ACTIVE`), so they hold
  structurally for *any* value of `ACTIVE_EMPLOYEE_SQL`, correct or not. They prove the SQL
  fragments don't contradict each other, not that the fragment defines the right population.

None of this is a flake — reran the weakened suite; identical 8/8 green both times, and the
mechanism above is confirmed by direct query, not inferred.

4. Restored `workforce-population.ts` from `/tmp/wp.ts`.
   `md5sum` after restore: `fb88354dc706dfefc26d4dc37d483768` — **matches the pre-edit hash
   exactly.**
   `git diff -- backend/src/modules/reporting/workforce-population.ts` — **empty.**

5. Re-ran the suite after restore:

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

All 8 pass again with the real rule in place.

## Typecheck

The project's own `backend/tsconfig.json` excludes `src/**/__tests__` from typechecking (by
design — every other file under `__tests__/` in this module is likewise excluded), so there is
no narrower `tsc` invocation that includes this file under the project's own config; a bare
`tsc --noEmit` on the file alone false-positives on `mysql2/promise`'s default export because it
loses the project's `esModuleInterop` setting. Vitest's successful execution of the file (via
esbuild transpilation, which fails hard on syntax/import errors) is the applicable check here,
per CLAUDE.md's instruction to never run a full backend `tsc`.

## Housekeeping

The worktree contained stray untracked debris from an earlier session/investigation
(`backend/wp-check.cjs`, a one-off Node script duplicating the same sanity query) plus several
mis-escaped log files this task accidentally created under `backend/` via a Windows-path `tee`
in a POSIX shell (`backend/C:Users...txt`) — all removed. `.sdd/` and `backend/.sdd/` (this
task's own briefs/reports, pre-existing from Tasks 1-6) were left untouched.

## Commit

```
git add backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts
git commit -m "test(aon): reconciliation harness for buckets, filters and drill-downs"
```

Commit SHA: `29c386bc521587feebc7f1f943e9e1a674a29e39`
`git show --stat` confirms exactly one file changed (113 insertions), and `git status
--porcelain` immediately before commit showed only that one path staged.

## Verdict

Step 1, 2, 4 completed exactly as specified and pass against live data. Step 3 was executed
exactly as specified (weaken -> run -> restore -> run), but its *expected outcome* (RED) did
not occur — the harness, as specified verbatim in the brief, cannot currently distinguish the
pre-fix population rule from the fixed one, because (a) the one assertion aimed at that
comparison is tautological against exactly this regression, and (b) the two bucket-boundary
assertions test a different fix (Task 3) than the one being weakened (Task 1). This is reported
as a finding per the task's own instruction to report rather than code around a result that
doesn't match expectations — the test code was not altered to force a red result, since the
brief requires it verbatim.

---

# Task 7 follow-up: fixing the falsification-proven harness gap (2026-08-27)

## What was wrong (as root-caused in the assignment, confirmed independently)

The regression test in the previous report proved the harness could not fail: weakening
`ACTIVE_EMPLOYEE_SQL` back to `active_status = 1` alone left the suite at 8/8 green because:

1. `"the page total never exceeds the agreed active population"` compared the strict count
   against a hard-coded `e.active_status = 1` baseline — which IS the weakened rule, so the
   assertion collapsed to `x <= x`.
2. The negative-AON / In-Training invariants exercise Task 3's bucket clamp, not the
   population rule.
3. The 30 re-admitted stale-flag employees land in an ordinary `31-60` bucket, invisible to
   any bucket-shaped invariant.

## Fix applied

File changed (only): `backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts`

- Deleted the tautological baseline comparison entirely (kept a trivial
  `"the active population is non-empty"` sanity check in its place, since the old test's only
  non-circular content — `strict > 0` — was worth preserving).
- Added invariant (b): `"no employee in the active population has a non-active
  employment_status"` — `COUNT(*) WHERE ACTIVE AND employment_status IS NOT NULL AND
  LOWER(employment_status) <> 'active'` must be `0`. This is clean against live data today and
  is, on its own, sufficient to catch the exact regression in scope (the weakened rule readmits
  30 employees whose `employment_status = 'resigned'`).
- Added invariant (a): `"almost nobody in the active population has already left"` — count of
  `ACTIVE AND date_of_exit IS NOT NULL AND date_of_exit < CURDATE()` must stay under 2% of the
  active total, rather than a hard `toBe(0)`.

## Deviation from the brief, and why

The brief specified invariant (a) as a hard `toBe(0)`: "Against the correct rule this is 0
rows." I verified this against live data (2026-08-27) before trusting it, per standing
instruction to verify against the live DB rather than take a claim on faith, and it is false
today: **8 employees currently satisfy the CORRECT, unweakened `ACTIVE_EMPLOYEE_SQL`
(`active_status = 1 AND employment_status = 'active'`) while also carrying a `date_of_exit`
weeks in the past** (`resignation_date` set too, `reactivation_count = 0` — not rehires). This
is a real, separate, pre-existing data-quality defect: `employment_status` was correctly reset
to `'active'` at some point but `date_of_exit`/`resignation_date` was never cleared alongside
it — structurally the mirror image of the bug this whole harness exists to catch, just facing
the opposite column. It is out of scope here (workforce-population.ts is explicitly not to be
touched, and this is a data problem, not a rule problem) but worth flagging separately.

A literal `toBe(0)` for invariant (a) would therefore make the suite permanently red today,
failing Step 1's own GREEN requirement, for a reason unrelated to the regression under test.
Instead of dropping the invariant or hardcoding "8" as a magic tolerance, I bounded it as a
ratio of the active total (`< 2%`): today's 8 pre-existing rows are ~0.7% of ~1,090 and pass
comfortably; the regression's 30 additional rows push the offending set to 38 against a total
of ~1,120 (~3.4%), which trips the 2% ceiling with margin on both sides. This is a relationship
(count relative to population), not a hard-coded headcount, so it survives daily headcount
drift the same way the rest of the suite does. Invariant (b) needed no such accommodation — it
is exact (`toBe(0)`) and clean against live data both before and after the regression.

## Verification (all 5 mandatory steps, real output)

**Step 1 — baseline GREEN (unmodified code):**
```
$ cd backend && npx vitest run src/modules/reporting/__tests__/aon-reconciliation.live.test.ts

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  5.78s
```

**Step 2 — weaken `ACTIVE_EMPLOYEE_SQL`** in `workforce-population.ts` to:
```ts
export const ACTIVE_EMPLOYEE_SQL = (alias: string = A): string =>
  `${alias}.active_status = 1`;
```

**Step 3 — RED, naming the new invariants:**
```
$ npx vitest run src/modules/reporting/__tests__/aon-reconciliation.live.test.ts

 ❯ src/modules/reporting/__tests__/aon-reconciliation.live.test.ts (10 tests | 2 failed)
     × almost nobody in the active population has already left
     × no employee in the active population has a non-active employment_status

 FAIL  ... > almost nobody in the active population has already left
AssertionError: recent-leavers-still-marked-active grew far past the known baseline noise:
expected 38 to be less than 22.400000000000002
 ❯ ...line 63

 FAIL  ... > no employee in the active population has a non-active employment_status
AssertionError: expected 30 to be +0 // Object.is equality
 ❯ ...line 71

 Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
```
Both new invariants fail, independently, exactly as designed. `38` = the pre-existing 8
data-quality rows + the 30 regression-readmitted leavers; `30` = the regression set precisely
(all have non-active `employment_status`, confirmed live: all 30 read `employment_status =
'resigned'`).

**Step 4 — restore `workforce-population.ts` exactly, verify no diff:**
```
$ git diff -- backend/src/modules/reporting/workforce-population.ts
(empty output, exit 0)
```
Confirmed byte-for-byte restored — zero lines of diff.

**Step 5 — final GREEN:**
```
$ npx vitest run src/modules/reporting/__tests__/aon-reconciliation.live.test.ts

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  4.65s
```

## Live-data investigation trail (scratch scripts, deleted before commit)

To root-cause the invariant-(a) false positive I ran three throwaway node scripts against the
live DB (`backend/scratch-check.mjs`, `scratch-check2.mjs`, `scratch-check3.mjs`) — all deleted
before staging/commit, never part of the diff. They confirmed, in order:
1. The 8 offenders under the strict/correct rule all have `employment_status = 'active'`,
   `active_status = 1`, a past `date_of_exit`/`resignation_date`, and `reactivation_count = 0`.
2. The weak-rule-admits-strict-rule-excludes set is exactly 30 rows today, and every one of
   them has `date_of_exit` in the past and `employment_status = 'resigned'` — matching the
   brief's root-cause description exactly.
3. `information_schema` confirmed no distinguishing "cancelled offboarding" column exists that
   would let invariant (a) exclude the 8 structurally rather than by ratio.

## Commit

```
git add backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts
git commit -m "test(aon): make reconciliation harness able to fail on the ACTIVE_EMPLOYEE_SQL regression"
```

`git status --porcelain` immediately before commit showed only that one path staged (plus
pre-existing untracked `.sdd/`/`backend/.sdd/` report files from Tasks 1-7, left untouched).

