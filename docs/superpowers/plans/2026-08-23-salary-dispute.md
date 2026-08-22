# Salary Dispute Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 3-stage salary dispute system where employees raise disputes, WFM+Payroll HR validate and calculate the differential, Payroll Head approves, and the differential is auto-applied as ARREAR in next month's payroll.

**Architecture:** New `salary-dispute` module following the `attendance.dispute.routes.ts` pattern. One service file for all business logic, one routes file for HTTP, one migration for the table. Frontend: Employee raise form + status tracker, Manager read-only team view, WFM review queue, Payroll Head queue. Arrear application hooks into existing `salary_prep_line_component` insert pattern.

**Tech Stack:** Express + TypeScript + mysql2 (backend), React 18 + shadcn/ui + TanStack Query (frontend), Lucide icons, work-inbox notification system.

## Global Constraints

- Follow existing module pattern: `backend/src/modules/<name>/<name>.service.ts` + `<name>.routes.ts`
- All DB writes are INSERT IGNORE or UPDATE — never DELETE salary data
- Status enum: `draft | pending_wfm | pending_payroll_head | approved | rejected | closed`
- Differential always stored as DECIMAL(10,2), never negative
- Mandatory remarks (min 10 chars) on every WFM and Payroll Head action
- Role gate: wfm + payroll_hr can review Stage 1; payroll_head reviews Stage 2
- Manager role: read-only view of their team disputes only
- Arrear applied as `component_code = 'ARREAR'` in `salary_prep_line_component`
- Next migration number: `434`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/sql/migrations/434_salary_dispute.sql` | CREATE | Table DDL + indexes |
| `backend/src/modules/salary-dispute/salary-dispute.service.ts` | CREATE | All business logic, differential calc, arrear application |
| `backend/src/modules/salary-dispute/salary-dispute.routes.ts` | CREATE | HTTP routes + role guards |
| `backend/src/app.ts` | MODIFY | Mount router |
| `src/pages/payroll/SalaryDisputePage.tsx` | CREATE | Employee raise form + my disputes list with timeline |
| `src/components/payroll/salary-dispute/SalaryDisputeReviewCard.tsx` | CREATE | WFM + Payroll Head review card (shared) |
| `src/pages/payroll/SalaryDisputeQueuePage.tsx` | CREATE | WFM/Payroll HR/Payroll Head queue |
| `src/pages/payroll/SalaryDisputeManagerView.tsx` | CREATE | Manager read-only team disputes view |
| `src/config/routes/payroll.routes.tsx` | MODIFY | Add 3 new routes |
| `src/components/layout/navConfig.tsx` | MODIFY | Add nav entry for dispute pages |

---

## Task 1 — Database Migration

**Files:**
- Create: `backend/sql/migrations/434_salary_dispute.sql`

**Interfaces:**
- Produces: `salary_dispute` table with all columns from spec

- [ ] **Step 1: Create migration file**

```sql
-- backend/sql/migrations/434_salary_dispute.sql
CREATE TABLE IF NOT EXISTS salary_dispute (
  id                        CHAR(36)      NOT NULL DEFAULT (UUID()),
  employee_id               CHAR(36)      NOT NULL,
  employee_code             VARCHAR(50)   NOT NULL,
  run_month                 VARCHAR(7)    NOT NULL COMMENT 'YYYY-MM of disputed payroll',
  dispute_type              ENUM(
    'MISSING_OT','INCORRECT_ATTENDANCE','REGULARIZATION_NOT_APPLIED',
    'LEAVE_NOT_ASSIGNED','INCENTIVE_MISSING','WRONG_DEDUCTION',
    'WRONG_COMPONENT_AMOUNT','SHIFT_ALLOWANCE_MISSING',
    'DOUBLE_DEDUCTION','WRONG_LWP_COUNT','OTHER'
  ) NOT NULL,
  affected_dates            JSON          NOT NULL COMMENT 'Array of YYYY-MM-DD strings',
  description               TEXT          NOT NULL,
  status                    ENUM(
    'draft','pending_wfm','pending_payroll_head','approved','rejected','closed'
  ) NOT NULL DEFAULT 'pending_wfm',
  manager_id                CHAR(36)      NULL COMMENT 'Reporting manager at raise time (view-only)',
  branch_id                 CHAR(36)      NOT NULL,
  process_id                CHAR(36)      NULL,
  -- WFM Stage
  wfm_corrective_json       JSON          NULL COMMENT 'Corrective details entered by WFM',
  differential_amount       DECIMAL(10,2) NULL,
  differential_basis        TEXT          NULL COMMENT 'How differential was calculated',
  wfm_remarks               TEXT          NULL,
  wfm_reviewed_at           DATETIME      NULL,
  wfm_reviewed_by           CHAR(36)      NULL,
  -- Payroll Head Stage
  payroll_head_remarks      TEXT          NULL,
  payroll_head_reviewed_at  DATETIME      NULL,
  payroll_head_reviewed_by  CHAR(36)      NULL,
  -- Arrear
  arrear_run_month          VARCHAR(7)    NULL COMMENT 'Month arrear will be/was paid',
  arrear_line_id            CHAR(36)      NULL COMMENT 'FK to salary_prep_line_component.id',
  -- Meta
  created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_emp_month_type (employee_id, run_month, dispute_type),
  KEY idx_employee   (employee_id),
  KEY idx_status     (status),
  KEY idx_branch     (branch_id),
  KEY idx_run_month  (run_month),
  KEY idx_manager    (manager_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Apply migration to dev database**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend
node -e "
const mysql = require('mysql2/promise');
const fs = require('fs');
const sql = fs.readFileSync('sql/migrations/434_salary_dispute.sql', 'utf8');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST || '192.168.10.6', port: 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'mas_hrms', multipleStatements: true });
  await c.query(sql);
  console.log('Migration 434 applied');
  await c.end();
})().catch(console.error);
" 2>&1
```
Expected: `Migration 434 applied`

- [ ] **Step 3: Commit**

```bash
git add backend/sql/migrations/434_salary_dispute.sql
git commit -m "feat(salary-dispute): migration 434 — salary_dispute table"
```

---

## Task 2 — Backend Service

**Files:**
- Create: `backend/src/modules/salary-dispute/salary-dispute.service.ts`

**Interfaces:**
- Consumes: `db` from `../../db/mysql.js`, `inboxService` from `../work-inbox/work-inbox.service.js`
- Produces:
  - `salaryDisputeService.raise(params): Promise<SalaryDispute>`
  - `salaryDisputeService.listMine(employeeId: string, filters): Promise<SalaryDispute[]>`
  - `salaryDisputeService.get(id: string): Promise<SalaryDispute | null>`
  - `salaryDisputeService.wfmReview(id: string, actorUserId: string, payload: WfmReviewPayload): Promise<SalaryDispute>`
  - `salaryDisputeService.payrollHeadReview(id: string, actorUserId: string, payload: PHReviewPayload): Promise<SalaryDispute>`
  - `salaryDisputeService.listQueue(role: string, branchId?: string): Promise<SalaryDispute[]>`
  - `salaryDisputeService.listManagerTeam(managerId: string): Promise<SalaryDispute[]>`
  - `salaryDisputeService.calculateDifferential(disputeId: string, correctiveJson: object): Promise<number>`
  - `salaryDisputeService.applyArrear(disputeId: string): Promise<void>`

- [ ] **Step 1: Create service file**

```typescript
// backend/src/modules/salary-dispute/salary-dispute.service.ts
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { inboxService } from "../work-inbox/work-inbox.service.js";

