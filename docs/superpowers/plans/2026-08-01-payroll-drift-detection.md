# Payroll Attendance Drift Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-trigger payroll recalculation when COSEC attendance sync writes rows, drain the previously-dead recalculation queue, capture before/after salary diffs, fix the RecalculationQueue UI, and add a Salary Drift Panel to the AttendanceControlTower.

**Architecture:** Five backend tasks build a complete recalculation pipeline: drainer service → COSEC sync hook → two new API routes → before/after diff logging. Three frontend tasks upgrade existing pages: drift panel in AttendanceControlTower, freeze-awareness banner + inline recalc action, RecalculationQueue page fixes (run picker + retry/cancel + processed_at + error detail + gap-age column).

**Tech Stack:** Express + TypeScript (backend), React 18 + TypeScript + Vite + Tailwind + shadcn/Radix + TanStack Query (frontend), MySQL `mas_hrms`.

## Global Constraints

- No new npm dependencies.
- No new DB tables or migrations — `payroll_recalculation_queue` already exists; `attendance_snapshot_locked` already a column on `salary_prep_run`; `payroll_calculation_audit` already exists.
- New `source_event_type` value `'cosec_sync'` in `payroll_recalculation_queue` — VARCHAR(50), no migration needed.
- Drainer failure must never crash or mask the COSEC sync result — catch and log only.
- Drift-check and recalculate-drift blocked when `attendance_snapshot_locked = 1` at both API and UI level.
- `hrmsApi` for all authenticated API calls — no raw `fetch()`.
- `npx tsc --noEmit` must pass (0 errors) after each task.
- Stage only explicitly named files — never `git add -A` or `git add .`.
- Roles for new routes: `payroll_head`, `admin`, `super_admin` (write); `payroll_head`, `payroll_branch`, `admin`, `super_admin`, `finance`, `payroll` (read).

---

## File Map

| File | Action | Task |
|---|---|---|
| `backend/src/modules/payroll/payroll-recalc-drainer.service.ts` | **Create** — queue drainer | 1 |
| `backend/src/modules/payroll/payroll-targeted-recalculation.service.ts` | Modify — add before/after diff capture + export drainer | 2 |
| `backend/src/modules/wfm/cosec-sync.service.ts` | Modify — collect written employees, call drainer after loop | 3 |
| `backend/src/modules/payroll/payroll-more.routes.ts` | Modify — add drift-check + recalculate-drift routes; add retry/cancel endpoints | 4 |
| `src/components/payroll/SalaryDriftPanel.tsx` | **Create** — drift scan + recalculate UI | 5 |
| `src/pages/payroll/AttendanceControlTower.tsx` | Modify — add freeze banner, inline recalc action, Days Open column, SalaryDriftPanel | 6 |
| `backend/src/modules/payroll/payroll-attendance-control.service.ts` | Modify — add `attendance_snapshot_locked` to run response shape | 6 |
| `src/pages/payroll/RecalculationQueue.tsx` | Modify — run picker dropdown, retry/cancel, processed_at, error detail | 7 |

---

## Task 1: Queue Drainer Service

**Files:**
- Create: `backend/src/modules/payroll/payroll-recalc-drainer.service.ts`

**Interfaces:**
- Consumes: `recalculateOpenPayrollForEmployee` from `payroll-targeted-recalculation.service.ts` (already exported)
- Produces: `drainPayrollRecalcQueue(payrollMonth: string, batchSize?: number): Promise<{ processed: number; failed: number; skipped_locked: number }>` — used by Tasks 2 and 3

- [ ] **Step 1: Write the test**

Create `backend/tests/payroll-recalc-drainer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB
const mockExecute = vi.fn();
vi.mock("../../src/db/mysql.js", () => ({ db: { execute: mockExecute } }));

// Mock recalculation
const mockRecalc = vi.fn();
vi.mock("../../src/modules/payroll/payroll-targeted-recalculation.service.js", () => ({
  recalculateOpenPayrollForEmployee: mockRecalc,
}));

import { drainPayrollRecalcQueue } from "../../src/modules/payroll/payroll-recalc-drainer.service.js";

beforeEach(() => { vi.clearAllMocks(); });

describe("drainPayrollRecalcQueue", () => {
  it("returns zeros when queue is empty", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // SELECT pending rows
    const result = await drainPayrollRecalcQueue("2026-07");
    expect(result).toEqual({ processed: 0, failed: 0, skipped_locked: 0 });
    expect(mockRecalc).not.toHaveBeenCalled();
  });

  it("processes pending entries and marks them completed", async () => {
    const rows = [
      { id: "id-1", employee_id: "emp-1", payroll_month: "2026-07-01", reason: "cosec_sync" },
      { id: "id-2", employee_id: "emp-2", payroll_month: "2026-07-01", reason: "cosec_sync" },
    ];
    mockExecute
      .mockResolvedValueOnce([rows])  // SELECT pending
      .mockResolvedValue([[]]); // UPDATE calls
    mockRecalc.mockResolvedValue({ status: "recalculated", runId: "run-1", message: "ok" });

    const result = await drainPayrollRecalcQueue("2026-07");
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockRecalc).toHaveBeenCalledTimes(2);
  });

  it("marks entry as skipped_locked when run is locked", async () => {
    const rows = [{ id: "id-3", employee_id: "emp-3", payroll_month: "2026-07-01", reason: "cosec_sync" }];
    mockExecute
      .mockResolvedValueOnce([rows])
      .mockResolvedValue([[]]);
    mockRecalc.mockResolvedValue({ status: "queued", runId: "run-1", message: "run is locked" });

    const result = await drainPayrollRecalcQueue("2026-07");
    expect(result.skipped_locked).toBe(1);
    expect(result.processed).toBe(0);
  });

  it("marks entry as failed when recalc throws", async () => {
    const rows = [{ id: "id-4", employee_id: "emp-4", payroll_month: "2026-07-01", reason: "cosec_sync" }];
    mockExecute
      .mockResolvedValueOnce([rows])
      .mockResolvedValue([[]]);
    mockRecalc.mockRejectedValue(new Error("DB error"));

    const result = await drainPayrollRecalcQueue("2026-07");
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run tests/payroll-recalc-drainer.test.ts
```
Expected: FAIL — "drainPayrollRecalcQueue is not a function"

- [ ] **Step 3: Implement the drainer**

Create `backend/src/modules/payroll/payroll-recalc-drainer.service.ts`:

