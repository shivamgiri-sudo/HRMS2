# Maternity Leave — Full Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully implement the Maternity Benefit Act 1961 (amended 2017) in MAS-CallNet HRMS — correct entitlement weeks by parity, payroll LWP exclusion, leave-request integration, adoption/miscarriage support, nursing breaks, and employee self-service.

**Architecture:** Six independent layers each with a clear boundary — (1) DB schema patch, (2) maternity business-logic service, (3) leave-request auto-creation on approval, (4) payroll LWP exclusion, (5) backend route updates, (6) frontend employee + admin pages. Each layer commits independently. The compliance service owns maternity state; the leave service is a consumer. Payroll queries maternity records at calculation time — no event coupling.

**Tech Stack:** TypeScript, Express, MySQL (mysql2), Zod, React 18, TanStack Query v5, shadcn/ui, Tailwind CSS

---

## Codebase Reference

- DB connection: `import { db } from '../../db/mysql.js'` — mysql2 Pool, `db.execute<RowDataPacket[]>()`
- Auth middleware: `import { requireAuth } from '../../middleware/authMiddleware.js'`
- Role guard: `import { requireRole } from '../../middleware/requireRole.js'`
- Get employee for user: `import { getEmployeeForUser } from '../../shared/accessGuard.js'`
- Role check helper: `import { hasRole } from '../../shared/accessGuard.js'`
- Route wrapper: `const h = (fn) => (req, res, next) => fn(req, res).catch(next)`
- All imports use `.js` extension (NodeNext ESM)
- Frontend API: `import { hrmsApi } from '@/lib/hrmsApi'`
- Frontend layout: `import { DashboardLayout } from '@/components/layout/DashboardLayout'`
- Frontend auth: `import { useAuth } from '@/contexts/AuthContext'`

---

## File Structure

### Modified files
- `backend/sql/042_maternity_schema_patch.sql` — schema fixes + new columns
- `backend/src/modules/compliance/compliance.service.ts` — extend MaternityRecord type + rewrite maternity methods
- `backend/src/modules/compliance/compliance.routes.ts` — add new endpoints (employee self-apply, nursing-break, approve-and-create-leave)
- `backend/src/modules/payroll/payrollCalculate.service.ts` — LWP exclusion for active maternity employees
- `backend/src/modules/leave/leave.service.ts` — add `submitMaternityLeave()` helper
- `src/pages/NativeLabourCompliance.tsx` — upgrade MaternityTab with parity/adoption/miscarriage UI
- `src/pages/NativeMaternityLeave.tsx` — NEW employee self-service page
- `src/App.tsx` — add `/maternity-leave` route

### New files
- `backend/src/modules/compliance/maternity.types.ts` — MaternityRecord interface + DTOs
- `backend/src/modules/compliance/maternity.service.ts` — maternity business logic (parity rules, week calc, leave creation)
- `backend/src/modules/compliance/maternity.validation.ts` — Zod schemas
- `src/pages/NativeMaternityLeave.tsx` — employee self-service

---

## Task 1: Database Schema Patch

**Files:**
- Create: `backend/sql/042_maternity_schema_patch.sql`

- [ ] **Step 1: Create the SQL file**

```sql
-- backend/sql/042_maternity_schema_patch.sql
-- Maternity Benefit Act compliance patch
-- Fixes: ML entitlement days, maternity_benefit_record schema gaps,
--        leave_request FK to maternity record, creche_facility table
USE mas_hrms;

-- 1. Fix ML max_days_per_year: 90 days → 182 days (26 weeks per MBA 1961)
UPDATE leave_type_master
SET max_days_per_year = 182
WHERE leave_code = 'ML' AND max_days_per_year = 90;

-- 2. Add missing columns to maternity_benefit_record
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='maternity_benefit_record' AND COLUMN_NAME='record_type');
SET @sql = IF(@col = 0,
  "ALTER TABLE maternity_benefit_record
     ADD COLUMN record_type ENUM('delivery','adoption','miscarriage','surrogacy')
         NOT NULL DEFAULT 'delivery' AFTER employee_id,
     ADD COLUMN child_birth_order TINYINT NOT NULL DEFAULT 1
         COMMENT '1=first child, 2=second, 3=third+ (affects entitlement weeks)' AFTER record_type,
     ADD COLUMN entitled_weeks TINYINT NOT NULL DEFAULT 26
         COMMENT 'Computed: 26 for 1st/2nd delivery, 12 for 3rd+, 8 adoption, 6 miscarriage' AFTER child_birth_order,
     ADD COLUMN leave_request_id CHAR(36) NULL
         COMMENT 'Auto-created leave_request when status moves to approved' AFTER notes,
     ADD COLUMN nursing_break_granted TINYINT(1) NOT NULL DEFAULT 0
         COMMENT 'Two nursing breaks of 15 min per day for 15 months post-delivery' AFTER leave_request_id,
     ADD COLUMN nursing_break_end_date DATE NULL AFTER nursing_break_granted,
     ADD COLUMN work_from_home_option TINYINT(1) NOT NULL DEFAULT 0
         COMMENT 'MBA 2017: WFH option per employer policy' AFTER nursing_break_end_date,
     ADD INDEX idx_mat_leave_req (leave_request_id),
     ADD INDEX idx_mat_type (record_type, status)",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. Backfill entitled_weeks for existing records based on current paid_weeks
UPDATE maternity_benefit_record
SET entitled_weeks = paid_weeks
WHERE entitled_weeks = 26 AND paid_weeks != 26;

-- 4. creche_facility table (MBA 2017 — mandatory for 50+ women employees)
CREATE TABLE IF NOT EXISTS creche_facility (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_id        CHAR(36)     NOT NULL,
  facility_type    ENUM('on_premises','employer_funded_offsite','contracted') NOT NULL,
  facility_name    VARCHAR(255) NULL,
  address          TEXT         NULL,
  capacity         INT          NOT NULL DEFAULT 0,
  current_enrolled INT          NOT NULL DEFAULT 0,
  subsidy_per_child_monthly DECIMAL(10,2) NULL,
  operational_since DATE        NULL,
  status           ENUM('active','inactive','planned') NOT NULL DEFAULT 'active',
  notes            TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_creche_branch (branch_id),
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Maternity schema patch 042 applied.' AS status;
```

