# Payroll Attendance Drift — Auto-Trigger + Audit UI Design

## Problem

COSEC biometric sync runs overnight and writes new/updated rows into
`attendance_daily_record`. The July 2026 sync added rows for 956 employees
AFTER their `salary_prep_line` was already calculated, leaving stored
`paid_working_days` / `final_payable_days` stale until someone manually
recalculated. There is no mechanism today that triggers a payroll recalc
when attendance changes. `payroll_recalculation_queue` exists in the DB
but has no worker — it is a dead-letter box.

---

## Scope

**Part A — Backend:** Wire the COSEC sync to queue + immediately drain
recalculations for all employees whose attendance was written for the open
payroll month.

**Part B — Frontend:** Add a "Salary Drift" panel to the existing
`AttendanceControlTower.tsx` page so payroll_head can scan for and fix
mismatches before finalization.

---

## Part A: Backend Auto-Trigger

### Files changed

| File | Change |
|---|---|
| `backend/src/modules/wfm/cosec-sync.service.ts` | Collect written `(employeeId, month)` pairs in the sync loop; call `triggerPostSyncPayrollRecalc` at the end |
| `backend/src/modules/payroll/payroll-recalc-drainer.service.ts` | **New** — drains pending queue entries for a given month |
| `backend/src/modules/payroll/payroll-targeted-recalculation.service.ts` | Export `drainPayrollRecalcQueue` (thin wrapper calling the drainer) |

### How the sync loop is instrumented

In `cosec-sync.service.ts`, inside the `for (const group of groups)` loop,
after a successful `migratePunchGroup` or `writeMissingPunchRecord` call,
record the `(employee_id, punchDate.slice(0, 7))` pair in a local
`Map<string, Set<string>>` keyed by `YYYY-MM`.

After the loop ends (before `return result`), for each `YYYY-MM` key that
matches an **open** (non-locked) `salary_prep_run.run_month`:

1. Call `queuePayrollRecalculation(employeeId, month, 'cosec_sync')` for
   each employee in that month's set.
2. Call `drainPayrollRecalcQueue(month)` to process what was just queued.

No changes to the loop's error handling — a drainer failure is logged and
swallowed; it must not mask the sync result.

### `payroll-recalc-drainer.service.ts`

```ts
export async function drainPayrollRecalcQueue(payrollMonth: string): Promise<{
  processed: number;
  failed: number;
  skipped_locked: number;
}>;
```

Algorithm:
1. `SELECT` up to 200 `pending` entries from `payroll_recalculation_queue`
   WHERE `payroll_month = YYYY-MM-01` — ORDER BY `requested_at ASC`.
2. `UPDATE … SET status = 'processing'` for those IDs (row-level lock).
3. For each entry call `recalculateOpenPayrollForEmployee(...)`.
4. On success: `UPDATE … SET status = 'completed', processed_at = NOW()`.
5. On `run is locked/disbursed`: `UPDATE … SET status = 'skipped_locked'`.
6. On any other error: `UPDATE … SET status = 'failed', error_message = ?`.
7. Return counts.

Batch size 200 — enough for a typical nightly sync without holding a
long-running connection.

### `source_event_type` values

`payroll_recalculation_queue.source_event_type` is `VARCHAR(50)`.
New value added (no migration needed): `'cosec_sync'`.

Existing values already in use: `'attendance_regularization'`,
`'manual_override'`, `'apr_upload'`, `'holiday_work_approval'`.

---

## Part B: Frontend Salary Drift Panel

### Placement

New sub-component `SalaryDriftPanel` inserted at the bottom of
`AttendanceControlTower.tsx`, inside the existing page wrapper. Visible
only when a July/current payroll run is loaded.

### Backend routes (new, both in `payroll-more.routes.ts`)

**`GET /api/payroll/runs/:runId/drift-check`**

Returns employees where live `paid_working_days` (from
`attendance_daily_record`) differs from stored `salary_prep_line.paid_working_days`
by more than 0.4 days.

Response shape:
```json
{
  "total_drifted": 39,
  "underpaid_count": 28,
  "overpaid_count": 11,
  "rows": [
    {
      "employee_id": "...",
      "employee_code": "MAS47814",
      "full_name": "SHIVAM SHIV GIRI",
      "branch_name": "...",
      "process_name": "...",
      "stored_paid_days": 25.0,
      "live_paid_days": 26.0,
      "diff": 1.0,
      "direction": "underpaid"
    }
  ]
}
```

