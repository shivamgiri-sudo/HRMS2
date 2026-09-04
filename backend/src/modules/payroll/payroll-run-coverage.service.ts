/**
 * What a payroll month still owes.
 *
 * Once a month can be paid in several runs, "is this month done?" stops being answerable by looking
 * at one run. Somebody has to be able to see which cost centres are paid, which are mid-run, and —
 * the part that matters — which employees are in no run at all.
 *
 * COMPLETENESS IS DEFINED AGAINST EMPLOYEES, NOT COST CENTRES. A month where every cost centre has
 * a run can still leave people unpaid: measured 2026-09-04, 2 of 1,037 active employees have no
 * cost_centre_id, so they belong to no cost centre and would fall through a cost-centre-shaped
 * check. They are reported as uncovered with a reason rather than omitted, because an employee who
 * is silently skipped looks exactly like one who was correctly excluded — and the difference is
 * somebody not being paid.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { isRunClosed } from "./run-status.js";

export type CoverageStatus = "paid" | "in_run" | "not_started";

export type CoverageCostCentre = {
  costCentreId: string;
  costCentreCode: string;
  branchId: string;
  branchName: string;
  staff: number;
  runId: string | null;
  status: CoverageStatus;
};

export type MonthCoverage = {
  month: string;
  complete: boolean;
  costCentres: CoverageCostCentre[];
  uncoveredEmployees: Array<{ employeeId: string; employeeCode: string; reason: string }>;
  totals: { paid: number; inRun: number; notStarted: number; uncovered: number };
};

export async function getMonthCoverage(month: string): Promise<MonthCoverage> {
  /*
   * Cost centres with their run state. A LEFT JOIN through the scope table rather than a lookup per
   * cost centre: there are 401 active cost centres, and this is rendered on a dashboard.
   *
   * Cancelled runs are excluded from the join so a cancelled run's cost centres correctly read as
   * not_started — cancelling releases the claim, and the coverage view must agree with the rule
   * assertCostCentresFree() enforces, or the picker would offer a cost centre the API then refuses.
   */
  const [ccRows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.id            AS cost_centre_id,
            ccm.cost_centre_code,
            bm.id             AS branch_id,
            bm.branch_name,
            COUNT(e.id)       AS staff,
            s.run_id,
            r.status          AS run_status
       FROM cost_centre_master ccm
       JOIN branch_master bm
         ON bm.id = ccm.branch_id AND bm.active_status = 1
       LEFT JOIN employees e
              ON e.cost_centre_id = ccm.id
             AND e.active_status = 1
             AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
       LEFT JOIN salary_prep_run_scope s
              ON s.cost_centre_id = ccm.id AND s.run_month = ?
       LEFT JOIN salary_prep_run r
              ON r.id = s.run_id AND LOWER(r.status) <> 'cancelled'
      WHERE ccm.active_status = 1
      GROUP BY ccm.id, ccm.cost_centre_code, bm.id, bm.branch_name, s.run_id, r.status
     HAVING staff > 0 OR s.run_id IS NOT NULL
      ORDER BY bm.branch_name, ccm.cost_centre_code`,
    [month],
  );

  /*
   * Employees no run covers, each with the reason, because the reasons need different fixes and
   * only one of them is "go and create a run".
   *
   * The inactive-cost-centre case is why this is not a single generic message. Measured on
   * production 2026-09-04: 15 active employees sit in BSS/BO/AHMH-JD/560, a cost centre whose
   * active_status is 0 while its branch is fine. resolveCostCentreScope refuses inactive cost
   * centres, so those 15 can never be put in a run and would block month close indefinitely —
   * while a generic "not included in any run" sent somebody hunting the picker for a cost centre
   * that is deliberately not offered there. Naming it points at the actual fix: reactivate the
   * cost centre, or move the people.
   */
  const [uncovered] = await db.execute<RowDataPacket[]>(
    `SELECT e.id,
            e.employee_code,
            CASE WHEN e.cost_centre_id IS NULL
                 THEN 'no cost centre assigned'
                 WHEN ccm.id IS NULL
                 THEN 'cost centre no longer exists'
                 WHEN ccm.active_status <> 1
                 THEN CONCAT('cost centre ', ccm.cost_centre_code, ' is inactive and cannot be selected for a run')
                 WHEN bm.id IS NULL OR bm.active_status <> 1
                 THEN CONCAT('branch of cost centre ', ccm.cost_centre_code, ' is inactive')
                 ELSE 'cost centre not included in any run this month' END AS reason
       FROM employees e
       LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
       LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
      WHERE e.active_status = 1
        AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
        AND (e.cost_centre_id IS NULL
             OR NOT EXISTS (
                  SELECT 1
                    FROM salary_prep_run_scope s
                    JOIN salary_prep_run r
                      ON r.id = s.run_id AND LOWER(r.status) <> 'cancelled'
                   WHERE s.run_month = ? AND s.cost_centre_id = e.cost_centre_id))
      ORDER BY e.employee_code`,
    [month],
  );

  const costCentres: CoverageCostCentre[] = ccRows.map((r) => ({
    costCentreId: String(r.cost_centre_id),
    costCentreCode: String(r.cost_centre_code ?? ""),
    branchId: String(r.branch_id),
    branchName: String(r.branch_name ?? ""),
    staff: Number(r.staff ?? 0),
    runId: r.run_id ? String(r.run_id) : null,
    // "paid" means the run is closed to recomputation — finalized, locked or disbursed. Anything
    // earlier is still in flight, however far along it looks.
    status: (!r.run_id ? "not_started" : isRunClosed(r.run_status) ? "paid" : "in_run") as CoverageStatus,
  }));

  const uncoveredEmployees = uncovered.map((r) => ({
    employeeId: String(r.id),
    employeeCode: String(r.employee_code ?? ""),
    reason: String(r.reason),
  }));

  return {
    month,
    complete: uncoveredEmployees.length === 0,
    costCentres,
    uncoveredEmployees,
    totals: {
      paid: costCentres.filter((c) => c.status === "paid").length,
      inRun: costCentres.filter((c) => c.status === "in_run").length,
      notStarted: costCentres.filter((c) => c.status === "not_started").length,
      uncovered: uncoveredEmployees.length,
    },
  };
}
