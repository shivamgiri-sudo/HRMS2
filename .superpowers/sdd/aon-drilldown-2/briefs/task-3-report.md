# Task 3 Report — dimension_id on attritionDeepDive

## Status: DONE_WITH_CONCERNS

## Summary

Added `dimension_id` (string | null) to `attritionDeepDive`'s SELECT/GROUP BY in
`backend/src/modules/reporting/executors/aon.executor.ts`. `DEEP_DIVE_DIMENSIONS`'s type
gained an optional `idExpr`, set on the 6 id-backed entries (`branch`, `cost_centre`,
`process`, `department`, `designation`, `reporting_manager`) to their real master-table PK
column (`b.id`, `cc.id`, `p.id`, `d.id`, `des.id`, `mgr.id`). The 5 derived/proxy entries
(`source`, `gender`, `age_band`, `ctc_band`, `exit_type_proxy`) are left untouched (no
`idExpr`), so `dimensionIdExpr` falls back to the literal `NULL` and the SELECT emits
`NULL AS dimension_id` for those rows. `dimensionIdExpr` is also added to `GROUP BY`
unconditionally, per the brief.

No new query filter field was added, `ExecFilters` was not touched, and no whitelist entry
in `report-suite.routes.ts`'s `default:` branch was needed — confirmed by grep before
starting. This task adds a SELECT column only, on an already-catalogued report code.

## TDD

1. **Failing test first**: added an `attritionDeepDive` import (previously not imported/
   tested at all in this file) and two `it` cases in a new `describe("attritionDeepDive
   dimension_id", ...)` block, matching the brief's Step 1 almost verbatim — with one
   necessary change (below).
