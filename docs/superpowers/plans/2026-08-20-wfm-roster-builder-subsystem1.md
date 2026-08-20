# WFM Roster Builder (Subsystem 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give WFM a single page — `/wfm/roster-builder` — to build a week's roster for a process (tabular grid, filtered by date range/branch/employee, shift-catalog-based), bulk-upload it, and publish it, so that assignments become cycle-linked and flow into the existing (built-but-idle) review/acknowledge/manager-queue machinery.

**Architecture:** Thin new UI + thin new backend controller, both calling directly into existing, already-production-quality engines (`roster.governance.service.ts::createCycle`/`listCycles`, `roster.service.ts::assignEmployee`, the existing `POST /api/wfm/roster/publish-to-employees` handler, and the existing roster-import bulk-upload flow). Two small, explicit, additive changes to existing files (adding an optional `cycleId` param in two places) are the only edits to pre-existing logic; everything else is new files.

**Tech Stack:** Express + TypeScript (backend), React 18 + TypeScript + Vite + Tailwind + shadcn/Radix (frontend), MySQL via `mysql2`, Vitest for tests.

## Global Constraints

- No deletion or behavior change to any existing table, route, or page. All changes additive.
- Every roster-mutating write goes through `roster-lock-guard.ts` (already true for `assignEmployee`; do not bypass).
- Backend authorization mandatory; UI gating is not security (`CLAUDE.md`).
- Every state-changing action must be auditable — reuse `logSensitiveAction`/`logRosterChange` patterns already in the functions this plan calls; do not build a parallel audit path.
- New page is WFM-team-only: `requireRole('wfm','admin','super_admin')` on every new backend route, and `WFM_ROSTER_BUILDER` page code granted only to `wfm`/`admin`/`super_admin` in `role_page_access`.
- Do not touch `RosterImportPage.tsx` or `NativeWFMRoster.tsx`'s existing behavior — only add new files, plus the two additive backend changes called out explicitly below.
- Do not retrofit `cycle_id` onto the 412,032 pre-existing cycle-less rows (per `wfm.routes.ts:1105-1114`, already decided against).
- Push to `main` directly (no feature branches/PRs) once tests pass, per project convention — but only after explicit user approval to deploy, per `CLAUDE.md`'s "Claude Must Not Do Without Explicit Approval" gate. Committing to a local/main working tree during development is fine; each task ends with a commit.

---

## Task 1: Register the `WFM_ROSTER_BUILDER` page code

**Files:**
- Create: `backend/sql/1510_wfm_roster_builder_page.sql`
- Test: `backend/src/db/__tests__/migration-manifest-guard.test.ts` (existing test, run only — no edits)

**Interfaces:**
- Produces: page code string `"WFM_ROSTER_BUILDER"`, usable by `requireRole`/`WorkforcePageGate`/`useWorkforceAccess()` once seeded into `page_catalog` and `role_page_access`.

- [ ] **Step 1: Write the migration**

```sql
-- 1510_wfm_roster_builder_page.sql
-- Registers the new WFM Roster Builder page (tabular grid + bulk upload,
-- WFM-team-only) in the page catalog and grants it to wfm/admin/super_admin.

USE mas_hrms;

INSERT IGNORE INTO page_catalog (page_code, page_name, module, page_path, description) VALUES
('WFM_ROSTER_BUILDER', 'Roster Builder', 'WFM', '/wfm/roster-builder',
 'Build a process''s weekly roster in a filtered tabular grid or via bulk upload, then publish it for employee acknowledgement');

INSERT IGNORE INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
('wfm',         'WFM_ROSTER_BUILDER', 1, 1, 1, 0, 1),
('admin',       'WFM_ROSTER_BUILDER', 1, 1, 1, 1, 1),
('super_admin', 'WFM_ROSTER_BUILDER', 1, 1, 1, 1, 1);

SELECT '1510_wfm_roster_builder_page.sql applied successfully' AS migration_status;
```

- [ ] **Step 2: Register it in the migration manifest**

Find `MIGRATION_MANIFEST` (referenced by `backend/src/db/runPendingMigrations.ts:732` per the earlier survey) and add `1510_wfm_roster_builder_page.sql` to it, following the exact entry shape used by the migration immediately before it in that file (same array/object structure — read the file first, do not guess the shape).

- [ ] **Step 3: Run the manifest guard test**

Run: `cd backend && npx vitest run src/db/__tests__/migration-manifest-guard.test.ts`
Expected: PASS — `1510_wfm_roster_builder_page.sql` now appears in the manifest, so the "file exists but not in manifest" assertion no longer flags it.

- [ ] **Step 4: Commit**

```bash
git add backend/sql/1510_wfm_roster_builder_page.sql backend/src/db/runPendingMigrations.ts
git commit -m "feat(wfm): register WFM_ROSTER_BUILDER page code"
```

---

## Task 2: Add the route→page-code mapping and nav entry (frontend RBAC wiring)

**Files:**
- Modify: `src/lib/pageRoutePageCodes.ts`
- Modify: `src/components/layout/navConfig.tsx`

**Interfaces:**
- Consumes: page code `"WFM_ROSTER_BUILDER"` from Task 1.
- Produces: `/wfm/roster-builder` resolves to page code `WFM_ROSTER_BUILDER` via `ProtectedRoute`, and a nav link exists under "WFM & Roster".

- [ ] **Step 1: Add the route mapping**

In `src/lib/pageRoutePageCodes.ts`, next to the existing `"/wfm/roster-import": "WFM_ROSTER"`-style entries (see line ~196-198 for the pattern), add:

```typescript
"/wfm/roster-builder": "WFM_ROSTER_BUILDER",
```

- [ ] **Step 2: Add the nav entry**

In `src/components/layout/navConfig.tsx`, inside the "WFM & Roster" section (same array as the existing `Roster Import` entry at line ~202), add:

```typescript
{ label: "Roster Builder", href: "/wfm/roster-builder", icon: ic(CalendarDays), pageCode: "WFM_ROSTER_BUILDER", description: "Build and publish a process's weekly roster — grid or bulk upload" },
```

(`CalendarDays` is already imported in this file, used by the existing "Roster Workspace" entry — reuse the same import, do not add a duplicate.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/pageRoutePageCodes.ts src/components/layout/navConfig.tsx
git commit -m "feat(wfm): add roster builder route mapping and nav entry"
```

---

## Task 3: Additive `cycleId` on `roster.service.ts::assignEmployee`

**Files:**
- Modify: `backend/src/modules/wfm/roster.service.ts:20-35` (the `AssignInput` interface) and the INSERT block around lines 255-290
- Test: `backend/src/modules/wfm/__tests__/roster-service-assign-cycle-id.test.ts` (new)

**Interfaces:**
- Consumes: `rosterAssignmentColumns(conn)` from `./shift-scheduling.util.js` (already imported in this file) — returns `Set<string>` of live column names, already includes `"cycle_id"` since migration 228 is applied.
- Produces: `AssignInput` gains `cycleId?: string | null`; `assignEmployee(input, userId)` sets `wfm_roster_assignment.cycle_id` when provided, leaves it untouched (via `ON DUPLICATE KEY UPDATE`, which will NOT overwrite `cycle_id` unless included) when not — existing callers (the `/api/wfm/roster/assignments` route, `roster-generation.service.ts`) pass no `cycleId` and are unaffected.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/modules/wfm/__tests__/roster-service-assign-cycle-id.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const executeMock = vi.fn();
const getConnectionMock = vi.fn();

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: executeMock, getConnection: getConnectionMock },
}));

// withEmployeeRosterLock, rest-policy, and lock-guard helpers are exercised by
// existing tests for assignEmployee already — this test only asserts the new
// cycleId behavior, so those are mocked to their pass-through/no-op paths.
vi.mock("../roster-lock-guard.js", () => ({
  checkEmployeeDateNotLocked: vi.fn().mockResolvedValue({ blocked: false }),
}));
vi.mock("../rest-policy.service.js", () => ({
  isRestPolicyFeatureActive: vi.fn().mockResolvedValue(false),
}));
vi.mock("../roster-concurrency.util.js", () => ({
  withEmployeeRosterLock: (_employeeId: string, fn: (conn: unknown) => unknown) =>
    fn({ execute: executeMock }),
}));

import { rosterService } from "../roster.service.js";

describe("assignEmployee — additive cycleId", () => {
  beforeEach(() => {
    executeMock.mockReset();
    // rosterAssignmentColumns() probe: include cycle_id, exclude versioning cols for simplicity
    executeMock.mockResolvedValueOnce([[{ COLUMN_NAME: "cycle_id" }, { COLUMN_NAME: "id" }], undefined]);
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT
    executeMock.mockResolvedValueOnce([[{ id: "assignment-1", cycle_id: "cycle-1" }], undefined]); // SELECT back
  });

  it("writes cycle_id when provided", async () => {
    await rosterService.assignEmployee(
      { employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1" },
      "user-1"
    );
    const insertCall = executeMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO wfm_roster_assignment"));
    expect(insertCall).toBeTruthy();
    expect(String(insertCall![0])).toContain("cycle_id");
    expect(insertCall![1]).toContain("cycle-1");
  });

  it("omits cycle_id entirely when not provided (existing-caller regression guard)", async () => {
    await rosterService.assignEmployee(
      { employeeId: "emp-1", rosterDate: "2026-08-24" },
      "user-1"
    );
    const insertCall = executeMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO wfm_roster_assignment"));
    expect(String(insertCall![0])).not.toContain("cycle_id");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/roster-service-assign-cycle-id.test.ts`
Expected: FAIL — `cycleId` is not a recognized field on `AssignInput`/TypeScript compile error, or the INSERT never contains `cycle_id`.

- [ ] **Step 3: Add `cycleId` to `AssignInput`**

In `backend/src/modules/wfm/roster.service.ts`, in the `AssignInput` interface (currently lines 20-35):

```typescript
export interface AssignInput {
  employeeId: string;
  rosterDate: string;
  shiftId?: string | null;
  planId?: string | null;
  /** Additive (2026-08-20): FK weekly_roster_cycle.id. Only the new
   *  roster-builder write path sets this today; every other existing
   *  caller omits it and behavior is unchanged — cycle_id is simply never
   *  included in the INSERT/UPDATE column list when absent. */
  cycleId?: string | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
  branchName?: string | null;
  processName?: string | null;
  rosterStatus?: string;
  restOverrideReason?: string | null;
  restOverrideApprovedBy?: string | null;
}
```

- [ ] **Step 4: Thread `cycleId` into the INSERT, following the exact existing `hasShiftVersionId`/`hasScheduledMinutes` pattern**

Still in `roster.service.ts`, in `assignEmployee`, right after the existing block that builds `insertCols`/`placeholders`/`params`/`updateClauses` (the block reading `raCols`, `hasShiftVersionId`, `hasScheduledMinutes`), add:

```typescript
      if (input.cycleId) {
        insertCols.push("cycle_id");
        placeholders.push("?");
        params.push(input.cycleId);
        updateClauses.push("cycle_id = VALUES(cycle_id)");
      }
```

Place this immediately before the existing `await conn.execute(\`INSERT INTO wfm_roster_assignment ...\`)` call, after the `hasScheduledMinutes` block — so `cycle_id` only ever appears in the SQL when the caller actually supplied it, matching the existing conditional-column pattern already used for `shift_version_id`/`scheduled_minutes` in this exact function.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/roster-service-assign-cycle-id.test.ts`
Expected: PASS (both cases)

- [ ] **Step 6: Run the full existing `roster.service` test suite as a regression guard**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/roster-service-audit-log.test.ts`
Expected: PASS unchanged — confirms the additive change did not alter behavior for callers that don't pass `cycleId`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/wfm/roster.service.ts backend/src/modules/wfm/__tests__/roster-service-assign-cycle-id.test.ts
git commit -m "feat(wfm): add additive cycleId param to assignEmployee (roster builder prep)"
```

---

## Task 4: Additive `cycleId` on bulk-upload commit (`roster-import.service.ts::commitImportBatch`)

**Files:**
- Modify: `backend/src/modules/wfm/roster-import.service.ts:343-347` (signature) and the two INSERT statements at ~415-433
- Modify: `backend/src/modules/wfm/roster-import.routes.ts:141-159` (the `/commit` route, to accept and pass through `cycleId`)
- Test: `backend/src/modules/wfm/__tests__/roster-import-commit-cycle-id.test.ts` (new)

**Interfaces:**
- Consumes: nothing new — `cycleId` arrives as an optional body field on the existing `POST /:batchId/commit` route.
- Produces: `commitImportBatch(batchId, committedBy, options)` gains `options.cycleId?: string | null`; when present, both the `NEW`-mode and `UPDATE`-mode INSERT statements include `cycle_id` in their column list.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/modules/wfm/__tests__/roster-import-commit-cycle-id.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const executeMock = vi.fn();
const getConnectionMock = vi.fn();
const connExecuteMock = vi.fn();

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: executeMock,
    getConnection: getConnectionMock,
  },
}));

import { commitImportBatch } from "../roster-import.service.js";

describe("commitImportBatch — additive cycleId", () => {
  beforeEach(() => {
    executeMock.mockReset();
    connExecuteMock.mockReset();
    getConnectionMock.mockResolvedValue({
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
      execute: connExecuteMock,
    });
    // batch fetch: status READY, import_mode NEW, created_by != committedBy
    executeMock.mockResolvedValueOnce([[{ id: 1, status: "READY", import_mode: "NEW", created_by: "uploader-1" }], undefined]);
    executeMock.mockResolvedValueOnce([[{ cnt: 0 }], undefined]); // error count
    executeMock.mockResolvedValueOnce([[{ cnt: 0 }], undefined]); // warning count
    executeMock.mockResolvedValueOnce([[{ employee_id_raw: "emp-1", roster_date: "2026-08-24", normalized_type: "SHIFT" }], undefined]); // rows
    connExecuteMock.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT
    connExecuteMock.mockResolvedValueOnce([{}, undefined]); // batch status update
  });

  it("includes cycle_id in the insert when cycleId is passed", async () => {
    await commitImportBatch(1, "reviewer-1", { cycleId: "cycle-1" });
    const insertCall = connExecuteMock.mock.calls.find(([sql]) => String(sql).includes("INSERT"));
    expect(String(insertCall![0])).toContain("cycle_id");
    expect(insertCall![1]).toContain("cycle-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/roster-import-commit-cycle-id.test.ts`
Expected: FAIL — options.cycleId is not read anywhere, INSERT has no `cycle_id`.

- [ ] **Step 3: Update the signature and both INSERT statements**

In `backend/src/modules/wfm/roster-import.service.ts`:

```typescript
export async function commitImportBatch(
  batchId: number,
  committedBy: string,
  options: { overrideWarnings?: boolean; cycleId?: string | null }
): Promise<CommitResult> {
```

Replace the `NEW`-mode INSERT (currently):

```typescript
        const [result] = await conn.execute(
          `INSERT IGNORE INTO wfm_roster_assignment
             (id, employee_id, roster_date, assignment_type, lifecycle_state, import_batch_id, created_at)
           VALUES (UUID(), ?, ?, ?, 'DRAFT', ?, NOW())`,
          [row.employee_id_raw, row.roster_date, row.normalized_type, batchId]
        );
```

with:

```typescript
        const [result] = options.cycleId
          ? await conn.execute(
              `INSERT IGNORE INTO wfm_roster_assignment
                 (id, employee_id, roster_date, assignment_type, lifecycle_state, import_batch_id, cycle_id, created_at)
               VALUES (UUID(), ?, ?, ?, 'DRAFT', ?, ?, NOW())`,
              [row.employee_id_raw, row.roster_date, row.normalized_type, batchId, options.cycleId]
            )
          : await conn.execute(
              `INSERT IGNORE INTO wfm_roster_assignment
                 (id, employee_id, roster_date, assignment_type, lifecycle_state, import_batch_id, created_at)
               VALUES (UUID(), ?, ?, ?, 'DRAFT', ?, NOW())`,
              [row.employee_id_raw, row.roster_date, row.normalized_type, batchId]
            );
```

Apply the identical `options.cycleId ? ... : ...` split to the `UPDATE`-mode INSERT immediately below it (same two-branch structure, `cycle_id = VALUES(cycle_id)` added to the `ON DUPLICATE KEY UPDATE` clause in the `cycleId`-present branch only).

- [ ] **Step 4: Thread `cycleId` through the route**

In `backend/src/modules/wfm/roster-import.routes.ts`, in the `/:batchId/commit` handler (lines 141-159):

```typescript
      const { overrideWarnings, cycleId } = req.body;
      const result = await commitImportBatch(batchId, committedBy, { overrideWarnings, cycleId });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/roster-import-commit-cycle-id.test.ts`
Expected: PASS

- [ ] **Step 6: Run existing commit tests as a regression guard**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/roster-import-commit.test.ts`
Expected: PASS unchanged (no `cycleId` passed by any existing test/caller → the `else` branch, byte-identical SQL to before).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/wfm/roster-import.service.ts backend/src/modules/wfm/roster-import.routes.ts backend/src/modules/wfm/__tests__/roster-import-commit-cycle-id.test.ts
git commit -m "feat(wfm): add additive cycleId param to bulk-upload commit (roster builder prep)"
```

---

## Task 5: New backend route — `GET /api/wfm/roster-builder/grid`

**Files:**
- Create: `backend/src/modules/wfm/roster-builder.routes.ts`
- Create: `backend/src/modules/wfm/roster-builder.service.ts`
- Test: `backend/src/modules/wfm/__tests__/roster-builder-grid.test.ts`

**Interfaces:**
- Consumes: `db` from `../../db/mysql.js`.
- Produces: `getRosterGrid(filters): Promise<GridRow[]>` where `GridRow = { employeeId: string; employeeName: string; rosterDate: string; assignmentId: string | null; shiftTemplateId: string | null; shiftTemplateName: string | null; isWeekOff: boolean; finalRosterStatus: string | null }`. Route: `GET /api/wfm/roster-builder/grid?cycleId=&branchId=&employeeSearch=`.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/modules/wfm/__tests__/roster-builder-grid.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const executeMock = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: executeMock } }));