```ts
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { recalculateOpenPayrollForEmployee } from "./payroll-targeted-recalculation.service.js";
import { logger } from "../../lib/logger.js";

export async function drainPayrollRecalcQueue(
  payrollMonth: string, // YYYY-MM
  batchSize = 200,
): Promise<{ processed: number; failed: number; skipped_locked: number }> {
  const monthDate = /^\d{4}-\d{2}$/.test(payrollMonth)
    ? `${payrollMonth}-01`
    : payrollMonth;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, payroll_month, reason
       FROM payroll_recalculation_queue
      WHERE payroll_month = ?
        AND status = 'pending'
      ORDER BY requested_at ASC
      LIMIT ?`,
    [monthDate, batchSize],
  );
  const entries = rows as Array<{ id: string; employee_id: string; payroll_month: string; reason: string }>;

  let processed = 0;
  let failed = 0;
  let skipped_locked = 0;

  for (const entry of entries) {
    // Mark processing
    await db.execute(
      `UPDATE payroll_recalculation_queue SET status = 'processing' WHERE id = ?`,
      [entry.id],
    );
    try {
      const result = await recalculateOpenPayrollForEmployee({
        employeeId: entry.employee_id,
        payrollMonth: entry.payroll_month.slice(0, 7), // YYYY-MM
        sourceEventType: "cosec_sync",
        reason: entry.reason,
        actorUserId: "system",
      });

      if (result.status === "recalculated") {
        await db.execute(
          `UPDATE payroll_recalculation_queue
              SET status = 'completed', processed_at = NOW()
            WHERE id = ?`,
          [entry.id],
        );
        processed++;
      } else {
        // queued (closed run) or no_open_run
        await db.execute(
          `UPDATE payroll_recalculation_queue
              SET status = 'skipped_locked', processed_at = NOW(),
                  error_message = ?
            WHERE id = ?`,
          [result.message, entry.id],
        );
        skipped_locked++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ employeeId: entry.employee_id, err: msg }, "[RecalcDrainer] failed for employee");
      await db.execute(
        `UPDATE payroll_recalculation_queue
            SET status = 'failed', processed_at = NOW(), error_message = ?
          WHERE id = ?`,
        [msg.slice(0, 500), entry.id],
      );
      failed++;
    }
  }

  return { processed, failed, skipped_locked };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npx vitest run tests/payroll-recalc-drainer.test.ts
```
Expected: 4 tests PASS

- [ ] **Step 5: TypeScript check**

```bash
cd backend && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/payroll/payroll-recalc-drainer.service.ts backend/tests/payroll-recalc-drainer.test.ts
git commit -m "feat(payroll): queue drainer service — processes pending recalculation entries"
```

---

## Task 2: Before/After Diff Capture in Recalculation Service

**Files:**
- Modify: `backend/src/modules/payroll/payroll-targeted-recalculation.service.ts`

**Interfaces:**
- Consumes: `drainPayrollRecalcQueue` from Task 1 — exported and re-exported here
- Produces: `recalculateOpenPayrollForEmployee` now writes a `SALARY_DRIFT_RECALC` event to `payroll_calculation_audit` with before/after diff when values change

Before calling `calculatePayrollRunScoped`, snapshot the employee's current `salary_prep_line` row. After recalc completes, read it again. If values changed, write to `payroll_calculation_audit`.

- [ ] **Step 1: Write the test**

Add to `backend/tests/payroll-targeted-recalculation.test.ts` (append these cases):

```ts
// Add at top of existing test file after existing imports:
// vi.mock already set up for db and calculatePayrollRunScoped in existing tests

describe("recalculateOpenPayrollForEmployee — diff capture", () => {
  it("writes SALARY_DRIFT_RECALC audit event when paid_days changes", async () => {
    // open run exists
    mockDb.execute
      .mockResolvedValueOnce([[{ id: "run-1", status: "processing" }]]) // find runs
      .mockResolvedValueOnce([[{ paid_working_days: 25, final_payable_days: 29, net_salary: 84891 }]]) // before snapshot
      .mockResolvedValueOnce([[]]) // calculatePayrollRunScoped (mocked separately)
      .mockResolvedValueOnce([[{ paid_working_days: 26, final_payable_days: 30, net_salary: 87819 }]]) // after snapshot
      .mockResolvedValueOnce([[]]); // INSERT audit

    await recalculateOpenPayrollForEmployee({
      employeeId: "emp-1", payrollMonth: "2026-07",
      sourceEventType: "cosec_sync", reason: "test", actorUserId: "sys",
    });

    // The 5th execute call should be the audit INSERT
    const auditCall = mockDb.execute.mock.calls[4];
    expect(auditCall[0]).toMatch(/INSERT INTO payroll_calculation_audit/i);
    const detail = JSON.parse(auditCall[1][3]); // event_detail param
    expect(detail.event).toBe("SALARY_DRIFT_RECALC");
    expect(detail.before.paid_working_days).toBe(25);
    expect(detail.after.paid_working_days).toBe(26);
    expect(detail.diff.final_payable_days).toBe(1);
    expect(detail.diff.net_salary).toBe(2928);
  });

  it("skips audit write when nothing changed", async () => {
    mockDb.execute
      .mockResolvedValueOnce([[{ id: "run-1", status: "processing" }]])
      .mockResolvedValueOnce([[{ paid_working_days: 26, final_payable_days: 30, net_salary: 87819 }]]) // before
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ paid_working_days: 26, final_payable_days: 30, net_salary: 87819 }]]); // after = same

    await recalculateOpenPayrollForEmployee({
      employeeId: "emp-1", payrollMonth: "2026-07",
      sourceEventType: "cosec_sync", reason: "test", actorUserId: "sys",
    });

    const auditCall = mockDb.execute.mock.calls.find(
      (c: any[]) => typeof c[0] === "string" && /INSERT INTO payroll_calculation_audit/i.test(c[0])
    );
    expect(auditCall).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run tests/payroll-targeted-recalculation.test.ts
```
Expected: new tests FAIL — no audit INSERT happening

- [ ] **Step 3: Add before/after snapshot logic**

In `backend/src/modules/payroll/payroll-targeted-recalculation.service.ts`, modify `recalculateOpenPayrollForEmployee`. After the `openRuns` loop (after line 102), add diff capture. Also add `drainPayrollRecalcQueue` re-export at the end:

```ts
// Add import at top of file:
import { randomUUID } from "crypto";

