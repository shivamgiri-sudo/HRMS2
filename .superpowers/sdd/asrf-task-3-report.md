# Task 3: Pure Resolver Implementation — Report

## Summary

Successfully implemented Task 3 of 7 in the Attendance Source Rule Foundation plan. This task delivered the single most important file in the feature: the pure, deterministic `resolveRule<T>()` algorithm plus its property-based tests.

## What Was Done

### Step 1: Write failing property tests
Created `/backend/src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts` with 4 property-based test suites:
1. **Resolution totality** — always returns exactly one winner when System_Default_Rule is present
2. **Resolution determinism** — two consecutive resolutions return the same winner
3. **Specificity and priority ordering** — winner has maximum specificity among matching rules
4. **Missing dimension protection** — a rule constraining a dimension an employee lacks is never the winner

Each property test runs 200 generated cases using fast-check, exercising the full algorithmic space with random employees and rule sets.

### Step 2: Verified test failure
Tests failed as expected with the required error:
```
Error: Cannot find module '../attendance-source-rule-resolver.js'
```

### Step 3: Write resolver implementation
Created `/backend/src/modules/wfm/attendance-source-rule-resolver.ts` with:
- `RuleDimension` type (6 dimensions: cost_centre, process, branch, department, designation, employment_profile)
- `DIMENSION_PRIORITY_ORDER` constant
- `DimensionScopedRule` and `EmployeeAttributes` interfaces
- `EliminationStep` and `ResolutionResult<T>` types
- Pure function `resolveRule<T>()` implementing the 4-step algorithm:
  1. Candidacy filtering (dimension matching)
  2. Specificity filtering (keep max-specificity rules)
  3. Priority-order filtering (first constraining dimension in priority order)
  4. Deterministic tail (effectiveFrom desc, createdAt desc, id asc)

Code copied verbatim from the task brief with no modifications.

### Step 4: Verified all tests pass
All 4 property tests pass, each running 200 generated cases.

### Step 5: Committed
Staged only the two files created by this task and committed with the exact message.

## Test Output

### Step 2: Failing test run
```
cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts

 RUN  v4.1.7 C:/Users/ADMIN/Desktop/HRMS2-latest/.claude/worktrees/attendance-source-rule-foundation/backend

 ❯ src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯

 FAIL  src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts [ src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts ]
Error: Cannot find module '../attendance-source-rule-resolver.js' imported from C:/Users/ADMIN/Desktop/HRMS2-latest/.claude/worktrees/attendance-source-rule-foundation/backend/src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts

 Test Files  1 failed (1)
      Tests  no tests
   Start at  01:59:33
   Duration  1.16s (transform 42ms, setup 44ms, import 0ms, tests 0ms, environment 0ms)
```

### Step 4: Passing test run
```
cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts

 RUN  v4.1.7 C:/Users/ADMIN/Desktop/HRMS2-latest/.claude/worktrees/attendance-source-rule-foundation/backend

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  02:00:06
   Duration  1.03s (transform 58ms, setup 40ms, import 54ms, tests 46ms, environment 0ms)
```

## Git Commit

**SHA:** `03446e8f`

**Message:** `feat: add resolveRule() — the deterministic Attendance_Source_Rule resolution algorithm (Requirement 2), property-tested`

**Files staged:**
- `backend/src/modules/wfm/attendance-source-rule-resolver.ts` (171 lines)
- `backend/src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts` (191 lines)

## Concerns

None. The implementation is complete, all 4 property-based tests pass (800 generated test cases total: 4 properties × 200 runs each), the resolver function is pure and deterministic, and the exact code from the brief was implemented without modification. The algorithm is ready for consumption by Tasks 4-6 (the four thin DB-backed wrapper services).

---

## Post-review fix report (2026-08-30)

### What was changed

