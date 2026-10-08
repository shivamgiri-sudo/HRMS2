import { tableExists } from "../../shared/dbHelpers.js";
import { nonVoidRunSql } from "../payroll/run-status.js";

/**
 * Which people cost source applies to one running-salary snapshot row.
 *
 * A payroll run may cover the whole company (no salary_prep_run_scope rows) or only chosen cost
 * centres (migration 1671). P&L used to switch from the running-salary accrual to posted payroll
 * for the WHOLE company as soon as any run had lines, so the first scoped run zeroed every other
 * cost centre's people cost. The rule is per employee instead: a snapshot row counts only while no
 * valid (non-void) run of its month that has lines covers it — company-wide, by the row's home cost
 * centre being in the run's scope, or by the employee having a line in such a run.
 *
 * Returns a SQL predicate with no bind parameters over the snapshot alias (`period_code`,
 * `cost_centre_id`, `employee_id`). With no run in the month it is true for every row, and with a
 * company-wide run it is false for every row — exactly the old either/or in those two cases.
 */
export async function snapshotUncoveredByRunSql(alias = "s"): Promise<string> {
  const scopeCovers = (await tableExists("salary_prep_run_scope"))
    ? `(NOT EXISTS (SELECT 1 FROM salary_prep_run_scope cov_scope0 WHERE cov_scope0.run_id = cov_run0.id)
          OR EXISTS (SELECT 1 FROM salary_prep_run_scope cov_scope1
                      WHERE cov_scope1.run_id = cov_run0.id AND cov_scope1.cost_centre_id = ${alias}.cost_centre_id))`
    : "1 = 1";
  return `NOT EXISTS (
            SELECT 1 FROM salary_prep_run cov_run0
             WHERE cov_run0.run_month = ${alias}.period_code AND ${nonVoidRunSql("cov_run0")}
               AND EXISTS (SELECT 1 FROM salary_prep_line cov_line0 WHERE cov_line0.run_id = cov_run0.id)
               AND ${scopeCovers})
          AND NOT EXISTS (
            SELECT 1 FROM salary_prep_line cov_line1
              JOIN salary_prep_run cov_run1 ON cov_run1.id = cov_line1.run_id AND ${nonVoidRunSql("cov_run1")}
             WHERE cov_run1.run_month = ${alias}.period_code AND cov_line1.employee_id = ${alias}.employee_id)`;
}
