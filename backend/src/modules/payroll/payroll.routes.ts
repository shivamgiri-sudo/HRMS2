import { Router } from "express";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import { requireWFMAccess } from "../../middleware/requireWFMAccess.js";
import { buildScopeWhereClause, hasAnyRole as hasAnyRoleAsync } from "../../shared/scopeAccess.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";

// Synchronous role check against req.user.role (used for validate/reject guards)
function hasAnyRole(req: any, roles: string[]): boolean {
  const userRole: string = req?.authUser?.role ?? req?.user?.role ?? "";
  return roles.includes(userRole);
}
import { payrollController as c } from "./payroll.controller.js";
import { calculatePayrollRun } from "./payrollCalculate.service.js";
import { payrollGovernanceService } from "./payroll-governance.service.js";
import { assertRunEditable } from "./payrollWindowGuard.js";
import { payslipService } from "./payslip.service.js";
import { taxDeclarationService } from "./taxDeclaration.service.js";
import { payrollBranchReadinessService } from "./payroll-branch-readiness.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.resolve(__dirname, "../../../uploads");

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ─── Structures ───────────────────────────────────────────────────────────────

router.get("/structures", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.listStructures));
router.post("/structures", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.createStructure));
router.put("/structures/:id", requireRole("admin", "super_admin", "finance", "payroll"), h(c.updateStructure));
router.delete("/structures/:id", requireRole("admin", "super_admin"), h(c.deleteStructure));

// ─── Employee Salaries (per-employee assignment with full CTC breakup from components) ─
router.get("/employee-salaries", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       esa.id,
       esa.employee_id,
       esa.ctc_annual,
       esa.structure_id,
       esa.effective_from,
       ss.structure_code,
       ss.structure_name,
       ss.basic_pct,
       ss.hra_pct,
       CONCAT_WS(' ', e.first_name, e.last_name)  AS employee_name,
       e.employee_code,
       e.email                                     AS employee_email,
       e.avatar_url                                AS employee_avatar
     FROM employee_salary_assignment esa
     JOIN salary_structure_master ss ON ss.id = esa.structure_id
     JOIN employees e               ON e.id  = esa.employee_id
     WHERE esa.active_status = 1
       AND e.employment_status = 'active'
     ORDER BY e.employee_code`
  );

  // Fetch all components for these structures in one query
  const structureIds = [...new Set((rows as any[]).map(r => r.structure_id).filter(Boolean))];
  let componentMap: Record<string, Array<{component_code: string; component_name: string; calc_type: string; value: number}>> = {};

  if (structureIds.length > 0) {
    const placeholders = structureIds.map(() => '?').join(',');
    const [compRows] = await db.execute<RowDataPacket[]>(
      `SELECT ssc.structure_id, scm.component_code, scm.component_name, ssc.calc_type, ssc.value
         FROM salary_structure_component ssc
         JOIN salary_component_master scm ON scm.id = ssc.component_id
        WHERE ssc.structure_id IN (${placeholders})
          AND ssc.calc_type IN ('fixed', 'pct_of_ctc')
        ORDER BY ssc.sequence`,
      structureIds
    );
    for (const c of compRows as any[]) {
      if (!componentMap[c.structure_id]) componentMap[c.structure_id] = [];
      componentMap[c.structure_id].push({
        component_code: c.component_code,
        component_name: c.component_name,
        calc_type: c.calc_type,
        value: Number(c.value) || 0,
      });
    }
  }

  // Enrich each row with actual component amounts
  const enriched = (rows as any[]).map(row => {
    const comps = componentMap[row.structure_id] || [];
    const basic = comps.find(c => c.component_code === 'BASIC')?.value || 0;
    const hra = comps.find(c => c.component_code === 'HRA')?.value || 0;
    const bonus = comps.find(c => c.component_code === 'BONUS')?.value || 0;
    const conv = comps.find(c => c.component_code === 'CONV')?.value || 0;
    const portfolio = comps.find(c => c.component_code === 'PORTFOLIO')?.value || 0;
    const medical = comps.find(c => c.component_code === 'MEDICAL')?.value || 0;
    const lta = comps.find(c => c.component_code === 'LTA')?.value || 0;
    const special = comps.find(c => c.component_code === 'SPECIAL')?.value || 0;
    const otherAllow = comps.find(c => c.component_code === 'OTHER_ALLOW')?.value || 0;
    const pli = comps.find(c => c.component_code === 'PLI')?.value || 0;
    const gross = basic + hra + bonus + conv + portfolio + medical + lta + special + otherAllow + pli;

    return {
      ...row,
      basic_salary: basic || Math.round((row.ctc_annual / 12) * (row.basic_pct || 40) / 100 * 100) / 100,
      hra: hra || Math.round((row.ctc_annual / 12) * (row.hra_pct || 20) / 100 * 100) / 100,
      bonus, conv, portfolio, medical, lta, special_allowance: special, other_allowance: otherAllow, pli,
      gross_monthly: gross || Math.round(row.ctc_annual / 12 * 100) / 100,
      ctc_monthly: Math.round(row.ctc_annual / 12 * 100) / 100,
      components: comps,
    };
  });

  return res.json({ success: true, data: enriched });
}));

// ─── Components ───────────────────────────────────────────────────────────────

router.get("/components", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.listComponents));
router.post("/components", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.createComponent));

// ─── Salary Assignments ───────────────────────────────────────────────────────

router.post("/salary-assignments",
  requireRole("admin", "hr", "super_admin", "finance", "payroll"),
  requireScopedRole(["hr", "finance", "payroll"], async (req) => {
    // Resolve employee's branch/process from DB
    const [rows] = await db.execute(
      'SELECT branch_id, process_id, department_id FROM employees WHERE id = ? LIMIT 1',
      [req.body.employeeId ?? req.body.employee_id]
    ) as any[];
    const emp = rows[0];
    return {
      branchId: emp?.branch_id,
      processId: emp?.process_id,
      departmentId: emp?.department_id
    };
  }),
  h(c.assignSalary)
);
router.post("/salary-assignments/bulk", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.bulkAssignSalary));
router.get("/salary-assignments/:employeeId", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.getEmployeeSalary));
router.get("/salary-assignments/:employeeId/history", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.getEmployeeSalaryHistory));

// ─── Payroll Runs — static paths before :id ───────────────────────────────────

async function isHeadOfficeMember(userId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bm.branch_name
       FROM employees e
       JOIN branch_master bm ON bm.id = e.branch_id
      WHERE e.user_id = ? AND e.active_status = 1
      LIMIT 1`,
    [userId]
  );
  const name = (rows[0] as any)?.branch_name ?? "";
  return /head\s*office/i.test(name);
}

router.get("/runs", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req, res) => {
  let scoped: { sql: string; params: unknown[] };
  try {
    const isSuperAdmin = await hasRole(req.authUser!.id, "super_admin");
    if (isSuperAdmin || await isHeadOfficeMember(req.authUser!.id)) {
      scoped = { sql: "1=1", params: [] };
    } else {
      scoped = await buildScopeWhereClause(
        req.authUser!.id,
        ["admin", "hr", "finance", "payroll"],
        { branchId: "spr.branch_id", processId: "spr.process_id" },
        { allowCeoAllRead: true }
      );
    }
  } catch (_err) {
    // deny-all on scope error — never open-access on exception
    scoped = { sql: "1=0", params: [] };
  }
  (req as any).scopeFilter = scoped;
  return c.listRuns(req, res);
}));
router.get("/records", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req, res) => {
  let scoped: { sql: string; params: unknown[] };
  try {
    const isSuperAdmin = await hasRole(req.authUser!.id, "super_admin");
    if (isSuperAdmin || await isHeadOfficeMember(req.authUser!.id)) {
      scoped = { sql: "1=1", params: [] };
    } else {
      scoped = await buildScopeWhereClause(
        req.authUser!.id,
        ["admin", "hr", "finance", "payroll"],
        { branchId: "e.branch_id", processId: "e.process_id" },
        { allowCeoAllRead: true }
      );
    }
  } catch (_err) {
    // deny-all on scope error — never open-access on exception
    scoped = { sql: "1=0", params: [] };
  }
  (req as any).scopeFilter = scoped;
  return c.listPayrollRecords(req, res);
}));
router.get("/overview", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.getPayrollOverview));

