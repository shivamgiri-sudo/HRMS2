# Transition Manager Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three confirmed gaps between the MCN Employee Transition Manager deck and HRMS2: a one-click Confirm/Reject action on the AWOL work item, real 4-hourly repeating reminders on stale IT-provisioning tasks, and a new internal HR BGV-initiation ticket.

**Architecture:** All three build on existing infrastructure rather than new subsystems — the existing `work_item`/`exit_request` tables and `createExitRequest` service for the AWOL action, the existing `notifyOverdueProvisioning()` overdue-notification function (not the TAT escalation engine, which does not govern IT-provisioning tasks — see Task 4's note) for repeating reminders, and the existing `JOIN_TASKS` array + generic task-completion route for the new BGV ticket.

**Tech Stack:** Node/Express/TypeScript backend, MySQL, React/TypeScript + Tailwind + shadcn/ui frontend, Vitest for tests.

## Global Constraints

- All migrations are additive only (`CREATE TABLE IF NOT EXISTS` / nullable `ADD COLUMN`) — no destructive schema changes, per the spec and standing deploy authorization.
- Do not change the AWOL 7-day consecutive-absence threshold or remove the reporting-manager human-confirmation requirement (`backend/src/modules/employees/awol-detection.service.ts`).
- Do not touch candidate-facing BGV/DigiLocker code (`backend/src/modules/ats/bgv-verification.service.ts`, `backend/src/modules/integrations/luckpay/*`) — the new BGV ticket is a fully separate, internal HR record.
- Follow the existing `evidence_note` free-text convention on `it_provisioning_request` rather than adding a duplicate note column.
- Every new migration file gets an entry appended to `MIGRATION_MANIFEST` in `backend/src/db/runPendingMigrations.ts` and to `backend/sql/MIGRATION_MANIFEST.lock.json`, matching the existing one-line-per-file, dated-comment style.
- Design system: GlassCard (`rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md`), amber tone for a pending decision, tone colors `red`/`green` for the BGV result badge, per the frozen MAS HRMS design patterns.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/modules/employees/awol-detection.service.ts` | Modify: export the last-worked-date derivation as its own reusable function. |
| `backend/src/modules/work-inbox/awol-confirm.service.ts` | Create: confirm/reject logic for an `AWOL_SUSPECTED` work item — re-derives last worked date, creates the exit request, resolves both AWOL work items. |
| `backend/src/modules/work-inbox/work-inbox.routes.ts` | Modify: two new routes, `GET /:id/awol-context` and `POST /:id/awol/confirm`, `POST /:id/awol/reject`. |
| `backend/src/modules/work-inbox/__tests__/awol-confirm.service.test.ts` | Create: unit tests for the new service. |
| `backend/src/modules/inbox/inbox.service.ts` | Modify: add `item_type` to `PendingTask` and its `work_item` mapping. |
| `src/pages/NativeWorkInbox.tsx` | Modify: add `item_type` to the frontend `PendingTask` type; add a Confirm Absconding / Not Absconding branch to `ActionSheet`. |
| `backend/sql/1842_it_provisioning_bgv_result_column.sql` | Create: additive migration, nullable `bgv_result` ENUM column on `it_provisioning_request`. |
| `backend/src/modules/it-provisioning/it-provisioning.service.ts` | Modify: add `HR_BGV_INITIATION` to `JOIN_TASKS`; change `notifyOverdueProvisioning`'s dedupe key to a 4-hour bucket. |
| `backend/src/modules/it-provisioning/it-provisioning.routes.ts` | Modify: `persistStructuredFields` accepts `bgv_result`; `/tasks/:id/complete` requires it for `HR_BGV_INITIATION`. |
| `backend/src/modules/it-provisioning/__tests__/it-provisioning.service.test.ts` | Modify: add cases for the new task and the repeat-reminder dedupe key. |
| `backend/src/db/runPendingMigrations.ts`, `backend/sql/MIGRATION_MANIFEST.lock.json` | Modify: register the new migration. |
| `backend/sql/schema-snapshot.json` | Modify: add the observed `bgv_result` column so the `schema-column-refs` pre-push guard passes. |

---

## Task 1: Extract a reusable last-worked-date lookup

**Files:**
- Modify: `backend/src/modules/employees/awol-detection.service.ts`
- Test: `backend/src/modules/employees/__tests__/awol-detection.service.test.ts` (create if it does not already exist — check first)

**Interfaces:**
- Produces: `export async function getLastWorkedDate(employeeId: string, lookbackDays?: number): Promise<string | null>` — used by Task 2.

- [ ] **Step 1: Check for an existing test file**

Run: `ls backend/src/modules/employees/__tests__/awol-detection.service.test.ts`

If it exists, read it first and add the new test alongside the existing ones instead of overwriting. If it does not exist, create it fresh in Step 2.

- [ ] **Step 2: Write the failing test**

```typescript
// backend/src/modules/employees/__tests__/awol-detection.service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

import { getLastWorkedDate } from "../awol-detection.service.js";

describe("getLastWorkedDate", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns the formatted last non-absent record_date for the employee", async () => {
    mockExecute.mockResolvedValueOnce([
      [{ last_worked_date: new Date("2026-09-10T00:00:00Z") }],
    ]);
    const result = await getLastWorkedDate("emp-1");
    expect(result).toBe("2026-09-10");
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("attendance_status <> 'absent'"),
      ["emp-1"],
    );
  });

  it("returns null when the employee has no non-absent record in the lookback window", async () => {
    mockExecute.mockResolvedValueOnce([[{ last_worked_date: null }]]);
    const result = await getLastWorkedDate("emp-2");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/employees/__tests__/awol-detection.service.test.ts`
Expected: FAIL with "getLastWorkedDate is not a function" or a module resolution error, since the export does not exist yet.

- [ ] **Step 4: Extract the function**

In `backend/src/modules/employees/awol-detection.service.ts`, add this new exported function (place it above `runAwolDetectionScan`, after the `CONSECUTIVE_ABSENT_DAYS` constant):

```typescript
/**
 * The last date this employee was actually present, re-derived live.
 *
 * Same query runAwolDetectionScan's SELECT uses for last_worked_date — extracted so the
 * Confirm Absconding action (work-inbox/awol-confirm.service.ts) can recompute it fresh at
 * confirm-time rather than trusting the value baked into the work item's description text
 * when it was raised, which can be stale by the time a manager acts on it.
 */
export async function getLastWorkedDate(
  employeeId: string,
  lookbackDays: number = LOOKBACK_DAYS,
): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT MAX(record_date) AS last_worked_date
       FROM attendance_daily_record
      WHERE employee_id = ?
        AND record_date >= DATE_SUB(CURDATE(), INTERVAL ${Number(lookbackDays)} DAY)
        AND attendance_status <> 'absent'`,
    [employeeId],
  );
  const value = (rows as RowDataPacket[])[0]?.last_worked_date as string | Date | null;
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}
```

Then simplify the inline subquery inside `runAwolDetectionScan`'s main SELECT to keep behavior identical (it stays inline there, since it's a correlated subquery inside a bigger query and cannot cheaply call the new function per-row) — no change needed to that query; this step only adds the new standalone export used by Task 2.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/employees/__tests__/awol-detection.service.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/employees/awol-detection.service.ts backend/src/modules/employees/__tests__/awol-detection.service.test.ts
git commit -m "feat: extract reusable last-worked-date lookup for AWOL confirm action"
```

---

## Task 2: AWOL confirm/reject service

**Files:**
- Create: `backend/src/modules/work-inbox/awol-confirm.service.ts`
- Test: `backend/src/modules/work-inbox/__tests__/awol-confirm.service.test.ts`

**Interfaces:**
- Consumes: `getLastWorkedDate(employeeId, lookbackDays?)` from Task 1; `createExitRequest(input, userId)` from `backend/src/modules/exit/exit.service.ts` (signature: `{ employeeId: string; exitDate: string; exitType: string; exitSubType?: string | null; abscondingSince?: string | null; reason?: string | null; initiatedBy?: "employee" | "manager" | "hr" }`, returns `Promise<ExitRequest>`); `completeWorkItem(id, userId, remarks?)` from `backend/src/modules/work-inbox/work-inbox.service.ts`.
- Produces: `export async function getAwolContext(workItemId: string): Promise<{ employeeId: string; employeeName: string; lastWorkedDate: string | null }>`, `export async function confirmAwolAbsconding(workItemId: string, userId: string, input: { lastWorkedDate: string; remarks?: string }): Promise<{ exitRequestId: string }>`, `export async function rejectAwolSuspected(workItemId: string, userId: string, remarks: string): Promise<void>` — all consumed by Task 3's routes.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/modules/work-inbox/__tests__/awol-confirm.service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

const mockGetLastWorkedDate = vi.fn();
vi.mock("../../employees/awol-detection.service.js", () => ({
  getLastWorkedDate: (...args: unknown[]) => mockGetLastWorkedDate(...args),
}));

const mockCreateExitRequest = vi.fn();
vi.mock("../../exit/exit.service.js", () => ({
  exitService: { createExitRequest: (...args: unknown[]) => mockCreateExitRequest(...args) },
}));

const mockCompleteWorkItem = vi.fn();
vi.mock("../work-inbox.service.js", () => ({
  completeWorkItem: (...args: unknown[]) => mockCompleteWorkItem(...args),
}));

import {
  getAwolContext,
  confirmAwolAbsconding,
  rejectAwolSuspected,
} from "../awol-confirm.service.js";

describe("getAwolContext", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockGetLastWorkedDate.mockReset();
  });

  it("throws 404 when the work item does not exist", async () => {
    mockExecute.mockResolvedValueOnce([[]]);
    await expect(getAwolContext("wi-missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 400 when the work item is not an AWOL_SUSPECTED item", async () => {
    mockExecute.mockResolvedValueOnce([
      [{ item_type: "OTHER_TYPE", entity_id: "emp-1", title: "x" }],
    ]);
    await expect(getAwolContext("wi-1")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns the employee id, name and a freshly derived last worked date", async () => {
    mockExecute
      .mockResolvedValueOnce([
        [{ item_type: "AWOL_SUSPECTED", entity_id: "emp-1", title: "Confirm absconding: Jane Doe" }],
      ])
      .mockResolvedValueOnce([[{ full_name: "Jane Doe", employee_code: "MAS001" }]]);
    mockGetLastWorkedDate.mockResolvedValueOnce("2026-09-10");

    const result = await getAwolContext("wi-1");

    expect(result).toEqual({
      employeeId: "emp-1",
      employeeName: "Jane Doe",
      lastWorkedDate: "2026-09-10",
    });
    expect(mockGetLastWorkedDate).toHaveBeenCalledWith("emp-1");
  });
});

describe("confirmAwolAbsconding", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCreateExitRequest.mockReset();
    mockCompleteWorkItem.mockReset();
  });

  it("creates an absconding exit request and resolves both AWOL work items", async () => {
    mockExecute
      .mockResolvedValueOnce([
        [{ item_type: "AWOL_SUSPECTED", entity_id: "emp-1", title: "Confirm absconding: Jane Doe" }],
      ]) // work item lookup
      .mockResolvedValueOnce([[{ id: "wi-payroll" }]]); // sibling AWOL_PAYROLL_NOTICE lookup
    mockCreateExitRequest.mockResolvedValueOnce({ id: "exit-1" });

    const result = await confirmAwolAbsconding("wi-1", "user-1", {
      lastWorkedDate: "2026-09-10",
      remarks: "Confirmed with team lead",
    });

    expect(result).toEqual({ exitRequestId: "exit-1" });
    expect(mockCreateExitRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: "emp-1",
        exitDate: "2026-09-10",
        exitType: "involuntary",
        exitSubType: "absconding",
        abscondingSince: "2026-09-10",
        initiatedBy: "manager",
      }),
      "user-1",
    );
    expect(mockCompleteWorkItem).toHaveBeenCalledWith("wi-1", "user-1", "Confirmed with team lead");
    expect(mockCompleteWorkItem).toHaveBeenCalledWith("wi-payroll", "user-1", expect.any(String));
  });

  it("throws 400 when the work item is not AWOL_SUSPECTED", async () => {
    mockExecute.mockResolvedValueOnce([[{ item_type: "OTHER", entity_id: "emp-1", title: "x" }]]);
    await expect(
      confirmAwolAbsconding("wi-1", "user-1", { lastWorkedDate: "2026-09-10" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockCreateExitRequest).not.toHaveBeenCalled();
  });
});

describe("rejectAwolSuspected", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCompleteWorkItem.mockReset();
  });

  it("completes both AWOL work items with the rejection reason, without creating an exit", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ item_type: "AWOL_SUSPECTED", entity_id: "emp-1", title: "x" }]])
      .mockResolvedValueOnce([[{ id: "wi-payroll" }]]);

    await rejectAwolSuspected("wi-1", "user-1", "Employee is on unrecorded field duty");

    expect(mockCompleteWorkItem).toHaveBeenCalledWith(
      "wi-1",
      "user-1",
      "Employee is on unrecorded field duty",
    );
    expect(mockCompleteWorkItem).toHaveBeenCalledWith("wi-payroll", "user-1", expect.any(String));
  });

  it("throws 400 when remarks is blank", async () => {
    await expect(rejectAwolSuspected("wi-1", "user-1", "  ")).rejects.toMatchObject({ statusCode: 400 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/work-inbox/__tests__/awol-confirm.service.test.ts`
Expected: FAIL — module `../awol-confirm.service.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// backend/src/modules/work-inbox/awol-confirm.service.ts
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getLastWorkedDate } from "../employees/awol-detection.service.js";
import { exitService } from "../exit/exit.service.js";
import { completeWorkItem } from "./work-inbox.service.js";

type AwolWorkItem = {
  itemType: string;
  employeeId: string;
  title: string;
};

async function loadAwolWorkItem(workItemId: string): Promise<AwolWorkItem> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT item_type, entity_id, title FROM work_item WHERE id = ? LIMIT 1`,
    [workItemId],
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) {
    throw Object.assign(new Error("Work item not found"), { statusCode: 404 });
  }
  if (row.item_type !== "AWOL_SUSPECTED") {
    throw Object.assign(
      new Error("This action only applies to an AWOL_SUSPECTED work item"),
      { statusCode: 400 },
    );
  }
  return {
    itemType: String(row.item_type),
    employeeId: String(row.entity_id),
    title: String(row.title ?? ""),
  };
}