// Inside recalculateOpenPayrollForEmployee, replace the openRuns loop:
  for (const run of openRuns) {
    // Snapshot BEFORE
    const [beforeRows] = await db.execute<RowDataPacket[]>(
      `SELECT paid_working_days, final_payable_days, net_salary, gross_salary
         FROM salary_prep_line
        WHERE run_id = ? AND employee_id = ? LIMIT 1`,
      [String(run.id), params.employeeId],
    );
    const before = (beforeRows as any[])[0] ?? null;

    await calculatePayrollRunScoped(String(run.id), params.actorUserId ?? "system", {
      employeeIds: [params.employeeId],
    });

    // Snapshot AFTER
    const [afterRows] = await db.execute<RowDataPacket[]>(
      `SELECT paid_working_days, final_payable_days, net_salary, gross_salary
         FROM salary_prep_line
        WHERE run_id = ? AND employee_id = ? LIMIT 1`,
      [String(run.id), params.employeeId],
    );
    const after = (afterRows as any[])[0] ?? null;

    // Write audit event only when values changed
    if (before && after) {
      const diffPaidDays = Number(after.paid_working_days) - Number(before.paid_working_days);
      const diffFinalDays = Number(after.final_payable_days) - Number(before.final_payable_days);
      const diffNet = Math.round((Number(after.net_salary) - Number(before.net_salary)) * 100) / 100;
      if (diffPaidDays !== 0 || diffFinalDays !== 0 || diffNet !== 0) {
        await db.execute(
          `INSERT INTO payroll_calculation_audit (id, run_id, employee_id, event_type, event_detail, actor_user_id)
           VALUES (?, ?, ?, 'SALARY_DRIFT_RECALC', ?, ?)`,
          [
            randomUUID(),
            String(run.id),
            params.employeeId,
            JSON.stringify({
              event: "SALARY_DRIFT_RECALC",
              trigger: params.sourceEventType,
              before: {
                paid_working_days: Number(before.paid_working_days),
                final_payable_days: Number(before.final_payable_days),
                net_salary: Number(before.net_salary),
                gross_salary: Number(before.gross_salary),
              },
              after: {
                paid_working_days: Number(after.paid_working_days),
                final_payable_days: Number(after.final_payable_days),
                net_salary: Number(after.net_salary),
                gross_salary: Number(after.gross_salary),
              },
              diff: {
                paid_working_days: diffPaidDays,
                final_payable_days: diffFinalDays,
                net_salary: diffNet,
                gross_salary: Math.round((Number(after.gross_salary) - Number(before.gross_salary)) * 100) / 100,
              },
            }),
            params.actorUserId ?? "system",
          ],
        );
      }
    }
  }
```

At the bottom of the file, add re-export:
```ts
export { drainPayrollRecalcQueue } from "./payroll-recalc-drainer.service.js";
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && npx vitest run tests/payroll-targeted-recalculation.test.ts
```
Expected: all tests PASS

- [ ] **Step 5: TypeScript check**

```bash
cd backend && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/payroll/payroll-targeted-recalculation.service.ts
git commit -m "feat(payroll): capture before/after salary diff in payroll_calculation_audit on recalc"
```

---

## Task 3: Wire COSEC Sync to Auto-Trigger Recalculation

**Files:**
- Modify: `backend/src/modules/wfm/cosec-sync.service.ts`

**Interfaces:**
- Consumes: `queuePayrollRecalculation`, `drainPayrollRecalcQueue` (re-exported from `payroll-targeted-recalculation.service.ts` after Task 2)
- Produces: after every sync run, employees whose July (or current open month) attendance was written are automatically recalculated

The sync loop runs over `groups`. Each group has `group.punchDate` (YYYY-MM-DD) and resolves to an `employee_id`. We need to collect `Set<employeeId>` per payroll month for all groups that successfully migrated.

- [ ] **Step 1: Write the test**

Create `backend/tests/cosec-sync-recalc.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../src/db/mysql.js", () => ({ db: { execute: mockExecute, query: vi.fn().mockResolvedValue([[],[]])  } }));

const mockQueue = vi.fn();
const mockDrain = vi.fn().mockResolvedValue({ processed: 0, failed: 0, skipped_locked: 0 });
vi.mock("../../src/modules/payroll/payroll-targeted-recalculation.service.js", () => ({
  queuePayrollRecalculation: mockQueue,
  drainPayrollRecalcQueue: mockDrain,
}));

// Mock attendanceEngineService
vi.mock("../../src/modules/wfm/attendance-engine.service.js", () => ({
  attendanceEngineService: { upsertDailyRecord: vi.fn().mockResolvedValue(undefined) },
}));

import { triggerPostSyncPayrollRecalc } from "../../src/modules/wfm/cosec-sync.service.js";

beforeEach(() => { vi.clearAllMocks(); });

