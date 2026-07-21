# Task 4 Report: Fix O(N²) position_in_queue Correlated Subquery

## Status
COMPLETE

## Commit Hash
2c0289ab

## TypeScript Result
0 errors (`npx tsc --noEmit` — clean)

## Changes Applied

**File:** `backend/src/modules/ats/queue.enhanced.service.ts`

### getLiveQueue() (lines 128-134 old)
- Removed 6-line correlated subquery that fired once per row scanning `ats_queue_token`
- Replaced with `0 as position_in_queue` in SQL
- Added JS post-processing: `rows.map((row, index) => ({ ...row, position_in_queue: index + 1 }))`
- Return type remains `QueueEntry[]` — shape unchanged

### getRecruiterQueue() (lines ~355-362 old)
- Removed 7-line correlated subquery with per-recruiter filter that fired once per row
- Replaced with `0 as position_in_queue` in SQL
- Added same JS post-processing: `rows.map((row, index) => ({ ...row, position_in_queue: index + 1 }))`
- Return type remains `QueueEntry[]` — shape unchanged

### getOpsRoundQueue() (line 243)
- Left untouched — already uses `1 as position_in_queue` (literal, not a subquery)

## Performance Impact
- Old: O(N²) — N rows × full table scan per row via correlated subquery
- New: O(N) — single query fetch + single JS array pass
- With 100 candidates in queue: ~100 subquery executions eliminated per call
- Both functions affected; getLiveQueue is called on every live dashboard poll

## Behavioural Difference (Intentional)
The old subquery counted only rows with `queue_status IN ('waiting', 'called')` ahead of each entry. The new JS ranking uses array index in arrival-time order across all active statuses returned by the WHERE clause. For most real queues (all entries in 'waiting'/'called'/'in_interview') the numbers will match. The brief acknowledges this as intentional and more correct.

## Concerns
None. The fix is strictly additive/replacement — no interface changes, no DB schema changes, no other functions touched. The `QueueEntry` interface already declared `position_in_queue: number` so TypeScript validation passes cleanly.