/**
 * The AWOL_PAYROLL_NOTICE item raised alongside this AWOL_SUSPECTED item for the same
 * employee (see triggerAwolSuspected). Once the manager decides either way, payroll's
 * "still running" notice about the same no-show is resolved too — there is nothing further
 * for payroll to watch once an exit exists (confirm) or the no-show is explained (reject).
 */
async function findSiblingPayrollNoticeId(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM work_item
      WHERE entity_type = 'employee' AND entity_id = ? AND item_type = 'AWOL_PAYROLL_NOTICE'
        AND status NOT IN ('completed', 'cancelled')
      LIMIT 1`,
    [employeeId],
  );
  return (rows as RowDataPacket[])[0]?.id ? String((rows as RowDataPacket[])[0].id) : null;
}

export async function getAwolContext(
  workItemId: string,
): Promise<{ employeeId: string; employeeName: string; lastWorkedDate: string | null }> {
  const item = await loadAwolWorkItem(workItemId);
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(full_name, ''), employee_code) AS full_name
       FROM employees WHERE id = ? LIMIT 1`,
    [item.employeeId],
  );
  const employeeName = String((empRows as RowDataPacket[])[0]?.full_name ?? item.title);
  const lastWorkedDate = await getLastWorkedDate(item.employeeId);
  return { employeeId: item.employeeId, employeeName, lastWorkedDate };
}