**`backend/src/modules/wfm/attendance-source-rule-resolver.ts`**
1. Duplicate-id bug: `eliminatedAt` map is now keyed by the rule object itself (`Map<T, EliminationStep>`), not by `r.id` (string). All four `.set(...)` call sites and both `.get(...)` call sites switched to object-reference keys. The winner check in the final `candidates` mapping changed from `r.id === winner.id` to `r === winner`. Two distinct rule objects that happen to share an `id` no longer both report as winner in the resolution-preview payload.
2. Froze the shared constant: `DIMENSION_PRIORITY_ORDER` is now wrapped in `Object.freeze([...])` so `.reverse()` or any other in-place mutation can no longer corrupt every subsequent resolution process-wide.
3. Fixed the O(n²) pattern in the priority-order elimination step: replaced `constrainedBy.includes(r)` (O(n) array scan per survivor) with a `Set` built once (`constrainedByIds`) and membership-checked via `.has(r)` — consistent with the reference-identity fix above.
4. Added an explanatory comment above `specificityCount: -1` documenting it as a deliberate sentinel for the "no candidate matched" defensive branch.

**`backend/src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts`**
Replaced entirely per the fix brief:
- Removed the module-level mutable `ruleCounter`; rule `id` is now generated by `fc.uuid()` inside the record arbitrary itself, so ids are a pure function of the fast-check seed (restores shrink/replay fidelity).
- Strengthened Property 2 (determinism) with a new order-independence check (`reversed.winner === forward.winner`).
- Strengthened Property 3 (specificity/priority) with a new assertion that directly exercises the priority-walk step: the winner must constrain the first priority-order dimension that splits the tied max-specificity survivors — the assertion that specifically catches the previously-undetected mutants (reversed walk, deleted priority step, off-by-one on the "some but not all" boundary).
- Added a new standalone property for the deterministic tail (latest `effectiveFrom` -> latest `createdAt` -> lowest `id`), independently recomputed from an oracle that does not import the resolver's own logic.
- Added 3 hand-traced example tests: (A) specificity tie broken by dimension priority order, (B) missing employee attribute excludes the most-specific rule + tail picks later `effectiveFrom`, (C) duplicate rule ids — proves the winner is now identified by object reference (exactly one candidate has `eliminatedAtStep: null`).

### Test output

`npx vitest run src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts`:
```
 Test Files  1 passed (1)
      Tests  10 passed (10)
```
(1 totality + 2 determinism + 2 specificity/priority + 1 tail + 1 missing-dimension + 3 example scenarios = 10 `it(` blocks, all passing.)

Full four-file run (`attendance-source-rule-resolver.property.test.ts attendance-source-rule.service.test.ts day-threshold-rule.service.test.ts attendance-threshold-config.service.test.ts`): only the resolver property test file exists at this point in the plan — the other three do not yet exist in `backend/src/modules/wfm/__tests__/` (they belong to later tasks in the 7-task plan that build the DB-backed wrappers around this resolver). Vitest picked up 1 test file, 10 tests, all passed; no downstream breakage is possible yet since no downstream consumers exist in this worktree.

### Commit

- Files staged: exactly `backend/src/modules/wfm/attendance-source-rule-resolver.ts` and `backend/src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts` (verified via `git status --porcelain` before commit; untracked `.superpowers/sdd/*` scaffolding and the modified `.superpowers/sdd/progress.md` were left untouched).
- Commit SHA: `a589f5d370f68c86dce48c7f92feb83d1c632981`

---

## Post-review fix report, round 2 (2026-08-30)

### What was changed

**`backend/src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts`**

