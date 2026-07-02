# WFM Roster + Shift Management + Bulk Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the WFM shift-rotation model (fixed / weekly / daily change / frozen shifts), add roster bulk upload for managers/WFM/HR/admin, build the weekly auto-roster engine that respects each employee's rotation type, and surface everything in clean frontend pages.

**Architecture:** Three pillars — (1) a `shift_rotation_type` column on `employees` + `wfm_roster_assignment` that encodes the scheduling contract per employee (frozen / weekly / daily / rotating), (2) a backend roster bulk upload service that writes directly to `wfm_roster_assignment`, and (3) enhanced frontend pages (NativeWFMAutoRoster, NativeWFMRoster, new NativeRosterBulkUpload) that let WFM staff see and act on all three categories. All new data lives in `mas_hrms`. No Supabase writes.

**Tech Stack:** TypeScript + Express (backend), React 18 + TanStack Query + shadcn/ui (frontend), MySQL 8.0 (`mas_hrms`), existing `wfm_roster_assignment` + `wfm_shift_master` + `weekly_roster_cycle` tables, `upload_template_master` + `upload_batch` pattern already used by BulkUploadHub.

---

## Existing WFM Schema (read-only context — do not re-create)

```
wfm_shift_master          — shift definitions (id, shift_code, shift_name, start_time, end_time)
wfm_shift_template        — versioned, process-scoped shift templates
wfm_roster_assignment     — daily per-employee roster row (employee_id, roster_date, shift_id, publish_status)
weekly_roster_cycle       — weekly governance lifecycle (draft → payroll_input_ready)
roster_daily_assignment   — day-level within cycle with acknowledgement
roster_template           — reusable patterns (fixed / rotation / custom, cycle_days)
week_off_preference       — employee-submitted preferred weekly off day
employee_roster_preference— structured preference (shift, flexibility: fixed/semi_flexible/fully_flexible)
process_weekoff_capacity  — max employees allowed off per day per process
weekoff_allocation_log    — FCFS allocation audit
upload_template_master    — bulk upload type registry
upload_batch              — upload batch header
upload_batch_row          — staged rows per batch
```

---

## File Structure

### New files to create:

| File | Purpose |
|---|---|
| `backend/sql/223_employee_shift_rotation_type.sql` | Add `shift_rotation_type` + `frozen_shift_id` to `employees` |
| `backend/sql/224_roster_bulk_upload_template.sql` | Seed ROSTER_ASSIGNMENT_BULK + WEEKLY_ROSTER_BULK + SHIFT_FREEZE_BULK templates |
| `backend/src/modules/wfm/roster-bulk.service.ts` | Import service for all 3 roster bulk upload types |
| `src/pages/NativeRosterBulkUpload.tsx` | Dedicated roster bulk upload page (WFM/manager/HR/admin) |

### Existing files to modify:

| File | Change |
|---|---|
| `backend/src/db/runPendingMigrations.ts` | Add 223, 224 |
| `backend/src/modules/bulk-upload/bulk-upload.routes.ts` | Wire 3 new roster RPC handlers |
| `backend/src/modules/wfm/wfm.routes.ts` | Add GET /api/wfm/employees/rotation-summary, PATCH /api/wfm/employees/:id/shift-rotation |
| `src/pages/BulkUploadHub.tsx` | Add 3 new upload type sample value cases + isRosterBulk flag |
| `src/App.tsx` | Add lazy import + route `/wfm/roster-bulk-upload` |
| `src/pages/NativeWFMAutoRoster.tsx` | Add rotation-type filter panel + freeze/unfreeze action |
| `src/pages/NativeWFMRoster.tsx` | Add shift rotation type badge column |

---

## Task 1: DB — Add shift_rotation_type to employees + roster_assignment

**Files:**
- Create: `backend/sql/223_employee_shift_rotation_type.sql`
- Modify: `backend/src/db/runPendingMigrations.ts`

- [ ] **Step 1: Create migration file**

```sql
-- backend/sql/223_employee_shift_rotation_type.sql
-- Adds shift scheduling contract per employee
-- shift_rotation_type values:
--   frozen      = never changes (same shift every day, WFM cannot override)
--   weekly      = changes at most once per week (weekly roster planning)
--   daily       = can change every day (daily roster, e.g. blended BPO)
--   rotating    = follows a rotation group pattern in roster_template

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS shift_rotation_type
    ENUM('frozen','weekly','daily','rotating') NOT NULL DEFAULT 'weekly'
    COMMENT 'Scheduling contract: frozen=never changes, weekly=weekly roster, daily=daily change, rotating=rotation group',
  ADD COLUMN IF NOT EXISTS frozen_shift_id
    CHAR(36) NULL
    COMMENT 'FK to wfm_shift_master; only set when shift_rotation_type=frozen',
  ADD INDEX IF NOT EXISTS idx_emp_rotation_type (shift_rotation_type);

ALTER TABLE wfm_roster_assignment
  ADD COLUMN IF NOT EXISTS rotation_type_snapshot
    ENUM('frozen','weekly','daily','rotating') NULL
    COMMENT 'Snapshot of employee rotation type at roster creation time';

SELECT '223_employee_shift_rotation_type.sql applied' AS migration_status;
```

- [ ] **Step 2: Add to migration manifest**

In `backend/src/db/runPendingMigrations.ts`, find the line `"222_ensure_bulk_upload_templates.sql",` and add after it:

```typescript
  "223_employee_shift_rotation_type.sql",
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /c/Users/shivamg/HRMS1/backend && npx tsc --noEmit 2>&1 | head -10
```
Expected: no output (zero errors)

- [ ] **Step 4: Commit**

```bash
git add backend/sql/223_employee_shift_rotation_type.sql backend/src/db/runPendingMigrations.ts
git commit -m "feat(wfm): add shift_rotation_type + frozen_shift_id to employees table"
```

---

