# Task 6 Report: Four filter dimensions, and honest date pickers

## Summary

Exposed the three previously-hidden filter dimensions (Process, Department, Cost Centre) that
the backend (`appendFilterConditions`) already supported, and added an explicit note that
Headcount is an as-of-today snapshot so the From/To pickers do not silently do nothing for that
metric.

## Changes by component

### Page shell (`AonAnalyticsView` default export, ~line 1208 onward)

- Added `processId`, `departmentId`, `costCentreId` state alongside the existing `branchId`.
- Added three `useQuery` lookups beside the existing `branches` query:
  - `processes` → `GET /api/org/processes?active_status=1&limit=500`
  - `departments` → `GET /api/org/departments?active_status=1&limit=500`
  - `costCentres` → `GET /api/finance/cost-centres?active_status=1&limit=1000`
- Added three `<Field>` selects (Process, Department, Cost Centre) after the existing Branch
  select in the filter bar, each defaulting to "All …" and populated from the new queries.
- Added a note paragraph immediately after the From/To date `<Field>` pair:
  "Headcount is as of today — the date range applies to Exits, Shrinkage, Cohort Survival and
  the Deep Dive." This is the recorded deviation from the original spec (see below) — the date
  inputs are NOT disabled for the Headcount metric, only annotated, because `metric` is state
  local to `Overview` while the date inputs live in the page component. Not "fixed" per explicit
  instruction not to lift state.
- Widened the three tab renders (`Overview`, `CohortSurvival`, `DeepDive`) to pass
  `processId`, `departmentId`, `costCentreId` in addition to the existing `from`, `to`,
  `branchId`.
- Left `headline` (`aon-overall-attrition-rate`, used for the headline KPI) unchanged — the
  brief's Step 5 only calls out `Overview`, `CohortSurvival`, `DeepDive` for the four-filter
  widening; `headline` still only conditions on `branchId`. Flagging this in case a follow-on
  task wants headline widened too, but it was out of scope for Task 6 as written.

### `Overview` (~line 352)

- Widened props to `{ from, to, branchId, processId, departmentId, costCentreId, headlineRate }`.
- Rebuilt `base` from a single `branchId ? { branchId } : {}` into a four-key spread:
  ```tsx
  const base = {
    ...(branchId ? { branchId } : {}),
    ...(processId ? { processId } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(costCentreId ? { costCentreId } : {}),
  };
  ```
  `base` still feeds `aon-bucket-headcount`, `aon-bucket-attrition`, and (gated)
  `aon-bucket-shrinkage`, so all three metrics under Overview now see all four filters.

### `CohortSurvival` (~line 803)

- Widened props to `{ from, to, branchId, processId, departmentId, costCentreId }`.
- `aon-cohort-survival` query params now spread all four optional filter keys alongside
  `from`/`to`.

### `DeepDive` (~line 1056)

- Widened props to `{ from, to, branchId, processId, departmentId, costCentreId }`.
- `attrition-deep-dive` query params now spread all four optional filter keys alongside
  `from`, `to`, `dimension`.

## Deliberate deviation (per brief, not "fixed")

The date inputs are not `disabled` when the Headcount metric is selected. `metric` is local
state inside `Overview`; the date inputs live in the page component (`AonAnalyticsView`).
Lifting `metric` to disable the inputs would mean threading it through the page and back down
into `CohortSurvival` and `DeepDive`, which have no metric selector at all — a refactor larger
than the defect being fixed. The added note text discharges the actual problem (the control
silently lying), consistent with the brief's explicit instruction not to lift state or add a
`disabled` prop.

## TDD stages

### Stage 1 — failing test written, confirmed to fail

File created: `src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx`
(verbatim from the brief).

Command:
```
npx vitest run src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx
```

Result: **4 failed (4)** — confirms the three new filters had no state, no endpoints, and the
"as of today" note did not exist yet (ran before any implementation edits).

```
❯ src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx:39:17
     37|
     38|   it("does not pretend the date range filters headcount", () => {
     39|     expect(SRC).toMatch(/as of today/i);
       |                 ^
     40|   });
     41| });

 Test Files  1 failed (1)
      Tests  4 failed (4)
```

### Stage 2 — implementation, test passes

Command:
```
npx vitest run src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx
```

