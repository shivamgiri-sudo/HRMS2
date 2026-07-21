# Task 2: Fix webData() — SQL Date Filter + 5000-row cap

## Context
Task 2 of 5. Task 1 is complete (performance indexes added).

The ATS Command Center times out because `webData()` in `atsFullParityService` calls `candidateSelect()` with no LIMIT and no SQL date filter — it fetches ALL active candidates, then filters by period in JavaScript. This is the primary timeout cause.

**File to modify:** `backend/src/modules/ats-full-parity/atsFullParity.service.ts`

## Exact current code (DO NOT change anything else)

### `candidateSelect` (lines 454-463):
```typescript
async function candidateSelect(where = "1=1", params: unknown[] = []): Promise<CandidateRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.*,
            COALESCE(c.candidate_code, c.id) AS candidate_id
       FROM ats_candidate c
      WHERE ${where}
      ORDER BY COALESCE(c.created_date, DATE(c.created_at)) DESC, c.created_at DESC`,
    params
  );
  return rows.map(enrichCandidate);
}
```

### `webData()` WHERE clause assembly (lines 467-491):
```typescript
async webData(filters: { fromDate?: string; toDate?: string; branch?: string; process?: string; recruiter?: string; period?: Period; actorId?: string; bypassScope?: boolean } = {}) {
    const conds = ["c.active_status = 1"];
    const params: unknown[] = [];
    if (filters.fromDate) { conds.push("COALESCE(c.created_date, DATE(c.created_at)) >= ?"); params.push(filters.fromDate); }
    if (filters.toDate) { conds.push("COALESCE(c.created_date, DATE(c.created_at)) <= ?"); params.push(filters.toDate); }
    // ... (branch, process, recruiter, scope conditions) ...
    const allRows = await candidateSelect(conds.join(" AND "), params);
    const period = filters.period || "ALL";
    const candidateRows = allRows.filter((r) => inPeriod(r, period));
```

## Changes to make

### Change 1: Add `limit` parameter to `candidateSelect()`

Change the function signature and query to add a LIMIT:

```typescript
async function candidateSelect(where = "1=1", params: unknown[] = [], limit = 5000): Promise<CandidateRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.*,
            COALESCE(c.candidate_code, c.id) AS candidate_id
       FROM ats_candidate c
      WHERE ${where}
      ORDER BY COALESCE(c.created_date, c.created_at) DESC, c.created_at DESC
      LIMIT ?`,
    [...params, limit]
  );
  return rows.map(enrichCandidate);
}
```

Key changes:
- Add `limit = 5000` parameter
- Add `LIMIT ?` to SQL
- Pass `[...params, limit]` as query params (spread params + limit last)
- Change ORDER BY from `COALESCE(c.created_date, DATE(c.created_at))` to `COALESCE(c.created_date, c.created_at)` — removes `DATE()` wrapper so the new index can be used

### Change 2: Push date bounds into SQL in `webData()` based on period

AFTER the existing `if (filters.fromDate)` and `if (filters.toDate)` blocks but BEFORE the scope/actorId block, add period-based SQL date conditions:

```typescript
    // Push date bounds into SQL when no explicit date range provided
    // This prevents full-table scans for bounded periods (FTD/WTD/MTD)
    if (!filters.fromDate && !filters.toDate) {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const period = filters.period || "ALL";
      if (period === "FTD") {
        conds.push("(c.created_date = ? OR (c.created_date IS NULL AND DATE(c.created_at) = ?))");
        params.push(todayStr, todayStr);
      } else if (period === "WTD") {
        const dow = new Date(now);
        dow.setDate(now.getDate() - now.getDay());
        const weekStart = dow.toISOString().slice(0, 10);
        conds.push("(c.created_date >= ? OR (c.created_date IS NULL AND DATE(c.created_at) >= ?))");
        params.push(weekStart, weekStart);
      } else if (period === "MTD") {
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        conds.push("(c.created_date >= ? OR (c.created_date IS NULL AND DATE(c.created_at) >= ?))");
        params.push(monthStart, monthStart);
      }
      // period === "ALL": no date filter added — 5000-row cap in candidateSelect still applies
    }
```

Insert this block AFTER the `if (filters.toDate)` block and BEFORE the `if (filters.branch)` block.

### Change 3: Keep JS period filtering as a safety check

The existing `const candidateRows = allRows.filter((r) => inPeriod(r, period))` line must stay — it acts as a safety filter. Just change `const period = filters.period || "ALL"` to move ABOVE the new date bounds block (so the period variable is available). Actually `period` is computed after `candidateSelect` is called — just leave it as is, the new code uses `filters.period` directly.

## What NOT to change
- Do NOT change any other callers of `candidateSelect()` — only the `webData()` function changes
- Do NOT change the response shape of `webData()` — all existing fields remain identical
- Do NOT change any other functions in the file
- The JS `allRows.filter((r) => inPeriod(r, period))` for `candidateRows` stays — keep it as safety filter

## Steps
1. Make Change 1 to `candidateSelect()` — add limit parameter, LIMIT clause, fix ORDER BY
2. Make Change 2 to `webData()` — insert date bounds block after `if (filters.toDate)` block
3. Run `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit` — 0 errors
4. Commit: `git add backend/src/modules/ats-full-parity/atsFullParity.service.ts && git commit -m "perf(ats): push date filter into SQL + add 5000-row cap to candidateSelect"`

## Report file
`c:\Users\ADMIN\Desktop\HRMS2-latest\.superpowers\sdd\ats-perf-task-2-report.md`

Return: status, commit hash, TypeScript result, concerns.