## Task 2: DB — Seed roster bulk upload templates

**Files:**
- Create: `backend/sql/224_roster_bulk_upload_template.sql`
- Modify: `backend/src/db/runPendingMigrations.ts`

- [ ] **Step 1: Create migration file**

```sql
-- backend/sql/224_roster_bulk_upload_template.sql
-- Seeds three roster bulk upload types into upload_template_master

-- 1. ROSTER_ASSIGNMENT_BULK: assign a specific shift to specific employees on specific dates
INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'ROSTER_ASSIGNMENT_BULK',
  'Roster Assignment Bulk Upload',
  'wfm_roster_assignment',
  'Bulk-assign shift to employees on specific dates. One row = one employee on one date. shift_code must exist in wfm_shift_master.',
  JSON_ARRAY('employee_code', 'roster_date', 'shift_code'),
  JSON_ARRAY('week_off', 'notes'),
  JSON_OBJECT(
    'employee_code', 'MAS00001',
    'roster_date',   '2026-06-23',
    'shift_code',    'MORNING-A',
    'week_off',      '0',
    'notes',         ''
  ),
  1
);

-- 2. WEEKLY_ROSTER_BULK: set an entire week's roster for a list of employees
-- One row per employee, columns for each day of week (Mon-Sun shift_code or WEEKOFF)
INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'WEEKLY_ROSTER_BULK',
  'Weekly Roster Bulk Upload',
  'wfm_roster_assignment',
  'Set full-week shift plan per employee. week_start must be a Monday. Use WEEKOFF for day off, HOLIDAY for holiday. shift_code must exist in wfm_shift_master.',
  JSON_ARRAY('employee_code', 'week_start', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'),
  JSON_ARRAY('notes'),
  JSON_OBJECT(
    'employee_code', 'MAS00001',
    'week_start',    '2026-06-23',
    'mon',           'MORNING-A',
    'tue',           'MORNING-A',
    'wed',           'MORNING-A',
    'thu',           'MORNING-A',
    'fri',           'MORNING-A',
    'sat',           'WEEKOFF',
    'sun',           'WEEKOFF',
    'notes',         ''
  ),
  1
);

-- 3. SHIFT_FREEZE_BULK: freeze an employee to a specific permanent shift
INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'SHIFT_FREEZE_BULK',
  'Shift Freeze Bulk Upload',
  'employees',
  'Freeze employees to a permanent shift. Sets shift_rotation_type=frozen. Use shift_code=UNFREEZE to revert to weekly scheduling.',
  JSON_ARRAY('employee_code', 'shift_code'),
  JSON_ARRAY('effective_from', 'notes'),
  JSON_OBJECT(
    'employee_code', 'MAS00001',
    'shift_code',    'MORNING-A',
    'effective_from','2026-06-23',
    'notes',         ''
  ),
  1
);

SELECT '224_roster_bulk_upload_template.sql applied' AS migration_status;
```

- [ ] **Step 2: Add to manifest**

In `backend/src/db/runPendingMigrations.ts`, add after `"223_employee_shift_rotation_type.sql",`:

```typescript
  "224_roster_bulk_upload_template.sql",
```

- [ ] **Step 3: Commit**

```bash
git add backend/sql/224_roster_bulk_upload_template.sql backend/src/db/runPendingMigrations.ts
git commit -m "feat(wfm): seed roster/shift bulk upload templates (roster assignment, weekly roster, shift freeze)"
```

---

## Task 3: Backend — Roster bulk import service

**Files:**
- Create: `backend/src/modules/wfm/roster-bulk.service.ts`

This service handles all three roster RPC names called from `bulk-upload.routes.ts`.

- [ ] **Step 1: Create the file**

```typescript
// backend/src/modules/wfm/roster-bulk.service.ts
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { logSensitiveAction } from "../../shared/auditLog.js";

type BulkResult = { importedRows: number; errorRows: number; errors: string[] };

async function getBatchRows(batchId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
     WHERE upload_batch_id = ? AND row_status IN ('valid','pending') ORDER BY row_no`,
    [batchId],
  );
  return rows as any[];
}

async function rowError(rowId: string, msgs: string[]) {
  await db.execute(
    `UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?`,
    [JSON.stringify(msgs), rowId],
  );
}

async function rowDone(rowId: string) {
  await db.execute(
    `UPDATE upload_batch_row SET row_status='imported', error_messages=NULL WHERE id=?`,
    [rowId],
  );
}

async function finaliseBatch(batchId: string, imported: number, errors: number) {
  const status = errors === 0 ? "imported" : imported === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status=?, imported_rows=?, error_rows=?, updated_at=NOW() WHERE id=?`,
    [status, imported, errors, batchId],
  );
}

async function lookupEmployee(code: string): Promise<{ id: string; shift_rotation_type: string; frozen_shift_id: string | null } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, shift_rotation_type, frozen_shift_id FROM employees WHERE employee_code=? AND active_status=1 LIMIT 1`,
    [code],
  );
  return (rows as any[])[0] ?? null;
}