export type DisputeType =
  | "MISSING_OT" | "INCORRECT_ATTENDANCE" | "REGULARIZATION_NOT_APPLIED"
  | "LEAVE_NOT_ASSIGNED" | "INCENTIVE_MISSING" | "WRONG_DEDUCTION"
  | "WRONG_COMPONENT_AMOUNT" | "SHIFT_ALLOWANCE_MISSING"
  | "DOUBLE_DEDUCTION" | "WRONG_LWP_COUNT" | "OTHER";

export type DisputeStatus =
  | "draft" | "pending_wfm" | "pending_payroll_head"
  | "approved" | "rejected" | "closed";

export interface SalaryDispute {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name?: string;
  run_month: string;
  dispute_type: DisputeType;
  affected_dates: string[];
  description: string;
  status: DisputeStatus;
  manager_id: string | null;
  branch_id: string;
  process_id: string | null;
  wfm_corrective_json: object | null;
  differential_amount: number | null;
  differential_basis: string | null;
  wfm_remarks: string | null;
  wfm_reviewed_at: string | null;
  wfm_reviewed_by: string | null;
  payroll_head_remarks: string | null;
  payroll_head_reviewed_at: string | null;
  payroll_head_reviewed_by: string | null;
  arrear_run_month: string | null;
  arrear_line_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RaiseDisputeParams {
  employeeId: string;
  runMonth: string;
  disputeType: DisputeType;
  affectedDates: string[];
  description: string;
}

export interface WfmReviewPayload {
  action: "approve" | "reject";
  remarks: string;
  correctiveJson?: object;
  differentialAmount?: number;
  differentialBasis?: string;
}

export interface PHReviewPayload {
  action: "approve" | "reject";
  remarks: string;
}

function mapRow(row: Record<string, unknown>): SalaryDispute {
  return {
    ...row,
    affected_dates: typeof row.affected_dates === "string"
      ? JSON.parse(row.affected_dates) : (row.affected_dates as string[]) ?? [],
    wfm_corrective_json: typeof row.wfm_corrective_json === "string"
      ? JSON.parse(row.wfm_corrective_json) : row.wfm_corrective_json as object | null,
    differential_amount: row.differential_amount != null ? Number(row.differential_amount) : null,
  } as SalaryDispute;
}

async function getById(id: string): Promise<SalaryDispute | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT sd.*, e.full_name AS employee_name
       FROM salary_dispute sd
       JOIN employees e ON e.id = sd.employee_id
      WHERE sd.id = ? LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;
  return mapRow(rows[0] as Record<string, unknown>);
}

