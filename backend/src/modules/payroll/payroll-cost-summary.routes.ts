import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";

export const payrollCostSummaryRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

payrollCostSummaryRouter.use(requireAuth);

type GroupByOption = "branch" | "process" | "department" | "cost_centre";

interface DimensionRow {
  dimension_name: string;
  headcount: number;
  total_basic: number;
  total_allowances: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  total_pf_employer: number;
  total_esic_employer: number;
  total_gratuity_provision: number;
}

interface KpiSummary {
  headcount: number;
  total_gross: number;
  total_net: number;
  total_pf_employer: number;
  total_esic_employer: number;
  total_gratuity_provision: number;
}

function buildActualQuery(groupBy: GroupByOption): string | null {
  switch (groupBy) {
    case "branch":
      return `
        SELECT
          bm.id                                                   AS dimension_id,
          COALESCE(bm.branch_name, 'Unknown')                     AS dimension_name,
          COUNT(DISTINCT spl.employee_id)                         AS headcount,
          SUM(spl.basic)                                          AS total_basic,
          SUM(spl.hra + spl.special_allowance + COALESCE(spl.incentive_total, 0)) AS total_allowances,
          SUM(spl.gross_salary)                                   AS total_gross,
          SUM(spl.total_deductions)                               AS total_deductions,
          SUM(spl.net_salary)                                     AS total_net,
          SUM(spl.pf_employer)                                    AS total_pf_employer,
          SUM(spl.esic_employer)                                  AS total_esic_employer,
          SUM(spl.basic * 0.0481)                                 AS total_gratuity_provision
        FROM salary_prep_line spl
        JOIN employees e ON e.id = spl.employee_id
        JOIN branch_master bm ON bm.id = e.branch_id
        WHERE spl.run_id = ?
        GROUP BY bm.id, bm.branch_name
        ORDER BY total_gross DESC
      `;
    case "process":
      return `
        SELECT
          pm.id                                                   AS dimension_id,
          COALESCE(pm.process_name, 'Unknown')                    AS dimension_name,
          COUNT(DISTINCT spl.employee_id)                         AS headcount,
          SUM(spl.basic)                                          AS total_basic,
          SUM(spl.hra + spl.special_allowance + COALESCE(spl.incentive_total, 0)) AS total_allowances,
          SUM(spl.gross_salary)                                   AS total_gross,
          SUM(spl.total_deductions)                               AS total_deductions,
          SUM(spl.net_salary)                                     AS total_net,
          SUM(spl.pf_employer)                                    AS total_pf_employer,
          SUM(spl.esic_employer)                                  AS total_esic_employer,
          SUM(spl.basic * 0.0481)                                 AS total_gratuity_provision
        FROM salary_prep_line spl
        JOIN employees e ON e.id = spl.employee_id
        JOIN process_master pm ON pm.id = e.process_id
        WHERE spl.run_id = ?
        GROUP BY pm.id, pm.process_name
        ORDER BY total_gross DESC
      `;
    case "department":
      return `
        SELECT
          dm.id                                                   AS dimension_id,
          COALESCE(dm.department_name, 'Unknown')                 AS dimension_name,
          COUNT(DISTINCT spl.employee_id)                         AS headcount,
          SUM(spl.basic)                                          AS total_basic,
          SUM(spl.hra + spl.special_allowance + COALESCE(spl.incentive_total, 0)) AS total_allowances,
          SUM(spl.gross_salary)                                   AS total_gross,
          SUM(spl.total_deductions)                               AS total_deductions,
          SUM(spl.net_salary)                                     AS total_net,
          SUM(spl.pf_employer)                                    AS total_pf_employer,
          SUM(spl.esic_employer)                                  AS total_esic_employer,
          SUM(spl.basic * 0.0481)                                 AS total_gratuity_provision
        FROM salary_prep_line spl
        JOIN employees e ON e.id = spl.employee_id
        JOIN department_master dm ON dm.id = e.department_id
        WHERE spl.run_id = ?
        GROUP BY dm.id, dm.department_name
        ORDER BY total_gross DESC
      `;
    case "cost_centre":
      // cost_centre may not exist on employees table — handled gracefully at query time
      return null;
    default:
      return null;
  }
}