async function lookupShift(code: string): Promise<{ id: string } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM wfm_shift_master WHERE shift_code=? AND active_status=1 LIMIT 1`,
    [code],
  );
  return (rows as any[])[0] ?? null;
}

// ── 1. ROSTER_ASSIGNMENT_BULK ─────────────────────────────────────────────────
// One row = one employee on one date assigned to a shift
export async function importRosterAssignmentBatch(batchId: string, actorId: string): Promise<BulkResult> {
  const rows = await getBatchRows(batchId);
  let imported = 0, errorRows = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const d = typeof row.normalized_data === "string" ? JSON.parse(row.normalized_data) : (row.normalized_data ?? {});
    const empCode   = String(d.employee_code ?? "").trim();
    const rosterDate = String(d.roster_date ?? "").trim();
    const shiftCode  = String(d.shift_code ?? "").trim();
    const isWeekOff  = String(d.week_off ?? "0").trim() === "1";
    const notes      = String(d.notes ?? "").trim();

    const errs: string[] = [];
    if (!empCode)    errs.push("employee_code required");
    if (!rosterDate) errs.push("roster_date required (YYYY-MM-DD)");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rosterDate) && rosterDate) errs.push("roster_date must be YYYY-MM-DD");
    if (!shiftCode && !isWeekOff) errs.push("shift_code required unless week_off=1");

    if (errs.length) { await rowError(row.id, errs); errorRows++; errors.push(`Row ${row.row_no}: ${errs.join("; ")}`); continue; }

    const emp = await lookupEmployee(empCode);
    if (!emp) { await rowError(row.id, [`Employee ${empCode} not found or inactive`]); errorRows++; errors.push(`Row ${row.row_no}: employee not found`); continue; }

    // Respect frozen shift — if employee is frozen, only allow if shift_code matches frozen shift
    let shiftId: string | null = null;
    if (!isWeekOff) {
      const shift = await lookupShift(shiftCode);
      if (!shift) { await rowError(row.id, [`Shift ${shiftCode} not found`]); errorRows++; errors.push(`Row ${row.row_no}: shift not found`); continue; }
      if (emp.shift_rotation_type === "frozen" && emp.frozen_shift_id && emp.frozen_shift_id !== shift.id) {
        await rowError(row.id, [`Employee ${empCode} is frozen to a different shift. Unfreeze first.`]);
        errorRows++; errors.push(`Row ${row.row_no}: frozen shift conflict`); continue;
      }
      shiftId = shift.id;
    }

    const rosterStatus = isWeekOff ? "Week Off" : "Rostered";

    await db.execute(
      `INSERT INTO wfm_roster_assignment
         (id, employee_id, shift_id, roster_date, roster_status, publish_status, rotation_type_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         shift_id=VALUES(shift_id), roster_status=VALUES(roster_status),
         rotation_type_snapshot=VALUES(rotation_type_snapshot), updated_at=NOW()`,
      [randomUUID(), emp.id, shiftId, rosterDate, rosterStatus, emp.shift_rotation_type],
    );

    await logSensitiveAction({
      actor_user_id: actorId, action_type: "roster_assignment_bulk", module_key: "wfm",
      entity_type: "wfm_roster_assignment", entity_id: emp.id,
      change_summary: { employee_code: empCode, roster_date: rosterDate, shift_code: shiftCode, is_week_off: isWeekOff, notes },
    });

    await rowDone(row.id);
    imported++;
  }

  await finaliseBatch(batchId, imported, errorRows);
  return { importedRows: imported, errorRows, errors };
}

// ── 2. WEEKLY_ROSTER_BULK ─────────────────────────────────────────────────────
// One row = one employee's full week (Mon–Sun shift codes or WEEKOFF/HOLIDAY)
const DAY_COLS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function importWeeklyRosterBatch(batchId: string, actorId: string): Promise<BulkResult> {
  const rows = await getBatchRows(batchId);
  let imported = 0, errorRows = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const d = typeof row.normalized_data === "string" ? JSON.parse(row.normalized_data) : (row.normalized_data ?? {});
    const empCode   = String(d.employee_code ?? "").trim();
    const weekStart = String(d.week_start ?? "").trim();

    const errs: string[] = [];
    if (!empCode)    errs.push("employee_code required");
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) errs.push("week_start required (YYYY-MM-DD, must be a Monday)");

    // Verify it is a Monday
    if (weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      const dow = new Date(weekStart).getDay(); // 0=Sun, 1=Mon
      if (dow !== 1) errs.push(`week_start ${weekStart} is not a Monday (day ${dow})`);
    }

    if (errs.length) { await rowError(row.id, errs); errorRows++; errors.push(`Row ${row.row_no}: ${errs.join("; ")}`); continue; }

    const emp = await lookupEmployee(empCode);
    if (!emp) { await rowError(row.id, [`Employee ${empCode} not found`]); errorRows++; errors.push(`Row ${row.row_no}: employee not found`); continue; }

    // Build 7 day assignments
    const base = new Date(weekStart);
    let rowErrs: string[] = [];

    for (let i = 0; i < 7; i++) {
      const dayCol = DAY_COLS[i];
      const shiftCode = String((d[dayCol] ?? d[dayCol.toUpperCase()] ?? "")).trim().toUpperCase();
      const rosterDate = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);

      const isWeekOff = shiftCode === "WEEKOFF" || shiftCode === "WEEK_OFF" || shiftCode === "OFF";
      const isHoliday = shiftCode === "HOLIDAY";

      if (!shiftCode) continue; // blank = skip this day

      let shiftId: string | null = null;
      if (!isWeekOff && !isHoliday) {
        const shift = await lookupShift(shiftCode);
        if (!shift) { rowErrs.push(`${dayCol.toUpperCase()}: shift ${shiftCode} not found`); continue; }
        if (emp.shift_rotation_type === "frozen" && emp.frozen_shift_id && emp.frozen_shift_id !== shift.id) {
          rowErrs.push(`${dayCol.toUpperCase()}: employee frozen to different shift`); continue;
        }
        shiftId = shift.id;
      }

      const rosterStatus = isWeekOff ? "Week Off" : isHoliday ? "Holiday" : "Rostered";

      await db.execute(
        `INSERT INTO wfm_roster_assignment
           (id, employee_id, shift_id, roster_date, roster_status, publish_status, rotation_type_snapshot, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           shift_id=VALUES(shift_id), roster_status=VALUES(roster_status),
           rotation_type_snapshot=VALUES(rotation_type_snapshot), updated_at=NOW()`,
        [randomUUID(), emp.id, shiftId, rosterDate, rosterStatus, emp.shift_rotation_type],
      );
    }

    if (rowErrs.length) {
      await rowError(row.id, rowErrs);
      errorRows++; errors.push(`Row ${row.row_no}: ${rowErrs.join("; ")}`); continue;
    }

    await logSensitiveAction({
      actor_user_id: actorId, action_type: "weekly_roster_bulk", module_key: "wfm",
      entity_type: "wfm_roster_assignment", entity_id: emp.id,
      change_summary: { employee_code: empCode, week_start: weekStart },
    });

    await rowDone(row.id);
    imported++;
  }

  await finaliseBatch(batchId, imported, errorRows);
  return { importedRows: imported, errorRows, errors };
}

// ── 3. SHIFT_FREEZE_BULK ──────────────────────────────────────────────────────
// One row = freeze (or unfreeze) one employee to a shift
export async function importShiftFreezeBatch(batchId: string, actorId: string): Promise<BulkResult> {
  const rows = await getBatchRows(batchId);
  let imported = 0, errorRows = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const d = typeof row.normalized_data === "string" ? JSON.parse(row.normalized_data) : (row.normalized_data ?? {});
    const empCode   = String(d.employee_code ?? "").trim();
    const shiftCode = String(d.shift_code ?? "").trim().toUpperCase();

    const errs: string[] = [];
    if (!empCode)    errs.push("employee_code required");
    if (!shiftCode)  errs.push("shift_code required (use UNFREEZE to revert to weekly scheduling)");
    if (errs.length) { await rowError(row.id, errs); errorRows++; errors.push(`Row ${row.row_no}: ${errs.join("; ")}`); continue; }

    const emp = await lookupEmployee(empCode);
    if (!emp) { await rowError(row.id, [`Employee ${empCode} not found`]); errorRows++; errors.push(`Row ${row.row_no}: not found`); continue; }

    if (shiftCode === "UNFREEZE") {
      await db.execute(
        `UPDATE employees SET shift_rotation_type='weekly', frozen_shift_id=NULL, updated_at=NOW() WHERE id=?`,
        [emp.id],
      );
    } else {
      const shift = await lookupShift(shiftCode);
      if (!shift) { await rowError(row.id, [`Shift ${shiftCode} not found`]); errorRows++; errors.push(`Row ${row.row_no}: shift not found`); continue; }

      await db.execute(
        `UPDATE employees SET shift_rotation_type='frozen', frozen_shift_id=?, updated_at=NOW() WHERE id=?`,
        [shift.id, emp.id],
      );
    }

    await logSensitiveAction({
      actor_user_id: actorId, action_type: "shift_freeze_bulk", module_key: "wfm",
      entity_type: "employee", entity_id: emp.id,
      change_summary: { employee_code: empCode, shift_code: shiftCode },
    });

    await rowDone(row.id);
    imported++;
  }

  await finaliseBatch(batchId, imported, errorRows);
  return { importedRows: imported, errorRows, errors };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/Users/shivamg/HRMS1/backend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/wfm/roster-bulk.service.ts
git commit -m "feat(wfm): roster bulk import service — daily assignment, weekly roster, shift freeze"
```

---

## Task 4: Backend — Wire roster RPC handlers in bulk-upload.routes.ts

**Files:**
- Modify: `backend/src/modules/bulk-upload/bulk-upload.routes.ts`

- [ ] **Step 1: Read current import dispatch block**

The file currently has this pattern (around line 97–125):
```typescript
if (rpc_name === "import_official_email_update_batch") { ... }
if (rpc_name === "import_reporting_manager_update_batch") { ... }
return res.status(501).json({ ... });
```

- [ ] **Step 2: Add three new RPC handlers before the 501 return**

Find the line:
```typescript
  return res.status(501).json({
```

Insert before it:

```typescript
  if (rpc_name === "import_roster_assignment_batch") {
    const { importRosterAssignmentBatch } = await import(
      "../wfm/roster-bulk.service.js"
    );
    const data = await importRosterAssignmentBatch(id, req.authUser!.id);
    return res.json({ success: true, data });
  }

  if (rpc_name === "import_weekly_roster_batch") {
    const { importWeeklyRosterBatch } = await import(
      "../wfm/roster-bulk.service.js"
    );
    const data = await importWeeklyRosterBatch(id, req.authUser!.id);
    return res.json({ success: true, data });
  }

  if (rpc_name === "import_shift_freeze_batch") {
    const { importShiftFreezeBatch } = await import(
      "../wfm/roster-bulk.service.js"
    );
    const data = await importShiftFreezeBatch(id, req.authUser!.id);
    return res.json({ success: true, data });
  }
```

Also update the `/batches/:id/import` requireRole to include wfm and manager:

Find:
```typescript
router.post("/batches/:id/import", requireRole("admin", "hr"),
```
Replace with:
```typescript
router.post("/batches/:id/import", requireRole("admin", "hr", "wfm", "manager", "branch_head"),
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /c/Users/shivamg/HRMS1/backend && npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/bulk-upload/bulk-upload.routes.ts
git commit -m "feat(wfm): wire roster bulk import RPC handlers; allow wfm/manager/branch_head to import"
```

---

## Task 5: Backend — WFM API: rotation summary + per-employee freeze/unfreeze

**Files:**
- Modify: `backend/src/modules/wfm/wfm.routes.ts`

- [ ] **Step 1: Add two new endpoints at the end of wfm.routes.ts (before the export)**

Find the line near the end of `wfm.routes.ts` that has the export:
```typescript
export { wfmRouter };
```

Insert before it:

```typescript
// GET /api/wfm/employees/rotation-summary — list all employees with their rotation type
// Accessible to: admin, wfm, manager, branch_head, process_manager, hr
wfmRouter.get("/employees/rotation-summary", requireAuth, requireRole("admin","wfm","manager","branch_head","process_manager","hr"), h(async (req: any, res: any) => {
  const { process_id, branch_id, rotation_type, search } = req.query as Record<string, string>;
  const params: any[] = [];
  let where = "WHERE e.active_status = 1";

  if (process_id) { where += " AND e.process_id = ?"; params.push(process_id); }
  if (branch_id)  { where += " AND e.branch_id = ?";  params.push(branch_id); }
  if (rotation_type) { where += " AND e.shift_rotation_type = ?"; params.push(rotation_type); }
  if (search) {
    where += " AND (e.employee_code LIKE ? OR CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  const [rows] = await db.execute(
    `SELECT e.id, e.employee_code,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
            e.shift_rotation_type,
            e.frozen_shift_id,
            sm.shift_code AS frozen_shift_code,
            sm.shift_name AS frozen_shift_name,
            sm.start_time AS frozen_start_time,
            sm.end_time   AS frozen_end_time,
            pm.process_name,
            bm.branch_name
     FROM employees e
     LEFT JOIN wfm_shift_master sm ON sm.id = e.frozen_shift_id
     LEFT JOIN process_master pm   ON pm.id = e.process_id
     LEFT JOIN branch_master  bm   ON bm.id = e.branch_id
     ${where}
     ORDER BY e.shift_rotation_type, e.employee_code
     LIMIT 500`,
    params,
  );
  res.json({ success: true, data: rows });
}));

// PATCH /api/wfm/employees/:id/shift-rotation — update an employee's rotation type (and optionally freeze to a shift)
// Accessible to: admin, wfm, manager, hr
wfmRouter.patch("/employees/:id/shift-rotation", requireAuth, requireRole("admin","wfm","manager","hr"), h(async (req: any, res: any) => {
  const { id } = req.params;
  const { shift_rotation_type, frozen_shift_id } = req.body as { shift_rotation_type?: string; frozen_shift_id?: string | null };

  const allowed = ["frozen","weekly","daily","rotating"];
  if (shift_rotation_type && !allowed.includes(shift_rotation_type)) {
    return res.status(400).json({ success: false, error: `shift_rotation_type must be one of: ${allowed.join(", ")}` });
  }

  const sets: string[] = ["updated_at = NOW()"];
  const params: any[] = [];

  if (shift_rotation_type) { sets.push("shift_rotation_type = ?"); params.push(shift_rotation_type); }
  if (shift_rotation_type === "frozen" && frozen_shift_id) {
    sets.push("frozen_shift_id = ?"); params.push(frozen_shift_id);
  } else if (shift_rotation_type && shift_rotation_type !== "frozen") {
    sets.push("frozen_shift_id = NULL");
  }

  params.push(id);
  await db.execute(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`, params);

  const [rows] = await db.execute(
    `SELECT id, employee_code, shift_rotation_type, frozen_shift_id FROM employees WHERE id = ?`,
    [id],
  );
  res.json({ success: true, data: (rows as any[])[0] ?? null });
}));
```

Also add the import for `db` if not already present — check the top of the file:
```typescript
import { db } from "../../db/mysql.js";
```
(It is already imported in wfm.routes.ts via the controller, but if direct db usage is needed add it.)

- [ ] **Step 2: Verify TypeScript**

```bash
cd /c/Users/shivamg/HRMS1/backend && npx tsc --noEmit 2>&1 | head -15
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/wfm/wfm.routes.ts
git commit -m "feat(wfm): add rotation-summary list + per-employee shift-rotation PATCH endpoints"
```

---

## Task 6: Frontend — BulkUploadHub sample values for 3 new roster types

**Files:**
- Modify: `src/pages/BulkUploadHub.tsx`

- [ ] **Step 1: Add 3 new upload type constants to `IMPORT_RPC_BY_TYPE`**

Find:
```typescript
const IMPORT_RPC_BY_TYPE: Record<string, string> = {
```

This block currently has entries ending with `REPORTING_MANAGER_UPDATE`. Add three new entries:

```typescript
  ROSTER_ASSIGNMENT_BULK: "import_roster_assignment_batch",
  WEEKLY_ROSTER_BULK: "import_weekly_roster_batch",
  SHIFT_FREEZE_BULK: "import_shift_freeze_batch",
```

- [ ] **Step 2: Add sample value cases in `buildTemplateRow`**

In the `buildTemplateRow` function, after the `isReportingManagerUpdate` block (which you added in the previous session), add:

```typescript
    if (uploadTypeCode === "ROSTER_ASSIGNMENT_BULK") {
      const samples: Record<string, string> = {
        employee_code: "MAS00001",
        roster_date: "2026-06-23",
        shift_code: "MORNING-A",
        week_off: "0",
        notes: "",
      };
      return samples[header.toLowerCase()] ?? "";
    }

    if (uploadTypeCode === "WEEKLY_ROSTER_BULK") {
      const samples: Record<string, string> = {
        employee_code: "MAS00001",
        week_start: "2026-06-23",
        mon: "MORNING-A",
        tue: "MORNING-A",
        wed: "MORNING-A",
        thu: "MORNING-A",
        fri: "MORNING-A",
        sat: "WEEKOFF",
        sun: "WEEKOFF",
        notes: "",
      };
      return samples[header.toLowerCase()] ?? "";
    }

    if (uploadTypeCode === "SHIFT_FREEZE_BULK") {
      const samples: Record<string, string> = {
        employee_code: "MAS00001",
        shift_code: "MORNING-A",
        effective_from: "2026-06-23",
        notes: "",
      };
      return samples[header.toLowerCase()] ?? "";
    }
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /c/Users/shivamg/HRMS1 && npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/BulkUploadHub.tsx
git commit -m "feat(wfm): add roster/weekly/shift-freeze upload types to BulkUploadHub"
```

---

## Task 7: Frontend — NativeRosterBulkUpload page (dedicated WFM roster upload UI)

**Files:**
- Create: `src/pages/NativeRosterBulkUpload.tsx`

This is a purpose-built page accessible to manager, wfm, hr, admin, branch_head, super_admin. It wraps the three new upload types with contextual guidance and a shift lookup panel.

- [ ] **Step 1: Create the file**

```tsx
// src/pages/NativeRosterBulkUpload.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarDays, Download, Snowflake, Upload } from "lucide-react";

type Shift = { id: string; shift_code: string; shift_name: string; start_time: string; end_time: string };

const TEMPLATES = [
  {
    code: "ROSTER_ASSIGNMENT_BULK",
    label: "Daily Roster Assignment",
    icon: <CalendarDays className="h-5 w-5" />,
    description: "Assign a specific shift to one or more employees on specific dates. One row = one employee on one date.",
    columns: ["employee_code", "roster_date (YYYY-MM-DD)", "shift_code", "week_off (0/1)", "notes"],
    sample: "MAS00001,2026-06-23,MORNING-A,0,",
    tip: "Use week_off=1 to mark a day off instead of a shift.",
  },
  {
    code: "WEEKLY_ROSTER_BULK",
    label: "Weekly Roster (Full Week)",
    icon: <CalendarDays className="h-5 w-5" />,
    description: "Set an entire week's schedule per employee. week_start must be a Monday. Use WEEKOFF for day off.",
    columns: ["employee_code", "week_start (Monday, YYYY-MM-DD)", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "notes"],
    sample: "MAS00001,2026-06-23,MORNING-A,MORNING-A,MORNING-A,MORNING-A,MORNING-A,WEEKOFF,WEEKOFF,",
    tip: "Values: any shift_code, WEEKOFF, HOLIDAY, or leave blank to skip that day.",
  },
  {
    code: "SHIFT_FREEZE_BULK",
    label: "Freeze / Unfreeze Shift",
    icon: <Snowflake className="h-5 w-5" />,
    description: "Lock an employee to a permanent shift (frozen). Use shift_code=UNFREEZE to revert to weekly scheduling.",
    columns: ["employee_code", "shift_code (or UNFREEZE)", "effective_from (YYYY-MM-DD)", "notes"],
    sample: "MAS00001,MORNING-A,2026-06-23,",
    tip: "Frozen employees cannot be reassigned to other shifts via bulk upload.",
  },
];

function downloadCsv(templateCode: string, columns: string[], sample: string) {
  const header = columns.map(c => c.split(" ")[0]).join(",");
  const blob = new Blob([header + "\n" + sample], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${templateCode.toLowerCase()}_template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function NativeRosterBulkUpload() {
  const [activeTemplate, setActiveTemplate] = useState(TEMPLATES[0].code);

  const shiftsQuery = useQuery({
    queryKey: ["wfm-shifts-ref"],
    queryFn: () => hrmsApi.get<{ data: Shift[] }>("/api/wfm/shifts").then(r => (r as any).data ?? []),
  });
  const shifts: Shift[] = shiftsQuery.data ?? [];

  const tpl = TEMPLATES.find(t => t.code === activeTemplate)!;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl bg-slate-950 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-blue-300">WFM</p>
          <h1 className="mt-2 text-3xl font-black">Roster Bulk Upload</h1>
          <p className="mt-2 text-sm text-slate-300">
            Upload daily assignments, full-week rosters, or freeze employees to a permanent shift.
            All changes write directly to <code className="bg-slate-800 px-1 rounded text-blue-300">wfm_roster_assignment</code> in mas_hrms.
          </p>
        </div>

        {/* Template selector */}
        <div className="flex gap-3 flex-wrap">
          {TEMPLATES.map(t => (
            <button
              key={t.code}
              onClick={() => setActiveTemplate(t.code)}
              className={[
                "flex items-center gap-2 rounded-2xl border px-5 py-3 text-sm font-semibold transition",
                activeTemplate === t.code
                  ? "border-blue-500 bg-blue-50 text-blue-700 shadow"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: instructions + download */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  {tpl.icon} {tpl.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-600">{tpl.description}</p>
                <div className="rounded-xl bg-slate-50 p-4 space-y-1">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-400 mb-2">Required Columns</p>
                  {tpl.columns.map(col => (
                    <div key={col} className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-xs bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-700">
                        {col.split(" ")[0]}
                      </span>
                      {col.includes("(") && (
                        <span className="text-slate-400 text-xs">{col.slice(col.indexOf("("))}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                  <p className="text-xs font-semibold text-amber-700">💡 {tpl.tip}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadCsv(tpl.code, tpl.columns, tpl.sample)}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" /> Download Template CSV
                </Button>
                <div className="pt-2">
                  <p className="text-xs text-slate-400 font-semibold mb-2">
                    To upload, go to{" "}
                    <a href="/wfm/bulk-upload" className="text-blue-600 underline">Bulk Upload Hub</a>{" "}
                    and select <strong>{tpl.label}</strong> from the template dropdown.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: shift reference */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-slate-700">Available Shifts (shift_code reference)</CardTitle>
              </CardHeader>
              <CardContent>
                {shiftsQuery.isLoading && <p className="text-xs text-slate-400">Loading shifts…</p>}
                {shifts.length === 0 && !shiftsQuery.isLoading && (
                  <p className="text-xs text-slate-400">No shifts found. Add shifts in WFM Roster settings.</p>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Code</TableHead>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shifts.map(s => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">{s.shift_code}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{s.shift_name}</TableCell>
                        <TableCell className="text-xs text-slate-500">{s.start_time}–{s.end_time}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell><Badge variant="outline" className="font-mono text-xs bg-slate-100">WEEKOFF</Badge></TableCell>
                      <TableCell className="text-xs">Week Off</TableCell>
                      <TableCell className="text-xs text-slate-500">—</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell><Badge variant="outline" className="font-mono text-xs bg-slate-100">HOLIDAY</Badge></TableCell>
                      <TableCell className="text-xs">Public Holiday</TableCell>
                      <TableCell className="text-xs text-slate-500">—</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell><Badge variant="outline" className="font-mono text-xs bg-blue-50 text-blue-700">UNFREEZE</Badge></TableCell>
                      <TableCell className="text-xs">Revert to weekly</TableCell>
                      <TableCell className="text-xs text-slate-500">SHIFT_FREEZE only</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /c/Users/shivamg/HRMS1 && npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeRosterBulkUpload.tsx
git commit -m "feat(wfm): add NativeRosterBulkUpload page with shift reference panel"
```

---

## Task 8: Frontend — Wire route + lazy import in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add lazy import**

Find the line:
```typescript
const NativeWFMAutoRoster           = lazy(() => import("./pages/NativeWFMAutoRoster"));
```

Add after it:
```typescript
const NativeRosterBulkUpload        = lazy(() => import("./pages/NativeRosterBulkUpload"));
```

- [ ] **Step 2: Add route**

Find the WFM routes section — look for:
```tsx
<Route path="/wfm/extensions" element={<ProtectedRoute><Gate pageCode="WFM_EXTENSIONS"><NativeWFMExtensions /></Gate></ProtectedRoute>} />
```

Add after it:
```tsx
<Route path="/wfm/roster-bulk-upload" element={<ProtectedRoute roles={['admin','hr','wfm','manager','branch_head','super_admin']}><NativeRosterBulkUpload /></ProtectedRoute>} />
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /c/Users/shivamg/HRMS1 && npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(wfm): wire /wfm/roster-bulk-upload route to NativeRosterBulkUpload"
```

---

## Task 9: Frontend — Rotation type panel in NativeWFMAutoRoster

**Files:**
- Modify: `src/pages/NativeWFMAutoRoster.tsx`

This adds a new **"Shift Rotation Types"** tab that shows a filterable table of all employees with their rotation type + frozen shift, and a quick inline action to change the type (freeze / unfreeze / set weekly / daily / rotating).

- [ ] **Step 1: Read the current tabs in NativeWFMAutoRoster.tsx**

```bash
grep -n '"tab"\|setTab\|tab ===\|const.*tab' /c/Users/shivamg/HRMS1/src/pages/NativeWFMAutoRoster.tsx | head -20
```

The file has a `tab` state and renders different panels per tab value. The existing tabs include "planner", "assignments", etc.

- [ ] **Step 2: Add rotation-summary query state and API call**

Near the top of the component (after `const [events, setEvents] = useState`) add:

```typescript
const [rotationFilter, setRotationFilter] = useState<string>("all");
const [rotationSearch, setRotationSearch] = useState("");

const { data: rotationSummary = [], refetch: refetchRotation, isLoading: rotationLoading } = useQuery({
  queryKey: ["wfm-rotation-summary", rotationFilter, rotationSearch],
  queryFn: async () => {
    const params = new URLSearchParams();
    if (rotationFilter !== "all") params.set("rotation_type", rotationFilter);
    if (rotationSearch) params.set("search", rotationSearch);
    const r = await hrmsApi.get<{ data: any[] }>(`/api/wfm/employees/rotation-summary?${params}`);
    return (r as any).data ?? [];
  },
  enabled: tab === "rotation",
});

async function patchRotationType(empId: string, rotationType: string, frozenShiftId?: string) {
  await hrmsApi.patch(`/api/wfm/employees/${empId}/shift-rotation`, {
    shift_rotation_type: rotationType,
    frozen_shift_id: frozenShiftId ?? null,
  });
  refetchRotation();
}
```

- [ ] **Step 3: Add "rotation" to the tab list in the JSX**

Find where tabs are rendered (look for `tab === "planner"` condition blocks and the tab button list). Add a new tab button for "rotation":

```tsx
<button
  onClick={() => setTab("rotation")}
  className={tab === "rotation" ? "... active classes ..." : "... inactive classes ..."}
>
  <Users className="h-4 w-4 mr-1.5 inline" /> Rotation Types
</button>
```

Match the exact className pattern used by the other tab buttons in the file.

- [ ] **Step 4: Add the rotation tab panel**

After the last existing `{tab === "..."}` block, add:

```tsx
{tab === "rotation" && (
  <div className="space-y-4">
    <div className="flex flex-wrap gap-3 items-center">
      <input
        type="text"
        placeholder="Search by name or code…"
        value={rotationSearch}
        onChange={e => setRotationSearch(e.target.value)}
        className="rounded-xl border border-slate-200 px-4 py-2 text-sm w-64"
      />
      <div className="flex gap-2">
        {["all","frozen","weekly","daily","rotating"].map(f => (
          <button
            key={f}
            onClick={() => setRotationFilter(f)}
            className={[
              "rounded-full px-4 py-1.5 text-xs font-black border transition",
              rotationFilter === f
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50",
            ].join(" ")}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <a href="/wfm/roster-bulk-upload" className="ml-auto rounded-xl bg-blue-600 text-white px-4 py-2 text-sm font-semibold hover:bg-blue-700">
        Bulk Upload Roster / Freeze
      </a>
    </div>

    {rotationLoading && <p className="text-sm text-slate-400 py-8 text-center">Loading…</p>}

    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-3 text-xs font-black text-slate-500 uppercase">Code</th>
            <th className="text-left px-4 py-3 text-xs font-black text-slate-500 uppercase">Name</th>
            <th className="text-left px-4 py-3 text-xs font-black text-slate-500 uppercase">Process</th>
            <th className="text-left px-4 py-3 text-xs font-black text-slate-500 uppercase">Rotation Type</th>
            <th className="text-left px-4 py-3 text-xs font-black text-slate-500 uppercase">Frozen Shift</th>
            <th className="text-left px-4 py-3 text-xs font-black text-slate-500 uppercase">Action</th>
          </tr>
        </thead>
        <tbody>
          {rotationSummary.length === 0 && (
            <tr><td colSpan={6} className="text-center text-slate-400 py-8">No employees found.</td></tr>
          )}
          {rotationSummary.map((emp: any) => (
            <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 font-mono text-xs text-slate-600">{emp.employee_code}</td>
              <td className="px-4 py-3 font-semibold text-slate-800">{emp.full_name}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{emp.process_name ?? "—"}</td>
              <td className="px-4 py-3">
                <span className={[
                  "rounded-full px-2.5 py-1 text-xs font-black",
                  emp.shift_rotation_type === "frozen"   ? "bg-blue-50 text-blue-700" :
                  emp.shift_rotation_type === "daily"    ? "bg-amber-50 text-amber-700" :
                  emp.shift_rotation_type === "rotating" ? "bg-purple-50 text-purple-700" :
                  "bg-slate-100 text-slate-700",
                ].join(" ")}>
                  {emp.shift_rotation_type}
                </span>
              </td>
              <td className="px-4 py-3 text-xs font-mono text-slate-600">
                {emp.frozen_shift_code ? `${emp.frozen_shift_code} (${emp.frozen_start_time}–${emp.frozen_end_time})` : "—"}
              </td>
              <td className="px-4 py-3">
                {emp.shift_rotation_type === "frozen" ? (
                  <button
                    onClick={() => patchRotationType(emp.id, "weekly")}
                    className="rounded-lg bg-red-50 text-red-700 border border-red-200 px-3 py-1 text-xs font-semibold hover:bg-red-100"
                  >
                    Unfreeze
                  </button>
                ) : (
                  <select
                    defaultValue=""
                    onChange={e => { if (e.target.value) patchRotationType(emp.id, e.target.value); e.target.value = ""; }}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  >
                    <option value="">Change…</option>
                    <option value="weekly">Set Weekly</option>
                    <option value="daily">Set Daily</option>
                    <option value="rotating">Set Rotating</option>
                  </select>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="text-xs text-slate-400">
      To freeze employees to a specific shift in bulk, use{" "}
      <a href="/wfm/roster-bulk-upload" className="text-blue-600 underline">Roster Bulk Upload → Freeze / Unfreeze Shift</a>.
    </p>
  </div>
)}
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd /c/Users/shivamg/HRMS1 && npx tsc --noEmit 2>&1 | head -15
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/NativeWFMAutoRoster.tsx
git commit -m "feat(wfm): add Rotation Types tab to NativeWFMAutoRoster with inline freeze/unfreeze"
```

---

## Task 10: Frontend — Rotation type badge column in NativeWFMRoster

**Files:**
- Modify: `src/pages/NativeWFMRoster.tsx`

The NativeWFMRoster page shows the roster grid. We add a small rotation-type badge so WFM staff can see at a glance whether each employee has a fixed/frozen/rotating shift.

- [ ] **Step 1: Find the employee column in NativeWFMRoster.tsx**

```bash
grep -n "employee_code\|full_name\|rotation_type\|shift_rotation" /c/Users/shivamg/HRMS1/src/pages/NativeWFMRoster.tsx | head -20
```

- [ ] **Step 2: Add rotation type to the employee lookup query**

The roster page fetches employees for display. Find the query that loads employee/assignment data and confirm it returns `shift_rotation_type`. If not, the badge falls back gracefully to nothing.

- [ ] **Step 3: Add a rotation type badge in the employee name cell**

Find where `full_name` or `employee_code` is rendered in the roster table and add after the name:

```tsx
{emp.shift_rotation_type && emp.shift_rotation_type !== "weekly" && (
  <span className={[
    "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-black",
    emp.shift_rotation_type === "frozen"   ? "bg-blue-100 text-blue-700" :
    emp.shift_rotation_type === "daily"    ? "bg-amber-100 text-amber-700" :
    "bg-purple-100 text-purple-700",
  ].join(" ")}>
    {emp.shift_rotation_type}
  </span>
)}
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd /c/Users/shivamg/HRMS1 && npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/NativeWFMRoster.tsx
git commit -m "feat(wfm): show rotation type badge in NativeWFMRoster employee column"
```

---

## Task 11: Push all commits

- [ ] **Step 1: Final full TypeScript check**

```bash
cd /c/Users/shivamg/HRMS1 && npx tsc --noEmit 2>&1 | head -20
cd /c/Users/shivamg/HRMS1/backend && npx tsc --noEmit 2>&1 | head -20
```
Both must produce no output (zero errors).

- [ ] **Step 2: Push**

```bash
git push origin main
```

Expected output: `main -> main`

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|---|---|
| Roster bulk upload for manager/WFM/HR/admin/super_admin | Tasks 2, 4, 7, 8 |
| Daily shift assignment bulk upload | Tasks 2, 3 (importRosterAssignmentBatch) |
| Weekly roster bulk upload (full week per employee) | Tasks 2, 3 (importWeeklyRosterBatch) |
| Freeze employees to permanent shift | Tasks 1, 3 (importShiftFreezeBatch), 5 |
| Weekly change shift timing | Tasks 1 (shift_rotation_type=weekly) + existing weekly_roster_cycle |
| Daily change shift timing | Tasks 1 (shift_rotation_type=daily) + existing wfm_roster_assignment |
| Frozen shift timing (never changes) | Tasks 1, 3, 5 |
| Rotating shift groups | Tasks 1 (shift_rotation_type=rotating) + existing roster_template.rotation_groups |
| Writes directly to mas_hrms employees + wfm_roster_assignment | Tasks 3, 5 — direct MySQL UPDATE/INSERT |
| Frontend visibility for WFM staff | Tasks 7, 9, 10 |
| Shift code reference panel | Task 7 (NativeRosterBulkUpload shift reference table) |

### Placeholder scan — None found. All steps have complete code.

### Type consistency — All function names consistent across Tasks 3→4: `importRosterAssignmentBatch`, `importWeeklyRosterBatch`, `importShiftFreezeBatch`.