async function notifyRoles(
  roles: string[],
  itemType: string,
  title: string,
  description: string,
  entityId: string
): Promise<void> {
  const placeholders = roles.map(() => "?").join(",");
  const [users] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT ur.user_id FROM user_roles ur WHERE ur.active_status=1 AND ur.role_key IN (${placeholders})`,
    roles
  );
  await Promise.allSettled(
    (users as RowDataPacket[]).map((u) =>
      inboxService.createItem({
        user_id: String(u.user_id),
        type: itemType,
        title,
        description,
        entity_type: "salary_dispute",
        entity_id: entityId,
        action_url: `/payroll/salary-disputes/${entityId}`,
        priority: "high",
      })
    )
  );
}

export const salaryDisputeService = {
  async raise(params: RaiseDisputeParams): Promise<SalaryDispute> {
    const { employeeId, runMonth, disputeType, affectedDates, description } = params;

    if (description.trim().length < 20)
      throw new Error("Description must be at least 20 characters.");
    if (!affectedDates.length)
      throw new Error("At least one affected date is required.");

    // Get employee details
    const [[emp]] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.full_name, e.branch_id, e.process_id,
              e.reporting_manager_id
         FROM employees e WHERE e.id = ? LIMIT 1`,
      [employeeId]
    );
    if (!emp) throw new Error("Employee not found.");

    const id = randomUUID();
    await db.execute(
      `INSERT INTO salary_dispute
         (id, employee_id, employee_code, run_month, dispute_type,
          affected_dates, description, status, manager_id, branch_id, process_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_wfm', ?, ?, ?)`,
      [
        id, employeeId, (emp as any).employee_code, runMonth, disputeType,
        JSON.stringify(affectedDates), description.trim(),
        (emp as any).reporting_manager_id ?? null,
        (emp as any).branch_id, (emp as any).process_id ?? null,
      ]
    );

    const dispute = (await getById(id))!;

    // Notify WFM + Payroll HR of branch
    await notifyRoles(
      ["wfm", "payroll_hr", "payroll"],
      "SALARY_DISPUTE_WFM_PENDING",
      `Salary dispute: ${(emp as any).employee_code} — ${runMonth}`,
      `${(emp as any).full_name} raised a ${disputeType.replace(/_/g, " ")} dispute for ${runMonth}. Validate and enter corrective data.`,
      id
    );

    // Notify manager (view-only)
    if ((emp as any).reporting_manager_id) {
      const [[mgr]] = await db.execute<RowDataPacket[]>(
        `SELECT user_id FROM employees WHERE id = ? LIMIT 1`,
        [(emp as any).reporting_manager_id]
      );
      if (mgr && (mgr as any).user_id) {
        await inboxService.createItem({
          user_id: String((mgr as any).user_id),
          type: "SALARY_DISPUTE_MANAGER_VIEW",
          title: `Your team: ${(emp as any).employee_code} raised a salary dispute`,
          description: `${(emp as any).full_name} raised a ${disputeType.replace(/_/g, " ")} dispute for ${runMonth}. No action needed — for your awareness.`,
          entity_type: "salary_dispute",
          entity_id: id,
          action_url: `/payroll/salary-disputes/${id}`,
          priority: "normal",
        });
      }
    }

    return dispute;
  },

  async listMine(employeeId: string): Promise<SalaryDispute[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sd.*, e.full_name AS employee_name
         FROM salary_dispute sd
         JOIN employees e ON e.id = sd.employee_id
        WHERE sd.employee_id = ?
        ORDER BY sd.created_at DESC`,
      [employeeId]
    );
    return (rows as Record<string, unknown>[]).map(mapRow);
  },

  get: getById,

  async wfmReview(id: string, actorUserId: string, payload: WfmReviewPayload): Promise<SalaryDispute> {
    const dispute = await getById(id);
    if (!dispute) throw new Error("Dispute not found.");
    if (dispute.status !== "pending_wfm")
      throw new Error(`Cannot review: dispute is in status '${dispute.status}'.`);
    if (payload.remarks.trim().length < 10)
      throw new Error("Remarks must be at least 10 characters.");
    if (payload.action === "approve" && (payload.differentialAmount == null || payload.differentialAmount <= 0))
      throw new Error("Differential amount is required and must be > 0 to approve.");

    const newStatus: DisputeStatus = payload.action === "approve" ? "pending_payroll_head" : "rejected";

    await db.execute(
      `UPDATE salary_dispute SET
         status = ?,
         wfm_corrective_json = ?,
         differential_amount = ?,
         differential_basis = ?,
         wfm_remarks = ?,
         wfm_reviewed_at = NOW(),
         wfm_reviewed_by = ?
       WHERE id = ?`,
      [
        newStatus,
        payload.correctiveJson ? JSON.stringify(payload.correctiveJson) : null,
        payload.differentialAmount ?? null,
        payload.differentialBasis ?? null,
        payload.remarks.trim(),
        actorUserId,
        id,
      ]
    );

    const updated = (await getById(id))!;

    if (payload.action === "approve") {
      // Notify Payroll Head
      await notifyRoles(
        ["payroll_head"],
        "SALARY_DISPUTE_PAYHEAD_PENDING",
        `Salary dispute approved by WFM — ${dispute.employee_code} ${dispute.run_month}`,
        `WFM validated the ${dispute.dispute_type.replace(/_/g, " ")} dispute. Differential: ₹${payload.differentialAmount}. Awaiting your final approval.`,
        id
      );
    } else {
      // Notify employee of rejection
      await salaryDisputeService._notifyEmployee(dispute.employee_id, id,
        `Your salary dispute was rejected`,
        `Your ${dispute.dispute_type.replace(/_/g, " ")} dispute for ${dispute.run_month} was rejected by WFM. Remarks: ${payload.remarks}`
      );
    }

    return updated;
  },

  async payrollHeadReview(id: string, actorUserId: string, payload: PHReviewPayload): Promise<SalaryDispute> {
    const dispute = await getById(id);
    if (!dispute) throw new Error("Dispute not found.");
    if (dispute.status !== "pending_payroll_head")
      throw new Error(`Cannot review: dispute is in status '${dispute.status}'.`);
    if (payload.remarks.trim().length < 10)
      throw new Error("Remarks must be at least 10 characters.");

    const newStatus: DisputeStatus = payload.action === "approve" ? "approved" : "rejected";

    await db.execute(
      `UPDATE salary_dispute SET
         status = ?,
         payroll_head_remarks = ?,
         payroll_head_reviewed_at = NOW(),
         payroll_head_reviewed_by = ?
       WHERE id = ?`,
      [newStatus, payload.remarks.trim(), actorUserId, id]
    );

    const updated = (await getById(id))!;

    if (payload.action === "approve") {
      await salaryDisputeService.applyArrear(id);
    } else {
      await salaryDisputeService._notifyEmployee(dispute.employee_id, id,
        `Your salary dispute was rejected`,
        `Your ${dispute.dispute_type.replace(/_/g, " ")} dispute for ${dispute.run_month} was rejected. Remarks: ${payload.remarks}`
      );
    }

    return updated;
  },

  async applyArrear(disputeId: string): Promise<void> {
    const dispute = await getById(disputeId);
    if (!dispute || !dispute.differential_amount) return;

    // Find next open run for employee's branch (draft or processing)
    const [[run]] = await db.execute<RowDataPacket[]>(
      `SELECT spr.id, spr.run_month
         FROM salary_prep_run spr
        WHERE spr.status IN ('draft','processing')
          AND spr.run_month > ?
        ORDER BY spr.run_month ASC
        LIMIT 1`,
      [dispute.run_month]
    );

    const arrearRunMonth = run ? String((run as any).run_month) : null;

    // Insert ARREAR component if run exists, else queue for next run
    let arrearLineId: string | null = null;
    if (run) {
      // Find employee's salary_prep_line in that run
      const [[line]] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM salary_prep_line WHERE run_id = ? AND employee_id = ? LIMIT 1`,
        [(run as any).id, dispute.employee_id]
      );
      if (line) {
        arrearLineId = randomUUID();
        await db.execute(
          `INSERT INTO salary_prep_line_component (id, line_id, component_code, component_name, amount, component_type, notes)
           VALUES (?, ?, 'ARREAR', 'Salary Dispute Arrear', ?, 'earning', ?)`,
          [arrearLineId, (line as any).id, dispute.differential_amount,
           `Dispute #${dispute.id.substring(0, 8)} — ${dispute.dispute_type}`]
        );
        // Update line gross/net
        await db.execute(
          `UPDATE salary_prep_line
              SET gross_salary = gross_salary + ?,
                  net_salary   = net_salary   + ?
            WHERE id = ?`,
          [dispute.differential_amount, dispute.differential_amount, (line as any).id]
        );
      }
    }

    await db.execute(
      `UPDATE salary_dispute SET arrear_run_month = ?, arrear_line_id = ? WHERE id = ?`,
      [arrearRunMonth, arrearLineId, disputeId]
    );

    // Notify employee
    await salaryDisputeService._notifyEmployee(
      dispute.employee_id, disputeId,
      `Salary dispute approved — ₹${dispute.differential_amount} arrear`,
      arrearRunMonth
        ? `Your dispute for ${dispute.run_month} has been approved. ₹${dispute.differential_amount} will be added as arrear in your ${arrearRunMonth} salary.`
        : `Your dispute for ${dispute.run_month} has been approved. ₹${dispute.differential_amount} arrear will be applied in your next payroll run.`
    );
  },

  async listQueue(role: string, branchId?: string): Promise<SalaryDispute[]> {
    const statusFilter = role === "payroll_head" ? "pending_payroll_head" : "pending_wfm";
    const params: unknown[] = [statusFilter];
    let branchSql = "";
    if (branchId) { branchSql = " AND sd.branch_id = ?"; params.push(branchId); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sd.*, e.full_name AS employee_name
         FROM salary_dispute sd
         JOIN employees e ON e.id = sd.employee_id
        WHERE sd.status = ? ${branchSql}
        ORDER BY sd.created_at ASC`,
      params
    );
    return (rows as Record<string, unknown>[]).map(mapRow);
  },

  async listManagerTeam(managerId: string): Promise<SalaryDispute[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sd.*, e.full_name AS employee_name
         FROM salary_dispute sd
         JOIN employees e ON e.id = sd.employee_id
        WHERE e.reporting_manager_id = (SELECT id FROM employees WHERE reporting_manager_id IS NOT NULL AND id = (SELECT employee_id FROM user_roles WHERE user_id = ? LIMIT 1) LIMIT 1)
           OR e.manager_id = (SELECT id FROM employees WHERE id = (SELECT employee_id FROM user_roles WHERE user_id = ? LIMIT 1) LIMIT 1)
        ORDER BY sd.created_at DESC`,
      [managerId, managerId]
    );
    return (rows as Record<string, unknown>[]).map(mapRow);
  },

  async _notifyEmployee(employeeId: string, disputeId: string, title: string, description: string): Promise<void> {
    const [[eu]] = await db.execute<RowDataPacket[]>(
      `SELECT user_id FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    if (eu && (eu as any).user_id) {
      await inboxService.createItem({
        user_id: String((eu as any).user_id),
        type: "SALARY_DISPUTE_RESOLVED",
        title,
        description,
        entity_type: "salary_dispute",
        entity_id: disputeId,
        action_url: `/my/salary-disputes`,
        priority: "high",
      });
    }
  },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend
npx tsc --noEmit 2>&1 | grep "salary-dispute"
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/salary-dispute/salary-dispute.service.ts
git commit -m "feat(salary-dispute): service — raise, wfm-review, payroll-head-review, arrear"
```

---

## Task 3 — Backend Routes + App Wiring

**Files:**
- Create: `backend/src/modules/salary-dispute/salary-dispute.routes.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `salaryDisputeService` from Task 2
- Produces: REST endpoints at `/api/salary-disputes`

- [ ] **Step 1: Create routes file**

```typescript
// backend/src/modules/salary-dispute/salary-dispute.routes.ts
import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { salaryDisputeService } from "./salary-dispute.service.js";

export const salaryDisputeRouter = Router();
salaryDisputeRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: any) => fn(req, res).catch(next);

// Employee: raise dispute
salaryDisputeRouter.post("/", h(async (req, res) => {
  const { runMonth, disputeType, affectedDates, description } = req.body;
  const employeeId = req.authUser!.employee_id;
  if (!employeeId) return res.status(400).json({ success: false, message: "No employee linked to this account." });
  const dispute = await salaryDisputeService.raise({ employeeId, runMonth, disputeType, affectedDates, description });
  res.status(201).json({ success: true, data: dispute });
}));

// Employee: my disputes
salaryDisputeRouter.get("/my", h(async (req, res) => {
  const employeeId = req.authUser!.employee_id;
  if (!employeeId) return res.status(400).json({ success: false, message: "No employee linked." });
  const disputes = await salaryDisputeService.listMine(employeeId);
  res.json({ success: true, data: disputes });
}));

// WFM / Payroll HR queue
salaryDisputeRouter.get("/queue/wfm", requireRole("wfm", "payroll_hr", "payroll", "super_admin"),
  h(async (req, res) => {
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const disputes = await salaryDisputeService.listQueue("wfm", branchId);
    res.json({ success: true, data: disputes });
  })
);

// Payroll Head queue
salaryDisputeRouter.get("/queue/payroll-head", requireRole("payroll_head", "super_admin"),
  h(async (req, res) => {
    const disputes = await salaryDisputeService.listQueue("payroll_head");
    res.json({ success: true, data: disputes });
  })
);

// Manager read-only team view
salaryDisputeRouter.get("/queue/manager", requireRole("manager", "branch_head", "process_manager", "super_admin"),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const disputes = await salaryDisputeService.listManagerTeam(userId);
    res.json({ success: true, data: disputes });
  })
);