SQL used:
```sql
SELECT DISTINCT spl.employee_id, e.employee_code, e.first_name, e.last_name,
  e.branch_name, e.process_name,
  spl.paid_working_days AS stored_paid_days,
  ROUND(adr.live_paid_base, 1) AS live_paid_days,
  ROUND(adr.live_paid_base - spl.paid_working_days, 1) AS diff
FROM salary_prep_line spl
JOIN salary_prep_run spr ON spr.id = spl.run_id
JOIN employees e ON e.id = spl.employee_id
JOIN (
  SELECT employee_id,
    SUM(CASE
      WHEN attendance_status IN ('present','late') THEN 1.0
      WHEN attendance_status = 'half_day'          THEN 0.5
      WHEN attendance_status = 'leave_approved'    THEN 1.0
      ELSE 0 END) AS live_paid_base
  FROM attendance_daily_record
  WHERE record_date BETWEEN :monthStart AND :monthEnd
  GROUP BY employee_id
) adr ON adr.employee_id = spl.employee_id
WHERE spr.id = :runId
  AND spr.status NOT IN ('locked', 'disbursed', 'completed')
  AND ABS(ROUND(adr.live_paid_base, 1) - ROUND(spl.paid_working_days, 1)) > 0.4
ORDER BY ABS(adr.live_paid_base - spl.paid_working_days) DESC
LIMIT 500
```

**`POST /api/payroll/runs/:runId/recalculate-drift`**

Body: `{ employee_ids?: string[] }` — if omitted, recalculates ALL drifted
employees found by the drift-check query.

Calls `recalculateOpenPayrollForEmployee` for each employee in the run.
Returns `{ processed, failed, skipped_locked }`.

Both routes require role: `payroll_head`, `admin`, `super_admin`.

### `SalaryDriftPanel` component

**File:** `src/components/payroll/SalaryDriftPanel.tsx`

**Props:** `{ runId: string; runMonth: string; runStatus: string }`

**State machine:**
- `idle` — shows "Scan for salary drift" button
- `scanning` — spinner while GET in progress
- `results` — table + action buttons
- `recalculating` — spinner with progress count
- `done` — success banner with counts

**Table columns:**
- Employee Code / Name
- Branch · Process
- Stored Paid Days
- Live Paid Days
- Diff (coloured: green = overpaid, red = underpaid)
- Checkbox (for selective recalculation)

**Action buttons (shown in `results` state):**
- "Recalculate All Drifted (N)" — fires POST for all
- "Recalculate Selected (N)" — fires POST for checked rows only
- "Re-scan" — re-fetches the drift list

Buttons disabled when `runStatus` is `locked` or `disbursed`.

**Integration into `AttendanceControlTower.tsx`:**
- Import and render `<SalaryDriftPanel runId={run.id} runMonth={run.run_month} runStatus={run.status} />` at the bottom of the page, below the existing gap table.
- The run object is already loaded on that page.

---

## Data Flow

```
COSEC sync runs (nightly ~02:00 IST)
  └─ migratePunchGroup / writeMissingPunchRecord
       └─ records (employeeId, month) pairs
  └─ [after loop] queuePayrollRecalculation × N
  └─ drainPayrollRecalcQueue(month)
       └─ recalculateOpenPayrollForEmployee × N
            └─ calculatePayrollRunScoped (scoped to employee)
                 └─ salary_prep_line.paid_working_days, final_payable_days updated

Payroll head opens AttendanceControlTower
  └─ sees SalaryDriftPanel
  └─ clicks "Scan" → GET /drift-check → table shows 0 rows (already fixed by sync)
     OR if COSEC sync hadn't run → shows N rows
  └─ clicks "Recalculate All" → POST /recalculate-drift → done
```

---

## Global Constraints

- No new npm dependencies.
- No new DB tables or schema migrations — `payroll_recalculation_queue`
  already exists; `source_event_type` is `VARCHAR(50)`, new value `cosec_sync`
  needs no migration.
- Drainer failure must not crash or mask the COSEC sync result.
- Drift-check and recalculate-drift must be blocked when run status is
  `locked` or `disbursed` — both at the API level and in the UI.
- `recalculateOpenPayrollForEmployee` already handles the locked-run guard;
  the drainer surfaces `skipped_locked` in its return value.
- All authenticated API calls use `hrmsApi`; no raw `fetch`.
- TypeScript: `npx tsc --noEmit` must pass after each task.
- Stage only explicitly named files per CLAUDE.md concurrent-agent rules.