export async function confirmAwolAbsconding(
  workItemId: string,
  userId: string,
  input: { lastWorkedDate: string; remarks?: string },
): Promise<{ exitRequestId: string }> {
  const item = await loadAwolWorkItem(workItemId);

  const exit = await exitService.createExitRequest(
    {
      employeeId: item.employeeId,
      exitDate: input.lastWorkedDate,
      exitType: "involuntary",
      exitSubType: "absconding",
      abscondingSince: input.lastWorkedDate,
      reason: input.remarks ?? "Confirmed absconding via AWOL work item",
      initiatedBy: "manager",
    },
    userId,
  );

  await completeWorkItem(workItemId, userId, input.remarks ?? "Absconding confirmed");
  const siblingId = await findSiblingPayrollNoticeId(item.employeeId);
  if (siblingId) {
    await completeWorkItem(siblingId, userId, `Absconding confirmed, exit ${exit.id} raised`);
  }

  return { exitRequestId: exit.id };
}

export async function rejectAwolSuspected(
  workItemId: string,
  userId: string,
  remarks: string,
): Promise<void> {
  if (!remarks?.trim()) {
    throw Object.assign(new Error("A reason is required to dismiss this AWOL item"), {
      statusCode: 400,
    });
  }
  const item = await loadAwolWorkItem(workItemId);
  await completeWorkItem(workItemId, userId, remarks.trim());
  const siblingId = await findSiblingPayrollNoticeId(item.employeeId);
  if (siblingId) {
    await completeWorkItem(siblingId, userId, `Not absconding: ${remarks.trim()}`);
  }
}
```

Check how `exit.service.ts` exports `createExitRequest` before finalizing the import — it may be a named export (`export const exitService = { createExitRequest, ... }` object) or a standalone function export. Run:

```bash
grep -n "^export" backend/src/modules/exit/exit.service.ts | head -5
```

Adjust the import in `awol-confirm.service.ts` and its test's `vi.mock` to match whichever form is real (either `import { exitService } from "../exit/exit.service.js"` and `exitService.createExitRequest(...)`, or `import { createExitRequest } from "../exit/exit.service.js"` and `createExitRequest(...)` directly) — the test mock above assumes the `exitService.createExitRequest` object form; adjust both the mock and the implementation together so they agree, then re-run Step 2's failing-test check before continuing to Step 4.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/work-inbox/__tests__/awol-confirm.service.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/work-inbox/awol-confirm.service.ts backend/src/modules/work-inbox/__tests__/awol-confirm.service.test.ts
git commit -m "feat: add AWOL confirm/reject service backing the one-click work item action"
```

---

## Task 3: Backend routes for the AWOL confirm action

**Files:**
- Modify: `backend/src/modules/work-inbox/work-inbox.routes.ts`
- Test: `backend/src/modules/work-inbox/__tests__/work-inbox.routes.test.ts` (create if none exists — check first with `ls backend/src/modules/work-inbox/__tests__/`)

**Interfaces:**
- Consumes: `getAwolContext`, `confirmAwolAbsconding`, `rejectAwolSuspected` from Task 2; `assertWorkItemAccess(userId, workItemId, action)` already in `work-inbox.service.ts` (action union already includes `'complete'`, which is the correct check here since confirm/reject are both terminal actions on the item).
- Produces: `GET /api/work-inbox/:id/awol-context`, `POST /api/work-inbox/:id/awol/confirm`, `POST /api/work-inbox/:id/awol/reject` — consumed by Task 5 (frontend).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/modules/work-inbox/__tests__/work-inbox.routes.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "user-1" };
    next();
  },
}));
vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: async () => ({ roleKeys: ["manager"], primaryRole: "manager" }),
}));

const mockAssertAccess = vi.fn().mockResolvedValue(undefined);
const mockGetContext = vi.fn();
const mockConfirm = vi.fn();
const mockReject = vi.fn();

vi.mock("../work-inbox.service.js", async () => {
  const actual = await vi.importActual<typeof import("../work-inbox.service.js")>(
    "../work-inbox.service.js",
  );
  return { ...actual, assertWorkItemAccess: (...args: unknown[]) => mockAssertAccess(...args) };
});
vi.mock("../awol-confirm.service.js", () => ({
  getAwolContext: (...args: unknown[]) => mockGetContext(...args),
  confirmAwolAbsconding: (...args: unknown[]) => mockConfirm(...args),
  rejectAwolSuspected: (...args: unknown[]) => mockReject(...args),
}));

import { workInboxRouter } from "../work-inbox.routes.js";

const app = express();
app.use(express.json());
app.use("/api/work-inbox", workInboxRouter);