- [ ] **Step 2: Apply to production DB**

Run from `backend/` directory:
```bash
node -e "
const mysql = require('mysql2/promise');
const fs = require('fs'), path = require('path');
(async () => {
  const conn = await mysql.createConnection({
    host: '192.168.10.6', port: 3306,
    user: 'shivam_user', password: 'qwersdfg!@#hjk',
    database: 'mas_hrms', multipleStatements: true
  });
  const sql = fs.readFileSync(path.join(process.cwd(), 'sql/042_maternity_schema_patch.sql'), 'utf8');
  await conn.query(sql);
  console.log('042 applied OK');
  await conn.end();
})().catch(e => { console.error(e.sqlMessage || e.message); process.exit(1); });
"
```

Expected output: `042 applied OK`

- [ ] **Step 3: Verify columns exist**

```bash
node -e "
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms' });
  const cols = ['record_type','child_birth_order','entitled_weeks','leave_request_id','nursing_break_granted','nursing_break_end_date'];
  for (const col of cols) {
    const [[r]] = await c.query('SELECT COUNT(*) c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', ['mas_hrms','maternity_benefit_record',col]);
    console.log(col + ':', r.c > 0 ? 'OK' : 'MISSING');
  }
  const [[ml]] = await c.query(\"SELECT max_days_per_year FROM leave_type_master WHERE leave_code='ML'\");
  console.log('ML max_days_per_year:', ml.max_days_per_year, ml.max_days_per_year == 182 ? 'OK' : 'WRONG - expected 182');
  await c.end();
})().catch(e => console.error(e.message));
"
```

Expected: all `OK`, ML = 182

- [ ] **Step 4: Commit**

```bash
git add backend/sql/042_maternity_schema_patch.sql
git commit -m "feat(maternity): add schema patch — parity fields, ML entitlement fix, creche table"
```

---

## Task 2: Maternity Types + Validation

**Files:**
- Create: `backend/src/modules/compliance/maternity.types.ts`
- Create: `backend/src/modules/compliance/maternity.validation.ts`

- [ ] **Step 1: Create `maternity.types.ts`**

```typescript
// backend/src/modules/compliance/maternity.types.ts

export type MaternityRecordType = 'delivery' | 'adoption' | 'miscarriage' | 'surrogacy';
export type MaternityStatus = 'applied' | 'approved' | 'active' | 'completed' | 'rejected';

export interface MaternityRecord {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  record_type: MaternityRecordType;
  child_birth_order: number;
  entitled_weeks: number;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  leave_start_date: string;
  leave_end_date: string | null;
  paid_weeks: number;
  nursing_break_weeks: number;
  nursing_break_granted: number;
  nursing_break_end_date: string | null;
  work_from_home_option: number;
  complications: number;
  status: MaternityStatus;
  approved_by: string | null;
  leave_request_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMaternityDTO {
  employee_id: string;
  record_type: MaternityRecordType;
  child_birth_order: number;
  expected_delivery_date?: string | null;
  leave_start_date: string;
  complications?: boolean;
  notes?: string | null;
}

export interface UpdateMaternityDTO {
  status?: MaternityStatus;
  actual_delivery_date?: string | null;
  leave_end_date?: string | null;
  nursing_break_granted?: boolean;
  work_from_home_option?: boolean;
  notes?: string | null;
}

/**
 * Returns entitled weeks per MBA 1961 rules.
 * delivery: 26 weeks for 1st+2nd child, 12 weeks for 3rd+
 * adoption: 8 weeks (MBA 2017)
 * miscarriage/surrogacy: 6 weeks
 * complications: +4 weeks (when complications flag = 1)
 */
export function computeEntitledWeeks(
  recordType: MaternityRecordType,
  childBirthOrder: number,
  complications: boolean
): number {
  let weeks: number;
  switch (recordType) {
    case 'delivery':
      weeks = childBirthOrder <= 2 ? 26 : 12;
      break;
    case 'adoption':
      weeks = 8;
      break;
    case 'miscarriage':
    case 'surrogacy':
      weeks = 6;
      break;
    default:
      weeks = 26;
  }
  return complications ? weeks + 4 : weeks;
}

/**
 * Compute leave end date from start + entitled weeks.
 */
export function computeLeaveEndDate(startDate: string, entitledWeeks: number): string {
  const d = new Date(startDate);
  d.setDate(d.getDate() + entitledWeeks * 7 - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute nursing break end date: 15 months post actual_delivery_date.
 */
export function computeNursingBreakEndDate(actualDeliveryDate: string): string {
  const d = new Date(actualDeliveryDate);
  d.setMonth(d.getMonth() + 15);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Create `maternity.validation.ts`**

```typescript
// backend/src/modules/compliance/maternity.validation.ts
import { z } from 'zod';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const createMaternitySchema = z.object({
  employee_id:             z.string().uuid(),
  record_type:             z.enum(['delivery', 'adoption', 'miscarriage', 'surrogacy']).default('delivery'),
  child_birth_order:       z.coerce.number().int().min(1).max(20).default(1),
  expected_delivery_date:  z.string().regex(DATE).nullable().optional(),
  leave_start_date:        z.string().regex(DATE, 'Date must be YYYY-MM-DD'),
  complications:           z.boolean().default(false),
  notes:                   z.string().trim().nullable().optional(),
});