Result:
```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

## Typecheck

Command:
```
npm run typecheck 2>&1 | grep AonAnalyticsView
```

Output (one pre-existing, unrelated error — line number shifted because new lines were added
above it):
```
src/components/reports/views/AonAnalyticsView.tsx(942,28): error TS2322: Type '{ cohort: string; joined: number; left30: number; left90: number; "Survived 30d": number; "Survived 60d": number; "Survived 90d": number; }' is not assignable to type '{ cohort: string; joined: number; left30: number; } & Record<string, number>'.
```

Verified this is pre-existing and not introduced by this task: stashed all Task 6 changes and
re-ran the same typecheck command — the identical error appears at line 924 (pre-edit line
number) in the unmodified file. Task 6's edits introduced no new type errors; the brief's
"expected: no output" was based on a clean baseline that does not hold here, but the delta
attributable to this task is zero.

## Commit

```
git add src/components/reports/views/AonAnalyticsView.tsx src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx
git commit -m "feat(aon): expose process, department and cost-centre filters"
```

Staged only these two files — `git status --porcelain` before staging showed unrelated
untracked paths (`.sdd/`, `backend/.sdd/`, `backend/wp-check.cjs`) from other work in this
shared worktree; none of those were added.

Commit SHA: `b193a591`

## Concerns / notes

1. Pre-existing TS2322 error in this same file (cohort survival row typing) is unrelated to
   Task 6 and was not touched — confirmed via git stash comparison above.
2. The headline KPI query (`aon-overall-attrition-rate`) was intentionally left filtering on
   `branchId` only, matching the brief's Step 5 scope (it only names `Overview`,
   `CohortSurvival`, `DeepDive`). If the intent was for the headline number to also honor the
   new filters, that's a gap the brief itself does not close.
3. No backend files were touched, per the "no backend change" instruction — `appendFilterConditions`
   already accepted all four dimensions and required no edits.

---

## Follow-up: Headline KPI Filter Fix

The concern raised in Note 2 above was addressed in a follow-on fix to wire all four filters
to the headline KPI query.

### Issue

The headline attrition-rate KPI (`aon-overall-attrition-rate`) at the top of the page was left
filtering on `branchId` only, while the three tabs below (Overview, CohortSurvival, DeepDive)
all received all four dimensions. When a user selected Process, Department, or Cost Centre, the
tables below would narrow but the big headline number would not change, causing the page to
contradict itself on screen.

### Code Changes

**Before (Line 1264):**
```typescript
const headline = useReport("aon-overall-attrition-rate", branchId ? { branchId, from, to } : { from, to });
```

**After (Lines 1264-1270):**
```typescript
const headline = useReport("aon-overall-attrition-rate", {
  ...(branchId ? { branchId } : {}),
  ...(processId ? { processId } : {}),
  ...(departmentId ? { departmentId } : {}),
  ...(costCentreId ? { costCentreId } : {}),
  from, to,
});
```

The fix follows the same conditional-spread pattern used in the `Overview` component's `base`
object, ensuring unset filters are omitted rather than sent as empty strings.

### Test Assertion Added

Added a new test in `AonAnalyticsView.filters.test.tsx` to verify all four filters are
included in the headline query:

```typescript
it("includes all four dimension filters in the headline query", () => {
  // The headline query must pass all four filters to the backend, not just branchId.
  // Extract the headline useReport call and verify it spreads all four filters.
  const headlineMatch = /const headline\s*=\s*useReport\([^)]*\{[\s\S]{0,800}?\}\s*\);/.exec(SRC)?.[0] ?? "";
  expect(headlineMatch, "headline query not found").toContain("useReport");
  expect(headlineMatch, "branchId not in headline filters").toContain("branchId");
  expect(headlineMatch, "processId not in headline filters").toContain("processId");
  expect(headlineMatch, "departmentId not in headline filters").toContain("departmentId");
  expect(headlineMatch, "costCentreId not in headline filters").toContain("costCentreId");
});
```

### Falsification Experiment

**Test with fix applied (PASS):**
```
Test Files  1 passed (1)
     Tests  5 passed (5)
  Start at  23:33:04
  Duration  1.24s
```

**Test with code reverted to branchId-only (FAIL):**
```
FAIL  src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx > AON filters > includes all four dimension filters in the headline query
AssertionError: processId not in headline filters: expected 'const headline = useReport("aon-overa…' to contain 'processId'

Expected: "processId"
Received: "const headline = useReport("aon-overall-attrition-rate", branchId ? { branchId, from, to } : { from, to });"

Test Files  1 failed (1)
     Tests  1 failed | 4 passed (5)
```

The assertion is specific enough to catch the regression — reverting the code causes it to fail.

### TypeScript Verification

No new TypeScript errors introduced. The pre-existing TS2322 error at line 922 (cohort survival
row typing) remains unchanged.

**Typecheck output:**
```bash
npm run typecheck 2>&1 | grep AonAnalyticsView
```
```
src/components/reports/views/AonAnalyticsView.tsx(922,28): error TS2322: Type '{ cohort: string; joined: number; left30: number; left90: number; "Survived 30d": number; "Survived 60d": number; "Survived 90d": number; }' is not assignable to type '{ cohort: string; joined: number; left30: number; } & Record<string, number>'.
```

### Commit

Commit SHA: `d282856b`

```
Task 6: Wire all four filters to headline KPI query

The headline attrition-rate query was left behind during Task 6 and only
received the branchId filter. The Overview, CohortSurvival, and DeepDive
tabs all wire all four dimensions (branchId, processId, departmentId,
costCentreId) via conditional-spread style, but the headline KPI at the
top of the page narrowed only by Branch, causing the page to contradict
itself on screen when other filters were applied.

This fix applies the same conditional-spread pattern to the headline
query params so all four filters reach the backend's appendFilterConditions
call, which already supported them.

Added assertion to AonAnalyticsView.filters.test.tsx that verifies the
headline query receives all four filters, specific enough to fail if
reverted to branchId-only.
```