describe("triggerPostSyncPayrollRecalc", () => {
  it("queues and drains for each distinct payroll month", async () => {
    // 3 employees, 2 in 2026-07, 1 in 2026-06
    const written = new Map([
      ["2026-07", new Set(["emp-1", "emp-2"])],
      ["2026-06", new Set(["emp-3"])],
    ]);

    // Mock: both months have open runs
    mockExecute.mockResolvedValue([[{ run_month: "2026-07", id: "run-1" }]]);

    await triggerPostSyncPayrollRecalc(written);

    // queue called 3 times (2 + 1)
    expect(mockQueue).toHaveBeenCalledTimes(3);
    // drain called once per month
    expect(mockDrain).toHaveBeenCalledTimes(2);
    expect(mockDrain).toHaveBeenCalledWith("2026-07");
    expect(mockDrain).toHaveBeenCalledWith("2026-06");
  });

  it("skips months with no open runs", async () => {
    const written = new Map([["2026-07", new Set(["emp-1"])]]);
    // No open run for this month
    mockExecute.mockResolvedValue([[]]); // empty run rows

    await triggerPostSyncPayrollRecalc(written);

    expect(mockQueue).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
  });

  it("swallows drainer errors so sync result is not masked", async () => {
    const written = new Map([["2026-07", new Set(["emp-1"])]]);
    mockExecute.mockResolvedValue([[{ run_month: "2026-07", id: "run-1" }]]);
    mockQueue.mockResolvedValue(undefined);
    mockDrain.mockRejectedValue(new Error("drainer blew up"));

    // Must not throw
    await expect(triggerPostSyncPayrollRecalc(written)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run tests/cosec-sync-recalc.test.ts
```
Expected: FAIL — "triggerPostSyncPayrollRecalc is not a function"

- [ ] **Step 3: Add `triggerPostSyncPayrollRecalc` export and wire into sync loop**

At the top of `backend/src/modules/wfm/cosec-sync.service.ts`, add import after existing imports:
```ts
import { queuePayrollRecalculation, drainPayrollRecalcQueue } from "../payroll/payroll-targeted-recalculation.service.js";
```

Add the new exported function before the `export const cosecSyncService` object:
```ts
/**
 * Called after a COSEC sync completes. Queues + immediately drains
 * payroll recalculation for all employees whose attendance was written
 * for open (non-locked) payroll months.
 */
export async function triggerPostSyncPayrollRecalc(
  written: Map<string, Set<string>>, // YYYY-MM → Set<employeeId>
): Promise<void> {
  for (const [month, empIds] of written) {
    // Only act if an open salary_prep_run exists for this month
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_prep_run
        WHERE run_month = ?
          AND status NOT IN ('locked', 'disbursed', 'completed')
        LIMIT 1`,
      [month],
    );
    if (!(runRows as any[]).length) continue;

    for (const employeeId of empIds) {
      await queuePayrollRecalculation({
        employeeId,
        payrollMonth: month,
        sourceEventType: "cosec_sync",
        reason: "COSEC attendance sync wrote new/updated rows",
        requestedBy: "system",
      });
    }

    try {
      await drainPayrollRecalcQueue(month);
    } catch (err) {
      logger.warn({ month, err }, "[CosecSync] post-sync recalc drain failed — sync result unaffected");
    }
  }
}
```

Inside the sync loop in `cosecSyncService.sync`, declare the collector before the `for (const group of groups)` loop:
```ts
// Add before the for loop (around line 654):
const writtenByMonth = new Map<string, Set<string>>();
```

Inside the loop, after a successful `migratePunchGroup` or `writeMissingPunchRecord` call, collect the employee:
```ts
// After: if (status === "migrated") result.migratedDays += 1;
// Add:
if (status === "migrated") {
  result.migratedDays += 1;
  const month = group.punchDate.slice(0, 7); // YYYY-MM
  const employee = await resolveEmployee(group.cosecUserId);
  if (employee?.employee_id) {
    if (!writtenByMonth.has(month)) writtenByMonth.set(month, new Set());
    writtenByMonth.get(month)!.add(employee.employee_id);
  }
}
```

For the `writeMissingPunchRecord` path (around line 678), similarly:
```ts
// After: result.migratedDays += 1;  (in the isMissingPunch branch)
if (employee) {
  // ... existing writeMissingPunchRecord call ...
  result.migratedDays += 1;
  const month = group.punchDate.slice(0, 7);
  if (!writtenByMonth.has(month)) writtenByMonth.set(month, new Set());
  writtenByMonth.get(month)!.add(employee.employee_id);
}
```

After the for loop ends (before `lastSyncResult = result; return result;`), add:
```ts
// Fire-and-forget post-sync recalc — errors are caught inside, never mask sync result
void triggerPostSyncPayrollRecalc(writtenByMonth).catch((err) => {
  logger.warn({ err }, "[CosecSync] triggerPostSyncPayrollRecalc threw unexpectedly");
});
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npx vitest run tests/cosec-sync-recalc.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: TypeScript check**

```bash
cd backend && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/wfm/cosec-sync.service.ts backend/tests/cosec-sync-recalc.test.ts
git commit -m "feat(payroll): auto-queue and drain payroll recalc after COSEC attendance sync"
```

---

## Task 4: Backend Drift-Check Routes + Queue Retry/Cancel

**Files:**
- Modify: `backend/src/modules/payroll/payroll-more.routes.ts`

**Interfaces:**
- Consumes: `recalculateOpenPayrollForEmployee` from `payroll-targeted-recalculation.service.ts`
- Produces:
  - `GET /api/payroll/runs/:runId/drift-check` → `{ total_drifted, underpaid_count, overpaid_count, rows[], snapshot_locked }`
  - `POST /api/payroll/runs/:runId/recalculate-drift` body `{ employee_ids?: string[] }` → `{ processed, failed, skipped_locked }`
  - `POST /api/payroll/recalculation-queue/:id/retry` → `{ success }`
  - `POST /api/payroll/recalculation-queue/:id/cancel` → `{ success }`
  - `GET /api/payroll/runs` response already returns `attendance_snapshot_locked` (via SELECT *)

- [ ] **Step 1: Write the test**

Create `backend/tests/payroll-drift-routes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const mockExecute = vi.fn();
vi.mock("../../src/db/mysql.js", () => ({ db: { execute: mockExecute } }));

const mockRecalc = vi.fn();
vi.mock("../../src/modules/payroll/payroll-targeted-recalculation.service.js", () => ({
  recalculateOpenPayrollForEmployee: mockRecalc,
  drainPayrollRecalcQueue: vi.fn().mockResolvedValue({ processed: 0, failed: 0, skipped_locked: 0 }),
}));

// Mock auth middleware
vi.mock("../../src/middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../src/middleware/authMiddleware.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

import { payrollMoreRouter } from "../../src/modules/payroll/payroll-more.routes.js";

const app = express();
app.use(express.json());
app.use("/api/payroll", payrollMoreRouter);

beforeEach(() => { vi.clearAllMocks(); });

describe("GET /api/payroll/runs/:runId/drift-check", () => {
  it("returns drift rows when attendance differs from stored", async () => {
    // run exists, not locked
    mockExecute
      .mockResolvedValueOnce([[{ id: "run-1", run_month: "2026-07", attendance_snapshot_locked: 0 }]])
      .mockResolvedValueOnce([[
        { employee_id: "emp-1", employee_code: "MAS001", first_name: "A", last_name: "B",
          branch_name: "HQ", process_name: "Inbound",
          stored_paid_days: 25, live_paid_days: 26, diff: 1 },
      ]]);

    const res = await request(app).get("/api/payroll/runs/run-1/drift-check");
    expect(res.status).toBe(200);
    expect(res.body.data.total_drifted).toBe(1);
    expect(res.body.data.underpaid_count).toBe(1);
    expect(res.body.data.snapshot_locked).toBe(false);
    expect(res.body.data.rows[0].employee_code).toBe("MAS001");
  });

  it("returns 409 when snapshot is locked", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "run-1", run_month: "2026-07", attendance_snapshot_locked: 1 }]]);
    const res = await request(app).get("/api/payroll/runs/run-1/drift-check");
    expect(res.status).toBe(409);
  });
});

describe("POST /api/payroll/runs/:runId/recalculate-drift", () => {
  it("recalculates all drifted employees when no employee_ids given", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "run-1", run_month: "2026-07", attendance_snapshot_locked: 0 }]])
      .mockResolvedValueOnce([[
        { employee_id: "emp-1", stored_paid_days: 25, live_paid_days: 26, diff: 1 },
        { employee_id: "emp-2", stored_paid_days: 24, live_paid_days: 25, diff: 1 },
      ]]);
    mockRecalc.mockResolvedValue({ status: "recalculated", runId: "run-1", message: "ok" });

    const res = await request(app).post("/api/payroll/runs/run-1/recalculate-drift").send({});
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(2);
    expect(mockRecalc).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/payroll/recalculation-queue/:id/retry", () => {
  it("re-inserts failed entry as pending", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "q-1", employee_id: "emp-1", payroll_month: "2026-07-01", status: "failed" }]])
      .mockResolvedValueOnce([[]]); // INSERT new pending
    const res = await request(app).post("/api/payroll/recalculation-queue/q-1/retry").send({});
    expect(res.status).toBe(200);
  });

  it("returns 409 when entry is not in failed state", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "q-1", status: "completed" }]]);
    const res = await request(app).post("/api/payroll/recalculation-queue/q-1/retry").send({});
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run tests/payroll-drift-routes.test.ts
```
Expected: FAIL — routes don't exist yet

- [ ] **Step 3: Add the four new routes to `payroll-more.routes.ts`**

Add after the existing `POST /recalculation-queue/bulk` route (after line 274), before the `// ─── Holiday Master ───` comment:

