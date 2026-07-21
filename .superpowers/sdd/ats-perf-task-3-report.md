# Task 3 Report: Parallelize getDashboardMetrics() + Fix Timeline Subqueries

## Status
COMPLETE

## Commit Hash
`9e4ab18c`

## TypeScript Result
`npx tsc --noEmit` — 0 errors, 0 warnings

## Changes Made

### Change 1: getDashboardMetrics() — 7 sequential awaits → Promise.all
File: `backend/src/modules/ats/command-centre.service.ts` (lines 66–131)

Replaced 7 independent sequential `await db.execute()` calls with a single
`await Promise.all([...])` that fires all 7 queries concurrently. The destructuring
pattern `const [[totalRes], [activeRes], ...]` preserves the exact same local
variable names as before. Return shape `DashboardMetrics` is identical — same
field names, same types, same computed `conversion_rate`.

Expected wall-clock gain: ~6x (7 queries at ~N ms each → ~1 round-trip worth N ms).

### Change 2: getTimelineData() — date-bound subqueries
All 4 LEFT JOIN subqueries (`reg`, `int`, `sel`, `rej`) previously scanned the
full table history on every call. Each now has a `WHERE col >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`
predicate so the engine only touches rows within the requested window.

Params array updated from `[safeDays]` (1 placeholder) to
`[safeDays, safeDays, safeDays, safeDays, safeDays]` (5 placeholders: 1 outer
`seq.seq < ?` + 4 subquery WHERE clauses). Return type `TimelineData[]` unchanged.

## Concerns
None. Both changes are pure performance optimisations with no behaviour change:
- `Promise.all` on independent read queries is safe; any single query failure
  rejects the whole promise, which is the correct fail-fast behaviour.
- The subquery date filters are additive constraints that cannot return rows
  outside the date_series window (those would have been COALESCE'd to 0 anyway),
  so output values are identical to the old version for any in-window date.
- No interfaces, no other functions, no route handlers were touched.
