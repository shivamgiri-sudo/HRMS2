/**
 * Salary Verification Routes
 * Mounted at: /api/payroll/salary-verification
 *
 * WFM and Process Manager can view per-employee salary data, mark employees
 * as verified, and raise discrepancy flags to the Payroll Head.
 * Payroll Head can resolve / reject flags.
 */
import { Router } from "express";
import { sqlLimitOffset } from "../../db/pagination.js";
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
// Helper: resolve a non-org-wide caller's own branch/process from their
// employee record. Mirrors the isAdmin split GET /processes above already
// uses to decide "org-wide vs scoped to my own record".
// ---------------------------------------------------------------------------
async function resolveActorOwnScope(
  userId: string
): Promise<{ branchId: string | null; processId: string | null } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id FROM employees WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  return { branchId: row.branch_id ?? null, processId: row.process_id ?? null };
}

// ---------------------------------------------------------------------------
// GET /processes — list processes the caller has salary-verification access to
// ---------------------------------------------------------------------------
salaryVerificationRouter.get(
  "/processes",
  requireAuth,
  requireRole("wfm", "process_manager", "branch_head", "payroll_head", "super_admin", "payroll"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      const userId = req.authUser!.id;
      const roleKeys: string[] = (req.authUser as any)?.roleKeys ?? [];

      const isAdmin = roleKeys.some((r) => ["super_admin", "payroll_head", "payroll"].includes(r));

      let rows: RowDataPacket[];
      if (isAdmin) {
        [rows] = await db.execute<RowDataPacket[]>(
          `SELECT pm.id AS process_id, pm.process_name,
                  b.id AS branch_id, b.branch_name
             FROM process_master pm
             JOIN branch_master b ON b.id = pm.branch_id
            -- process_master has active_status, not is_active.
            WHERE pm.active_status = 1
            ORDER BY b.branch_name, pm.process_name`
        );
      } else {
        [rows] = await db.execute<RowDataPacket[]>(
          `SELECT DISTINCT pm.id AS process_id, pm.process_name,
                  b.id AS branch_id, b.branch_name
             FROM employees e
             JOIN process_master pm ON pm.id = e.process_id
             JOIN branch_master b ON b.id = e.branch_id
            -- process_master has no manager_user_id column — it carries
            -- process_owner_name / process_owner_email, no user linkage at all.
            -- Referencing it raised ER_BAD_FIELD_ERROR, so this branch returned
            -- 500 to every non-admin and they saw no processes whatsoever.
            --
            -- Scoped to the caller's own process only. That is narrower than the
            -- original intent, but it fails closed and is strictly more than the
            -- nothing they get today. Restoring owner-based scope needs a real
            -- user column on process_master.
            WHERE e.user_id = ?
            ORDER BY b.branch_name, pm.process_name`,
          [userId]
        );
      }

      return res.json({ success: true, data: rows });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SalaryVerification] GET /processes error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch processes" });
    }
  }
);

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

      const whereClauses: string[] = ["e.active_status = 1"];
      const whereParams: unknown[] = [];
      if (processId) { whereClauses.push("e.process_id = ?"); whereParams.push(processId); }
      if (branchId)  { whereClauses.push("e.branch_id = ?");  whereParams.push(branchId); }
      if (search)    { whereClauses.push("(e.full_name LIKE ? OR e.employee_code LIKE ?)"); whereParams.push(`%${search}%`, `%${search}%`); }

      const whereStr = whereClauses.join(" AND ");

      const [[{ total }]] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM employees e WHERE ${whereStr}`,
        whereParams
      ) as any;

      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.id AS employee_id, e.employee_code, e.full_name,
                d.designation_name AS designation_name,
                e.branch_id, e.process_id
           FROM employees e
           LEFT JOIN designation_master d ON d.id = e.designation_id
          WHERE ${whereStr}
          ORDER BY e.full_name
          ${sqlLimitOffset(limit, offset)}`,
        whereParams
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

      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.id, e.employee_code, e.full_name,
                d.designation_name AS designation_name,
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
          `SELECT spl.* FROM salary_prep_line spl
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

          deductions = comps
            .filter((c) => c.type === "deduction")
            .map((c) => ({ code: c.code, name: c.name, amount: Number(c.amount) }));

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

      const [flagRows] = await db.execute<RowDataPacket[]>(
        `SELECT id, category, description, expected_value, status, raised_at
           FROM salary_verification_flag
          WHERE employee_id = ? AND run_month = ?
          ORDER BY raised_at DESC`,
        [employeeId, month]
      );

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
      const done = Number(open_flags) === 0 && verifiedN + flaggedN >= totalN;

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

      // Read the flag's run_month, process_id, branch_id before updating (needed for readiness check).
      const [flagRows] = await db.execute<RowDataPacket[]>(
        "SELECT run_month, process_id, branch_id FROM salary_verification_flag WHERE id = ? LIMIT 1",
        [flagId]
      );
      const flagMeta = (flagRows as any[])[0];

      await db.execute(
        `UPDATE salary_verification_flag
            SET status = ?, resolved_by = ?, resolved_at = NOW(), resolution_note = ?
          WHERE id = ?`,
        [status, userId, resolutionNote ?? null, flagId]
      );

      // When the last open flag for a process is resolved, auto-complete the readiness row.
      if (flagMeta) {
        await markReadinessDoneIfComplete(
          flagMeta.run_month, flagMeta.branch_id, flagMeta.process_id, userId
        );
      }

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

      // Resolve branch_id from the employee record so the readiness check can run.
      const [empRows] = await db.execute<RowDataPacket[]>(
        "SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1",
        [employeeId]
      );
      const emp = (empRows as any[])[0];
      if (emp) {
        await markReadinessDoneIfComplete(
          runMonth,
          String(emp.branch_id),
          processId ?? String(emp.process_id ?? ""),
          userId
        );
      }

      return res.json({ success: true, message: "Employee marked as verified" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SalaryVerification] POST /verify-employee error:", msg);
      return res.status(500).json({ success: false, message: "Failed to verify employee" });
    }
  }
);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Helper: if all employees in a process/branch are verified and there are no
// open flags, flip payroll_branch_readiness.salary_verification_done = 1.
// Called after any bulk or individual verification action when branchId is known.
// Best-effort: a readiness-update failure must never break the verification call.
// ---------------------------------------------------------------------------
async function markReadinessDoneIfComplete(
  runMonth: string,
  branchId: string | undefined | null,
  processId: string | undefined | null,
  userId: string
): Promise<void> {
  if (!branchId) return;
  try {
    const processClause = processId ? "AND e.process_id = ?" : "";
    const baseParams: unknown[] = [branchId];
    if (processId) baseParams.push(processId);

    const [[totRow]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM employees e WHERE e.active_status = 1 AND e.branch_id = ? ${processClause}`,
      baseParams
    ) as any;
    const [[verRow]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT sev.employee_id) AS cnt
         FROM salary_employee_verification sev
         JOIN employees e ON e.id = sev.employee_id
        WHERE sev.run_month = ? AND e.branch_id = ? ${processClause}`,
      [runMonth, ...baseParams]
    ) as any;
    const [[flagRow]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
         FROM salary_verification_flag svf
         JOIN employees e ON e.id = svf.employee_id
        WHERE svf.run_month = ? AND svf.status = 'open' AND e.branch_id = ? ${processClause}`,
      [runMonth, ...baseParams]
    ) as any;

    const total = Number(totRow.cnt ?? 0);
    const verified = Number(verRow.cnt ?? 0);
    const openFlags = Number(flagRow.cnt ?? 0);

    if (total > 0 && openFlags === 0 && verified >= total) {
      await db.execute(
        `UPDATE payroll_branch_readiness
            SET salary_verification_done = 1,
                salary_verification_at = NOW(),
                salary_verification_by = ?
          WHERE process_month = ?
            AND branch_id = ?
            AND COALESCE(process_id, '') = COALESCE(?, '')`,
        [userId, runMonth, branchId, processId ?? null]
      );
    }
  } catch {
    // best-effort: never block the verification action on a readiness update failure
  }
}

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

      // Auto-flip salary_verification_done on payroll_branch_readiness when the process is
      // now fully verified (all employees verified, zero open flags).
      await markReadinessDoneIfComplete(runMonth, branchId ?? null, processId ?? null, userId);

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
      let processId = req.query.processId as string | undefined;
      let branchId = req.query.branchId as string | undefined;
      const format = (req.query.format as string) === "csv" ? "csv" : "xlsx";

      // Org-wide roles (same split as GET /processes' isAdmin above) may request an
      // unfiltered, org-wide export. Everyone else — wfm, process_manager, branch_head —
      // is a branch/process-scoped role, so their own branchId/processId is enforced
      // here regardless of what the client sent. Previously these params were only
      // ever applied when present, so omitting both returned up to 10,000 employees'
      // salary register org-wide to any caller holding one of these roles.
      const roleKeys: string[] = (req.authUser as any)?.roleKeys ?? [];
      const isOrgWide = roleKeys.some((r) => ["super_admin", "payroll_head", "payroll"].includes(r));

      if (!isOrgWide) {
        const ownScope = await resolveActorOwnScope(req.authUser!.id);
        const isBranchHead = roleKeys.includes("branch_head");
        const scopedValue = isBranchHead ? ownScope?.branchId : ownScope?.processId;
        if (!scopedValue) {
          return res.status(403).json({
            success: false,
            message: "No branch or process is assigned to your account, so there is nothing you are authorised to export.",
          });
        }
        if (isBranchHead) {
          branchId = scopedValue;
        } else {
          processId = scopedValue;
        }
      }

      const run = await getRunForMonth(month);

      const whereClauses: string[] = ["e.active_status = 1"];
      const whereParams: unknown[] = [];
      if (processId) { whereClauses.push("e.process_id = ?"); whereParams.push(processId); }
      if (branchId)  { whereClauses.push("e.branch_id = ?");  whereParams.push(branchId); }

      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.id AS employee_id, e.employee_code, e.full_name,
                d.designation_name AS designation_name
           FROM employees e
           LEFT JOIN designation_master d ON d.id = e.designation_id
          WHERE ${whereClauses.join(" AND ")}
          ORDER BY e.full_name
          LIMIT 10000`,
        whereParams
      );

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
          if (line.gross_salary != null) {
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

      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet([headers, ...register]);
      XLSX.utils.book_append_sheet(wb, ws1, "Register");

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

      const flagWhere = ["svf.run_month = ?"];
      const flagParams: unknown[] = [month];
      if (processId) { flagWhere.push("svf.process_id = ?"); flagParams.push(processId); }
      if (branchId)  { flagWhere.push("svf.branch_id = ?");  flagParams.push(branchId); }

      const [allFlagRows] = await db.execute<RowDataPacket[]>(
        `SELECT svf.employee_code, e.full_name, svf.category, svf.description,
                svf.expected_value, svf.status, svf.raised_at, svf.resolution_note
           FROM salary_verification_flag svf
           LEFT JOIN employees e ON e.id = svf.employee_id
          WHERE ${flagWhere.join(" AND ")}
          ORDER BY svf.raised_at DESC`,
        flagParams
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