```ts
import { recalculateOpenPayrollForEmployee } from "./payroll-targeted-recalculation.service.js";

// ─── Salary Drift Check ───────────────────────────────────────────────────────

payrollMoreRouter.get(
  "/runs/:runId/drift-check",
  requireRole("payroll_head", "payroll_branch", "admin", "super_admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params as { runId: string };
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, attendance_snapshot_locked FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const run = (runRows as any[])[0];
    if (!run) return res.status(404).json({ success: false, message: "Run not found" });

    if (run.attendance_snapshot_locked) {
      return res.status(409).json({
        success: false,
        message: "Attendance snapshot is locked — recalculation is disabled for this run.",
      });
    }

    const monthStart = `${String(run.run_month)}-01`;
    const monthEnd   = (() => {
      const [y, m] = String(run.run_month).split("-").map(Number);
      return `${run.run_month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    })();

    const [driftRows] = await db.execute<RowDataPacket[]>(
      `SELECT spl.employee_id,
              e.employee_code, e.first_name, e.last_name,
              COALESCE(bm.branch_name, e.branch_name) AS branch_name,
              COALESCE(pm.process_name, e.process_name) AS process_name,
              spl.paid_working_days                       AS stored_paid_days,
              ROUND(adr.live_paid_base, 1)                AS live_paid_days,
              ROUND(adr.live_paid_base - spl.paid_working_days, 1) AS diff
         FROM salary_prep_line spl
         JOIN employees e ON e.id = spl.employee_id
         LEFT JOIN branch_master bm ON bm.id = e.branch_id
         LEFT JOIN process_master pm ON pm.id = e.process_id
         JOIN (
           SELECT employee_id,
             SUM(CASE WHEN attendance_status IN ('present','late') THEN 1.0
                      WHEN attendance_status = 'half_day'          THEN 0.5
                      WHEN attendance_status = 'leave_approved'    THEN 1.0
                      ELSE 0 END) AS live_paid_base
           FROM attendance_daily_record
           WHERE record_date BETWEEN ? AND ?
           GROUP BY employee_id
         ) adr ON adr.employee_id = spl.employee_id
        WHERE spl.run_id = ?
          AND ABS(ROUND(adr.live_paid_base, 1) - ROUND(spl.paid_working_days, 1)) > 0.4
        ORDER BY ABS(adr.live_paid_base - spl.paid_working_days) DESC
        LIMIT 500`,
      [monthStart, monthEnd, runId],
    );

    const rows = driftRows as any[];
    const underpaid_count = rows.filter((r: any) => Number(r.diff) > 0).length;
    const overpaid_count  = rows.filter((r: any) => Number(r.diff) < 0).length;

    return res.json({
      success: true,
      data: {
        total_drifted: rows.length,
        underpaid_count,
        overpaid_count,
        snapshot_locked: Boolean(run.attendance_snapshot_locked),
        rows: rows.map((r: any) => ({
          employee_id:     String(r.employee_id),
          employee_code:   String(r.employee_code ?? ""),
          full_name:       `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
          branch_name:     r.branch_name ?? null,
          process_name:    r.process_name ?? null,
          stored_paid_days: Number(r.stored_paid_days),
          live_paid_days:   Number(r.live_paid_days),
          diff:             Number(r.diff),
          direction:        Number(r.diff) > 0 ? "underpaid" : "overpaid",
        })),
      },
    });
  }),
);

payrollMoreRouter.post(
  "/runs/:runId/recalculate-drift",
  requireRole("payroll_head", "admin", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params as { runId: string };
    const { employee_ids } = req.body as { employee_ids?: string[] };

    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, attendance_snapshot_locked FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const run = (runRows as any[])[0];
    if (!run) return res.status(404).json({ success: false, message: "Run not found" });
    if (run.attendance_snapshot_locked) {
      return res.status(409).json({ success: false, message: "Attendance snapshot is locked." });
    }

    let targetIds: string[];
    if (employee_ids?.length) {
      targetIds = employee_ids;
    } else {
      // fetch all drifted employees
      const monthStart = `${String(run.run_month)}-01`;
      const monthEnd   = (() => {
        const [y, m] = String(run.run_month).split("-").map(Number);
        return `${run.run_month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      })();
      const [driftRows] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT spl.employee_id
           FROM salary_prep_line spl
           JOIN (
             SELECT employee_id,
               SUM(CASE WHEN attendance_status IN ('present','late') THEN 1.0
                        WHEN attendance_status = 'half_day' THEN 0.5
                        WHEN attendance_status = 'leave_approved' THEN 1.0
                        ELSE 0 END) AS live_paid_base
             FROM attendance_daily_record
             WHERE record_date BETWEEN ? AND ?
             GROUP BY employee_id
           ) adr ON adr.employee_id = spl.employee_id
          WHERE spl.run_id = ?
            AND ABS(ROUND(adr.live_paid_base, 1) - ROUND(spl.paid_working_days, 1)) > 0.4`,
        [monthStart, monthEnd, runId],
      );
      targetIds = (driftRows as any[]).map((r: any) => String(r.employee_id));
    }

    const actorId = req.authUser?.id ?? "system";
    let processed = 0, failed = 0, skipped_locked = 0;

    for (const employeeId of targetIds) {
      try {
        const result = await recalculateOpenPayrollForEmployee({
          employeeId,
          payrollMonth: String(run.run_month),
          sourceEventType: "drift_panel",
          reason: "Manual drift recalculation from Attendance Control Tower",
          actorUserId: actorId,
        });
        if (result.status === "recalculated") processed++;
        else skipped_locked++;
      } catch { failed++; }
    }

    return res.json({ success: true, data: { processed, failed, skipped_locked, total: targetIds.length } });
  }),
);

// ─── Queue item actions (retry / cancel) ────────────────────────────────────

payrollMoreRouter.post(
  "/recalculation-queue/:id/retry",
  requireRole("payroll_head", "admin", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_id, payroll_month, reason, status FROM payroll_recalculation_queue WHERE id = ? LIMIT 1`,
      [id],
    );
    const item = (rows as any[])[0];
    if (!item) return res.status(404).json({ success: false, message: "Queue item not found" });
    if (item.status !== "failed") {
      return res.status(409).json({ success: false, message: `Cannot retry item in status '${item.status}' — only failed items can be retried` });
    }
    const { randomUUID } = await import("crypto");
    const newId = randomUUID();
    await db.execute(
      `INSERT INTO payroll_recalculation_queue
         (id, employee_id, payroll_month, source_event_type, reason, status, requested_by, requested_at)
       VALUES (?, ?, ?, 'manual_override', ?, 'pending', ?, NOW())`,
      [newId, item.employee_id, item.payroll_month, `Retry of ${id}: ${item.reason}`, req.authUser!.id],
    );
    return res.json({ success: true, data: { new_id: newId } });
  }),
);

payrollMoreRouter.post(
  "/recalculation-queue/:id/cancel",
  requireRole("payroll_head", "admin", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, status FROM payroll_recalculation_queue WHERE id = ? LIMIT 1`,
      [id],
    );
    const item = (rows as any[])[0];
    if (!item) return res.status(404).json({ success: false, message: "Queue item not found" });
    if (item.status !== "pending") {
      return res.status(409).json({ success: false, message: `Cannot cancel item in status '${item.status}' — only pending items can be cancelled` });
    }
    await db.execute(
      `UPDATE payroll_recalculation_queue SET status = 'skipped_locked', processed_at = NOW(), error_message = 'Manually cancelled' WHERE id = ?`,
      [id],
    );
    return res.json({ success: true });
  }),
);
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && npx vitest run tests/payroll-drift-routes.test.ts
```
Expected: all tests PASS

- [ ] **Step 5: TypeScript check**

```bash
cd backend && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/payroll/payroll-more.routes.ts backend/tests/payroll-drift-routes.test.ts
git commit -m "feat(payroll): drift-check and recalculate-drift routes + queue retry/cancel"
```

---

## Task 5: `SalaryDriftPanel` Component

**Files:**
- Create: `src/components/payroll/SalaryDriftPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/payroll/runs/:runId/drift-check`, `POST /api/payroll/runs/:runId/recalculate-drift`
- Produces: `<SalaryDriftPanel runId={string} runMonth={string} snapshotLocked={boolean} />` — used by Task 6

- [ ] **Step 1: Create the component**

Create `src/components/payroll/SalaryDriftPanel.tsx`:

```tsx
import { useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";

interface DriftRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_name: string | null;
  process_name: string | null;
  stored_paid_days: number;
  live_paid_days: number;
  diff: number;
  direction: "underpaid" | "overpaid";
}

interface DriftResult {
  total_drifted: number;
  underpaid_count: number;
  overpaid_count: number;
  snapshot_locked: boolean;
  rows: DriftRow[];
}

type State = "idle" | "scanning" | "results" | "recalculating" | "done";

interface Props {
  runId: string;
  runMonth: string;
  snapshotLocked: boolean;
}

export function SalaryDriftPanel({ runId, runMonth, snapshotLocked }: Props) {
  const { toast } = useToast();
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<DriftResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [doneStats, setDoneStats] = useState<{ processed: number; failed: number } | null>(null);

  const scan = async () => {
    setState("scanning");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DriftResult }>(
        `/api/payroll/runs/${runId}/drift-check`,
      );
      setResult(res.data);
      setSelected(new Set());
      setState("results");
    } catch (e: any) {
      toast({ title: "Drift scan failed", description: e.message, variant: "destructive" });
      setState("idle");
    }
  };

  const recalculate = async (employeeIds?: string[]) => {
    setState("recalculating");
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { processed: number; failed: number; skipped_locked: number } }>(
        `/api/payroll/runs/${runId}/recalculate-drift`,
        employeeIds?.length ? { employee_ids: employeeIds } : {},
      );
      setDoneStats({ processed: res.data.processed, failed: res.data.failed });
      setState("done");
      toast({
        title: "Recalculation complete",
        description: `${res.data.processed} employees updated · ${res.data.failed} failed · ${res.data.skipped_locked} skipped (locked)`,
      });
    } catch (e: any) {
      toast({ title: "Recalculation failed", description: e.message, variant: "destructive" });
      setState("results");
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!result) return;
    setSelected(prev =>
      prev.size === result.rows.length
        ? new Set()
        : new Set(result.rows.map(r => r.employee_id)),
    );
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.1em] text-slate-500">Salary Drift Audit</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Employees whose stored paid days differ from live attendance data for {runMonth}.
          </p>
        </div>
        <div className="flex gap-2">
          {(state === "idle" || state === "done") && (
            <Button size="sm" variant="outline" onClick={scan} disabled={snapshotLocked} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              {state === "done" ? "Re-scan" : "Scan for Drift"}
            </Button>
          )}
          {state === "results" && result && result.total_drifted > 0 && !snapshotLocked && (
            <>
              {selected.size > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void recalculate(Array.from(selected))}
                  className="gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Recalculate Selected ({selected.size})
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => void recalculate()}
                className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Recalculate All ({result.total_drifted})
              </Button>
            </>
          )}
          {state === "results" && result && result.total_drifted > 0 && (
            <Button size="sm" variant="ghost" onClick={scan} className="text-slate-500">Re-scan</Button>
          )}
        </div>
      </div>

      {snapshotLocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Attendance snapshot is frozen — recalculation is disabled. Fix gaps before freezing next time.
        </div>
      )}

      {/* States */}
      {state === "scanning" && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
          <RefreshCw className="h-4 w-4 animate-spin" /> Scanning attendance vs stored salary…
        </div>
      )}

      {state === "recalculating" && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
          <RefreshCw className="h-4 w-4 animate-spin" /> Recalculating — this may take a moment…
        </div>
      )}

      {state === "done" && doneStats && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          Done — {doneStats.processed} employees recalculated
          {doneStats.failed > 0 && `, ${doneStats.failed} failed`}.
        </div>
      )}

      {state === "results" && result && (
        <>
          {/* Summary badges */}
          <div className="flex gap-3 flex-wrap">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
              {result.total_drifted} drifted
            </span>
            {result.underpaid_count > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700 flex items-center gap-1">
                <TrendingDown className="h-3 w-3" /> {result.underpaid_count} underpaid
              </span>
            )}
            {result.overpaid_count > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> {result.overpaid_count} overpaid
              </span>
            )}
          </div>

          {result.total_drifted === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <CheckCircle2 className="h-4 w-4" /> No salary drift detected — stored salary matches live attendance.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-8">
                      <input type="checkbox"
                        checked={selected.size === result.rows.length && result.rows.length > 0}
                        onChange={toggleAll}
                        className="h-3.5 w-3.5 rounded"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left">Employee</th>
                    <th className="px-3 py-2.5 text-left">Branch · Process</th>
                    <th className="px-3 py-2.5 text-right">Stored Days</th>
                    <th className="px-3 py-2.5 text-right">Live Days</th>
                    <th className="px-3 py-2.5 text-right">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map(row => (
                    <tr key={row.employee_id} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-2">
                        <input type="checkbox"
                          checked={selected.has(row.employee_id)}
                          onChange={() => toggleSelect(row.employee_id)}
                          className="h-3.5 w-3.5 rounded"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-slate-900">{row.full_name}</p>
                        <p className="text-xs text-slate-500">{row.employee_code}</p>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {row.branch_name ?? "—"} · {row.process_name ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{row.stored_paid_days}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.live_paid_days}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${row.direction === "underpaid" ? "text-red-600" : "text-amber-600"}`}>
                        {row.diff > 0 ? "+" : ""}{row.diff}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/components/payroll/SalaryDriftPanel.tsx
git commit -m "feat(payroll): SalaryDriftPanel component — scan and fix salary drift"
```

---

## Task 6: Enhance `AttendanceControlTower.tsx`

**Files:**
- Modify: `src/pages/payroll/AttendanceControlTower.tsx`

Three additions:
1. Freeze-state amber banner at the top when `data.run` has `attendance_snapshot_locked = 1`
2. "Recalculate" action button on rows with `issueType === 'salary_payable_days_mismatch'`
3. "Days Open" column in the gap table
4. `<SalaryDriftPanel>` at the bottom of the page

- [ ] **Step 1: Add `SalaryDriftPanel` import**

Add to imports at top of `src/pages/payroll/AttendanceControlTower.tsx`:
```tsx
import { SalaryDriftPanel } from "@/components/payroll/SalaryDriftPanel";
```

- [ ] **Step 2: Add freeze-state banner**

The `ControlTowerResponse` interface (`data.run`) already has `status` but not `attendance_snapshot_locked`. The `GET /api/payroll/runs` uses `SELECT *` so `attendance_snapshot_locked` IS returned, but the Control Tower API response shape includes only `{ id, status, total_employees, total_net }`. We need to extend the type and the display.

First extend the `run` type in the `ControlTowerResponse` interface (around line 55):
```tsx
// Change:
  run: {
    id: string;
    status: string;
    total_employees: number;
    total_net: number;
  } | null;
// To:
  run: {
    id: string;
    status: string;
    total_employees: number;
    total_net: number;
    attendance_snapshot_locked?: number | boolean;
  } | null;
```

Then in the JSX, after the existing status badge / run info line (around line 526), add:
```tsx
{data?.run?.attendance_snapshot_locked ? (
  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2 text-sm text-amber-800 mb-2">
    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
    <span>
      <strong>Attendance snapshot is frozen.</strong> Changes resolved here won't affect the stored salary calculation — recalculation is disabled.
    </span>
  </div>
) : null}
```

`AlertTriangle` is already imported.

- [ ] **Step 3: Add "Days Open" column**

The `GapRow` interface doesn't have `created_at`. The Control Tower API returns rows from `payroll_attendance_conflict_review`. Check the backend to see if `created_at` is available:
- `attachReviewState` joins `payroll_attendance_conflict_review` — that table has `created_at`
- The `GapRow` type needs a new optional field `reviewCreatedAt?: string | null`

Add to `GapRow` interface (around line 48):
```tsx
  reviewCreatedAt?: string | null;
```

Add a helper function after `formatEvidence`:
```tsx
function daysOpen(reviewCreatedAt: string | null | undefined): number | null {
  if (!reviewCreatedAt) return null;
  const ms = Date.now() - new Date(reviewCreatedAt).getTime();
  return Math.floor(ms / 86400000);
}

function daysOpenStyle(days: number): string {
  if (days < 3) return "text-emerald-700";
  if (days <= 7) return "text-amber-700";
  return "text-red-600 font-semibold";
}
```

In the table header row, add a column after the existing columns (find the `<TableHead>` row):
```tsx
<TableHead className="w-16 text-right">Days Open</TableHead>
```

In each `<TableRow>` for a gap, add the cell:
```tsx
<TableCell className="text-right text-xs">
  {(() => {
    const d = daysOpen(row.reviewCreatedAt);
    if (d === null) return <span className="text-slate-400">—</span>;
    return <span className={daysOpenStyle(d)}>{d}d</span>;
  })()}
</TableCell>
```

- [ ] **Step 4: Add inline Recalculate action for `salary_payable_days_mismatch` rows**

In the action cell of the gap table, find the block that renders per-issue actions. After the existing `adrMissingIssueTypes` block, add handling for `salary_payable_days_mismatch`:

```tsx
{row.issueType === "salary_payable_days_mismatch" && row.employeeId && !data?.run?.attendance_snapshot_locked && (
  <Button
    size="sm"
    variant="outline"
    className="h-7 px-2 text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50"
    onClick={() => {
      if (!data?.run?.id) return;
      hrmsApi.post(`/api/payroll/runs/${data.run!.id}/recalculate-drift`, {
        employee_ids: [row.employeeId],
      }).then(() => {
        void refetch();
      }).catch((e: any) => {
        console.error("Inline recalc failed", e.message);
      });
    }}
  >
    <RefreshCw className="h-3 w-3 mr-1" />Recalculate
  </Button>
)}
```

`RefreshCw` is already imported.

- [ ] **Step 5: Add SalaryDriftPanel at the bottom**

At the end of the page JSX, just before the closing `</DashboardLayout>` tag, add:
```tsx
{data?.run && (
  <div className="mt-6 px-6 pb-6">
    <SalaryDriftPanel
      runId={data.run.id}
      runMonth={data.runMonth}
      snapshotLocked={Boolean(data.run.attendance_snapshot_locked)}
    />
  </div>
)}
```

Also ensure the backend returns `attendance_snapshot_locked` in the Control Tower response. Check `payroll-attendance-control.service.ts` `getControlTower` function — it already returns `run: { id, status, total_employees, total_net }`. We need to add `attendance_snapshot_locked`:

In `backend/src/modules/payroll/payroll-attendance-control.service.ts`, find where `run` is set in the response and add `attendance_snapshot_locked: Number(run.attendance_snapshot_locked ?? 0)`.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add src/pages/payroll/AttendanceControlTower.tsx src/components/payroll/SalaryDriftPanel.tsx backend/src/modules/payroll/payroll-attendance-control.service.ts
git commit -m "feat(payroll): add SalaryDriftPanel, freeze banner, Days Open column, inline recalc to AttendanceControlTower"
```

---

## Task 7: Fix `RecalculationQueue.tsx`

**Files:**
- Modify: `src/pages/payroll/RecalculationQueue.tsx`

Four fixes:
1. Bulk modal: replace raw UUID input with a run picker dropdown from `GET /api/payroll/runs`
2. Add Retry button on `failed` rows, Cancel button on `pending` rows
3. Add `processed_at` column and error detail expandable row
4. Add `processed_at` to `QueueItem` interface and format it

- [ ] **Step 1: Extend `QueueItem` and add `RunOption`**

Replace the `QueueItem` interface and add `RunOption`:
```tsx
interface QueueItem {
  id: string;        // changed from number to string (UUID)
  employee_name: string;
  employee_code: string;
  payroll_month: string;
  source_event_type: string;
  reason: string;
  status: string;
  requested_at: string;
  processed_at?: string | null;
  error_message?: string | null;
}

interface RunOption {
  id: string;
  run_month: string;
  status: string;
  total_employees: number;
}
```

- [ ] **Step 2: Add runs query state and fetch**

After the existing state declarations, add:
```tsx
const [runs, setRuns] = useState<RunOption[]>([]);

// Add inside useEffect or as a separate useEffect:
useEffect(() => {
  hrmsApi.get<any>("/api/payroll/runs?limit=20")
    .then((res: any) => {
      const list = Array.isArray(res) ? res : (res?.data ?? res?.runs ?? []);
      setRuns(list.filter((r: any) => !["locked", "disbursed"].includes(r.status)));
    })
    .catch(() => {});
}, []);
```

- [ ] **Step 3: Replace UUID input in bulk modal with run dropdown**

Find the bulk modal `<Input placeholder="Enter payroll run ID" ...>` block and replace it:
```tsx
<div>
  <label className="text-sm font-medium block mb-1">Payroll Run <span className="text-red-500">*</span></label>
  <select
    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    value={bulkRunId}
    onChange={(e) => setBulkRunId(e.target.value)}
    disabled={bulkSubmitting}
  >
    <option value="">— Select run —</option>
    {runs.map(r => (
      <option key={r.id} value={r.id}>
        {r.run_month} · {r.status} · {r.total_employees} employees
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 4: Add `processed_at` and `error_message` columns to table**

Add two columns to the `<thead>`:
```tsx
<th className="text-left px-4 py-2">Processed At</th>
<th className="text-left px-4 py-2">Actions</th>
```

In each `<tr>` for a queue item, add:
```tsx
<td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
  {item.processed_at ? new Date(item.processed_at).toLocaleString("en-IN") : "—"}
</td>
<td className="px-4 py-2">
  <div className="flex gap-1.5">
    {item.status === "failed" && (
      <button
        className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
        onClick={() => retryItem(item.id)}
      >
        Retry
      </button>
    )}
    {item.status === "pending" && (
      <button
        className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
        onClick={() => cancelItem(item.id)}
      >
        Cancel
      </button>
    )}
    {item.status === "failed" && item.error_message && (
      <details className="inline">
        <summary className="text-xs text-slate-500 cursor-pointer">Error</summary>
        <p className="absolute z-10 bg-white border rounded shadow p-2 text-xs max-w-xs text-red-600 mt-1">
          {item.error_message}
        </p>
      </details>
    )}
  </div>
</td>
```

- [ ] **Step 5: Implement `retryItem` and `cancelItem` handlers**

Add after `submitBulkRecalculation`:
```tsx
const retryItem = async (id: string) => {
  try {
    await hrmsApi.post(`/api/payroll/recalculation-queue/${id}/retry`, {});
    fetchQueue();
  } catch (e: any) {
    setError(e.message ?? "Retry failed");
  }
};

const cancelItem = async (id: string) => {
  try {
    await hrmsApi.post(`/api/payroll/recalculation-queue/${id}/cancel`, {});
    fetchQueue();
  } catch (e: any) {
    setError(e.message ?? "Cancel failed");
  }
};
```

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add src/pages/payroll/RecalculationQueue.tsx
git commit -m "fix(payroll): recalculation queue — run picker, retry/cancel, processed_at, error detail"
```

---

## Final Verification

- [ ] **Run all backend tests**

```bash
cd backend && npx vitest run
```
Expected: all tests pass, 0 failures

- [ ] **Full TypeScript check**

```bash
npx tsc --noEmit && echo FE_OK && cd backend && npx tsc --noEmit && echo BE_OK
```
Expected: FE_OK and BE_OK both printed

- [ ] **End-to-end smoke test (manual)**

1. Open Payroll → Attendance Control Tower for July 2026
2. Confirm "Salary Drift Audit" section appears at bottom
3. Click "Scan for Drift" — should show 0 rows (we fixed all 956 earlier)
4. Open Payroll → Recalculation Queue
5. Confirm "Bulk Recalculate" modal now shows a run dropdown instead of UUID input
6. Confirm `failed` rows show Retry button, `pending` rows show Cancel button
7. Confirm `processed_at` column is visible