// ─── Cascading filter options for payroll workspace dropdowns ──
router.get("/filter-options", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;

  const [branches] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT b.id, b.branch_name FROM branches b
     JOIN employees e ON e.branch_id = b.id
     JOIN salary_prep_line spl ON spl.employee_id = e.id
     ORDER BY b.branch_name`
  );

  let processQuery = `SELECT DISTINCT p.id, p.process_name FROM processes p
     JOIN employees e ON e.process_id = p.id
     JOIN salary_prep_line spl ON spl.employee_id = e.id`;
  const processParams: string[] = [];
  if (branchId) {
    processQuery += ` WHERE e.branch_id = ?`;
    processParams.push(branchId);
  }
  processQuery += ` ORDER BY p.process_name`;
  const [processes] = await db.execute<RowDataPacket[]>(processQuery, processParams);

  let deptQuery = `SELECT DISTINCT d.id, d.dept_name FROM departments d
     JOIN employees e ON e.department_id = d.id
     JOIN salary_prep_line spl ON spl.employee_id = e.id`;
  const deptParams: string[] = [];
  if (branchId) {
    deptQuery += ` WHERE e.branch_id = ?`;
    deptParams.push(branchId);
  }
  deptQuery += ` ORDER BY d.dept_name`;
  const [departments] = await db.execute<RowDataPacket[]>(deptQuery, deptParams);

  res.json({ success: true, data: { branches, processes, departments } });
}));

// ─── Attendance summary for a specific payroll line (used in payslip dialog) ──
router.get("/lines/:lineId/attendance", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req, res) => {
  const { lineId } = req.params;
  // Resolve employee_id + run_month + payroll-computed day fields from the line
  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.employee_id, spr.run_month,
            spl.paid_working_days, spl.eligible_weekoff_days,
            spl.eligible_holiday_days, spl.final_payable_days,
            spl.active_calendar_days
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.id = ? LIMIT 1`,
    [lineId]
  );
  const line = (lineRows as any[])[0];
  if (!line) return res.status(404).json({ success: false, message: "Line not found" });

  const [yr, mo] = String(line.run_month).split("-");
  const monthStart = `${yr}-${mo}-01`;
  const monthEnd   = new Date(Number(yr), Number(mo), 0).toISOString().slice(0, 10); // last day of month

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                                                         AS total_days,
       COUNT(CASE WHEN attendance_status IN ('present','late')         THEN 1 END)      AS present_days,
       COUNT(CASE WHEN attendance_status = 'absent'                    THEN 1 END)      AS absent_days,
       COUNT(CASE WHEN attendance_status = 'week_off'                  THEN 1 END)      AS week_off_days,
       COUNT(CASE WHEN attendance_status = 'holiday'                   THEN 1 END)      AS holiday_days,
       COUNT(CASE WHEN attendance_status = 'half_day'                  THEN 1 END)      AS half_days,
       COUNT(CASE WHEN attendance_status = 'leave_approved'            THEN 1 END)      AS approved_leave_days,
       COALESCE(SUM(lwp_value), 0)                                                      AS lwp_days,
       COUNT(CASE WHEN attendance_status NOT IN ('week_off','holiday') THEN 1 END)      AS working_days
     FROM attendance_daily_record
    WHERE employee_id = ? AND record_date BETWEEN ? AND ?`,
    [line.employee_id, monthStart, monthEnd]
  );
  const summary = (rows as any[])[0] ?? {};

  // Use payroll-computed eligible counts (from slab logic) over raw attendance counts
  // Raw week_off_days/holiday_days may be 0 if not populated in attendance_daily_record
  const eligibleWeekoffs = Number(line.eligible_weekoff_days ?? 0);
  const eligibleHolidays = Number(line.eligible_holiday_days ?? 0);
  if (eligibleWeekoffs > 0 || Number(summary.week_off_days) === 0) {
    summary.week_off_days = eligibleWeekoffs;
  }
  if (eligibleHolidays > 0 || Number(summary.holiday_days) === 0) {
    summary.holiday_days = eligibleHolidays;
  }
  summary.paid_working_days = Number(line.paid_working_days ?? 0);
  summary.final_payable_days = Number(line.final_payable_days ?? 0);
  summary.active_calendar_days = Number(line.active_calendar_days ?? 0);

  return res.json({ success: true, data: summary });
}));
router.post("/runs",
  requireRole("admin", "super_admin", "finance", "payroll"),
  requireScopedRole(["finance", "payroll"], async (req) => ({
    branchId: req.body.branch_id,
    processId: req.body.process_id,
    departmentId: req.body.department_id
  })),
  h(c.createRun)
);
router.get("/runs/:id", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.getRun));
router.get("/runs/:id/readiness", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req, res) => {
  const data = await payrollGovernanceService.readiness(req.params.id);
  return res.json({ success: true, data });
}));

router.post("/runs/:id/freeze-attendance", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req, res) => {
  await assertRunEditable(req.params.id);
  const actorId = req.authUser?.id ?? "system";
  const data = await payrollGovernanceService.freezeAttendance(req.params.id, actorId);

  void logSensitiveAction({
    actor_user_id: actorId,
    action_type: "PAYROLL_ATTENDANCE_FROZEN",
    module_key: "payroll",
    entity_type: "salary_prep_run",
    entity_id: req.params.id,
    change_summary: data,
    req,
  });

  return res.json({ success: true, data, message: "Attendance frozen for payroll run" });
}));

router.patch("/runs/:id/status", requireRole("admin", "super_admin", "finance", "payroll"), h(c.updateRunStatus));
router.get("/runs/:id/lines", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(c.listLines));

// Action-level capabilities for current user
router.get("/capabilities", requireAuth, h(async (req: AuthenticatedRequest, res: Response) => {
  const role = req.authUser?.role ?? "";
  const adminRoles = new Set(["admin", "super_admin", "finance", "payroll"]);
  const hrRoles = new Set(["admin", "super_admin", "hr", "finance", "payroll"]);
  res.json({
    success: true,
    data: {
      canViewPayroll: hrRoles.has(role),
      canEditLine: adminRoles.has(role),
      canChangeStatus: adminRoles.has(role),
      canApprove: role === "super_admin" || role === "finance",
      canDisburse: role === "super_admin" || role === "finance",
      canExport: hrRoles.has(role),
      canManageStructures: adminRoles.has(role),
    },
  });
}));

// E1.1: Branch breakdown for payroll dashboard
router.get("/runs/:id/branch-breakdown", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COALESCE(bm.branch_name, 'Unassigned') AS branch_name,
       COUNT(DISTINCT spl.employee_id) AS employee_count,
       COALESCE(SUM(spl.gross_salary), 0) AS total_gross,
       COALESCE(SUM(spl.net_salary), 0) AS total_net
     FROM salary_prep_line spl
     LEFT JOIN employees e ON e.id = spl.employee_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     WHERE spl.run_id = ?
     GROUP BY e.branch_id, bm.branch_name
     ORDER BY bm.branch_name ASC`,
    [runId]
  );
  return res.json({ success: true, data: rows ?? [] });
}));

router.post("/runs/:id/calculate", requireRole("admin", "super_admin", "finance", "payroll"), async (req: any, res: any, next: any) => {
  try {
    await assertRunEditable(req.params.id);
    const actorId = req.authUser?.id ?? "system";
    // Readiness gate: always enforced in production; skippable only in non-production with explicit flag.
    const skipReadiness = process.env.PAYROLL_SKIP_READINESS === "true" && process.env.NODE_ENV !== "production";
    if (!skipReadiness) {
      const readiness = await payrollGovernanceService.readiness(req.params.id);

      if (!readiness.canCalculate || !readiness.attendanceSnapshotLocked) {
        return res.status(409).json({
          success: false,
          message: "Payroll readiness check failed. Resolve blockers and freeze attendance before calculation.",
          data: readiness,
        });
      }
    }

    // B6 gate: warn if incentives were already applied to this run
    const forceRecalc = req.body?.force === true || req.query?.force === "true";
    if (!forceRecalc) {
      const [incCheck] = await db.execute<RowDataPacket[]>(
        `SELECT incentives_applied_at FROM salary_prep_run WHERE id = ? LIMIT 1`,
        [req.params.id]
      );
      const appliedAt = (incCheck as RowDataPacket[])[0]?.incentives_applied_at;
      if (appliedAt) {
        return res.status(409).json({
          success: false,
          message: "Incentives were applied to this run. Recalculating will wipe them. Pass force=true to confirm, then re-apply incentives after.",
          data: { incentives_applied_at: appliedAt },
        });
      }
    }

    const result = await calculatePayrollRun(req.params.id, actorId);
    void logSensitiveAction({
      actor_user_id: actorId,
      action_type: "PAYROLL_RUN_CALCULATED",
      module_key: "payroll",
      entity_type: "salary_prep_run",
      entity_id: req.params.id,
      change_summary: { run_id: req.params.id },
      req,
    });
    return res.json({ success: true, data: result, message: "Payroll calculated" });
  } catch (err) { next(err); }
});

