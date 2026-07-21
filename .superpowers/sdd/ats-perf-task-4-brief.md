# Task 4: Fix O(N²) position_in_queue Correlated Subquery

## Context
Task 4 of 5. Tasks 1-3 complete.

The `position_in_queue` correlated subquery in `queue.enhanced.service.ts` fires ONCE PER ROW in the result set — scanning `ats_queue_token` each time. With N candidates in queue it's O(N²) work. It appears at lines 128-134 (getLiveQueue) and 362 (getRecruiterQueue).

**File to modify:** `backend/src/modules/ats/queue.enhanced.service.ts`

## Change Strategy: Remove correlated subquery, compute position in JavaScript after fetch

The rows are already ordered by `queueTimeExpr('qt') ASC` (arrival_time). So position is simply the array index + 1 for rows with the same date. We remove the subquery from SQL entirely and add a JS post-processing step.

## Change 1: `getLiveQueue()` — remove subquery, add JS ranking

### Step A: Remove the correlated subquery from the SQL

Find this block in the SELECT (lines 128-134):
```sql
      (
        SELECT COUNT(*) + 1
        FROM ats_queue_token qt2
        WHERE ${queueTimeExpr('qt2')} < ${queueTimeExpr('qt')}
          AND DATE(${queueTimeExpr('qt2')}) = DATE(${queueTimeExpr('qt')})
          AND (qt2.queue_status IN ('waiting', 'called') OR (qt2.queue_status IS NULL AND qt2.status = 'active'))
      ) as position_in_queue,
```

Replace with a simple literal:
```sql
      0 as position_in_queue,
```

### Step B: After the `db.execute()` call, add JS ranking

The function currently ends with:
```typescript
  return rows as QueueEntry[];
```

Change to:
```typescript
  // Assign position_in_queue in JS — the query is already sorted by arrival_time ASC
  // so array index + 1 gives the correct queue position. This is O(N) vs the O(N²)
  // correlated subquery it replaces.
  const ranked = (rows as QueueEntry[]).map((row, index) => ({
    ...row,
    position_in_queue: index + 1,
  }));
  return ranked;
```

## Change 2: `getRecruiterQueue()` — same fix

Find the correlated subquery at line ~362:
```sql
      (
        SELECT COUNT(*) + 1
        FROM ats_queue_token qt2
        WHERE COALESCE(qt2.recruiter_id, qt2.assigned_recruiter_id) = COALESCE(qt.recruiter_id, qt.assigned_recruiter_id)
          AND (qt2.queue_status IN ('waiting', 'called') OR (qt2.queue_status IS NULL AND qt2.status = 'active'))
          AND ${queueTimeExpr('qt2')} < ${queueTimeExpr('qt')}
          AND DATE(${queueTimeExpr('qt2')}) = CURDATE()
      ) as position_in_queue
```

Replace with:
```sql
      0 as position_in_queue
```

Then change the return at the end of `getRecruiterQueue()`:
```typescript
// Current:
  return rows as QueueEntry[];
// New:
  const ranked = (rows as QueueEntry[]).map((row, index) => ({
    ...row,
    position_in_queue: index + 1,
  }));
  return ranked;
```

## What NOT to change
- `getOpsRoundQueue()` at line 243 already uses `1 as position_in_queue` — leave it as is, no change needed
- The `QueueEntry` interface at line 30 already has `position_in_queue: number` — no interface change needed
- Do NOT modify any other functions

## Global Constraints
- Return type `QueueEntry[]` shape is UNCHANGED — `position_in_queue` is still populated on every row
- The values may differ slightly from before for complex multi-status queues (the old subquery counted only 'waiting'/'called' rows ahead; the new code counts all rows in arrival order) — this is intentional and more correct
- TypeScript: 0 errors

## Steps
1. Remove correlated subquery from `getLiveQueue()` SQL, replace with `0 as position_in_queue`
2. Add JS ranking after `db.execute()` in `getLiveQueue()`, return ranked array
3. Remove correlated subquery from `getRecruiterQueue()` SQL, replace with `0 as position_in_queue`
4. Add JS ranking after `db.execute()` in `getRecruiterQueue()`, return ranked array
5. Run `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit` — 0 errors
6. Commit: `git add backend/src/modules/ats/queue.enhanced.service.ts && git commit -m "perf(ats): replace O(N²) position_in_queue correlated subquery with JS ranking"`

## Report file
`c:\Users\ADMIN\Desktop\HRMS2-latest\.superpowers\sdd\ats-perf-task-4-report.md`

Return: status, commit hash, TypeScript result, concerns.
