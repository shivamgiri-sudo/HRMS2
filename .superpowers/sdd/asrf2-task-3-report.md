# Task 3 Report: deriveCanonical() — the Requirement 18 aggregation algorithm

## What Was Done

Implemented the pure aggregation algorithm `deriveCanonical()` and its comprehensive property-based test suite, following the exact specifications from the brief.

### Files Created
1. `backend/src/modules/wfm/canonical-productivity.ts` — The implementation
2. `backend/src/modules/wfm/__tests__/canonical-productivity.property.test.ts` — The test suite

### Implementation Details

The implementation provides:
- **Contribution interface**: Captures diallerSourceId, optional interval (minutes from midnight), and magnitudeMinutes
- **ProducingRule type**: Two rules — 'interval_union' (primary) and 'max_contribution' (secondary)
- **CanonicalResult interface**: Returns minutes, rule, and excludedCount
- **deriveCanonical() function**: Pure aggregation logic with no DB access

**Algorithm logic**:
1. Empty contribution list returns null (criterion 18.10)
2. Primary rule (18.4): If all contributions have usable intervals, sweep-merge overlapping intervals and sum the merged lengths (any instant covered by multiple contributions counts once)
3. Secondary rule (18.6): If ANY contribution lacks a usable interval, the WHOLE employee-date falls to the maximum single magnitude (criterion 18.6)
4. A contribution is usable only when interval is present AND endMinute > startMinute (criterion 18.5)
5. Result is clamped to 1440 minutes maximum (calendar day bound, criterion 20)

### Test Results

#### Step 2 — Test Failure (Expected)
```
RUN  v4.1.7 C:/Users/ADMIN/Desktop/HRMS2-latest/.claude/worktrees/attendance-source-rule-registry-aggregation/backend

 ❯ src/modules/wfm/__tests__/canonical-productivity.property.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/modules/wfm/__tests__/canonical-productivity.property.test.ts [ src/modules/wfm/__tests__/canonical-productivity.property.test.ts ]
Error: Cannot find module '../canonical-productivity.js' imported from C:/Users/ADMIN/Desktop/HRMS2-latest/.claude/worktrees/attendance-source-rule-registry-aggregation/backend/src/modules/wfm/__tests__/canonical-productivity.property.test.ts
```

Error occurred as expected — implementation did not exist yet.

#### Step 4 — Test Success (All Pass)
```
RUN  v4.1.7 C:/Users/ADMIN/Desktop/HRMS2-latest/.claude/worktrees/attendance-source-rule-registry-aggregation/backend


 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  09:15:36
   Duration  1.47s (transform 57ms, setup 38ms, import 56ms, tests 43ms, environment 0ms)
```

All 12 tests pass:
- **Property 20**: Daily bound holds (canonical minutes ≤ 1440) — 300 cases
- **Property 21**: Neither shrinkage nor inflation (bounds hold per rule type) — 300 cases
- **Property 22a**: Recomputation stability (consecutive derivations match) — 300 cases
- **Property 22b**: Producing rule is recorded correctly — 300 cases
- **Criterion 18.10**: Absent is never zero (empty list returns null)
- **Hand-traced examples**: 7 concrete scenarios covering overlaps, adjacency, nesting, null intervals, zero-length intervals, and clamping

### Commit Details

**Commit SHA**: `8f3b33c0`

```
git add backend/src/modules/wfm/canonical-productivity.ts \
        backend/src/modules/wfm/__tests__/canonical-productivity.property.test.ts
git commit -m "feat: add deriveCanonical() — the Requirement 18 aggregation algorithm, property-tested"
```

### Code Quality

- Implementation copied verbatim from brief (character-for-character, including comments)
- Test suite copied verbatim from brief (character-for-character, including comments)
- Property tests run 300 generated cases each as specified
- No structural changes or "improvements" made
- All requirements met exactly as specified

## Concerns

None. Implementation and tests completed successfully per specification. All 12 tests pass on first run after implementation.

---

## Fix Report — Review Findings Addressed (2026-08-30)

A reviewer verified the algorithm CORRECT via a 20,000-case differential fuzz against a brute-force
oracle, but found real test-suite gaps: an `excludedCount` mutant survived entirely undetected, the
property-test generator structurally could not produce a zero-length or inverted interval (so half
of `isUsable()`'s predicate was untested by any property test), inverted intervals (a real shape — a
midnight-crossing dialler session naively mapped) had zero coverage anywhere despite a mutant there
producing silently negative canonical minutes, and there was no floor/finite guard against garbage
magnitude data (negative or `NaN`) from messy real-world uploads.

### Fix 1 — implementation (`canonical-productivity.ts`)

Sanitized `magnitudeMinutes` before taking the max in the `max_contribution` branch — a negative or
non-finite value is now treated as `0` rather than propagating (previously `NaN` could collide with
the wire value criterion 18.10 reserves for "absent" once serialized). Both return paths
(`max_contribution` and `interval_union`) now floor the final result with `Math.max(0, ...)` in
addition to the existing `Math.min(..., 1440)` ceiling, so the function can never return a negative
or non-finite result regardless of input quality.

### Fix 2 — tests (`canonical-productivity.property.test.ts`)

Replaced the entire test file:
- **Generator widened**: added `anyIntervalArb`, which (unlike the old start<end-only generator)
  can produce normal, zero-length, AND inverted intervals, so the property tests now actually
  exercise the full `isUsable()` predicate instead of only its first disjunct.
- **excludedCount now asserted**: a new property test checks `excludedCount` equals the count of
  unusable contributions under `max_contribution` and is always 0 under `interval_union` — closes
  the previously-undetected mutant.
- **Inverted-interval coverage added**: a dedicated hand-traced scenario for a midnight-crossing
  session (`{start: 1380, end: 60}`) confirms it is treated as unusable, demotes to
  `max_contribution`, and never yields a negative result.
- **Dead/weak assertions replaced**: the purity check now snapshots a randomized (non-sorted) input
  array and asserts both array order and every contribution's serialized value are unchanged after
  the call — a real check, not one that would pass under an in-place sort.
- **New garbage-input coverage**: negative and `NaN` magnitude cases assert the sanitize/floor fix
  in Fix 1.

### Test Results

```
RUN  v4.1.7 .../backend
 Test Files  1 passed (1)
      Tests  17 passed (17)
   Duration  1.07s
```

All 17 tests pass (1 daily-bound + 1 neither-shrinkage-nor-inflation + 4 recomputation-stability +
1 absent-is-never-zero + 10 hand-traced examples).

### Commit Details

**Commit SHA**: `bad55cce`

Staged only the two target files:
- `backend/src/modules/wfm/canonical-productivity.ts`
- `backend/src/modules/wfm/__tests__/canonical-productivity.property.test.ts`

### Concerns

None. All findings from the review addressed; full test suite passes.
