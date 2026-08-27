# Task 1: Shared Workforce-Population Module — Completion Report

**Date:** 2026-08-26  
**Commit SHA:** `985f5b0d`

## Summary

Task 1 successfully creates the shared `workforce-population` module that defines the single source of truth for the reporting workforce population. This is the infrastructure layer that Tasks 2, 3, and 7 will consume.

## Files Created

1. **`backend/src/modules/reporting/__tests__/workforce-population.test.ts`**
   - 8 unit tests covering all SQL fragment exports
   - Tests verify the two-flag active-employee rule, case-insensitive employment_status matching, five AON buckets in correct order, In Training logic, GREATEST clamp against negative tenure, and support for exit date as reference point

2. **`backend/src/modules/reporting/workforce-population.ts`**
   - 140 lines of implementation
   - Exports: `ACTIVE_EMPLOYEE_SQL()`, `AON_REFERENCE_DATE_SQL()`, `IN_TRAINING_SQL()`, `AON_BUCKET_SQL()`, `AON_BUCKET_ORDER_SQL()`, `IN_TRAINING_LABEL`, `AON_BUCKETS`, `AonBucket` type
   - All constraints from Global Constraints enforced in SQL fragments

## TDD Verification Steps

### Step 1-2: Test Failure Verification
```bash
cd backend && npx vitest run src/modules/reporting/__tests__/workforce-population.test.ts
```
**Result:** FAIL — `Cannot find module '../workforce-population.js'` (expected)

### Step 3-4: Implementation & Test Pass
```bash
cd backend && npx vitest run src/modules/reporting/__tests__/workforce-population.test.ts
```
**Result:** PASS
```
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  22:18:51
   Duration  1.08s
```

All 8 tests passing:
- "requires BOTH flags for an active employee" ✓
- "lower-cases employment_status" ✓
- "never uses date_of_exit alone as the active test" ✓
- "has exactly five buckets, In Training first" ✓
- "treats joined-but-unpaid as In Training" ✓
- "puts In Training ahead of every tenure bucket" ✓
- "clamps negative tenure so a future joiner cannot land in 0-30 by accident" ✓
- "works for exits too, where asOf is the exit date" ✓

### Step 5: Live Database Validation

**Host Tested:** 122.184.128.90 (public address — LAN address 192.168.10.6 was unreachable)

**Query Results:**
```
┌─────────┬───────────────┬─────┐
│ (index) │ bucket        │ n   │
├─────────┼───────────────┼─────┤
│ 0       │ '90+'         │ 721 │
│ 1       │ '0-30'        │ 163 │
│ 2       │ '31-60'       │ 101 │
│ 3       │ '61-90'       │ 93  │
│ 4       │ 'In Training' │ 13  │
└─────────┴───────────────┴─────┘
total: 1091 (must be 1091, not 1121)
```

**Validation:** ✓ PASS
- Exactly 1,091 active employees (correct count, not 1,121)
- Five buckets returned in expected distribution
- "In Training" contains 13 employees (on floor but not yet on payroll)
- SQL syntax valid against MySQL 8.0.42 schema

### Step 6: TypeScript Typecheck

```bash
cd backend && npx tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler src/modules/reporting/workforce-population.ts 2>&1 | grep workforce-population
```

**Result:** ✓ PASS (no output = no errors)

The file type-checks cleanly with no errors.

### Step 7: Git Commit

```bash
git add backend/src/modules/reporting/workforce-population.ts backend/src/modules/reporting/__tests__/workforce-population.test.ts
git commit -m "feat(reporting): one shared definition of the workforce population"
```

**Result:** ✓ SUCCESS
```
[worktree-aon-analytics-correctness 985f5b0d] feat(reporting): one shared definition of the workforce population
 2 files changed, 140 insertions(+)
 create mode 100644 backend/src/modules/reporting/__tests__/workforce-population.test.ts
 create mode 100644 backend/src/modules/reporting/workforce-population.ts
```

**Commit SHA:** `985f5b0d`

## Key Implementation Details

### Active Employee Definition
Enforces **both** conditions (never just one):
- `active_status = 1` — flag cleared on exit
- `LOWER(COALESCE(employment_status, 'active')) = 'active'` — case-insensitive, defaults to 'active'

Deliberately excludes `date_of_exit IS NULL` to avoid false positives (28,426 inactive employees carry no exit date).

### AON Reference Date
Uses `COALESCE(salary_start_date, date_of_joining)` — payroll start date if different from join date, otherwise join date. 1,063 of 1,091 active employees have these equal.

### Tenure Buckets
Exactly five, in this order:
1. **In Training** — joined but salary_start_date is in the future (13 employees, on floor but not yet paid)
2. **0-30** — 0 to 30 days since reference date (163 employees)
3. **31-60** — 31 to 60 days (101 employees)
4. **61-90** — 61 to 90 days (93 employees)
5. **90+** — more than 90 days (721 employees)

### Negative Tenure Guard
All tenure DATEDIFF calculations wrapped in `GREATEST(..., 0)` to prevent future joiners from being counted in 0-30 bucket. Previous bug: a negative DATEDIFF satisfied `<= 30` and silently miscounted not-yet-paid employees.

### Exit Date Support
All functions accept optional `asOf` parameter. When called with `asOf = date_of_exit`, "In Training" means "left before payroll started" (quit during training), which is a real and useful category for exit analytics.