// ─── Run Lines ────────────────────────────────────────────────────────────────

router.patch("/lines/:id", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: any, res: any) => {
  // Resolve run_id from line, then check window guard
  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT run_id FROM salary_prep_line WHERE id = ? LIMIT 1`, [req.params.id]
  );
  const runId = (lineRows[0] as any)?.run_id;
  if (runId) await assertRunEditable(runId);
  return c.updateLine(req, res);
}));

// ─── Overtime (WFM-only) ──────────────────────────────────────────────────────

router.patch("/lines/:lineId/overtime",
  requireAuth,
  requireWFMAccess,
  h(async (req: any, res: any) => {
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT run_id FROM salary_prep_line WHERE id = ? LIMIT 1`, [req.params.lineId]
    );
    const runId = (lineRows[0] as any)?.run_id;
    if (runId) await assertRunEditable(runId);
    return c.updateOvertime(req, res);
  })
);

// ─── Advances ─────────────────────────────────────────────────────────────────

router.post("/advances",
  requireRole("admin", "hr", "super_admin", "finance", "payroll"),
  requireScopedRole(["hr", "finance", "payroll"], async (req) => {
    // Resolve employee's branch/process
    const [rows] = await db.execute(
      'SELECT branch_id, process_id, department_id FROM employees WHERE id = ? LIMIT 1',
      [req.body.employee_id]
    ) as any[];
    const emp = rows[0];
    return {
      branchId: emp?.branch_id,
      processId: emp?.process_id,
      departmentId: emp?.department_id
    };
  }),
  h(c.createAdvance)
);
router.get("/advances/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only view your own advances" });
    }
  }
  return c.listAdvances(req as any, res);
}));

// GET /api/payroll/advances — paginated advances list scoped to the caller's branch/process
router.get("/advances",
  requireRole("admin", "hr", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const page  = Math.max(1, Number(req.query.page  ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = (page - 1) * limit;

    // super_admin sees everything; everyone else is scoped to their branch/process
    let scoped: { sql: string; params: unknown[] };
    try {
      const isSuperAdmin = await hasRole(req.authUser!.id, "super_admin");
      if (isSuperAdmin) {
        scoped = { sql: "1=1", params: [] };
      } else {
        scoped = await buildScopeWhereClause(
          req.authUser!.id,
          ["admin", "hr", "finance", "payroll", "payroll_head"],
          { branchId: "e.branch_id", processId: "e.process_id" },
          { allowCeoAllRead: true }
        );
      }
    } catch {
      scoped = { sql: "1=0", params: [] };
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sal.id, sal.employee_id, sal.advance_amount, sal.advance_date,
              sal.status, sal.approved_by, sal.approved_at, sal.rejection_reason,
              sal.recovery_month, sal.created_at,
              e.employee_code,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name
         FROM salary_advance_log sal
         JOIN employees e ON e.id = sal.employee_id
        WHERE ${scoped.sql}
        ORDER BY sal.advance_date DESC
        LIMIT ? OFFSET ?`,
      [...scoped.params, limit, offset]
    );

    const [[countRow]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM salary_advance_log sal
         JOIN employees e ON e.id = sal.employee_id
        WHERE ${scoped.sql}`,
      scoped.params
    );

    res.json({ success: true, data: rows, total: Number((countRow as any).total), page, limit });
  })
);

// PATCH /api/payroll/advances/:id/approve
router.patch("/advances/:id/approve",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    await db.execute(
      `UPDATE salary_advance_log SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`,
      [req.authUser!.id, id]
    );
    await logSensitiveAction({ actor_user_id: req.authUser!.id, action_type: "advance_approved", module_key: "payroll", entity_type: "salary_advance_log", entity_id: id });
    res.json({ success: true, message: "Advance approved" });
  })
);

// PATCH /api/payroll/advances/:id/reject
router.patch("/advances/:id/reject",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body;
    await db.execute(
      `UPDATE salary_advance_log SET status = 'rejected', rejection_reason = ?, approved_by = ?, approved_at = NOW() WHERE id = ?`,
      [reason ?? null, req.authUser!.id, id]
    );
    await logSensitiveAction({ actor_user_id: req.authUser!.id, action_type: "advance_rejected", module_key: "payroll", entity_type: "salary_advance_log", entity_id: id, metadata: { reason } });
    res.json({ success: true, message: "Advance rejected" });
  })
);

// ─── Statutory Config ─────────────────────────────────────────────────────────

router.get("/statutory-config", requireRole("admin", "super_admin", "finance", "payroll"), h(c.getStatutoryConfig));

// ─── Payslip ──────────────────────────────────────────────────────────────────

