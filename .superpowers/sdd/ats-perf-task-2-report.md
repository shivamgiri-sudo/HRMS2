# Task 2 Report: Fix webData() — SQL Date Filter + 5000-row cap

## Status
COMPLETE

## Commit Hash
`e246d1f7`

## TypeScript Result
`npx tsc --noEmit` — 0 errors, 0 warnings.

## Changes Applied

### Change 1: `candidateSelect()` — limit parameter + LIMIT clause + ORDER BY fix
- Added `limit = 5000` default parameter
- Added `LIMIT ?` to the SQL query
- Pass `[...params, limit]` so limit is the final bound parameter
- ORDER BY changed from `COALESCE(c.created_date, DATE(c.created_at))` to `COALESCE(c.created_date, c.created_at)` — removes the `DATE()` wrapper so the index added in Task 1 (`idx_ats_candidate_created_date`) is usable

### Change 2: Period-based SQL date push in `webData()`
Inserted a block after the `if (filters.toDate)` guard and before `if (filters.branch)`:
- When no explicit `fromDate`/`toDate` is provided:
  - `FTD`: pushes `created_date = today OR (created_date IS NULL AND DATE(created_at) = today)`
  - `WTD`: pushes `created_date >= weekStart OR (created_date IS NULL AND DATE(created_at) >= weekStart)`
  - `MTD`: pushes `created_date >= monthStart OR (created_date IS NULL AND DATE(created_at) >= monthStart)`
  - `ALL`: no date filter added — 5000-row cap from Change 1 still applies

The existing `allRows.filter((r) => inPeriod(r, period))` JS safety filter is preserved unchanged.

## File Modified
`backend/src/modules/ats-full-parity/atsFullParity.service.ts`

## Concerns / Notes

1. **`dashboardRows` FTD/WTD/MTD aggregation uses `allRows`** — the dashboard summary rows (lines 497–516) call `allRows.filter((r) => inPeriod(r, p))` for all three periods. When `period === "ALL"` is requested, `allRows` is capped at 5000 rows (no SQL date filter applied). If the dataset exceeds 5000 active candidates, the FTD/WTD/MTD dashboard counts derived from `allRows` will be truncated. For the typical ATS Command Center use-case (FTD/WTD/MTD period requests), this is not an issue because SQL date bounds are pushed in and the cap is irrelevant for those volumes. For `period === "ALL"` with very large datasets this remains a limitation — addressed in later tasks if needed.

2. **ORDER BY COALESCE mix of DATE vs DATETIME** — `created_date` is a DATE column and `created_at` is a DATETIME. The COALESCE without `DATE()` wrapper means when `created_date` is NULL the sort falls back to the full DATETIME value of `created_at`, which is correct for ordering purposes and consistent with the index structure.

3. **No other callers of `candidateSelect()` exist** in the file (confirmed by grep), so the new `limit` parameter does not affect any other code paths.
