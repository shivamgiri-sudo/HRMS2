# ATS Command Center Performance Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 30-second timeout on `/ats/command-center` by eliminating unbounded full-table scans, parallelizing sequential queries, and adding covering indexes.

**Architecture:** Three files changed (backend service + migration), no frontend changes needed. The root cause is that `webData()` fetches ALL active candidates with no LIMIT and does period filtering in JavaScript, plus the command-centre metrics fire 7 sequential DB queries instead of running in parallel.

**Tech Stack:** Node.js + Express + TypeScript + MySQL `mas_hrms`. All changes are backend-only.

## Global Constraints

- NO frontend changes in this plan — all fixes are backend
- All SQL migrations must use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` to be idempotent
- New migration files must be numbered `519_*` and `520_*` (current highest is `518_dpdp_feature_flags.sql`)
- The `candidateSelect()` function must remain backwards compatible — only the `webData()` caller changes
- `getDashboardMetrics()` must return the exact same response shape — only the execution strategy changes (parallel vs sequential)
- TypeScript: no new `any` types; existing `any` patterns can stay

---

## Task 1: Add Missing Performance Indexes (Migration 519)

**Files:**
- Create: `backend/sql/519_ats_performance_indexes.sql`

The existing `460_ats_performance_indexes.sql` added `idx_cand_mobile`. The hot query paths need:
1. `(active_status, created_date)` on `ats_candidate` — covering index for the base WHERE + date range filter in `webData()`
2. `(active_status, current_stage)` on `ats_candidate` — covering index for `getDashboardMetrics()` COUNT queries
3. `(candidate_id)` on `ats_candidate_assessment` — speeds up the `scores` subquery in every queue endpoint
4. `(assessment_id)` on `ats_typing_test_attempt` — speeds up the JOIN in the scores subquery
5. `(queue_status, arrival_time)` on `ats_queue_token` — speeds up the `position_in_queue` correlated subquery

- [ ] **Step 1: Write the migration file**

```sql
-- 519: ATS Command Center performance indexes
-- Idempotent — safe to re-run

ALTER TABLE ats_candidate
  ADD INDEX IF NOT EXISTS idx_ats_cand_active_created   (active_status, created_date),
  ADD INDEX IF NOT EXISTS idx_ats_cand_active_stage     (active_status, current_stage),
  ADD INDEX IF NOT EXISTS idx_ats_cand_active_created_at(active_status, created_at);

ALTER TABLE ats_candidate_assessment
  ADD INDEX IF NOT EXISTS idx_ats_asmt_candidate_id (candidate_id);

ALTER TABLE ats_typing_test_attempt
  ADD INDEX IF NOT EXISTS idx_ats_typing_assessment_id (assessment_id);

ALTER TABLE ats_queue_token
  ADD INDEX IF NOT EXISTS idx_ats_qt_status_arrival (queue_status, arrival_time),
  ADD INDEX IF NOT EXISTS idx_ats_qt_candidate_status (candidate_id, queue_status);
```

Note: MySQL `ADD INDEX IF NOT EXISTS` syntax may not be supported on older MySQL versions. Use this safer pattern instead:

```sql
-- 519: ATS Command Center performance indexes (MySQL-safe, idempotent)

SET @db = DATABASE();