// GET /api/payroll/payslip/my — list own payslip history (employee self-service)
router.get("/payslip/my", h(async (req: AuthenticatedRequest, res: Response) => {
  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  if (!callerEmp) return res.status(403).json({ success: false, message: "No employee record for authenticated user" });

  const year = req.query.year ? String(req.query.year) : String(new Date().getFullYear());
  const numericYear = Number(year);
  if (!/^\d{4}$/.test(year) || numericYear < 2000 || numericYear > new Date().getFullYear() + 1) {
    return res.status(400).json({ success: false, message: "Invalid payslip year" });
  }

  // Fetch main payroll lines with employee profile data + disbursal payment info
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.id, spl.run_id, spl.employee_id, spl.employee_code,
            spl.gross_salary, spl.total_deductions, spl.net_salary,
            spl.basic, spl.hra, spl.special_allowance,
            spl.pf_employee, spl.esic_employee, spl.professional_tax, spl.tds,
            spl.lwp_deduction, spl.advance_recovery,
            spl.pf_employer, spl.esic_employer,
            spl.working_days, spl.present_days, spl.leave_days, spl.lwp_days,
            spl.paid_working_days, spl.eligible_weekoff_days, spl.eligible_holiday_days,
            spl.final_payable_days, spl.active_calendar_days,
            spl.status, spl.remarks,
            spr.run_month, spr.disbursed_at AS paid_at, spr.status AS run_status,
            sp.acknowledged_at, sp.file_url, sp.payslip_ref,
            e.first_name, e.last_name,
            COALESCE(eu.uan, eu.member_id, e.epf_number) AS epf_number,
            eu.uan AS uan_number,
            e.pan_number,
            e.esic_number AS esi_number,
            CASE WHEN e.bank_account_number IS NOT NULL
              THEN CONCAT('XXXX', RIGHT(e.bank_account_number, 4))
              ELSE NULL END AS bank_account_masked,
            des.designation_name,
            dept.dept_name,
            br.branch_name,
            loc.location_name,
            srd.cheque_no,
            srd.payment_mode,
            srd.payment_date
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
       LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
       LEFT JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
       LEFT JOIN designation_master des ON des.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN branch_master br ON br.id = e.branch_id
       LEFT JOIN location_master loc ON loc.id = e.location_id
       LEFT JOIN salary_run_disbursal srd
         ON srd.run_id = spl.run_id
        AND srd.employee_id = spl.employee_id
      WHERE spl.employee_id = ?
        AND spr.run_month LIKE ?
        AND spl.status NOT IN ('draft')
        AND (
          spr.run_month < DATE_FORMAT(CURDATE(), '%Y-%m')
          OR srd.cheque_no IS NOT NULL
        )
      ORDER BY spr.run_month DESC`,
    [callerEmp.id, `${year}-%`]
  );

  // For each line, fetch detailed component breakdown
  for (const line of rows as any[]) {
    const [components] = await db.execute<RowDataPacket[]>(
      `SELECT component_code, component_name, component_type, amount, taxable
       FROM salary_prep_line_component
       WHERE line_id = ?
       ORDER BY
         CASE component_type
           WHEN 'earning' THEN 1
           WHEN 'deduction' THEN 2
           ELSE 3
         END,
         component_code`,
      [line.id]
    );

    // Split components by type
    line.earnings = (components as any[]).filter(c => c.component_type === 'earning');
    line.deductions = (components as any[]).filter(c => c.component_type === 'deduction');
    line.employer_costs = (components as any[]).filter(c => c.component_type === 'employer_cost');

    // If basic/hra/special_allowance columns are NULL, populate from components
    if (!line.basic) {
      const basicComp = line.earnings.find((e: any) => e.component_code === 'BASIC');
      line.basic = basicComp ? Number(basicComp.amount) : 0;
    }
    if (!line.hra) {
      const hraComp = line.earnings.find((e: any) => e.component_code === 'HRA');
      line.hra = hraComp ? Number(hraComp.amount) : 0;
    }
    if (!line.special_allowance) {
      const specialComp = line.earnings.find((e: any) => e.component_code === 'SPECIAL');
      line.special_allowance = specialComp ? Number(specialComp.amount) : 0;
    }
  }

  await logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "PAYSLIP_HISTORY_VIEWED",
    module_key: "payroll",
    entity_type: "employee",
    entity_id: callerEmp.id,
    change_summary: { year, statement_count: rows.length },
    req,
  });

  return res.json({ success: true, data: rows });
}));

// GET /api/payroll/verify/payslip/:empCode/:monthYear — PUBLIC (no auth) — QR code verify
// monthYear is encoded as "May - 2025" (URL-encoded). Parse to YYYY-MM for DB lookup.
router.get("/verify/payslip/:empCode/:monthYear", h(async (req: any, res: Response) => {
  const empCode = req.params.empCode ?? "";
  const monthYearRaw = decodeURIComponent(req.params.monthYear ?? "");

  // Parse "May - 2025" → "2025-05"
  const MONTH_MAP: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };
  let runMonth = "";
  const parts = monthYearRaw.split(/\s*-\s*/);
  if (parts.length === 2) {
    const monthNum = MONTH_MAP[parts[0].trim().toLowerCase()];
    const year = parts[1].trim();
    if (monthNum && /^\d{4}$/.test(year)) {
      runMonth = `${year}-${monthNum}`;
    }
  }

  if (!empCode || !runMonth) {
    return res.json({ verified: false, message: "Invalid or missing payslip reference" });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT sp.payslip_ref, sp.generated_at,
            spr.run_month,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            e.employee_code
       FROM salary_payslip sp
       JOIN salary_prep_line spl ON spl.id = sp.prep_line_id
       JOIN salary_prep_run spr  ON spr.id = spl.run_id
       JOIN employees e          ON e.id   = sp.employee_id
      WHERE e.employee_code = ?
        AND spr.run_month   = ?
      LIMIT 1`,
    [empCode, runMonth]
  );

  const rec = (rows as any[])[0];
  if (!rec) {
    return res.json({ verified: false, message: "Payslip not found for this employee and period" });
  }

  // Salary figures are NOT returned here — this endpoint is public (QR verification only).
  // Compensation data is only accessible through authenticated payslip endpoints.
  return res.json({
    verified: true,
    employee_name: rec.employee_name,
    employee_code: rec.employee_code,
    run_month: rec.run_month,
    payslip_ref: rec.payslip_ref,
    generated_at: rec.generated_at,
  });
}));

// GET /api/payroll/payslip/:runId/:employeeId — admin/hr/finance/payroll or employee own
router.get("/payslip/:runId/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const { runId, employeeId } = req.params;

  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }

  const raw = await payslipService.getPayslip(employeeId, runId);
  // Parse run_month (YYYY-MM) into numeric month/year for frontend
  const [runYear, runMon] = (raw.run_month ?? '').split('-').map(Number);
  const data = { ...raw, month: runMon || 0, year: runYear || 0 };
  return res.json({ success: true, data });
}));

// GET /api/payroll/payslip/list/:employeeId — paginated payslip history for one employee (admin/HR view)
router.get("/payslip/list/:employeeId", requireAuth, requireRole("super_admin", "admin", "hr", "finance", "payroll", "ceo"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 12)));
  const offset = (page - 1) * limit;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pr.id AS run_id, pr.run_label, pr.period_label, pr.pay_date,
            pe.net_pay, pe.gross_pay, pe.total_deductions, pe.status
       FROM payroll_employee pe
       JOIN payroll_run pr ON pr.id = pe.run_id
      WHERE pe.employee_id = ? AND pe.status != 'draft'
      ORDER BY pr.pay_date DESC LIMIT ? OFFSET ?`,
    [employeeId, limit, offset],
  );
  const [[countRow]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM payroll_employee pe
       JOIN payroll_run pr ON pr.id = pe.run_id
      WHERE pe.employee_id = ? AND pe.status != 'draft'`,
    [employeeId],
  );
  return res.json({ success: true, data: rows, total: Number(countRow.total), page, limit });
}));

// GET /api/payroll/payslip/history/:employeeId — HR/admin view of any employee's payslip list
router.get("/payslip/history/:employeeId", requireAuth, requireRole("super_admin", "admin", "hr", "payroll_head", "payroll_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 24)));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.run_id, spl.gross_salary, spl.total_deductions, spl.net_salary,
            spl.status, spr.disbursed_at AS paid_at, spr.status AS run_status, spr.run_month
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ?
      ORDER BY spr.run_month DESC
      LIMIT ?`,
    [employeeId, limit]
  );
  return res.json({ success: true, data: rows });
}));

// POST /api/payroll/payslip/:runId/generate — admin/hr/finance/payroll only
router.post(
  "/payslip/:runId/generate",
  requireRole("admin", "hr", "super_admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId } = req.body as { employeeId?: string };
    if (!employeeId) {
      return res.status(400).json({ success: false, message: "employeeId is required" });
    }

    const data = await payslipService.generatePayslip(req.params.runId, employeeId, req.authUser!.id, req);
    return res.status(201).json({ success: true, data, message: "Payslip generated" });
  })
);

// POST /api/payroll/payslip/:payslipId/acknowledge — employee self (server-mapped)
router.post("/payslip/:payslipId/acknowledge", h(async (req: AuthenticatedRequest, res: Response) => {
  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  if (!callerEmp) {
    return res.status(403).json({ success: false, message: "No employee record" });
  }
  const data = await payslipService.acknowledgePayslip(req.params.payslipId, callerEmp.id);
  return res.json({ success: true, data, message: "Payslip acknowledged" });
}));

// ─── Tax Declaration ──────────────────────────────────────────────────────────

// GET /api/payroll/tax-declaration/:employeeId/:year — admin/hr/finance/payroll or employee own
router.get("/tax-declaration/:employeeId/:year", h(async (req: AuthenticatedRequest, res: Response) => {
  let { employeeId } = req.params;
  const { year } = req.params;

  // Resolve "me" alias to the caller's employee ID
  if (employeeId === 'me') {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp) return res.status(403).json({ success: false, message: 'No employee record for authenticated user' });
    employeeId = callerEmp.id;
  }

  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only view your own tax declaration" });
    }
  }

  const [data, history] = await Promise.all([
    taxDeclarationService.find(employeeId, year),
    taxDeclarationService.listHistory(employeeId),
  ]);
  return res.json({ success: true, data, history });
}));

// POST /api/payroll/tax-declaration/:employeeId/:year — admin/hr/finance/payroll or employee own
router.post("/tax-declaration/:employeeId/:year", h(async (req: AuthenticatedRequest, res: Response) => {
  let { employeeId } = req.params;
  const { year } = req.params;

  // Resolve "me" alias to the caller's employee ID
  if (employeeId === 'me') {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp) return res.status(403).json({ success: false, message: 'No employee record' });
    employeeId = callerEmp.id;
  }

  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only submit your own tax declaration" });
    }
    const data = await taxDeclarationService.upsert(callerEmp.id, year, req.body, req.authUser!.id);
    return res.json({ success: true, data, message: "Tax declaration saved" });
  }

  const data = await taxDeclarationService.upsert(employeeId, year, req.body, req.authUser!.id);
  return res.json({ success: true, data, message: "Tax declaration saved" });
}));

// POST /api/payroll/tax-declaration/:employeeId/:year/document — upload tax proof document
const taxDocUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(UPLOADS_ROOT, "tax-documents");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed for tax documents`));
  },
});

