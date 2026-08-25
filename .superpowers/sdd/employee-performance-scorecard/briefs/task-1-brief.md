# Task 1 Brief: Snapshot table migration

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 1)

## Global Constraints (binding on this task)

- New tables with a FK-like column to `employees(id)` must use an explicit `COLLATE` matching `employees.id`'s actual collation (known repo pitfall — verify via `SHOW CREATE TABLE employees` before writing the migration, do not assume).
- Migration numbers continue from **1558** (highest existing is `1557_branch_sal_code_from_db_bill.sql`).
- Never modify payroll/salary calculation logic (not touched by this task, noted for awareness).

## Task

**Files:**
- Create: `backend/sql/1558_employee_performance_daily_snapshot.sql`
- Modify: `backend/src/db/runPendingMigrations.ts` (register the migration, following the existing registration pattern used for `1252_kpi_role_template_metrics.sql`)

**Interfaces:**
- Produces: table `employee_performance_daily_snapshot` with columns: `id`, `employee_id`, `snapshot_date`, `attendance_status`, `late_by_minutes`, `unplanned_leave_flag`, `pip_status`, `designation_id`, `quality_score`, `template_metrics`, `team_attrition_pct`, `team_shrinkage_pct`, `team_revenue`, `created_at`, `updated_at`. This table will be consumed by later tasks in this plan (not part of your task) — do not add or rename columns beyond what's listed here.

- [ ] **Step 1: Verify `employees.id` collation**

Run against the live DB (read-only):
```sql
SHOW CREATE TABLE employees;
```
Note the exact `COLLATE` on the `id` column (e.g. `utf8mb4_unicode_ci` or `utf8mb4_general_ci`) — use that exact value in Step 2. Do not assume.

- [ ] **Step 2: Write the migration**

```sql
-- backend/sql/1558_employee_performance_daily_snapshot.sql
CREATE TABLE IF NOT EXISTS employee_performance_daily_snapshot (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci, -- match employees.id collation from Step 1
  snapshot_date DATE NOT NULL,
  attendance_status VARCHAR(20) NULL,
  late_by_minutes INT NOT NULL DEFAULT 0,
  unplanned_leave_flag TINYINT(1) NOT NULL DEFAULT 0,
  pip_status VARCHAR(20) NULL,
  designation_id VARCHAR(36) NULL,
  quality_score DECIMAL(6,2) NULL,
  template_metrics JSON NULL,
  team_attrition_pct DECIMAL(6,2) NULL,
  team_shrinkage_pct DECIMAL(6,2) NULL,
  team_revenue DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_perf_snapshot (employee_id, snapshot_date),
  KEY idx_perf_snapshot_date (snapshot_date),
  CONSTRAINT fk_emp_perf_snapshot_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
Replace the `COLLATE utf8mb4_unicode_ci` on the `employee_id` column (and the table-level COLLATE, if it differs) with whatever Step 1 actually found.

- [ ] **Step 3: Register the migration**

Open `backend/src/db/runPendingMigrations.ts`, find the array/list entry pattern used for `1252_kpi_role_template_metrics.sql`, and add a matching entry for `1558_employee_performance_daily_snapshot.sql` immediately after the highest existing entry, following the exact same object shape.

- [ ] **Step 4: Verify migration applies**

Run: `cd backend && npm run preflight` (this repo's deploy convention — validates pending migrations without a full restart).
Expected: `1558_employee_performance_daily_snapshot.sql` listed as applied, no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/sql/1558_employee_performance_daily_snapshot.sql backend/src/db/runPendingMigrations.ts
git commit -m "feat: add employee_performance_daily_snapshot table (migration 1558)"
```

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-1-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line test/verification summary
- Any concerns

## Important

- This repo has concurrent sessions editing the same shared working tree. Before editing `backend/src/db/runPendingMigrations.ts`, re-read its current tail so your insertion matches whatever the latest highest-numbered entry actually is (another session may have added migrations after 1557 while you work — if so, use the next number after whatever you actually find, not a hardcoded 1558, and note this in your report).
- You are working directly on the `main` branch (this repo's established convention — no feature branches). Commit directly when done.
- Do not touch any file outside this task's file list.
