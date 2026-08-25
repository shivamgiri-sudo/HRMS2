# Task 2 Report — cohort-survival drill ids + cohortMonth filter

## Status: DONE_WITH_CONCERNS (see "Shared-tree bundling" below — non-destructive, work verified landed)

## Summary of what was actually needed vs found

On starting this task I read the brief and then read the *live* state of every file it
names, per the "shared tree is very active" instruction. Two of the three required changes
(Steps 1–4/6 in the brief) were **already implemented and committed by a concurrent
session** before I started:

- `aonCohortSurvival` in `backend/src/modules/reporting/executors/aon.executor.ts` already
  selected `b.id AS branch_id, cc.id AS cost_centre_id, p.id AS process_id` and already had
  them in `GROUP BY` — landed in commit `c2658a92` ("fix(reporting): select raw
  branch/cost-centre/process ids in AON bucket reports"), itself bundled under an unrelated
  later commit title (`011f7df6`, "feat(ats): add daily hiring report...") that also touched
  this file with no functional change to this part.
- The matching test (`aonCohortSurvival's SQL selects branch_id/cost_centre_id/process_id`)
  already existed in `aon.executor.test.ts` and already passed.
- `aonDrilldownEmployees` in `aon-drilldown.executor.ts` already had the full `cohortMonth`
  clause (regex-validated `YYYY-MM`, `DATE_FORMAT(...) = ?`, applied independently alongside
  `aonBucketClause` in the non-exit branch), with the matching test in
  `aon-drilldown.executor.test.ts` already present and passing.

**The one piece of this task that was genuinely missing** — and it was exactly the defect
class the brief warns about — was Step 5: `cohortMonth` was NOT in
`report-suite.routes.ts`'s `default:` branch `execFilters` object. `metric` and `aonBucket`
were there (Plan 1's fix); `cohortMonth` was silently absent, meaning a real HTTP request
with `?cohortMonth=2026-03` would have had the field dropped before the executor ever saw
it — identical in kind to Plan 1's Critical B defect. I fixed this.

## The exact line added

In `backend/src/modules/reporting/report-suite.routes.ts`, in the `default:` branch's
`execFilters` object (originally around line 3153, my addition landed at line 3169 after
the `aonBucket` line):

```typescript
cohortMonth:  req.query.cohortMonth  as string | undefined,
```

Full context as it now reads (lines 3164–3169):
```typescript
        status:       req.query.status       as string | undefined,
        includeInactive: req.query.includeInactive === 'true',
        financialYear: req.query.financialYear as string | undefined,
        metric:       req.query.metric       as string | undefined,
        aonBucket:    req.query.aonBucket    as string | undefined,
        cohortMonth:  req.query.cohortMonth  as string | undefined,
```

`ExecFilters` (in `executors/types.ts`) carries an index signature
(`[key: string]: unknown`), so no type change was needed there — `metric`/`aonBucket`/
`cohortMonth` all flow through it without an explicit named field, same as Plan 1's fix.

## TDD process followed

- Read the brief's Step 1 tests. Both were already present in the test files (added by the
  concurrent session that implemented Steps 3–4). Ran them first to confirm current state:
  `npx vitest run .../aon.executor.test.ts .../aon-drilldown.executor.test.ts` →
  **10/10 passed** (test files: 2 passed). Since the executor-level code was already
  correct, there was no executor-level failing state left to drive — the only remaining
  gap was the HTTP-layer wiring in `report-suite.routes.ts`, which has no dedicated unit
  test in this codebase (same as Plan 1's original `metric`/`aonBucket` fix — that field
  addition also had no direct routes-level unit test, only the live-HTTP trace in the
  whole-branch review). I proceeded straight to the fix and to live DB verification as the
  proof for this step, per the Global Constraints' emphasis on live-DB verification over
  hand-written tests for anything SQL/HTTP-layer.
- Implemented the one-line fix (Step 5).
- Re-ran both target test files: still 10/10 passing (no regression).
- Ran the full reporting suite: `npx vitest run src/modules/reporting/` →
  **49 test files passed, 300 passed / 1 skipped (301 total)**.
- Scoped typecheck: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon\.executor|aon-drilldown|report-suite"`
  → **no output** (no errors in touched files).

## Live verification (read-only, against mas_hrms on 122.184.128.90)

Verification scripts were written to `backend/_verify_task2.ts` / `_verify_task2b.ts`
(direct `tsx` invocation, same pattern as prior Plan 1 tasks), run, and then deleted —
they are not part of the commit.

### 1. `aonCohortSurvival` — branch_id/cost_centre_id/process_id round-trip

```
aonCohortSurvival rowCount: 340 rows returned: 340
sample non-UNASSIGNED row: {
  branch_id: 'fea10538-6583-11f1-adb1-00155d0ab410',
  cost_centre_id: null,
  process_id: null,
  branch_name: 'AHMEDABAD-JALDARSHAN'
}
branch_master lookup: [ { id: 'fea10538-6583-11f1-adb1-00155d0ab410', branch_name: 'AHMEDABAD-JALDARSHAN' } ]
```

Second pass, specifically searching for a row with all three ids populated (to prove
cost_centre_id/process_id round-trip too, not just branch_id):

```
row with all 3 ids populated: {
  branch_id: '77769026-5e88-11f1-adb1-00155d0ab410',
  cost_centre_id: '02aa5e4c-6584-11f1-adb1-00155d0ab410',
  process_id: 'b0afc80e-6969-11f1-adb1-00155d0ab410'
}
cost_centre_master lookup: [ { id: '02aa5e4c-6584-11f1-adb1-00155d0ab410', cost_centre_name: 'BSS/IB/Noida/647' } ]
process_master lookup: [ { id: 'b0afc80e-6969-11f1-adb1-00155d0ab410', process_name: 'IDAM Natural Wellness' } ]
```

All three ids resolve to real, matching rows in `branch_master`/`cost_centre_master`/
`process_master`. 340 rows total — this executor was not modified by me in this task, so
no row-count baseline comparison was needed (I made no change to its grouping grain); the
id columns were already additive-only per the prior commit's own diff (verified via
`git log -p` showing only 3 SELECT lines and 3 GROUP BY tokens added, nothing removed).

