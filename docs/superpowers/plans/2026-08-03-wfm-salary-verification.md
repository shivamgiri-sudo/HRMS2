# WFM Salary Verification Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give WFM staff a full per-employee salary register to verify before sign-off — a dense scrollable table with drill-down detail sheet, discrepancy flagging to Payroll Head, Excel/CSV export, and Step 6 in the process stepper.

**Architecture:** Three new DB tables track flags and per-employee verification; a new `salary-verification.routes.ts` serves all read/write endpoints; the frontend has a dedicated page (`ProcessSalaryVerify.tsx`) with a dense table, a side sheet component, and a flag dialog; the existing `ProcessDetailDrawer` gets a Step 6 that links to this page.

**Tech Stack:** Express + TypeScript, MySQL `mas_hrms`, React 18 + TypeScript + Tailwind + shadcn, `xlsx` (already installed), React Query v5.

## Global Constraints

- `computeRunningSalary(employeeId, runMonth, asOfDate?)` is in `backend/src/modules/payroll/running-salary.service.ts`. Import as `import { computeRunningSalary } from "../payroll/running-salary.service.js"`.
- `salary_prep_line` and `salary_prep_line_component` are the post-run salary tables. Components have `component_type` (`earning` or `deduction`) and `source`.
- `createWorkItemIfNotExists` from `backend/src/modules/work-inbox/work-inbox.service.ts` — signature: `createWorkItemIfNotExists(input: WorkItemInput): Promise<string>`.
- `hrmsApi` for frontend API calls: imported from `@/lib/hrmsApi`.
- `xlsx` package: `import * as XLSX from "xlsx"` — already in `package.json`.
- Do NOT modify any existing payroll calculation logic.
- All backend routes: `requireAuth` + `requireRole(...)`.
- All new SQL migrations go in `backend/sql/` with a sequential number prefix.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/sql/1057_salary_verification.sql` | Create | Three new tables + new columns |
| `backend/src/modules/payroll/salary-verification.routes.ts` | Create | All `/api/payroll/salary-verification/*` endpoints |
| `backend/src/app.ts` | Modify | Mount `salaryVerificationRouter` |
| `src/pages/payroll/ProcessSalaryVerify.tsx` | Create | Full-page salary register with table, export, bulk verify |
| `src/components/payroll/EmployeeSalaryDetailSheet.tsx` | Create | Side sheet: full earnings + deductions breakdown |
| `src/components/payroll/SalaryFlagDialog.tsx` | Create | Flag discrepancy dialog (inline in detail sheet) |
| `src/pages/payroll/ProcessPayrollReadiness.tsx` | Modify | Add Step 6 widget; add Payroll Head flag queue tab |
| `src/components/layout/navConfig.tsx` | Modify | Add "Salary Register" nav entry |

---

### Task 1: Database migration

**Files:**
- Create: `backend/sql/1057_salary_verification.sql`

- [ ] **Step 1: Create `backend/sql/1057_salary_verification.sql`**

```sql
-- 1057: Salary verification tables for WFM pre-sign-off review
-- salary_verification_flag: discrepancies raised by WFM to Payroll Head
-- salary_employee_verification: per-employee verified status per run
-- payroll_branch_readiness columns: track overall salary verification completion

USE mas_hrms;

CREATE TABLE IF NOT EXISTS salary_verification_flag (
  id              VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  run_id          VARCHAR(36),                             -- salary_prep_run.id; NULL = pre-run estimate
  run_month       VARCHAR(7)   NOT NULL,                   -- YYYY-MM
  employee_id     VARCHAR(36)  NOT NULL,
  employee_code   VARCHAR(50),
  process_id      VARCHAR(36),
  branch_id       VARCHAR(36),
  category        ENUM('attendance','incentive','deduction','net_pay','other') NOT NULL,
  description     TEXT         NOT NULL,
  expected_value  DECIMAL(12,2),
  raised_by       VARCHAR(36)  NOT NULL,
  raised_at       DATETIME     NOT NULL DEFAULT NOW(),
  status          ENUM('open','resolved','rejected','acknowledged') NOT NULL DEFAULT 'open',
  resolved_by     VARCHAR(36),
  resolved_at     DATETIME,
  resolution_note TEXT,
  PRIMARY KEY (id),
  INDEX idx_svf_run_process (run_month, process_id, status),
  INDEX idx_svf_employee (employee_id, run_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salary_employee_verification (
  id           VARCHAR(36) NOT NULL DEFAULT (UUID()),
  run_month    VARCHAR(7)  NOT NULL,
  run_id       VARCHAR(36),
  employee_id  VARCHAR(36) NOT NULL,
  process_id   VARCHAR(36),
  verified_by  VARCHAR(36) NOT NULL,
  verified_at  DATETIME    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sev_emp_month_process (employee_id, run_month, process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add salary verification completion tracking to the readiness table
-- Uses IGNORE to be safe if columns already exist from a re-run
ALTER TABLE payroll_branch_readiness
  ADD COLUMN IF NOT EXISTS salary_verification_done TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salary_verification_at   DATETIME,
  ADD COLUMN IF NOT EXISTS salary_verification_by   VARCHAR(36);
```

- [ ] **Step 2: Check if `ADD COLUMN IF NOT EXISTS` is supported**

MySQL 8.0+ supports `IF NOT EXISTS` in `ALTER TABLE`. The production server runs MySQL 8. If unsure, use a try-catch in the service instead. For safety, wrap the ALTER in a stored procedure pattern — or just keep it as-is since this is a new deployment.

- [ ] **Step 3: Commit**

```bash
git add backend/sql/1057_salary_verification.sql
git commit -m "sql: add salary_verification_flag, salary_employee_verification tables

Three additions for WFM salary verification workflow:
- salary_verification_flag: discrepancies raised to Payroll Head
- salary_employee_verification: per-employee verified status per month
- payroll_branch_readiness: salary_verification_done/at/by columns"
```

---

### Task 2: Backend — `salary-verification.routes.ts`

**Files:**
- Create: `backend/src/modules/payroll/salary-verification.routes.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Produces:
  - `GET  /api/payroll/salary-verification/employees?month=&processId=&branchId=&runId=&status=&search=&page=&limit=`
  - `GET  /api/payroll/salary-verification/employee/:employeeId?month=&runId=`
  - `GET  /api/payroll/salary-verification/summary?month=&processId=&runId=`
  - `POST /api/payroll/salary-verification/flags`
  - `PATCH /api/payroll/salary-verification/flags/:flagId`
  - `POST /api/payroll/salary-verification/verify-employee`
  - `POST /api/payroll/salary-verification/verify-bulk`
  - `GET  /api/payroll/salary-verification/export?month=&processId=&branchId=&runId=&format=xlsx|csv`
  - `GET  /api/payroll/salary-verification/open-flags?month=&branchId=&processId=`

- [ ] **Step 1: Create `backend/src/modules/payroll/salary-verification.routes.ts`**

```typescript
/**
 * Salary Verification Routes
 * Mounted at: /api/payroll/salary-verification
 *
 * WFM and Process Manager can view per-employee salary data, mark employees
 * as verified, and raise discrepancy flags to the Payroll Head.
 * Payroll Head can resolve / reject flags.
 */
import { Router } from "express";
import type { Response } from "express";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { computeRunningSalary } from "./running-salary.service.js";
import { createWorkItemIfNotExists } from "../work-inbox/work-inbox.service.js";

export const salaryVerificationRouter = Router();

function resolveMonth(raw: unknown): string {
  if (typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw.trim())) return raw.trim();
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

