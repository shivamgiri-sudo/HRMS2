import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";

export const payrollVarianceRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

payrollVarianceRouter.use(requireAuth);

type VarCategory =
  | "NEW_JOINER"
  | "LEAVER"
  | "SALARY_CHANGE"
  | "INCENTIVE_CHANGE"
  | "STATUTORY_CHANGE"
  | "DEDUCTION_CHANGE"
  | "OVERTIME_CHANGE"
  | "NO_CHANGE";

function categorize(curr: any, prev: any): VarCategory {
  if (!prev) return "NEW_JOINER";
  if (!curr) return "LEAVER";

  const gross  = Math.abs(Number(curr.gross_salary) - Number(prev.gross_salary));
  const net    = Math.abs(Number(curr.net_salary)   - Number(prev.net_salary));
  const incent = Math.abs(Number(curr.incentive_total ?? 0) - Number(prev.incentive_total ?? 0));
  const pf     = Math.abs((Number(curr.pf_employee) + Number(curr.pf_employer)) - (Number(prev.pf_employee) + Number(prev.pf_employer)));
  const esic   = Math.abs((Number(curr.esic_employee) + Number(curr.esic_employer)) - (Number(prev.esic_employee) + Number(prev.esic_employer)));
  const ded    = Math.abs(Number(curr.total_deductions ?? 0) - Number(prev.total_deductions ?? 0));
  const ot     = Math.abs(Number(curr.overtime_pay ?? 0) - Number(prev.overtime_pay ?? 0));

  if (net < 1) return "NO_CHANGE";
  if (incent > 100) return "INCENTIVE_CHANGE";
  if (ot > 100) return "OVERTIME_CHANGE";
  if (pf > 50 || esic > 50) return "STATUTORY_CHANGE";
  if (ded > 100) return "DEDUCTION_CHANGE";
  if (gross > 100) return "SALARY_CHANGE";
  return "NO_CHANGE";
}