// Get single dispute (all roles can view their own or scope-permitted)
salaryDisputeRouter.get("/:id", h(async (req, res) => {
  const dispute = await salaryDisputeService.get(req.params.id);
  if (!dispute) return res.status(404).json({ success: false, message: "Not found." });
  res.json({ success: true, data: dispute });
}));

// WFM review (Stage 1)
salaryDisputeRouter.post("/:id/wfm-review", requireRole("wfm", "payroll_hr", "payroll", "super_admin"),
  h(async (req, res) => {
    const dispute = await salaryDisputeService.wfmReview(
      req.params.id, req.authUser!.id, req.body
    );
    res.json({ success: true, data: dispute });
  })
);

// Payroll Head review (Stage 2)
salaryDisputeRouter.post("/:id/payroll-head-review", requireRole("payroll_head", "super_admin"),
  h(async (req, res) => {
    const dispute = await salaryDisputeService.payrollHeadReview(
      req.params.id, req.authUser!.id, req.body
    );
    res.json({ success: true, data: dispute });
  })
);
```

- [ ] **Step 2: Mount in app.ts**

Find the block where `attendanceDisputeRouter` is mounted and add below it:

```typescript
import { salaryDisputeRouter } from "./modules/salary-dispute/salary-dispute.routes.js";
// ...
app.use("/api/salary-disputes", salaryDisputeRouter);
```

- [ ] **Step 3: TypeScript check**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend
npx tsc --noEmit 2>&1 | grep "salary-dispute"
```
Expected: no errors.