1. **Fix 1 (Critical — M5, tail id-tier inversion, was reachable in only 0.03% of generated cases):** In `testRuleArb`, the `createdAt` string now collapses `createdAtOffset % 60` to `createdAtOffset % 2` (only `:00`/`:01`), so `createdAt` ties — and therefore the id-comparison tier of the deterministic tail — are hit far more often across the small (max 8) generated rule arrays. Added a deterministic example test, `'tail id tier: when effective_from and created_at both tie, the lowest id wins'`, that pins two rules with identical `effectiveFrom`/`createdAt` and asserts the lower-id rule (`'aaa-low'`) wins over the higher-id rule (`'zzz-high'`) regardless of generator luck.
2. **Fix 2 (Important — M1, priority-split boundary off-by-one, previously seed-dependent):** Added a deterministic example test, `'priority-split boundary: a dimension constrained by ALL tied survivors does not split them, but the next one that splits some-but-not-all does'`. `cost_centre` constrains both tied survivors (must not split) while `process` constrains only one (must split), asserting the correctly-walking rule (`z-correct`) wins even though its id sorts after the wrong-branch rule (`a-wrong`) — so an inverted boundary condition fails this test on every run, with no seed dependency.
3. **Fix 4 (Minor — Property 4 truthiness inconsistency):** The inner check in Property 4 now reads `result.winner!.dimensionValues[dim]` into `winnerConstrainsDim` and requires `winnerConstrainsDim && winnerConstrainsDim.size > 0`, matching the `size > 0` convention used everywhere else in the file (an empty `Set` is truthy but the resolver treats it as unconstrained).
4. **Fix 5 (Minor — oracle shared the SUT's own constant):** Added a locally-declared `TEST_DIMENSION_PRIORITY_ORDER` (not the same reference as the resolver's imported `DIMENSION_PRIORITY_ORDER`) and switched the two functions that looped over the shared constant for oracle purposes — `testRuleMatches` and `testSpecificity` — to iterate `TEST_DIMENSION_PRIORITY_ORDER` instead. (`testConstrains` takes `dim` as a parameter and has no internal loop, so nothing there needed changing.) All other uses of `DIMENSION_PRIORITY_ORDER` — the `testRuleArb` mapping loop, and the three `fc.property` bodies that check the real resolver's output against real employee attributes — were left untouched, since those are validating the SUT's actual behavior, not re-deriving an independent oracle. Added a new standalone `describe('DIMENSION_PRIORITY_ORDER contract', ...)` block pinning the resolver's exported order to the six expected dimension names, so a reordering mutant is still caught even though the oracle no longer shares the reference.
5. **Fix 6 (Minor — no-candidate/`winner: null` branch untested):** Added a deterministic example test, `'no candidate matches at all: winner is null and specificityCount is the -1 sentinel'`, with a single rule that constrains `cost_centre` to a value the employee doesn't have and no `System_Default_Rule` in the array — asserts `winner: null`, `specificityCount: -1`, and the sole candidate's `eliminatedAtStep: 'not_candidate'`.

**`backend/src/modules/wfm/attendance-source-rule-resolver.ts`**

6. **Fix 3 (Minor — misleading name):** In the priority-order elimination step, `constrainedByIds` (a `Set` that actually holds rule *objects* by reference, not ids) was renamed to `constrainedBySet`. No behavioral change — this is the only edit made to this file, as instructed.

### Test output

```
cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts

 RUN  v4.1.7 C:/Users/ADMIN/Desktop/HRMS2-latest/.claude/worktrees/attendance-source-rule-foundation/backend

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  02:29:00
   Duration  1.10s (transform 112ms, setup 78ms, import 80ms, tests 68ms, environment 0ms)
```
(10 prior `it(` blocks + Fix 1's example + Fix 2's example + Fix 6's example + Fix 5's new contract-describe example = 14 `it(` blocks total, all passing — confirmed by `grep -c "  it(" ...` before running.)

### Commit

- Files staged: exactly `backend/src/modules/wfm/attendance-source-rule-resolver.ts` and `backend/src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts` (verified via `git status --porcelain` before commit; untracked `.superpowers/sdd/*` scaffolding and the modified `.superpowers/sdd/progress.md` were left untouched).
- Commit SHA: `59d97282b7294912eb3a716a2fdd9cbdb0e0ebf3` (short: `59d97282`)

### Concerns

None. All six fixes applied exactly as specified; the resolver file received only the one instructed rename with no logic change; all 14 tests pass.