// ─── GET /api/payroll/variance?month=YYYY-MM&compare_to=YYYY-MM ───────────────
payrollVarianceRouter.get(
  "/",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { month, compare_to } = req.query as { month?: string; compare_to?: string };

    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ success: false, message: "month (YYYY-MM) is required" });
    }

    const prevMonth = compare_to && /^\d{4}-(0[1-9]|1[0-2])$/.test(compare_to)
      ? compare_to
      : (() => {
          const [yr, mo] = month.split("-").map(Number);
          return mo === 1 ? `${yr - 1}-12` : `${yr}-${String(mo - 1).padStart(2, "0")}`;
        })();

    // Fetch current month lines
    const [currRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         spl.employee_id,
         e.employee_code,
         COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
         b.branch_name,
         d.department_name,
         dm.designation_name,
         spl.basic,
         spl.gross_salary,
         spl.net_salary,
         spl.pf_employee,
         spl.pf_employer,
         spl.esic_employee,
         spl.esic_employer,
         spl.tds,
         spl.professional_tax,
         COALESCE(spl.incentive_total, 0) AS incentive_total,
         COALESCE(spl.overtime_pay, 0) AS overtime_pay,
         COALESCE(spl.total_deductions, 0) AS total_deductions,
         spl.paid_working_days,
         spl.lwp_days
       FROM salary_prep_line spl
       JOIN salary_prep_run  spr ON spr.id = spl.run_id
       JOIN employees e          ON e.id  = spl.employee_id
       LEFT JOIN branch_master b          ON b.id  = e.branch_id
       LEFT JOIN department_master d      ON d.id  = e.department_id
       LEFT JOIN designation_master dm    ON dm.id = e.designation_id
       WHERE spr.run_month = ?`,
      [month]
    );

    // Fetch previous month lines
    const [prevRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         spl.employee_id,
         spl.basic,
         spl.gross_salary,
         spl.net_salary,
         spl.pf_employee,
         spl.pf_employer,
         spl.esic_employee,
         spl.esic_employer,
         spl.tds,
         spl.professional_tax,
         COALESCE(spl.incentive_total, 0) AS incentive_total,
         COALESCE(spl.overtime_pay, 0)    AS overtime_pay,
         COALESCE(spl.total_deductions, 0) AS total_deductions,
         spl.paid_working_days,
         spl.lwp_days
       FROM salary_prep_line spl
       JOIN salary_prep_run  spr ON spr.id = spl.run_id
       WHERE spr.run_month = ?`,
      [prevMonth]
    );

    const currMap = new Map<string, any>((currRows as any[]).map(r => [r.employee_id, r]));
    const prevMap = new Map<string, any>((prevRows as any[]).map(r => [r.employee_id, r]));

    // All employee IDs across both months
    const allIds = new Set([...currMap.keys(), ...prevMap.keys()]);

    const rows: any[] = [];
    let totalCurrNet  = 0;
    let totalPrevNet  = 0;
    let newJoiners    = 0;
    let leavers       = 0;
    let changed       = 0;

    for (const empId of allIds) {
      const curr = currMap.get(empId) ?? null;
      const prev = prevMap.get(empId) ?? null;
      const category = categorize(curr, prev);

      const currNet  = Number(curr?.net_salary  ?? 0);
      const prevNet  = Number(prev?.net_salary  ?? 0);
      const delta    = currNet - prevNet;
      const deltaPct = prevNet !== 0 ? Math.round((delta / prevNet) * 1000) / 10 : null;

      totalCurrNet += currNet;
      totalPrevNet += prevNet;
      if (category === "NEW_JOINER") newJoiners++;
      else if (category === "LEAVER") leavers++;
      else if (category !== "NO_CHANGE") changed++;

      rows.push({
        employee_id:     empId,
        employee_code:   (curr ?? prev)?.employee_code,
        employee_name:   (curr ?? prev)?.employee_name ?? (prev as any)?.employee_name,
        branch_name:     (curr ?? prev)?.branch_name,
        department_name: (curr ?? prev)?.department_name,
        designation_name:(curr ?? prev)?.designation_name,
        category,
        // Current month
        curr_gross:   curr?.gross_salary  ?? null,
        curr_net:     curr?.net_salary    ?? null,
        curr_basic:   curr?.basic         ?? null,
        curr_tds:     curr?.tds           ?? null,
        curr_pf:      curr ? Number(curr.pf_employee) + Number(curr.pf_employer) : null,
        curr_esic:    curr ? Number(curr.esic_employee) + Number(curr.esic_employer) : null,
        curr_incentive: curr?.incentive_total ?? null,
        curr_ot:      curr?.overtime_pay  ?? null,
        curr_ded:     curr?.total_deductions ?? null,
        // Prev month
        prev_net:     prev?.net_salary    ?? null,
        prev_gross:   prev?.gross_salary  ?? null,
        prev_basic:   prev?.basic         ?? null,
        // Deltas
        delta_net:    delta,
        delta_pct:    deltaPct,
      });
    }

    // Sort: NEW_JOINER, LEAVER, changed, NO_CHANGE
    const catOrder: Record<string, number> = {
      NEW_JOINER: 0, LEAVER: 1, SALARY_CHANGE: 2, INCENTIVE_CHANGE: 3,
      OVERTIME_CHANGE: 4, STATUTORY_CHANGE: 5, DEDUCTION_CHANGE: 6, NO_CHANGE: 7,
    };
    rows.sort((a, b) => (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9));

    // Category breakdown
    const breakdown: Record<string, number> = {};
    for (const r of rows) {
      breakdown[r.category] = (breakdown[r.category] ?? 0) + 1;
    }

    return res.json({
      success: true,
      data: {
        month,
        compare_to: prevMonth,
        summary: {
          total_employees_current: currMap.size,
          total_employees_previous: prevMap.size,
          net_bill_current:  Math.round(totalCurrNet),
          net_bill_previous: Math.round(totalPrevNet),
          delta_net_bill:    Math.round(totalCurrNet - totalPrevNet),
          new_joiners:  newJoiners,
          leavers,
          changed,
          breakdown,
        },
        rows,
      },
    });
  })
);

// ─── GET /api/payroll/variance/employee/:id ────────────────────────────────────
// Component-level breakdown for one employee across two months
payrollVarianceRouter.get(
  "/employee/:employeeId",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId } = req.params;
    const { month, compare_to } = req.query as { month?: string; compare_to?: string };

    if (!month) return res.status(400).json({ success: false, message: "month is required" });

    const prevMonth = compare_to ?? (() => {
      const [yr, mo] = (month as string).split("-").map(Number);
      return mo === 1 ? `${yr - 1}-12` : `${yr}-${String(mo - 1).padStart(2, "0")}`;
    })();

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT spr.run_month, spl.*
         FROM salary_prep_line spl
         JOIN salary_prep_run  spr ON spr.id = spl.run_id
         WHERE spl.employee_id = ? AND spr.run_month IN (?, ?)
         ORDER BY spr.run_month DESC`,
      [employeeId, month, prevMonth]
    );

    const byMonth: Record<string, any> = {};
    (rows as any[]).forEach(r => { byMonth[r.run_month] = r; });

    return res.json({
      success: true,
      data: {
        month,
        compare_to: prevMonth,
        current:  byMonth[month] ?? null,
        previous: byMonth[prevMonth] ?? null,
      },
    });
  })
);