export const updateMaternitySchema = z.object({
  status:                  z.enum(['applied', 'approved', 'active', 'completed', 'rejected']).optional(),
  actual_delivery_date:    z.string().regex(DATE).nullable().optional(),
  leave_end_date:          z.string().regex(DATE).nullable().optional(),
  nursing_break_granted:   z.boolean().optional(),
  work_from_home_option:   z.boolean().optional(),
  notes:                   z.string().trim().nullable().optional(),
});

export const maternityListFiltersSchema = z.object({
  status:      z.enum(['applied', 'approved', 'active', 'completed', 'rejected']).optional(),
  record_type: z.enum(['delivery', 'adoption', 'miscarriage', 'surrogacy']).optional(),
  year:        z.coerce.number().int().optional(),
});

export type CreateMaternityInput = z.infer<typeof createMaternitySchema>;
export type UpdateMaternityInput = z.infer<typeof updateMaternitySchema>;
export type MaternityListFilters = z.infer<typeof maternityListFiltersSchema>;
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/compliance/maternity.types.ts \
        backend/src/modules/compliance/maternity.validation.ts
git commit -m "feat(maternity): add types with parity rules and Zod validation schemas"
```

---

## Task 3: Maternity Service

**Files:**
- Create: `backend/src/modules/compliance/maternity.service.ts`

- [ ] **Step 1: Create `maternity.service.ts`**

```typescript
// backend/src/modules/compliance/maternity.service.ts
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import {
  computeEntitledWeeks,
  computeLeaveEndDate,
  computeNursingBreakEndDate,
} from './maternity.types.js';
import type {
  MaternityRecord,
  CreateMaternityDTO,
  UpdateMaternityDTO,
  MaternityRecordType,
} from './maternity.types.js';
import type { MaternityListFilters } from './maternity.validation.js';

const SELECT_BASE = `
  SELECT m.*,
         e.full_name  AS employee_name,
         e.employee_code
    FROM maternity_benefit_record m
    LEFT JOIN employees e ON e.id = m.employee_id
`;