## Concerns

None. All constraints from the Global Constraints section are correctly enforced in the SQL fragments. The live database validation confirms the query is syntactically correct and returns the expected 1,091 employee count.

## Integration Notes for Tasks 2-7

This module exports pure SQL fragments (strings), not query builders, so callers retain full control over their joins and WHERE clauses. The exported interface is stable and complete:

- **Functions:** `ACTIVE_EMPLOYEE_SQL(alias)`, `AON_REFERENCE_DATE_SQL(alias)`, `IN_TRAINING_SQL(alias, asOf)`, `AON_BUCKET_SQL(alias, asOf)`, `AON_BUCKET_ORDER_SQL(alias, asOf)`
- **Constants:** `IN_TRAINING_LABEL = "In Training"`, `AON_BUCKETS = ["In Training", "0-30", "31-60", "61-90", "90+"]`
- **Type:** `AonBucket` (union of the five bucket names)

All names and signatures match the brief exactly and are ready for consumption by downstream tasks.

---

## Code Review Fixes — 2026-08-26

### Finding 1: Test Strengthened to Verify AND Relationship

**Problem:**  
The test "requires BOTH flags for an active employee" used token-presence assertions that would pass regardless of whether the implementation used AND or OR:
```typescript
expect(sql).toContain("e.active_status = 1");
expect(sql).toContain("employment_status");
```
This defeats the test's purpose (preventing a regression like the original 1,121 vs 1,091 count bug caused by using OR instead of AND).

**Fix Applied:**
Replaced with a relationship-verifying regex:
```typescript
expect(sql).toMatch(/e\.active_status\s*=\s*1\s+AND\s+LOWER\(/i);
```

**Verification Steps:**
1. Initial test run with tightened assertion — all 9 tests pass (implementation already uses AND)
2. Temporarily changed AND to OR in implementation to prove test has teeth
3. Test output when AND was changed to OR:
   ```
   FAIL  src/modules/reporting/__tests__/workforce-population.test.ts > workforce population definition > requires BOTH flags for an active employee
   AssertionError: expected 'e.active_status = 1 OR LOWER(COALESCE…' to match /e\.active_status\s*=\s*1\s+AND\s+LOWER\(/i
   ```
4. Restored AND — all 9 tests pass again

**Result:** ✓ Test now has teeth; regression guard is tight and cannot be bypassed.

### Finding 2: Exported AON_DAYS_SQL for Task 3 Reuse

**Problem:**  
The `AON_DAYS` helper was private:
```typescript
const AON_DAYS = (alias: string, asOf: string): string =>
  `GREATEST(DATEDIFF(${asOf}, ${AON_REFERENCE_DATE_SQL(alias)}), 0)`;
```
Task 3 (drill-down predicates) would need the same tenure-clamping logic and would hand-roll `GREATEST(DATEDIFF(...), 0)` again — reintroducing by duplication the exact bug this module centralizes (negative DATEDIFF values miscounting future joiners).

**Fix Applied:**

1. **Exported as `AON_DAYS_SQL`** with default parameters matching other contract exports:
   ```typescript
   export const AON_DAYS_SQL = (alias: string = A, asOf: string = "CURDATE()"): string =>
     `GREATEST(DATEDIFF(${asOf}, ${AON_REFERENCE_DATE_SQL(alias)}), 0)`;
   ```

2. **Added load-bearing doc comment:**
   ```
   * This is the only sanctioned way to compute tenure days. The clamp is load-bearing.
   * The previous bucket test was `DATEDIFF(...) <= 30 THEN '0-30'`, and a NEGATIVE DATEDIFF
   * satisfies `<= 30` — which is how employees whose reference date had not arrived were
   * silently counted as the newest joiners. Task 3 drill-down predicates depend on this
   * expression as the single source of truth.
   ```

3. **Updated internal uses** in `AON_BUCKET_SQL` and `AON_BUCKET_ORDER_SQL` to call the exported function:
   ```typescript
   // Before: direct call to private AON_DAYS(alias, asOf)
   // After: AON_DAYS_SQL(alias, asOf)
   ```
   This ensures there is exactly one definition of the clamp; any change to the clamping logic will propagate everywhere.

4. **Added test for AON_DAYS_SQL:**
   ```typescript
   it("clamps negative tenure in AON_DAYS_SQL so future joiners cannot be counted as newest", () => {
     const sql = AON_DAYS_SQL("e", "CURDATE()");
     expect(sql).toContain("GREATEST(");
     expect(sql).toMatch(/COALESCE\(e\.salary_start_date/);
   });
   ```

**Verification Steps:**
```bash
cd backend && npx vitest run src/modules/reporting/__tests__/workforce-population.test.ts
```
**Result:** ✓ All 9 tests pass (added 1 new test)
```
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  22:25:52
   Duration  1.22s
```

**TypeCheck:** ✓ Both files pass with `npx tsc --noEmit --skipLibCheck`

**Result:** ✓ Single source of truth established. Task 3 can now import and reuse AON_DAYS_SQL instead of hand-rolling the clamp.

### Final Commit

```bash
git add backend/src/modules/reporting/workforce-population.ts backend/src/modules/reporting/__tests__/workforce-population.test.ts
git commit -m "Fix: tighten AND assertion and export AON_DAYS_SQL"
```

**Commit SHA:** `d5485720`

All changes are staged, committed, and tested.