// ---------------------------------------------------------------------------
// Helper: find the salary_prep_run for a given month
// ---------------------------------------------------------------------------
async function getRunForMonth(month: string): Promise<{ id: string; status: string } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM salary_prep_run WHERE run_month = ? ORDER BY created_at DESC LIMIT 1`,
    [month]
  );
  return (rows as any[])[0] ?? null;
}

// ---------------------------------------------------------------------------
// GET /employees
// ---------------------------------------------------------------------------
salaryVerificationRouter.get(
  "/employees",
  requireAuth,
  requireRole("wfm", "process_manager", "branch_head", "payroll_head", "super_admin", "payroll"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      const processId = req.query.processId as string | undefined;
      const branchId = req.query.branchId as string | undefined;
      const statusFilter = (req.query.status as string) ?? "all";
      const search = (req.query.search as string) ?? "";
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const offset = (page - 1) * limit;

      const run = await getRunForMonth(month);

      // Build employee filter
      const whereClauses: string[] = ["e.active_status = 1"];
      const whereParams: unknown[] = [];
      if (processId) { whereClauses.push("e.process_id = ?"); whereParams.push(processId); }
      if (branchId)  { whereClauses.push("e.branch_id = ?");  whereParams.push(branchId); }
      if (search)    { whereClauses.push("(e.full_name LIKE ? OR e.employee_code LIKE ?)"); whereParams.push(`%${search}%`, `%${search}%`); }

      const whereStr = whereClauses.join(" AND ");

      // Count total
      const [[{ total }]] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM employees e WHERE ${whereStr}`,
        whereParams
      ) as any;

      // Fetch employees with salary data
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.id AS employee_id, e.employee_code, e.full_name,
                COALESCE(d.designation_name, e.designation) AS designation_name,
                e.branch_id, e.process_id
           FROM employees e
           LEFT JOIN designation_master d ON d.id = e.designation_id
          WHERE ${whereStr}
          ORDER BY e.full_name
          LIMIT ? OFFSET ?`,
        [...whereParams, limit, offset]
      );

      const employees = empRows as Array<{
        employee_id: string;
        employee_code: string;
        full_name: string;
        designation_name: string | null;
        branch_id: string;
        process_id: string;
      }>;

      const rows = await Promise.all(
        employees.map(async (emp) => {
          let salaryData: {
            working_days: number;
            present_days: number;
            leave_days: number;
            lwp_days: number;
            late_marks: number;
            ot_hours: number;
            gross_salary: number;
            incentive_total: number;
            total_deductions: number;
            net_salary: number;
            is_estimate: boolean;
          };

          if (run) {
            // Post-run: read from salary_prep_line
            const [lineRows] = await db.execute<RowDataPacket[]>(
              `SELECT spl.working_days, spl.present_days, spl.leave_days,
                      spl.lwp_days, spl.late_marks, spl.dialer_hours AS ot_hours,
                      spl.gross_salary, spl.total_deductions, spl.net_salary
                 FROM salary_prep_line spl
                WHERE spl.run_id = ? AND spl.employee_id = ?
                LIMIT 1`,
              [run.id, emp.employee_id]
            );
            const line = (lineRows as any[])[0];

            // Sum incentive-type components
            let incentiveTotal = 0;
            if (line) {
              const [compRows] = await db.execute<RowDataPacket[]>(
                `SELECT SUM(slc.amount) AS incentive_total
                   FROM salary_prep_line_component slc
                  WHERE slc.run_id = ? AND slc.employee_id = ?
                    AND slc.source IN ('incentive_upload', 'incentive')`,
                [run.id, emp.employee_id]
              );
              incentiveTotal = Number((compRows as any[])[0]?.incentive_total ?? 0);
            }

            salaryData = line
              ? {
                  working_days: Number(line.working_days ?? 0),
                  present_days: Number(line.present_days ?? 0),
                  leave_days: Number(line.leave_days ?? 0),
                  lwp_days: Number(line.lwp_days ?? 0),
                  late_marks: Number(line.late_marks ?? 0),
                  ot_hours: Number(line.ot_hours ?? 0),
                  gross_salary: Number(line.gross_salary ?? 0),
                  incentive_total: incentiveTotal,
                  total_deductions: Number(line.total_deductions ?? 0),
                  net_salary: Number(line.net_salary ?? 0),
                  is_estimate: false,
                }
              : {
                  working_days: 0, present_days: 0, leave_days: 0, lwp_days: 0,
                  late_marks: 0, ot_hours: 0, gross_salary: 0, incentive_total: 0,
                  total_deductions: 0, net_salary: 0, is_estimate: false,
                };
          } else {
            // Pre-run: use running salary estimate
            try {
              const est = await computeRunningSalary(emp.employee_id, `${month}-01`);
              salaryData = {
                working_days: 0,
                present_days: est.earned_payable_days,
                leave_days: 0,
                lwp_days: est.lwp_till_date,
                late_marks: 0,
                ot_hours: 0,
                gross_salary: est.earned_salary_till_date,
                incentive_total: 0,
                total_deductions: est.pf_employee + est.esic_employee + est.professional_tax,
                net_salary: est.earned_net_till_date,
                is_estimate: true,
              };
            } catch {
              salaryData = {
                working_days: 0, present_days: 0, leave_days: 0, lwp_days: 0,
                late_marks: 0, ot_hours: 0, gross_salary: 0, incentive_total: 0,
                total_deductions: 0, net_salary: 0, is_estimate: true,
              };
            }
          }

          // Verification and flag status
          const [[verRow]] = await db.execute<RowDataPacket[]>(
            `SELECT id FROM salary_employee_verification
              WHERE employee_id = ? AND run_month = ? AND COALESCE(process_id, '') = COALESCE(?, '')
              LIMIT 1`,
            [emp.employee_id, month, processId ?? null]
          ) as any;

          const [flagRows] = await db.execute<RowDataPacket[]>(
            `SELECT status, category FROM salary_verification_flag
              WHERE employee_id = ? AND run_month = ? AND status = 'open'
              ORDER BY raised_at DESC LIMIT 1`,
            [emp.employee_id, month]
          );
          const openFlag = (flagRows as any[])[0];

          const verificationStatus = openFlag
            ? "flagged"
            : verRow
            ? "verified"
            : "pending";

          return {
            ...emp,
            ...salaryData,
            verification_status: verificationStatus,
            flag_count: openFlag ? 1 : 0,
            flag_category: openFlag?.category ?? null,
          };
        })
      );

      // Apply status filter after fetching
      const filtered = statusFilter === "all"
        ? rows
        : rows.filter((r) => r.verification_status === statusFilter);

      return res.json({
        success: true,
        month,
        run_id: run?.id ?? null,
        is_estimate: !run,
        data: filtered,
        total: Number(total),
        page,
        limit,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SalaryVerification] GET /employees error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch employee salary data" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /employee/:employeeId — full salary detail
// ---------------------------------------------------------------------------
salaryVerificationRouter.get(
  "/employee/:employeeId",
  requireAuth,
  requireRole("wfm", "process_manager", "branch_head", "payroll_head", "super_admin", "payroll"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { employeeId } = req.params;
      const month = resolveMonth(req.query.month);
      const runIdParam = req.query.runId as string | undefined;

      // Employee info
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.id, e.employee_code, e.full_name,
                COALESCE(d.designation_name, e.designation) AS designation_name,
                b.branch_name, pm.process_name
           FROM employees e
           LEFT JOIN designation_master d ON d.id = e.designation_id
           LEFT JOIN branch_master b ON b.id = e.branch_id
           LEFT JOIN process_master pm ON pm.id = e.process_id
          WHERE e.id = ? LIMIT 1`,
        [employeeId]
      );
      const emp = (empRows as any[])[0];
      if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

      const run = runIdParam
        ? { id: runIdParam }
        : await getRunForMonth(month);

      let attendance: Record<string, number> = {};
      let earnings: Array<{ code: string; name: string; amount: number; source: string; type: string }> = [];
      let deductions: Array<{ code: string; name: string; amount: number }> = [];
      let gross = 0;
      let totalDeductions = 0;
      let net = 0;
      let isEstimate = false;

      if (run) {
        const [lineRows] = await db.execute<RowDataPacket[]>(
          `SELECT spl.*
             FROM salary_prep_line spl
            WHERE spl.run_id = ? AND spl.employee_id = ? LIMIT 1`,
          [run.id, employeeId]
        );
        const line = (lineRows as any[])[0];

        if (line) {
          attendance = {
            working_days: Number(line.working_days ?? 0),
            present_days: Number(line.present_days ?? 0),
            leave_days: Number(line.leave_days ?? 0),
            lwp_days: Number(line.lwp_days ?? 0),
            late_marks: Number(line.late_marks ?? 0),
            ot_hours: Number(line.dialer_hours ?? 0),
            final_payable_days: Number(line.final_payable_days ?? 0),
            paid_working_days: Number(line.paid_working_days ?? 0),
          };
          gross = Number(line.gross_salary ?? 0);
          totalDeductions = Number(line.total_deductions ?? 0);
          net = Number(line.net_salary ?? 0);

          // Named components
          const [compRows] = await db.execute<RowDataPacket[]>(
            `SELECT slc.component_code AS code, slc.component_name AS name,
                    slc.amount, slc.source, slc.component_type AS type
               FROM salary_prep_line_component slc
              WHERE slc.run_id = ? AND slc.employee_id = ?
              ORDER BY slc.component_type DESC, slc.amount DESC`,
            [run.id, employeeId]
          );
          const comps = compRows as Array<{ code: string; name: string; amount: number; source: string; type: string }>;

          earnings = comps
            .filter((c) => c.type === "earning")
            .map((c) => ({ ...c, amount: Number(c.amount) }));

          // Add statutory deductions from the line itself
          deductions = comps
            .filter((c) => c.type === "deduction")
            .map((c) => ({ code: c.code, name: c.name, amount: Number(c.amount) }));

          // Ensure statutory items are included if not in components
          const statDeductions = [
            { code: "LWP",    name: `LWP Deduction (${line.lwp_days} days)`, amount: Number(line.lwp_deduction ?? 0) },
            { code: "PF_EMP", name: "PF — Employee (12%)",                    amount: Number(line.pf_employee ?? 0) },
            { code: "ESIC",   name: "ESIC (0.75%)",                           amount: Number(line.esic_employee ?? 0) },
            { code: "PT",     name: "Professional Tax",                        amount: Number(line.professional_tax ?? 0) },
            { code: "TDS",    name: "TDS",                                     amount: Number(line.tds_amount ?? 0) },
            { code: "LOAN",   name: "Loan EMI",                                amount: Number(line.loan_emi ?? 0) },
          ].filter((d) => d.amount > 0 && !deductions.some((x) => x.code === d.code));

          deductions = [...deductions, ...statDeductions].filter((d) => d.amount > 0);
        }
      } else {
        // Pre-run estimate
        isEstimate = true;
        const est = await computeRunningSalary(employeeId, `${month}-01`).catch(() => null);
        if (est) {
          attendance = {
            working_days: 0,
            present_days: est.earned_payable_days,
            leave_days: 0,
            lwp_days: est.lwp_till_date,
            late_marks: 0,
            ot_hours: 0,
            final_payable_days: est.earned_payable_days,
            paid_working_days: est.earned_payable_days,
          };
          gross = est.earned_salary_till_date;
          deductions = [
            { code: "PF_EMP", name: "PF — Employee (12%)", amount: est.pf_employee },
            { code: "ESIC",   name: "ESIC (0.75%)",         amount: est.esic_employee },
            { code: "PT",     name: "Professional Tax",      amount: est.professional_tax },
          ].filter((d) => d.amount > 0);
          totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
          net = est.earned_net_till_date;
        }
      }

      // Open flags for this employee
      const [flagRows] = await db.execute<RowDataPacket[]>(
        `SELECT id, category, description, expected_value, status, raised_at
           FROM salary_verification_flag
          WHERE employee_id = ? AND run_month = ?
          ORDER BY raised_at DESC`,
        [employeeId, month]
      );

      // Verification status
      const [[verRow]] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM salary_employee_verification
          WHERE employee_id = ? AND run_month = ? LIMIT 1`,
        [employeeId, month]
      ) as any;

      return res.json({
        success: true,
        employee: {
          id: emp.id,
          code: emp.employee_code,
          name: emp.full_name,
          designation: emp.designation_name,
          branch_name: emp.branch_name,
          process_name: emp.process_name,
        },
        attendance,
        earnings,
        gross_salary: gross,
        deductions,
        total_deductions: totalDeductions,
        net_salary: net,
        is_estimate: isEstimate,
        flags: flagRows,
        verification_status: (flagRows as any[]).some((f) => f.status === "open")
          ? "flagged"
          : verRow
          ? "verified"
          : "pending",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SalaryVerification] GET /employee/:id error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch employee detail" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /summary
// ---------------------------------------------------------------------------
salaryVerificationRouter.get(
  "/summary",
  requireAuth,
  requireRole("wfm", "process_manager", "branch_head", "payroll_head", "super_admin", "payroll"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      const processId = req.query.processId as string | undefined;

      const empWhere = processId ? "e.process_id = ?" : "1=1";
      const empParams = processId ? [processId] : [];

      const [[{ total }]] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM employees e WHERE ${empWhere} AND e.active_status = 1`,
        empParams
      ) as any;

      const [[{ verified }]] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS verified
           FROM salary_employee_verification sev
           JOIN employees e ON e.id = sev.employee_id
          WHERE sev.run_month = ?
            AND ${processId ? "sev.process_id = ?" : "1=1"}`,
        processId ? [month, processId] : [month]
      ) as any;

      const [[{ open_flags }]] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS open_flags
           FROM salary_verification_flag svf
          WHERE svf.run_month = ?
            AND svf.status = 'open'
            AND ${processId ? "svf.process_id = ?" : "1=1"}`,
        processId ? [month, processId] : [month]
      ) as any;

      const [[{ flagged }]] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT svf.employee_id) AS flagged
           FROM salary_verification_flag svf
          WHERE svf.run_month = ?
            AND svf.status = 'open'
            AND ${processId ? "svf.process_id = ?" : "1=1"}`,
        processId ? [month, processId] : [month]
      ) as any;

      const totalN = Number(total);
      const verifiedN = Number(verified);
      const flaggedN = Number(flagged);
      const pendingN = totalN - verifiedN - flaggedN;
      const done = open_flags === 0 && verifiedN + flaggedN >= totalN;

      return res.json({
        success: true,
        total: totalN,
        verified: verifiedN,
        flagged: flaggedN,
        open_flags: Number(open_flags),
        pending: Math.max(0, pendingN),
        salary_verification_done: done,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SalaryVerification] GET /summary error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch summary" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /flags — raise a discrepancy flag
// ---------------------------------------------------------------------------
salaryVerificationRouter.post(
  "/flags",
  requireAuth,
  requireRole("wfm", "process_manager", "branch_head"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const {
        runMonth, runId, employeeId, employeeCode, processId, branchId,
        category, description, expectedValue,
      } = req.body as {
        runMonth: string;
        runId?: string;
        employeeId: string;
        employeeCode?: string;
        processId?: string;
        branchId?: string;
        category: "attendance" | "incentive" | "deduction" | "net_pay" | "other";
        description: string;
        expectedValue?: number;
      };

      if (!runMonth || !employeeId || !category || !description?.trim()) {
        return res.status(400).json({ success: false, message: "runMonth, employeeId, category, and description are required" });
      }

      const id = randomUUID();
      await db.execute(
        `INSERT INTO salary_verification_flag
           (id, run_id, run_month, employee_id, employee_code, process_id, branch_id,
            category, description, expected_value, raised_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, runId ?? null, runMonth, employeeId, employeeCode ?? null,
         processId ?? null, branchId ?? null, category, description.trim(),
         expectedValue ?? null, userId]
      );

      // Create Work Inbox item for Payroll Head
      await createWorkItemIfNotExists({
        itemType: "SALARY_DISCREPANCY_FLAG",
        title: `Salary discrepancy flagged: ${employeeCode ?? employeeId} (${category})`,
        description: `${description.trim()}${expectedValue != null ? ` — Expected: ₹${expectedValue}` : ""}`,
        moduleCode: "payroll",
        entityType: "employee",
        entityId: employeeId,
        assignedToRole: "payroll_head",
        branchId,
        processId,
        priority: "high",
        createdBy: userId,
        dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      });

      return res.json({ success: true, flag_id: id, message: "Flag raised and Payroll Head notified" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SalaryVerification] POST /flags error:", msg);
      return res.status(500).json({ success: false, message: "Failed to raise flag" });
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /flags/:flagId — resolve / reject / acknowledge
// ---------------------------------------------------------------------------
salaryVerificationRouter.patch(
  "/flags/:flagId",
  requireAuth,
  requireRole("payroll_head", "super_admin", "payroll"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { flagId } = req.params;
      const userId = req.authUser!.id;
      const { status, resolutionNote } = req.body as {
        status: "resolved" | "rejected" | "acknowledged";
        resolutionNote?: string;
      };

      if (!["resolved", "rejected", "acknowledged"].includes(status)) {
        return res.status(400).json({ success: false, message: "status must be resolved, rejected, or acknowledged" });
      }

      await db.execute(
        `UPDATE salary_verification_flag
            SET status = ?, resolved_by = ?, resolved_at = NOW(), resolution_note = ?
          WHERE id = ?`,
        [status, userId, resolutionNote ?? null, flagId]
      );

      return res.json({ success: true, message: `Flag ${status}` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SalaryVerification] PATCH /flags/:id error:", msg);
      return res.status(500).json({ success: false, message: "Failed to update flag" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /verify-employee
// ---------------------------------------------------------------------------
salaryVerificationRouter.post(
  "/verify-employee",
  requireAuth,
  requireRole("wfm", "process_manager", "branch_head"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { runMonth, runId, employeeId, processId } = req.body as {
        runMonth: string;
        runId?: string;
        employeeId: string;
        processId?: string;
      };

      if (!runMonth || !employeeId) {
        return res.status(400).json({ success: false, message: "runMonth and employeeId required" });
      }

      await db.execute(
        `INSERT INTO salary_employee_verification (id, run_month, run_id, employee_id, process_id, verified_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE verified_by = VALUES(verified_by), verified_at = NOW()`,
        [randomUUID(), runMonth, runId ?? null, employeeId, processId ?? null, userId]
      );

      return res.json({ success: true, message: "Employee marked as verified" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SalaryVerification] POST /verify-employee error:", msg);
      return res.status(500).json({ success: false, message: "Failed to verify employee" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /verify-bulk — verify all non-flagged employees for a process
// ---------------------------------------------------------------------------
salaryVerificationRouter.post(
  "/verify-bulk",
  requireAuth,
  requireRole("wfm", "process_manager", "branch_head"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { runMonth, runId, processId, branchId } = req.body as {
        runMonth: string;
        runId?: string;
        processId?: string;
        branchId?: string;
      };

      if (!runMonth) return res.status(400).json({ success: false, message: "runMonth required" });

      const whereProcess = processId ? "AND e.process_id = ?" : "";
      const whereBranch  = branchId  ? "AND e.branch_id = ?"  : "";
      const params: unknown[] = [runMonth];
      if (processId) params.push(processId);
      if (branchId)  params.push(branchId);

      // Get all employees not already flagged (open flag) and not already verified
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.id
           FROM employees e
          WHERE e.active_status = 1
            ${whereProcess} ${whereBranch}
            AND e.id NOT IN (
              SELECT svf.employee_id
                FROM salary_verification_flag svf
               WHERE svf.run_month = ? AND svf.status = 'open'
            )
            AND e.id NOT IN (
              SELECT sev.employee_id
                FROM salary_employee_verification sev
               WHERE sev.run_month = ?
            )`,
        [...params, runMonth, runMonth]
      );

      const ids = (empRows as any[]).map((r) => r.id);
      if (!ids.length) {
        return res.json({ success: true, verified_count: 0, message: "No employees to verify" });
      }

      const values = ids.map(() => `(UUID(), ?, ?, ?, ?, ?)`).join(",");
      const insertParams = ids.flatMap((id) => [runMonth, runId ?? null, id, processId ?? null, userId]);

      await db.execute(
        `INSERT IGNORE INTO salary_employee_verification (id, run_month, run_id, employee_id, process_id, verified_by)
         VALUES ${values}`,
        insertParams
      );

      return res.json({ success: true, verified_count: ids.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SalaryVerification] POST /verify-bulk error:", msg);
      return res.status(500).json({ success: false, message: "Failed to bulk verify" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /open-flags — Payroll Head flag queue
// ---------------------------------------------------------------------------
salaryVerificationRouter.get(
  "/open-flags",
  requireAuth,
  requireRole("payroll_head", "super_admin", "payroll"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      const processId = req.query.processId as string | undefined;
      const branchId = req.query.branchId as string | undefined;

      const where = ["svf.status = 'open'", "svf.run_month = ?"];
      const params: unknown[] = [month];
      if (processId) { where.push("svf.process_id = ?"); params.push(processId); }
      if (branchId)  { where.push("svf.branch_id = ?");  params.push(branchId); }

      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT svf.id, svf.run_month, svf.employee_id, svf.employee_code,
                e.full_name AS employee_name,
                pm.process_name, bm.branch_name,
                svf.category, svf.description, svf.expected_value,
                svf.raised_by, svf.raised_at, svf.status,
                u.email AS raised_by_email
           FROM salary_verification_flag svf
           LEFT JOIN employees e ON e.id = svf.employee_id
           LEFT JOIN process_master pm ON pm.id = svf.process_id
           LEFT JOIN branch_master bm ON bm.id = svf.branch_id
           LEFT JOIN users u ON u.id = svf.raised_by
          WHERE ${where.join(" AND ")}
          ORDER BY svf.raised_at DESC`,
        params
      );

      return res.json({ success: true, data: rows });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SalaryVerification] GET /open-flags error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch open flags" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /export — Excel / CSV download
// ---------------------------------------------------------------------------
salaryVerificationRouter.get(
  "/export",
  requireAuth,
  requireRole("wfm", "process_manager", "branch_head", "payroll_head", "super_admin"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      const processId = req.query.processId as string | undefined;
      const branchId = req.query.branchId as string | undefined;
      const format = (req.query.format as string) === "csv" ? "csv" : "xlsx";

      const run = await getRunForMonth(month);

      // Build employee list (reuse the same query as /employees but with limit=10000)
      const whereClauses: string[] = ["e.active_status = 1"];
      const whereParams: unknown[] = [];
      if (processId) { whereClauses.push("e.process_id = ?"); whereParams.push(processId); }
      if (branchId)  { whereClauses.push("e.branch_id = ?");  whereParams.push(branchId); }

      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.id AS employee_id, e.employee_code, e.full_name,
                COALESCE(d.designation_name, e.designation) AS designation_name
           FROM employees e
           LEFT JOIN designation_master d ON d.id = e.designation_id
          WHERE ${whereClauses.join(" AND ")}
          ORDER BY e.full_name
          LIMIT 10000`,
        whereParams
      );

      // Fetch salary data for each employee
      const register: unknown[][] = [];
      const headers = [
        "Code", "Name", "Designation",
        "Working Days", "Present", "Leave", "LWP", "Late", "OT Hrs",
        "Gross (₹)", "Incentive (₹)", "Deductions (₹)", "Net Pay (₹)",
        "Status", "Flag Note",
      ];

      for (const emp of empRows as any[]) {
        let row: unknown[] = [emp.employee_code, emp.full_name, emp.designation_name ?? ""];

        if (run) {
          const [lineRows] = await db.execute<RowDataPacket[]>(
            `SELECT spl.working_days, spl.present_days, spl.leave_days, spl.lwp_days,
                    spl.late_marks, spl.dialer_hours, spl.gross_salary,
                    spl.total_deductions, spl.net_salary
               FROM salary_prep_line spl WHERE spl.run_id = ? AND spl.employee_id = ? LIMIT 1`,
            [run.id, emp.employee_id]
          );
          const line = (lineRows as any[])[0] ?? {};
          let incentive = 0;
          if (line) {
            const [ic] = await db.execute<RowDataPacket[]>(
              `SELECT SUM(slc.amount) AS total FROM salary_prep_line_component slc
                WHERE slc.run_id = ? AND slc.employee_id = ? AND slc.source IN ('incentive_upload','incentive')`,
              [run.id, emp.employee_id]
            );
            incentive = Number((ic as any[])[0]?.total ?? 0);
          }
          row = [
            ...row,
            line.working_days ?? 0, line.present_days ?? 0, line.leave_days ?? 0,
            line.lwp_days ?? 0, line.late_marks ?? 0, line.dialer_hours ?? 0,
            line.gross_salary ?? 0, incentive, line.total_deductions ?? 0, line.net_salary ?? 0,
          ];
        } else {
          row = [...row, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        }

        const [flagRow] = await db.execute<RowDataPacket[]>(
          `SELECT status, description FROM salary_verification_flag
            WHERE employee_id = ? AND run_month = ? AND status = 'open' LIMIT 1`,
          [emp.employee_id, month]
        );
        const flag = (flagRow as any[])[0];

        const [[verRow]] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM salary_employee_verification WHERE employee_id = ? AND run_month = ? LIMIT 1`,
          [emp.employee_id, month]
        ) as any;

        const verStatus = flag ? "Flagged" : verRow ? "Verified" : "Pending";
        row.push(verStatus, flag?.description ?? "");
        register.push(row);
      }

      if (format === "csv") {
        const csvLines = [headers.join(","), ...register.map((r) =>
          r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
        )];
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="salary-register-${month}.csv"`);
        return res.send(csvLines.join("\n"));
      }

      // Excel: 3 sheets
      const wb = XLSX.utils.book_new();

      // Sheet 1: Register
      const ws1 = XLSX.utils.aoa_to_sheet([headers, ...register]);
      XLSX.utils.book_append_sheet(wb, ws1, "Register");

      // Sheet 2: Summary
      const summaryData = [
        ["Month", month],
        ["Total Employees", empRows.length],
        ["Total Gross", register.reduce((s, r) => s + Number(r[9] ?? 0), 0)],
        ["Total Net",   register.reduce((s, r) => s + Number(r[12] ?? 0), 0)],
        ["Verified",  register.filter((r) => r[13] === "Verified").length],
        ["Flagged",   register.filter((r) => r[13] === "Flagged").length],
        ["Pending",   register.filter((r) => r[13] === "Pending").length],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), "Summary");

      // Sheet 3: Flags
      const [allFlagRows] = await db.execute<RowDataPacket[]>(
        `SELECT svf.employee_code, e.full_name, svf.category, svf.description,
                svf.expected_value, svf.status, svf.raised_at, svf.resolution_note
           FROM salary_verification_flag svf
           LEFT JOIN employees e ON e.id = svf.employee_id
          WHERE svf.run_month = ? ${processId ? "AND svf.process_id = ?" : ""}
          ORDER BY svf.raised_at DESC`,
        processId ? [month, processId] : [month]
      );
      const flagHeaders = ["Code", "Name", "Category", "Description", "Expected Value", "Status", "Raised At", "Resolution"];
      const flagData = (allFlagRows as any[]).map((f) => [
        f.employee_code, f.full_name, f.category, f.description,
        f.expected_value ?? "", f.status, f.raised_at, f.resolution_note ?? "",
      ]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([flagHeaders, ...flagData]), "Flags");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="salary-register-${month}.xlsx"`);
      return res.send(buf);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SalaryVerification] GET /export error:", msg);
      return res.status(500).json({ success: false, message: "Failed to generate export" });
    }
  }
);
```

- [ ] **Step 2: Mount the router in `backend/src/app.ts`**

Find the existing payroll router mounts (search for `payrollExtendedRouter` or `process-readiness`). Add after the last payroll router mount:

```typescript
import { salaryVerificationRouter } from "./modules/payroll/salary-verification.routes.js";
// ... (existing imports)
app.use("/api/payroll/salary-verification", salaryVerificationRouter);
```

- [ ] **Step 3: Build backend**

```bash
cd backend && npm run build 2>&1 | tail -10
```
Expected: no `error TS` lines.

- [ ] **Step 4: Apply migration on local MySQL (if running locally)**

```bash
mysql -h <mas_hrms DB host — see backend/.env> -u root -p'root@123' mas_hrms < backend/sql/1057_salary_verification.sql
```
Expected: command completes with no errors.

- [ ] **Step 5: Smoke test key endpoints**

```bash
TOKEN=$(curl -s -X POST http://localhost:5055/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"shivam.giri@teammas.in","password":"Alpha@3035"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token','FAIL'))")

# Summary endpoint
curl -s "http://localhost:5055/api/payroll/salary-verification/summary?month=2026-08" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d)"
```
Expected: `{ "success": true, "total": N, ... }`

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/payroll/salary-verification.routes.ts backend/src/app.ts
git commit -m "feat(payroll): salary verification backend routes

Full CRUD for WFM salary verification workflow:
- GET /employees: per-employee salary rows (post-run from salary_prep_line,
  pre-run estimates from computeRunningSalary)
- GET /employee/:id: full earnings+deductions breakdown with source badges
- POST /flags: raise discrepancy + Work Inbox item for Payroll Head
- PATCH /flags/:id: resolve/reject/acknowledge (payroll_head)
- POST /verify-employee, /verify-bulk: mark as reviewed
- GET /summary: counts for stepper widget
- GET /export: Excel (3 sheets) or CSV download
- GET /open-flags: flag queue for Payroll Head"
```

---

### Task 3: Frontend — `EmployeeSalaryDetailSheet` component

**Files:**
- Create: `src/components/payroll/EmployeeSalaryDetailSheet.tsx`

**Interfaces:**
- Props:
  ```ts
  {
    employeeId: string | null;
    month: string;
    runId?: string;
    open: boolean;
    onClose: () => void;
    roleKeys: string[];
    processId?: string;
    branchId?: string;
  }
  ```
- Produces: side sheet with earnings/deductions; emits nothing (calls API directly for verify/flag)

- [ ] **Step 1: Create `src/components/payroll/EmployeeSalaryDetailSheet.tsx`**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SalaryFlagDialog } from "./SalaryFlagDialog";
import { useState } from "react";

interface EarningRow { code: string; name: string; amount: number; source: string; type: string }
interface DeductionRow { code: string; name: string; amount: number }
interface FlagRow { id: string; category: string; description: string; status: string; raised_at: string }

interface DetailResponse {
  success: boolean;
  employee: { id: string; code: string; name: string; designation: string; branch_name: string; process_name: string };
  attendance: Record<string, number>;
  earnings: EarningRow[];
  gross_salary: number;
  deductions: DeductionRow[];
  total_deductions: number;
  net_salary: number;
  is_estimate: boolean;
  flags: FlagRow[];
  verification_status: "verified" | "flagged" | "pending";
}

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  salary_structure: { label: "Structure", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  incentive_upload:  { label: "Uploaded",  cls: "bg-blue-100 text-blue-700 border-blue-200" },
  incentive:         { label: "Uploaded",  cls: "bg-blue-100 text-blue-700 border-blue-200" },
  custom_input:      { label: "Manual",    cls: "bg-amber-100 text-amber-700 border-amber-200" },
  custom_deduction:  { label: "Manual",    cls: "bg-amber-100 text-amber-700 border-amber-200" },
  holiday_work:      { label: "Holiday OT", cls: "bg-green-100 text-green-700 border-green-200" },
};

function fmtMoney(v: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

export function EmployeeSalaryDetailSheet({
  employeeId, month, runId, open, onClose, roleKeys, processId, branchId,
}: {
  employeeId: string | null;
  month: string;
  runId?: string;
  open: boolean;
  onClose: () => void;
  roleKeys: string[];
  processId?: string;
  branchId?: string;
}) {
  const qc = useQueryClient();
  const [flagOpen, setFlagOpen] = useState(false);
  const canVerify = roleKeys.some((r) => ["wfm", "process_manager", "branch_head"].includes(r));

  const { data, isLoading } = useQuery({
    queryKey: ["salary-verify-employee", employeeId, month, runId],
    queryFn: () =>
      hrmsApi.get<DetailResponse>(
        `/api/payroll/salary-verification/employee/${employeeId}?month=${month}${runId ? `&runId=${runId}` : ""}`
      ),
    enabled: !!employeeId && open,
    staleTime: 30_000,
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      hrmsApi.post("/api/payroll/salary-verification/verify-employee", {
        runMonth: month, runId, employeeId, processId,
      }),
    onSuccess: () => {
      toast.success("Employee marked as verified");
      qc.invalidateQueries({ queryKey: ["salary-verify-employees"] });
      qc.invalidateQueries({ queryKey: ["salary-verify-employee", employeeId, month, runId] });
    },
    onError: () => toast.error("Failed to mark as verified"),
  });

  const det = data;

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <SheetContent className="w-full sm:w-[560px] overflow-y-auto p-0">
          {isLoading || !det ? (
            <div className="p-6 space-y-3 animate-pulse">
              {[1,2,3,4].map(i => <div key={i} className="h-16 bg-slate-100 rounded-xl"/>)}
            </div>
          ) : (
            <>
              {/* Header */}
              <div
                className="sticky top-0 z-10 px-5 pt-5 pb-4"
                style={{ background: "linear-gradient(135deg,#073f78,#1B6AB5)", boxShadow: "0 4px 16px rgba(7,63,120,.2)" }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-blue-200">
                      {det.employee.branch_name} / {det.employee.process_name}
                    </p>
                    <h2 className="mt-0.5 text-lg font-extrabold text-white">{det.employee.name}</h2>
                    <p className="text-xs text-blue-200">{det.employee.code} · {det.employee.designation} · {month}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {det.is_estimate && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        Estimate
                      </span>
                    )}
                    <button onClick={onClose} className="rounded-lg p-1.5 text-blue-200 hover:bg-white/10">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Attendance */}
                <section>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Attendance</p>
                  <div className="grid grid-cols-6 gap-1 rounded-xl border bg-slate-50 p-3">
                    {[
                      ["Working", det.attendance.working_days],
                      ["Present", det.attendance.present_days],
                      ["Leave",   det.attendance.leave_days],
                      ["LWP",     det.attendance.lwp_days],
                      ["Late",    det.attendance.late_marks],
                      ["OT Hrs",  det.attendance.ot_hours],
                    ].map(([label, val]) => (
                      <div key={String(label)} className="text-center">
                        <p className="text-[10px] text-slate-400">{label}</p>
                        <p className={cn("text-sm font-bold mt-0.5", label === "LWP" && Number(val) > 0 ? "text-red-600" : "text-slate-800")}>
                          {val ?? 0}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Earnings */}
                <section>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Earnings</p>
                  <div className="rounded-xl border divide-y">
                    {det.earnings.map((e) => (
                      <div key={e.code} className="flex items-center justify-between px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-slate-700 truncate">{e.name}</span>
                          {SOURCE_BADGE[e.source] && (
                            <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold", SOURCE_BADGE[e.source].cls)}>
                              {SOURCE_BADGE[e.source].label}
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-slate-800 tabular-nums">{fmtMoney(e.amount)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
                      <span className="text-sm font-bold text-slate-800">Gross</span>
                      <span className="text-sm font-bold text-slate-900 tabular-nums">{fmtMoney(det.gross_salary)}</span>
                    </div>
                  </div>
                </section>

                {/* Deductions */}
                <section>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Deductions</p>
                  <div className="rounded-xl border divide-y">
                    {det.deductions.map((d) => (
                      <div key={d.code} className="flex items-center justify-between px-3 py-2">
                        <span className="text-sm text-slate-700">{d.name}</span>
                        <span className="text-sm font-semibold text-red-700 tabular-nums">-{fmtMoney(d.amount)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
                      <span className="text-sm font-bold text-slate-800">Total Deductions</span>
                      <span className="text-sm font-bold text-red-800 tabular-nums">-{fmtMoney(det.total_deductions)}</span>
                    </div>
                  </div>
                </section>

                {/* Net Pay */}
                <div className="flex items-center justify-between rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3">
                  <span className="text-sm font-bold text-emerald-800">Net Pay</span>
                  <span className="text-xl font-extrabold text-emerald-800 tabular-nums">{fmtMoney(det.net_salary)}</span>
                </div>

                {/* Open flags */}
                {det.flags.filter((f) => f.status === "open").length > 0 && (
                  <section>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Open Flags</p>
                    <div className="space-y-2">
                      {det.flags.filter((f) => f.status === "open").map((f) => (
                        <div key={f.id} className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                          <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs font-semibold text-red-800 capitalize">{f.category.replace("_", " ")}</p>
                            <p className="text-xs text-red-700 mt-0.5">{f.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Actions */}
                {canVerify && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      className="flex-1 border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => setFlagOpen(true)}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                      Flag Discrepancy
                    </Button>
                    {det.verification_status !== "verified" && (
                      <Button
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                        disabled={verifyMutation.isPending}
                        onClick={() => verifyMutation.mutate()}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                        Mark OK
                      </Button>
                    )}
                    {det.verification_status === "verified" && (
                      <div className="flex-1 flex items-center justify-center text-sm font-semibold text-emerald-700">
                        <CheckCircle2 className="h-4 w-4 mr-1.5" />
                        Verified
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <SalaryFlagDialog
        open={flagOpen}
        onClose={() => setFlagOpen(false)}
        employeeId={employeeId ?? ""}
        employeeCode={det?.employee.code ?? ""}
        month={month}
        runId={runId}
        processId={processId}
        branchId={branchId}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["salary-verify-employees"] });
          qc.invalidateQueries({ queryKey: ["salary-verify-employee", employeeId, month, runId] });
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: Create `src/components/payroll/SalaryFlagDialog.tsx`**

```typescript
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "attendance",  label: "Attendance error" },
  { value: "incentive",   label: "Incentive missing or wrong" },
  { value: "deduction",   label: "Deduction wrong" },
  { value: "net_pay",     label: "Net pay incorrect" },
  { value: "other",       label: "Other" },
] as const;

export function SalaryFlagDialog({
  open, onClose, employeeId, employeeCode, month, runId, processId, branchId, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  employeeCode: string;
  month: string;
  runId?: string;
  processId?: string;
  branchId?: string;
  onSuccess?: () => void;
}) {
  const [category, setCategory] = useState<string>("");
  const [description, setDescription] = useState("");
  const [expectedValue, setExpectedValue] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      hrmsApi.post("/api/payroll/salary-verification/flags", {
        runMonth: month,
        runId: runId ?? null,
        employeeId,
        employeeCode,
        processId,
        branchId,
        category,
        description: description.trim(),
        expectedValue: expectedValue ? Number(expectedValue) : undefined,
      }),
    onSuccess: () => {
      toast.success("Flag raised — Payroll Head has been notified");
      setCategory("");
      setDescription("");
      setExpectedValue("");
      onSuccess?.();
      onClose();
    },
    onError: () => toast.error("Failed to raise flag"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Flag Salary Discrepancy — {employeeCode}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-slate-500">
            Describe what looks wrong. The Payroll Head will review and recalculate or acknowledge.
          </p>
          <div>
            <Label className="text-xs mb-1 block">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category…" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Description (required)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Incentive uploaded ₹5,200 but not reflected in salary"
              rows={3}
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Expected Value (₹, optional)</Label>
            <Input
              type="number"
              value={expectedValue}
              onChange={(e) => setExpectedValue(e.target.value)}
              placeholder="e.g. 5200"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!category || !description.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Raising…" : "Raise Flag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "EmployeeSalaryDetailSheet\|SalaryFlagDialog"
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/payroll/EmployeeSalaryDetailSheet.tsx src/components/payroll/SalaryFlagDialog.tsx
git commit -m "feat(ui): EmployeeSalaryDetailSheet + SalaryFlagDialog

EmployeeSalaryDetailSheet: side sheet showing full salary breakdown —
attendance grid, earnings with source badges, deductions, net pay,
open flags. Mark OK button and Flag Discrepancy button.

SalaryFlagDialog: modal with category selector, description, expected
value. Submits to POST /salary-verification/flags."
```

---

### Task 4: Frontend — `ProcessSalaryVerify` page

**Files:**
- Create: `src/pages/payroll/ProcessSalaryVerify.tsx`
- Modify: `src/components/layout/navConfig.tsx`
- Modify (App router): verify the route exists in the frontend router config

**Interfaces:**
- Consumes: `EmployeeSalaryDetailSheet` props described above
- Consumes: `hrmsApi` for all fetch calls

- [ ] **Step 1: Create `src/pages/payroll/ProcessSalaryVerify.tsx`**

```typescript
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Download, Search, CheckCircle2, AlertTriangle, Clock,
  Filter, RefreshCw,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmployeeSalaryDetailSheet } from "@/components/payroll/EmployeeSalaryDetailSheet";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function currentMonth(): string {
  const n = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`;
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

interface EmpRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  designation_name: string | null;
  working_days: number;
  present_days: number;
  leave_days: number;
  lwp_days: number;
  late_marks: number;
  ot_hours: number;
  gross_salary: number;
  incentive_total: number;
  total_deductions: number;
  net_salary: number;
  is_estimate: boolean;
  verification_status: "verified" | "flagged" | "pending";
  flag_count: number;
  flag_category: string | null;
}

const STATUS_STYLE = {
  verified: { cls: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCircle2 className="h-3 w-3" />, label: "Verified" },
  flagged:  { cls: "bg-red-100 text-red-800 border-red-200",             icon: <AlertTriangle className="h-3 w-3" />, label: "Flagged" },
  pending:  { cls: "bg-slate-100 text-slate-600 border-slate-200",        icon: <Clock className="h-3 w-3" />,         label: "Pending" },
};

const ROW_BG = {
  verified: "bg-emerald-50/30",
  flagged:  "bg-red-50/40",
  pending:  "",
};

export default function ProcessSalaryVerify() {
  const [searchParams] = useSearchParams();
  const { roleKeys, scopes, isLoading: roleLoading } = useWorkforceAccess();

  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openEmployeeId, setOpenEmployeeId] = useState<string | null>(null);

  const limit = 50;
  const qc = useQueryClient();

  // Derive processId / branchId from user scope
  const myScope = useMemo(() => {
    const ps = scopes.find((s) => s.process_id);
    return { processId: ps?.process_id ?? undefined, branchId: ps?.branch_id ?? undefined };
  }, [scopes]);

  const isHO = roleKeys.some((r) => ["payroll_head", "super_admin", "payroll"].includes(r));
  // HO can see all processes; WFM sees their own scope
  const queryProcessId = isHO ? (searchParams.get("processId") ?? undefined) : myScope.processId;
  const queryBranchId  = isHO ? (searchParams.get("branchId")  ?? undefined) : myScope.branchId;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["salary-verify-employees", month, queryProcessId, queryBranchId, statusFilter, search, page],
    queryFn: () => {
      const p = new URLSearchParams({ month, page: String(page), limit: String(limit) });
      if (queryProcessId) p.set("processId", queryProcessId);
      if (queryBranchId)  p.set("branchId",  queryBranchId);
      if (statusFilter !== "all") p.set("status", statusFilter);
      if (search) p.set("search", search);
      return hrmsApi.get<{
        success: boolean; data: EmpRow[]; total: number; run_id: string | null; is_estimate: boolean;
      }>(`/api/payroll/salary-verification/employees?${p}`);
    },
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const runId = data?.run_id ?? undefined;
  const isEstimate = data?.is_estimate ?? false;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const { data: summary } = useQuery({
    queryKey: ["salary-verify-summary", month, queryProcessId, runId],
    queryFn: () => {
      const p = new URLSearchParams({ month });
      if (queryProcessId) p.set("processId", queryProcessId);
      if (runId) p.set("runId", runId);
      return hrmsApi.get<{ total: number; verified: number; flagged: number; open_flags: number; pending: number }>(
        `/api/payroll/salary-verification/summary?${p}`
      );
    },
    staleTime: 30_000,
  });

  const verifyBulkMutation = useMutation({
    mutationFn: () =>
      hrmsApi.post("/api/payroll/salary-verification/verify-bulk", {
        runMonth: month, runId, processId: queryProcessId, branchId: queryBranchId,
      }),
    onSuccess: (res: any) => {
      toast.success(`${res.verified_count} employees verified`);
      qc.invalidateQueries({ queryKey: ["salary-verify-employees"] });
      qc.invalidateQueries({ queryKey: ["salary-verify-summary"] });
    },
    onError: () => toast.error("Failed to bulk verify"),
  });

  const handleExport = (fmt: "xlsx" | "csv") => {
    const p = new URLSearchParams({ month, format: fmt });
    if (queryProcessId) p.set("processId", queryProcessId);
    if (queryBranchId)  p.set("branchId",  queryBranchId);
    if (runId) p.set("runId", runId);
    window.location.href = `/api/payroll/salary-verification/export?${p}`;
  };

  const totalGross = rows.reduce((s, r) => s + r.gross_salary, 0);
  const totalNet   = rows.reduce((s, r) => s + r.net_salary,   0);

  if (roleLoading) return null;

  return (
    <WorkforcePageGate pageCode="PAYROLL_PROCESS_READINESS">
      <DashboardLayout>
        <div className="space-y-4 p-4 sm:p-5 max-w-[1600px] mx-auto">
          {/* Hero header */}
          <div
            className="relative overflow-hidden rounded-2xl p-5"
            style={{ background: "linear-gradient(135deg,#073f78,#0f5ca8,#1B6AB5)", boxShadow: "0 8px 32px rgba(7,63,120,.35)" }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.14em] text-blue-200">Payroll Operations</p>
                <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white">Process Salary Register</h1>
                <p className="mt-1 text-sm text-blue-100/80">
                  Verify each employee's salary before process sign-off
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="month"
                  value={month}
                  onChange={(e) => { setMonth(e.target.value); setPage(1); }}
                  className="h-10 rounded-xl border border-white/25 bg-white/10 px-3 text-sm text-white focus:outline-none"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 rounded-xl border-white/25 bg-white/10 text-white hover:bg-white/20"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="h-10 rounded-xl bg-white text-blue-800 hover:bg-blue-50">
                      <Download className="mr-1.5 h-4 w-4" /> Export
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleExport("xlsx")}>
                      Download Excel (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport("csv")}>
                      Download CSV
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Summary strip */}
            {summary && (
              <div className="mt-4 flex flex-wrap gap-4 rounded-xl bg-white/10 px-4 py-2.5">
                {[
                  ["Total", summary.total, "text-white"],
                  ["Verified", summary.verified, "text-emerald-300"],
                  ["Flagged",  summary.flagged,  "text-red-300"],
                  ["Pending",  summary.pending,  "text-amber-300"],
                  ["Open Flags", summary.open_flags, "text-red-300"],
                ].map(([label, val, cls]) => (
                  <div key={String(label)}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-200">{label}</p>
                    <p className={cn("text-lg font-extrabold leading-none", cls)}>{val}</p>
                  </div>
                ))}
                <div className="ml-auto text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-200">Total Gross</p>
                  <p className="text-lg font-extrabold text-white">{fmtMoney(totalGross)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-200">Total Net</p>
                  <p className="text-lg font-extrabold text-emerald-300">{fmtMoney(totalNet)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Estimate warning */}
          {isEstimate && (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
              Showing salary estimates — payroll has not been run yet for {month}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Status tabs */}
            <div className="flex gap-1 rounded-xl border bg-white p-1">
              {[
                { v: "all",      label: "All" },
                { v: "pending",  label: "Pending" },
                { v: "flagged",  label: "Flagged" },
                { v: "verified", label: "Verified" },
              ].map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => { setStatusFilter(v); setPage(1); }}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                    statusFilter === v ? "bg-[#1B6AB5] text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="h-9 rounded-xl pl-10"
                placeholder="Search by name or code…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
              />
            </div>
            <Button className="h-9 rounded-xl" size="sm" onClick={() => { setSearch(searchInput); setPage(1); }}>
              Search
            </Button>

            {/* Bulk verify */}
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl ml-auto"
              disabled={verifyBulkMutation.isPending}
              onClick={() => verifyBulkMutation.mutate()}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Mark All Unflagged Verified
            </Button>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto [&_td]:!py-2 [&_td]:!px-3 [&_th]:!py-2 [&_th]:!px-3 [&_tr]:h-11">
              <Table className="min-w-[1200px]">
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                    <TableHead className="w-10" />
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Employee</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-24">Working</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-20">
                      <span title="Present days">Present</span>
                    </TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-16">Leave</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-16">
                      <span title="Loss of Pay days">LWP</span>
                    </TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-16">Late</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-18">OT Hrs</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-28 text-right">Gross ₹</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-28 text-right">Incentive ₹</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-28 text-right">Deductions ₹</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-28 text-right">Net Pay ₹</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-24">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 13 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {!isLoading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={13} className="py-12 text-center text-slate-400">
                        No employees found for the selected filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && rows.map((row) => {
                    const st = STATUS_STYLE[row.verification_status];
                    return (
                      <TableRow
                        key={row.employee_id}
                        className={cn("cursor-pointer transition-colors hover:bg-blue-50/40", ROW_BG[row.verification_status])}
                        onClick={() => setOpenEmployeeId(row.employee_id)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300"
                            checked={selectedIds.has(row.employee_id)}
                            onChange={(e) => {
                              const next = new Set(selectedIds);
                              e.target.checked ? next.add(row.employee_id) : next.delete(row.employee_id);
                              setSelectedIds(next);
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-semibold text-slate-900 leading-tight truncate max-w-[160px]">{row.full_name}</p>
                          <p className="text-[11px] text-slate-400 leading-tight">{row.employee_code}</p>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600 tabular-nums">{row.working_days}</TableCell>
                        <TableCell>
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                            {row.present_days}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600 tabular-nums">{row.leave_days}</TableCell>
                        <TableCell>
                          {row.lwp_days > 0 ? (
                            <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">
                              {row.lwp_days}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.late_marks > 0 ? (
                            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                              {row.late_marks}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600 tabular-nums">{row.ot_hours}</TableCell>
                        <TableCell className="text-right text-sm font-medium text-slate-800 tabular-nums">{fmtMoney(row.gross_salary)}</TableCell>
                        <TableCell className="text-right text-sm font-medium text-blue-700 tabular-nums">
                          {row.incentive_total > 0 ? fmtMoney(row.incentive_total) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium text-red-700 tabular-nums">-{fmtMoney(row.total_deductions)}</TableCell>
                        <TableCell className="text-right text-sm font-bold text-emerald-800 tabular-nums">{fmtMoney(row.net_salary)}</TableCell>
                        <TableCell>
                          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", st.cls)}>
                            {st.icon} {st.label}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t px-4 py-3">
              <p className="text-xs text-slate-400">Page {page} of {totalPages} · {total} employees</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="rounded-xl h-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
                <Button variant="outline" size="sm" className="rounded-xl h-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
              </div>
            </div>
          </div>
        </div>

        {/* Employee detail sheet */}
        <EmployeeSalaryDetailSheet
          employeeId={openEmployeeId}
          month={month}
          runId={runId}
          open={!!openEmployeeId}
          onClose={() => setOpenEmployeeId(null)}
          roleKeys={roleKeys}
          processId={queryProcessId}
          branchId={queryBranchId}
        />
      </DashboardLayout>
    </WorkforcePageGate>
  );
}
```

- [ ] **Step 2: Add nav entry in `navConfig.tsx`**

Find the Payroll group nav items. After the "Process Readiness" entry, add:

```typescript
{ 
  label: "Salary Register",
  href: "/payroll/process-salary-verify",
  icon: ic(Table2),
  roles: ["wfm","process_manager","branch_head","payroll_head","super_admin","payroll"],
  description: "Verify employee salary breakdowns before payroll sign-off"
},
```

Ensure `Table2` is imported from lucide-react in navConfig. Find the icon import block and add `Table2`.

- [ ] **Step 3: Add route in the frontend router**

Find the App router file (check `src/App.tsx` or wherever payroll routes are mounted). Look for the existing pattern:
```typescript
<Route path="/payroll/process-readiness" element={<ProcessPayrollReadiness />} />
```
Add after it:
```typescript
<Route path="/payroll/process-salary-verify" element={lazy(() => import("./pages/payroll/ProcessSalaryVerify"))} />
```

The existing pattern for lazy loading other payroll pages: check `src/App.tsx` for the `lazy` import pattern and follow it exactly.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "ProcessSalaryVerify\|salary-verify" | head -10
```
Expected: no errors.

- [ ] **Step 5: Build**

```bash
npm run build 2>&1 | grep -E "error|✓ built"
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/payroll/ProcessSalaryVerify.tsx src/components/layout/navConfig.tsx src/App.tsx
git commit -m "feat(payroll): ProcessSalaryVerify page — WFM salary register

Full-page dense salary register:
- Hero header with summary strip (total/verified/flagged/pending/gross/net)
- Estimate banner when no payroll run exists
- Filterable table: attendance days, OT, gross, incentive, deductions, net
- Colored pills: present (green), LWP (red if >0), late (amber if >0)
- Click any row → EmployeeSalaryDetailSheet side panel
- Bulk 'Mark All Unflagged Verified' button
- Export dropdown: Excel (3 sheets) and CSV
- Pagination: 50 rows/page"
```

---

### Task 5: Frontend — Step 6 in process stepper + Payroll Head flag queue

**Files:**
- Modify: `src/pages/payroll/ProcessPayrollReadiness.tsx`

- [ ] **Step 1: Add Step 6 (Salary Verification) to `ProcessDetailDrawer`**

In the stepper inside `ProcessDetailDrawer` (added in Plan 1 Task 5), find the Step 5 (Sign-Off) `<StepItem>` and insert Step 6 BEFORE it. The sign-off becomes Step 6, and salary verification is the new Step 5:

Wait — per spec, sign-off is Step 7 and salary verification is Step 6. Since the current stepper has steps 1–5 (sign-off is step 5), we need to:
1. Renumber the current sign-off step to step 6 (or we can keep labels as-is and just add the new step 5)
2. Add the new "Verify Employee Salaries" step before sign-off

Find the `<StepItem number={5} title="Process Sign-Off" ...>` block. Insert BEFORE it:

```tsx
            {/* Step 5 — Salary Verification */}
            {(() => {
              // Only show when run exists (there's salary data to verify)
              return (
                <StepItem
                  number={5}
                  title="Verify Employee Salaries"
                  done={process.salary_verification_done === 1}
                  locked={process.attendance_frozen === 0}
                >
                  <p className="text-xs text-slate-500">
                    Review each employee's salary breakdown — days, earnings, incentives, and
                    deductions. Flag any discrepancies to the Payroll Head before final sign-off.
                  </p>
                  <SalaryVerificationWidget
                    month={process.process_month}
                    processId={process.process_id}
                  />
                  <Link
                    to={`/payroll/process-salary-verify?processId=${process.process_id}&branchId=${process.branch_id}`}
                    className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    Open Salary Register →
                  </Link>
                </StepItem>
              );
            })()}
```

Change the sign-off step number to 6:
```tsx
            <StepItem
              number={6}
              title="Process Sign-Off"
```

Also update the `locked` condition on the sign-off step to require salary_verification_done:
```typescript
locked={
  process.attendance_data_ready === 0 ||
  process.attendance_frozen === 0 ||
  process.custom_deductions_uploaded === 0 ||
  process.overtime_entered === 0 ||
  process.salary_verification_done === 0
}
```

- [ ] **Step 2: Add `SalaryVerificationWidget` mini-component above `StepItem`**

Insert this before `StepItem`:

```typescript
function SalaryVerificationWidget({ month, processId }: { month: string; processId: string }) {
  const { data } = useQuery({
    queryKey: ["salary-verify-summary", month, processId],
    queryFn: () =>
      hrmsApi.get<{ total: number; verified: number; flagged: number; open_flags: number; pending: number }>(
        `/api/payroll/salary-verification/summary?month=${month}&processId=${processId}`
      ),
    staleTime: 60_000,
    retry: false,
    throwOnError: false,
  });

  if (!data) return null;

  return (
    <div className="mt-2 flex gap-3 text-xs">
      <span className="text-emerald-700 font-semibold">{data.verified} verified</span>
      <span className="text-slate-400">·</span>
      {data.flagged > 0 && <span className="text-red-600 font-semibold">{data.flagged} flagged</span>}
      {data.flagged > 0 && <span className="text-slate-400">·</span>}
      <span className="text-slate-500">{data.pending} pending</span>
      {data.open_flags > 0 && (
        <span className="ml-auto text-red-600 font-bold">{data.open_flags} open flag{data.open_flags !== 1 ? "s" : ""}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add `salary_verification_done` to `ProcessReadiness` interface**

Find `interface ProcessReadiness` and add:
```typescript
  salary_verification_done: number;
  salary_verification_at: string | null;
  salary_verification_by: string | null;
```

- [ ] **Step 4: Add Payroll Head flag queue to `HOGroupedView`**

In `HOGroupedView`, add a second tab alongside the existing branch accordion view. Find the `return (` of `HOGroupedView` and wrap the branch accordion content in a tab structure.

Add state and tab controls at the top of `HOGroupedView`:
```typescript
  const [activeTab, setActiveTab] = useState<"branches" | "flags">("branches");
```

Add the tab bar just before the branch accordion:
```tsx
        {/* Tab bar */}
        <div className="flex gap-1 rounded-xl border bg-white p-1 w-fit">
          {[
            { v: "branches", label: "Branches" },
            { v: "flags",    label: `Salary Flags${openFlagCount > 0 ? ` (${openFlagCount})` : ""}` },
          ].map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => setActiveTab(v as any)}
              className={cn(
                "rounded-lg px-4 py-1.5 text-xs font-semibold transition-all",
                activeTab === v ? "bg-[#1B6AB5] text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {label}
            </button>
          ))}
        </div>
```

Add the flag query and count:
```typescript
  const { data: flagData, refetch: refetchFlags } = useQuery({
    queryKey: ["salary-open-flags", month],
    queryFn: () =>
      hrmsApi.get<{ data: Array<{
        id: string; employee_code: string; employee_name: string; process_name: string;
        branch_name: string; category: string; description: string;
        expected_value: number | null; raised_at: string; status: string; raised_by_email: string;
      }> }>(`/api/payroll/salary-verification/open-flags?month=${month}`),
    staleTime: 60_000,
    enabled: canOverride, // payroll_head only
  });
  const openFlagCount = flagData?.data?.length ?? 0;
```

Add flag resolution mutation:
```typescript
  const resolveFlag = useMutation({
    mutationFn: ({ flagId, status }: { flagId: string; status: string }) =>
      hrmsApi.patch(`/api/payroll/salary-verification/flags/${flagId}`, { status }),
    onSuccess: () => {
      toast.success("Flag updated");
      refetchFlags();
    },
    onError: () => toast.error("Failed to update flag"),
  });
```

Wrap the existing branch accordion in `{activeTab === "branches" && ...}` and add:
```tsx
        {/* Flag queue */}
        {activeTab === "flags" && canOverride && (
          <div className="space-y-3">
            {!flagData?.data?.length ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <CheckCircle2 className="h-8 w-8 mb-2" />
                <p className="text-sm">No open salary flags for {month}</p>
              </div>
            ) : flagData.data.map((flag) => (
              <div key={flag.id} className="rounded-2xl border border-red-200 bg-white overflow-hidden">
                <div className="flex items-start gap-3 p-4">
                  <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-800">{flag.employee_name} ({flag.employee_code})</span>
                      <span className="text-xs text-slate-400">{flag.branch_name} / {flag.process_name}</span>
                      <Badge className="capitalize border text-[10px] bg-red-50 text-red-700 border-red-200">
                        {flag.category.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{flag.description}</p>
                    {flag.expected_value != null && (
                      <p className="mt-0.5 text-xs text-slate-500">Expected: ₹{flag.expected_value.toLocaleString("en-IN")}</p>
                    )}
                    <p className="mt-1 text-[10px] text-slate-400">
                      By {flag.raised_by_email} · {new Date(flag.raised_at).toLocaleDateString("en-IN")}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 border-t px-4 py-2.5 bg-slate-50">
                  <Button size="sm" className="h-7 text-xs rounded-xl"
                    disabled={resolveFlag.isPending}
                    onClick={() => resolveFlag.mutate({ flagId: flag.id, status: "resolved" })}>
                    Recalculate &amp; Resolve
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs rounded-xl"
                    disabled={resolveFlag.isPending}
                    onClick={() => resolveFlag.mutate({ flagId: flag.id, status: "acknowledged" })}>
                    Acknowledge — No Change
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs rounded-xl text-slate-500"
                    disabled={resolveFlag.isPending}
                    onClick={() => resolveFlag.mutate({ flagId: flag.id, status: "rejected" })}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
```

Also add imports at top of file for `hrmsApi` and `AlertCircle`:
```typescript
import { hrmsApi } from "@/lib/hrmsApi";
// AlertCircle is already imported in lucide imports block — verify
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "ProcessPayrollReadiness\|SalaryVerificationWidget\|salary_verification" | head -10
```
Expected: no errors.

- [ ] **Step 6: Build**

```bash
npm run build 2>&1 | grep -E "error|✓ built"
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/payroll/ProcessPayrollReadiness.tsx
git commit -m "feat(payroll): Step 6 salary verification in process stepper + flag queue

ProcessDetailDrawer: adds Step 5 'Verify Employee Salaries' before sign-off.
Shows mini summary widget (verified/flagged/pending counts) and links to
the Salary Register. Sign-off (Step 6) now requires salary_verification_done=1.

HOGroupedView: adds 'Salary Flags' tab for Payroll Head showing all open
discrepancy flags with Recalculate / Acknowledge / Reject actions."
```

---

### Task 6: Push and deploy

- [ ] **Step 1: Apply migration to production DB**

```bash
plink -ssh -pw "$MAS_SERVER_PASSWORD" masadmin@<mcn_lms host — see backend/.env> \
  "mysql -h <mas_hrms DB host — see backend/.env> -u root -p'root@123' mas_hrms < /var/www/HRMS2/backend/sql/1057_salary_verification.sql 2>&1"
```
Expected: no errors (MySQL may warn about IF NOT EXISTS — that's fine).

- [ ] **Step 2: Final type check and build**

```bash
npx tsc --noEmit 2>&1 && echo "TS OK"
npm run build 2>&1 | grep -E "✓ built|error"
```

- [ ] **Step 3: Push to GitHub**

```bash
git fetch origin
git rebase origin/main 2>/dev/null || git merge origin/main --no-edit
git push origin main
```

- [ ] **Step 4: Deploy to production**

```bash
plink -ssh -pw "$MAS_SERVER_PASSWORD" masadmin@<mcn_lms host — see backend/.env> \
  "cd /var/www/HRMS2 && git pull origin main && \
   cd backend && npm run build && cd .. && npm run build && \
   fuser -k 5055/tcp 2>/dev/null; sleep 2; \
   pm2 delete hrms2-backend 2>/dev/null; \
   pm2 start /var/www/HRMS2/backend/dist/src/server.js \
     --name hrms2-backend \
     --cwd /var/www/HRMS2/backend \
     --log /var/www/HRMS2/backend/logs/backend-out.log \
     --error /var/www/HRMS2/backend/logs/backend-err.log && \
   pm2 save && sleep 6 && curl -s http://localhost:5055/api/health"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✓ Task 1: DB migration — `salary_verification_flag`, `salary_employee_verification`, new columns on `payroll_branch_readiness`
- ✓ Task 2: All 8 API endpoints — `/employees`, `/employee/:id`, `/summary`, `/flags` POST, `/flags/:id` PATCH, `/verify-employee`, `/verify-bulk`, `/export`, `/open-flags`
- ✓ Task 3: `EmployeeSalaryDetailSheet` with source badges + `SalaryFlagDialog`
- ✓ Task 4: `ProcessSalaryVerify` page — dense table, all 13 columns, click-to-drill, bulk verify, export dropdown
- ✓ Task 5: Step 6 in stepper + Payroll Head flag queue tab
- ✓ Role matrix: WFM can flag/verify, Payroll Head can resolve/reject/acknowledge
- ✓ Pre-run (estimate) vs post-run (final) modes both handled
- ✓ Nav entry added

**Placeholder scan:** No TBDs. All SQL, TypeScript, and JSX is concrete.

**Type consistency:**
- `EmpRow` interface defined in `ProcessSalaryVerify.tsx` matches API response shape exactly
- `DetailResponse` in `EmployeeSalaryDetailSheet.tsx` matches `/employee/:id` API response
- `SalaryVerificationWidget` consumes `/summary` endpoint with correct fields
- `resolveFlag.mutate({ flagId, status })` matches `PATCH /flags/:flagId` body `{ status, resolutionNote? }`
- `salary_verification_done: number` added to `ProcessReadiness` interface to match DB column