router.post("/tax-declaration/:employeeId/:year/document", (req: any, res: any, next: any) => {
  taxDocUpload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}, h(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

  let { employeeId } = req.params;
  const { year } = req.params;
  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");

  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only upload your own tax documents" });
    }
    employeeId = callerEmp.id;
  }

  const documentType = (req.body?.document_type as string) || "tax_declaration";
  const documentName = (req.body?.document_name as string) || req.file.originalname;
  const fileUrl = `/api/files/tax-documents/${req.file.filename}`;
  const id = randomUUID();

  await db.execute(
    `INSERT INTO employee_documents (id, employee_id, doc_type, doc_name, file_url, uploaded_by, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, employeeId, documentType, documentName, fileUrl, req.authUser!.id, JSON.stringify({ financial_year: year })]
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, doc_type AS document_type, doc_name AS document_name, file_url, verified, created_at AS uploaded_at
     FROM employee_documents WHERE id = ? LIMIT 1`,
    [id]
  );

  res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// GET /api/payroll/tax-declaration/:employeeId/:year/documents — list tax docs for employee+year
router.get("/tax-declaration/:employeeId/:year/documents", h(async (req: AuthenticatedRequest, res: Response) => {
  let { employeeId } = req.params;
  const { year } = req.params;
  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");

  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    employeeId = callerEmp.id;
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, doc_type AS document_type, doc_name AS document_name, file_url, verified, created_at AS uploaded_at
     FROM employee_documents
     WHERE employee_id = ? AND doc_type LIKE 'tax_%' AND (metadata_json IS NULL OR metadata_json LIKE ?)
     ORDER BY created_at DESC`,
    [employeeId, `%${year}%`]
  );

  res.json({ success: true, data: rows });
}));

// PATCH /api/payroll/tax-declaration/:employeeId/:year/verify — HR verify or reject a declaration
router.patch("/tax-declaration/:employeeId/:year/verify", requireRole("admin", "hr", "super_admin", "payroll", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId, year } = req.params;
  const { status, review_note } = req.body as { status?: "verified" | "rejected"; review_note?: string };
  const targetStatus = status === "rejected" ? "rejected" : "verified";

  const declaration = await taxDeclarationService.find(employeeId, year);
  if (!declaration) {
    return res.status(404).json({ success: false, message: "Tax declaration not found" });
  }

  await db.execute(
    `UPDATE tax_declaration_form12bb_detail
        SET submission_status = ?, verified_by = ?, verified_at = NOW(), review_note = ?
      WHERE declaration_id = ?`,
    [targetStatus, req.authUser!.id, review_note ?? null, declaration.id]
  );

  void logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "tax_declaration_verify",
    module_key: "payroll",
    entity_type: "tax_declaration",
    entity_id: declaration.id,
    change_summary: { employee_id: employeeId, financial_year: year, status: targetStatus, review_note },
    req,
  });

  return res.json({ success: true, message: `Declaration ${targetStatus}`, data: { submission_status: targetStatus } });
}));

// DELETE /api/payroll/tax-declaration/:employeeId/:year/document/:docId — delete a tax proof document
router.delete("/tax-declaration/:employeeId/:year/document/:docId", requireRole("admin", "hr", "super_admin", "payroll", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId, docId } = req.params;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, file_url FROM employee_documents WHERE id = ? AND employee_id = ? LIMIT 1`,
    [docId, employeeId]
  );
  if (!(rows as RowDataPacket[]).length) {
    return res.status(404).json({ success: false, message: "Document not found" });
  }

  await db.execute(`DELETE FROM employee_documents WHERE id = ?`, [docId]);

  void logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "tax_document_delete",
    module_key: "payroll",
    entity_type: "employee_documents",
    entity_id: docId,
    change_summary: { employee_id: employeeId },
    req,
  });

  return res.json({ success: true, message: "Document deleted" });
}));

// ─── UAN ─────────────────────────────────────────────────────────────────────

// GET /api/payroll/uan/:employeeId — admin/hr/finance/payroll or self
router.get("/uan/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const isPrivileged = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPrivileged) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM employee_uan WHERE employee_id = ? LIMIT 1",
    [employeeId]
  );
  return res.json({ success: true, data: (rows as RowDataPacket[])[0] ?? null });
}));