function buildEstimateQuery(groupBy: GroupByOption): string | null {
  switch (groupBy) {
    case "branch":
      return `
        SELECT
          bm.id                                   AS dimension_id,
          COALESCE(bm.branch_name, 'Unknown')     AS dimension_name,
          COUNT(DISTINCT esa.employee_id)         AS headcount,
          SUM(esa.ctc_annual / 12)                AS total_gross
        FROM employee_salary_assignment esa
        JOIN employees e ON e.id = esa.employee_id
        JOIN branch_master bm ON bm.id = e.branch_id
        WHERE e.status = 'active'
          AND esa.effective_from <= CURDATE()
          AND esa.id = (
            SELECT id FROM employee_salary_assignment esa2
            WHERE esa2.employee_id = esa.employee_id
              AND esa2.effective_from <= CURDATE()
            ORDER BY esa2.effective_from DESC
            LIMIT 1
          )
        GROUP BY bm.id, bm.branch_name
        ORDER BY total_gross DESC
      `;
    case "process":
      return `
        SELECT
          pm.id                                   AS dimension_id,
          COALESCE(pm.process_name, 'Unknown')    AS dimension_name,
          COUNT(DISTINCT esa.employee_id)         AS headcount,
          SUM(esa.ctc_annual / 12)                AS total_gross
        FROM employee_salary_assignment esa
        JOIN employees e ON e.id = esa.employee_id
        JOIN process_master pm ON pm.id = e.process_id
        WHERE e.status = 'active'
          AND esa.effective_from <= CURDATE()
          AND esa.id = (
            SELECT id FROM employee_salary_assignment esa2
            WHERE esa2.employee_id = esa.employee_id
              AND esa2.effective_from <= CURDATE()
            ORDER BY esa2.effective_from DESC
            LIMIT 1
          )
        GROUP BY pm.id, pm.process_name
        ORDER BY total_gross DESC
      `;
    case "department":
      return `
        SELECT
          dm.id                                   AS dimension_id,
          COALESCE(dm.department_name, 'Unknown') AS dimension_name,
          COUNT(DISTINCT esa.employee_id)         AS headcount,
          SUM(esa.ctc_annual / 12)                AS total_gross
        FROM employee_salary_assignment esa
        JOIN employees e ON e.id = esa.employee_id
        JOIN department_master dm ON dm.id = e.department_id
        WHERE e.status = 'active'
          AND esa.effective_from <= CURDATE()
          AND esa.id = (
            SELECT id FROM employee_salary_assignment esa2
            WHERE esa2.employee_id = esa.employee_id
              AND esa2.effective_from <= CURDATE()
            ORDER BY esa2.effective_from DESC
            LIMIT 1
          )
        GROUP BY dm.id, dm.department_name
        ORDER BY total_gross DESC
      `;
    case "cost_centre":
      return null;
    default:
      return null;
  }
}

function sumDimensions(rows: RowDataPacket[], isEstimate: boolean): KpiSummary {
  const kpi: KpiSummary = {
    headcount: 0,
    total_gross: 0,
    total_net: 0,
    total_pf_employer: 0,
    total_esic_employer: 0,
    total_gratuity_provision: 0,
  };
  for (const row of rows) {
    kpi.headcount += Number(row.headcount ?? 0);
    kpi.total_gross += Number(row.total_gross ?? 0);
    if (!isEstimate) {
      kpi.total_net += Number(row.total_net ?? 0);
      kpi.total_pf_employer += Number(row.total_pf_employer ?? 0);
      kpi.total_esic_employer += Number(row.total_esic_employer ?? 0);
      kpi.total_gratuity_provision += Number(row.total_gratuity_provision ?? 0);
    }
  }
  if (isEstimate) {
    // For estimates, net ≈ gross (we don't know deductions), pf/esic from statutory approximation
    kpi.total_net = kpi.total_gross;
  }
  return kpi;
}

/**
 * GET /api/payroll/cost-summary
 * Query params:
 *   month     YYYY-MM  (defaults to current month)
 *   group_by  branch|process|department|cost_centre  (defaults to branch)
 */
payrollCostSummaryRouter.get(
  "/cost-summary",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const month = (req.query.month as string | undefined) ?? defaultMonth;
    const groupByRaw = (req.query.group_by as string | undefined) ?? "branch";

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, message: "Invalid month format. Use YYYY-MM" });
    }

    const validGroupBy: GroupByOption[] = ["branch", "process", "department", "cost_centre"];
    if (!validGroupBy.includes(groupByRaw as GroupByOption)) {
      return res.status(400).json({ success: false, message: "group_by must be one of: branch, process, department, cost_centre" });
    }
    const groupBy = groupByRaw as GroupByOption;

    // cost_centre: graceful skip
    if (groupBy === "cost_centre") {
      return res.json({
        success: true,
        runMonth: month,
        isEstimate: true,
        kpi: { headcount: 0, total_gross: 0, total_net: 0, total_pf_employer: 0, total_esic_employer: 0, total_gratuity_provision: 0 },
        data: [],
        message: "Cost centre grouping is not yet configured. Map a cost_centre column on employees table to enable this view.",
      });
    }

    // Look for an existing salary prep run for the given month
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_prep_run WHERE payroll_month = ? ORDER BY created_at DESC LIMIT 1`,
      [month],
    );

    let isEstimate = false;
    let dimensionRows: RowDataPacket[] = [];

    if (runRows.length > 0) {
      const runId = runRows[0].id as string;
      const sql = buildActualQuery(groupBy);
      if (sql) {
        const [rows] = await db.execute<RowDataPacket[]>(sql, [runId]);
        dimensionRows = rows;
      }
    } else {
      isEstimate = true;
      const sql = buildEstimateQuery(groupBy);
      if (sql) {
        try {
          const [rows] = await db.execute<RowDataPacket[]>(sql);
          dimensionRows = rows;
        } catch {
          // Table or column may not exist yet
          dimensionRows = [];
        }
      }
    }

    const kpi = sumDimensions(dimensionRows, isEstimate);

    const data: DimensionRow[] = dimensionRows.map((row) => ({
      dimension_name: String(row.dimension_name ?? "Unknown"),
      headcount: Number(row.headcount ?? 0),
      total_basic: Number(row.total_basic ?? 0),
      total_allowances: Number(row.total_allowances ?? 0),
      total_gross: Number(row.total_gross ?? 0),
      total_deductions: Number(row.total_deductions ?? 0),
      total_net: isEstimate ? Number(row.total_gross ?? 0) : Number(row.total_net ?? 0),
      total_pf_employer: isEstimate ? 0 : Number(row.total_pf_employer ?? 0),
      total_esic_employer: isEstimate ? 0 : Number(row.total_esic_employer ?? 0),
      total_gratuity_provision: isEstimate ? 0 : Number(row.total_gratuity_provision ?? 0),
    }));

    return res.json({
      success: true,
      runMonth: month,
      isEstimate,
      kpi,
      data,
    });
  }),
);