-- ats_candidate: (active_status, created_date)
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_candidate' AND INDEX_NAME='idx_ats_cand_active_created');
SET @s = IF(@n=0, 'ALTER TABLE ats_candidate ADD INDEX idx_ats_cand_active_created (active_status, created_date)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_candidate: (active_status, current_stage)
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_candidate' AND INDEX_NAME='idx_ats_cand_active_stage');
SET @s = IF(@n=0, 'ALTER TABLE ats_candidate ADD INDEX idx_ats_cand_active_stage (active_status, current_stage)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_candidate: (active_status, created_at) — fallback for rows where created_date is NULL
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_candidate' AND INDEX_NAME='idx_ats_cand_active_created_at');
SET @s = IF(@n=0, 'ALTER TABLE ats_candidate ADD INDEX idx_ats_cand_active_created_at (active_status, created_at)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_candidate_assessment: (candidate_id)
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_candidate_assessment' AND INDEX_NAME='idx_ats_asmt_candidate_id');
SET @s = IF(@n=0, 'ALTER TABLE ats_candidate_assessment ADD INDEX idx_ats_asmt_candidate_id (candidate_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_typing_test_attempt: (assessment_id)
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_typing_test_attempt' AND INDEX_NAME='idx_ats_typing_asmt_id');
SET @s = IF(@n=0, 'ALTER TABLE ats_typing_test_attempt ADD INDEX idx_ats_typing_asmt_id (assessment_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_queue_token: (queue_status, arrival_time)
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_queue_token' AND INDEX_NAME='idx_ats_qt_status_arrival');
SET @s = IF(@n=0, 'ALTER TABLE ats_queue_token ADD INDEX idx_ats_qt_status_arrival (queue_status, arrival_time)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ats_queue_token: (candidate_id, queue_status)
SET @n = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
          WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ats_queue_token' AND INDEX_NAME='idx_ats_qt_candidate_status');
SET @s = IF(@n=0, 'ALTER TABLE ats_queue_token ADD INDEX idx_ats_qt_candidate_status (candidate_id, queue_status)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
```

- [ ] **Step 2: Register in migration manifest**

Add to `backend/src/db/runPendingMigrations.ts` (the array of migration file paths):
```typescript
"519_ats_performance_indexes.sql",
```

- [ ] **Step 3: TypeScript check**

Run: `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit`
Expected: 0 errors in modified files

- [ ] **Step 4: Commit**

```bash
git add backend/sql/519_ats_performance_indexes.sql backend/src/db/runPendingMigrations.ts
git commit -m "perf(ats): add covering indexes for command center hot query paths"
```

---

## Task 2: Fix `webData()` — Add SQL Date Filter + LIMIT (atsFullParity.service.ts)

**Files:**
- Modify: `backend/src/modules/ats-full-parity/atsFullParity.service.ts`

**Root cause:** `candidateSelect()` has no LIMIT. `webData()` applies date filtering in JavaScript AFTER fetching ALL rows. With `period=ALL` and no date range, the entire `ats_candidate` table loads into Node.js.

**Fix strategy:**
1. When `period` is NOT `"ALL"`, push the date filter into the SQL WHERE clause instead of filtering in JS after fetch
2. Default `period` to `"MTD"` (current month) when no period or date range is specified, so the no-filter case is bounded
3. Add a hard cap of 5000 rows to `candidateSelect()` to prevent runaway queries

**Exact changes to `webData()` in `atsFullParity.service.ts`:**

Find the WHERE clause assembly block (around line 476-488) — the section that builds `conds` and `params`. Currently the date condition uses `COALESCE(c.created_date, DATE(c.created_at))`. Replace the period-based date filter with a proper SQL range:

```typescript
// BEFORE (JS filtering after fetch):
const allRows = await candidateSelect(conds.join(" AND "), params);
const periodRows = allRows.filter((r) => inPeriod(r, period));

// AFTER (SQL filtering before fetch):
// Push date bounds into SQL when period is not ALL
let sqlFromDate: string | null = null;
let sqlToDate: string | null = null;

if (filters.fromDate) {
  sqlFromDate = filters.fromDate;
  sqlToDate = filters.toDate ?? new Date().toISOString().slice(0, 10);
} else if (period === "FTD") {
  sqlFromDate = new Date().toISOString().slice(0, 10);
  sqlToDate = sqlFromDate;
} else if (period === "WTD") {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  sqlFromDate = d.toISOString().slice(0, 10);
  sqlToDate = new Date().toISOString().slice(0, 10);
} else if (period === "MTD") {
  const d = new Date();
  sqlFromDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  sqlToDate = new Date().toISOString().slice(0, 10);
}
// For period === "ALL" with no dates: no date filter, but still cap at 5000 rows

if (sqlFromDate) {
  conds.push("(c.created_date >= ? OR (c.created_date IS NULL AND DATE(c.created_at) >= ?))");
  params.push(sqlFromDate, sqlFromDate);
}
if (sqlToDate) {
  conds.push("(c.created_date <= ? OR (c.created_date IS NULL AND DATE(c.created_at) <= ?))");
  params.push(sqlToDate, sqlToDate);
}

const allRows = await candidateSelect(conds.join(" AND "), params);
// JS-based inPeriod filtering is still applied on top as a safety check
const periodRows = period === "ALL" ? allRows : allRows.filter((r) => inPeriod(r, period));
```

**Add LIMIT cap to `candidateSelect()`:**

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

Note: the ORDER BY is changed from `COALESCE(c.created_date, DATE(c.created_at)) DESC` to `COALESCE(c.created_date, c.created_at) DESC` — removing the `DATE()` wrapper on `created_at` allows the `idx_ats_cand_active_created_at` index to be used for sorting.

- [ ] **Step 1: Modify `candidateSelect()` — add `limit` parameter and `LIMIT ?` clause, fix ORDER BY**

- [ ] **Step 2: Modify `webData()` — add SQL date range conditions before calling `candidateSelect`, adjust JS filtering**

- [ ] **Step 3: TypeScript check**

Run: `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/ats-full-parity/atsFullParity.service.ts
git commit -m "perf(ats): push date filter into SQL + add 5000-row cap to candidateSelect"
```

---

## Task 3: Parallelize getDashboardMetrics() (command-centre.service.ts)

**Files:**
- Modify: `backend/src/modules/ats/command-centre.service.ts`

**Root cause:** 7 independent DB queries run sequentially. Total time = sum of all 7. They can run in parallel using `Promise.all`.

**Fix:** Wrap all 7 `await db.execute()` calls in a single `Promise.all`. The response shape stays exactly the same.

Current pattern (lines 66-132):
```typescript
const [totalRows] = await db.execute(query1, params1);
const [activeRows] = await db.execute(query2, params2);
// ... 5 more awaits
```

Replace with:
```typescript
const [
  [totalRows],
  [activeRows],
  [selectedRows],
  [rejectedRows],
  [interviewTodayRows],
  [payrollRows],
  [joinedMonthRows],
] = await Promise.all([
  db.execute(query1, params1),
  db.execute(query2, params2),
  db.execute(query3, params3),
  db.execute(query4, params4),
  db.execute(query5, params5),
  db.execute(query6, params6),
  db.execute(query7, params7),
]);
```

Also fix `getTimelineData()`: add a date range WHERE to each subquery. The `reg` subquery currently scans all historical `ats_candidate` rows. Add `WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)` matching the outer `days` parameter.

- [ ] **Step 1: Rewrite `getDashboardMetrics()` to use `Promise.all`**

Read the exact 7 queries from `command-centre.service.ts` lines 66-132. Keep each query SQL identical. Only change the execution from sequential awaits to a single `Promise.all([...])`.

- [ ] **Step 2: Fix `getTimelineData()` — add date range to subqueries**

Find the `reg`, `int`, `sel`, `rej` subqueries (lines 240-265). Each does a full-table `GROUP BY DATE(col)`. Add `WHERE col >= DATE_SUB(CURDATE(), INTERVAL ? DAY)` to each, matching the `days` parameter passed to the outer query.

- [ ] **Step 3: TypeScript check**

Run: `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/ats/command-centre.service.ts
git commit -m "perf(ats): parallelize 7 sequential metric queries + date-bound timeline subqueries"
```

---

## Task 4: Fix position_in_queue O(N²) correlated subquery (queue.enhanced.service.ts)

**Files:**
- Modify: `backend/src/modules/ats/queue.enhanced.service.ts`

**Root cause:** The `position_in_queue` correlated subquery in `getLiveQueue()` (line 128) fires once per row, scanning `ats_queue_token` each time. With N candidates in queue it's O(N²).

**Fix:** Remove the correlated subquery. Instead, use MySQL's `ROW_NUMBER()` window function (available MySQL 8+) to compute position in one pass. If the MySQL version doesn't support window functions, compute position in application code after the main query.

**Safe approach (application-side ranking — works on all MySQL versions):**

Remove the `position_in_queue` correlated subquery entirely from the SQL. After fetching the result rows, sort by `arrival_time` in JavaScript and assign position as the index + 1.

```typescript
// After db.execute() returns rows, add position in JS:
const sorted = rows.sort((a, b) => 
  new Date(a.arrived_at ?? a.created_at).getTime() - new Date(b.arrived_at ?? b.created_at).getTime()
);
return sorted.map((row, index) => ({ ...row, position_in_queue: index + 1 }));
```

The SQL query loses the `position_in_queue` subquery but gains a deterministic sort. The output includes `position_in_queue` on every row just as before.

Apply the same fix to `getRecruiterQueue()` and `getOpsRoundQueue()` which have the same pattern.

- [ ] **Step 1: Remove `position_in_queue` subquery from `getLiveQueue()` SQL, add JS ranking after fetch**

- [ ] **Step 2: Apply same fix to `getRecruiterQueue()` and `getOpsRoundQueue()`**

- [ ] **Step 3: TypeScript check**

Run: `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/ats/queue.enhanced.service.ts
git commit -m "perf(ats): replace O(N²) position_in_queue correlated subquery with JS ranking"
```

---

## Task 5: Final verification + push

- [ ] **Step 1: Full TypeScript check**
```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit
cd c:/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit
```
Expected: 0 errors in both

- [ ] **Step 2: Push to trigger auto-deploy**
```bash
git push origin main
```
GitHub Actions deploys to `https://mcnhrms.teammas.in`

- [ ] **Step 3: Verify fix on production**

Navigate to `https://mcnhrms.teammas.in/ats/command-center`
- Page should load within 3-5 seconds (not 30s timeout)
- All tabs should show data
- Live Queue tab should load quickly
- Dashboard/Trends/Rejections tabs should show real data

---

## Files Changed Summary

| File | Change | Task |
|------|--------|------|
| `backend/sql/519_ats_performance_indexes.sql` | NEW — 7 covering indexes | Task 1 |
| `backend/src/db/runPendingMigrations.ts` | Register 519 | Task 1 |
| `backend/src/modules/ats-full-parity/atsFullParity.service.ts` | SQL date filter + 5000-row cap | Task 2 |
| `backend/src/modules/ats/command-centre.service.ts` | Parallelize 7 queries + date-bound timeline | Task 3 |
| `backend/src/modules/ats/queue.enhanced.service.ts` | Remove O(N²) position subquery | Task 4 |

---

## Expected Performance Improvement

| Query | Before | After |
|-------|--------|-------|
| `webData()` MTD | ~8-30s (full table) | ~0.5-2s (date-filtered + indexed) |
| `webData()` ALL | ~8-30s (full table) | ~2-5s (capped at 5000 rows) |
| `getDashboardMetrics()` | ~1-3s (7 sequential) | ~200-500ms (7 parallel) |
| `getTimelineData()` | ~2-5s (full table subqueries) | ~200-500ms (date-bounded) |
| `getLiveQueue()` | O(N²) per queue size | O(N) linear |