// POST /api/payroll/uan/:employeeId — upsert UAN (admin/hr/finance)
router.post("/uan/:employeeId", requireRole("admin", "hr", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const { uan, member_id, epf_join_date } = req.body as {
    uan: string;
    member_id?: string;
    epf_join_date?: string;
  };
  if (!uan) return res.status(400).json({ success: false, message: "uan is required" });

  await db.execute(
    `INSERT INTO employee_uan (id, employee_id, uan, member_id, epf_join_date)
       VALUES (UUID(), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         uan = VALUES(uan),
         member_id = VALUES(member_id),
         epf_join_date = VALUES(epf_join_date),
         updated_at = NOW()`,
    [employeeId, uan, member_id ?? null, epf_join_date ?? null]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM employee_uan WHERE employee_id = ? LIMIT 1",
    [employeeId]
  );
  return res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// ─── Disbursements ────────────────────────────────────────────────────────────

// POST /api/payroll/disbursements — record a bank disbursement
router.post(
  "/disbursements",
  requireRole("admin", "super_admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { run_id, bank_ref, total_amount, employee_count } = req.body as {
      run_id: string;
      bank_ref?: string;
      total_amount: number;
      employee_count: number;
    };

    if (!run_id || total_amount === undefined || employee_count === undefined) {
      return res.status(400).json({ success: false, message: "run_id, total_amount, employee_count are required" });
    }

    const [runCheck] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM salary_prep_run WHERE id = ? LIMIT 1",
      [run_id]
    );
    if (!(runCheck as RowDataPacket[]).length) {
      return res.status(404).json({ success: false, message: "Payroll run not found" });
    }

    const id = (await import("crypto")).randomUUID();
    const actorId = req.authUser?.id ?? null;
    await db.execute(
      `INSERT INTO payroll_disbursement (id, run_id, bank_ref, total_amount, employee_count, disbursed_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, run_id, bank_ref ?? null, total_amount, employee_count, actorId]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_disbursement WHERE id = ? LIMIT 1",
      [id]
    );
    return res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// GET /api/payroll/disbursements/:runId — get disbursement for a run
router.get(
  "/disbursements/:runId",
  requireRole("admin", "super_admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_disbursement WHERE run_id = ? ORDER BY created_at DESC",
      [req.params.runId]
    );
    return res.json({ success: true, data: rows });
  })
);

// PATCH /api/payroll/disbursements/:id — update disbursement status
router.patch(
  "/disbursements/:id",
  requireRole("admin", "super_admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { status, disbursed_at } = req.body as {
      status?: "completed" | "failed";
      disbursed_at?: string;
    };

    const allowed = new Set(["completed", "failed"]);
    if (status && !allowed.has(status)) {
      return res.status(400).json({ success: false, message: "status must be 'completed' or 'failed'" });
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (status)       { sets.push("status = ?");       params.push(status); }
    if (disbursed_at) { sets.push("disbursed_at = ?"); params.push(disbursed_at); }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    params.push(req.params.id);
    const [result] = await db.execute(
      `UPDATE payroll_disbursement SET ${sets.join(", ")} WHERE id = ?`,
      params
    ) as unknown as [{ affectedRows: number }, unknown];

    if ((result as { affectedRows: number }).affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Disbursement not found" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_disbursement WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    return res.json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// ─── Form 16 Data ─────────────────────────────────────────────────────────────

// GET /api/payroll/form16-data/:runId/:employeeId — Form 16 Part B structured data
router.get(
  "/form16-data/:runId/:employeeId",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId, employeeId } = req.params;

    const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
    if (!isPayrollRole) {
      const callerEmp = await getEmployeeForUser(req.authUser!.id);
      if (!callerEmp || callerEmp.id !== employeeId) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    }

    // Load run
    const [runRows] = await db.execute<RowDataPacket[]>(
      "SELECT run_month FROM salary_prep_run WHERE id = ? LIMIT 1",
      [runId]
    );
    const run = (runRows as Array<{ run_month: string }>)[0];
    if (!run) return res.status(404).json({ success: false, message: "Run not found" });

    // Load prep line for gross / TDS
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT spl.gross_salary, spl.tds_amount, spl.tds
         FROM salary_prep_line spl
        WHERE spl.run_id = ? AND spl.employee_id = ? LIMIT 1`,
      [runId, employeeId]
    );
    const line = (lineRows as Array<{ gross_salary: number; tds_amount: number; tds: number }>)[0];
    if (!line) return res.status(404).json({ success: false, message: "Payroll line not found for employee" });

    // Load employee details
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT CONCAT_WS(' ', e.first_name, e.last_name) AS name,
              ed.pan_number AS pan,
              dm.designation_name AS designation,
              e.date_of_joining
         FROM employees e
         LEFT JOIN employee_documents ed  ON ed.employee_id = e.id
         LEFT JOIN designation_master dm  ON dm.id = e.designation_id
        WHERE e.id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = (empRows as Array<{
      name: string; pan: string | null; designation: string | null; date_of_joining: string | null;
    }>)[0];

    // Derive financial year for declaration lookup
    const [yr, mo] = run.run_month.split("-").map(Number);
    const fyStart = mo >= 4 ? yr : yr - 1;
    const financialYear = `${fyStart}-${fyStart + 1}`;
    const legacyFinancialYear = `${fyStart}-${String(fyStart + 1).slice(2)}`;

    // Load tax declaration
    const [declRows] = await db.execute<RowDataPacket[]>(
      `SELECT declared_hra, declared_80c, declared_80d, regime
         FROM tax_declaration
        WHERE employee_id = ? AND financial_year IN (?, ?)
        ORDER BY financial_year = ? DESC
        LIMIT 1`,
      [employeeId, financialYear, legacyFinancialYear, financialYear]
    );
    const decl = (declRows as Array<{
      declared_hra: number; declared_80c: number; declared_80d: number; regime: string;
    }>)[0] ?? null;

    const grossSalary = Number(line.gross_salary);
    const standardDeduction = 75000;
    const tdsDeducted = Number(line.tds_amount) || Number(line.tds) || 0;
    const totalDeductions = standardDeduction
      + (decl ? Number(decl.declared_hra) + Number(decl.declared_80c) + Number(decl.declared_80d) : 0);
    const netTaxableIncome = Math.max(0, (grossSalary * 12) - totalDeductions);

    return res.json({
      success: true,
      data: {
        financial_year: financialYear,
        period: run.run_month,
        employee: {
          name: emp?.name ?? "",
          pan: emp?.pan ?? null,
          designation: emp?.designation ?? null,
          period: `Apr ${fyStart} – Mar ${fyStart + 1}`,
        },
        gross_salary: grossSalary,
        standard_deduction: standardDeduction,
        tds_deducted: tdsDeducted,
        net_taxable_income: netTaxableIncome,
        declaration: decl
          ? {
              hra: Number(decl.declared_hra),
              "80c": Number(decl.declared_80c),
              "80d": Number(decl.declared_80d),
              regime: decl.regime,
            }
          : null,
      },
    });
  })
);

// ─── Analytics ────────────────────────────────────────────────────────────────

// GET /api/payroll/analytics/trends?months=6
router.get("/analytics/trends", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const months = Math.min(24, Math.max(1, Number(req.query.months ?? 6)));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spr.run_month,
            COUNT(DISTINCT spl.employee_id) AS headcount,
            ROUND(SUM(spl.gross_salary),2)    AS total_gross,
            ROUND(SUM(spl.total_deductions),2) AS total_deductions,
            ROUND(SUM(spl.net_salary),2)      AS total_net
     FROM salary_prep_line spl
     JOIN salary_prep_run spr ON spr.id = spl.run_id
     WHERE spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ? MONTH), '%Y-%m')
       AND spl.status != 'cancelled'
     GROUP BY spr.run_month
     ORDER BY spr.run_month ASC`,
    [months]
  );
  return res.json({ success: true, data: rows });
}));

// GET /api/payroll/analytics?dimension=department&runMonth=2026-06
router.get("/analytics", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const dimension = (req.query.dimension as string) || "department";
  let runMonth = req.query.runMonth as string | undefined;

  // Resolve the canonical single run for the month (most-progressed status, newest on tie)
  const pickRunId = async (month: string): Promise<string | null> => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_prep_run
        WHERE run_month = ? AND status NOT IN ('cancelled')
        ORDER BY
          CASE status
            WHEN 'disbursed'  THEN 1
            WHEN 'locked'     THEN 2
            WHEN 'approved'   THEN 3
            WHEN 'completed'  THEN 4
            WHEN 'processing' THEN 5
            WHEN 'draft'      THEN 6
            ELSE 7
          END,
          created_at DESC
        LIMIT 1`,
      [month]
    );
    return (rows as any[])[0]?.id ?? null;
  };

  if (!runMonth) {
    const [latest] = await db.execute<RowDataPacket[]>(
      `SELECT run_month FROM salary_prep_run WHERE status NOT IN ('draft','cancelled')
       ORDER BY run_month DESC LIMIT 1`
    );
    runMonth = (latest as any[])[0]?.run_month;
    if (!runMonth) return res.json({ success: true, runMonth: null, kpi: {}, data: [] });
  }

  const runId = await pickRunId(runMonth);
  if (!runId) return res.json({ success: true, runMonth, kpi: {}, data: [] });

  const [kpiRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT spl.employee_id)             AS headcount,
            ROUND(SUM(spl.net_salary),2)                AS total_net,
            ROUND(AVG(spl.net_salary),2)                AS avg_net,
            ROUND(SUM(spl.gross_salary),2)              AS total_gross,
            ROUND(SUM(COALESCE(spl.pf_employer,0)),2)   AS total_pf_employer,
            ROUND(SUM(COALESCE(spl.esic_employer,0)),2) AS total_esic_employer
     FROM salary_prep_line spl
     WHERE spl.run_id = ? AND spl.status != 'cancelled'`,
    [runId]
  );

  const DIM: Record<string, { sel: string; join: string; grp: string }> = {
    department: {
      sel:  "COALESCE(dm.dept_name, 'Unknown') AS dimension_name",
      join: "LEFT JOIN department_master dm ON dm.id = e.department_id",
      grp:  "e.department_id, dm.dept_name",
    },
    branch: {
      sel:  "COALESCE(bm.branch_name, 'Unknown') AS dimension_name",
      join: "LEFT JOIN branch_master bm ON bm.id = e.branch_id",
      grp:  "e.branch_id, bm.branch_name",
    },
    process: {
      sel:  "COALESCE(pm.process_name, 'Unknown') AS dimension_name",
      join: "LEFT JOIN process_master pm ON pm.id = e.process_id",
      grp:  "e.process_id, pm.process_name",
    },
  };
  const d = DIM[dimension] ?? DIM.department;

  const [dimRows] = await db.execute<RowDataPacket[]>(
    `SELECT ${d.sel},
            COUNT(DISTINCT spl.employee_id)                                                           AS headcount,
            ROUND(SUM(spl.basic),2)                                                                   AS total_basic,
            ROUND(SUM(COALESCE(spl.hra,0)+COALESCE(spl.special_allowance,0)),2) AS total_allowances,
            ROUND(SUM(spl.gross_salary),2)                                                            AS total_gross,
            ROUND(SUM(spl.total_deductions),2)                                                        AS total_deductions,
            ROUND(SUM(spl.net_salary),2)                                                              AS total_net,
            ROUND(SUM(COALESCE(spl.pf_employer,0)),2)                                                 AS total_pf_employer,
            ROUND(SUM(COALESCE(spl.esic_employer,0)),2)                                               AS total_esic_employer
     FROM salary_prep_line spl
     LEFT JOIN employees e ON e.id = spl.employee_id
     ${d.join}
     WHERE spl.run_id = ? AND spl.status != 'cancelled'
     GROUP BY ${d.grp}
     ORDER BY total_net DESC`,
    [runId]
  );

  return res.json({ success: true, runMonth, kpi: (kpiRows as any[])[0] ?? {}, data: dimRows });
}));

// ─── PT Slabs ─────────────────────────────────────────────────────────────────

// GET /api/payroll/pt-slabs — list PT slabs; optional ?state_code=
router.get("/pt-slabs", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { state_code } = req.query as { state_code?: string };
  const params: unknown[] = [];
  let where = "WHERE is_active = 1";
  if (state_code) {
    where += " AND state_code = ?";
    params.push(state_code);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM pt_slab_master ${where} ORDER BY state_code, income_from`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// POST /api/payroll/pt-slabs — create slab (admin/finance)
