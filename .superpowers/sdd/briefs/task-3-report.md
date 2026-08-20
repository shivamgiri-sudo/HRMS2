# Task 3 Report — NEEDS_CONTEXT

## Status: NEEDS_CONTEXT (stopped before Step 1, per brief's own escape hatch)

## What I did
1. Read the brief in full: `.superpowers/sdd/briefs/task-3-brief.md`.
2. Read `backend/src/modules/wfm/roster.service.ts` in full (432 lines).
3. Verified the **production-code** assumptions in the brief against the real file:
   - `AssignInput` interface: lines 20-35 — **exact match** to what the brief shows (before the addition).
   - The `insertCols`/`placeholders`/`params`/`updateClauses` block with the `hasShiftVersionId`/`hasScheduledMinutes` conditional-push pattern: lines 253-292 — **exact match**. Step 3 and Step 4's proposed edits apply cleanly and unambiguously at the stated insertion point (immediately after the `hasScheduledMinutes` block, before `await conn.execute(\`INSERT INTO wfm_roster_assignment ...\`)`).
4. Before writing the Step 1 test file verbatim, cross-checked its mocking assumptions against:
   - `backend/src/modules/wfm/rest-policy.service.ts` (grep of all exports)
   - `backend/src/modules/wfm/shift-scheduling.util.ts` (`rosterAssignmentColumns` implementation)
   - The existing regression-guard test `backend/src/modules/wfm/__tests__/roster-service-audit-log.test.ts`, which exercises the exact same `assignEmployee` code path successfully today, to see the *working* mock pattern.

## Two concrete bugs found in the brief's Step 1 test content

**Bug 1 — wrong module path for `withEmployeeRosterLock`.**
`roster.service.ts` imports it from `./rest-policy.service.js` (line 6):
```ts
import { applyRestDecision, isRestPolicyFeatureActive, validateMinimumRest, logRestOverride, withEmployeeRosterLock } from "./rest-policy.service.js";
```
There is no `backend/src/modules/wfm/roster-concurrency.util.ts` file at all (confirmed via `ls` — does not exist). The brief's test mocks `"../roster-concurrency.util.js"` to supply `withEmployeeRosterLock`, and separately mocks `"../rest-policy.service.js"` with **only** `isRestPolicyFeatureActive`. Since `roster.service.ts` actually pulls `withEmployeeRosterLock`, `applyRestDecision`, `validateMinimumRest`, and `logRestOverride` all from `rest-policy.service.js`, that mock factory would leave `withEmployeeRosterLock` `undefined` inside `roster.service.ts`, and the call `return withEmployeeRosterLock(input.employeeId, async (conn) => {...})` would throw `TypeError: withEmployeeRosterLock is not a function` — not the "cycleId not recognized" failure the brief's Step 2 expects.

The working pattern (confirmed live in `roster-service-audit-log.test.ts` lines 17-25) mocks `"../rest-policy.service.js"` directly with `withEmployeeRosterLock` included in that same factory:
```ts
const { withEmployeeRosterLock } = vi.hoisted(() => ({
  withEmployeeRosterLock: vi.fn((_employeeId, fn) => fn({ execute })),
}));
vi.mock("../rest-policy.service.js", () => ({
  isRestPolicyFeatureActive: vi.fn().mockResolvedValue(false),
  validateMinimumRest: vi.fn(),
  logRestOverride: vi.fn().mockResolvedValue(undefined),
  withEmployeeRosterLock,
}));
```

**Bug 2 — `rosterAssignmentColumns()` result is module-level cached across both `it()` blocks, with no reset.**
`shift-scheduling.util.ts` caches its probe result in a module-scope variable (`rosterAssignmentColumnsCache`), populated once and reused thereafter — including across separate `it()` blocks in the same test file/process, since ES module state persists. There is a `__resetSchemaCachesForTests()` export specifically for this ("Test-only: clears both module-scope caches so a test file can simulate a different schema state ... across cases"), but the brief's Step 1 test never calls it.

Consequence: in the **first** `it()` ("writes cycle_id when provided"), the `beforeEach`'s first `executeMock.mockResolvedValueOnce(...)` is correctly consumed by the real `rosterAssignmentColumns()` probe query, and the cache gets populated. In the **second** `it()` ("omits cycle_id..."), the probe is now served from cache and never calls `conn.execute` at all — so the `beforeEach`'s first `mockResolvedValueOnce` (meant for the probe) is instead consumed by the actual INSERT call, and the second `mockResolvedValueOnce` (meant for the INSERT) is consumed by the SELECT-back call. This desyncs the mock queue and would make the second test's assertion (`insertCall![0]` not containing `"cycle_id"`) check the wrong `execute()` call/args — it may pass or fail for reasons unrelated to the `cycleId` logic being tested, and would definitely break for other assertions in a less lucky ordering.

