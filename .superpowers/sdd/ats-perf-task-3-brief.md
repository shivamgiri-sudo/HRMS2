# Task 3: Parallelize getDashboardMetrics() + Fix Timeline Subqueries

## Context
Task 3 of 5. Tasks 1-2 complete.

Two functions in `backend/src/modules/ats/command-centre.service.ts` are slow:
1. `getDashboardMetrics()` — 7 sequential `await db.execute()` calls that could run in parallel
2. `getTimelineData()` — 4 subqueries scan full history with no date range filter

## File to modify: `backend/src/modules/ats/command-centre.service.ts`

## Change 1: Parallelize `getDashboardMetrics()`

The current function (lines 66-132) runs 7 queries one after another. Replace with `Promise.all`.

**Current pattern (do NOT keep):**
```typescript
const [totalRes] = await db.execute<RowDataPacket[]>('SELECT COUNT(*) as total FROM ats_candidate WHERE active_status = 1');
const [activeRes] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) as active FROM ats_candidate WHERE active_status = 1 AND current_stage NOT IN (...)`);
// ... 5 more sequential awaits
```

**New pattern (write this):**
```typescript
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [
    [totalRes],
    [activeRes],
    [selectedRes],
    [rejectedRes],
    [todayRes],
    [pendingRes],
    [joinedRes],
  ] = await Promise.all([
    db.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM ats_candidate WHERE active_status = 1'
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as active FROM ats_candidate
       WHERE active_status = 1
       AND current_stage NOT IN ('rejected', 'joined', 'rejected_by_branch_head')`
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as selected FROM ats_candidate
       WHERE current_stage IN ('selected', 'bgv_pending', 'bgv_verified', 'payroll_validated', 'offer_pending', 'offer_accepted')`
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as rejected FROM ats_candidate
       WHERE current_stage IN ('rejected', 'rejected_by_branch_head')`
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as today_interviews FROM ats_interview_result
       WHERE DATE(interviewed_at) = CURDATE()`
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as pending FROM ats_payroll_hr_validation
       WHERE validation_status NOT IN ('approved', 'rejected')
       AND candidate_id IN (
         SELECT id FROM ats_candidate WHERE current_stage = 'payroll_validated'
       )`
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT sl.candidate_id) as joined
       FROM ats_candidate_stage_log sl
       WHERE sl.to_stage = 'joined'
         AND MONTH(sl.stage_date) = MONTH(CURRENT_DATE())
         AND YEAR(sl.stage_date) = YEAR(CURRENT_DATE())`
    ),
  ]);

  const totalCandidates = totalRes[0]?.total || 0;
  const selectedCandidates = selectedRes[0]?.selected || 0;
  const conversionRate = totalCandidates > 0
    ? (selectedCandidates / totalCandidates) * 100
    : 0;

  return {
    total_candidates: totalCandidates,
    active_candidates: activeRes[0]?.active || 0,
    selected_candidates: selectedCandidates,
    rejected_candidates: rejectedRes[0]?.rejected || 0,
    total_interviews_today: todayRes[0]?.today_interviews || 0,
    pending_approvals: pendingRes[0]?.pending || 0,
    employees_joined_this_month: joinedRes[0]?.joined || 0,
    conversion_rate: parseFloat(conversionRate.toFixed(2)),
  };
}
```

The return shape `DashboardMetrics` is IDENTICAL to before — same field names, same values, just computed in parallel.

## Change 2: Fix `getTimelineData()` — Add date range to subqueries

The 4 LEFT JOIN subqueries (`reg`, `int`, `sel`, `rej`) currently scan full table history.
Add a date range WHERE to each one using the `safeDays` parameter.

**Current `reg` subquery (NO WHERE):**
```sql
LEFT JOIN (
  SELECT DATE(created_at) as date, COUNT(*) as registrations
  FROM ats_candidate
  GROUP BY DATE(created_at)
) reg ON date_series.date = reg.date
```

**New `reg` subquery (WITH date range):**
```sql
LEFT JOIN (
  SELECT DATE(created_at) as date, COUNT(*) as registrations
  FROM ats_candidate
  WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
  GROUP BY DATE(created_at)
) reg ON date_series.date = reg.date
```

Apply the same `WHERE col >= DATE_SUB(CURDATE(), INTERVAL ? DAY)` to all 4 subqueries:
- `reg`: `WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`
- `int`: `WHERE interviewed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`
- `sel`: `WHERE interview_status = 'selected' AND interviewed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`
- `rej`: `WHERE interview_status = 'rejected' AND interviewed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`

Because you're adding a `?` placeholder to each of the 4 subqueries, the params array needs `safeDays` passed 4 additional times. The current call is `db.execute(..., [safeDays])` — change to `db.execute(..., [safeDays, safeDays, safeDays, safeDays, safeDays])` (5 total: 1 for the outer `WHERE seq.seq < ?` + 4 for the subqueries).

## Global Constraints
- Return type `DashboardMetrics` must be UNCHANGED — same field names, same types
- `getTimelineData` return type `TimelineData[]` must be UNCHANGED
- No other functions in the file should be modified
- TypeScript: 0 errors after changes

## Steps
1. Replace `getDashboardMetrics()` body with the `Promise.all` version above
2. Add date range WHERE to all 4 subqueries in `getTimelineData()`, update params array to pass `safeDays` 4 extra times
3. Run `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit` — 0 errors
4. Commit: `git add backend/src/modules/ats/command-centre.service.ts && git commit -m "perf(ats): parallelize 7 sequential metric queries + date-bound timeline subqueries"`

## Report file
`c:\Users\ADMIN\Desktop\HRMS2-latest\.superpowers\sdd\ats-perf-task-3-report.md`

Return: status, commit hash, TypeScript result, concerns.