### 2. `aonDrilldownEmployees` — cohortMonth filter accuracy

```
candidate months (active headcount):
  2026-07: 130, 2026-06: 126, 2026-08: 121, 2026-05: 102, 2026-04: 77

aonDrilldownEmployees(cohortMonth=2026-07) rowCount (active only): 130
Direct COUNT active employees in 2026-07: 130
Rows returned whose join month does NOT match testMonth (should be 0): 0
```

Executor count (130) matches the direct SQL count (130) exactly, and a follow-up check
against every returned `employee_id` confirmed 0 rows whose actual join month differs from
the requested `cohortMonth` — no leakage, no undercounting.

## Commit

**No new commit was made under my own message** — see "Shared-tree bundling" below. My one
file (`report-suite.routes.ts`) was staged cleanly by itself (`git add
backend/src/modules/reporting/report-suite.routes.ts`, confirmed via `git status
--porcelain` immediately before showing nothing else staged), but before I could run
`git commit`, a concurrent session committed and its commit absorbed my already-staged
file. The change is present and pushed:

- **Commit SHA:** `cd76ad0fc224e7ea9a88c9211c431654c58d8d1c`
- **Commit title (not mine):** "test: use health root endpoint with query param"
- **Verified via `git show HEAD -- backend/src/modules/reporting/report-suite.routes.ts`**:
  diff shows exactly the one line I added (`cohortMonth: req.query.cohortMonth as string |
  undefined,`), nothing else in that file changed.
- **Verified pushed:** `git fetch origin && git merge-base --is-ancestor HEAD origin/main`
  → true. `origin/main`'s tip is `cd76ad0f` itself, so no separate push step was needed or
  taken — it was already public when the concurrent session pushed its own commit.

### Shared-tree bundling — what happened, per protocol

Per `CLAUDE.md`'s Concurrent Agent Rule and the brief's own note that "this shared tree has
had several such incidents, all non-destructive": I staged only
`backend/src/modules/reporting/report-suite.routes.ts` via explicit path (never `git add
-A`/`.`), confirmed via `git status --porcelain` that nothing else was staged, and then
before I ran `git commit` a concurrent session's commit landed and included my staged file
alongside its own `backend/src/routes/health.routes.ts` change and an unrelated untracked
doc (`.superpowers/sdd/employee-performance-scorecard/reviews/final-whole-branch-diff.md`).
I did not attempt any git surgery (no reset, no rebase, no cherry-pick) — per instructions
I verified my content landed intact (`git show HEAD -- <my file>`), confirmed it reached
`origin/main`, and am reporting it here rather than fabricating a commit that didn't
happen under my own authorship. The net effect on the codebase is identical to if I had
committed it myself: the change is live, tested, and pushed.

## Concerns

1. **Attribution**: my `cohortMonth` line is now permanently recorded under an unrelated
   commit message about a health-endpoint test. This is a cosmetic/traceability issue only
   — the code is correct and verified — but it means `git log -S cohortMonth` or `git blame`
   on that line will not point to a commit describing what it does. Flagging per the
   "broad commits revert work" memory pattern.
2. Steps 3/4/6 of the brief (the `aonCohortSurvival` id columns and the
   `aonDrilldownEmployees` cohortMonth clause) were done by a different, unidentified
   concurrent session before I started — I did not write that code, only verified it live
   and confirmed the tests it added pass. I'm flagging this so Plan 2's own tracking isn't
   confused about who wrote what; the code itself checked out correctly against everything
   the brief specified (same SELECT/GROUP BY placement pattern as Plan 1's three Overview
   functions, and the same optional-independent-filter pattern for cohortMonth alongside
   aonBucket).
3. No dedicated unit test exists for the routes.ts HTTP-layer whitelist wiring itself (only
   for the executor's SQL behavior) — this mirrors Plan 1's original `metric`/`aonBucket`
   fix, which also had no such test, only the whole-branch review's live-HTTP trace. If a
   future whole-branch review wants a regression guard against this exact defect class
   recurring, an integration test hitting `report-suite.routes.ts`'s default branch with a
   `cohortMonth` query param and asserting the executor receives it would close that gap for
   good — I did not add one since it wasn't in this task's Test file list, but note it here
   as a possible follow-up for the plan's own whole-branch review.