## Why I stopped here
The brief explicitly says: "write the failing test file with the exact content shown" and separately: "If anything is ambiguous — including if the actual current state of `roster.service.ts` doesn't match what the brief assumes — STOP and report NEEDS_CONTEXT or BLOCKED with specifics rather than guessing or improvising a different insertion point." While the *production-code* insertion point is unambiguous and verified correct, the *test file's own content* — which the brief also specifies verbatim — will not behave as described (fail for the stated reason, then pass cleanly after the fix) due to the two bugs above. Silently rewriting the test to fix these (swap the mock module/shape, add `__resetSchemaCachesForTests()` calls) would be improvising rather than following the brief exactly, on the most sensitive task in the plan, so I stopped rather than guess.

## Proposed fix (not yet applied — awaiting confirmation)
Rewrite only the mocking section of the Step 1 test file to match the pattern already proven correct in `roster-service-audit-log.test.ts`:
- Drop the `vi.mock("../roster-concurrency.util.js", ...)` block entirely (no such module).
- Fold `withEmployeeRosterLock` into the `vi.mock("../rest-policy.service.js", ...)` factory alongside `isRestPolicyFeatureActive` (and stub `validateMinimumRest`/`applyRestDecision`/`logRestOverride` as no-ops, matching what the real module exports that `roster.service.ts` imports).
- Add `import { __resetSchemaCachesForTests } from "../shift-scheduling.util.js";` and call it in `beforeEach` before setting up the `rosterAssignmentColumns` probe mock, so both `it()` blocks get a fresh probe.
- Everything else in the brief's test (the two `it()` bodies, the assertions, the `cycleId` field itself) is unchanged.

No production code was modified. No test file was written. No commit was made.

## Files inspected (unmodified)
- `backend/src/modules/wfm/roster.service.ts` (read in full)
- `backend/src/modules/wfm/rest-policy.service.ts` (exports grepped)
- `backend/src/modules/wfm/shift-scheduling.util.ts` (`rosterAssignmentColumns` + `__resetSchemaCachesForTests` read)
- `backend/src/modules/wfm/__tests__/roster-service-audit-log.test.ts` (read, used as reference for correct mock pattern)

---

# Retry (2026-08-20) — DONE

Re-attempted this task after the parent agent explicitly instructed: apply the production-code changes (Steps 3-4) exactly as originally verified correct, and fix the two confirmed bugs in the brief's Step 1 test rather than stopping again.

## What was corrected in the test file

Wrote `backend/src/modules/wfm/__tests__/roster-service-assign-cycle-id.test.ts` with the brief's exact `it()` bodies/assertions unchanged, but with the mocking section rewritten:

1. **`withEmployeeRosterLock` source.** Dropped the brief's `vi.mock("../roster-concurrency.util.js", ...)` (no such file exists). Folded `withEmployeeRosterLock` into the same `vi.mock("../rest-policy.service.js", ...)` factory as `isRestPolicyFeatureActive`, matching `roster.service.ts:6`'s real import and the working pattern already proven in `roster-service-audit-log.test.ts`.

2. **`checkEmployeeDateNotLocked` path.** The brief's draft mock also used the wrong relative path (`../roster-lock-guard.js`, which from the test's `__tests__/` directory would resolve to a nonexistent `backend/src/modules/wfm/roster-lock-guard.js`). The real file is `backend/src/modules/roster/roster-lock-guard.ts` (confirmed via `find`), imported by `roster.service.ts` as `../roster/roster-lock-guard.js`. From the test file (`backend/src/modules/wfm/__tests__/`), the equivalent path is `../../roster/roster-lock-guard.js`. This was not one of the two bugs originally flagged — it surfaced only once the withEmployeeRosterLock fix let the test actually reach that call. Fixed to `vi.mock("../../roster/roster-lock-guard.js", ...)`.

3. **Schema-cache reset.** Added `import { __resetSchemaCachesForTests } from "../shift-scheduling.util.js";` and called it in `beforeEach`, before the `executeMock.mockResolvedValueOnce(...)` probe setup, as specified.