describe("AWOL confirm routes", () => {
  beforeEach(() => {
    mockAssertAccess.mockClear();
    mockGetContext.mockReset();
    mockConfirm.mockReset();
    mockReject.mockReset();
  });

  it("GET /:id/awol-context returns the derived context", async () => {
    mockGetContext.mockResolvedValueOnce({
      employeeId: "emp-1",
      employeeName: "Jane Doe",
      lastWorkedDate: "2026-09-10",
    });
    const res = await request(app).get("/api/work-inbox/wi-1/awol-context");
    expect(res.status).toBe(200);
    expect(res.body.data.lastWorkedDate).toBe("2026-09-10");
  });

  it("POST /:id/awol/confirm creates the exit and returns its id", async () => {
    mockConfirm.mockResolvedValueOnce({ exitRequestId: "exit-1" });
    const res = await request(app)
      .post("/api/work-inbox/wi-1/awol/confirm")
      .send({ lastWorkedDate: "2026-09-10", remarks: "confirmed" });
    expect(res.status).toBe(200);
    expect(res.body.data.exitRequestId).toBe("exit-1");
    expect(mockAssertAccess).toHaveBeenCalledWith("user-1", "wi-1", "complete");
  });

  it("POST /:id/awol/reject requires remarks and returns success", async () => {
    const res = await request(app).post("/api/work-inbox/wi-1/awol/reject").send({ remarks: "on leave" });
    expect(res.status).toBe(200);
    expect(mockReject).toHaveBeenCalledWith("wi-1", "user-1", "on leave");
  });
});
```

Check whether `supertest` is already a dev dependency before writing this test:

```bash
grep -n '"supertest"' backend/package.json
```

If it is missing, check how an existing route test in this module avoids it (e.g. calling the route handler function directly instead of spinning up an express app) and follow that existing pattern instead of adding a new dependency.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/work-inbox/__tests__/work-inbox.routes.test.ts`
Expected: FAIL — 404 on all three routes, since they don't exist yet.

- [ ] **Step 3: Add the routes**

In `backend/src/modules/work-inbox/work-inbox.routes.ts`, add this import near the top alongside the existing `import * as svc from "./work-inbox.service.js";`:

```typescript
import { getAwolContext, confirmAwolAbsconding, rejectAwolSuspected } from "./awol-confirm.service.js";
```

Then add these three routes directly above the existing `export { router as workInboxRouter };` line:

```typescript
router.get("/:id/awol-context", h(async (req: AuthenticatedRequest, res: any) => {
  const data = await getAwolContext(req.params.id);
  return res.json({ success: true, data });
}));

router.post("/:id/awol/confirm", h(async (req: AuthenticatedRequest, res: any) => {
  await svc.assertWorkItemAccess(req.authUser!.id, req.params.id, "complete");
  const { lastWorkedDate, remarks } = req.body as { lastWorkedDate?: string; remarks?: string };
  if (!lastWorkedDate) {
    return res.status(400).json({ success: false, error: "lastWorkedDate is required" });
  }
  const data = await confirmAwolAbsconding(req.params.id, req.authUser!.id, { lastWorkedDate, remarks });
  return res.json({ success: true, data });
}));

router.post("/:id/awol/reject", h(async (req: AuthenticatedRequest, res: any) => {
  await svc.assertWorkItemAccess(req.authUser!.id, req.params.id, "complete");
  const { remarks } = req.body as { remarks?: string };
  await rejectAwolSuspected(req.params.id, req.authUser!.id, String(remarks ?? ""));
  return res.json({ success: true });
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/work-inbox/__tests__/work-inbox.routes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/work-inbox/work-inbox.routes.ts backend/src/modules/work-inbox/__tests__/work-inbox.routes.test.ts
git commit -m "feat: add AWOL confirm/reject routes to work-inbox API"
```

---

## Task 4: Expose `item_type` on `PendingTask` (backend)

**Files:**
- Modify: `backend/src/modules/inbox/inbox.service.ts`

**Interfaces:**
- Produces: `PendingTask.item_type?: string`, populated for `source: "work_item"` rows — consumed by the frontend in Task 5.

- [ ] **Step 1: Write the failing test**

Check first whether a test file for `getMyPending` / this mapping already exists:

```bash
grep -rln "getMyPending" backend/src/modules/inbox/__tests__/ 2>/dev/null
```

If one exists, add this case into it; otherwise create `backend/src/modules/inbox/__tests__/inbox.service.workitem-mapping.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));
vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: async () => ({ roleKeys: ["manager"], primaryRole: "manager" }),
}));
vi.mock("../../work-inbox/work-inbox.service.js", () => ({
  getDerivedRegistryItems: async () => [],
}));

import { getMyPending } from "../inbox.service.js";

describe("getMyPending — work_item mapping carries item_type", () => {
  beforeEach(() => mockExecute.mockReset());

  it("includes item_type on a work_item-sourced PendingTask", async () => {
    // tat rows, inbox rows, then work_item rows, matching the three sequential
    // db.execute calls inside getMyPending's Promise chain for these sources.
    mockExecute
      .mockResolvedValueOnce([[]]) // tat
      .mockResolvedValueOnce([[]]) // work_inbox_item
      .mockResolvedValueOnce([
        [
          {
            id: "wi-1",
            module: "attendance",
            item_type: "AWOL_SUSPECTED",
            title: "Confirm absconding: Jane Doe",
            entity_type: "employee",
            entity_id: "emp-1",
            priority: "high",
            due_at: null,
            created_at: new Date().toISOString(),
          },
        ],
      ]); // work_item

    const items = await getMyPending("user-1");
    const awolItem = items.find((i) => i.id === "wi-1");
    expect(awolItem?.item_type).toBe("AWOL_SUSPECTED");
  });
});
```

Read `backend/src/modules/inbox/inbox.service.ts`'s `getMyPending` function signature and the exact order of its `db.execute` calls before finalizing this test's mock sequence — the three `mockResolvedValueOnce` calls above must match whatever order that function actually awaits `tatRows`, `inboxRows`, `workItemRows` in; adjust the test to match reality rather than assuming this exact order.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/inbox/__tests__/inbox.service.workitem-mapping.test.ts`
Expected: FAIL — `awolItem?.item_type` is `undefined`.

- [ ] **Step 3: Add the field**

In `backend/src/modules/inbox/inbox.service.ts`, find the `PendingTask` type declaration (around line 334, `source: "tat" | "inbox" | "work_item" | "derived";`) and add:

```typescript
  item_type?: string;