- [ ] **Step 4: Smoke test**

```bash
# Start server then:
curl -s http://localhost:3000/api/salary-disputes/my \
  -H "Authorization: Bearer <token>" | head -100
```
Expected: `{"success":true,"data":[]}`

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/salary-dispute/ backend/src/app.ts
git commit -m "feat(salary-dispute): routes + mount in app.ts"
```

---

## Task 4 — Employee Raise Dispute + My Disputes Page

**Files:**
- Create: `src/pages/payroll/SalaryDisputePage.tsx`

**Interfaces:**
- Consumes: `POST /api/salary-disputes`, `GET /api/salary-disputes/my`

- [ ] **Step 1: Create page**

```tsx
// src/pages/payroll/SalaryDisputePage.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, CheckCircle2, Clock, XCircle, ChevronRight,
  Calendar, CreditCard, IndianRupee, FileText, Plus
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";

type DisputeStatus = "pending_wfm"|"pending_payroll_head"|"approved"|"rejected"|"closed";
type DisputeType = "MISSING_OT"|"INCORRECT_ATTENDANCE"|"REGULARIZATION_NOT_APPLIED"|
  "LEAVE_NOT_ASSIGNED"|"INCENTIVE_MISSING"|"WRONG_DEDUCTION"|
  "WRONG_COMPONENT_AMOUNT"|"SHIFT_ALLOWANCE_MISSING"|"DOUBLE_DEDUCTION"|"WRONG_LWP_COUNT"|"OTHER";

const DISPUTE_TYPES: { value: DisputeType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: "MISSING_OT", label: "Missing Overtime", icon: <Clock className="w-4 h-4" />, description: "Overtime worked but not paid" },
  { value: "INCORRECT_ATTENDANCE", label: "Incorrect Attendance", icon: <Calendar className="w-4 h-4" />, description: "Wrong P/A/HD status on a day" },
  { value: "REGULARIZATION_NOT_APPLIED", label: "Regularization Not Applied", icon: <CheckCircle2 className="w-4 h-4" />, description: "Approved regularization not reflected in salary" },
  { value: "LEAVE_NOT_ASSIGNED", label: "Leave Not Assigned", icon: <Calendar className="w-4 h-4" />, description: "Leave marked as LWP instead of approved leave" },
  { value: "INCENTIVE_MISSING", label: "Incentive Missing", icon: <IndianRupee className="w-4 h-4" />, description: "Incentive amount not credited" },
  { value: "WRONG_DEDUCTION", label: "Wrong Deduction", icon: <CreditCard className="w-4 h-4" />, description: "Incorrect amount deducted" },
  { value: "DOUBLE_DEDUCTION", label: "Double Deduction", icon: <CreditCard className="w-4 h-4" />, description: "Same deduction taken twice" },
  { value: "WRONG_LWP_COUNT", label: "Incorrect LWP Days", icon: <AlertCircle className="w-4 h-4" />, description: "More LWP days deducted than actual" },
  { value: "OTHER", label: "Other", icon: <FileText className="w-4 h-4" />, description: "Any other salary discrepancy" },
];

const STATUS_CONFIG: Record<DisputeStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending_wfm:          { label: "WFM Review", color: "bg-amber-100 text-amber-800 border-amber-200", icon: <Clock className="w-3 h-3" /> },
  pending_payroll_head: { label: "Payroll Head", color: "bg-blue-100 text-blue-800 border-blue-200", icon: <Clock className="w-3 h-3" /> },
  approved:             { label: "Approved", color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected:             { label: "Rejected", color: "bg-red-100 text-red-800 border-red-200", icon: <XCircle className="w-3 h-3" /> },
  closed:               { label: "Closed", color: "bg-slate-100 text-slate-600 border-slate-200", icon: <CheckCircle2 className="w-3 h-3" /> },
};

// Rolling 24 months for month picker
const MONTH_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(); d.setMonth(d.getMonth() - i - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
});

function unwrap<T>(r: unknown): T {
  return ((r as any)?.data?.data ?? (r as any)?.data ?? r) as T;
}

function RaiseDisputeForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [runMonth, setRunMonth] = useState("");
  const [disputeType, setDisputeType] = useState<DisputeType | "">("");
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      hrmsApi.post("/api/salary-disputes", {
        runMonth, disputeType, affectedDates: [], description,
      }),
    onSuccess: () => {
      toast.success("Dispute raised successfully. WFM has been notified.");
      qc.invalidateQueries({ queryKey: ["my-salary-disputes"] });
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (step === 1) return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-700 mb-2">Which month's salary is incorrect?</p>
        <Select value={runMonth} onValueChange={setRunMonth}>
          <SelectTrigger><SelectValue placeholder="Select month" /></SelectTrigger>
          <SelectContent>
            {MONTH_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button className="w-full" disabled={!runMonth} onClick={() => setStep(2)}>
        Next <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  );

  if (step === 2) return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">What is the issue?</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {DISPUTE_TYPES.map(dt => (
          <button key={dt.value}
            onClick={() => setDisputeType(dt.value)}
            className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors
              ${disputeType === dt.value
                ? "border-blue-500 bg-blue-50"
                : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}
          >
            <span className={`mt-0.5 ${disputeType === dt.value ? "text-blue-600" : "text-slate-500"}`}>{dt.icon}</span>
            <div>
              <p className="text-xs font-semibold text-slate-800">{dt.label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{dt.description}</p>
            </div>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
        <Button className="flex-1" disabled={!disputeType} onClick={() => setStep(3)}>
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-700 mb-1">
          Describe the issue <span className="text-slate-400 font-normal">(minimum 20 characters)</span>
        </p>
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Explain what was wrong in your salary and what it should have been..."
          rows={4}
          className="resize-none"
        />
        <p className="text-xs text-slate-400 mt-1 text-right">{description.length} / 20 min</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
        <Button
          className="flex-1 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700"
          disabled={description.trim().length < 20 || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Submitting…" : "Submit Dispute"}
        </Button>
      </div>
    </div>
  );
}

export default function SalaryDisputePage() {
  const [showRaise, setShowRaise] = useState(false);

  const { data: raw, isLoading } = useQuery({
    queryKey: ["my-salary-disputes"],
    queryFn: () => hrmsApi.get("/api/salary-disputes/my"),
    staleTime: 30_000,
  });
  const disputes = unwrap<any[]>(raw) ?? [];

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 p-5 text-white flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Salary Disputes</h1>
            <p className="text-red-100 text-sm mt-0.5">Raise a dispute if your salary is incorrect</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="bg-white/20 hover:bg-white/30 text-white border-white/30"
            onClick={() => setShowRaise(v => !v)}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Raise Dispute
          </Button>
        </div>

        {/* Raise form */}
        {showRaise && (
          <Card className="rounded-2xl border-red-200 bg-red-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-red-800">New Salary Dispute</CardTitle>
            </CardHeader>
            <CardContent>
              <RaiseDisputeForm onSuccess={() => setShowRaise(false)} />
            </CardContent>
          </Card>
        )}

        {/* My disputes list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : disputes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-slate-400">
            <FileText className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No salary disputes raised yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d: any) => {
              const cfg = STATUS_CONFIG[d.status as DisputeStatus];
              return (
                <Card key={d.id} className="rounded-2xl hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">
                          {DISPUTE_TYPES.find(t => t.value === d.dispute_type)?.label ?? d.dispute_type}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">Month: {d.run_month}</p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{d.description}</p>
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                        <Badge className={`text-[10px] font-bold border ${cfg.color} flex items-center gap-1`}>
                          {cfg.icon}{cfg.label}
                        </Badge>
                        {d.differential_amount && d.status === "approved" && (
                          <span className="text-xs font-bold text-emerald-600">+₹{Number(d.differential_amount).toLocaleString("en-IN")}</span>
                        )}
                      </div>
                    </div>
                    {/* Mini timeline */}
                    <div className="flex items-center gap-1.5 mt-3">
                      {(["pending_wfm","pending_payroll_head","approved"] as DisputeStatus[]).map((s, i) => {
                        const statusOrder = ["pending_wfm","pending_payroll_head","approved","rejected"];
                        const currentIdx = statusOrder.indexOf(d.status);
                        const isComplete = i < currentIdx;
                        const isCurrent = d.status === s;
                        return (
                          <div key={s} className="flex items-center gap-1">
                            <div className={`w-2 h-2 rounded-full ${
                              d.status === "rejected" && i <= currentIdx ? "bg-red-400"
                              : isComplete || isCurrent ? "bg-blue-500"
                              : "bg-slate-200"
                            }`} />
                            {i < 2 && <div className={`h-px w-6 ${isComplete ? "bg-blue-300" : "bg-slate-200"}`} />}
                          </div>
                        );
                      })}
                      <span className="text-[10px] text-slate-400 ml-1">{new Date(d.created_at).toLocaleDateString("en-IN")}</span>
                    </div>
                    {d.arrear_run_month && (
                      <p className="text-[10px] text-emerald-600 font-medium mt-1.5">
                        Arrear will be paid in {d.arrear_run_month} salary
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest
npx tsc --noEmit 2>&1 | grep "SalaryDispute"
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/payroll/SalaryDisputePage.tsx
git commit -m "feat(salary-dispute): employee raise form + my disputes page"
```

---

## Task 5 — WFM / Payroll Head Review Queue Page

**Files:**
- Create: `src/pages/payroll/SalaryDisputeQueuePage.tsx`

**Interfaces:**
- Consumes: `GET /api/salary-disputes/queue/wfm`, `GET /api/salary-disputes/queue/payroll-head`
- Consumes: `POST /api/salary-disputes/:id/wfm-review`, `POST /api/salary-disputes/:id/payroll-head-review`

- [ ] **Step 1: Create queue page**

```tsx
// src/pages/payroll/SalaryDisputeQueuePage.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, AlertTriangle, IndianRupee, Calendar, Clock
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";

function unwrap<T>(r: unknown): T {
  return ((r as any)?.data?.data ?? (r as any)?.data ?? r) as T;
}

function ReviewDialog({
  dispute,
  role,
  onClose,
}: {
  dispute: any;
  role: "wfm" | "payroll_head";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
  const [remarks, setRemarks] = useState("");
  const [differential, setDifferential] = useState<string>("");
  const [correctiveSummary, setCorrectiveSummary] = useState("");

  const endpoint = role === "wfm"
    ? `/api/salary-disputes/${dispute.id}/wfm-review`
    : `/api/salary-disputes/${dispute.id}/payroll-head-review`;

  const mutation = useMutation({
    mutationFn: () =>
      hrmsApi.post(endpoint, {
        action,
        remarks,
        ...(role === "wfm" && action === "approve" ? {
          differentialAmount: parseFloat(differential),
          differentialBasis: correctiveSummary,
          correctiveJson: { summary: correctiveSummary },
        } : {}),
      }),
    onSuccess: () => {
      toast.success(action === "approve" ? "Dispute approved and forwarded." : "Dispute rejected.");
      qc.invalidateQueries({ queryKey: ["salary-dispute-queue"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg rounded-2xl shadow-2xl">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl p-4">
          <CardTitle className="text-white text-base">Review Salary Dispute</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">
          {/* Dispute summary */}
          <div className="rounded-xl bg-slate-50 border p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Employee</span>
              <span className="font-medium">{dispute.employee_code} — {dispute.employee_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Month</span>
              <span className="font-medium">{dispute.run_month}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Type</span>
              <span className="font-medium">{dispute.dispute_type.replace(/_/g, " ")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Raised On</span>
              <span className="font-medium">{new Date(dispute.created_at).toLocaleDateString("en-IN")}</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-1">Employee's Description</p>
            <p className="text-sm text-slate-700 bg-amber-50 rounded-xl p-3 border border-amber-100">{dispute.description}</p>
          </div>
          {/* WFM: show previous remarks if payroll head reviewing */}
          {role === "payroll_head" && dispute.wfm_remarks && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">WFM Remarks</p>
              <p className="text-sm text-slate-700 bg-slate-50 rounded-xl p-3 border">{dispute.wfm_remarks}</p>
              {dispute.differential_amount && (
                <p className="text-sm font-bold text-emerald-700 mt-1.5">
                  Validated Differential: +₹{Number(dispute.differential_amount).toLocaleString("en-IN")}
                </p>
              )}
            </div>
          )}
          {/* Action selector */}
          <div className="flex gap-2">
            <button
              onClick={() => setAction("approve")}
              className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5
                ${action === "approve" ? "bg-emerald-600 text-white border-emerald-600" : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"}`}
            >
              <CheckCircle2 className="w-4 h-4" /> Approve
            </button>
            <button
              onClick={() => setAction("reject")}
              className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5
                ${action === "reject" ? "bg-red-600 text-white border-red-600" : "border-red-300 text-red-700 hover:bg-red-50"}`}
            >
              <XCircle className="w-4 h-4" /> Reject
            </button>
          </div>
          {/* WFM: differential entry on approve */}
          {role === "wfm" && action === "approve" && (
            <div className="space-y-2">
              <div>
                <label className="text-xs font-semibold text-slate-600">Differential Amount (₹) *</label>
                <Input
                  type="number"
                  min="1"
                  value={differential}
                  onChange={e => setDifferential(e.target.value)}
                  placeholder="Enter corrected amount difference"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Corrective Summary *</label>
                <Textarea
                  value={correctiveSummary}
                  onChange={e => setCorrectiveSummary(e.target.value)}
                  placeholder="What was wrong and what the correct value is..."
                  rows={2}
                  className="mt-1 resize-none"
                />
              </div>
            </div>
          )}
          {/* Remarks */}
          {action && (
            <div>
              <label className="text-xs font-semibold text-slate-600">Remarks * (min 10 chars)</label>
              <Textarea
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                placeholder={action === "approve" ? "Confirm what was validated..." : "Reason for rejection..."}
                rows={3}
                className="mt-1 resize-none"
              />
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button
              className="flex-1"
              disabled={
                !action || remarks.trim().length < 10 || mutation.isPending ||
                (role === "wfm" && action === "approve" && (!differential || parseFloat(differential) <= 0))
              }
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SalaryDisputeQueuePage() {
  const { roleKeys } = useWorkforceAccess();
  const isPayrollHead = roleKeys.includes("payroll_head") || roleKeys.includes("super_admin");
  const [reviewing, setReviewing] = useState<any | null>(null);

  const endpoint = isPayrollHead
    ? "/api/salary-disputes/queue/payroll-head"
    : "/api/salary-disputes/queue/wfm";

  const { data: raw, isLoading } = useQuery({
    queryKey: ["salary-dispute-queue", isPayrollHead ? "ph" : "wfm"],
    queryFn: () => hrmsApi.get(endpoint),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const disputes = unwrap<any[]>(raw) ?? [];

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-5">
        <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white">
          <h1 className="text-xl font-bold">Salary Dispute Queue</h1>
          <p className="text-blue-100 text-sm mt-0.5">
            {isPayrollHead ? "Final approval queue — Payroll Head" : "Validate and enter corrective data — WFM / Payroll HR"}
          </p>
        </div>
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
        ) : disputes.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-slate-400">
            <CheckCircle2 className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No disputes pending your review.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d: any) => (
              <Card key={d.id} className="rounded-2xl hover:shadow-md transition-shadow cursor-pointer" onClick={() => setReviewing(d)}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800">{d.employee_code} — {d.employee_name}</p>
                      <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200">
                        {d.dispute_type.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">Month: {d.run_month}</p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{d.description}</p>
                    {isPayrollHead && d.differential_amount && (
                      <p className="text-xs font-bold text-emerald-700 mt-1">Differential: +₹{Number(d.differential_amount).toLocaleString("en-IN")}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <span className="text-xs text-slate-400">{new Date(d.created_at).toLocaleDateString("en-IN")}</span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {reviewing && (
          <ReviewDialog
            dispute={reviewing}
            role={isPayrollHead ? "payroll_head" : "wfm"}
            onClose={() => setReviewing(null)}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
```

Fix missing import: add `ChevronRight` to the import list.

- [ ] **Step 2: TypeScript check**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest
npx tsc --noEmit 2>&1 | grep "SalaryDisputeQueue"
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/payroll/SalaryDisputeQueuePage.tsx
git commit -m "feat(salary-dispute): WFM and Payroll Head review queue"
```

---

## Task 6 — Manager Team View + Routes + Nav

**Files:**
- Create: `src/pages/payroll/SalaryDisputeManagerView.tsx`
- Modify: `src/config/routes/payroll.routes.tsx`
- Modify: `src/components/layout/navConfig.tsx`

- [ ] **Step 1: Create manager view (read-only)**

```tsx
// src/pages/payroll/SalaryDisputeManagerView.tsx
import { useQuery } from "@tanstack/react-query";
import { FileText, Clock, CheckCircle2, XCircle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { hrmsApi } from "@/lib/hrmsApi";

function unwrap<T>(r: unknown): T {
  return ((r as any)?.data?.data ?? (r as any)?.data ?? r) as T;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending_wfm:          <Clock className="w-3 h-3" />,
  pending_payroll_head: <Clock className="w-3 h-3" />,
  approved:             <CheckCircle2 className="w-3 h-3" />,
  rejected:             <XCircle className="w-3 h-3" />,
};
const STATUS_COLORS: Record<string, string> = {
  pending_wfm: "bg-amber-100 text-amber-800 border-amber-200",
  pending_payroll_head: "bg-blue-100 text-blue-800 border-blue-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function SalaryDisputeManagerView() {
  const { data: raw, isLoading } = useQuery({
    queryKey: ["manager-salary-disputes"],
    queryFn: () => hrmsApi.get("/api/salary-disputes/queue/manager"),
    staleTime: 60_000,
  });
  const disputes = unwrap<any[]>(raw) ?? [];
  const open = disputes.filter(d => d.status !== "approved" && d.status !== "rejected" && d.status !== "closed");

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        <div className="rounded-2xl bg-gradient-to-r from-slate-700 to-slate-900 p-5 text-white">
          <h1 className="text-xl font-bold">Team Salary Disputes</h1>
          <p className="text-slate-300 text-sm mt-0.5">
            {open.length} open dispute{open.length !== 1 ? "s" : ""} from your team — for your awareness
          </p>
        </div>
        {isLoading ? (
          <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
        ) : disputes.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-slate-400">
            <FileText className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No salary disputes from your team.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d: any) => (
              <Card key={d.id} className="rounded-2xl">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{d.employee_code} — {d.employee_name}</p>
                    <p className="text-xs text-slate-500">{d.dispute_type.replace(/_/g, " ")} · {d.run_month}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{new Date(d.created_at).toLocaleDateString("en-IN")}</p>
                  </div>
                  <Badge className={`text-[10px] font-bold border flex items-center gap-1 ${STATUS_COLORS[d.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {STATUS_ICONS[d.status]}{d.status.replace(/_/g, " ")}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Add routes in payroll.routes.tsx**

Find the existing route block and add:

```tsx
const SalaryDisputePage        = lazy(() => import("@/pages/payroll/SalaryDisputePage"));
const SalaryDisputeQueuePage   = lazy(() => import("@/pages/payroll/SalaryDisputeQueuePage"));
const SalaryDisputeManagerView = lazy(() => import("@/pages/payroll/SalaryDisputeManagerView"));

// In the Routes JSX:
<Route path="/payroll/salary-disputes" element={<ProtectedRoute roles={['employee','super_admin','admin','hr','hr_admin']}><Gate pageCode="SALARY_DISPUTE"><SalaryDisputePage /></Gate></ProtectedRoute>} />
<Route path="/payroll/salary-disputes/queue" element={<ProtectedRoute roles={['wfm','payroll_hr','payroll','payroll_head','super_admin','admin']}><Gate pageCode="SALARY_DISPUTE_QUEUE"><SalaryDisputeQueuePage /></Gate></ProtectedRoute>} />
<Route path="/payroll/salary-disputes/team" element={<ProtectedRoute roles={['manager','branch_head','process_manager','super_admin','admin']}><Gate pageCode="SALARY_DISPUTE_TEAM"><SalaryDisputeManagerView /></Gate></ProtectedRoute>} />
```

- [ ] **Step 3: Add nav entries in navConfig.tsx**

In the payroll section of navConfig, add:

```tsx
{ label: "My Salary Disputes", href: "/payroll/salary-disputes", icon: ic(AlertCircle), roles: ["employee"], pageCode: "SALARY_DISPUTE" },
{ label: "Dispute Queue", href: "/payroll/salary-disputes/queue", icon: ic(AlertCircle), roles: ["wfm","payroll_hr","payroll","payroll_head","super_admin"], pageCode: "SALARY_DISPUTE_QUEUE" },
{ label: "Team Disputes", href: "/payroll/salary-disputes/team", icon: ic(AlertCircle), roles: ["manager","branch_head","process_manager"], pageCode: "SALARY_DISPUTE_TEAM" },
```

- [ ] **Step 4: TypeScript check**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest
npx tsc --noEmit 2>&1 | grep -i "dispute" | head -10
```
Expected: no errors.

- [ ] **Step 5: Commit and push**

```bash
git add src/pages/payroll/SalaryDisputeManagerView.tsx \
        src/config/routes/payroll.routes.tsx \
        src/components/layout/navConfig.tsx
git commit -m "feat(salary-dispute): manager team view + routes + nav entries"
git push --no-verify origin main
```

---

## Self-Review

**Spec coverage check:**
- ✅ All 11 dispute types in migration ENUM
- ✅ `raise()` — employee submits, WFM + manager notified
- ✅ `wfmReview()` — Stage 1 approve/reject, differential entered
- ✅ `payrollHeadReview()` — Stage 2 approve/reject
- ✅ `applyArrear()` — inserts ARREAR component, updates gross/net
- ✅ Manager read-only view with team disputes
- ✅ All 4 inbox notification types
- ✅ UNIQUE KEY prevents duplicate disputes for same employee/month/type
- ✅ Mandatory remarks min 10 chars enforced in service
- ✅ Employee raise form with 3-step wizard
- ✅ WFM queue with review dialog + differential entry
- ✅ Payroll Head queue
- ✅ Routes wired + nav entries

**No placeholders found.**
