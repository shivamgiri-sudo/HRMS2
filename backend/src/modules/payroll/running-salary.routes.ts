/**
 * Running (live/daily) salary estimate routes.
 * Provides daily earned salary and end-of-month projection per employee.
 * Used by management for business insights — no payroll finalization involved.
 */

import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { computeRunningSalary } from "./running-salary.service.js";
import type { Response } from "express";

export const runningSalaryRouter = Router();

/**
 * GET /api/payroll/running-summary/:employeeId?month=YYYY-MM
 * Returns earned salary till today + end-of-month projection.
 * Accessible to payroll, HR, branch head, management, super_admin.
 */
runningSalaryRouter.get(
  "/running-summary/:employeeId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    if (
      !(await hasAnyRole(
        userId,
        "super_admin", "admin", "payroll_head", "payroll_branch", "payroll",
        "hr", "hr_admin", "branch_head", "management"
      ))
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { employeeId } = req.params;
    const rawMonth = (req.query.month as string) || "";

    // Derive run month: default to current month as YYYY-MM-01
    let runMonth: string;
    if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
      runMonth = `${rawMonth}-01`;
    } else {
      const now = new Date();
      runMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }

    const asOf = req.query.as_of as string | undefined;

    try {
      const result = await computeRunningSalary(employeeId, runMonth, asOf);
      return res.json({ success: true, data: result, run_month: runMonth });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

/**
 * GET /api/payroll/running-summary/batch?month=YYYY-MM&branch_id=...&process_id=...&limit=50
 * Batch running summary for a branch or process (management dashboard).
 * Returns an array of {employee_id, employee_code, name, ...summary} for up to 100 employees.
 */
runningSalaryRouter.get(
  "/running-summary-batch",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    if (
      !(await hasAnyRole(
        userId,
        "super_admin", "admin", "payroll_head", "payroll_branch", "payroll",
        "branch_head", "management"
      ))
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const rawMonth = (req.query.month as string) || "";
    let runMonth: string;
    if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
      runMonth = `${rawMonth}-01`;
    } else {
      const now = new Date();
      runMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }

    const { branch_id, process_id } = req.query as Record<string, string>;
    const limitRaw = parseInt((req.query.limit as string) || "50", 10);
    const limit = Math.min(Math.max(1, limitRaw), 100);

    // Import db inline to avoid circular dependency
    const { db } = await import("../../db/mysql.js");
    const { RowDataPacket } = await import("mysql2") as any;

    const conds: string[] = [
      "e.employment_status = 'active'",
      "esa.active_status = 1",
    ];
    const params: unknown[] = [];
    if (branch_id) { conds.push("e.branch_id = ?"); params.push(branch_id); }
    if (process_id) { conds.push("e.process_id = ?"); params.push(process_id); }

    const [empRows] = await (db as any).execute(
      `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', e.last_name) AS name
         FROM employees e
         JOIN employee_salary_assignment esa ON esa.employee_id = e.id
        WHERE ${conds.join(" AND ")}
        LIMIT ${limit}`,
      params
    );

    const results = await Promise.allSettled(
      (empRows as any[]).map(async (emp: any) => {
        try {
          const summary = await computeRunningSalary(emp.id, runMonth);
          return { employee_id: emp.id, employee_code: emp.employee_code, name: emp.name, ...summary };
        } catch {
          return { employee_id: emp.id, employee_code: emp.employee_code, name: emp.name, error: true };
        }
      })
    );

    const data = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value);

    return res.json({ success: true, data, run_month: runMonth, count: data.length });
  }
);