import { getRosterGrid } from "../roster-builder.service.js";

describe("getRosterGrid", () => {
  beforeEach(() => executeMock.mockReset());

  it("returns rows joined with employee and shift template names, filtered by cycleId", async () => {
    executeMock.mockResolvedValueOnce([
      [{
        employee_id: "emp-1", employee_name: "Jane Doe", roster_date: "2026-08-24",
        assignment_id: "assign-1", shift_template_id: "shift-1", shift_template_name: "Day 09-18",
        is_week_off: 0, final_roster_status: "generated",
      }],
      undefined,
    ]);

    const rows = await getRosterGrid({ cycleId: "cycle-1" });

    expect(rows).toEqual([{
      employeeId: "emp-1", employeeName: "Jane Doe", rosterDate: "2026-08-24",
      assignmentId: "assign-1", shiftTemplateId: "shift-1", shiftTemplateName: "Day 09-18",
      isWeekOff: false, finalRosterStatus: "generated",
    }]);
    const [sql, params] = executeMock.mock.calls[0];
    expect(String(sql)).toContain("wra.cycle_id = ?");
    expect(params).toContain("cycle-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/roster-builder-grid.test.ts`
Expected: FAIL — `roster-builder.service.js` does not exist.

- [ ] **Step 3: Implement `roster-builder.service.ts`**

```typescript
// backend/src/modules/wfm/roster-builder.service.ts
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface GridRow {
  employeeId: string;
  employeeName: string;
  rosterDate: string;
  assignmentId: string | null;
  shiftTemplateId: string | null;
  shiftTemplateName: string | null;
  isWeekOff: boolean;
  finalRosterStatus: string | null;
}

export interface GridFilters {
  cycleId: string;
  branchId?: string;
  employeeSearch?: string;
}

export async function getRosterGrid(filters: GridFilters): Promise<GridRow[]> {
  const conds: string[] = ["wra.cycle_id = ?"];
  const params: unknown[] = [filters.cycleId];

  if (filters.branchId) {
    conds.push("e.branch_id = ?");
    params.push(filters.branchId);
  }
  if (filters.employeeSearch) {
    conds.push("(e.full_name LIKE ? OR e.employee_code LIKE ?)");
    const like = `%${filters.employeeSearch}%`;
    params.push(like, like);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       wra.employee_id        AS employee_id,
       e.full_name            AS employee_name,
       wra.roster_date        AS roster_date,
       wra.id                 AS assignment_id,
       wra.shift_template_id  AS shift_template_id,
       st.shift_name          AS shift_template_name,
       wra.is_week_off        AS is_week_off,
       wra.final_roster_status AS final_roster_status
     FROM wfm_roster_assignment wra
     JOIN employees e ON e.id = wra.employee_id
     LEFT JOIN wfm_shift_template st ON st.id = wra.shift_template_id
     WHERE ${conds.join(" AND ")}
     ORDER BY e.full_name, wra.roster_date`,
    params
  );

  return (rows as RowDataPacket[]).map((r) => ({
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    rosterDate: String(r.roster_date),
    assignmentId: r.assignment_id ? String(r.assignment_id) : null,
    shiftTemplateId: r.shift_template_id ? String(r.shift_template_id) : null,
    shiftTemplateName: r.shift_template_name ? String(r.shift_template_name) : null,
    isWeekOff: Number(r.is_week_off) === 1,
    finalRosterStatus: r.final_roster_status ? String(r.final_roster_status) : null,
  }));
}
```

> Note: `e.full_name` and `e.employee_code` are the column names used elsewhere in this codebase for the employee display name/code (matching the pattern already used in `wfm.routes.ts`'s `GET /manager/weekoff-review` join at line ~1181). Before running Step 5, `grep -n "full_name\|employee_code" backend/sql/002_employees.sql` to confirm these exact column names against the live schema and adjust if they differ — do not assume without checking, per this codebase's phantom-column-sweep convention.

- [ ] **Step 4: Create the route file**

```typescript
// backend/src/modules/wfm/roster-builder.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getRosterGrid } from "./roster-builder.service.js";

const WFM_ROLES = ["wfm", "admin", "super_admin"];

export const rosterBuilderRouter = Router();
rosterBuilderRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

rosterBuilderRouter.get(
  "/grid",
  requireRole(...WFM_ROLES),
  h(async (req, res) => {
    const cycleId = String(req.query.cycleId ?? "").trim();
    if (!cycleId) {
      res.status(400).json({ error: "cycleId is required" });
      return;
    }
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const employeeSearch = req.query.employeeSearch ? String(req.query.employeeSearch) : undefined;
    const rows = await getRosterGrid({ cycleId, branchId, employeeSearch });
    res.json({ rows });
  })
);
```

- [ ] **Step 5: Mount the router**

In `backend/src/app.ts`, next to the existing `app.use("/api/wfm/roster-imports", rosterImportRouter);` line (~578), add:

```typescript
import { rosterBuilderRouter } from "./modules/wfm/roster-builder.routes.js";
// ...
app.use("/api/wfm/roster-builder", rosterBuilderRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/roster-builder-grid.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/wfm/roster-builder.routes.ts backend/src/modules/wfm/roster-builder.service.ts backend/src/modules/wfm/__tests__/roster-builder-grid.test.ts backend/src/app.ts
git commit -m "feat(wfm): add roster builder grid read endpoint"
```

---

## Task 6: New backend route — `POST /api/wfm/roster-builder/assign`

**Files:**
- Modify: `backend/src/modules/wfm/roster-builder.routes.ts` (add route)
- Test: `backend/src/modules/wfm/__tests__/roster-builder-assign.test.ts`

**Interfaces:**
- Consumes: `rosterService.assignEmployee(input: AssignInput, userId: string)` from Task 3 (now accepts `cycleId`).
- Produces: `POST /api/wfm/roster-builder/assign` — body `{ employeeId, rosterDate, cycleId, shiftTemplateId? }`, response `{ success: true, data }` (201) or the same error shapes `assignEmployee` already throws (409 locked, 422 insufficient rest), matching Task 3's contract exactly.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/modules/wfm/__tests__/roster-builder-assign.test.ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

const assignEmployeeMock = vi.fn().mockResolvedValue({ id: "assign-1" });
vi.mock("../roster.service.js", () => ({ rosterService: { assignEmployee: assignEmployeeMock } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "user-1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

import { rosterBuilderRouter } from "../roster-builder.routes.js";

describe("POST /assign", () => {
  it("calls assignEmployee with cycleId threaded through", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/wfm/roster-builder", rosterBuilderRouter);

    const res = await request(app)
      .post("/api/wfm/roster-builder/assign")
      .send({ employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1", shiftTemplateId: "shift-1" });

    expect(res.status).toBe(201);
    expect(assignEmployeeMock).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1" }),
      "user-1"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/roster-builder-assign.test.ts`
Expected: FAIL — no `/assign` route registered (404).

- [ ] **Step 3: Add the route**

In `backend/src/modules/wfm/roster-builder.routes.ts`, add the import and route:

```typescript
import { rosterService } from "./roster.service.js";
```

```typescript
rosterBuilderRouter.post(
  "/assign",
  requireRole(...WFM_ROLES),
  h(async (req, res) => {
    const { employeeId, rosterDate, cycleId, shiftTemplateId } = req.body as {
      employeeId?: string; rosterDate?: string; cycleId?: string; shiftTemplateId?: string | null;
    };
    if (!employeeId || !rosterDate || !cycleId) {
      res.status(400).json({ error: "employeeId, rosterDate, and cycleId are required" });
      return;
    }
    const data = await rosterService.assignEmployee(
      { employeeId, rosterDate, cycleId, shiftId: shiftTemplateId ?? null },
      req.authUser!.id
    );
    res.status(201).json({ success: true, data });
  })
);
```

> Note: this passes `shiftTemplateId` through as `shiftId` on `AssignInput` — `assignEmployee` today writes that into the legacy `shift_id` column (FK `wfm_shift_master`), not `shift_template_id` (FK `wfm_shift_template`, migration 228). Since Task 3 only added `cycleId`, not a `shiftTemplateId`-to-`shift_template_id` write path, resolve this before shipping: either (a) confirm `wfm_shift_template` and `wfm_shift_master` rows share the same IDs in this deployment (unlikely — they're separate tables per the survey), or (b) extend Task 3's additive change to also accept and write `shiftTemplateId` into the `shift_template_id` column, following the identical conditional-column pattern already used for `cycle_id`. Verify which is true against the live DB (`SELECT COUNT(*) FROM wfm_shift_template`, `SELECT COUNT(*) FROM wfm_shift_master`, compare id overlap) before writing the grid's shift-picker (Task 8) — do not guess.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/roster-builder-assign.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/roster-builder.routes.ts backend/src/modules/wfm/__tests__/roster-builder-assign.test.ts
git commit -m "feat(wfm): add roster builder assign endpoint"
```

---

## Task 7: Frontend page shell + cycle picker

**Files:**
- Create: `src/pages/wfm/RosterBuilderPage.tsx`
- Modify: `src/config/routes/workforce.routes.tsx` (add route)
- Test: `src/pages/wfm/__tests__/RosterBuilderPage.test.tsx`

**Interfaces:**
- Consumes: `GET /api/roster-gov/cycles?process_id=` and `POST /api/roster-gov/cycles` (existing, `roster.governance.routes.ts:171,183` — called directly, no new wrapper) — response shape `{ data: RosterCycle[] }` / `{ data: RosterCycle }` where `RosterCycle` includes at minimum `{ id, process_id, branch_id, week_start_date, week_end_date, status }`.
- Produces: selected `cycleId: string | null` in page state, passed down to the grid (Task 8) and bulk-upload panel (Task 9).

- [ ] **Step 1: Write the failing test**

```tsx
// src/pages/wfm/__tests__/RosterBuilderPage.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RosterBuilderPage from "../RosterBuilderPage";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as any;
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
});

describe("RosterBuilderPage", () => {
  it("creates a cycle when none exists for the selected process/week", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) }) // list: none found
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "cycle-1", status: "draft" } }) }); // create

    render(<RosterBuilderPage />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(/process/i), "process-1");
    await user.click(screen.getByRole("button", { name: /start roster/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/roster-gov/cycles"), expect.objectContaining({ method: "POST" }));
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/wfm/__tests__/RosterBuilderPage.test.tsx`
Expected: FAIL — `RosterBuilderPage` does not exist.

- [ ] **Step 3: Implement the page shell**

```tsx
// src/pages/wfm/RosterBuilderPage.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface RosterCycle {
  id: string;
  process_id: string;
  branch_id: string | null;
  week_start_date: string;
  week_end_date: string;
  status: string;
}

// Minimal process picker — real implementation should reuse whatever
// process-select component NativeWFMRoster.tsx already uses (check that
// file for the exact component/hook before duplicating a fetch-processes
// call here).
function useProcessOptions() {
  return useQuery({
    queryKey: ["roster-builder", "processes"],
    queryFn: async () => {
      const res = await fetch("/api/wfm/processes"); // verify this exact endpoint against NativeWFMRoster.tsx before shipping
      const json = await res.json();
      return json.data as Array<{ id: string; name: string; costCentreName: string | null }>;
    },
  });
}

export default function RosterBuilderPage() {
  const [processId, setProcessId] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [cycleId, setCycleId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: processes } = useProcessOptions();

  const findCycle = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/roster-gov/cycles?process_id=${processId}`);
      const json = await res.json();
      const existing = (json.data as RosterCycle[]).find((c) => c.week_start_date === weekStart);
      if (existing) return existing;
      const createRes = await fetch("/api/roster-gov/cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ process_id: processId, week_start_date: weekStart, week_end_date: weekEnd }),
      });
      const createJson = await createRes.json();
      return createJson.data as RosterCycle;
    },
    onSuccess: (cycle) => {
      setCycleId(cycle.id);
      queryClient.invalidateQueries({ queryKey: ["roster-builder", "grid"] });
    },
  });

  return (
    <div className="flex flex-col h-screen">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4 shrink-0">
        <h1 className="text-2xl font-black">Roster Builder</h1>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs font-bold uppercase tracking-wider text-slate-600">
            Process
            <select aria-label="Process" value={processId} onChange={(e) => setProcessId(e.target.value)} className="mt-1 rounded-xl border border-slate-200 p-2">
              <option value="">Select a process</option>
              {processes?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.costCentreName ? ` (${p.costCentreName})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs font-bold uppercase tracking-wider text-slate-600">
            Week start
            <input aria-label="Week start" type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="mt-1 rounded-xl border border-slate-200 p-2" />
          </label>
          <label className="flex flex-col text-xs font-bold uppercase tracking-wider text-slate-600">
            Week end
            <input aria-label="Week end" type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} className="mt-1 rounded-xl border border-slate-200 p-2" />
          </label>
          <button
            type="button"
            disabled={!processId || !weekStart || !weekEnd || findCycle.isPending}
            onClick={() => findCycle.mutate()}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            Start roster
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-5">
        {!cycleId ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <h3 className="text-base font-bold text-slate-700">No roster started yet</h3>
            <p className="mt-1 text-sm text-slate-500">Select a process and week above, then click Start roster.</p>
          </div>
        ) : (
          <div data-testid="roster-builder-grid-placeholder">Cycle {cycleId} ready — grid and bulk upload load here (Tasks 8-9).</div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Add the route**

In `src/config/routes/workforce.routes.tsx`, add the lazy import next to `RosterImportPage`'s and a route entry:

```typescript
const RosterBuilderPage = lazy(() => import("@/pages/wfm/RosterBuilderPage"));
```

```tsx
<Route path="/wfm/roster-builder" element={
  <ProtectedRoute>
    <Gate pageCode="WFM_ROSTER_BUILDER">
      <DashboardLayout><RosterBuilderPage /></DashboardLayout>
    </Gate>
  </ProtectedRoute>
} />
```

(Match the exact `<Route>` wrapping pattern of the existing `/wfm/roster-import` route in this file — read it first and mirror its structure precisely rather than guessing `DashboardLayout` placement.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/pages/wfm/__tests__/RosterBuilderPage.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/pages/wfm/RosterBuilderPage.tsx src/config/routes/workforce.routes.tsx src/pages/wfm/__tests__/RosterBuilderPage.test.tsx
git commit -m "feat(wfm): add roster builder page shell with cycle picker"
```

---

## Task 8: `RosterPivotGrid` component (grid mode) and shift-template picker

**Files:**
- Create: `src/components/wfm/RosterPivotGrid.tsx`
- Modify: `src/pages/wfm/RosterBuilderPage.tsx` (render the grid once `cycleId` is set)
- Test: `src/components/wfm/__tests__/RosterPivotGrid.test.tsx`

**Interfaces:**
- Consumes: `GET /api/wfm/roster-builder/grid?cycleId=` (Task 5) and `POST /api/wfm/roster-builder/assign` (Task 6).
- Produces: `<RosterPivotGrid cycleId={string} branchId={string|undefined} employeeSearch={string|undefined} />`, self-contained (owns its own data fetching/mutation via `@tanstack/react-query`), calling `onAssigned?: () => void` after a successful cell write so the parent can invalidate any dependent query.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/wfm/__tests__/RosterPivotGrid.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RosterPivotGrid from "../RosterPivotGrid";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as any;
});

describe("RosterPivotGrid", () => {
  it("renders employee rows from the grid endpoint", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [{ employeeId: "emp-1", employeeName: "Jane Doe", rosterDate: "2026-08-24", assignmentId: null, shiftTemplateId: null, shiftTemplateName: null, isWeekOff: false, finalRosterStatus: null }],
      }),
    });

    render(<RosterPivotGrid cycleId="cycle-1" />);

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/wfm/roster-builder/grid?cycleId=cycle-1"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/wfm/__tests__/RosterPivotGrid.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement `RosterPivotGrid`**

```tsx
// src/components/wfm/RosterPivotGrid.tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface GridRow {
  employeeId: string;
  employeeName: string;
  rosterDate: string;
  assignmentId: string | null;
  shiftTemplateId: string | null;
  shiftTemplateName: string | null;
  isWeekOff: boolean;
  finalRosterStatus: string | null;
}

interface Props {
  cycleId: string;
  branchId?: string;
  employeeSearch?: string;
  onAssigned?: () => void;
}

export default function RosterPivotGrid({ cycleId, branchId, employeeSearch, onAssigned }: Props) {
  const queryClient = useQueryClient();
  const params = new URLSearchParams({ cycleId });
  if (branchId) params.set("branchId", branchId);
  if (employeeSearch) params.set("employeeSearch", employeeSearch);

  const { data, isLoading } = useQuery({
    queryKey: ["roster-builder", "grid", cycleId, branchId, employeeSearch],
    queryFn: async () => {
      const res = await fetch(`/api/wfm/roster-builder/grid?${params.toString()}`);
      const json = await res.json();
      return json.rows as GridRow[];
    },
  });

  const assign = useMutation({
    mutationFn: async (input: { employeeId: string; rosterDate: string; shiftTemplateId: string }) => {
      const res = await fetch("/api/wfm/roster-builder/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, cycleId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Assignment failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roster-builder", "grid", cycleId] });
      onAssigned?.();
    },
  });

  if (isLoading) {
    return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">Loading roster…</div>;
  }
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h3 className="text-base font-bold text-slate-700">No assignments yet</h3>
        <p className="mt-1 text-sm text-slate-500">Assign a shift below or use bulk upload.</p>
      </div>
    );
  }

  // Grouped by employee for the pivot layout (employee-rows x date-columns).
  const byEmployee = new Map<string, { name: string; rows: GridRow[] }>();
  for (const row of data) {
    const bucket = byEmployee.get(row.employeeId) ?? { name: row.employeeName, rows: [] };
    bucket.rows.push(row);
    byEmployee.set(row.employeeId, bucket);
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="min-w-full text-sm">
        <tbody>
          {Array.from(byEmployee.entries()).map(([employeeId, { name, rows }]) => (
            <tr key={employeeId} className="border-b border-slate-100">
              <td className="p-2 font-bold">{name}</td>
              {rows.map((row) => (
                <td
                  key={row.rosterDate}
                  className="p-2 cursor-pointer hover:bg-slate-50"
                  onClick={() => {
                    const shiftTemplateId = window.prompt(`Shift template ID for ${name} on ${row.rosterDate}`, row.shiftTemplateId ?? "");
                    if (shiftTemplateId) assign.mutate({ employeeId, rosterDate: row.rosterDate, shiftTemplateId });
                  }}
                >
                  {row.shiftTemplateName ?? (row.isWeekOff ? "WO" : "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

> Note: the cell click currently uses `window.prompt` as a placeholder interaction, explicitly called out (not silently shipped) because the real shift-template picker (a searchable dropdown sourced from `wfm_shift_template`) depends on resolving the `shiftTemplateId` vs `shift_id` question flagged in Task 6 Step 3 first — replacing `window.prompt` with a real `<ShiftTemplatePicker>` modal is a follow-up task once that's resolved, not part of this task's test-passing scope.

- [ ] **Step 4: Wire the grid into the page**

In `src/pages/wfm/RosterBuilderPage.tsx`, replace the `data-testid="roster-builder-grid-placeholder"` div with:

```tsx
<RosterPivotGrid cycleId={cycleId} />
```

(add `import RosterPivotGrid from "@/components/wfm/RosterPivotGrid";` at the top).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/wfm/__tests__/RosterPivotGrid.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/wfm/RosterPivotGrid.tsx src/pages/wfm/RosterBuilderPage.tsx src/components/wfm/__tests__/RosterPivotGrid.test.tsx
git commit -m "feat(wfm): add roster pivot grid component"
```

---

## Task 9: Bulk-upload mode (reuse `RosterImportPage`'s flow, cycle-linked)

**Files:**
- Modify: `src/pages/wfm/RosterBuilderPage.tsx` (add a mode toggle + link)

**Interfaces:**
- Consumes: nothing new on the frontend for this task's minimal scope.

- [ ] **Step 1: Add a mode toggle and a cycle-aware deep link to the existing import page**

Given `RosterImportPage.tsx` is not modified in this subsystem (per Global Constraints) and its own commit flow doesn't yet accept a `cycleId` query param, ship the minimal, honest version now rather than a half-wired one: a "Bulk upload" tab in `RosterBuilderPage.tsx` that links to `/wfm/roster-import?cycleId={cycleId}&processId={processId}`, with a visible note that the uploaded batch must be committed from that page. Add to `RosterBuilderPage.tsx`:

```tsx
<a
  href={`/wfm/roster-import?cycleId=${cycleId}&processId=${processId}`}
  className="mt-2 inline-block text-sm font-bold text-sky-600 underline"
>
  Bulk upload this week's roster instead →
</a>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/wfm/RosterBuilderPage.tsx
git commit -m "feat(wfm): link roster builder to bulk upload with cycle context"
```

> **Deferred, explicitly, not silently dropped:** fully embedding `RosterBulkUploadPanel` as a first-class tab inside `RosterBuilderPage.tsx` (reading the `cycleId`/`processId` query params on `RosterImportPage.tsx` and passing them into Task 4's now-cycle-aware `commitImportBatch` call) is real, scoped follow-up work — it touches `RosterImportPage.tsx` itself, which Global Constraints excludes from this subsystem's edits without separate sign-off. Flag this to the user as the next small task once this plan ships, rather than expanding this task's scope silently.

---

## Task 10: Publish button

**Files:**
- Modify: `src/pages/wfm/RosterBuilderPage.tsx`
- Test: extend `src/pages/wfm/__tests__/RosterBuilderPage.test.tsx`

**Interfaces:**
- Consumes: existing `POST /api/wfm/roster/publish-to-employees` (body `{ cycleId, ackDeadline? }`, `wfm.routes.ts` — called directly, no new backend wrapper).

- [ ] **Step 1: Write the failing test**

```tsx
// append to src/pages/wfm/__tests__/RosterBuilderPage.test.tsx
it("publishes the cycle to employees", async () => {
  fetchMock
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "cycle-1", process_id: "process-1", week_start_date: "2026-08-24", status: "draft" }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) }) // grid load
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { assignmentsPublished: 5, employeesNotified: 5 } }) });

  render(<RosterBuilderPage />);
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText(/process/i), "process-1");
  await user.type(screen.getByLabelText(/week start/i), "2026-08-24");
  await user.type(screen.getByLabelText(/week end/i), "2026-08-30");
  await user.click(screen.getByRole("button", { name: /start roster/i }));

  await user.click(await screen.findByRole("button", { name: /publish/i }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/wfm/roster/publish-to-employees",
      expect.objectContaining({ method: "POST" })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/wfm/__tests__/RosterBuilderPage.test.tsx`
Expected: FAIL — no Publish button exists.

- [ ] **Step 3: Add the Publish button and mutation**

In `src/pages/wfm/RosterBuilderPage.tsx`, add:

```tsx
const publish = useMutation({
  mutationFn: async () => {
    const res = await fetch("/api/wfm/roster/publish-to-employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cycleId }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Publish failed");
    return res.json();
  },
});
```

and, inside the `cycleId &&` branch of the render, above `<RosterPivotGrid .../>`:

```tsx
<button
  type="button"
  disabled={publish.isPending}
  onClick={() => publish.mutate()}
  className="mb-3 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
>
  Publish this week's roster
</button>
{publish.isSuccess && (
  <p className="mb-3 text-sm text-emerald-700">
    Published — {publish.data.data.assignmentsPublished} assignments, {publish.data.data.employeesNotified} employees notified.
  </p>
)}
{publish.isError && <p className="mb-3 text-sm text-rose-600">{(publish.error as Error).message}</p>}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/wfm/__tests__/RosterBuilderPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/wfm/RosterBuilderPage.tsx src/pages/wfm/__tests__/RosterBuilderPage.test.tsx
git commit -m "feat(wfm): add publish button to roster builder"
```

---

## Task 11: Full regression pass and self-review

- [ ] **Step 1: Run the full backend WFM test suite**

Run: `cd backend && npx vitest run src/modules/wfm src/modules/roster`
Expected: PASS, including all pre-existing tests (regression guard for Tasks 3-4's additive changes).

- [ ] **Step 2: Run the migration manifest guard, schema-column-refs, and route-contract structural guards**

Run: `cd backend && npx vitest run src/db/__tests__`
Expected: PASS — confirms `1510_wfm_roster_builder_page.sql` is registered (Task 1) and no new route/column drift was introduced.

- [ ] **Step 3: Run the frontend test suite for the new files**

Run: `npx vitest run src/pages/wfm/__tests__/RosterBuilderPage.test.tsx src/components/wfm/__tests__/RosterPivotGrid.test.tsx`
Expected: PASS

- [ ] **Step 4: Manual smoke check against a local/staging DB (not production) — WFM role**

Log in as a `wfm` role user, navigate to `/wfm/roster-builder`, select a process + week with real employee data, confirm the grid loads, assign one cell, confirm `wfm_roster_assignment.cycle_id` is set for that row (`SELECT cycle_id FROM wfm_roster_assignment WHERE employee_id = ? AND roster_date = ?`), publish, confirm a `work_inbox_item` row appears for that employee (`SELECT * FROM work_inbox_item WHERE type = 'ROSTER_ACK_PENDING' AND entity_id = ?`).

- [ ] **Step 5: Confirm non-WFM roles are refused**

Log in as a role NOT granted `WFM_ROSTER_BUILDER` (e.g. `team_leader`), confirm `/wfm/roster-builder` shows `WorkforcePageGate`'s "Access not available" screen, not the page content.