2. **Confirmed both new cases FAILED** before implementation (`dimension_id`/`NULL AS
   dimension_id` absent from `attritionDeepDive`'s current SQL).
3. **Implemented** exactly the brief's Step 3 plan.
4. **Confirmed both new cases PASS**, plus the pre-existing 4 cases in the file still pass.

### One deviation from the brief's literal test code, and why

The brief's Step 1 snippet reads `mockExecute.mock.calls[0][0]`. This test file's
`mockExecute` (`db.execute` mocked with `vi.fn()`) is **never cleared between tests**
(vitest isolates per-file, not per-test, and there is no `beforeEach`/`afterEach` reset
here) — so `mock.calls` accumulates across every `it` in the whole file, and `calls[0]`
always means "the very first `db.execute` call made anywhere in this file's run", not
"this test's own call". I verified this is a **pre-existing, already-live bug** in this
file: the existing `aonCohortSurvival's SQL uses AON_REFERENCE_JOIN_DATE_SQL...` test and
the existing `aonCohortSurvival drill-down ids` test both already use `calls[0][0]` and
both were passing only because `aonBucketHeadcount`'s SQL (the true call 0) happens to
contain the same substrings they assert on (`COALESCE(e.salary_start_date, ...)`, `b.id`,
`cc.id`, `p.id`) — they were passing vacuously against a stale, unrelated query.

I first tried the correct-looking fix (`beforeEach(() => mockExecute.mockClear())`), which
is the honest fix for the file. That immediately unmasked the pre-existing bug: with a
real per-test call at `calls[0]`, the `aonCohortSurvival's SQL uses
AON_REFERENCE_JOIN_DATE_SQL...` test's own `not.toMatch(/DATEDIFF\([^)]*,\s*e\.date_of_joining\)/)`
assertion started genuinely failing against `aonCohortSurvival`'s real SQL. That is a
production-code question (whether `aonCohortSurvival` has a live gap around
`AON_REFERENCE_JOIN_DATE_SQL`) that belongs to a different, already-merged task
(Plan 1's date-source fix / the aonCohortSurvival drill-down ids task) and is out of
scope for Task 3, which touches only `DEEP_DIVE_DIMENSIONS`/`attritionDeepDive`. Per
"HRMS2 do not change existing logic" and this plan's own scoping, I reverted the shared
`beforeEach` and instead scoped the fix to only my two new tests: they read
`mockExecute.mock.calls[mockExecute.mock.calls.length - 1][0]` (the latest call) instead
of `calls[0]`, so they assert against their own call regardless of how many `it`s ran
before them, without touching the shared test file's existing (masked) behavior for
other describe blocks.

**Flagging this for the plan owner**: the `aonCohortSurvival's SQL uses
AON_REFERENCE_JOIN_DATE_SQL for cohort maturity and departure measures` test is currently
passing only by accident (comparing against the wrong query's SQL text). It should be
looked at — either add a proper `beforeEach(() => mockExecute.mockClear())` to the whole
file and then investigate/fix whatever `aonCohortSurvival`'s real SQL is doing around
`date_of_joining`, or otherwise document why the accumulated-calls behavior is
intentional. I did not touch it, since it is unrelated to this task's scope and doing so
would be an uninstructed change to logic outside `DEEP_DIVE_DIMENSIONS`/
`attritionDeepDive`.

## Test output (final, after implementation)

```
$ cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon.executor.test.ts
 RUN  v4.1.7 C:/Users/ADMIN/Desktop/HRMS2-latest/backend
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## Full reporting suite + scoped typecheck (Step 6)

```
$ cd backend && npx vitest run src/modules/reporting/
 Test Files  49 passed (49)
      Tests  302 passed | 1 skipped (303)

$ cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon\.executor"
(no output — no new typecheck errors for aon.executor.ts)
```

## Live verification (Step 5)

Read-only script against the live `mas_hrms` DB (host from `backend/.env`, `mysql2/
promise`, no password pasted anywhere in code/commits), replicating `attritionDeepDive`'s
core SELECT/GROUP BY for a 12-month exit window (`2025-08-25` to `2026-08-25`), comparing
the pre-task query (no `dimension_id` column/GROUP BY term) against the post-task query,
for `branch` (id-backed), `reporting_manager` (id-backed), and `source` (proxy).

### branch (id-backed)

- Old row count: 5. New row count: 5 (unchanged).
- `dimension_id` populated with real `branch_master.id` values for 4 branches; `NULL` for
  the 1 `UNASSIGNED` row (employee has no `branch_id`) — exactly the expected shape.
- Cross-checked: sampled `dimension_id` values join back to `branch_master` and return the
  correct `branch_name` (e.g. `77769026-5e88-11f1-adb1-00155d0ab410` → `NOIDA`).

### reporting_manager (id-backed)

- `dimension_id` populated with real `employees.id` values for every named manager; `NULL`
  only for the `UNASSIGNED` bucket (no reporting manager set).
- Cross-checked: sampled `dimension_id` values join back to `employees` and return the
  correct `full_name` (e.g. `0cf00cf6-5e8b-11f1-adb1-00155d0ab410` → `SUDEEP NEGI`).
- **Row count changed**: old (grouped by name text alone) = 54 rows; new (grouped by name
  text + real id) = 55 rows. Root cause found and confirmed: two *distinct* manager
  records, `"Kamal Singh"` (`149ba301-...`, 1030 exits) and `"KAMAL SINGH"` (`3efa07f9-...`,
  46 exits), collate as equal text under this table's default (case-insensitive) MySQL
  collation, so the old `GROUP BY ${dim.expr}`-only query silently merged two different
  people into one row (1076 exits). Adding the real `dimension_id` to `GROUP BY` correctly
  splits them back into their true two rows (1030 + 46 = 1076, so the total is
  conserved — no exits are gained or lost). This is a genuine grouping-grain change,
  not the no-op the brief predicted for the *proxy* dimensions — but it is a correctness
  improvement (Task 6's drill-down would otherwise send one click to two different
  managers), not a defect introduced by this task's mechanics. Flagging it explicitly
  per the brief's own instruction to verify no grouping-grain regression rather than
  silently accepting the "NULL is a no-op" framing for id-backed dimensions too.

### source (proxy)

- Old row count: 5. New row count: 5 (unchanged — the exact regression check the brief
  asked for).
- `dimension_id` is `NULL` on all 5 rows, every time, with no exceptions.
- Every other column (`dimension_value`, `exits`) identical between old and new queries.

## Files touched

- `backend/src/modules/reporting/executors/aon.executor.ts`
- `backend/src/modules/reporting/executors/__tests__/aon.executor.test.ts`

## Commit

**Note on how this landed**: while this task's edits were staged locally (uncommitted), a
concurrent session in this shared tree committed a broad, unrelated change
(`feat: add simple test endpoint for daily report email`, commit `cfcfa0e1`) that swept my
two in-progress files into its commit alongside several unrelated files
(`performance-scorecard-drilldown.ts`/`.test.ts`, `performance-scorecard.routes.ts`,
`health.routes.ts`, `rbacPageMatrix.ts`, `FraudComparisonPanel.tsx`, and this plan's own
brief/progress files). This is exactly the "HRMS2 broad commits revert work" /
"shared tree clobbers edits" pattern already logged in memory, from the other side —
another session's broad commit, not my own.

Per this task's own instruction ("do NOT attempt git surgery — verify your files' content
independently, note it, push normally"): I diffed `cfcfa0e1`'s changes to both my files
against the exact edits I made, and they match precisely — nothing of mine was altered,
nothing extra was folded into my two files beyond my intended diff (confirmed via
`git show cfcfa0e1 -- <both files>` and re-running the full test suite against the
resulting HEAD). The commit is already on `origin/main`
(`git merge-base --is-ancestor cfcfa0e1 origin/main` → true), so no further push is
needed. I did not create a separate commit of my own, since my content is already
correctly committed and pushed.

**Commit SHA (already on origin/main, authored by the other session):**
`cfcfa0e1d43315ecc677c12385095e799df3072f`

## Concerns

1. The `reporting_manager` row-count change (54 → 55) documented above — a real behavior
   change for at least one live case (`Kamal Singh` vs `KAMAL SINGH`), worth the plan
   owner's awareness even though it's a correctness improvement.
2. The pre-existing masked-test-bug in `aonCohortSurvival's SQL uses
   AON_REFERENCE_JOIN_DATE_SQL...` (see TDD section) — out of this task's scope, not
   fixed, flagged for whoever owns that test/query next.
3. My commit landed via another session's broad, unrelated commit rather than my own
   scoped one — content verified identical to my intent, already on `origin/main`, no
   git surgery attempted per instructions.

---

## Addendum — post-review fix: window functions not matched to the new GROUP BY grain

## Status: DONE

Task review correctly caught a real, high-severity-but-narrow-scope bug that my original
verification missed: `share_pct` and `early_quit_rate` are both computed with window
functions (`... OVER (PARTITION BY ${dim.expr})`), and I had added `dimensionIdExpr` to
`GROUP BY` but not to either `PARTITION BY`. Before this task, `dim.expr` alone was the
`GROUP BY` key, so `PARTITION BY dim.expr` matched it exactly. After adding `dimension_id`
to `GROUP BY`, the `GROUP BY` grain became strictly finer than the `PARTITION BY` grain
whenever two distinct `dimension_id`s collate to equal text — exactly the "Kamal Singh"/
"KAMAL SINGH" case my own Concern #1 above already surfaced, but I had checked only that
`GROUP BY` correctly split the two managers into two rows with correctly-summed `exits`
(1030 + 46 = 1076); I had not checked whether the two *split* rows' window-function
columns (`share_pct`, `early_quit_rate`) were each computed from the manager's own exits or
still pooled from both. They were still pooled — the exact bug the reviewer named.

### Fix

Added `${dimensionIdExpr}` to both `OVER (PARTITION BY ...)` clauses (the `share_pct`
window and both windows inside `early_quit_rate`), so partition grain now matches `GROUP
BY` grain exactly:

```sql
/ NULLIF(SUM(COUNT(*)) OVER (PARTITION BY ${dim.expr}, ${dimensionIdExpr}), 0), -- share_pct
...
SUM(SUM(CASE WHEN ... THEN 1 ELSE 0 END)) OVER (PARTITION BY ${dim.expr}, ${dimensionIdExpr}) * 100.0
/ NULLIF(SUM(COUNT(*)) OVER (PARTITION BY ${dim.expr}, ${dimensionIdExpr}), 0)          -- early_quit_rate
```

Only `aon.executor.ts` changed — no new test case was added (the existing 2 dimension_id
tests assert on SQL text shape, not on computed percentage values, and adding a
percentage-value assertion would require executing real SQL against a live/seeded DB,
which the existing mocked-`db.execute` unit tests in this file are not set up to do; the
live-verification script below is the actual proof for this specific value-correctness
claim, matching how the original task's own live-verification was done).

### Live re-verification — the exact Kamal Singh / KAMAL SINGH case

Read-only script against the live `mas_hrms` DB, same 12-month exit window
(`2025-08-25`–`2026-08-25`), reproducing the `reporting_manager` dimension's `share_pct`/
`early_quit_rate` computation before and after the fix, isolated to just these two
manager rows:

```
=== BEFORE FIX (window partitioned by text only, pooled) ===
{ dimension_value: 'KAMAL SINGH',  dimension_id: '3efa07f9-6584-11f1-adb1-00155d0ab410', exits: 46,   share_pct: '4.28',  early_quit_rate: '51.30' }
{ dimension_value: 'Kamal Singh',  dimension_id: '149ba301-5e8e-11f1-adb1-00155d0ab410', exits: 1030, share_pct: '95.72', early_quit_rate: '51.30' }

=== AFTER FIX (window partitioned by text + dimension_id) ===
{ dimension_value: 'Kamal Singh',  dimension_id: '149ba301-5e8e-11f1-adb1-00155d0ab410', exits: 1030, share_pct: '100.00', early_quit_rate: '50.78' }
{ dimension_value: 'KAMAL SINGH',  dimension_id: '3efa07f9-6584-11f1-adb1-00155d0ab410', exits: 46,   share_pct: '100.00', early_quit_rate: '63.04' }
```

Confirmed: before the fix both managers shared one pooled `early_quit_rate` of `51.30`
(computed from the combined 1076 exits) despite already being separate `GROUP BY` rows.
After the fix each manager's `early_quit_rate` is distinct and computed from their own
exits only — `50.78` for the 1030-exit manager, `63.04` for the 46-exit manager — no
pooling across the two now-separated identities. (`share_pct` reads `100.00` for both in
this isolated single-dimension-only reproduction because the reproduction query has no
`aon_bucket` grouping term; in the real `attritionDeepDive` query `share_pct` is a
per-bucket share within each manager's own total, which is exactly what the fixed
partition now computes.)

### Test output (after fix)

```
$ cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon.executor.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ cd backend && npx vitest run src/modules/reporting/
 Test Files  49 passed (49)
      Tests  302 passed | 1 skipped (303)

$ cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon\.executor"
(no output)
```

### Commit

Checked `git status --porcelain` first: several unrelated files were dirty in this shared
tree from other concurrent sessions (`performance-scorecard*`, `dashboardAccessRegistry.ts`,
`pageRoutePageCodes.ts`) — left untouched. Diffed `aon.executor.ts` against HEAD before
staging to confirm the working tree contained exactly my 2 intended one-line changes and
nothing else, staged only that file by explicit path, and committed.

**Commit SHA:** `ecd4d9a6565aaddc328cb06f8e487bae8e8c9ba9`
Confirmed on `origin/main`: `git merge-base --is-ancestor ecd4d9a6 origin/main` → true.
`git show --stat HEAD` confirmed exactly 1 file changed, 3 insertions/3 deletions, matching
the intended fix.