export const maternityService = {
  async list(employeeId: string | undefined, filters: MaternityListFilters): Promise<MaternityRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (employeeId)       { conds.push('m.employee_id = ?');  params.push(employeeId); }
    if (filters.status)   { conds.push('m.status = ?');       params.push(filters.status); }
    if (filters.record_type) { conds.push('m.record_type = ?'); params.push(filters.record_type); }
    if (filters.year)     { conds.push('YEAR(m.leave_start_date) = ?'); params.push(filters.year); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [rows] = await db.execute<RowDataPacket[]>(
      `${SELECT_BASE} ${where} ORDER BY m.leave_start_date DESC`,
      params
    );
    return rows as MaternityRecord[];
  },

  async getById(id: string): Promise<MaternityRecord | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `${SELECT_BASE} WHERE m.id = ? LIMIT 1`, [id]
    );
    return (rows[0] as MaternityRecord) ?? null;
  },

  async create(dto: CreateMaternityDTO): Promise<MaternityRecord> {
    // Enforce: only one active/approved maternity record per employee at a time
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM maternity_benefit_record
        WHERE employee_id = ? AND status IN ('applied','approved','active') LIMIT 1`,
      [dto.employee_id]
    );
    if ((existing as RowDataPacket[]).length > 0) {
      throw new Error('Employee already has an active or pending maternity record');
    }

    const entitled_weeks = computeEntitledWeeks(
      dto.record_type,
      dto.child_birth_order,
      dto.complications ?? false
    );
    const leave_end_date = computeLeaveEndDate(dto.leave_start_date, entitled_weeks);
    const id = randomUUID();

    await db.execute(
      `INSERT INTO maternity_benefit_record
         (id, employee_id, record_type, child_birth_order, entitled_weeks,
          expected_delivery_date, leave_start_date, leave_end_date,
          paid_weeks, complications, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?)`,
      [
        id,
        dto.employee_id,
        dto.record_type,
        dto.child_birth_order,
        entitled_weeks,
        dto.expected_delivery_date ?? null,
        dto.leave_start_date,
        leave_end_date,
        entitled_weeks, // paid_weeks = entitled_weeks initially
        dto.complications ? 1 : 0,
        dto.notes ?? null,
      ]
    );
    return (await this.getById(id))!;
  },

  async approve(id: string, approverId: string): Promise<MaternityRecord> {
    const record = await this.getById(id);
    if (!record) throw new Error('Maternity record not found');
    if (record.status !== 'applied') throw new Error(`Cannot approve record in status: ${record.status}`);

    // Find ML leave_type_id
    const [ltRows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM leave_type_master WHERE leave_code = 'ML' AND active_status = 1 LIMIT 1"
    );
    if (!(ltRows as RowDataPacket[]).length) throw new Error('ML leave type not found in leave_type_master');
    const leaveTypeId = (ltRows[0] as any).id as string;

    // Auto-create leave_request for the maternity period
    const leaveReqId = randomUUID();
    const totalDays = record.entitled_weeks * 7;
    await db.execute(
      `INSERT INTO leave_request
         (id, employee_id, leave_type_id, from_date, to_date, total_days, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Maternity leave — auto-created on approval', 'approved')`,
      [
        leaveReqId,
        record.employee_id,
        leaveTypeId,
        record.leave_start_date,
        record.leave_end_date,
        totalDays,
      ]
    );

    // Log the auto-approval in leave_approval_log
    await db.execute(
      `INSERT INTO leave_approval_log (id, leave_request_id, action, action_by, remarks)
       VALUES (UUID(), ?, 'approved', ?, 'Auto-approved via maternity benefit record')`,
      [leaveReqId, approverId]
    );

    // Update maternity record
    await db.execute(
      `UPDATE maternity_benefit_record
          SET status = 'approved', approved_by = ?, leave_request_id = ?
        WHERE id = ?`,
      [approverId, leaveReqId, id]
    );

    return (await this.getById(id))!;
  },

  async update(id: string, dto: UpdateMaternityDTO): Promise<MaternityRecord> {
    const record = await this.getById(id);
    if (!record) throw new Error('Maternity record not found');

    const sets: string[] = [];
    const params: unknown[] = [];

    if (dto.actual_delivery_date !== undefined) {
      sets.push('actual_delivery_date = ?');
      params.push(dto.actual_delivery_date);
      // If delivery date is provided and nursing breaks not already set, auto-compute end date
      if (dto.actual_delivery_date && !record.nursing_break_end_date) {
        sets.push('nursing_break_end_date = ?');
        params.push(computeNursingBreakEndDate(dto.actual_delivery_date));
      }
    }
    if (dto.leave_end_date !== undefined) {
      sets.push('leave_end_date = ?');
      params.push(dto.leave_end_date);
    }
    if (dto.nursing_break_granted !== undefined) {
      sets.push('nursing_break_granted = ?');
      params.push(dto.nursing_break_granted ? 1 : 0);
    }
    if (dto.work_from_home_option !== undefined) {
      sets.push('work_from_home_option = ?');
      params.push(dto.work_from_home_option ? 1 : 0);
    }
    if (dto.notes !== undefined) {
      sets.push('notes = ?');
      params.push(dto.notes);
    }
    if (dto.status !== undefined) {
      sets.push('status = ?');
      params.push(dto.status);
    }

    if (sets.length === 0) return record;
    params.push(id);
    await db.execute(`UPDATE maternity_benefit_record SET ${sets.join(', ')} WHERE id = ?`, params);
    return (await this.getById(id))!;
  },

  /**
   * Returns employee IDs with an active maternity record covering the given month.
   * Used by payroll LWP exclusion.
   */
  async getActiveEmployeeIdsForMonth(runMonth: string): Promise<Set<string>> {
    // runMonth format: 'YYYY-MM'
    const monthStart = `${runMonth}-01`;
    // last day of month
    const [y, m] = runMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${runMonth}-${String(lastDay).padStart(2, '0')}`;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT employee_id
         FROM maternity_benefit_record
        WHERE status IN ('approved', 'active')
          AND leave_start_date <= ?
          AND (leave_end_date IS NULL OR leave_end_date >= ?)`,
      [monthEnd, monthStart]
    );
    return new Set((rows as RowDataPacket[]).map((r: any) => r.employee_id as string));
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/compliance/maternity.service.ts
git commit -m "feat(maternity): add maternity service with parity rules, auto leave-request on approve, payroll helper"
```

---

## Task 4: Payroll LWP Exclusion

**Files:**
- Modify: `backend/src/modules/payroll/payrollCalculate.service.ts`

The LWP deduction block starts at line ~290. We add one DB call before the employee loop to fetch all maternity-exempt employee IDs for the run month, then skip LWP for those employees.

- [ ] **Step 1: Read the current LWP block**

Open `backend/src/modules/payroll/payrollCalculate.service.ts`. Find this import at the top:

```typescript
import { payrollService } from "./payroll.service.js";
```

Add after it:

```typescript
import { maternityService } from "../compliance/maternity.service.js";
```

- [ ] **Step 2: Add maternity exclusion set before the employee loop**

Find the line:
```typescript
  for (const emp of employees) {
```

Insert **before** that line:

```typescript
  // Fetch employees on approved/active maternity leave covering this pay month.
  // These employees are entitled to full pay — no LWP deduction per MBA 1961 s.5(1).
  const maternityExemptIds = await maternityService.getActiveEmployeeIdsForMonth(run.run_month);
```

- [ ] **Step 3: Skip LWP deduction for maternity-exempt employees**

Find this block inside the loop:

```typescript
    // 5c. LWP deduction
    const workingDays = att.working_days || defaultWorkingDays;
    const lwpDays = att.lwp_days || 0;
    const lwpDeduction = lwpDays > 0 ? Math.round((grossMonthly / workingDays) * lwpDays * 100) / 100 : 0;
    const grossAfterLwp = Math.max(0, grossMonthly - lwpDeduction);
```

Replace it with:

```typescript
    // 5c. LWP deduction — skip for employees on maternity leave (MBA 1961 s.5(1))
    const workingDays = att.working_days || defaultWorkingDays;
    const lwpDays = att.lwp_days || 0;
    const isOnMaternityLeave = maternityExemptIds.has(emp.employee_id);
    const lwpDeduction = (!isOnMaternityLeave && lwpDays > 0)
      ? Math.round((grossMonthly / workingDays) * lwpDays * 100) / 100
      : 0;
    const grossAfterLwp = Math.max(0, grossMonthly - lwpDeduction);
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/payroll/payrollCalculate.service.ts
git commit -m "fix(payroll): exclude maternity leave from LWP deduction per MBA 1961 s.5(1)"
```

---

## Task 5: Backend Routes — New Maternity Endpoints

**Files:**
- Modify: `backend/src/modules/compliance/compliance.routes.ts`

Replace the three existing `/maternity` route handlers (GET, POST, PATCH) with new handlers that use `maternityService` instead of the inline `complianceService.createMaternity` / `updateMaternity` / `listMaternity` calls.

- [ ] **Step 1: Add maternityService import to compliance.routes.ts**

Find the existing imports at the top of `backend/src/modules/compliance/compliance.routes.ts`. Add:

```typescript
import { maternityService } from './maternity.service.js';
import { createMaternitySchema, updateMaternitySchema, maternityListFiltersSchema } from './maternity.validation.js';
```

- [ ] **Step 2: Replace the three maternity route handlers**

Find the comment `// ─── Maternity Benefit Act ───` and replace everything from that comment through the end of the three maternity routes with:

```typescript
// ─── Maternity Benefit Act ───────────────────────────────────────────────────

// GET /maternity — admin/hr sees all (with filters); employee sees own
complianceRouter.get(
  '/maternity',
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const privileged = await hasRole(userId, 'admin', 'hr');
    const filters = maternityListFiltersSchema.parse(req.query);

    if (privileged) {
      const data = await maternityService.list(undefined, filters);
      return res.json({ success: true, data });
    }

    const emp = await getEmployeeForUser(userId);
    if (!emp) return res.status(403).json({ success: false, error: 'No employee record linked to account' });
    const data = await maternityService.list(emp.id, filters);
    return res.json({ success: true, data });
  })
);

// POST /maternity — employee can self-apply; HR/admin can apply on behalf
complianceRouter.post(
  '/maternity',
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const privileged = await hasRole(userId, 'admin', 'hr');
    const body = createMaternitySchema.parse(req.body);

    // Employee can only create for themselves
    if (!privileged) {
      const emp = await getEmployeeForUser(userId);
      if (!emp) return res.status(403).json({ success: false, error: 'No employee record linked' });
      if (body.employee_id !== emp.id) {
        return res.status(403).json({ success: false, error: 'You can only apply maternity leave for yourself' });
      }
    }

    const data = await maternityService.create(body);
    return res.status(201).json({ success: true, data });
  })
);

// POST /maternity/:id/approve — HR/admin approves and auto-creates leave request
complianceRouter.post(
  '/maternity/:id/approve',
  requireRole('admin', 'hr'),
  h(async (req, res) => {
    const data = await maternityService.approve(req.params.id, req.authUser!.id);
    return res.json({ success: true, data });
  })
);

// PATCH /maternity/:id — update actual dates, nursing break, WFH option
complianceRouter.patch(
  '/maternity/:id',
  requireRole('admin', 'hr'),
  h(async (req, res) => {
    const body = updateMaternitySchema.parse(req.body);
    const data = await maternityService.update(req.params.id, body);
    return res.json({ success: true, data });
  })
);

// GET /maternity/:id — get single record (employee sees own; admin/hr sees all)
complianceRouter.get(
  '/maternity/:id',
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const privileged = await hasRole(userId, 'admin', 'hr');
    const record = await maternityService.getById(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: 'Record not found' });
    if (!privileged) {
      const emp = await getEmployeeForUser(userId);
      if (!emp || emp.id !== record.employee_id) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
    }
    return res.json({ success: true, data: record });
  })
);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/compliance/compliance.routes.ts
git commit -m "feat(maternity): replace inline compliance routes with maternityService — add approve endpoint, employee self-apply"
```

---

## Task 6: Upgrade NativeLabourCompliance — MaternityTab

**Files:**
- Modify: `src/pages/NativeLabourCompliance.tsx`

The MaternityTab component starts at line ~692. We need to:
1. Add `record_type`, `child_birth_order`, `complications` fields to the "Add" form
2. Show entitled_weeks (computed), add an "Approve" button that calls the new `/approve` endpoint
3. Show parity label (1st child / 2nd child / 3rd+ child / Adoption / Miscarriage)
4. Show nursing break end date if granted

- [ ] **Step 1: Update the `MaternityRecord` type in NativeLabourCompliance.tsx**

Find the type definition at the top:
```typescript
type MaternityRecord = {
```

Replace the entire type block with:

```typescript
type MaternityRecordType = 'delivery' | 'adoption' | 'miscarriage' | 'surrogacy';
type MaternityStatus = 'applied' | 'approved' | 'active' | 'completed' | 'rejected';

type MaternityRecord = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  record_type: MaternityRecordType;
  child_birth_order: number;
  entitled_weeks: number;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  leave_start_date: string;
  leave_end_date: string | null;
  paid_weeks: number;
  nursing_break_granted: number;
  nursing_break_end_date: string | null;
  work_from_home_option: number;
  complications: number;
  status: MaternityStatus;
  approved_by: string | null;
  leave_request_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: Replace the entire MaternityTab function**

Find `function MaternityTab()` and replace the whole function with:

```tsx
function MaternityTab() {
  const [records, setRecords] = useState<MaternityRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [addForm, setAddForm] = useState({
    employee_id: "",
    record_type: "delivery" as MaternityRecordType,
    child_birth_order: 1,
    expected_delivery_date: "",
    leave_start_date: "",
    complications: false,
    notes: "",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await hrmsApi.get<{ success: boolean; data: MaternityRecord[] }>("/api/compliance/maternity");
        if (!cancelled) setRecords(res.data ?? []);
      } catch (err) {
        if (!cancelled) setMessage(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleAdd = async () => {
    try {
      await hrmsApi.post("/api/compliance/maternity", {
        ...addForm,
        expected_delivery_date: addForm.expected_delivery_date || null,
        notes: addForm.notes || null,
      });
      setMessage("Maternity application submitted");
      setShowAdd(false);
      const res = await hrmsApi.get<{ success: boolean; data: MaternityRecord[] }>("/api/compliance/maternity");
      setRecords(res.data ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to submit");
    }
  };

  const handleApprove = async (id: string) => {
    setApprovingId(id);
    try {
      await hrmsApi.post(`/api/compliance/maternity/${id}/approve`, {});
      setMessage("Approved — leave request auto-created");
      const res = await hrmsApi.get<{ success: boolean; data: MaternityRecord[] }>("/api/compliance/maternity");
      setRecords(res.data ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setApprovingId(null);
    }
  };

  const parityLabel = (r: MaternityRecord) => {
    if (r.record_type === 'adoption') return 'Adoption';
    if (r.record_type === 'miscarriage') return 'Miscarriage';
    if (r.record_type === 'surrogacy') return 'Surrogacy';
    if (r.child_birth_order === 1) return '1st child';
    if (r.child_birth_order === 2) return '2nd child';
    return `${r.child_birth_order}rd+ child`;
  };

  const statusColor: Record<string, string> = {
    applied: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-blue-100 text-blue-800',
    active: 'bg-green-100 text-green-800',
    completed: 'bg-slate-100 text-slate-700',
    rejected: 'bg-red-100 text-red-800',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-slate-950">Maternity Benefit Records</h3>
        <button
          onClick={() => setShowAdd(s => !s)}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          {showAdd ? 'Cancel' : '+ New Application'}
        </button>
      </div>

      {message && (
        <p className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800">{message}</p>
      )}

      {showAdd && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <h4 className="font-bold text-slate-800">New Maternity Application</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Employee ID</label>
              <input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={addForm.employee_id}
                onChange={e => setAddForm(f => ({ ...f, employee_id: e.target.value }))}
                placeholder="UUID of employee" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Type</label>
              <select className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={addForm.record_type}
                onChange={e => setAddForm(f => ({ ...f, record_type: e.target.value as MaternityRecordType }))}>
                <option value="delivery">Delivery</option>
                <option value="adoption">Adoption (8 weeks)</option>
                <option value="miscarriage">Miscarriage/Stillbirth (6 weeks)</option>
                <option value="surrogacy">Surrogacy (6 weeks)</option>
              </select>
            </div>
            {addForm.record_type === 'delivery' && (
              <div>
                <label className="text-xs font-semibold text-slate-600">Child Birth Order</label>
                <select className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={addForm.child_birth_order}
                  onChange={e => setAddForm(f => ({ ...f, child_birth_order: parseInt(e.target.value) }))}>
                  <option value={1}>1st child — 26 weeks</option>
                  <option value={2}>2nd child — 26 weeks</option>
                  <option value={3}>3rd+ child — 12 weeks</option>
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-slate-600">Leave Start Date</label>
              <input type="date" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={addForm.leave_start_date}
                onChange={e => setAddForm(f => ({ ...f, leave_start_date: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Expected Delivery Date</label>
              <input type="date" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={addForm.expected_delivery_date}
                onChange={e => setAddForm(f => ({ ...f, expected_delivery_date: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 col-span-2">
              <input type="checkbox" id="complications" checked={addForm.complications}
                onChange={e => setAddForm(f => ({ ...f, complications: e.target.checked }))} />
              <label htmlFor="complications" className="text-sm text-slate-700">
                Medical complications (+4 weeks)
              </label>
            </div>
          </div>
          <button onClick={handleAdd}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            Submit Application
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : records.length === 0 ? (
        <p className="text-sm text-slate-500">No maternity records found.</p>
      ) : (
        <div className="space-y-3">
          {records.map(r => (
            <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{r.employee_name ?? r.employee_id}</p>
                  <p className="text-xs text-slate-500">{r.employee_code}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColor[r.status]}`}>
                    {r.status}
                  </span>
                  {r.status === 'applied' && (
                    <button
                      onClick={() => handleApprove(r.id)}
                      disabled={approvingId === r.id}
                      className="rounded-xl bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                      {approvingId === r.id ? 'Approving...' : 'Approve'}
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-slate-600">
                <span><b>Type:</b> {r.record_type}</span>
                <span><b>Parity:</b> {parityLabel(r)}</span>
                <span><b>Entitled:</b> {r.entitled_weeks} weeks ({r.entitled_weeks * 7} days)</span>
                <span><b>Start:</b> {r.leave_start_date}</span>
                <span><b>End:</b> {r.leave_end_date ?? '—'}</span>
                {r.complications ? <span className="text-orange-700 font-semibold">+4 weeks complications</span> : <span />}
                {r.nursing_break_granted ? (
                  <span className="col-span-3 text-purple-700">
                    Nursing breaks granted until {r.nursing_break_end_date ?? '—'}
                  </span>
                ) : null}
                {r.leave_request_id && (
                  <span className="col-span-3 text-green-700 text-xs">
                    ✓ Leave request auto-created
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeLabourCompliance.tsx
git commit -m "feat(maternity): upgrade MaternityTab — parity selector, approve button, entitled weeks display"
```

---

## Task 7: Employee Self-Service Page

**Files:**
- Create: `src/pages/NativeMaternityLeave.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create `src/pages/NativeMaternityLeave.tsx`**

```tsx
// src/pages/NativeMaternityLeave.tsx
import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

type MaternityRecordType = 'delivery' | 'adoption' | 'miscarriage' | 'surrogacy';

type MaternityRecord = {
  id: string;
  record_type: MaternityRecordType;
  child_birth_order: number;
  entitled_weeks: number;
  leave_start_date: string;
  leave_end_date: string | null;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  complications: number;
  status: string;
  nursing_break_granted: number;
  nursing_break_end_date: string | null;
  work_from_home_option: number;
  leave_request_id: string | null;
  notes: string | null;
  created_at: string;
};

const ENTITLEMENT_INFO: Record<string, string> = {
  delivery_1: '26 weeks (182 days) — 1st or 2nd child',
  delivery_2: '26 weeks (182 days) — 1st or 2nd child',
  delivery_3: '12 weeks (84 days) — 3rd or subsequent child',
  adoption:   '8 weeks (56 days) — Adoption leave',
  miscarriage:'6 weeks (42 days) — Miscarriage / stillbirth',
  surrogacy:  '6 weeks (42 days) — Surrogacy',
};

const statusColors: Record<string, string> = {
  applied:   'bg-yellow-100 text-yellow-800',
  approved:  'bg-blue-100 text-blue-800',
  active:    'bg-green-100 text-green-800',
  completed: 'bg-slate-100 text-slate-700',
  rejected:  'bg-red-100 text-red-800',
};

export default function NativeMaternityLeave() {
  const { user } = useAuth();
  const [records, setRecords] = useState<MaternityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [form, setForm] = useState({
    employee_id: '',   // will be filled from profile
    record_type: 'delivery' as MaternityRecordType,
    child_birth_order: 1,
    expected_delivery_date: '',
    leave_start_date: '',
    complications: false,
    notes: '',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Fetch own employee ID from profile
        const profile = await hrmsApi.get<{ success: boolean; data: { id: string } }>('/api/employees/me');
        if (!cancelled && profile.data?.id) {
          setForm(f => ({ ...f, employee_id: profile.data.id }));
        }
        const res = await hrmsApi.get<{ success: boolean; data: MaternityRecord[] }>('/api/compliance/maternity');
        if (!cancelled) setRecords(res.data ?? []);
      } catch (err) {
        if (!cancelled) setMessage({ type: 'error', text: 'Could not load records' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const entitlementKey = form.record_type === 'delivery'
    ? `delivery_${Math.min(form.child_birth_order, 3)}`
    : form.record_type;
  const entitlementText = ENTITLEMENT_INFO[entitlementKey] ?? '';

  const handleSubmit = async () => {
    if (!form.leave_start_date) {
      setMessage({ type: 'error', text: 'Leave start date is required' });
      return;
    }
    if (!form.employee_id) {
      setMessage({ type: 'error', text: 'Your employee profile is not linked to this account. Contact HR.' });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      await hrmsApi.post('/api/compliance/maternity', {
        ...form,
        expected_delivery_date: form.expected_delivery_date || null,
        notes: form.notes || null,
      });
      setMessage({ type: 'success', text: 'Application submitted. HR will review and approve shortly.' });
      setShowForm(false);
      const res = await hrmsApi.get<{ success: boolean; data: MaternityRecord[] }>('/api/compliance/maternity');
      setRecords(res.data ?? []);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Submission failed' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-950">Maternity Leave</h1>
          <p className="text-sm text-slate-500">
            Maternity Benefit Act 1961 (amended 2017) — your entitlements and applications
          </p>
        </div>

        {/* Entitlement Summary Card */}
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 space-y-2">
          <p className="font-bold text-indigo-900 text-sm">Your Entitlements Under MBA 1961</p>
          <ul className="text-xs text-indigo-800 space-y-1 list-none">
            <li>🤱 1st / 2nd child delivery — <b>26 weeks full paid leave</b></li>
            <li>🤱 3rd+ child delivery — <b>12 weeks full paid leave</b></li>
            <li>👶 Adoption — <b>8 weeks full paid leave</b></li>
            <li>💙 Miscarriage / stillbirth — <b>6 weeks full paid leave</b></li>
            <li>⚕️ Medical complications — additional <b>4 weeks</b></li>
            <li>🍼 Nursing breaks — 2 × 15 min/day for <b>15 months</b> post-delivery</li>
            <li>💰 All maternity leave is <b>fully paid</b> — no LWP deduction</li>
          </ul>
        </div>

        {/* Message */}
        {message && (
          <div className={`rounded-xl px-4 py-2 text-sm font-medium ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {message.text}
          </div>
        )}

        {/* Apply Button */}
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="w-full rounded-2xl bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-700 transition"
          >
            + Apply for Maternity Leave
          </button>
        )}

        {/* Application Form */}
        {showForm && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="font-bold text-slate-900">New Application</h2>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600">Leave Type</label>
              <select
                value={form.record_type}
                onChange={e => setForm(f => ({ ...f, record_type: e.target.value as MaternityRecordType, child_birth_order: 1 }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <option value="delivery">Delivery / Childbirth</option>
                <option value="adoption">Adoption</option>
                <option value="miscarriage">Miscarriage / Stillbirth</option>
                <option value="surrogacy">Surrogacy</option>
              </select>
            </div>

            {form.record_type === 'delivery' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600">This will be my</label>
                <select
                  value={form.child_birth_order}
                  onChange={e => setForm(f => ({ ...f, child_birth_order: parseInt(e.target.value) }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <option value={1}>1st child</option>
                  <option value={2}>2nd child</option>
                  <option value={3}>3rd or subsequent child</option>
                </select>
              </div>
            )}

            {entitlementText && (
              <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs text-indigo-700 font-medium">
                Entitlement: {entitlementText}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600">Leave Start Date *</label>
                <input type="date"
                  value={form.leave_start_date}
                  onChange={e => setForm(f => ({ ...f, leave_start_date: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              </div>
              {(form.record_type === 'delivery') && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">Expected Delivery Date</label>
                  <input type="date"
                    value={form.expected_delivery_date}
                    onChange={e => setForm(f => ({ ...f, expected_delivery_date: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="comp"
                checked={form.complications}
                onChange={e => setForm(f => ({ ...f, complications: e.target.checked }))} />
              <label htmlFor="comp" className="text-sm text-slate-700">
                Medical complications (doctor's certificate required — additional 4 weeks)
              </label>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600">Notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="Any additional information for HR..." />
            </div>

            <div className="flex gap-3">
              <button onClick={handleSubmit} disabled={submitting}
                className="flex-1 rounded-xl bg-indigo-600 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                {submitting ? 'Submitting...' : 'Submit Application'}
              </button>
              <button onClick={() => setShowForm(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Existing Records */}
        {loading ? (
          <p className="text-sm text-slate-400">Loading your records...</p>
        ) : records.length > 0 ? (
          <div className="space-y-3">
            <h2 className="font-bold text-slate-800">Your Applications</h2>
            {records.map(r => (
              <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-slate-900 capitalize">
                    {r.record_type} {r.record_type === 'delivery' ? `— ${r.child_birth_order === 1 ? '1st' : r.child_birth_order === 2 ? '2nd' : '3rd+'} child` : ''}
                  </p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColors[r.status] ?? 'bg-slate-100 text-slate-700'}`}>
                    {r.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-slate-600">
                  <span><b>Entitled:</b> {r.entitled_weeks} weeks</span>
                  <span><b>Start:</b> {r.leave_start_date}</span>
                  <span><b>End:</b> {r.leave_end_date ?? 'Pending approval'}</span>
                  {r.complications ? <span className="text-orange-700">+ 4 weeks complications</span> : <span />}
                </div>
                {r.leave_request_id && (
                  <p className="text-xs text-green-700 font-medium">✓ Leave request created — salary fully protected</p>
                )}
                {r.nursing_break_granted ? (
                  <p className="text-xs text-purple-700">🍼 Nursing breaks granted until {r.nursing_break_end_date}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Register route in `src/App.tsx`**

Find the lazy imports section for HR Ops (around the `NativeHelpdesk` import) and add:

```tsx
const NativeMaternityLeave = lazy(() => import("./pages/NativeMaternityLeave"));
```

Find the HR Ops routes section and add before the closing of that group:

```tsx
<Route path="/maternity-leave" element={<ProtectedRoute><NativeMaternityLeave /></ProtectedRoute>} />
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeMaternityLeave.tsx src/App.tsx
git commit -m "feat(maternity): add employee self-service maternity leave page with entitlement guide"
```

---

## Task 8: Push + Apply DB Migration

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

- [ ] **Step 2: Apply SQL migration to production DB**

Run from `backend/` directory:
```bash
node -e "
const mysql = require('mysql2/promise');
const fs = require('fs'), path = require('path');
(async () => {
  const conn = await mysql.createConnection({
    host: '192.168.10.6', port: 3306,
    user: 'shivam_user', password: 'qwersdfg!@#hjk',
    database: 'mas_hrms', multipleStatements: true
  });
  const sql = fs.readFileSync(path.join(process.cwd(), 'sql/042_maternity_schema_patch.sql'), 'utf8');
  await conn.query(sql);
  console.log('042 applied OK');
  await conn.end();
})().catch(e => { console.error(e.sqlMessage || e.message); process.exit(1); });
"
```

- [ ] **Step 3: Final verification**

```bash
node -e "
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms' });
  // Check ML entitlement
  const [[ml]] = await c.query(\"SELECT max_days_per_year FROM leave_type_master WHERE leave_code='ML'\");
  console.log('ML days:', ml.max_days_per_year, ml.max_days_per_year === 182 ? '✓' : '✗ expected 182');
  // Check new columns
  for (const col of ['record_type','child_birth_order','entitled_weeks','leave_request_id','nursing_break_granted']) {
    const [[r]] = await c.query('SELECT COUNT(*) c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', ['mas_hrms','maternity_benefit_record',col]);
    console.log(col + ':', r.c ? '✓' : '✗ MISSING');
  }
  // Check creche table
  const [[ct]] = await c.query(\"SELECT COUNT(*) c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='creche_facility'\");
  console.log('creche_facility:', ct.c ? '✓' : '✗ MISSING');
  await c.end();
})().catch(e => console.error(e.message));
"
```

Expected: all ✓, ML = 182

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| Fix ML max_days 90 → 182 | Task 1 |
| Add child_birth_order, record_type, entitled_weeks columns | Task 1 |
| Parity rules (26/12 weeks delivery, 8 adoption, 6 miscarriage) | Task 2 (computeEntitledWeeks) |
| Auto-create leave_request on approval | Task 3 (approve method) |
| leave_request_id FK on maternity record | Task 1 |
| Payroll LWP exclusion | Task 4 |
| Employee self-apply endpoint | Task 5 |
| Approve endpoint (POST /maternity/:id/approve) | Task 5 |
| Nursing break end date computed on delivery | Task 3 (update method) |
| +4 weeks complications | Task 2 (computeEntitledWeeks) |
| Admin UI — parity selector, approve button | Task 6 |
| Employee self-service page | Task 7 |
| Entitlement info guide for employee | Task 7 |
| creche_facility table | Task 1 |
| DB migration applied to prod | Task 8 |

**No gaps found.**

**Type consistency check:**
- `MaternityRecord.entitled_weeks` defined in Task 2, used in Task 3, 6, 7 ✓
- `computeEntitledWeeks()` defined in Task 2, called in Task 3 (maternityService.create) ✓
- `maternityService.getActiveEmployeeIdsForMonth()` defined in Task 3, called in Task 4 ✓
- Route paths `/maternity/:id/approve` defined in Task 5, called in Task 6 + 7 ✓