router.post(
  "/pt-slabs",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from } =
      req.body as {
        state_code: string;
        state_name: string;
        income_from: number;
        income_to?: number | null;
        pt_amount: number;
        frequency: string;
        effective_from: string;
      };

    if (!state_code || !state_name || income_from === undefined || pt_amount === undefined || !frequency || !effective_from) {
      return res.status(400).json({ success: false, message: "state_code, state_name, income_from, pt_amount, frequency, effective_from are required" });
    }

    const id = (await import("crypto")).randomUUID();
    await db.execute(
      `INSERT INTO pt_slab_master (id, state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, state_code, state_name, income_from, income_to ?? null, pt_amount, frequency, effective_from]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM pt_slab_master WHERE id = ? LIMIT 1",
      [id]
    );
    return res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// PATCH /api/payroll/pt-slabs/:id — update slab (admin/finance)
router.patch(
  "/pt-slabs/:id",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { pt_amount, income_to, is_active } = req.body as {
      pt_amount?: number;
      income_to?: number | null;
      is_active?: number;
    };

    const sets: string[] = [];
    const params: unknown[] = [];

    if (pt_amount !== undefined) { sets.push("pt_amount = ?");  params.push(pt_amount); }
    if (income_to !== undefined) { sets.push("income_to = ?");  params.push(income_to ?? null); }
    if (is_active !== undefined) { sets.push("is_active = ?");  params.push(is_active); }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    params.push(id);
    const patchResult = await db.execute(
      `UPDATE pt_slab_master SET ${sets.join(", ")} WHERE id = ?`,
      params
    );
    const result = (patchResult as unknown as [{ affectedRows: number }, unknown])[0];

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "PT slab not found" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM pt_slab_master WHERE id = ? LIMIT 1",
      [id]
    );
    return res.json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// ─── Minimum Wages ────────────────────────────────────────────────────────────

// GET /api/payroll/minimum-wages — list minimum wages; optional ?state_code=
router.get("/minimum-wages", requireRole("admin", "hr", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { state_code } = req.query as { state_code?: string };
  const params: unknown[] = [];
  let where = "WHERE is_active = 1";
  if (state_code) {
    where += " AND state_code = ?";
    params.push(state_code);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM minimum_wage_master ${where} ORDER BY state_code, category`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// ─── NEFT Export ─────────────────────────────────────────────────────────────

// GET /api/payroll/runs/:id/neft-summary — count of employees with/without bank details
router.get("/runs/:id/neft-summary", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                                                          AS total,
       SUM(CASE WHEN ebd.id IS NOT NULL AND ebd.ifsc_code IS NOT NULL THEN 1 ELSE 0 END) AS with_bank,
       SUM(CASE WHEN ebd.id IS NULL OR ebd.ifsc_code IS NULL THEN 1 ELSE 0 END)          AS missing_bank,
       SUM(spl.net_salary)                                                               AS total_net
     FROM salary_prep_line spl
     JOIN employees e ON e.id = spl.employee_id
     LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = spl.employee_id
     WHERE spl.run_id = ? AND spl.net_salary > 0`,
    [req.params.id]
  );
  res.json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// GET /api/payroll/runs/:runId/neft-lines
// Per-employee bank details (full account numbers) + net salary for Finance NEFT file preparation
// Returns decrypted full bank account numbers — use for NEFT transfer prep only, not dashboard display
router.get(
  "/runs/:runId/neft-lines",
  requireAuth,
  requireRole("admin", "super_admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params;

    // Validate runId is a valid UUID
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
      return res.status(400).json({ success: false, error: "Invalid run ID format" });
    }

    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId]
    );
    if (!(runRows as RowDataPacket[]).length) {
      return res.status(404).json({ success: false, error: "Payroll run not found" });
    }
    const run = (runRows as RowDataPacket[])[0];

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.employee_code,
              e.first_name,
              e.last_name,
              COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              ebd.bank_name,
              ebd.ifsc_code,
              COALESCE(ebd.account_holder_name, CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS account_holder_name,
              AES_DECRYPT(ebd.account_number, ?) AS account_number,
              spl.net_salary,
              spl.gross_salary,
              spl.total_deductions,
              spl.status AS line_status
         FROM salary_prep_line spl
         JOIN employees e ON e.id = spl.employee_id
         LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = spl.employee_id
        WHERE spl.run_id = ?
          AND spl.net_salary > 0
        ORDER BY e.employee_code ASC`,
      [env.PAYROLL_BANK_KEY, runId]
    );

    const lines = (rows as RowDataPacket[]).map((r: any) => ({
      ...r,
      account_number: r.account_number?.toString() ?? null,
    }));

    return res.json({
      success: true,
      run,
      data: lines,
      meta: {
        count: lines.length,
        total_net: lines.reduce((sum: number, r: any) => sum + Number(r.net_salary ?? 0), 0),
      },
    });
  })
);