4. **Hoisting bug (found during this retry, not previously flagged).** The brief's test declares `executeMock`/`getConnectionMock` as plain `const`, then references them inside `vi.mock(...)` factories. `vi.mock` calls are hoisted by Vitest above all other top-level statements in the file, so referencing a plain `const` from inside a factory throws `ReferenceError: Cannot access 'executeMock' before initialization` at collection time (confirmed by running the test — first run failed with exactly this error, 0 tests collected). Fixed by wrapping both in `vi.hoisted(() => ({...}))`, the same pattern `roster-service-audit-log.test.ts` already uses for its own mocks.

Everything else — the two `it()` blocks, their assertions, the `cycleId` field values, the `beforeEach` `executeMock.mockResolvedValueOnce` sequence for probe/INSERT/SELECT-back — is unchanged from the brief.

## Commands run and real output

**1. First run, before any fix (post writing file verbatim from brief plus the two originally-flagged mock corrections, but before finding the hoisting/path bugs):**
```
cd backend && npx vitest run src/modules/wfm/__tests__/roster-service-assign-cycle-id.test.ts
```
Result: `Error: [vitest] There was an error when mocking a module. ... Cannot access 'executeMock' before initialization` — 0 tests collected. Fixed via `vi.hoisted`.

**2. Second run, after `vi.hoisted` fix, still before production code change:**
```
cd backend && npx vitest run src/modules/wfm/__tests__/roster-service-assign-cycle-id.test.ts
```
Result:
```
Test Files  1 failed (1)
     Tests  1 failed | 1 passed (2)
```
- `"writes cycle_id when provided"` — **FAILED** as expected: `AssertionError: expected 'INSERT INTO wfm_roster_assignment...' to contain 'cycle_id'` — the real INSERT SQL had no `cycle_id` column yet.
- `"omits cycle_id entirely when not provided"` — passed trivially (cycle_id was never emitted pre-fix either).

This confirms the test fails for the correct reason: `cycleId` not yet threaded into the INSERT — not a mocking/import error.

**3. Applied production-code changes** (Steps 3-4 of the brief, unchanged from the original, already-verified-correct plan):
- Added `cycleId?: string | null;` to `AssignInput` in `backend/src/modules/wfm/roster.service.ts` (with the brief's doc comment), immediately after `planId`.
- Added the conditional `cycle_id` INSERT/UPDATE-clause block in `assignEmployee`, immediately after the existing `hasScheduledMinutes` block and before `await conn.execute(\`INSERT INTO wfm_roster_assignment ...\`)`, exactly matching the existing `hasShiftVersionId`/`hasScheduledMinutes` conditional-push pattern.

**4. Third run, after production code change:**
```
cd backend && npx vitest run src/modules/wfm/__tests__/roster-service-assign-cycle-id.test.ts src/modules/wfm/__tests__/roster-service-audit-log.test.ts
```
Result:
```
Test Files  2 passed (2)
     Tests  4 passed (4)
```
Both new `cycleId` tests pass, and both existing `roster-service-audit-log.test.ts` tests (the regression guard for existing callers) pass unchanged — zero behavior change for callers that omit `cycleId`.

## Deviations from the brief

- The two mocking bugs originally identified (wrong `withEmployeeRosterLock` module, uncached-schema desync) were fixed exactly as proposed in the first attempt's "Proposed fix" section.
- Two additional, smaller bugs in the brief's own draft test surfaced only while actually running it, and were fixed the same way (matching the existing, proven `roster-service-audit-log.test.ts` pattern) rather than reported and stopped on again, per this retry's explicit instruction:
  - Wrong relative import path for `checkEmployeeDateNotLocked`'s mock (`../roster-lock-guard.js` → `../../roster/roster-lock-guard.js`).
  - Missing `vi.hoisted()` wrapping for `executeMock`/`getConnectionMock`, which are referenced inside hoisted `vi.mock` factories.
- No production-code deviation: `AssignInput` and the INSERT block match Steps 3-4 of the brief verbatim.
- `roster.controller.ts` and `assignSchema` were not touched, per the out-of-scope constraint.

## Commit

```
git add backend/src/modules/wfm/roster.service.ts backend/src/modules/wfm/__tests__/roster-service-assign-cycle-id.test.ts .superpowers/sdd/briefs/task-3-report.md
git commit -m "feat(wfm): add additive cycleId param to assignEmployee (roster builder prep)"
```
(SHA recorded by the parent session after commit.)