```

Then find the `work_item` rows mapping (around line 646-668, `...(workItemRows as RowDataPacket[]).map((row): PendingTask => {`) and add this line inside the returned object, alongside `entity_type`:

```typescript
        item_type: row.item_type ? String(row.item_type) : undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/inbox/__tests__/inbox.service.workitem-mapping.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full inbox test suite to check for regressions**

Run: `cd backend && npx vitest run src/modules/inbox/`
Expected: All existing tests still PASS — this change only adds a field, it does not alter any existing field.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/inbox/inbox.service.ts backend/src/modules/inbox/__tests__/
git commit -m "feat: expose item_type on work_item-sourced PendingTask rows"
```

---

## Task 5: Frontend — Confirm Absconding / Not Absconding action

**Files:**
- Modify: `src/pages/NativeWorkInbox.tsx`

**Interfaces:**
- Consumes: `GET /api/work-inbox/:id/awol-context`, `POST /api/work-inbox/:id/awol/confirm`, `POST /api/work-inbox/:id/awol/reject` from Task 3; `item_type` field from Task 4.
- Produces: nothing consumed elsewhere — this is the leaf UI.

- [ ] **Step 1: Add `item_type` to the frontend `PendingTask` interface**

In `src/pages/NativeWorkInbox.tsx`, find the `PendingTask` interface (line 22):

```typescript
interface PendingTask {
  id: string;
  source: "tat" | "inbox" | "work_item" | "derived";
  module: string;
  title: string;
  description?: string;
  entity_type?: string;
  entity_id?: string;
```

Add `item_type?: string;` directly after `entity_id?: string;`.

- [ ] **Step 2: Add local state and data fetching for the AWOL context, inside `ActionSheet`**

In `ActionSheet` (line 494), add new state right after the existing `const [recordError, setRecordError] = useState("");` (line 512):

```typescript
  const isAwolSuspected = task?.source === "work_item" && task?.item_type === "AWOL_SUSPECTED";
  const [awolLastWorkedDate, setAwolLastWorkedDate] = useState("");
  const [awolLoading, setAwolLoading] = useState(false);
  const [awolActing, setAwolActing] = useState<"confirm" | "reject" | null>(null);
```

Extend the existing `useEffect` that runs on `task` change (line 515-543) — add this block right after the existing `if (!task?.entity_type || !task?.entity_id) return;` line, before the timeline fetch, so it only runs for an AWOL item:

```typescript
    if (task.source === "work_item" && task.item_type === "AWOL_SUSPECTED") {
      setAwolLoading(true);
      hrmsApi
        .get<{ success: boolean; data: { lastWorkedDate: string | null } }>(
          `/api/work-inbox/${task.id}/awol-context`,
        )
        .then((r) => setAwolLastWorkedDate(r.data?.lastWorkedDate ?? ""))
        .catch(() => setAwolLastWorkedDate(""))
        .finally(() => setAwolLoading(false));
    }
```

Also reset `setAwolLastWorkedDate("")` alongside the existing `setRemarks("")` / `setFullRecord(null)` resets at the top of that effect.

- [ ] **Step 3: Add confirm/reject handlers**

Add these two functions inside `ActionSheet`, after the existing `handleDecide` function (line 557-572):

```typescript
  const handleAwolConfirm = async () => {
    if (!task || !awolLastWorkedDate) return;
    setAwolActing("confirm");
    try {
      await hrmsApi.post(`/api/work-inbox/${task.id}/awol/confirm`, {
        lastWorkedDate: awolLastWorkedDate,
        remarks: remarks || undefined,
      });
      await onComplete(task.id, remarks);
      setRemarks("");
      onClose();
    } catch (err) {
      import("sonner").then(({ toast }) => {
        toast.error(err instanceof Error ? err.message : "Could not confirm absconding.");
      });
    } finally {
      setAwolActing(null);
    }
  };

  const handleAwolReject = async () => {
    if (!task || !remarks.trim()) return;
    setAwolActing("reject");
    try {
      await hrmsApi.post(`/api/work-inbox/${task.id}/awol/reject`, { remarks });
      await onComplete(task.id, remarks);
      setRemarks("");
      onClose();
    } catch (err) {
      import("sonner").then(({ toast }) => {
        toast.error(err instanceof Error ? err.message : "Could not dismiss this item.");
      });
    } finally {
      setAwolActing(null);
    }
  };
```

`handleAwolConfirm`/`handleAwolReject` call `onComplete(task.id, remarks)` after the awol-specific POST succeeds only to run the existing `recordActed` bookkeeping (removing the item from the list, updating summary counts) via the same code path other completions use — but `onComplete` (`completeTask` in the parent) would ALSO call `/api/work-inbox/:id/complete` a second time redundantly since the awol/confirm and awol/reject endpoints already completed the work item server-side. Fix this before wiring the buttons: in the parent's `completeTask` function (`src/pages/NativeWorkInbox.tsx` around line 1268-1291), add a branch so a `work_item` task whose `item_type` is `AWOL_SUSPECTED` skips the duplicate POST:

```typescript
      if (task.source === "tat") {
        await hrmsApi.post(`/api/governance/tat/tasks/${id}/complete`, { remarks: remarks || undefined });
      } else if (task.source === "work_item" && task.item_type === "AWOL_SUSPECTED") {
        // Already completed server-side by /awol/confirm or /awol/reject — this call only
        // needs to run the shared recordActed bookkeeping below, not hit the API again.
      } else if (task.source === "work_item") {
        await hrmsApi.post(`/api/work-inbox/${id}/complete`, { remarks: remarks || undefined });
      } else if (task.source === "derived") {
```

- [ ] **Step 4: Add the Confirm/Reject UI branch**

In the button row at the bottom of `ActionSheet` (line 683-724), the existing structure is `{task.source === "derived" ? (<Approve/Reject>) : (<Act & Close>)}`. Change this to a three-way branch — replace that whole ternary with:

```tsx
            {isAwolSuspected ? (
              <div className="flex w-full flex-col gap-3">
                <div>
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Last date actually worked
                  </p>
                  <input
                    type="date"
                    value={awolLastWorkedDate}
                    onChange={(e) => setAwolLastWorkedDate(e.target.value)}
                    disabled={awolLoading}
                    className="w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  {awolLoading && <p className="mt-1 text-[10px] text-slate-400">Checking attendance…</p>}
                  {!awolLoading && !awolLastWorkedDate && (
                    <p className="mt-1 text-[10px] text-amber-700">
                      No attendance on record — confirm only if you know the last day worked.
                    </p>
                  )}
                </div>
                <div className="flex gap-3">
                  <Button
                    size="sm"
                    onClick={() => void handleAwolReject()}
                    disabled={awolActing !== null || !remarks.trim()}
                    variant="outline"
                    className="flex-1 gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
                  >
                    {awolActing === "reject" ? <Loader className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                    Not Absconding
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleAwolConfirm()}
                    disabled={awolActing !== null || !awolLastWorkedDate}
                    className="flex-1 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {awolActing === "confirm" ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Confirm Absconding
                  </Button>
                </div>
              </div>
            ) : task.source === "derived" ? (
              <>
                <Button
                  size="sm"
                  onClick={() => void handleDecide("reject")}
                  disabled={decidingAs !== null || !remarks.trim()}
                  variant="outline"
                  className="flex-1 gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
                >
                  {decidingAs === "reject" ? <Loader className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleDecide("approve")}
                  disabled={decidingAs !== null}
                  className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {decidingAs === "approve" ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={handleAct}
                disabled={acting}
                className="flex-1 gap-1.5 bg-slate-950 hover:bg-slate-800 text-white"
              >
                {acting ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Act & Close
              </Button>
            )}
```

Note "Not Absconding" requires `remarks.trim()` (reusing the existing Remarks textarea above, already rendered for non-derived sources), matching the reject-requires-a-reason pattern the derived branch already uses.

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev` (from the repo root) and start the backend (`cd backend && npm run dev`, or however this project's dev backend is normally started — check `package.json` scripts first).

Log in as a user with an `AWOL_SUSPECTED` work item (or seed one manually against a local/sandbox database — never against production — by inserting a row into `attendance_daily_record` for a test employee with 7 consecutive `absent` days and running `runAwolDetectionScan()`). Open the Work Inbox, click the item, verify:
- The last-worked-date field pre-fills from the API.
- "Not Absconding" is disabled until remarks are entered, and on submit removes the item from the list.
- "Confirm Absconding" is disabled until a date is present, and on submit removes the item and creates a new exit request (verify via the Exit Management page or `SELECT * FROM exit_request WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1`).

- [ ] **Step 6: Commit**

```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat: add Confirm Absconding / Not Absconding action to the AWOL work item"
```

---

## Task 6: 4-hour repeat reminders for overdue IT-provisioning tasks

**Design note (departs from the spec's original wording):** The spec said to build this on `tat-escalation.worker.ts` (the generic TAT engine). Investigation during planning found that IT-provisioning tasks are NOT `task_tat_instance` rows at all — they live in their own table, `it_provisioning_request`, with their own `sla_due_at` and their own existing overdue-notification function, `notifyOverdueProvisioning()` in `backend/src/modules/it-provisioning/it-provisioning.service.ts`, polled hourly by `it-provisioning.cron.ts`. That function already sends exactly one notification per request, ever, via a fixed dedupe key (`it_provisioning_request:<id>:overdue`) against the `notification_dispatch_claim` table's `UNIQUE KEY (event_code, dedupe_key)`. The correct, minimal fix is a 4-hour bucket suffix on that key — this is far smaller and safer than wiring a second module's tasks into the shared TAT engine, and produces the same observable behavior (a fresh reminder every 4 hours while the task stays overdue, silence once it's actioned/waived, since the underlying query already filters to `status IN ('pending','pending_unassigned')`).

**Files:**
- Modify: `backend/src/modules/it-provisioning/it-provisioning.service.ts`
- Test: `backend/src/modules/it-provisioning/__tests__/it-provisioning.service.test.ts` (check first whether `notifyOverdueProvisioning` already has tests in this file or elsewhere: `grep -rln "notifyOverdueProvisioning" backend/src/modules/it-provisioning/__tests__/`)

**Interfaces:**
- Produces: no new exported function — `notifyOverdueProvisioning`'s existing signature and return shape (`{ scanned, notified, skipped, remaining }`) are unchanged; only its internal `dedupeKey` computation changes.

- [ ] **Step 1: Write the failing test**

```typescript
// Add to backend/src/modules/it-provisioning/__tests__/it-provisioning.service.test.ts
// (create the file with this content if it doesn't exist yet)
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

const mockNotify = vi.fn().mockResolvedValue({ outcome: "shadow" });
vi.mock("../../communication/notification.gateway.js", () => ({
  notificationGateway: { notify: (...args: unknown[]) => mockNotify(...args) },
}));

import { notifyOverdueProvisioning } from "../it-provisioning.service.js";

describe("notifyOverdueProvisioning — 4-hour repeat dedupe key", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockNotify.mockClear();
  });

  it("suffixes the dedupe key with a 4-hour overdue bucket instead of a fixed key", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ floor: null }]]) // backfill floor lookup
      .mockResolvedValueOnce([
        [
          {
            id: "req-1",
            employee_id: "emp-1",
            task_code: "IT_EMAIL_DOMAIN_ASSET",
            assigned_role: "it",
            assigned_user_id: null,
            status: "pending",
            sla_due_at: new Date(),
            hours_overdue: 9, // bucket = floor(9 / 4) = 2
            employee_code: "MAS001",
            branch_id: "branch-1",
            employee_name: "Jane Doe",
            process_name: "Sales",
            reporting_manager_name: "Manager X",
          },
        ],
      ]); // overdue rows

    await notifyOverdueProvisioning();

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: "it_provisioning_request:req-1:overdue:2",
      }),
    );
  });

  it("uses bucket 0 for a task less than 4 hours overdue", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ floor: null }]])
      .mockResolvedValueOnce([
        [
          {
            id: "req-2",
            employee_id: "emp-2",
            task_code: "ADMIN_BIOMETRIC_ID_CARD",
            assigned_role: "admin",
            assigned_user_id: null,
            status: "pending",
            sla_due_at: new Date(),
            hours_overdue: 1,
            employee_code: "MAS002",
            branch_id: "branch-1",
            employee_name: "John Roe",
            process_name: "Sales",
            reporting_manager_name: "Manager X",
          },
        ],
      ]);

    await notifyOverdueProvisioning();

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "it_provisioning_request:req-2:overdue:0" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/it-provisioning/__tests__/it-provisioning.service.test.ts`
Expected: FAIL — actual call has `dedupeKey: "it_provisioning_request:req-1:overdue"` (no bucket suffix).

- [ ] **Step 3: Change the dedupe key**

In `backend/src/modules/it-provisioning/it-provisioning.service.ts`, inside `notifyOverdueProvisioning`'s `for (const req of batch)` loop (around line 941), change:

```typescript
        // One per request, ever. The cron rescans the same breached row every hour.
        dedupeKey: `it_provisioning_request:${req.id}:overdue`,
```

to:

```typescript
        // One per request per 4-hour overdue window, not once ever — the deck's requirement
        // is a repeating nag until the task closes, not a single flag. Bucketing hours_overdue
        // into 4-hour windows and folding the bucket into the dedupe key gives that for free
        // through the existing unique-dedupe machinery: a fresh bucket is a fresh key, so
        // notify() treats it as a new notification, while `status IN ('pending',
        // 'pending_unassigned')` in the query above still stops everything the moment the
        // task is actioned or waived. The cron polls hourly (it-provisioning.cron.ts), well
        // inside the 4-hour bucket width, so no bucket boundary is ever skipped.
        dedupeKey: `it_provisioning_request:${req.id}:overdue:${Math.floor(Number(req.hours_overdue ?? 0) / 4)}`,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/it-provisioning/__tests__/it-provisioning.service.test.ts`
Expected: PASS (2 new tests)

- [ ] **Step 5: Run the full it-provisioning test suite for regressions**

Run: `cd backend && npx vitest run src/modules/it-provisioning/`
Expected: All PASS — no other test asserts the old fixed dedupe key string.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/it-provisioning/it-provisioning.service.ts backend/src/modules/it-provisioning/__tests__/
git commit -m "feat: repeat overdue-provisioning reminders every 4 hours instead of once"
```

---

## Task 7: Additive migration for the BGV result column

**Files:**
- Create: `backend/sql/1842_it_provisioning_bgv_result_column.sql`
- Modify: `backend/src/db/runPendingMigrations.ts`
- Modify: `backend/sql/MIGRATION_MANIFEST.lock.json`
- Modify: `backend/sql/schema-snapshot.json`

- [ ] **Step 1: Write the migration**

```sql
-- 1842_it_provisioning_bgv_result_column.sql
--
-- Adds a nullable Red/Green result flag to it_provisioning_request, for the new
-- HR_BGV_INITIATION join task (backend/src/modules/it-provisioning/it-provisioning.service.ts's
-- JOIN_TASKS). The task's free-text completion note reuses the existing evidence_note
-- column — this migration only adds the structured result, which nothing existing reads or
-- writes, so it cannot change behavior for any of the other 4 task types.
--
-- Additive, idempotent. NOT EXECUTED against production (CLAUDE.md rule 4).

SET @col_exists = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'it_provisioning_request'
     AND COLUMN_NAME = 'bgv_result'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE it_provisioning_request
   ADD COLUMN bgv_result ENUM(''red'',''green'') NULL
     COMMENT ''HR_BGV_INITIATION task outcome only; NULL for every other task_code''
     AFTER evidence_note',
  'SELECT ''it_provisioning_request.bgv_result already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 1842_it_provisioning_bgv_result_column.sql complete' AS status;
```

Before finalizing, confirm `it_provisioning_request` actually has an `evidence_note` column at that exact name (used as the `AFTER` anchor) — run:

```bash
grep -n "evidence_note" backend/sql/schema-snapshot.json
```

If the snapshot has no entry for it (meaning it was added in a migration after the last snapshot refresh), drop the `AFTER evidence_note` clause and let the column append at the end of the table instead — do not guess at ordering against production schema you have not observed.

- [ ] **Step 2: Register the migration in the manifest**

In `backend/src/db/runPendingMigrations.ts`, find the end of the `MIGRATION_MANIFEST` array (it ends with the `"1841_ats_onboarding_request_created_at_index.sql"` entry per the most recent file) and add, following the exact same dated-comment style as the two entries immediately before it:

```typescript
  "1842_it_provisioning_bgv_result_column.sql", // Registered 2026-09-22. Adds nullable bgv_result ENUM('red','green') to it_provisioning_request for the new HR_BGV_INITIATION join task. Additive, idempotent, no effect on any existing task_code.
```

- [ ] **Step 3: Register the migration in the lock file**

In `backend/sql/MIGRATION_MANIFEST.lock.json`, add `"1842_it_provisioning_bgv_result_column.sql"` to the JSON array in the same alphabetically-ish position convention the file already uses near its end (immediately before or after neighboring `18xx`-prefixed entries — check the file's actual ordering convention first with `grep -n "^\s*\"18" backend/sql/MIGRATION_MANIFEST.lock.json` since the tail shown during planning was mid-list, not necessarily the true insertion point).

- [ ] **Step 4: Observe the real column and update the schema snapshot**

Per the project's established pattern (`scripts/snapshot-pending-kpi-studio.mjs`), the schema-snapshot entry must be OBSERVED from a real migration replay against a disposable database, not hand-typed. Run the migration against a local/sandbox MySQL instance (never production):

```bash
mysql -h <local-sandbox-host> -u <user> -p<password> <sandbox_db> < backend/sql/1842_it_provisioning_bgv_result_column.sql
mysql -h <local-sandbox-host> -u <user> -p<password> <sandbox_db> -e "SHOW COLUMNS FROM it_provisioning_request LIKE 'bgv_result';"
```

Take the exact output (`Field`, `Type`, `Null`, `Key`, `Default`, `Extra`) and add a matching entry for `it_provisioning_request.bgv_result` into `backend/sql/schema-snapshot.json`, following the exact structure of the neighboring `it_provisioning_request` column entries already in that file (read a few of them first with `grep -A 8 '"evidence_note"' backend/sql/schema-snapshot.json` to match the JSON shape exactly).

- [ ] **Step 5: Verify the pre-push schema guard passes**

Run: `cd backend && npm run test -- schema-column-refs` (or whatever the actual guard test command is — check `package.json` scripts or the pre-push hook script for the exact invocation first with `grep -rn "schema-column-refs" backend/package.json .husky/ 2>/dev/null`).
Expected: PASS — the new column reference in Task 8's code is now recognized.

- [ ] **Step 6: Commit**

```bash
git add backend/sql/1842_it_provisioning_bgv_result_column.sql backend/src/db/runPendingMigrations.ts backend/sql/MIGRATION_MANIFEST.lock.json backend/sql/schema-snapshot.json
git commit -m "feat: add additive bgv_result column for the HR BGV-initiation task"
```

---

## Task 8: New HR_BGV_INITIATION join-provisioning task

**Files:**
- Modify: `backend/src/modules/it-provisioning/it-provisioning.service.ts`
- Modify: `backend/src/modules/it-provisioning/it-provisioning.routes.ts`
- Test: `backend/src/modules/it-provisioning/__tests__/it-provisioning.service.test.ts` (same file as Task 6)

**Interfaces:**
- Consumes: the `bgv_result` column from Task 7.
- Produces: nothing new consumed elsewhere in this plan — this is the last backend leaf task.

- [ ] **Step 1: Write the failing test for the new task definition**

Add to `backend/src/modules/it-provisioning/__tests__/it-provisioning.service.test.ts` (same file as Task 6):

```typescript
describe("JOIN_TASKS includes HR_BGV_INITIATION", () => {
  it("dispatches 5 join tasks including the new BGV task, assigned to hr", async () => {
    // dispatchJoinProvisioningTasks is not directly unit-testable without a full DB mock of
    // every helper it calls, so this test instead re-imports the module and checks the
    // exported task list indirectly through its dispatch log shape. If JOIN_TASKS is not
    // exported, add `export` to it in it-provisioning.service.ts — it is currently a
    // module-private const with no existing test coverage, so exporting it is a safe,
    // additive, backward-compatible change purely for testability.
    const mod = await import("../it-provisioning.service.js");
    expect((mod as any).JOIN_TASKS).toBeDefined();
    const bgvTask = (mod as any).JOIN_TASKS.find((t: any) => t.taskCode === "HR_BGV_INITIATION");
    expect(bgvTask).toBeDefined();
    expect(bgvTask.assignedRole).toBe("hr");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/it-provisioning/__tests__/it-provisioning.service.test.ts -t "HR_BGV_INITIATION"`
Expected: FAIL — `JOIN_TASKS` is not exported and/or has no `HR_BGV_INITIATION` entry.

- [ ] **Step 3: Export `JOIN_TASKS` and add the new task**

In `backend/src/modules/it-provisioning/it-provisioning.service.ts`, change:

```typescript
const JOIN_TASKS: ProvisioningTask[] = [
```

to:

```typescript
export const JOIN_TASKS: ProvisioningTask[] = [
```

Then add this entry to the array, after the existing `APPOINTMENT_LETTER_ESIGN` entry:

```typescript
  {
    taskCode: 'HR_BGV_INITIATION',
    assignedRole: 'hr',
    actionUrl: '/provisioning/hr-bgv',
    titleFn: (name, code) => `HR Action: BGV initiation for ${name} [${code}]`,
    descFn: (name, code) =>
      `New employee ${name} (${code}) has an employee code. Please initiate background verification with the vendor and record the outcome (Red/Green) once received. This is separate from the candidate's own DigiLocker submission.`,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/it-provisioning/__tests__/it-provisioning.service.test.ts -t "HR_BGV_INITIATION"`
Expected: PASS

- [ ] **Step 5: Write the failing test for completion validation**

Add to the same test file:

```typescript
describe("persistStructuredFields — bgv_result", () => {
  // persistStructuredFields is not exported from it-provisioning.routes.ts today. This test
  // exercises it through the exported route handler instead — see the routes test file
  // pattern established in Task 3 (work-inbox.routes.test.ts) for how to mount just this
  // router and post to it directly, rather than re-testing private helpers.
  it("rejects completing HR_BGV_INITIATION without a red/green result", async () => {
    // Implementer: wire this against the real /tasks/:id/complete route the same way
    // work-inbox.routes.test.ts (Task 3) mounts a route under a minimal express() app,
    // mocking db.execute to return { task_code: 'HR_BGV_INITIATION', status: 'pending', locked: 0 }
    // for the initial SELECT, and asserting the response is a 400 when body.bgv_result is
    // absent, and a 200 with the value persisted when body.bgv_result is 'green' or 'red'.
  });
});
```

This step is intentionally a stub with implementer instructions rather than finished code: it-provisioning.routes.ts's `dispatchTaskCompletion`/`persistStructuredFields`/`getProvisioningRequest` chain touches several tables in sequence (see Step 6 below), so the realistic test here needs the same multi-call `db.execute` mock sequencing Task 3's route test established — write it against the actual call order once Step 6's code exists, rather than guessing the order now.

- [ ] **Step 6: Add `bgv_result` handling to `persistStructuredFields` and the complete route**

In `backend/src/modules/it-provisioning/it-provisioning.routes.ts`, inside `persistStructuredFields` (line 74), add after the existing field extraction lines:

```typescript
  const bgvResult = clean(body.bgv_result) || null;
  if (bgvResult && !["red", "green"].includes(bgvResult)) {
    throw Object.assign(new Error("bgv_result must be 'red' or 'green'"), { statusCode: 400 });
  }
```

Update the "only UPDATE if at least one structured field was sent" guard condition to also check `!bgvResult`:

```typescript
  if (!officialEmail && !domainAccount && !assetTag && !evidenceFileUrl && biometricDone == null && idCardDone == null && !bgvResult) return;
```

And add to the `sets`/`vals` construction:

```typescript
  if (bgvResult !== null) { sets.push('bgv_result = ?'); vals.push(bgvResult); }
```

Then, in the `/tasks/:id/complete` route handler (around line 391-455), after the existing `if (taskRow.locked) { ... }` guard and before the `await dispatchTaskCompletion(...)` call, add:

```typescript
  if (taskRow.task_code === 'HR_BGV_INITIATION' && !['red', 'green'].includes(clean(req.body.bgv_result))) {
    return res.status(400).json({ success: false, message: "bgv_result ('red' or 'green') is required to complete this task" });
  }
```

- [ ] **Step 7: Run the full it-provisioning test suite**

Run: `cd backend && npx vitest run src/modules/it-provisioning/`
Expected: All PASS, including the new tests from Steps 4 and (once filled in per Step 5's instructions) the completion-validation test.

- [ ] **Step 8: Manually verify against a local sandbox database**

Following the same local-sandbox pattern already established in this codebase for schema verification (never production): create a test employee, run through employee-code creation (or call `dispatchJoinProvisioningTasks` directly against the sandbox), confirm 5 `it_provisioning_request` rows are created including one with `task_code = 'HR_BGV_INITIATION'`, `assigned_role = 'hr'`. Then call `POST /api/it-provisioning/tasks/:id/complete` with `{ bgv_result: 'green', evidence_note: 'Vendor confirmed clean report, ref VEN-2026-441' }` and confirm the row updates with both fields set and `status = 'actioned'`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/it-provisioning/it-provisioning.service.ts backend/src/modules/it-provisioning/it-provisioning.routes.ts backend/src/modules/it-provisioning/__tests__/
git commit -m "feat: add HR_BGV_INITIATION join-provisioning task with red/green result"
```

---

## Task 9: Frontend — BGV task completion UI

**Files:**
- Modify: whichever page currently renders the IT-provisioning task queue for the `hr` role's other task (`APPOINTMENT_LETTER_ESIGN`, action URL `/provisioning/appointment-letter`) — locate it first, do not guess the path:

```bash
grep -rln "provisioning/appointment-letter\|APPOINTMENT_LETTER_ESIGN" src/pages src/components
```

- Create or modify (depending on what Step 1 finds): the HR BGV task view at route `/provisioning/hr-bgv`, matching whatever pattern the appointment-letter task view already uses (a dedicated page vs. a shared provisioning-queue component with a task-code switch).

**Interfaces:**
- Consumes: `POST /api/it-provisioning/tasks/:id/complete` with `{ bgv_result: "red" | "green", evidence_note: string }` from Task 8.

- [ ] **Step 1: Locate the existing HR task-completion pattern**

Run the grep above and read the resulting file(s) fully before writing any code — this task's shape (a dedicated page vs. a shared component) must match whatever the appointment-letter task already does, per the "follow existing patterns" rule. Do not invent a new pattern.

- [ ] **Step 2: Add the BGV task's completion form**

Whatever the existing pattern turns out to be, the new form needs exactly two inputs beyond what the shared queue view already provides:
- A `<Textarea>` bound to `evidence_note` (vendor correspondence reference — reuse the existing evidence-note input component if the appointment-letter view already has one, rather than building a new one).
- A two-option toggle bound to `bgv_result`, rendered as two buttons or a `<Select>` with values `"red"` / `"green"`, styled with the tone-color system already established in this codebase: `red` tone (`bg-[#fff0f1] text-[#dc2626] border-[#ffdadd]`) and `green` tone (`bg-[#eaf8ef] text-[#15803d] border-[#d7f0df]`) per the frozen design patterns, both shown as a compact pill/badge pair the user clicks to select — not a raw HTML `<select>`, to match the rest of the app's tone-badge visual language.

Disable the task's submit button until `bgv_result` has a value, mirroring the `evidenceUrl`/`providerReference` required-field pattern already used elsewhere in this module (`changeAppointmentStatus` in `it-provisioning.routes.ts` is the backend precedent; the frontend form for it, found in Step 1, is the UI precedent to mirror).

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev` and the backend dev server. Log in as an `hr`-role user, navigate to the BGV task queue, open a pending `HR_BGV_INITIATION` task, confirm the submit button is disabled with no result selected, select "Green", enter a note, submit, and confirm the task disappears from the pending queue (verify via `SELECT status, bgv_result FROM it_provisioning_request WHERE task_code = 'HR_BGV_INITIATION' ORDER BY created_at DESC LIMIT 1` against the sandbox database).

- [ ] **Step 4: Commit**

```bash
git add <files identified in Step 1 and modified in Step 2>
git commit -m "feat: add HR BGV-initiation task completion UI with red/green result"
```

---

## Self-Review Notes (for the implementer, not a separate task)

- **Spec coverage:** Part A (AWOL confirm) → Tasks 1-5. Part B (4-hour reminders) → Task 6, with a documented, deliberate departure from the spec's literal "wire into the TAT engine" wording once investigation showed IT-provisioning tasks don't live in the TAT engine's table at all — the observable behavior (repeat every 4h, stop on close) is preserved; only the mechanism changed, and more simply than the spec assumed. Part C (BGV ticket) → Tasks 7-9.
- **No placeholders except two explicitly flagged ones**, both because they depend on this codebase's actual test/file conventions that must be read at implementation time rather than guessed: Task 8 Step 5 (completion-validation test, depends on Task 3's established route-test pattern) and all of Task 9 (depends on locating the real existing HR task-completion UI first). Both carry explicit instructions for what to do once that information is in hand, not vague guidance.
- **Type consistency check:** `getAwolContext`/`confirmAwolAbsconding`/`rejectAwolSuspected` (Task 2) are called with matching signatures in Task 3's routes and Task 5's frontend fetch calls. `item_type` is spelled identically in Task 4 (backend `PendingTask`) and Task 5 (frontend `PendingTask`). `bgv_result` is spelled identically in Task 7 (migration column), Task 8 (backend validation), and Task 9 (frontend field name).