// GET /api/payroll/runs/:id/neft-export — generate NEFT disbursement CSV
router.get("/runs/:id/neft-export", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;

  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1",
    [runId]
  );
  const run = (runRows as RowDataPacket[])[0];
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (!["locked", "disbursed"].includes(run.status as string)) {
    return res.status(400).json({ error: "Run must be locked or disbursed to generate NEFT export" });
  }
  if (run.validation_status && run.validation_status !== 'validated') {
    return res.status(403).json({ success: false, message: "Payroll must be validated before generating NEFT export. Current status: " + run.validation_status });
  }

  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT spl.employee_id, spl.net_salary, spl.gross_salary, spl.total_deductions,
            e.employee_code, e.full_name, e.email,
            ebd.bank_name, ebd.ifsc_code,
            AES_DECRYPT(ebd.account_number, ?) AS account_number
     FROM salary_prep_line spl
     JOIN employees e ON e.id = spl.employee_id
     LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = spl.employee_id
     WHERE spl.run_id = ? AND spl.net_salary > 0
     ORDER BY e.employee_code`,
    [env.PAYROLL_BANK_KEY, runId]
  );

  // Standard Indian bank NEFT format
  // Columns: Sr No, Employee Code, Employee Name, Bank Name, IFSC Code, Account Number, Net Amount, Remarks
  const csvRows = ["Sr No,Employee Code,Employee Name,Bank Name,IFSC Code,Account Number,Net Amount,Remarks"];
  let srNo = 1;
  let totalAmount = 0;

  for (const line of lines as RowDataPacket[]) {
    const accountNo = line.account_number ? String(line.account_number) : "NOT_LINKED";
    const ifsc = (line.ifsc_code as string | null) ?? "NOT_LINKED";
    const bank = ((line.bank_name as string | null) ?? "").replace(/,/g, " ");
    const name = ((line.full_name as string | null) ?? "").replace(/,/g, " ");
    const amount = Number(line.net_salary).toFixed(2);
    const remarks = `SALARY ${run.run_month as string}`;
    csvRows.push(`${srNo},${line.employee_code as string},${name},${bank},${ifsc},${accountNo},${amount},${remarks}`);
    srNo++;
    totalAmount += Number(line.net_salary);
  }

  csvRows.push(`TOTAL,,,,,,${totalAmount.toFixed(2)},`);

  const csv = csvRows.join("\n");
  const filename = `NEFT_${run.run_month as string}_${runId.slice(0, 8)}.csv`;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}));

// ─── Payroll Validation / Rejection (Head Payroll) ───────────────────────────

// PATCH /api/payroll/runs/:id/validate — Head Payroll validates a run (unlocks NEFT export)
router.patch("/runs/:id/validate", requireAuth, h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRoleAsync(userId, "payroll_head", "super_admin"))) {
    return res.status(403).json({ success: false, message: "Only Head Payroll can validate a payroll run" });
  }
  const { note } = req.body as { note?: string };
  const [runRows] = await db.execute("SELECT id, status, validation_status FROM salary_prep_run WHERE id = ? LIMIT 1", [req.params.id]);
  const run = (runRows as any[])[0];
  if (!run) return res.status(404).json({ success: false, message: "Run not found" });
  if (run.validation_status === "validated") return res.status(400).json({ success: false, message: "Already validated" });

  await db.execute(
    `UPDATE salary_prep_run SET validation_status = 'validated', validated_by = ?, validated_at = NOW() WHERE id = ?`,
    [userId, req.params.id]
  );
  await db.execute(
    `INSERT INTO payroll_validation_log (id, run_id, action, actor_id, actor_role, reason, created_at) VALUES (UUID(), ?, 'validated', ?, ?, ?, NOW())`,
    [req.params.id, userId, req.authUser!.role, note ?? null]
  );
  return res.json({ success: true, message: "Payroll run validated. NEFT export is now unlocked." });
}));

// PATCH /api/payroll/runs/:id/reject-validation — Head Payroll rejects a run
router.patch("/runs/:id/reject-validation", requireAuth, h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRoleAsync(userId, "payroll_head", "super_admin"))) {
    return res.status(403).json({ success: false, message: "Only Head Payroll can reject a payroll run" });
  }
  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) return res.status(400).json({ success: false, message: "Rejection reason is required" });
  const [runRows] = await db.execute("SELECT id, status, validation_status FROM salary_prep_run WHERE id = ? LIMIT 1", [req.params.id]);
  const run = (runRows as any[])[0];
  if (!run) return res.status(404).json({ success: false, message: "Run not found" });

  await db.execute(
    `UPDATE salary_prep_run SET validation_status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ? WHERE id = ?`,
    [userId, reason, req.params.id]
  );
  await db.execute(
    `INSERT INTO payroll_validation_log (id, run_id, action, actor_id, actor_role, reason, created_at) VALUES (UUID(), ?, 'rejected', ?, ?, ?, NOW())`,
    [req.params.id, userId, req.authUser!.role, reason]
  );
  return res.json({ success: true, message: "Payroll run rejected. Recalculation required before re-validation." });
}));

// ─── ECR / ESIC Challan ───────────────────────────────────────────────────────

// GET /api/payroll/runs/:id/ecr — ECR-format data for a run
router.get("/runs/:id/ecr", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;

  // Verify run exists
  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1",
    [runId]
  );
  if (!(runRows as RowDataPacket[]).length) {
    return res.status(404).json({ success: false, message: "Run not found" });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       eu.uan,
       eu.member_id,
       CONCAT_WS(' ', e.first_name, e.last_name) AS member_name,
       spl.gross_salary                           AS wages,
       spl.pf_employee                            AS epf_contribution,
       (spl.pf_employer - ROUND(spl.pf_employer * 3.67 / 12, 2)) AS eps_contribution
     FROM salary_prep_line spl
     JOIN employees e        ON e.id  = spl.employee_id
     LEFT JOIN employee_uan eu ON eu.employee_id = spl.employee_id
     WHERE spl.run_id = ? AND spl.status != 'cancelled'
     ORDER BY e.employee_code`,
    [runId]
  );

  return res.json({ success: true, run_id: runId, data: rows });
}));

// GET /api/payroll/runs/:id/esic-challan — ESIC challan data for a run
router.get("/runs/:id/esic-challan", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;

  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1",
    [runId]
  );
  const run = (runRows as Array<{ id: string; run_month: string }>)[0];
  if (!run) {
    return res.status(404).json({ success: false, message: "Run not found" });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.employee_code,
       CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
       spl.gross_salary                           AS wages,
       spl.esic_employee                          AS employee_contribution,
       spl.esic_employer                          AS employer_contribution
     FROM salary_prep_line spl
     JOIN employees e ON e.id = spl.employee_id
     WHERE spl.run_id = ? AND spl.status != 'cancelled'
     ORDER BY e.employee_code`,
    [runId]
  );

  const lines = rows as Array<{
    employee_code: string;
    employee_name: string;
    wages: number;
    employee_contribution: number;
    employer_contribution: number;
  }>;

  const totals = lines.reduce(
    (acc, l) => {
      acc.total_wages        += Number(l.wages);
      acc.employee_total     += Number(l.employee_contribution);
      acc.employer_total     += Number(l.employer_contribution);
      return acc;
    },
    { total_wages: 0, employee_total: 0, employer_total: 0 }
  );

  return res.json({
    success: true,
    run_id: runId,
    period: run.run_month,
    employee_count: lines.length,
    ...totals,
    data: lines,
  });
}));

// ─── Payroll Dashboard Endpoints ──────────────────────────────────────

// GET /api/payroll/summary — payroll dashboard summary metrics
router.get("/summary", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [summary] = await db.execute<RowDataPacket[]>(`
    SELECT
      COUNT(DISTINCT e.id) as payroll_processed,
      COALESCE(SUM(e.ctc_annual), 0) as total_ctc,
      COALESCE(SUM(spl.gross_salary), 0) as total_gross,
      COALESCE(SUM(spl.net_salary), 0) as total_net,
      COALESCE(AVG(e.ctc_annual), 0) as avg_ctc
    FROM employees e
    LEFT JOIN salary_prep_line spl ON spl.employee_id = e.id
    WHERE e.active_status = 1 AND e.employment_status = 'active'
  `);
  return res.json({ success: true, data: (summary as RowDataPacket[])[0] || {} });
}));

// GET /api/payroll/compliance — payroll compliance check (statutory fields validation)
router.get("/compliance", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [compliance] = await db.execute<RowDataPacket[]>(`
    SELECT e.id, e.employee_code, CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
           e.pan_number, e.uan_number, e.epf_number, e.esic_number,
           CASE WHEN e.pan_number IS NOT NULL AND e.pan_number != '' THEN 'Valid' ELSE 'Missing' END as pan_status,
           CASE WHEN e.uan_number IS NOT NULL AND e.uan_number != '' THEN 'Valid' ELSE 'Missing' END as uan_status,
           CASE WHEN e.epf_number IS NOT NULL AND e.epf_number != '' THEN 'Valid' ELSE 'Missing' END as epf_status,
           CASE WHEN e.esic_number IS NOT NULL AND e.esic_number != '' THEN 'Valid' ELSE 'Missing' END as esic_status
    FROM employees e
    WHERE e.active_status = 1 AND e.employment_status = 'active'
    ORDER BY e.employee_code
    LIMIT 100
  `);
  return res.json({ success: true, data: compliance });
}));

// POST /api/payroll/runs/:id/finance-approve — Finance team approves run for disbursement
router.post(
  "/runs/:id/finance-approve",
  requireAuth,
  requireRole("finance", "admin", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const actorUserId = req.authUser!.id;
    try {
      const result = await (await import("./payroll.service.js")).approveRunForDisbursement(id, actorUserId);
      return res.json(result);
    } catch (err: any) {
      const msg = err.message ?? "Approval failed";
      if (msg.includes("not found")) {
        return res.status(404).json({ success: false, message: msg });
      }
      if (msg.includes("must be in")) {
        return res.status(400).json({ success: false, message: msg });
      }
      throw err;
    }
  })
);

// ─── Holiday Debug (diagnostic endpoint) ──────────────────────────────────────
import { holidayDebugRouter } from "./holiday-debug.routes.js";
router.use("/holiday-debug", holidayDebugRouter);

export { router as payrollRouter };
