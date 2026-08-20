# Task 8 Report — RosterPivotGrid (grid mode) and shift-template picker

## Status
DONE

Picked up in a later session; Tasks 1-7 were already committed and reviewed, task-8-brief.md
existed with no implementation.

## Files

- Created: `src/components/wfm/RosterPivotGrid.tsx`
- Created: `src/components/wfm/__tests__/RosterPivotGrid.test.tsx`
- Modified: `src/pages/wfm/RosterBuilderPage.tsx` (placeholder replaced by the grid)

## Deviations from the brief — all three deliberate, each verified

**1. `hrmsApi` instead of raw `fetch`.** The brief's component calls
`fetch("/api/wfm/roster-builder/grid?...")` directly. Both roster-builder routes sit behind
`requireAuth` + `requireRole` (`backend/src/modules/wfm/roster-builder.routes.ts:10,17,42`),
and a bare browser `fetch` sends no `Authorization` header and no `credentials: "include"`
(`src/lib/hrmsApi.ts:139-152` is what supplies both, plus the silent 401 refresh-and-retry).
Shipped as written, every grid load and every cell write would have 401'd in the browser. No
other page in this codebase calls `fetch` for an `/api` path.

**2. A real shift-template picker instead of the brief's `window.prompt` placeholder.** The
brief deferred the picker explicitly, and gave one reason: the `shiftTemplateId` vs `shift_id`
question flagged in Task 6 Step 3. Task 6 closed that question
(`roster-builder.routes.ts:31-40` — writes go to `wfm_shift_template.id`, verified against the
live DB: 23 UUID-keyed template rows vs 3 string-keyed `wfm_shift_master` rows, zero overlap),
so the stated blocker no longer exists. Options come from the EXISTING, unmodified
`GET /api/roster-gov/shifts/templates?process_id=`
(`backend/src/modules/roster/roster.governance.routes.ts:64`), which returns
`{ data: ShiftTemplate[] }` ordered `shift_code ASC, version DESC`. Two consequences handled:

- That endpoint 403s a non-admin/hr caller without `process_id`
  (roster.governance.routes.ts:68-71), so `processId` is a required prop, passed down from the
  page's existing process picker.
- The ordering means several versions of one `shift_code` come back together; `activeTemplates`
  keeps the newest active row per code, so the picker doesn't offer three "Morning"s.

**3. A real pivot.** The brief rendered each employee's cells in response row order, so two
employees with different date coverage would have rendered misaligned — employee B's Tuesday
sitting under employee A's Monday. Columns here are the sorted union of all dates in the
response and each employee's cells are looked up by date; a missing date renders an explicit
empty cell. Also normalises the date (`toIsoDate`) because the grid endpoint stringifies
whatever mysql2 returns for a DATE column, which can carry a time part and would otherwise
split one calendar day into two columns.

Smaller, non-brief additions: an error state for a failed grid load, an error banner for a
failed write (the assign route can legitimately 409 `ROSTER_DATE_LOCKED` or 422
`INSUFFICIENT_REST`, and a silently swallowed failure would leave a stale cell looking saved),
a warning + disabled pickers when the process has no active templates, and a same-value guard
so re-selecting the current shift doesn't POST.

## Verification

```
$ npx vitest run src/components/wfm/__tests__/RosterPivotGrid.test.tsx
 Test Files  1 failed (1)        <- before the page wiring
      Tests  3 failed | 14 passed (17)

$ npx vitest run src/components/wfm/__tests__/RosterPivotGrid.test.tsx
 Test Files  1 passed (1)        <- after
      Tests  17 passed (17)
```

The first run's three failures were real: two page-wiring assertions (grid not yet mounted) and
one self-inflicted test bug — the "no `window.prompt`" assertion matched the component's own
header comment, which documents why the placeholder was dropped. Narrowed to strip comments
before searching, the same class of bug the Task 7 report records against its own test.

Typecheck (`npx tsc --noEmit -p tsconfig.app.json`): 5 errors, all pre-existing and in files
this task does not touch — `GrnSearchWorkspace.tsx`, `useCostCentres.ts`, and three in
`RosterImportPage.tsx`. None in `RosterPivotGrid.tsx` or `RosterBuilderPage.tsx`.

## Concern for the final review — not introduced here, but load-bearing on this page

`POST /api/wfm/roster-builder/assign` (Task 6) does not pass `shiftStartTime`/`shiftEndTime`
to `assignEmployee`, and `roster.service.ts:204` only runs minimum-rest validation
`if (input.shiftStartTime && input.shiftEndTime && ...)`. Every write from this grid therefore
skips the rest guard that the four other roster-write engines share, even though the template
the picker just selected has both times on it. The fix belongs in the route (look the template's
times up server-side — a client-supplied time cannot be trusted for a safety check), not in this
component. Flagged, not silently worked around.
